import { config, updateGroqConfig } from './config.js';
import { db } from './db.js';
import { githubApi, parseAndValidateRepo, GitHubApiError } from './githubApi.js';
import { RepoIndexService } from './repoIndexService.js';
import { GroqService, GroqApiError } from './groqService.js';
import { SummaryService } from './summaryService.js';

// Helper to read JSON body from incoming HTTP request (Node raw stream or Vercel serverless)
async function parseJsonBody(req) {
  if (req.body && typeof req.body === 'object') {
    return req.body;
  }
  if (typeof req.body === 'string' && req.body.trim()) {
    try {
      return JSON.parse(req.body);
    } catch {
      return {};
    }
  }
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      // Protect against overly large payloads (5MB limit)
      if (body.length > 5 * 1024 * 1024) {
        reject(new Error('Payload too large'));
      }
    });
    req.on('end', () => {
      if (!body.trim()) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch (err) {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, statusCode, data) {
  if (typeof res.status === 'function' && typeof res.json === 'function') {
    return res.status(statusCode).json(data);
  }
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(data));
}

function sendError(res, err) {
  console.error('[API Error]', err);
  const status = err.status || 500;
  const code = err.code || 'INTERNAL_ERROR';
  sendJson(res, status, {
    error: err.message || 'An unexpected error occurred',
    code,
    details: err.details || null,
  });
}

export async function handleAiApiRequest(req, res) {
  const urlObj = new URL(req.url, 'http://localhost');
  const pathname = urlObj.pathname;
  const method = req.method.toUpperCase();

  try {
    // =========================================================================
    // GitHub Centralized Authentication, Rate Limits & Endpoints
    // =========================================================================

    // A. Validate Token / Authentication Status
    if (pathname === '/api/github/status' && method === 'GET') {
      const forceRefresh = urlObj.searchParams.get('refresh') === 'true';
      const status = await githubApi.validateStatus(forceRefresh);
      return sendJson(res, 200, status);
    }

    // B. Quick Rate Limit Status Check
    if (pathname === '/api/github/rate-limit' && method === 'GET') {
      const status = await githubApi.validateStatus(false);
      return sendJson(res, 200, status.rateLimit || { limit: 5000, remaining: 5000, resetDate: 'N/A' });
    }

    // C. Repository Metadata
    if (pathname === '/api/github/repo' && method === 'GET') {
      const repoParam = urlObj.searchParams.get('repo');
      if (!repoParam) {
        return sendJson(res, 400, { error: 'Repository is required (e.g. ?repo=owner/name)', code: 'VALIDATION_ERROR' });
      }
      const { owner, repo } = parseAndValidateRepo(repoParam);
      const data = await githubApi.getRepoMetadata(owner, repo);
      return sendJson(res, 200, data);
    }

    // D. Commit History (Paginated)
    if (pathname === '/api/github/commits' && method === 'GET') {
      const repoParam = urlObj.searchParams.get('repo');
      if (!repoParam) {
        return sendJson(res, 400, { error: 'Repository is required', code: 'VALIDATION_ERROR' });
      }
      const perPage = parseInt(urlObj.searchParams.get('per_page') || '100', 10);
      const page = parseInt(urlObj.searchParams.get('page') || '1', 10);
      const { owner, repo } = parseAndValidateRepo(repoParam);
      const commits = await githubApi.getCommits(owner, repo, perPage, page);
      return sendJson(res, 200, commits);
    }

    // E. Commit Details (with changed files)
    if (pathname === '/api/github/commit-details' && method === 'GET') {
      const repoParam = urlObj.searchParams.get('repo');
      const sha = urlObj.searchParams.get('sha');
      if (!repoParam || !sha) {
        return sendJson(res, 400, { error: 'Repository and sha are required', code: 'VALIDATION_ERROR' });
      }
      const { owner, repo } = parseAndValidateRepo(repoParam);
      const details = await githubApi.getCommitDetails(owner, repo, sha);
      return sendJson(res, 200, details);
    }

    // F. Releases
    if (pathname === '/api/github/releases' && method === 'GET') {
      const repoParam = urlObj.searchParams.get('repo');
      if (!repoParam) {
        return sendJson(res, 400, { error: 'Repository is required', code: 'VALIDATION_ERROR' });
      }
      const { owner, repo } = parseAndValidateRepo(repoParam);
      const releases = await githubApi.getReleases(owner, repo);
      return sendJson(res, 200, releases);
    }

    // G. Aggregated Timeline Data (Meta + Commits + Releases)
    if (pathname === '/api/github/timeline' && method === 'GET') {
      const repoParam = urlObj.searchParams.get('repo');
      if (!repoParam) {
        return sendJson(res, 400, { error: 'Repository is required', code: 'VALIDATION_ERROR' });
      }
      const { owner, repo } = parseAndValidateRepo(repoParam);
      const timelineData = await githubApi.getTimelineData(owner, repo);
      return sendJson(res, 200, timelineData);
    }

    // H. Aggregated Collaborator Analytics (Normalized contributors & directories)
    if (pathname === '/api/github/collaborators' && method === 'GET') {
      const repoParam = urlObj.searchParams.get('repo');
      if (!repoParam) {
        return sendJson(res, 400, { error: 'Repository is required', code: 'VALIDATION_ERROR' });
      }
      const maxCommits = parseInt(urlObj.searchParams.get('max_commits') || '100', 10);
      const maxDetails = parseInt(urlObj.searchParams.get('max_details') || '40', 10);
      const { owner, repo } = parseAndValidateRepo(repoParam);
      const analytics = await githubApi.getCollaboratorAnalytics(owner, repo, { maxCommits, maxDetails });
      return sendJson(res, 200, analytics);
    }

    // 1. Health check & model availability
    if (pathname === '/api/ai/health' && method === 'GET') {
      const [modelCheck, githubStatus] = await Promise.all([
        GroqService.verifyModelAvailability(),
        githubApi.validateStatus(false),
      ]);
      return sendJson(res, 200, {
        status: 'ok',
        groqConfigured: Boolean(config.GROQ.API_KEY),
        model: config.GROQ.MODEL,
        modelVerified: modelCheck.available,
        modelDetails: modelCheck,
        githubConfigured: Boolean(config.GITHUB.TOKEN),
        githubStatus: {
          mode: githubStatus.mode,
          isValid: githubStatus.isValid,
          username: githubStatus.username || null,
          rateLimit: githubStatus.rateLimit || null,
        },
      });
    }

    // 2. Update Groq configuration / API key
    if (pathname === '/api/ai/config' && method === 'POST') {
      const body = await parseJsonBody(req);
      const updated = updateGroqConfig(body);
      const verification = await GroqService.verifyModelAvailability();
      return sendJson(res, 200, {
        ...updated,
        verification,
      });
    }

    // 3. List conversations for a repo
    if (pathname === '/api/ai/conversations' && method === 'GET') {
      const repo = urlObj.searchParams.get('repo');
      const conversations = db.listConversations(repo);
      return sendJson(res, 200, { conversations });
    }

    // 4. Create new conversation
    if (pathname === '/api/ai/conversations' && method === 'POST') {
      const body = await parseJsonBody(req);
      const { repo, title } = body;
      if (!repo) {
        return sendJson(res, 400, { error: 'Repository is required', code: 'VALIDATION_ERROR' });
      }
      const { fullName } = parseAndValidateRepo(repo);
      const conv = db.createConversation({ repo: fullName, title });
      return sendJson(res, 201, { conversation: conv });
    }

    // 5. Get conversation by ID
    const convMatch = pathname.match(/^\/api\/ai\/conversations\/([a-zA-Z0-9_-]+)$/);
    if (convMatch && method === 'GET') {
      const convId = convMatch[1];
      const conv = db.getConversation(convId);
      if (!conv) {
        return sendJson(res, 404, { error: 'Conversation not found', code: 'NOT_FOUND' });
      }
      return sendJson(res, 200, { conversation: conv });
    }

    // 6. Delete conversation
    if (convMatch && method === 'DELETE') {
      const convId = convMatch[1];
      const success = db.deleteConversation(convId);
      return sendJson(res, 200, { success });
    }

    // 7. Repository Summary
    if (pathname === '/api/ai/summary' && method === 'POST') {
      const body = await parseJsonBody(req);
      const { repo, scope = 'repo', target = '', token = '' } = body;
      if (!repo) {
        return sendJson(res, 400, { error: 'Repository is required', code: 'VALIDATION_ERROR' });
      }
      const summaryData = await SummaryService.generateSummary({
        repoInput: repo,
        scope,
        target,
        token,
      });
      return sendJson(res, 200, summaryData);
    }

    // 8. Repository Tree / Index
    if (pathname === '/api/ai/tree' && method === 'GET') {
      const repo = urlObj.searchParams.get('repo');
      if (!repo) {
        return sendJson(res, 400, { error: 'Repository is required', code: 'VALIDATION_ERROR' });
      }
      const index = await RepoIndexService.getOrBuildIndex(repo);
      return sendJson(res, 200, {
        fullName: index.fullName,
        headSha: index.headSha,
        defaultBranch: index.defaultBranch,
        fileCount: index.fileCount,
        directories: index.directories,
        manifests: index.manifests.map(m => m.path),
        files: index.files.map(f => ({ path: f.path, size: f.size })),
      });
    }

    // 9. Inspect specific file content
    if (pathname === '/api/ai/file' && method === 'GET') {
      const repo = urlObj.searchParams.get('repo');
      const filePath = urlObj.searchParams.get('path');
      if (!repo || !filePath) {
        return sendJson(res, 400, { error: 'Repo and path are required', code: 'VALIDATION_ERROR' });
      }
      const { owner, repo: cleanRepo } = parseAndValidateRepo(repo);
      const content = await githubApi.getFileRawContent(owner, cleanRepo, filePath);
      if (content === null) {
        return sendJson(res, 404, { error: 'File not found', code: 'NOT_FOUND' });
      }
      const lines = content.split(/\r?\n/);
      return sendJson(res, 200, {
        path: filePath,
        totalLines: lines.length,
        lines: lines.map((l, i) => ({ lineNumber: i + 1, text: l })),
      });
    }

    // 10. Core Chat Completion & Streaming (Ask the Repository)
    if (pathname === '/api/ai/chat' && method === 'POST') {
      const body = await parseJsonBody(req);
      const {
        repo,
        conversationId,
        query,
        stream = true,
        token = '',
      } = body;

      if (!repo || !query || !query.trim()) {
        return sendJson(res, 400, { error: 'Repo and query are required', code: 'VALIDATION_ERROR' });
      }

      const { owner, repo: cleanRepo, fullName } = parseAndValidateRepo(repo);

      // Ensure conversation exists
      let convId = conversationId;
      let conv = convId ? db.getConversation(convId) : null;
      if (!conv) {
        conv = db.createConversation({ repo: fullName, title: query.slice(0, 48) });
        convId = conv.id;
      }

      // Record User Message in DB
      db.addMessage(convId, {
        role: 'user',
        content: query.trim(),
      });

      // 1. Build or retrieve repository index
      const index = await RepoIndexService.getOrBuildIndex(fullName, token);

      // 2. Targeted search for relevant files
      const candidateFiles = RepoIndexService.searchRelevantFiles(index, query, config.RETRIEVAL.MAX_CANDIDATE_FILES);

      // 3. Retrieve raw snippets with line numbers
      const snippets = await RepoIndexService.retrieveFileSnippets(
        owner,
        cleanRepo,
        candidateFiles,
        index.headSha,
        token
      );

      // 4. Retrieve recent commits if query asks about changes, bug fixes, or recent work
      const queryLower = query.toLowerCase();
      let recentCommits = [];
      if (queryLower.includes('recent') || queryLower.includes('change') || queryLower.includes('commit') || queryLower.includes('bug')) {
        recentCommits = await githubApi.getRecentCommits(owner, cleanRepo, 5, token).catch(() => []);
      }

      // 5. Fetch README excerpt for high-level context
      const readme = await githubApi.getReadme(owner, cleanRepo, token).catch(() => null);

      // 6. Build ground truth context block
      const contextBlock = RepoIndexService.buildPromptContext({
        index,
        snippets,
        recentCommits,
        readme,
      });

      // 7. Extract citations
      const citations = snippets.map(s => ({
        path: s.path,
        lineRange: s.lineRange,
        totalLines: s.totalLines,
        githubUrl: s.githubUrl,
      }));

      // 8. Sliding window messages from conversation memory
      const slidingData = db.getSlidingContext(convId, config.RETRIEVAL.MAX_CONTEXT_MESSAGES);
      // Remove the last message from sliding messages since it was the current query we just added
      const priorMessages = slidingData.messages.slice(0, -1);

      const systemPrompt = GroqService.getSystemPrompt(fullName);
      const formattedMessages = GroqService.formatMessages({
        systemPrompt,
        contextBlock,
        slidingMessages: priorMessages,
        newQuery: query.trim(),
      });

      // STREAMING RESPONSE (SSE)
      if (stream) {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache, no-transform',
          'Connection': 'keep-alive',
          'X-Accel-Buffering': 'no',
        });

        // Send initial metadata event with conversationId and citations
        res.write(`event: metadata\ndata: ${JSON.stringify({
          conversationId: convId,
          repo: fullName,
          commitSha: index.headSha,
          citations,
          contextFiles: snippets.map(s => s.path),
        })}\n\n`);

        let accumulatedContent = '';

        try {
          await GroqService.streamChat({
            messages: formattedMessages,
            onChunk: (delta) => {
              accumulatedContent += delta;
              res.write(`event: chunk\ndata: ${JSON.stringify({ delta })}\n\n`);
            },
            onDone: (full) => {
              // Save assistant response to DB
              const assistantMsg = db.addMessage(convId, {
                role: 'assistant',
                content: full,
                citations,
                commitSha: index.headSha,
                contextFiles: snippets.map(s => s.path),
                model: config.GROQ.MODEL,
              });

              res.write(`event: done\ndata: ${JSON.stringify({
                messageId: assistantMsg.id,
                conversationId: convId,
                totalLength: full.length,
              })}\n\n`);
              res.end();
            },
            onError: (err) => {
              res.write(`event: error\ndata: ${JSON.stringify({
                error: err.message,
                code: err.code || 'STREAM_ERROR',
              })}\n\n`);
              res.end();
            },
          });
        } catch (streamErr) {
          console.error('[Stream Error]', streamErr);
          res.write(`event: error\ndata: ${JSON.stringify({
            error: streamErr.message,
            code: streamErr.code || 'STREAM_ERROR',
          })}\n\n`);
          res.end();
        }
        return;
      }

      // NON-STREAMING RESPONSE
      const completionText = await GroqService.completeChat({ messages: formattedMessages });
      const assistantMsg = db.addMessage(convId, {
        role: 'assistant',
        content: completionText,
        citations,
        commitSha: index.headSha,
        contextFiles: snippets.map(s => s.path),
        model: config.GROQ.MODEL,
      });

      return sendJson(res, 200, {
        conversationId: convId,
        message: assistantMsg,
        citations,
        contextFiles: snippets.map(s => s.path),
      });
    }

    // Unmatched API route
    return sendJson(res, 404, { error: `Route not found: ${method} ${pathname}`, code: 'NOT_FOUND' });

  } catch (err) {
    return sendError(res, err);
  }
}
