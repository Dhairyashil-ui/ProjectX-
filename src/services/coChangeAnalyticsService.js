// Service for GitStory Explore Code: Real GitHub Repository Co-Change Analytics & Graph Explorer
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
import { parseFilePath } from './collaboratorAnalyticsService.js';

// In-memory caches for computed co-change graphs and commit details
const coChangeAnalyticsCache = new Map();
const commitFilesBatchCache = new Map();

/**
 * Normalizes and extracts file changes from a commit details payload.
 * Excludes binary files or non-source assets if needed, and normalizes file paths.
 */
export function extractFilesFromCommit(commitDetail) {
  if (!commitDetail || !Array.isArray(commitDetail.files)) {
    return [];
  }

  return commitDetail.files
    .filter((f) => f && f.filename)
    .map((f) => {
      const parsed = parseFilePath(f.filename);
      return {
        filename: f.filename,
        baseName: parsed.filename,
        directory: parsed.fullDir,
        status: f.status || 'modified',
        additions: f.additions || 0,
        deletions: f.deletions || 0,
        changes: f.changes || (f.additions || 0) + (f.deletions || 0),
        previousFilename: f.previous_filename || null,
      };
    });
}

/**
 * Generates all unordered unique pairs (A, B) where A < B from an array of items.
 */
export function generatePairs(items) {
  const pairs = [];
  const len = items.length;
  for (let i = 0; i < len; i++) {
    for (let j = i + 1; j < len; j++) {
      const a = items[i];
      const b = items[j];
      if (a < b) {
        pairs.push([a, b]);
      } else {
        pairs.push([b, a]);
      }
    }
  }
  return pairs;
}

/**
 * Calculates Jaccard similarity: |A ∩ B| / |A ∪ B|
 * where A ∪ B = countA + countB - sharedCount
 */
export function calculateJaccardSimilarity(countA, countB, sharedCount) {
  const union = countA + countB - sharedCount;
  if (union <= 0) return 0;
  return Number((sharedCount / union).toFixed(3));
}

/**
 * Fast community detection / cluster detection algorithm for file co-change networks.
 * Uses connected components and modular label propagation on edges above minimum similarity.
 */
