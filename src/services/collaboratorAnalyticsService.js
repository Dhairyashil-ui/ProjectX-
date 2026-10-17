// Service for GitStory Explore Collaborators: Real GitHub Repository Data & Analytics
import {
  parseAndValidateRepo,
  getGitHubHeaders,
  getCommitsApiUrl,
  getCommitDetailsApiUrl,
  getTreeApiUrl,
  handleApiError,
  GitHubApiError,
  fetchGitHubWithFallback,
} from './githubTimelineService.js';

// In-memory cache for collaborator analytics results and commit batches
const analyticsCache = new Map();
const commitDetailsBatchCache = new Map();

/**
 * Normalizes contributor identity from GitHub commit payload.
 * Attributes by GitHub login when available, fallback to email/name.
 * Detects known bots and automation accounts.
 */
export function normalizeContributorIdentity(rawCommit) {
  const authorObj = rawCommit.author;
  const commitAuthor = rawCommit.commit?.author;
  const committerObj = rawCommit.committer;
  const commitCommitter = rawCommit.commit?.committer;

  let login = (authorObj?.login || '').trim();
  const name = (commitAuthor?.name || commitCommitter?.name || login || 'Unknown Contributor').trim();
  const email = (commitAuthor?.email || commitCommitter?.email || '').trim().toLowerCase();

  // If no GitHub username, create a clean deterministic identifier
  if (!login) {
    if (email) {
      login = email.split('@')[0].toLowerCase().replace(/[^a-z0-9_-]/g, '-');
    } else {
      login = name.toLowerCase().replace(/[^a-z0-9_-]/g, '-');
    }
  }

  // Detect bots and automated tools
  const lowerLogin = login.toLowerCase();
  const lowerName = name.toLowerCase();
  const lowerEmail = email.toLowerCase();
  const isBot = Boolean(
    (authorObj?.type && authorObj.type.toLowerCase() === 'bot') ||
    lowerLogin.endsWith('[bot]') ||
    lowerLogin.includes('dependabot') ||
    lowerLogin.includes('renovate') ||
    lowerLogin.includes('github-actions') ||
    lowerLogin.includes('greenkeeper') ||
    lowerLogin.includes('snyk-bot') ||
    lowerLogin.includes('semantic-release') ||
    lowerName.includes('[bot]') ||
    lowerName.includes('bot') && (lowerEmail.includes('noreply.github.com') || lowerEmail.includes('bot'))
  );

  const avatarUrl = authorObj?.avatar_url || `https://avatars.githubusercontent.com/u/0?v=4`;
  const htmlUrl = authorObj?.html_url || (login && !login.includes('unknown') ? `https://github.com/${login}` : null);

  return {
    id: login,
    login,
    name,
    email,
    avatarUrl,
    htmlUrl,
    isBot,
  };
}

/**
 * Deconstructs a file path into its full directory path, ancestor directories, and base filename.
 * e.g. "packages/react-dom/src/client/ReactDOM.js" ->
 * fullDir: "packages/react-dom/src/client"
 * ancestors: ["packages", "packages/react-dom", "packages/react-dom/src", "packages/react-dom/src/client"]
 * filename: "ReactDOM.js"
 */
export function parseFilePath(filePath) {
  if (!filePath || typeof filePath !== 'string') {
    return {
      filePath: '',
      filename: '',
      fullDir: '',
      ancestors: [],
    };
  }

  const normalized = filePath.replace(/\\/g, '/').replace(/^\/+/, '');
  const parts = normalized.split('/');
  const filename = parts.pop() || '';
  const ancestors = [];
  let current = '';

  for (const part of parts) {
    current = current ? `${current}/${part}` : part;
    ancestors.push(current);
  }

  const fullDir = ancestors.length > 0 ? ancestors[ancestors.length - 1] : '(root)';

  return {
    filePath: normalized,
    filename,
    fullDir: fullDir || '(root)',
    ancestors: ancestors.length > 0 ? ancestors : ['(root)'],
  };
}

/**
 * Calculates contribution concentration metrics for a list of contributor commit counts.
 * Uses Herfindahl-Hirschman Index (HHI) and top-contributor percentage share.
 */
