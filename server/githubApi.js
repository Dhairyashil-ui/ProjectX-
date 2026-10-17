import { config } from './config.js';

export class GitHubApiError extends Error {
  constructor(message, status, code, details = null) {
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

const FALLBACK_PAT = config.GITHUB?.TOKEN || process.env.GITHUB_TOKEN || '';

function getHeaders(token = '') {
  const headers = {
    'Accept': 'application/vnd.github.v3+json',
    'User-Agent': 'GitStory-AI-Intelligence-Engine/1.0',
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}

async function requestGithub(url, customToken = '') {
  let initialToken = customToken || config.GITHUB.TOKEN;
  let response;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 18000);
    response = await fetch(url, {
      headers: getHeaders(initialToken),
      signal: controller.signal,
    });
    clearTimeout(timeout);
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new GitHubApiError('GitHub API request timed out.', 408, 'TIMEOUT');
    }
    throw new GitHubApiError(`Network failure while contacting GitHub: ${err.message}`, 503, 'NETWORK_ERROR');
  }

  // If primary token returned 401 (Expired/Unauthorized) or 403 (Rate limited / Forbidden),
  // try token FALLBACK_PAT only if previous one is expired
  if ((response.status === 401 || response.status === 403) && initialToken !== FALLBACK_PAT) {
    console.warn(`[GitHubApi] Previous token failed with HTTP ${response.status}. Retrying with verified fallback PAT...`);
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 18000);
      const fallbackResponse = await fetch(url, {
        headers: getHeaders(FALLBACK_PAT),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (fallbackResponse.ok) {
        return fallbackResponse.json();
      }
      response = fallbackResponse; // use fallbackResponse for error handling below
    } catch {
      // ignore, fall through to error handling
    }
  }

  if (!response.ok) {
    const status = response.status;
    let errorData = null;
    try {
      errorData = await response.json();
    } catch {
      // ignore
    }

    if (status === 404) {
      throw new GitHubApiError('Repository, branch, or file not found on GitHub.', 404, 'NOT_FOUND', errorData);
    }
    if (status === 403) {
      const resetTime = response.headers.get('x-ratelimit-reset');
      const resetDate = resetTime ? new Date(parseInt(resetTime, 10) * 1000).toLocaleTimeString() : 'in an hour';
      throw new GitHubApiError(
        `GitHub API rate limit exceeded. Limit resets at ${resetDate}. Provide a personal access token for 5,000 requests/hour.`,
        403,
        'RATE_LIMIT',
        { resetDate }
      );
    }
    if (status === 401) {
      throw new GitHubApiError('GitHub API authentication failed. Verify your personal access token.', 401, 'UNAUTHORIZED');
    }

    throw new GitHubApiError(
      errorData?.message || `GitHub API responded with status ${status}.`,
      status,
      'API_ERROR',
      errorData
    );
  }

  return response.json();
}

export const githubApi = {
  async getRepoMetadata(owner, repo, token) {
    const safeOwner = encodeURIComponent(owner);
    const safeRepo = encodeURIComponent(repo);
    const url = `${config.GITHUB.API_BASE}/repos/${safeOwner}/${safeRepo}`;
    return requestGithub(url, token);
  },

  async getLatestCommit(owner, repo, token) {
    const safeOwner = encodeURIComponent(owner);
    const safeRepo = encodeURIComponent(repo);
    const url = `${config.GITHUB.API_BASE}/repos/${safeOwner}/${safeRepo}/commits?per_page=1`;
    const commits = await requestGithub(url, token);
    return commits[0] || null;
  },

  async getRecentCommits(owner, repo, perPage = 25, token) {
    const safeOwner = encodeURIComponent(owner);
    const safeRepo = encodeURIComponent(repo);
    const url = `${config.GITHUB.API_BASE}/repos/${safeOwner}/${safeRepo}/commits?per_page=${Math.min(perPage, 100)}`;
    return requestGithub(url, token);
  },

  async getCommitDetails(owner, repo, sha, token) {
    const safeOwner = encodeURIComponent(owner);
    const safeRepo = encodeURIComponent(repo);
    const safeSha = encodeURIComponent(sha);
    const url = `${config.GITHUB.API_BASE}/repos/${safeOwner}/${safeRepo}/commits/${safeSha}`;
    return requestGithub(url, token);
  },

  async getGitTree(owner, repo, sha, recursive = true, token) {
    const safeOwner = encodeURIComponent(owner);
    const safeRepo = encodeURIComponent(repo);
    const safeSha = encodeURIComponent(sha);
    const recursiveParam = recursive ? '?recursive=1' : '';
    const url = `${config.GITHUB.API_BASE}/repos/${safeOwner}/${safeRepo}/git/trees/${safeSha}${recursiveParam}`;
    return requestGithub(url, token);
  },

  async getReadme(owner, repo, token) {
    const safeOwner = encodeURIComponent(owner);
    const safeRepo = encodeURIComponent(repo);
    const url = `${config.GITHUB.API_BASE}/repos/${safeOwner}/${safeRepo}/readme`;
    try {
      const data = await requestGithub(url, token);
      if (data && data.content) {
        const decoded = Buffer.from(data.content, 'base64').toString('utf8');
        return {
          path: data.path || 'README.md',
          content: decoded,
        };
      }
    } catch (err) {
      if (err.status === 404) return null;
      throw err;
    }
    return null;
  },

  async getFileRawContent(owner, repo, filePath, ref = '', token) {
    const safeOwner = encodeURIComponent(owner);
    const safeRepo = encodeURIComponent(repo);
    // Path can contain slashes, so encode segments individually
    const encodedPath = filePath.split('/').map(encodeURIComponent).join('/');
    const refParam = ref ? `?ref=${encodeURIComponent(ref)}` : '';
    const url = `${config.GITHUB.API_BASE}/repos/${safeOwner}/${safeRepo}/contents/${encodedPath}${refParam}`;

    try {
      const data = await requestGithub(url, token);
      if (data.content && data.encoding === 'base64') {
        return Buffer.from(data.content, 'base64').toString('utf8');
      } else if (data.download_url) {
        // Direct download
        const res = await fetch(data.download_url, { headers: getHeaders(token) });
        if (res.ok) return await res.text();
      }
      return null;
    } catch (err) {
      if (err.status === 404) return null;
      throw err;
    }
  },
};
