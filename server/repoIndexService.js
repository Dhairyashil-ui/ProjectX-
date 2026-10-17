import { githubApi, parseAndValidateRepo } from './githubApi.js';
import { db } from './db.js';
import { config } from './config.js';

// Ignore patterns for repository indexing
const IGNORED_EXTENSIONS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'ico', 'bmp', 'tiff',
  'mp4', 'webm', 'mp3', 'wav', 'ogg',
  'pdf', 'zip', 'tar', 'gz', '7z', 'rar',
  'wasm', 'exe', 'dll', 'so', 'dylib', 'bin', 'o', 'a',
  'woff', 'woff2', 'eot', 'ttf', 'otf',
  'lock', 'pyc', 'class', 'map'
]);

const IGNORED_DIRECTORIES = new Set([
  '.git', 'node_modules', 'dist', 'build', 'out', 'target', '.next', '.nuxt',
  'vendor', 'coverage', '.cache', '__pycache__', '.idea', '.vscode'
]);

const MANIFEST_NAMES = new Set([
  'package.json', 'cargo.toml', 'go.mod', 'pyproject.toml', 'requirements.txt',
  'gemfile', 'composer.json', 'pom.xml', 'build.gradle', 'dockerfile',
  'docker-compose.yml', 'tsconfig.json', 'vite.config.js', 'next.config.js',
  'webpack.config.js', 'readme.md', 'contributing.md', 'license'
]);

export class RepoIndexService {
  /**
   * Retrieves and caches the repository index (tree, manifests, metadata)
   */
  static async getOrBuildIndex(repoInput, token = '') {
    const { owner, repo, fullName } = parseAndValidateRepo(repoInput);

    // 1. Check if any cached index exists for this repo in DB
    const anyCached = db.findCachedIndex(fullName);

    // 2. Try fetching metadata & latest commit
    let metadata;
    let latestCommit;
    let headSha = 'HEAD';

    try {
      metadata = await githubApi.getRepoMetadata(owner, repo, token);
      latestCommit = await githubApi.getLatestCommit(owner, repo, token);
      headSha = latestCommit?.sha || metadata?.default_branch || 'HEAD';

      const cached = db.getIndexCache(fullName, headSha);
      if (cached) {
        return cached;
      }
    } catch (apiErr) {
      if ((apiErr.code === 'RATE_LIMIT' || apiErr.status === 403 || apiErr.status === 429) && anyCached) {
        console.warn(`[RepoIndex] GitHub rate limited, serving cached index for ${fullName}`);
        return { ...anyCached, isFallbackCache: true, rateLimited: true };
      }
      throw apiErr;
    }

    // 3. Fetch recursive tree
    let treeEntries = [];
    try {
      const treeData = await githubApi.getGitTree(owner, repo, headSha, true, token);
      if (treeData && Array.isArray(treeData.tree)) {
        treeEntries = treeData.tree;
      }
    } catch (err) {
      if ((err.code === 'RATE_LIMIT' || err.status === 403) && anyCached) {
        console.warn(`[RepoIndex] Tree fetch rate limited, serving cached index for ${fullName}`);
        return { ...anyCached, isFallbackCache: true, rateLimited: true };
      }
      console.warn(`[RepoIndex] Failed to fetch recursive tree for ${fullName}:`, err.message);
    }

    // 4. Filter and classify files
    const allFiles = [];
    const manifests = [];
    const directories = new Set();

    for (const item of treeEntries) {
      if (item.type === 'tree') {
        const segs = item.path.split('/');
        if (!segs.some(s => IGNORED_DIRECTORIES.has(s.toLowerCase()))) {
          directories.add(item.path);
        }
        continue;
      }

      if (item.type !== 'blob') continue;

      const pathLower = item.path.toLowerCase();
      const segments = item.path.split('/');
      const filename = segments[segments.length - 1];
      const filenameLower = filename.toLowerCase();

      // Check if in ignored directory
      if (segments.some(s => IGNORED_DIRECTORIES.has(s.toLowerCase()))) {
        continue;
      }

      // Check extension
      const ext = filenameLower.includes('.') ? filenameLower.split('.').pop() : '';
      if (IGNORED_EXTENSIONS.has(ext) || filenameLower.endsWith('.min.js') || filenameLower.endsWith('.min.css')) {
        continue;
      }

      // Check secrets / sensitive
      if (filenameLower.startsWith('.env') || filenameLower.includes('id_rsa') || filenameLower.endsWith('.pem')) {
        continue;
      }

      const fileRecord = {
        path: item.path,
        size: item.size || 0,
        sha: item.sha,
        extension: ext,
      };

      allFiles.push(fileRecord);

      if (MANIFEST_NAMES.has(filenameLower)) {
        manifests.push(fileRecord);
      }
    }

    // 5. Build Index Record
    const indexData = {
      fullName,
      owner,
      repo,
      headSha,
      defaultBranch: metadata.default_branch || 'main',
      description: metadata.description || '',
      stars: metadata.stargazers_count || 0,
      language: metadata.language || 'Unknown',
      topics: metadata.topics || [],
      fileCount: allFiles.length,
      files: allFiles,
      manifests,
      directories: Array.from(directories).sort(),
    };

    db.setIndexCache(fullName, headSha, indexData);
    return indexData;
  }