export function detectChangeClusters(nodes, edges, minSimilarity = 0.15) {
  if (!Array.isArray(nodes) || nodes.length === 0) return [];

  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const adj = new Map();

  for (const n of nodes) {
    adj.set(n.id, []);
  }

  // Filter edges meeting min similarity threshold
  for (const edge of edges) {
    if (edge.jaccard >= minSimilarity || edge.sharedCommits >= 2) {
      if (adj.has(edge.source) && adj.has(edge.target)) {
        adj.get(edge.source).push({ target: edge.target, weight: edge.jaccard || (edge.sharedCommits * 0.1) });
        adj.get(edge.target).push({ target: edge.source, weight: edge.jaccard || (edge.sharedCommits * 0.1) });
      }
    }
  }

  // Label propagation clustering
  const labels = new Map();
  nodes.forEach((n, idx) => {
    labels.set(n.id, idx);
  });

  const nodeIds = nodes.map((n) => n.id);
  const maxIterations = 8;

  for (let iter = 0; iter < maxIterations; iter++) {
    let changed = false;
    // Shuffle node order for unbiased propagation
    for (let i = nodeIds.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [nodeIds[i], nodeIds[j]] = [nodeIds[j], nodeIds[i]];
    }

    for (const id of nodeIds) {
      const neighbors = adj.get(id) || [];
      if (neighbors.length === 0) continue;

      const labelWeights = new Map();
      for (const edge of neighbors) {
        const neighborLabel = labels.get(edge.target);
        const currentWeight = labelWeights.get(neighborLabel) || 0;
        labelWeights.set(neighborLabel, currentWeight + edge.weight);
      }

      let maxWeight = -1;
      let bestLabel = labels.get(id);

      for (const [lbl, weight] of labelWeights.entries()) {
        if (weight > maxWeight) {
          maxWeight = weight;
          bestLabel = lbl;
        }
      }

      if (bestLabel !== labels.get(id)) {
        labels.set(id, bestLabel);
        changed = true;
      }
    }

    if (!changed) break;
  }

  // Group nodes by label
  const clusterGroups = new Map();
  for (const [id, label] of labels.entries()) {
    if (!clusterGroups.has(label)) {
      clusterGroups.set(label, []);
    }
    clusterGroups.get(label).push(nodeMap.get(id));
  }

  // Filter out singleton clusters and construct rich cluster metadata
  const clusters = [];
  let clusterIndex = 1;

  for (const group of clusterGroups.values()) {
    if (group.length < 2) continue; // singletons are not meaningful clusters

    const fileIds = new Set(group.map((n) => n.id));
    const directoriesSet = new Set(group.map((n) => n.directory));
    const contributorsSet = new Set();
    const clusterCommitsMap = new Map();
    let totalClusterActivity = 0;

    for (const node of group) {
      totalClusterActivity += node.uniqueCommits;
      for (const c of node.contributors) {
        contributorsSet.add(c);
      }
      for (const commit of node.commits || []) {
        if (!clusterCommitsMap.has(commit.sha)) {
          clusterCommitsMap.set(commit.sha, commit);
        }
      }
    }

    // Determine cluster name from common directory or dominant module
    const dirArray = Array.from(directoriesSet);
    let clusterName = `Cluster ${clusterIndex}`;
    if (dirArray.length === 1 && dirArray[0] !== '(root)') {
      clusterName = `${dirArray[0]} Module`;
    } else if (dirArray.length > 1) {
      // Find common prefix if any
      const firstDir = dirArray[0].split('/')[0];
      const allSharePrefix = dirArray.every((d) => d.startsWith(firstDir));
      if (allSharePrefix) {
        clusterName = `${firstDir} Suite (${dirArray.length} dirs)`;
      } else {
        clusterName = `Cross-Module: ${dirArray[0].split('/')[0]} + ${dirArray[1].split('/')[0]}`;
      }
    } else {
      clusterName = `Core Architecture (${group[0].baseName}...)`;
    }

    // Co-change edges within this cluster
    const internalEdges = edges.filter(
      (e) => fileIds.has(e.source) && fileIds.has(e.target)
    );

    const isCrossModule = dirArray.length > 1;

    clusters.push({
      id: `cluster-${clusterIndex}`,
      name: clusterName,
      colorIndex: clusterIndex % 8,
      size: group.length,
      files: group.map((n) => n.id),
      nodes: group,
      directories: dirArray,
      isCrossModule,
      contributorsCount: contributorsSet.size,
      contributors: Array.from(contributorsSet),
      totalCommitsCount: clusterCommitsMap.size,
      supportingCommits: Array.from(clusterCommitsMap.values()),
      internalEdgesCount: internalEdges.length,
      averageCoChangeFrequency: internalEdges.length > 0 
        ? Number((internalEdges.reduce((acc, e) => acc + e.sharedCommits, 0) / internalEdges.length).toFixed(1))
        : 0,
    });

    clusterIndex++;
  }

  // Sort by cluster size descending
  return clusters.sort((a, b) => b.size - a.size);
}

/**
 * Fetches commits, analyzes changed files, builds co-change matrix,
 * identifies clusters, and returns full graph model.
 */
