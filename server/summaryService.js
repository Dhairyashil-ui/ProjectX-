import { RepoIndexService } from './repoIndexService.js';
import { githubApi, parseAndValidateRepo } from './githubApi.js';
import { GroqService } from './groqService.js';
import { db } from './db.js';

export class SummaryService {
  /**
   * Generates or retrieves cached structured summary for a repository
   */
  static async generateSummary({ repoInput, scope = 'repo', target = '', token = '' }) {
    const { owner, repo, fullName } = parseAndValidateRepo(repoInput);

    // 1. Get repository index & latest revision
    const index = await RepoIndexService.getOrBuildIndex(fullName, token);
    const revision = index.headSha;

    // 2. Check summary cache
    const cached = db.getSummary({ repo: fullName, revision, scope, target: target || 'default' });
    if (cached) {
      return {
        ...cached,
        isCached: true,
      };
    }

    // 3. Gather evidence based on scope
    let evidenceFiles = [];
    let scopeTitle = 'Repository Overview';
    let scopeSpecificInstructions = '';

    if (scope === 'repo' || scope === 'architecture') {
      scopeTitle = scope === 'architecture' ? 'System Architecture' : 'Whole Repository Overview';
      scopeSpecificInstructions = `Generate a comprehensive architectural breakdown including:
1. Executive Summary & Purpose
2. Technology Stack & Core Dependencies
3. Frontend & Backend Architectural Patterns
4. Key Directories & Structural Responsibilities
5. Primary Application Entry Points & Execution Lifecycle
6. Testing Strategy & Infrastructure
7. Maintainability & Architectural Considerations`;

      evidenceFiles = index.files.filter(f => {
        const p = f.path.toLowerCase();
        return (
          p === 'package.json' ||
          p === 'readme.md' ||
          p.startsWith('src/main.') ||
          p.startsWith('src/index.') ||
          p.startsWith('src/app.') ||
          p === 'dockerfile' ||
          p === 'docker-compose.yml'
        );
      }).slice(0, 5);

    } else if (scope === 'api') {
      scopeTitle = 'API & Backend Services';
      scopeSpecificInstructions = `Analyze the API routes, network endpoints, backend integrations, and server communications. Detail:
1. API Routing Structure & Endpoints
2. Request / Response Lifecycle & Middleware
3. External Services & Third-Party Integrations
4. Error Handling & Validation Mechanisms`;

      evidenceFiles = RepoIndexService.searchRelevantFiles(index, 'api route controller server service fetch endpoint', 6);

    } else if (scope === 'data') {
      scopeTitle = 'Database & Data Flow Architecture';
      scopeSpecificInstructions = `Analyze how data is stored, modeled, queried, and updated throughout the codebase. Detail:
1. Data Storage Solutions (SQL, NoSQL, ORM, In-Memory)
2. State Management & Data Flow Patterns
3. Schemas, Models, and Entities
4. Mutations, Caching, and Persistence Policies`;

      evidenceFiles = RepoIndexService.searchRelevantFiles(index, 'db database store state reducer schema model query', 6);

    } else if (scope === 'directory') {
      const dirTarget = target || 'src';
      scopeTitle = `Directory Audit: ${dirTarget}/`;
      scopeSpecificInstructions = `Analyze the purpose, components, exports, and responsibilities of the files located within "${dirTarget}/". Detail:
1. Primary Role of Directory in the System
2. Key Components and Files Contained Within
3. Interactions with Other Directories and Subsystems
4. Code Quality & Modularity Assessment`;

      evidenceFiles = index.files.filter(f => f.path.startsWith(dirTarget)).slice(0, 7);

    } else if (scope === 'file') {
      const fileTarget = target || (index.files[0] ? index.files[0].path : 'package.json');
      scopeTitle = `File Deep Dive: ${fileTarget}`;
      scopeSpecificInstructions = `Analyze the file "${fileTarget}" in detail. Provide:
1. Purpose & Responsibilities of this file
2. Exported Functions, Classes, and Interfaces
3. Dependencies and External Imports
4. Key Algorithms or Control Flow Logic
5. Observability, Edge Cases, and Potential Improvements`;

      evidenceFiles = index.files.filter(f => f.path === fileTarget);
      if (evidenceFiles.length === 0) {
        evidenceFiles = [{ path: fileTarget }];
      }

    } else if (scope === 'changes') {
      scopeTitle = 'Recent Changes & Evolution';
      scopeSpecificInstructions = `Analyze recent commit history to explain recent development velocity, features added, refactorings, and active contributors.`;
    }

    // 4. Retrieve raw file snippets
    const snippets = await RepoIndexService.retrieveFileSnippets(owner, repo, evidenceFiles, revision, token);
    const recentCommits = await githubApi.getRecentCommits(owner, repo, 8, token).catch(() => []);
    const readme = await githubApi.getReadme(owner, repo, token).catch(() => null);

    // 5. Build prompt
    const contextBlock = RepoIndexService.buildPromptContext({
      index,
      snippets,
      recentCommits,
      readme,
    });

    const systemPrompt = `You are GitStory AI, an expert software architect.
Produce a high-grade, evidence-backed repository summary for "${fullName}".
Scope: ${scopeTitle}

${scopeSpecificInstructions}

RULES:
- All claims MUST be grounded in the verified repository files provided.
- If a technology, database, or test framework is NOT present in the code, do NOT claim it exists. State "No evidence found in repository files."
- Use structured Markdown with clear headings (###), bullet points, and code citations (e.g. [path/to/file:L10-L40]).
- Clearly distinguish confirmed facts from inferences.
- TOKEN MINIMIZATION: Keep the summary concise, crisp, and high-density using minimum tokens. Avoid fluff or filler words.`;

    const userPrompt = `Please synthesize the ground truth evidence below into a structured summary for ${fullName} (${scopeTitle}).`;

    const messages = GroqService.formatMessages({
      systemPrompt,
      contextBlock,
      slidingMessages: [],
      newQuery: userPrompt,
    });

    // 6. Invoke Groq Qwen model
    const summaryText = await GroqService.completeChat({ messages });

    // 7. Save to DB cache
    const keyFiles = snippets.map(s => s.path);
    const savedRecord = db.saveSummary({
      repo: fullName,
      revision,
      scope,
      target: target || 'default',
      summary: summaryText,
      keyFiles,
    });

    return {
      ...savedRecord,
      isCached: false,
    };
  }
}
