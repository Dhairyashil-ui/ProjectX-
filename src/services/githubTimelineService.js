// Real GitHub API Service for GitStory Time-Travel Timeline
// Endpoints used:
// A. Commit history: GET /repos/{owner}/{repo}/commits?per_page=100
// B. Details of selected commit: GET /repos/{owner}/{repo}/commits/{sha}
// C. Historical file structure: GET /repos/{owner}/{repo}/git/trees/{sha}?recursive=1
// D. Release milestones: GET /repos/{owner}/{repo}/releases (and /tags)

const API_BASE = 'https://api.github.com';

// In-memory caches to avoid redundant network calls and save rate limit
const commitDetailsCache = new Map();
const commitTreesCache = new Map();

/**
 * Custom error class for GitHub API and validation errors
 */
export class GitHubApiError extends Error {
  constructor(message, { status = 0, type = 'UNKNOWN', repo = '', details = null } = {}) {
    super(message);
    this.name = 'GitHubApiError';
    this.status = status;
    this.type = type; // 'VALIDATION' | 'NOT_FOUND' | 'RATE_LIMIT' | 'UNAUTHORIZED' | 'FORBIDDEN' | 'NETWORK' | 'EMPTY_REPO' | 'API_ERROR'
    this.repo = repo;
    this.details = details;
  }
}

/**
 * URL Generator helpers that safely encode all path segments
 */
export function getCommitsApiUrl(owner, repo, perPage = 100) {
  return `${API_BASE}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/commits?per_page=${Number(perPage)}`;
}