export function calculateConcentration(contributorCounts) {
  // contributorCounts: [{ contributorId, count }]
  if (!Array.isArray(contributorCounts) || contributorCounts.length === 0) {
    return {
      totalCommits: 0,
      uniqueContributorsCount: 0,
      topContributorId: null,
      topContributorSharePct: 0,
      top2SharePct: 0,
      hhiScore: 0,
      riskLevel: 'low', // 'high' | 'moderate' | 'low'
      description: 'Distributed activity',
    };
  }

  const sorted = [...contributorCounts].sort((a, b) => b.count - a.count);
  const totalCommits = sorted.reduce((sum, item) => sum + item.count, 0);

  if (totalCommits === 0) {
    return {
      totalCommits: 0,
      uniqueContributorsCount: 0,
      topContributorId: null,
      topContributorSharePct: 0,
      top2SharePct: 0,
      hhiScore: 0,
      riskLevel: 'low',
      description: 'No commits in selection',
    };
  }

  const top1 = sorted[0];
  const topContributorSharePct = Number(((top1.count / totalCommits) * 100).toFixed(1));
  const top2Count = (top1.count + (sorted[1] ? sorted[1].count : 0));
  const top2SharePct = Number(((top2Count / totalCommits) * 100).toFixed(1));

  // Herfindahl-Hirschman Index (sum of squared percentage shares)
  let hhi = 0;
  for (const item of sorted) {
    const share = (item.count / totalCommits) * 100;
    hhi += share * share;
  }
  const hhiScore = Math.round(hhi);

  let riskLevel = 'low';
  let description = 'Historically distributed across multiple contributors';

  if (topContributorSharePct >= 70 || hhiScore >= 5000 || (sorted.length === 1 && totalCommits >= 3)) {
    riskLevel = 'high';
    description = `High historical concentration: ${top1.contributorId} authored ${topContributorSharePct}% of changes in this scope.`;
  } else if (topContributorSharePct >= 50 || hhiScore >= 3000) {
    riskLevel = 'moderate';
    description = `Moderate concentration: top 2 contributors account for ${top2SharePct}% of changes.`;
  }

  return {
    totalCommits,
    uniqueContributorsCount: sorted.length,
    topContributorId: top1.contributorId,
    topContributorSharePct,
    top2SharePct,
    hhiScore,
    riskLevel,
    description,
  };
}

/**
 * Buckets an ISO date string into day, week, or month format.
 */