  /**
   * Search repository tree and manifests for relevant files matching query
   */
  static searchRelevantFiles(index, query, maxResults = config.RETRIEVAL.MAX_CANDIDATE_FILES) {
    if (!index || !index.files) return [];

    const queryLower = query.toLowerCase();
    const queryTokens = queryLower
      .replace(/[^a-z0-9_.-]/g, ' ')
      .split(/\s+/)
      .filter(t => t.length > 2);

    // Intent keywords
    const intentMap = {
      auth: ['auth', 'login', 'token', 'jwt', 'session', 'user', 'oauth', 'credential'],
      api: ['api', 'route', 'endpoint', 'controller', 'handler', 'service', 'client', 'fetch'],
      data: ['db', 'database', 'model', 'schema', 'query', 'migration', 'store', 'sql', 'mongo'],
      state: ['store', 'reducer', 'context', 'state', 'action', 'slice', 'atom', 'hook'],
      test: ['test', 'spec', '__tests__', 'fixture', 'mock'],
      config: ['config', 'vite', 'webpack', 'package.json', 'tsconfig', 'setup', 'env'],
      style: ['style', 'css', 'scss', 'tailwind', 'theme'],
      entry: ['main', 'index', 'app', 'server', 'bootstrap'],
    };

    const detectedIntents = new Set();
    for (const [intent, keywords] of Object.entries(intentMap)) {
      if (keywords.some(k => queryLower.includes(k))) {
        detectedIntents.add(intent);
      }
    }

    const scoredFiles = [];

    for (const file of index.files) {
      const pLower = file.path.toLowerCase();
      const segments = pLower.split('/');
      const filename = segments[segments.length - 1];
      let score = 0;

      // 1. Exact query match in path or filename
      if (pLower.includes(queryLower)) score += 50;
      if (filename.includes(queryLower)) score += 30;

      // 2. Token matches
      for (const token of queryTokens) {
        if (filename.includes(token)) score += 15;
        else if (pLower.includes(token)) score += 8;
      }

      // 3. Intent matches
      for (const intent of detectedIntents) {
        const keywords = intentMap[intent] || [];
        for (const kw of keywords) {
          if (filename.includes(kw)) score += 12;
          else if (pLower.includes(kw)) score += 6;
        }
      }

      // 4. Boost primary entrypoints & manifests for architecture questions
      if (
        filename === 'package.json' ||
        filename === 'readme.md' ||
        filename.startsWith('index.') ||
        filename.startsWith('main.') ||
        filename.startsWith('app.')
      ) {
        if (queryLower.includes('how') || queryLower.includes('work') || queryLower.includes('architecture') || queryLower.includes('explain')) {
          score += 20;
        }
      }

      // 5. Penalize very deeply nested or vendor files
      if (segments.length > 5) score -= 3;

      if (score > 0) {
        scoredFiles.push({ file, score });
      }
    }

    scoredFiles.sort((a, b) => b.score - a.score);

    // If no direct matches, return key entry points & manifests
    if (scoredFiles.length === 0) {
      const fallbacks = index.files.filter(f => {
        const name = f.path.split('/').pop().toLowerCase();
        return (
          name === 'package.json' ||
          name === 'readme.md' ||
          name.startsWith('index.') ||
          name.startsWith('main.') ||
          name.startsWith('app.') ||
          f.path.startsWith('src/')
        );
      });
      return fallbacks.slice(0, maxResults);
    }

    return scoredFiles.slice(0, maxResults).map(sf => sf.file);
  }