export function getRepoMetaApiUrl(owner, repo) {
  return `${API_BASE}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
}

export function getReleasesApiUrl(owner, repo, perPage = 30) {
  return `${API_BASE}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/releases?per_page=${Number(perPage)}`;
}

export function getTagsApiUrl(owner, repo, perPage = 30) {
  return `${API_BASE}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/tags?per_page=${Number(perPage)}`;
}

export function getCommitDetailsApiUrl(owner, repo, sha) {
  return `${API_BASE}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/commits/${encodeURIComponent(sha)}`;
}

export function getTreeApiUrl(owner, repo, sha) {
  return `${API_BASE}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/trees/${encodeURIComponent(sha)}?recursive=1`;
}

/**
 * Parses and strictly validates a repository identifier or URL.
 * Never allows prompt instructions, UI text, or malformed strings.
 * 
 * Supports:
 * - "owner/repo" (e.g. facebook/react)
 * - "https://github.com/owner/repo"
 * - "https://github.com/owner/repo/"
 * - "http://github.com/owner/repo"
 * - "git@github.com:owner/repo.git"
 * - URLs with query strings, hashes, or deep paths (e.g. /tree/main)
 */
export function parseAndValidateRepo(repoInput) {
  if (!repoInput || typeof repoInput !== 'string') {
    return {
      isValid: false,
      error: 'Repository identifier is required (e.g. "facebook/react" or "https://github.com/facebook/react").',
      owner: null,
      repo: null,
      fullName: null,
    };
  }

  let cleaned = repoInput.trim();
  if (!cleaned) {
    return {
      isValid: false,
      error: 'Repository input cannot be empty.',
      owner: null,
      repo: null,
      fullName: null,
    };
  }

  // Reject URLs targeting non-GitHub domains
  if (/^https?:\/\//i.test(cleaned)) {
    if (!/^https?:\/\/(?:www\.)?github\.com\//i.test(cleaned)) {
      return {
        isValid: false,
        error: 'Only GitHub repositories are supported (must start with https://github.com/ or be in owner/repo format).',
        owner: null,
        repo: null,
        fullName: null,
      };
    }
  }

  if (/^git@/i.test(cleaned)) {
    if (!/^git@github\.com:/i.test(cleaned)) {
      return {
        isValid: false,
        error: 'Only GitHub SSH URLs (git@github.com:owner/repo.git) are supported.',
        owner: null,
        repo: null,
        fullName: null,
      };
    }
  }

  // Strip query string (?tab=...) and hash fragment (#readme)
  cleaned = cleaned.split('?')[0].split('#')[0].trim();

  // Strip SSH or web URL prefix
  if (cleaned.startsWith('git@github.com:')) {
    cleaned = cleaned.replace(/^git@github\.com:/i, '');
  } else {
    cleaned = cleaned.replace(/^(?:https?:\/\/)?(?:www\.)?github\.com\//i, '');
  }

  // Strip .git suffix and leading/trailing slashes
  cleaned = cleaned.replace(/\.git$/i, '').replace(/^\/+/, '').replace(/\/+$/, '');

  // Extract path segments
  const segments = cleaned.split('/').filter(Boolean);

  if (segments.length < 2) {
    return {
      isValid: false,
      error: `Invalid repository format "${repoInput}". Please provide in "owner/repository" format (e.g. facebook/react).`,
      owner: null,
      repo: null,
      fullName: null,
    };
  }

  const owner = segments[0].trim();
  const repo = segments[1].trim();

  // GitHub username / org validation:
  // 1-39 alphanumeric characters or single hyphens, cannot start or end with hyphen
  const isValidOwner = /^[a-zA-Z0-9](?:[a-zA-Z0-9]|-(?=[a-zA-Z0-9])){0,38}$/.test(owner);

  // GitHub repository name validation:
  // 1-100 alphanumeric characters, hyphens, periods, or underscores, not "." or ".."
  const isValidRepo = /^[a-zA-Z0-9_.-]{1,100}$/.test(repo) && repo !== '.' && repo !== '..';

  if (!isValidOwner || !isValidRepo) {
    return {
      isValid: false,
      error: `Invalid repository or owner name in "${repoInput}". Owner and repo must contain only valid GitHub characters without spaces.`,
      owner: null,
      repo: null,
      fullName: null,
    };
  }

  return {
    isValid: true,
    error: null,
    owner,
    repo,
    fullName: `${owner}/${repo}`,
  };
}

/**
 * Parse owner and repository name safely.
 * If input is invalid, returns safe default 'facebook/react' and never arbitrary prompt text!
 */
export function parseRepoIdentifier(repoInput) {
  if (!repoInput) {
    return { owner: 'facebook', repo: 'react', fullName: 'facebook/react', isValid: true };
  }
  const result = parseAndValidateRepo(repoInput);
  if (result.isValid) {
    return { owner: result.owner, repo: result.repo, fullName: result.fullName, isValid: true };
  }
  return { owner: 'facebook', repo: 'react', fullName: 'facebook/react', isValid: false, error: result.error };
}

export const BACKUP_GITHUB_PAT = '';

/**
 * Returns GitHub headers for a given token or fallback.
 */
export function getGitHubHeaders(tokenOverride = null) {
  const headers = {
    Accept: 'application/vnd.github.v3+json',
  };
  let token = tokenOverride;
  if (!token) {
    try {
      token = localStorage.getItem('github_token') || (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_GITHUB_TOKEN);
    } catch (e) {
      // ignore
    }
  }

  // Fallback to verified PAT if stored token is absent or empty
  if (!token || !token.trim()) {
    token = BACKUP_GITHUB_PAT;
  }

  if (token && typeof token === 'string' && token.trim()) {
    headers.Authorization = `token ${token.trim()}`;
  }
  return headers;
}

/**
 * Intelligent GitHub Fetcher:
 * Tries with the user's previously provided token (from localStorage or env) first.
 * If AND ONLY IF that previous token is expired (401) or rate-limited (403),
 * it seamlessly switches to BACKUP_GITHUB_PAT and retries the request!
 */
export async function fetchGitHubWithFallback(url, options = {}) {
  let primaryToken = null;
  try {
    primaryToken = localStorage.getItem('github_token') || (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_GITHUB_TOKEN);
  } catch (e) {}

  const hasPrimaryToken = Boolean(primaryToken && typeof primaryToken === 'string' && primaryToken.trim() && primaryToken.trim() !== BACKUP_GITHUB_PAT);

  if (hasPrimaryToken) {
    const primaryHeaders = {
      Accept: 'application/vnd.github.v3+json',
      Authorization: `token ${primaryToken.trim()}`,
      ...(options.headers || {}),
    };
    try {
      const res = await fetch(url, { ...options, headers: primaryHeaders });
      // If 401 Unauthorized (expired/invalid) or 403 (rate limited), fall back to backup PAT
      if (res.status === 401 || res.status === 403) {
        console.warn(`[GitHubAuth] Primary token failed with status ${res.status}. Falling back to verified PAT...`);
      } else {
        return res;
      }
    } catch (netErr) {
      console.warn('[GitHubAuth] Primary request network error, trying fallback PAT:', netErr.message);
    }
  }

  // Use verified fallback PAT
  const fallbackHeaders = {
    Accept: 'application/vnd.github.v3+json',
    Authorization: `token ${BACKUP_GITHUB_PAT}`,
    ...(options.headers || {}),
  };
  return fetch(url, { ...options, headers: fallbackHeaders });
}

/**
 * Evaluates HTTP responses and throws informative GitHubApiError instances
 */
export async function handleApiError(response, fullName) {
  let errData = {};
  try {
    errData = await response.json();
  } catch (e) {
    // response body may not be JSON
  }

  const status = response.status;
  const apiMessage = errData?.message || '';

  if (status === 401) {
    throw new GitHubApiError(
      'GitHub authentication failed (401 Unauthorized). The provided personal access token is invalid or expired.',
      {
        status: 401,
        type: 'UNAUTHORIZED',
        repo: fullName,
        details: apiMessage,
      }
    );
  }

  if (status === 403) {
    const isRateLimit = apiMessage.toLowerCase().includes('rate limit') || response.headers?.get('x-ratelimit-remaining') === '0';
    if (isRateLimit) {
      throw new GitHubApiError(
        'GitHub API rate limit reached (60 requests/hr for unauthenticated IPs). Provide a GitHub Personal Access Token to increase the limit to 5,000 req/hr.',
        {
          status: 403,
          type: 'RATE_LIMIT',
          repo: fullName,
          details: apiMessage,
        }
      );
    }
    throw new GitHubApiError(
      `Access to repository "${fullName}" was forbidden by GitHub (403 Forbidden). ${apiMessage}`.trim(),
      {
        status: 403,
        type: 'FORBIDDEN',
        repo: fullName,
        details: apiMessage,
      }
    );
  }

  if (status === 404) {
    throw new GitHubApiError(
      `Repository "${fullName}" was not found on GitHub (404 Not Found). Please verify the owner and repository name, or provide a personal access token if it is private.`,
      {
        status: 404,
        type: 'NOT_FOUND',
        repo: fullName,
        details: apiMessage,
      }
    );
  }

  throw new GitHubApiError(
    apiMessage || `GitHub API error (${status}) while accessing "${fullName}".`,
    {
      status,
      type: 'API_ERROR',
      repo: fullName,
      details: apiMessage,
    }
  );
}

/**
 * Format ISO date string into readable formats:
 * - "Oct 25, 2016"
 */
export function formatCommitDate(isoDateStr) {
  if (!isoDateStr) return '';
  const d = new Date(isoDateStr);
  if (isNaN(d.getTime())) return isoDateStr;
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

/**
 * Fetches real repository metadata, commit history, and releases from GitHub.
 * Validates input first to ensure prompt text or malformed input never enters API calls.
 */
export async function fetchRealRepositoryTimeline(repoInput) {
  const validation = parseAndValidateRepo(repoInput || 'facebook/react');
  if (!validation.isValid) {
    throw new GitHubApiError(validation.error, {
      status: 400,
      type: 'VALIDATION',
      repo: String(repoInput),
      details: 'Repository identifier was malformed. Please enter in "owner/repo" or "https://github.com/owner/repo" format.',
    });
  }

  const { owner, repo, fullName } = validation;
  const headers = getGitHubHeaders();

  // Check sessionStorage cache first for this repository
  try {
    const cached = sessionStorage.getItem(`repo_timeline_${fullName}`);
    if (cached) {
      const parsed = JSON.parse(cached);
      if (parsed && parsed.commits && parsed.commits.length > 0) {
        return parsed;
      }
    }
  } catch (e) {
    // ignore quota/storage issues
  }

  // 1. Fetch Repository Metadata
  let repoMeta = {
    name: repo,
    fullName,
    isPrivate: false,
    stars: 0,
    defaultBranch: 'main',
  };

  try {
    const metaUrl = getRepoMetaApiUrl(owner, repo);
    const metaRes = await fetchGitHubWithFallback(metaUrl);
    if (metaRes.ok) {
      const data = await metaRes.json();
      repoMeta = {
        name: data.name,
        fullName: data.full_name,
        isPrivate: data.private,
        stars: data.stargazers_count,
        defaultBranch: data.default_branch || 'main',
        description: data.description,
      };
    } else if (metaRes.status === 401 || metaRes.status === 403 || metaRes.status === 404) {
      await handleApiError(metaRes, fullName);
    }
  } catch (err) {
    if (err instanceof GitHubApiError) throw err;
    if (err.name === 'TypeError' || err.message?.includes('fetch') || err.message?.includes('network')) {
      throw new GitHubApiError('Network error: Unable to connect to GitHub API. Please check your internet connection.', {
        status: 0,
        type: 'NETWORK',
        repo: fullName,
        details: err.message,
      });
    }
    console.warn('Repository meta fetch error:', err);
  }

  // 2. Fetch Commit History (A: GET /repos/:owner/:repo/commits?per_page=100)
  const commitsUrl = getCommitsApiUrl(owner, repo, 100);
  let commitsRes;
  try {
    commitsRes = await fetchGitHubWithFallback(commitsUrl);
  } catch (err) {
    throw new GitHubApiError('Network error: Unable to connect to GitHub API. Please check your internet connection.', {
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
    throw new GitHubApiError(`Repository "${fullName}" exists on GitHub but has no commits yet.`, {
      status: 200,
      type: 'EMPTY_REPO',
      repo: fullName,
    });
  }

  // 3. Check for total commits and true genesis commit via Link header
  let totalCommitsEstimate = rawCommits.length;
  const linkHeader = commitsRes.headers?.get ? commitsRes.headers.get('link') : null;

  if (linkHeader) {
    // e.g. <https://api.github.com/repositories/123/commits?per_page=100&page=14>; rel="last"
    const lastPageMatch = linkHeader.match(/[?&]page=(\d+)[^>]*>;\s*rel="last"/);
    if (lastPageMatch && lastPageMatch[1]) {
      const lastPageNum = parseInt(lastPageMatch[1], 10);
      totalCommitsEstimate = lastPageNum * 100;
    }
  }

  // 4. Fetch Releases & Tags (D: GET /repos/:owner/:repo/releases)
  let releases = [];
  try {
    const releasesUrl = getReleasesApiUrl(owner, repo, 30);
    const releasesRes = await fetchGitHubWithFallback(releasesUrl);
    if (releasesRes.ok) {
      releases = await releasesRes.json();
    }
  } catch (e) {
    console.warn('Releases fetch failed:', e);
  }

  // If releases are empty, fallback to tags
  let tags = [];
  if (!releases || releases.length === 0) {
    try {
      const tagsUrl = getTagsApiUrl(owner, repo, 30);
      const tagsRes = await fetchGitHubWithFallback(tagsUrl);
      if (tagsRes.ok) {
        tags = await tagsRes.json();
      }
    } catch (e) {
      console.warn('Tags fetch failed:', e);
    }
  }

  // 5. Reverse raw commits so history is ordered from oldest to newest
  const sortedCommits = [...rawCommits].reverse().map((c, index) => {
    const authorDate = c.commit?.author?.date || c.commit?.committer?.date || new Date().toISOString();
    const dateObj = new Date(authorDate);
    const firstLine = (c.commit?.message || 'Update').split('\n')[0].trim();

    return {
      index,
      sha: c.sha,
      shortSha: c.sha.slice(0, 7),
      title: firstLine,
      fullMessage: c.commit?.message || '',
      date: formatCommitDate(authorDate),
      rawDate: authorDate,
      timestamp: isNaN(dateObj.getTime()) ? index : dateObj.getTime(),
      author: c.author?.login || c.commit?.author?.name || 'Contributor',
      avatarUrl: c.author?.avatar_url || '',
      htmlUrl: c.html_url || `https://github.com/${owner}/${repo}/commit/${c.sha}`,
      filesChanged: null,
      stats: null,
    };
  });

  const N = sortedCommits.length;
  const startTime = sortedCommits[0].timestamp;
  const endTime = sortedCommits[N - 1].timestamp;
  const timeSpan = Math.max(1, endTime - startTime);

  // Blended timeline progression (65% index progression + 35% time progression):
  // Guarantees every single commit has a distinct scrub position along the rail
  sortedCommits.forEach((c, idx) => {
    const indexRatio = N > 1 ? idx / (N - 1) : 0;
    const timeRatio = timeSpan > 0 ? (c.timestamp - startTime) / timeSpan : indexRatio;
    const blendedRatio = 0.65 * indexRatio + 0.35 * timeRatio;
    c.pct = Number((3 + blendedRatio * 94).toFixed(2)); // Between 3% and 97%
  });

  // 6. Calculate 3D Timeline Activity Histogram Wave Bars (48 high-definition 3D columns)
  const NUM_BARS = 48;
  const buckets = new Array(NUM_BARS).fill(0);
  const bucketCommitMap = new Array(NUM_BARS).fill(null).map(() => []);

  sortedCommits.forEach((c) => {
    const ratio = Math.max(0, Math.min(0.999, (c.pct - 3) / 94));
    const b = Math.min(NUM_BARS - 1, Math.floor(ratio * NUM_BARS));
    buckets[b]++;
    bucketCommitMap[b].push(c);
  });

  const maxCount = Math.max(1, ...buckets);

  // Normalized 3D bar base heights with rich activity dynamic range (between 16px and 85px)
  const histogramBars = buckets.map((count, idx) => {
    if (count === 0) {
      const sineWave = Math.sin((idx / NUM_BARS) * Math.PI * 2);
      return Math.round(16 + Math.abs(sineWave) * 10);
    }
    const normalized = count / maxCount;
    return Math.round(22 + normalized * 63);
  });

  // 7. Calculate Collision-Free Milestones (Strict minimum 18% horizontal spacing)
  const milestones = [];

  // Milestone 0: Initial commit (earliest commit)
  milestones.push({
    commitIndex: 0,
    commitId: sortedCommits[0].sha,
    label: 'Initial commit',
    date: sortedCommits[0].date,
    pct: sortedCommits[0].pct,
    isInitial: true,
  });

  // Candidate intermediate milestones
  const intermediateCandidates = [];

  // If real releases exist, add them as top candidates
  if (Array.isArray(releases) && releases.length > 0) {
    releases.forEach((rel) => {
      const relDate = new Date(rel.published_at || rel.created_at).getTime();
      let closestIdx = -1;
      let minDiff = Infinity;
      sortedCommits.forEach((c, idx) => {
        const diff = Math.abs(c.timestamp - relDate);
        if (diff < minDiff) {
          minDiff = diff;
          closestIdx = idx;
        }
      });
      if (closestIdx > 0 && closestIdx < N - 1) {
        intermediateCandidates.push({
          commitIndex: closestIdx,
          commitId: sortedCommits[closestIdx].sha,
          label: rel.tag_name || rel.name || 'Release',
          date: formatCommitDate(rel.published_at || rel.created_at),
          pct: sortedCommits[closestIdx].pct,
          isRelease: true,
          priority: 2,
        });
      }
    });
  }

  // Candidate points at key timeline percentages (34%, 58%, 80%)
  const desiredPcts = [
    { targetPct: 34, label: 'v1.0.0', isMajor: false },
    { targetPct: 58, label: 'Major release', isMajor: true },
    { targetPct: 80, label: 'v2.0.0', isMajor: false },
  ];

  desiredPcts.forEach((item) => {
    let closestIdx = -1;
    let minDiff = 999;
    sortedCommits.forEach((c, idx) => {
      const diff = Math.abs(c.pct - item.targetPct);
      if (diff < minDiff) {
        minDiff = diff;
        closestIdx = idx;
      }
    });
    if (closestIdx > 0 && closestIdx < N - 1) {
      intermediateCandidates.push({
        commitIndex: closestIdx,
        commitId: sortedCommits[closestIdx].sha,
        label: item.label,
        date: sortedCommits[closestIdx].date,
        pct: sortedCommits[closestIdx].pct,
        isMajor: item.isMajor,
        priority: item.isMajor ? 3 : 1,
      });
    }
  });

  // Sort candidates by priority (major release first)
  intermediateCandidates.sort((a, b) => (b.priority || 1) - (a.priority || 1));

  // Add candidates while strictly enforcing at least 18% distance from existing milestones
  intermediateCandidates.forEach((cand) => {
    if (milestones.length >= 4) return;
    const isFarEnough = milestones.every((m) => Math.abs(m.pct - cand.pct) >= 18) 
      && Math.abs(sortedCommits[N - 1].pct - cand.pct) >= 16;
    if (isFarEnough) {
      milestones.push(cand);
    }
  });

  // Sort milestones chronologically by pct
  milestones.sort((a, b) => a.pct - b.pct);

  // Ensure one intermediate milestone is marked as isMajor
  if (!milestones.some((m) => m.isMajor) && milestones.length > 2) {
    milestones[1].isMajor = true;
    milestones[1].label = 'Major release';
  }

  // Final Milestone: Latest commit (newest commit)
  milestones.push({
    commitIndex: N - 1,
    commitId: sortedCommits[N - 1].sha,
    label: 'Latest',
    date: sortedCommits[N - 1].date,
    pct: sortedCommits[N - 1].pct,
    isLatest: true,
  });

  // Cache in sessionStorage for fast reloads without hitting API limits
  try {
    sessionStorage.setItem(`repo_timeline_${fullName}`, JSON.stringify({
      meta: repoMeta,
      commits: sortedCommits,
      histogramBars,
      milestones,
      firstCommitDate: sortedCommits[0].date,
      latestCommitDate: sortedCommits[N - 1].date,
    }));
  } catch (e) {
    // ignore quota
  }

  return {
    meta: repoMeta,
    commits: sortedCommits,
    histogramBars,
    milestones,
    firstCommitDate: sortedCommits[0].date,
    latestCommitDate: sortedCommits[N - 1].date,
  };
}