export function getBucketKey(isoDateStr, grouping = 'week') {
  if (!isoDateStr) return 'unknown';
  const d = new Date(isoDateStr);
  if (isNaN(d.getTime())) return 'unknown';

  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');

  if (grouping === 'day') {
    return `${year}-${month}-${day}`;
  }
  if (grouping === 'month') {
    return `${year}-${month}`;
  }

  // Week grouping (ISO week)
  const tempDate = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = tempDate.getUTCDay() || 7;
  tempDate.setUTCDate(tempDate.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(tempDate.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((tempDate - yearStart) / 86400000 + 1) / 7);
  return `${tempDate.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

/**
 * Fetches commits history and analyzes collaborator attribution, directory distribution,
 * concentration metrics, and timeline activity.
 * 
 * Supports progressive batch loading:
 * - Fetches paginated commits history (100 commits).
 * - Concurrently loads commit details for up to maxDetails commits (respecting rate limits).
 * - Caches in sessionStorage and memory.
 */
export async function fetchCollaboratorAnalytics(repoInput, options = {}) {
  const {
    maxCommits = 100,
    maxDetailsToFetch = 40,
    forceRefresh = false,
    onProgress = null,
  } = options;

  const validation = parseAndValidateRepo(repoInput || 'facebook/react');
  if (!validation.isValid) {
    throw new GitHubApiError(validation.error, {
      status: 400,
      type: 'VALIDATION',
      repo: String(repoInput),
    });
  }

  const { owner, repo, fullName } = validation;
  const cacheKey = `collab_analytics_${fullName}_${maxCommits}_${maxDetailsToFetch}`;

  // Check in-memory and sessionStorage cache
  if (!forceRefresh) {
    if (analyticsCache.has(cacheKey)) {
      return analyticsCache.get(cacheKey);
    }
    try {
      const stored = sessionStorage.getItem(cacheKey);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed && parsed.commits && parsed.commits.length > 0) {
          analyticsCache.set(cacheKey, parsed);
          return parsed;
        }
      }
    } catch (e) {
      // ignore storage error
    }
  }

  const headers = getGitHubHeaders();

  if (onProgress) onProgress({ phase: 'fetching_commits', loaded: 0, total: maxCommits });

  // 1. Fetch paginated commits (A: GET /repos/{owner}/{repo}/commits?per_page=100)
  const commitsUrl = getCommitsApiUrl(owner, repo, Math.min(100, maxCommits));
  let commitsRes;
  try {
    commitsRes = await fetchGitHubWithFallback(commitsUrl);
  } catch (err) {
    throw new GitHubApiError('Network connection error while fetching commits.', {
      status: 0,
      type: 'NETWORK',
      repo: fullName,
      details: err.message,
    });
  }

  if (!commitsRes.ok) {
    await handleApiError(commitsRes, fullName);
  }

  const rawCommits = await commitsRes.json();
  if (!Array.isArray(rawCommits) || rawCommits.length === 0) {
    throw new GitHubApiError(`No commits found for repository ${fullName}.`, {
      status: 200,
      type: 'EMPTY_REPO',
      repo: fullName,
    });
  }

  // 2. Fetch repository file tree at latest commit to know repository baseline structure
  let directoryTree = [];
  try {
    const latestSha = rawCommits[0].sha;
    const treeUrl = getTreeApiUrl(owner, repo, latestSha);
    const treeRes = await fetchGitHubWithFallback(treeUrl);
    if (treeRes.ok) {
      const treeData = await treeRes.json();
      directoryTree = treeData.tree || [];
    }
  } catch (e) {
    console.warn('Repository tree fetch skipped:', e);
  }

  // 3. Concurrently fetch commit details in controlled batches of 6
  // (to obtain changed files, additions, deletions, and directory attribution)
  const commitsToDetail = rawCommits.slice(0, Math.min(rawCommits.length, maxDetailsToFetch));
  const detailedCommitsMap = new Map();

  const BATCH_SIZE = 6;
  for (let i = 0; i < commitsToDetail.length; i += BATCH_SIZE) {
    const batch = commitsToDetail.slice(i, i + BATCH_SIZE);
    if (onProgress) {
      onProgress({
        phase: 'fetching_details',
        loaded: i,
        total: commitsToDetail.length,
      });
    }

    const batchPromises = batch.map(async (c) => {
      const detailCacheKey = `${fullName}/${c.sha}`;
      if (commitDetailsBatchCache.has(detailCacheKey)) {
        return { sha: c.sha, details: commitDetailsBatchCache.get(detailCacheKey) };
      }

      try {
        const detailUrl = getCommitDetailsApiUrl(owner, repo, c.sha);
        const res = await fetchGitHubWithFallback(detailUrl);
        if (res.ok) {
          const data = await res.json();
          const detailObj = {
            stats: data.stats || { total: 0, additions: 0, deletions: 0 },
            files: (data.files || []).map((f) => ({
              filename: f.filename,
              status: f.status, // added, modified, removed, renamed
              additions: f.additions || 0,
              deletions: f.deletions || 0,
              changes: f.changes || 0,
              previousFilename: f.previous_filename || null,
            })),
          };
          commitDetailsBatchCache.set(detailCacheKey, detailObj);
          return { sha: c.sha, details: detailObj };
        }
      } catch (err) {
        // graceful detail fallback
      }
      return { sha: c.sha, details: null };
    });

    const results = await Promise.all(batchPromises);
    for (const r of results) {
      if (r && r.details) {
        detailedCommitsMap.set(r.sha, r.details);
      }
    }
  }

  if (onProgress) {
    onProgress({
      phase: 'processing_analytics',
      loaded: rawCommits.length,
      total: rawCommits.length,
    });
  }

  // 4. Construct normalized commits dataset
  const normalizedCommits = rawCommits.map((c) => {
    const identity = normalizeContributorIdentity(c);
    const authorDate = c.commit?.author?.date || c.commit?.committer?.date || new Date().toISOString();
    const details = detailedCommitsMap.get(c.sha);
    const isMerge = Array.isArray(c.parents) && c.parents.length > 1;

    // Process files changed in this commit
    const rawFiles = details?.files || [];
    const filesChanged = [];
    const touchedDirectoriesSet = new Set();
    let additions = details?.stats?.additions || 0;
    let deletions = details?.stats?.deletions || 0;

    for (const f of rawFiles) {
      const parsedPath = parseFilePath(f.filename);
      filesChanged.push({
        filename: f.filename,
        baseName: parsedPath.filename,
        fullDir: parsedPath.fullDir,
        status: f.status,
        additions: f.additions,
        deletions: f.deletions,
        previousFilename: f.previousFilename,
      });

      // Add all ancestor directories for complete hierarchical attribution
      for (const anc of parsedPath.ancestors) {
        touchedDirectoriesSet.add(anc);
      }
    }

    return {
      sha: c.sha,
      shortSha: c.sha.slice(0, 7),
      message: (c.commit?.message || '').split('\n')[0].trim(),
      fullMessage: c.commit?.message || '',
      date: authorDate,
      timestamp: new Date(authorDate).getTime(),
      htmlUrl: c.html_url || `https://github.com/${owner}/${repo}/commit/${c.sha}`,
      author: identity,
      isMerge,
      hasDetails: Boolean(details),
      additions,
      deletions,
      filesCount: filesChanged.length,
      files: filesChanged,
      touchedDirectories: Array.from(touchedDirectoriesSet),
    };
  });

  // 5. Compute Contributor-Level Aggregates
  const contributorsMap = new Map();
  const directoryAttributionMap = new Map(); // dirPath -> { dirPath, commitsSet, filesMap, contributorsMap }
  const contributorDirectoryMatrix = new Map(); // `${contributorId}::${dirPath}` -> { contributorId, dirPath, count, commits: [] }

  for (const commit of normalizedCommits) {
    const contribId = commit.author.id;

    // Contributor aggregates
    if (!contributorsMap.has(contribId)) {
      contributorsMap.set(contribId, {
        id: contribId,
        login: commit.author.login,
        name: commit.author.name,
        email: commit.author.email,
        avatarUrl: commit.author.avatarUrl,
        htmlUrl: commit.author.htmlUrl,
        isBot: commit.author.isBot,
        commitsCount: 0,
        commits: [],
        directoriesChanged: new Set(),
        filesChanged: new Set(),
        totalAdditions: 0,
        totalDeletions: 0,
        firstCommitDate: commit.date,
        latestCommitDate: commit.date,
      });
    }

    const contrib = contributorsMap.get(contribId);
    contrib.commitsCount++;
    contrib.commits.push(commit);
    contrib.totalAdditions += commit.additions;
    contrib.totalDeletions += commit.deletions;

    if (new Date(commit.date) < new Date(contrib.firstCommitDate)) {
      contrib.firstCommitDate = commit.date;
    }
    if (new Date(commit.date) > new Date(contrib.latestCommitDate)) {
      contrib.latestCommitDate = commit.date;
    }

    // Directory attribution from commit
    const directories = commit.touchedDirectories.length > 0 ? commit.touchedDirectories : ['(root)'];

    for (const dir of directories) {
      contrib.directoriesChanged.add(dir);

      if (!directoryAttributionMap.has(dir)) {
        directoryAttributionMap.set(dir, {
          path: dir,
          uniqueCommitsCount: 0,
          commits: [],
          contributorCountsMap: new Map(),
          filesMap: new Map(),
          additions: 0,
          deletions: 0,
        });
      }

      const dirData = directoryAttributionMap.get(dir);
      dirData.uniqueCommitsCount++;
      dirData.commits.push(commit);
      dirData.additions += commit.additions;
      dirData.deletions += commit.deletions;

      const currentContribCount = dirData.contributorCountsMap.get(contribId) || 0;
      dirData.contributorCountsMap.set(contribId, currentContribCount + 1);

      // Contributor-directory relationship pair
      const matrixKey = `${contribId}::${dir}`;
      if (!contributorDirectoryMatrix.has(matrixKey)) {
        contributorDirectoryMatrix.set(matrixKey, {
          contributorId: contribId,
          contributor: commit.author,
          directory: dir,
          count: 0,
          commits: [],
        });
      }
      const matrixPair = contributorDirectoryMatrix.get(matrixKey);
      matrixPair.count++;
      matrixPair.commits.push(commit);
    }

    // File attribution
    for (const file of commit.files) {
      contrib.filesChanged.add(file.filename);
      const dirData = directoryAttributionMap.get(file.fullDir);
      if (dirData) {
        if (!dirData.filesMap.has(file.filename)) {
          dirData.filesMap.set(file.filename, {
            filename: file.filename,
            baseName: file.baseName,
            status: file.status,
            commitsCount: 0,
            contributorsSet: new Set(),
            commits: [],
          });
        }
        const fileEntry = dirData.filesMap.get(file.filename);
        fileEntry.commitsCount++;
        fileEntry.contributorsSet.add(contribId);
        fileEntry.commits.push(commit);
      }
    }
  }

  // 6. Format Final Contributor List
  const contributorsList = Array.from(contributorsMap.values()).map((c) => ({
    ...c,
    directoriesChangedCount: c.directoriesChanged.size,
    directoriesChanged: Array.from(c.directoriesChanged),
    filesChangedCount: c.filesChanged.size,
    filesChanged: Array.from(c.filesChanged),
  })).sort((a, b) => b.commitsCount - a.commitsCount);

  // 7. Format Final Directories List with Concentration Analysis
  const directoriesList = Array.from(directoryAttributionMap.values()).map((d) => {
    const contributorBreakdown = Array.from(d.contributorCountsMap.entries()).map(([contributorId, count]) => {
      const contribObj = contributorsMap.get(contributorId);
      return {
        contributorId,
        login: contribObj?.login || contributorId,
        name: contribObj?.name || contributorId,
        avatarUrl: contribObj?.avatarUrl || '',
        isBot: contribObj?.isBot || false,
        count,
        sharePct: Number(((count / d.uniqueCommitsCount) * 100).toFixed(1)),
      };
    }).sort((a, b) => b.count - a.count);

    const concentration = calculateConcentration(
      contributorBreakdown.map((c) => ({ contributorId: c.login, count: c.count }))
    );

    const filesList = Array.from(d.filesMap.values()).map((f) => ({
      ...f,
      contributorsCount: f.contributorsSet.size,
      contributors: Array.from(f.contributorsSet),
    })).sort((a, b) => b.commitsCount - a.commitsCount);

    return {
      path: d.path,
      uniqueCommitsCount: d.uniqueCommitsCount,
      additions: d.additions,
      deletions: d.deletions,
      contributorsCount: contributorBreakdown.length,
      contributors: contributorBreakdown,
      concentration,
      filesCount: filesList.length,
      files: filesList,
      commits: d.commits,
    };
  }).sort((a, b) => b.uniqueCommitsCount - a.uniqueCommitsCount);

  // 8. Construct Timeline Buckets (Default: by week)
  const timelineBucketsMap = new Map();
  for (const commit of normalizedCommits) {
    const bucketKey = getBucketKey(commit.date, 'week');
    if (!timelineBucketsMap.has(bucketKey)) {
      timelineBucketsMap.set(bucketKey, {
        bucketKey,
        date: commit.date,
        totalCommits: 0,
        contributorCounts: new Map(),
        commits: [],
      });
    }
    const b = timelineBucketsMap.get(bucketKey);
    b.totalCommits++;
    b.commits.push(commit);
    const prevCount = b.contributorCounts.get(commit.author.id) || 0;
    b.contributorCounts.set(commit.author.id, prevCount + 1);
  }

  const timelineBuckets = Array.from(timelineBucketsMap.values())
    .map((b) => ({
      bucketKey: b.bucketKey,
      date: b.date,
      totalCommits: b.totalCommits,
      contributorCounts: Object.fromEntries(b.contributorCounts),
      commits: b.commits,
    }))
    .sort((a, b) => new Date(a.date) - new Date(b.date));

  const result = {
    repo: fullName,
    owner,
    repoName: repo,
    loadedCommitsCount: normalizedCommits.length,
    detailedCommitsCount: detailedCommitsMap.size,
    isCompleteHistory: normalizedCommits.length < maxCommits,
    attributionNotice: 'Historical contribution patterns are based on public commit authorship and do not represent official ownership, performance ratings, or current responsibility.',
    contributors: contributorsList,
    directories: directoriesList,
    contributorDirectoryPairs: Array.from(contributorDirectoryMatrix.values()),
    timelineBuckets,
    commits: normalizedCommits,
    treeStructure: directoryTree,
  };

  // Cache in memory and sessionStorage
  analyticsCache.set(cacheKey, result);
  try {
    sessionStorage.setItem(cacheKey, JSON.stringify(result));
  } catch (e) {
    // ignore quota error
  }

  return result;
}