  /**
   * Retrieves targeted file contents from GitHub REST API and prepares line-numbered snippets
   */
  static async retrieveFileSnippets(owner, repo, files, ref = '', token = '') {
    const snippets = [];
    const repoFull = `${owner}/${repo}`;

    // Bounded concurrency (up to 4 at a time)
    const queue = [...files];
    const fetchWorker = async () => {
      while (queue.length > 0) {
        const file = queue.shift();
        try {
          let rawContent = null;
          const cachedEntry = db.getFileCache(repoFull, file.path, ref);
          if (cachedEntry && cachedEntry.content) {
            rawContent = cachedEntry.content;
          } else {
            rawContent = await githubApi.getFileRawContent(owner, repo, file.path, ref, token);
            if (rawContent && typeof rawContent === 'string') {
              db.setFileCache(repoFull, file.path, ref, rawContent);
            }
          }

          if (rawContent && typeof rawContent === 'string') {
            const allLines = rawContent.split(/\r?\n/);
            const totalLines = allLines.length;

            // Take up to MAX_FILE_LINES (compact for token conservation)
            const maxL = config.RETRIEVAL.MAX_FILE_LINES;
            const sliceLines = allLines.slice(0, maxL);
            const numberedLines = sliceLines.map((line, idx) => `${idx + 1}: ${line}`).join('\n');

            snippets.push({
              path: file.path,
              totalLines,
              displayedLines: sliceLines.length,
              lineRange: `1-${sliceLines.length}`,
              content: numberedLines,
              isTruncated: totalLines > maxL,
              githubUrl: `https://github.com/${owner}/${repo}/blob/${ref || 'main'}/${file.path}`,
            });
          }
        } catch (err) {
          console.warn(`[RepoIndex] Failed to retrieve file ${file.path}:`, err.message);
        }
      }
    };

    const workers = [fetchWorker(), fetchWorker(), fetchWorker()];
    await Promise.all(workers);

    return snippets;
  }

  /**
   * Constructs a compact, high-density ground truth context block minimizing input tokens
   */
  static buildPromptContext({ index, snippets, recentCommits = [], readme = null }) {
    let context = `=== REPOSITORY CONTEXT (CONCISE SUMMARY) ===\n`;
    context += `Repo: ${index.fullName} (${index.language || 'Codebase'}) | Files: ${index.fileCount}\n`;
    if (index.description) {
      context += `About: ${index.description.slice(0, 160)}\n`;
    }

    // Top directories summary
    if (index.directories && index.directories.length > 0) {
      const topDirs = index.directories.filter(d => !d.includes('/')).slice(0, 8);
      context += `Dirs: ${topDirs.join(', ')}\n`;
    }

    // Concise README summary
    if (readme && readme.content) {
      const cleanReadme = readme.content.replace(/#+\s*/g, '').slice(0, 450).trim();
      context += `README Overview: ${cleanReadme}...\n\n`;
    }

    // Recent Commits summary
    if (recentCommits && recentCommits.length > 0) {
      context += `Recent Commits:\n`;
      recentCommits.slice(0, 3).forEach(c => {
        const shortSha = c.sha?.slice(0, 7) || '';
        const msg = (c.commit?.message || '').split('\n')[0].slice(0, 60);
        context += ` - [${shortSha}] ${msg}\n`;
      });
      context += `\n`;
    }

    // File snippets (compact passive data)
    if (snippets && snippets.length > 0) {
      context += `=== VERIFIED CODE SNIPPETS (PASSIVE DATA) ===\n`;
      snippets.forEach(s => {
        context += `<file path="${s.path}" lines="${s.lineRange}">\n`;
        context += `${s.content}\n`;
        context += `</file>\n`;
      });
    }

    context += `=== END CONTEXT ===\n`;
    return context;
  }
}