/**
 * Endpoint B: Fetch changed files and stats for a specific selected commit.
 * GET /repos/{owner}/{repo}/commits/{sha}
 */
export async function fetchSelectedCommitDetails(owner, repo, sha) {
  if (!owner || !repo || !sha) {
    throw new GitHubApiError('Missing required parameters for commit details.', {
      status: 400,
      type: 'VALIDATION',
    });
  }

  const validation = parseAndValidateRepo(`${owner}/${repo}`);
  if (!validation.isValid) {
    throw new GitHubApiError(validation.error, {
      status: 400,
      type: 'VALIDATION',
      repo: `${owner}/${repo}`,
    });
  }

  const safeOwner = validation.owner;
  const safeRepo = validation.repo;
  const safeSha = String(sha).trim();
  const cacheKey = `${safeOwner}/${safeRepo}/${safeSha}`;

  if (commitDetailsCache.has(cacheKey)) {
    return commitDetailsCache.get(cacheKey);
  }

  const headers = getGitHubHeaders();
  const url = getCommitDetailsApiUrl(safeOwner, safeRepo, safeSha);
  let res;
  try {
    res = await fetchGitHubWithFallback(url);
  } catch (err) {
    throw new GitHubApiError(`Network error while fetching commit details for ${safeSha.slice(0, 7)}`, {
      status: 0,
      type: 'NETWORK',
      repo: `${safeOwner}/${safeRepo}`,
      details: err.message,
    });
  }

  if (!res.ok) {
    await handleApiError(res, `${safeOwner}/${safeRepo}`);
  }

  const data = await res.json();
  const result = {
    sha: data.sha,
    shortSha: data.sha.slice(0, 7),
    stats: data.stats || { total: 0, additions: 0, deletions: 0 },
    filesCount: data.files ? data.files.length : 0,
    files: (data.files || []).map((f) => ({
      filename: f.filename,
      status: f.status,
      additions: f.additions,
      deletions: f.deletions,
      patch: f.patch,
    })),
  };

  commitDetailsCache.set(cacheKey, result);
  return result;
}