/**
 * Filter collaborator analytics dynamically by date range, contributor, directory, and bot flags.
 */
export function filterCollaboratorAnalytics(analyticsData, filters = {}) {
  if (!analyticsData || !analyticsData.commits) return null;

  const {
    startDate = null,
    endDate = null,
    selectedContributorId = null,
    selectedDirectory = null,
    hideBots = true,
    hideMerges = false,
    grouping = 'week',
  } = filters;

  const startTimestamp = startDate ? new Date(startDate).getTime() : -Infinity;
  const endTimestamp = endDate ? new Date(endDate).getTime() : Infinity;

  // Filter commits
  const filteredCommits = analyticsData.commits.filter((c) => {
    if (c.timestamp < startTimestamp || c.timestamp > endTimestamp) return false;
    if (hideBots && c.author.isBot) return false;
    if (hideMerges && c.isMerge) return false;
    if (selectedContributorId && c.author.id !== selectedContributorId) return false;
    if (selectedDirectory && selectedDirectory !== 'all') {
      const touchesDir = c.touchedDirectories.includes(selectedDirectory) ||
        c.files.some((f) => f.fullDir === selectedDirectory || f.fullDir.startsWith(`${selectedDirectory}/`));
      if (!touchesDir) return false;
    }
    return true;
  });

  // Recalculate contributor counts on filtered set
  const filteredContributorsMap = new Map();
  const filteredDirectoriesMap = new Map();
  const filteredTimelineBucketsMap = new Map();

  for (const c of filteredCommits) {
    // 1. Contributor
    const contribId = c.author.id;
    if (!filteredContributorsMap.has(contribId)) {
      filteredContributorsMap.set(contribId, {
        ...c.author,
        commitsCount: 0,
        additions: 0,
        deletions: 0,
        commits: [],
        directoriesSet: new Set(),
      });
    }
    const contrib = filteredContributorsMap.get(contribId);
    contrib.commitsCount++;
    contrib.additions += c.additions;
    contrib.deletions += c.deletions;
    contrib.commits.push(c);
    for (const d of c.touchedDirectories) {
      contrib.directoriesSet.add(d);
    }

    // 2. Directory
    const dirs = c.touchedDirectories.length > 0 ? c.touchedDirectories : ['(root)'];
    for (const dir of dirs) {
      if (!filteredDirectoriesMap.has(dir)) {
        filteredDirectoriesMap.set(dir, {
          path: dir,
          uniqueCommitsCount: 0,
          contributorCountsMap: new Map(),
          filesMap: new Map(),
          additions: 0,
          deletions: 0,
          commits: [],
        });
      }
      const dirData = filteredDirectoriesMap.get(dir);
      dirData.uniqueCommitsCount++;
      dirData.additions += c.additions;
      dirData.deletions += c.deletions;
      dirData.commits.push(c);
      const curr = dirData.contributorCountsMap.get(contribId) || 0;
      dirData.contributorCountsMap.set(contribId, curr + 1);

      // Track files for this directory
      if (Array.isArray(c.files)) {
        for (const file of c.files) {
          const fileDir = file.fullDir || '(root)';
          if (fileDir === dir || (dir === '(root)' && (!file.fullDir || file.fullDir === '')) || fileDir.startsWith(`${dir}/`)) {
            if (!dirData.filesMap.has(file.filename)) {
              dirData.filesMap.set(file.filename, {
                filename: file.filename,
                baseName: file.baseName,
                status: file.status || 'modified',
                commitsCount: 0,
                commits: [],
                contributorsSet: new Set(),
              });
            }
            const fEntry = dirData.filesMap.get(file.filename);
            fEntry.commitsCount++;
            fEntry.commits.push(c);
            fEntry.contributorsSet.add(contribId);
          }
        }
      }
    }

    // 3. Timeline Buckets
    const bKey = getBucketKey(c.date, grouping);
    if (!filteredTimelineBucketsMap.has(bKey)) {
      filteredTimelineBucketsMap.set(bKey, {
        bucketKey: bKey,
        date: c.date,
        totalCommits: 0,
        contributorCounts: new Map(),
        commits: [],
      });
    }
    const b = filteredTimelineBucketsMap.get(bKey);
    b.totalCommits++;
    b.commits.push(c);
    const prevCount = b.contributorCounts.get(contribId) || 0;
    b.contributorCounts.set(contribId, prevCount + 1);
  }

  const contributors = Array.from(filteredContributorsMap.values())
    .map((c) => ({
      ...c,
      directoriesCount: c.directoriesSet.size,
      directories: Array.from(c.directoriesSet),
    }))
    .sort((a, b) => b.commitsCount - a.commitsCount);

  const directories = Array.from(filteredDirectoriesMap.values())
    .map((d) => {
      const breakdown = Array.from(d.contributorCountsMap.entries()).map(([contributorId, count]) => {
        const contrib = filteredContributorsMap.get(contributorId);
        return {
          contributorId,
          login: contrib?.login || contributorId,
          name: contrib?.name || contributorId,
          avatarUrl: contrib?.avatarUrl || '',
          count,
          sharePct: Number(((count / d.uniqueCommitsCount) * 100).toFixed(1)),
        };
      }).sort((a, b) => b.count - a.count);

      const concentration = calculateConcentration(breakdown);

      const filesList = Array.from(d.filesMap ? d.filesMap.values() : []).map((f) => ({
        ...f,
        contributorsCount: f.contributorsSet.size,
        contributors: Array.from(f.contributorsSet),
      })).sort((a, b) => b.commitsCount - a.commitsCount);

      return {
        path: d.path,
        uniqueCommitsCount: d.uniqueCommitsCount,
        additions: d.additions,
        deletions: d.deletions,
        contributorsCount: breakdown.length,
        contributors: breakdown,
        concentration,
        filesCount: filesList.length,
        files: filesList,
        commits: d.commits,
      };
    })
    .sort((a, b) => b.uniqueCommitsCount - a.uniqueCommitsCount);

  // Recalculate contributor directory pairs
  const filteredMatrix = new Map();
  for (const c of filteredCommits) {
    const dirs = c.touchedDirectories.length > 0 ? c.touchedDirectories : ['(root)'];
    for (const dir of dirs) {
      const key = `${c.author.id}::${dir}`;
      if (!filteredMatrix.has(key)) {
        filteredMatrix.set(key, {
          contributorId: c.author.id,
          contributor: c.author,
          directory: dir,
          count: 0,
          commits: [],
        });
      }
      const pair = filteredMatrix.get(key);
      pair.count++;
      pair.commits.push(c);
    }
  }
  const contributorDirectoryPairs = Array.from(filteredMatrix.values()).sort((a, b) => b.count - a.count);

  const timelineBuckets = Array.from(filteredTimelineBucketsMap.values())
    .map((b) => ({
      bucketKey: b.bucketKey,
      date: b.date,
      totalCommits: b.totalCommits,
      contributorCounts: Object.fromEntries(b.contributorCounts),
      commits: b.commits,
    }))
    .sort((a, b) => new Date(a.date) - new Date(b.date));

  return {
    ...analyticsData,
    filteredCommitsCount: filteredCommits.length,
    contributors,
    directories,
    contributorDirectoryPairs,
    timelineBuckets,
    commits: filteredCommits,
  };
}
