import { config } from './config.js';

export class GitHubApiError extends Error {
  constructor(message, status = 500, code = 'API_ERROR', details = null) {
    super(message);
    this.name = 'GitHubApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/**
 * Validates and normalizes repo input.
 * Accepts: 'facebook/react', 'https://github.com/facebook/react', 'facebook/react/'
 * Rejects instruction text or invalid characters.
 */
export function parseAndValidateRepo(repoInput) {
  if (!repoInput || typeof repoInput !== 'string') {
    throw new GitHubApiError('Repository identifier is required.', 400, 'VALIDATION_ERROR');
  }

  let cleaned = repoInput.trim();
  cleaned = cleaned.replace(/^https?:\/\/github\.com\//i, '');
  cleaned = cleaned.replace(/\.git$/i, '');
  cleaned = cleaned.replace(/\/+$/, '');

  const segments = cleaned.split('/').map(s => s.trim()).filter(Boolean);
  if (segments.length !== 2) {
    throw new GitHubApiError(
      `Invalid repository format "${repoInput}". Please enter "owner/repo" or "https://github.com/owner/repo".`,
      400,
      'VALIDATION_ERROR'
    );
  }

  const [owner, repo] = segments;
  const ownerRegex = /^[a-zA-Z0-9][a-zA-Z0-9-]{0,38}$/;
  const repoRegex = /^[a-zA-Z0-9_.-]{1,100}$/;

  if (!ownerRegex.test(owner) || !repoRegex.test(repo)) {
    throw new GitHubApiError(
      `Invalid repository identifier "${owner}/${repo}". Valid GitHub owners and repo names must contain only alphanumeric characters, dashes, dots, or underscores.`,
      400,
      'VALIDATION_ERROR'
    );
  }

  return {
    owner,
    repo,
    fullName: `${owner}/${repo}`,
  };
}

// ============================================================================
// Centralized Authentication State, Caching & Concurrency Control
// ============================================================================

let cachedAuthStatus = null;
let isTokenMarkedInvalid = false;

// Multi-tiered in-memory cache:
// Key -> { data, etag, expiresAt, isImmutable }
const memoryCache = new Map();

// In-flight promise pool to deduplicate simultaneous requests
const inFlightRequests = new Map();

/**
 * Validates the configured server GITHUB_TOKEN against GET /user.
 * Never leaks the token string in logs or returned objects.
 */
export async function validateConfiguredToken(forceRefresh = false) {
  const token = (config.GITHUB?.TOKEN || process.env.GITHUB_TOKEN || '').trim();

  if (!token) {
    cachedAuthStatus = {
      configured: false,
      isValid: false,
      mode: 'unauthenticated',
      message: 'No server GITHUB_TOKEN configured. Operating in public anonymous mode (60 requests/hr).',
      rateLimit: await getQuickRateLimit(null),
      checkedAt: Date.now(),
    };
    return cachedAuthStatus;
  }

  // Use cached auth status if recent (within 5 minutes)
  if (!forceRefresh && cachedAuthStatus && Date.now() - cachedAuthStatus.checkedAt < 5 * 60 * 1000) {
    return cachedAuthStatus;
  }

  if (isTokenMarkedInvalid && !forceRefresh) {
    return {
      configured: true,
      isValid: false,
      mode: 'invalid_token',
      error: 'The configured GITHUB_TOKEN failed authentication (401 Bad Credentials). Please update GITHUB_TOKEN in your .env file.',
      code: 'INVALID_TOKEN',
      checkedAt: cachedAuthStatus?.checkedAt || Date.now(),
    };
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const res = await fetch('https://api.github.com/user', {
      headers: {
        'Accept': 'application/vnd.github.v3+json',
        'Authorization': `token ${token}`,
        'User-Agent': 'GitStory-AI-Server/1.0',
      },
      signal: controller.signal,
    });
    clearTimeout(timeout);

    const limit = parseInt(res.headers.get('x-ratelimit-limit') || '5000', 10);
    const remaining = parseInt(res.headers.get('x-ratelimit-remaining') || '5000', 10);
    const reset = parseInt(res.headers.get('x-ratelimit-reset') || '0', 10);
    const resetDate = reset ? new Date(reset * 1000).toLocaleTimeString() : 'N/A';

    if (res.ok) {
      const data = await res.json();
      isTokenMarkedInvalid = false;
      cachedAuthStatus = {
        configured: true,
        isValid: true,
        mode: 'authenticated',
        username: data.login,
        name: data.name || data.login,
        avatarUrl: data.avatar_url,
        rateLimit: {
          limit,
          remaining,
          reset,
          resetDate,
          used: limit - remaining,
        },
        checkedAt: Date.now(),
      };
      return cachedAuthStatus;
    }

    if (res.status === 401) {
      isTokenMarkedInvalid = true;
      cachedAuthStatus = {
        configured: true,
        isValid: false,
        mode: 'invalid_token',
        error: 'Configured GITHUB_TOKEN is invalid or expired. Check your .env file.',
        code: 'INVALID_TOKEN',
        checkedAt: Date.now(),
      };
      return cachedAuthStatus;
    }

    cachedAuthStatus = {
      configured: true,
      isValid: false,
      mode: 'error',
      status: res.status,
      error: `GitHub user validation returned HTTP status ${res.status}.`,
      checkedAt: Date.now(),
    };
    return cachedAuthStatus;
  } catch (err) {
    return {
      configured: true,
      isValid: null,
      mode: 'network_error',
      error: `Network failure connecting to GitHub: ${err.message}`,
      checkedAt: Date.now(),
    };
  }
}

/**
 * Returns rate limit information from GitHub
 */
async function getQuickRateLimit(token) {
  try {
    const headers = {
      'Accept': 'application/vnd.github.v3+json',
      'User-Agent': 'GitStory-AI-Server/1.0',
    };
    if (token) {
      headers['Authorization'] = `token ${token}`;
    }
    const res = await fetch('https://api.github.com/rate_limit', { headers });
    if (res.ok) {
      const data = await res.json();
      const core = data?.resources?.core;
      if (core) {
        return {
          limit: core.limit,
          remaining: core.remaining,
          used: core.used,
          reset: core.reset,
          resetDate: new Date(core.reset * 1000).toLocaleTimeString(),
        };
      }
    }
  } catch {
    // fallback
  }
  return null;
}

/**
 * Concurrency limiter utility for batching requests (e.g. max 4 at a time)
 */
export async function limitConcurrency(items, limit = 4, fn = async () => {}) {
  const results = [];
  const executing = [];

  for (const item of items) {
    const p = Promise.resolve().then(() => fn(item));
    results.push(p);

    if (limit <= items.length) {
      const e = p.then(() => executing.splice(executing.indexOf(e), 1));
      executing.push(e);
      if (executing.length >= limit) {
        await Promise.race(executing);
      }
    }
  }

  return Promise.all(results);
}

/**
 * Centralized GitHub Request Handler with:
 * 1. Server-side token authentication
 * 2. In-memory TTL & immutable caching
 * 3. ETag conditional requests (304 Not Modified)
 * 4. In-flight request deduplication
 * 5. Bounded backoff for transient issues and rate-limit parsing
 */
async function requestGithub(url, { ttlMs = 10 * 60 * 1000, isImmutable = false } = {}) {
  const cacheKey = url;
  const now = Date.now();

  const token = (config.GITHUB?.TOKEN || process.env.GITHUB_TOKEN || '').trim();

  // If token is known to be invalid, throw immediately without creating in-flight promises or retrying
  if (token && isTokenMarkedInvalid) {
    throw new GitHubApiError(
      'Configured GITHUB_TOKEN on the server is invalid or expired. Update .env to restore authenticated access.',
      401,
      'INVALID_TOKEN'
    );
  }

  // 1. Check in-memory cache
  if (memoryCache.has(cacheKey)) {
    const entry = memoryCache.get(cacheKey);
    // If immutable (e.g. specific commit SHA or tree SHA) or within TTL, return immediately
    if (entry.isImmutable || entry.expiresAt > now) {
      return entry.data;
    }
  }

  // 2. Request deduplication
  if (inFlightRequests.has(cacheKey)) {
    return inFlightRequests.get(cacheKey);
  }

  const promise = (async () => {
    try {
      const headers = {
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'GitStory-AI-Server/1.0',
      };

      if (token && !isTokenMarkedInvalid) {
        headers['Authorization'] = `token ${token}`;
      }

      // If we have an existing cached entry with an ETag, use conditional request
      const cached = memoryCache.get(cacheKey);
      if (cached && cached.etag) {
        headers['If-None-Match'] = cached.etag;
      }

      // Perform fetch with timeout
      let response;
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15000);
        response = await fetch(url, {
          headers,
          signal: controller.signal,
        });
        clearTimeout(timeout);
      } catch (err) {
        if (err.name === 'AbortError') {
          throw new GitHubApiError('GitHub request timed out after 15s.', 408, 'TIMEOUT');
        }
        throw new GitHubApiError(`Network failure while contacting GitHub: ${err.message}`, 503, 'NETWORK_ERROR');
      }

      // Handle 304 Not Modified (Save rate limit completely)
      if (response.status === 304 && cached) {
        cached.expiresAt = now + ttlMs;
        return cached.data;
      }

      // Rate limit headers
      const remaining = response.headers.get('x-ratelimit-remaining');
      const resetTime = response.headers.get('x-ratelimit-reset');
      const resetDate = resetTime ? new Date(parseInt(resetTime, 10) * 1000).toLocaleTimeString() : 'in an hour';

      // Update cached rate limit if available
      if (cachedAuthStatus && remaining !== null) {
        cachedAuthStatus.rateLimit = {
          limit: parseInt(response.headers.get('x-ratelimit-limit') || '5000', 10),
          remaining: parseInt(remaining, 10),
          reset: parseInt(resetTime || '0', 10),
          resetDate,
        };
      }

      // Handle 401 Unauthorized
      if (response.status === 401) {
        if (token) {
          isTokenMarkedInvalid = true;
          console.error('[GitHubAuth] Server GITHUB_TOKEN failed with 401 Bad Credentials.');
        }
        throw new GitHubApiError(
          'GitHub API authentication failed (401 Unauthorized). The server personal access token is invalid or expired.',
          401,
          'INVALID_TOKEN'
        );
      }

      // Handle 403 / 429
      if (response.status === 403 || response.status === 429) {
        let errBody = null;
        try {
          errBody = await response.json();
        } catch {}

        const msg = (errBody?.message || '').toLowerCase();
        const isRateLimit = remaining === '0' || msg.includes('rate limit');
        const retryAfter = response.headers.get('retry-after');

        if (retryAfter && parseInt(retryAfter, 10) <= 3) {
          // Bounded backoff for transient secondary limit
          await new Promise(r => setTimeout(r, parseInt(retryAfter, 10) * 1000));
          return requestGithub(url, { ttlMs, isImmutable });
        }

        if (isRateLimit) {
          throw new GitHubApiError(
            `GitHub API rate limit exceeded. Reset occurs at ${resetDate}.`,
            403,
            'RATE_LIMIT',
            { resetDate, remaining: 0 }
          );
        }

        throw new GitHubApiError(
          errBody?.message || 'Access to repository was forbidden by GitHub (403 Forbidden).',
          403,
          'FORBIDDEN',
          errBody
        );
      }

      // Handle 404
      if (response.status === 404) {
        throw new GitHubApiError('Repository, commit, branch, or file not found on GitHub (404 Not Found).', 404, 'NOT_FOUND');
      }

      if (!response.ok) {
        let errBody = null;
        try { errBody = await response.json(); } catch {}
        throw new GitHubApiError(
          errBody?.message || `GitHub API error (HTTP ${response.status}).`,
          response.status,
          'API_ERROR',
          errBody
        );
      }

      const data = await response.json();
      const etag = response.headers.get('etag');

      // Store in memory cache
      memoryCache.set(cacheKey, {
        data,
        etag,
        expiresAt: now + ttlMs,
        isImmutable,
      });

      return data;
    } finally {
      inFlightRequests.delete(cacheKey);
    }
  })();

  inFlightRequests.set(cacheKey, promise);
  return promise;
}

// ============================================================================
// Exported GitHub API Service Functions
// ============================================================================

export const githubApi = {
  /**
   * Validate token or get current authentication status
   */
  async validateStatus(forceRefresh = false) {
    return validateConfiguredToken(forceRefresh);
  },

  /**
   * Clear cache for testing or manual refresh
   */
  clearCache() {
    memoryCache.clear();
  },

  /**
   * Mark token invalid or valid programmatically (for testing and runtime recovery)
   */
  setTokenInvalid(isInvalid) {
    isTokenMarkedInvalid = Boolean(isInvalid);
    inFlightRequests.clear();
    if (isTokenMarkedInvalid) {
      cachedAuthStatus = {
        configured: true,
        isValid: false,
        mode: 'invalid_token',
        error: 'The configured GITHUB_TOKEN failed authentication (401 Bad Credentials). Please update GITHUB_TOKEN in your .env file.',
        code: 'INVALID_TOKEN',
        checkedAt: Date.now(),
      };
    } else {
      cachedAuthStatus = null;
    }
  },

  /**
   * Repository metadata
   */
  async getRepoMetadata(owner, repo) {
    const url = `${config.GITHUB.API_BASE}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
    return requestGithub(url, { ttlMs: 15 * 60 * 1000 });
  },

  /**
   * Commit list with pagination
   */
  async getCommits(owner, repo, perPage = 100, page = 1) {
    const safePerPage = Math.min(Math.max(1, perPage), 100);
    const url = `${config.GITHUB.API_BASE}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/commits?per_page=${safePerPage}&page=${page}`;
    return requestGithub(url, { ttlMs: 10 * 60 * 1000 });
  },

  /**
   * Commit details (immutable: safe to cache permanently)
   */
  async getCommitDetails(owner, repo, sha) {
    const url = `${config.GITHUB.API_BASE}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/commits/${encodeURIComponent(sha)}`;
    return requestGithub(url, { isImmutable: true });
  },

  /**
   * Git tree (immutable for a given commit sha)
   */
  async getGitTree(owner, repo, sha, recursive = true) {
    const recParam = recursive ? '?recursive=1' : '';
    const url = `${config.GITHUB.API_BASE}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/trees/${encodeURIComponent(sha)}${recParam}`;
    return requestGithub(url, { isImmutable: true });
  },

  /**
   * Releases list
   */
  async getReleases(owner, repo, perPage = 30) {
    const url = `${config.GITHUB.API_BASE}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/releases?per_page=${Math.min(perPage, 50)}`;
    return requestGithub(url, { ttlMs: 30 * 60 * 1000 });
  },

  /**
   * Tags list
   */
  async getTags(owner, repo, perPage = 30) {
    const url = `${config.GITHUB.API_BASE}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/tags?per_page=${Math.min(perPage, 50)}`;
    return requestGithub(url, { ttlMs: 30 * 60 * 1000 });
  },

  /**
   * Readme file
   */
  async getReadme(owner, repo) {
    const url = `${config.GITHUB.API_BASE}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/readme`;
    try {
      const data = await requestGithub(url, { ttlMs: 30 * 60 * 1000 });
      if (data && data.content) {
        return {
          path: data.path || 'README.md',
          content: Buffer.from(data.content, 'base64').toString('utf8'),
        };
      }
    } catch (err) {
      if (err.status === 404) return null;
      throw err;
    }
    return null;
  },

  /**
   * Raw file content
   */
  async getFileRawContent(owner, repo, filePath, ref = '') {
    const encodedPath = filePath.split('/').map(encodeURIComponent).join('/');
    const refParam = ref ? `?ref=${encodeURIComponent(ref)}` : '';
    const url = `${config.GITHUB.API_BASE}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${encodedPath}${refParam}`;

    try {
      const data = await requestGithub(url, { ttlMs: 30 * 60 * 1000 });
      if (data.content && data.encoding === 'base64') {
        return Buffer.from(data.content, 'base64').toString('utf8');
      } else if (data.download_url) {
        const res = await fetch(data.download_url);
        if (res.ok) return await res.text();
      }
      return null;
    } catch (err) {
      if (err.status === 404) return null;
      throw err;
    }
  },

  /**
   * Aggregated Timeline Data:
   * Combines repo metadata, recent commits, and releases in one cached server-side operation.
   */
  async getTimelineData(owner, repo) {
    const cacheKey = `aggregated_timeline_${owner}/${repo}`;
    if (memoryCache.has(cacheKey)) {
      const entry = memoryCache.get(cacheKey);
      if (entry.expiresAt > Date.now()) {
        return entry.data;
      }
    }

    const [repoMeta, commits, releases] = await Promise.all([
      this.getRepoMetadata(owner, repo),
      this.getCommits(owner, repo, 100, 1),
      this.getReleases(owner, repo, 30).catch(() => []),
    ]);

    const result = {
      meta: {
        name: repoMeta.name,
        fullName: repoMeta.full_name,
        description: repoMeta.description,
        stars: repoMeta.stargazers_count,
        forks: repoMeta.forks_count,
        openIssues: repoMeta.open_issues_count,
        defaultBranch: repoMeta.default_branch,
        createdAt: repoMeta.created_at,
        updatedAt: repoMeta.updated_at,
      },
      commits: commits.map((c) => ({
        sha: c.sha,
        shortSha: c.sha.substring(0, 7),
        message: (c.commit?.message || '').split('\n')[0].trim(),
        fullMessage: c.commit?.message || '',
        date: c.commit?.author?.date || c.commit?.committer?.date,
        authorName: c.commit?.author?.name || c.author?.login || 'Unknown',
        authorLogin: c.author?.login || null,
        authorAvatar: c.author?.avatar_url || `https://avatars.githubusercontent.com/u/0?v=4`,
        htmlUrl: c.html_url,
      })),
      releases: (releases || []).map((r) => ({
        name: r.name || r.tag_name,
        tagName: r.tag_name,
        publishedAt: r.published_at,
        htmlUrl: r.html_url,
      })),
    };

    memoryCache.set(cacheKey, {
      data: result,
      expiresAt: Date.now() + 10 * 60 * 1000,
    });

    return result;
  },

  /**
   * Aggregated Collaborator Analytics:
   * Fetches commits and details with controlled concurrency limiter,
   * performs normalization and attribution, and caches the result.
   */
  async getCollaboratorAnalytics(owner, repo, { maxCommits = 100, maxDetails = 40 } = {}) {
    const cacheKey = `aggregated_collab_${owner}/${repo}_${maxCommits}_${maxDetails}`;
    if (memoryCache.has(cacheKey)) {
      const entry = memoryCache.get(cacheKey);
      if (entry.expiresAt > Date.now()) {
        return entry.data;
      }
    }

    const rawCommits = await this.getCommits(owner, repo, maxCommits, 1);
    if (!Array.isArray(rawCommits) || rawCommits.length === 0) {
      throw new GitHubApiError(`No commits found for repository ${owner}/${repo}`, 404, 'EMPTY_REPO');
    }

    // Controlled concurrency batch for commit details
    const commitsToDetail = rawCommits.slice(0, Math.min(rawCommits.length, maxDetails));
    const detailedCommits = await limitConcurrency(commitsToDetail, 4, async (c) => {
      try {
        const details = await this.getCommitDetails(owner, repo, c.sha);
        return { sha: c.sha, details };
      } catch {
        return { sha: c.sha, details: null };
      }
    });

    const detailedMap = new Map();
    for (const item of detailedCommits) {
      if (item.details) detailedMap.set(item.sha, item.details);
    }

    // Process and normalize
    const contributorsMap = new Map();
    const directoriesMap = new Map();

    for (const c of rawCommits) {
      const authorLogin = c.author?.login || c.commit?.author?.email?.split('@')[0] || c.commit?.author?.name || 'unknown';
      const authorName = c.commit?.author?.name || authorLogin;
      const avatarUrl = c.author?.avatar_url || `https://avatars.githubusercontent.com/u/0?v=4`;
      const isBot = authorLogin.includes('[bot]') || authorLogin.includes('dependabot') || authorLogin.includes('actions');

      if (!contributorsMap.has(authorLogin)) {
        contributorsMap.set(authorLogin, {
          id: authorLogin,
          login: authorLogin,
          name: authorName,
          avatarUrl,
          isBot,
          commitsCount: 0,
          additions: 0,
          deletions: 0,
          filesChanged: new Set(),
          directories: new Set(),
        });
      }

      const contrib = contributorsMap.get(authorLogin);
      contrib.commitsCount++;

      const detail = detailedMap.get(c.sha);
      if (detail && Array.isArray(detail.files)) {
        contrib.additions += detail.stats?.additions || 0;
        contrib.deletions += detail.stats?.deletions || 0;

        for (const file of detail.files) {
          contrib.filesChanged.add(file.filename);
          const dir = file.filename.includes('/') ? file.filename.split('/').slice(0, -1).join('/') : 'root';
          contrib.directories.add(dir);

          if (!directoriesMap.has(dir)) {
            directoriesMap.set(dir, {
              path: dir,
              commitsCount: 0,
              contributorsMap: new Map(),
            });
          }
          const dirEntry = directoriesMap.get(dir);
          dirEntry.commitsCount++;
          dirEntry.contributorsMap.set(authorLogin, (dirEntry.contributorsMap.get(authorLogin) || 0) + 1);
        }
      }
    }

    // Format final response
    const contributors = Array.from(contributorsMap.values()).map(c => ({
      ...c,
      filesChangedCount: c.filesChanged.size,
      directoriesCount: c.directories.size,
      filesChanged: Array.from(c.filesChanged),
      directories: Array.from(c.directories),
    })).sort((a, b) => b.commitsCount - a.commitsCount);

    const directories = Array.from(directoriesMap.values()).map(d => {
      const total = d.commitsCount;
      const contribs = Array.from(d.contributorsMap.entries()).map(([login, count]) => ({
        login,
        count,
        share: Number(((count / total) * 100).toFixed(1)),
      })).sort((a, b) => b.count - a.count);

      // HHI concentration
      const hhi = contribs.reduce((sum, item) => sum + Math.pow(item.share, 2), 0);
      const riskLevel = hhi >= 5000 ? 'high' : hhi >= 2500 ? 'medium' : 'low';

      return {
        path: d.path,
        totalCommits: total,
        topContributor: contribs[0]?.login || 'none',
        topContributorShare: contribs[0]?.share || 0,
        contributors: contribs,
        concentration: { hhi: Math.round(hhi), riskLevel },
      };
    }).sort((a, b) => b.totalCommits - a.totalCommits);

    const result = {
      repo: `${owner}/${repo}`,
      totalCommitsAnalyzed: rawCommits.length,
      detailedCommitsCount: detailedCommits.length,
      contributors,
      directories,
    };

    memoryCache.set(cacheKey, {
      data: result,
      expiresAt: Date.now() + 15 * 60 * 1000,
    });

    return result;
  },
};