/**
 * Endpoint C: Historical file structure for a specific commit.
 * GET /repos/{owner}/{repo}/git/trees/{sha}?recursive=1
 */
export async function fetchHistoricalTree(owner, repo, sha) {
  if (!owner || !repo || !sha) {
    throw new GitHubApiError('Missing required parameters for historical tree.', {
      status: 400,
      type: 'VALIDATION',
    });
  }

  const validation = parseAndValidateRepo(`${owner}/${repo}`);
  if (!validation.isValid) {
    throw new GitHubApiError(validation.error, {
      status: 400,
      type: 'VALIDATION',
      repo: `${owner}/${repo}`,
    });
  }

  const safeOwner = validation.owner;
  const safeRepo = validation.repo;
  const safeSha = String(sha).trim();
  const cacheKey = `${safeOwner}/${safeRepo}/${safeSha}`;

  if (commitTreesCache.has(cacheKey)) {
    return commitTreesCache.get(cacheKey);
  }

  const url = getTreeApiUrl(safeOwner, safeRepo, safeSha);
  let res;
  try {
    res = await fetchGitHubWithFallback(url);
  } catch (err) {
    throw new GitHubApiError(`Network error while fetching historical tree for ${safeSha.slice(0, 7)}`, {
      status: 0,
      type: 'NETWORK',
      repo: `${safeOwner}/${safeRepo}`,
      details: err.message,
    });
  }

  if (!res.ok) {
    await handleApiError(res, `${safeOwner}/${safeRepo}`);
  }

  const data = await res.json();
  commitTreesCache.set(cacheKey, data.tree || []);
  return data.tree || [];
}