export async function fetchCoChangeAnalytics(repoInput, options = {}) {
  const {
    maxCommits = 100,
    maxDetailsToFetch = 40,
    maxFilesPerCommitThreshold = 35, // Commits touching > 35 files are flagged as mass-updates
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
  const cacheKey = `cochange_analytics_${fullName}_${maxCommits}_${maxDetailsToFetch}_${maxFilesPerCommitThreshold}`;

  // In-memory or sessionStorage check
  if (!forceRefresh) {
    if (coChangeAnalyticsCache.has(cacheKey)) {
      return coChangeAnalyticsCache.get(cacheKey);
    }
    try {
      const cached = sessionStorage.getItem(cacheKey);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (parsed && parsed.nodes && parsed.nodes.length > 0) {
          coChangeAnalyticsCache.set(cacheKey, parsed);
          return parsed;
        }
      }
    } catch (e) {
      // ignore
    }
  }

  const headers = getGitHubHeaders();

  if (onProgress) onProgress({ phase: 'fetching_commits', loaded: 0, total: maxCommits });

  // 1. Fetch paginated commits (GET /repos/{owner}/{repo}/commits?per_page=100)
  const commitsUrl = getCommitsApiUrl(owner, repo, Math.min(100, maxCommits));
  let commitsRes;
  try {
    commitsRes = await fetchGitHubWithFallback(commitsUrl);
  } catch (err) {
    throw new GitHubApiError('Network connection error while fetching commits for code analysis.', {
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

  // 2. Concurrently fetch commit details in controlled batches
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
      const detailCacheKey = `cochange_detail_${fullName}_${c.sha}`;
      if (commitFilesBatchCache.has(detailCacheKey)) {
        return { sha: c.sha, details: commitFilesBatchCache.get(detailCacheKey) };
      }

      try {
        const detailUrl = getCommitDetailsApiUrl(owner, repo, c.sha);
        const res = await fetchGitHubWithFallback(detailUrl);
        if (res.ok) {
          const data = await res.json();
          const files = extractFilesFromCommit(data);
          const detailObj = {
            sha: c.sha,
            stats: data.stats || { total: 0, additions: 0, deletions: 0 },
            files,
            filesCount: files.length,
          };
          commitFilesBatchCache.set(detailCacheKey, detailObj);
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
      phase: 'building_graph',
      loaded: rawCommits.length,
      total: rawCommits.length,
    });
  }

  // 3. Process commit files and build per-file and per-pair maps
  const fileNodesMap = new Map();
  // key: "fileA::fileB" -> { source, target, sharedCommits, commits: [], isCrossDirectory }
  const pairCoChangeMap = new Map();

  const broadCommitsList = [];
  const validCommitsAnalyzed = [];

  for (const c of rawCommits) {
    const detail = detailedCommitsMap.get(c.sha);
    const files = detail?.files || [];
    const authorName = c.author?.login || c.commit?.author?.name || 'Contributor';
    const authorAvatar = c.author?.avatar_url || '';
    const authorDate = c.commit?.author?.date || c.commit?.committer?.date || new Date().toISOString();
    const commitMsg = (c.commit?.message || '').split('\n')[0].trim();

    const commitInfo = {
      sha: c.sha,
      shortSha: c.sha.slice(0, 7),
      message: commitMsg,
      author: authorName,
      avatarUrl: authorAvatar,
      date: authorDate,
      htmlUrl: c.html_url || `https://github.com/${owner}/${repo}/commit/${c.sha}`,
      filesCount: files.length,
      additions: detail?.stats?.additions || 0,
      deletions: detail?.stats?.deletions || 0,
      isMerge: Array.isArray(c.parents) && c.parents.length > 1,
    };

    // Flag mass updates (e.g. repo-wide linting, formatting, or lockfile updates)
    if (files.length > maxFilesPerCommitThreshold) {
      broadCommitsList.push({
        ...commitInfo,
        reason: `Touched ${files.length} files (exceeds threshold of ${maxFilesPerCommitThreshold})`,
      });
      // Skip mass commits from polluting pair relationships, or keep note
      continue;
    }

    validCommitsAnalyzed.push(commitInfo);

    const changedFilenamesInCommit = files.map((f) => f.filename);

    // Update individual file activity stats
    for (const file of files) {
      if (!fileNodesMap.has(file.filename)) {
        fileNodesMap.set(file.filename, {
          id: file.filename,
          filename: file.filename,
          baseName: file.baseName,
          directory: file.directory,
          extension: file.baseName.includes('.') ? file.baseName.split('.').pop() : 'file',
          uniqueCommits: 0,
          contributorsMap: new Map(),
          additions: 0,
          deletions: 0,
          firstDate: authorDate,
          latestDate: authorDate,
          commits: [],
          coChangedFilesMap: new Map(), // otherFile -> sharedCount
        });
      }

      const fileNode = fileNodesMap.get(file.filename);
      fileNode.uniqueCommits++;
      fileNode.additions += file.additions;
      fileNode.deletions += file.deletions;
      fileNode.commits.push(commitInfo);

      const prevContribCount = fileNode.contributorsMap.get(authorName) || 0;
      fileNode.contributorsMap.set(authorName, prevContribCount + 1);

      if (new Date(authorDate) < new Date(fileNode.firstDate)) {
        fileNode.firstDate = authorDate;
      }
      if (new Date(authorDate) > new Date(fileNode.latestDate)) {
        fileNode.latestDate = authorDate;
      }
    }

    // Generate co-change pairs if 2 or more files changed in this commit
    if (changedFilenamesInCommit.length >= 2) {
      const pairs = generatePairs(changedFilenamesInCommit);

      for (const [fileA, fileB] of pairs) {
        const pairKey = `${fileA}::${fileB}`;

        if (!pairCoChangeMap.has(pairKey)) {
          const dirA = fileNodesMap.get(fileA)?.directory || '';
          const dirB = fileNodesMap.get(fileB)?.directory || '';
          const isCrossDirectory = dirA !== dirB;

          pairCoChangeMap.set(pairKey, {
            id: pairKey,
            source: fileA,
            target: fileB,
            sharedCommits: 0,
            commits: [],
            isCrossDirectory,
          });
        }

        const pairData = pairCoChangeMap.get(pairKey);
        pairData.sharedCommits++;
        pairData.commits.push(commitInfo);

        // Update mutual co-change link on individual file nodes
        const nodeA = fileNodesMap.get(fileA);
        const nodeB = fileNodesMap.get(fileB);
        if (nodeA) nodeA.coChangedFilesMap.set(fileB, (nodeA.coChangedFilesMap.get(fileB) || 0) + 1);
        if (nodeB) nodeB.coChangedFilesMap.set(fileA, (nodeB.coChangedFilesMap.get(fileA) || 0) + 1);
      }
    }
  }

  // 4. Construct Nodes Array
  const nodes = Array.from(fileNodesMap.values()).map((n) => {
    const contributors = Array.from(n.contributorsMap.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);

    const topCoChanged = Array.from(n.coChangedFilesMap.entries())
      .map(([otherFile, sharedCommits]) => {
        const otherNode = fileNodesMap.get(otherFile);
        const otherCount = otherNode ? otherNode.uniqueCommits : 1;
        const jaccard = calculateJaccardSimilarity(n.uniqueCommits, otherCount, sharedCommits);
        return {
          filename: otherFile,
          baseName: otherNode?.baseName || otherFile.split('/').pop(),
          directory: otherNode?.directory || '',
          sharedCommits,
          jaccard,
        };
      })
      .sort((a, b) => b.sharedCommits - a.sharedCommits);

    return {
      id: n.id,
      filename: n.filename,
      baseName: n.baseName,
      directory: n.directory,
      extension: n.extension,
      uniqueCommits: n.uniqueCommits,
      contributorsCount: contributors.length,
      contributors: contributors.map((c) => c.name),
      contributorsBreakdown: contributors,
      additions: n.additions,
      deletions: n.deletions,
      firstDate: n.firstDate,
      latestDate: n.latestDate,
      topCoChanged,
      commits: n.commits,
      cluster: null, // assigned during clustering
    };
  }).sort((a, b) => b.uniqueCommits - a.uniqueCommits);

  // 5. Construct Edges Array with Jaccard Similarities
  const edges = Array.from(pairCoChangeMap.values()).map((p) => {
    const nodeA = fileNodesMap.get(p.source);
    const nodeB = fileNodesMap.get(p.target);
    const countA = nodeA ? nodeA.uniqueCommits : p.sharedCommits;
    const countB = nodeB ? nodeB.uniqueCommits : p.sharedCommits;

    const jaccard = calculateJaccardSimilarity(countA, countB, p.sharedCommits);

    return {
      id: p.id,
      source: p.source,
      target: p.target,
      sharedCommits: p.sharedCommits,
      jaccard,
      confidenceAtoB: Number((p.sharedCommits / countA).toFixed(2)),
      confidenceBtoA: Number((p.sharedCommits / countB).toFixed(2)),
      isCrossDirectory: p.isCrossDirectory,
      commits: p.commits,
    };
  }).sort((a, b) => b.sharedCommits - a.sharedCommits);

  // 6. Detect Change Clusters using label propagation
  const clusters = detectChangeClusters(nodes, edges, 0.12);

  // Assign cluster IDs to nodes
  const nodeClusterMap = new Map();
  for (const cluster of clusters) {
    for (const f of cluster.files) {
      nodeClusterMap.set(f, cluster.id);
    }
  }

  for (const node of nodes) {
    node.cluster = nodeClusterMap.get(node.id) || null;
  }

  // 7. Calculate Repository-Level Co-Change Summary
  const crossDirectoryEdgesCount = edges.filter((e) => e.isCrossDirectory).length;
  const crossDirectoryPct = edges.length > 0 
    ? Number(((crossDirectoryEdgesCount / edges.length) * 100).toFixed(1)) 
    : 0;

  const result = {
    repo: fullName,
    owner,
    repoName: repo,
    analyzedCommitsCount: rawCommits.length,
    detailedCommitsCount: detailedCommitsMap.size,
    broadCommitsCount: broadCommitsList.length,
    broadCommits: broadCommitsList,
    nodesCount: nodes.length,
    edgesCount: edges.length,
    clustersCount: clusters.length,
    crossDirectoryEdgesCount,
    crossDirectoryPct,
    nodes,
    edges,
    clusters,
    coChangeAssociationDisclaimer: 'Co-change associations reflect historical commit co-occurrence and do not represent proven code imports, build dependencies, or causal relationships.',
  };

  // Cache in memory and sessionStorage
  coChangeAnalyticsCache.set(cacheKey, result);
  try {
    sessionStorage.setItem(cacheKey, JSON.stringify(result));
  } catch (e) {
    // ignore
  }

  return result;
}

/**
 * Filter graph data dynamically based on UI selections (directory, minSharedCommits, search, cluster).
 */
export function filterCoChangeGraph(graphData, filters = {}) {
  if (!graphData || !graphData.nodes) return null;

  const {
    directory = 'all',
    minSharedCommits = 1,
    minJaccard = 0,
    searchQuery = '',
    selectedClusterId = 'all',
    excludeCrossDirectory = false,
  } = filters;

  const normalizedQuery = (searchQuery || '').trim().toLowerCase();

  // 1. Filter Nodes
  const filteredNodes = graphData.nodes.filter((node) => {
    if (directory !== 'all' && node.directory !== directory && !node.directory.startsWith(`${directory}/`)) {
      return false;
    }
    if (selectedClusterId !== 'all' && node.cluster !== selectedClusterId) {
      return false;
    }
    if (normalizedQuery && !node.filename.toLowerCase().includes(normalizedQuery) && !node.baseName.toLowerCase().includes(normalizedQuery)) {
      return false;
    }
    return true;
  });

  const nodeIdsSet = new Set(filteredNodes.map((n) => n.id));

  // 2. Filter Edges
  const filteredEdges = graphData.edges.filter((edge) => {
    if (!nodeIdsSet.has(edge.source) || !nodeIdsSet.has(edge.target)) {
      return false;
    }
    if (edge.sharedCommits < minSharedCommits) {
      return false;
    }
    if (edge.jaccard < minJaccard) {
      return false;
    }
    if (excludeCrossDirectory && edge.isCrossDirectory) {
      return false;
    }
    return true;
  });

  // 3. Filter Clusters matching current nodes
  const filteredClusters = graphData.clusters.map((cluster) => {
    const activeClusterFiles = cluster.files.filter((f) => nodeIdsSet.has(f));
    return {
      ...cluster,
      activeFilesCount: activeClusterFiles.length,
    };
  }).filter((c) => c.activeFilesCount > 0);

  return {
    ...graphData,
    nodes: filteredNodes,
    edges: filteredEdges,
    clusters: filteredClusters,
    filteredNodesCount: filteredNodes.length,
    filteredEdgesCount: filteredEdges.length,
  };
}
