import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { config } from './config.js';

const DATA_DIR = config.DATA_DIR;
const DB_FILE = path.join(DATA_DIR, 'gitstory_ai.json');

// Ensure data directory exists
try {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
} catch (e) {
  console.warn('[DB] Notice: Could not create DATA_DIR (using in-memory store):', e.message);
}

// In-memory state synchronized with atomic write to disk
let dbState = {
  conversations: {}, // id -> conversation
  summaries: {},     // `${repo}:${revision}:${scope}:${target}` -> summary
  indexCache: {},    // `${repo}:${revision}` -> metadata/tree
  fileCache: {},     // `${repo}:${path}:${revision}` -> file content
};

function loadDatabase() {
  try {
    if (fs.existsSync(DB_FILE)) {
      const raw = fs.readFileSync(DB_FILE, 'utf8');
      const parsed = JSON.parse(raw);
      dbState = {
        conversations: parsed.conversations || {},
        summaries: parsed.summaries || {},
        indexCache: parsed.indexCache || {},
        fileCache: parsed.fileCache || {},
      };
    } else {
      saveDatabase();
    }
  } catch (err) {
    console.error('[DB] Failed to load database, initializing fresh store:', err.message);
    saveDatabase();
  }
}

function saveDatabase() {
  try {
    const tempFile = `${DB_FILE}.tmp.${Date.now()}`;
    fs.writeFileSync(tempFile, JSON.stringify(dbState, null, 2), 'utf8');
    fs.renameSync(tempFile, DB_FILE);
  } catch (err) {
    console.error('[DB] Failed to persist database:', err.message);
  }
}

// Initial load
loadDatabase();

export const db = {
  // --- Conversations ---
  createConversation({ repo, commitSha = '', title = '' }) {
    const id = `conv_${Date.now()}_${randomUUID().slice(0, 8)}`;
    const conversation = {
      id,
      repo,
      commitSha,
      title: title || `Chat about ${repo}`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      messages: [],
      rollingSummary: '',
    };
    dbState.conversations[id] = conversation;
    saveDatabase();
    return conversation;
  },

  getConversation(id) {
    return dbState.conversations[id] || null;
  },

  listConversations(repo = null) {
    const all = Object.values(dbState.conversations);
    if (!repo) {
      return all.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
    }
    return all
      .filter((c) => c.repo.toLowerCase() === repo.toLowerCase())
      .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  },

  deleteConversation(id) {
    if (dbState.conversations[id]) {
      delete dbState.conversations[id];
      saveDatabase();
      return true;
    }
    return false;
  },

  addMessage(conversationId, { role, content, citations = [], codeSnippets = [], model = '', commitSha = '', contextFiles = [] }) {
    const conv = dbState.conversations[conversationId];
    if (!conv) {
      throw new Error(`Conversation not found: ${conversationId}`);
    }

    const messageId = `msg_${Date.now()}_${randomUUID().slice(0, 6)}`;
    const message = {
      id: messageId,
      role, // 'user' | 'assistant'
      content,
      citations,
      codeSnippets,
      model,
      commitSha: commitSha || conv.commitSha,
      contextFiles,
      timestamp: new Date().toISOString(),
    };

    conv.messages.push(message);
    conv.updatedAt = new Date().toISOString();

    // Auto-update conversation title from first user query
    if (role === 'user' && conv.messages.filter((m) => m.role === 'user').length === 1) {
      conv.title = content.slice(0, 48) + (content.length > 48 ? '...' : '');
    }

    // Keep sliding context window and update rolling summary if message count grows
    if (conv.messages.length > config.RETRIEVAL.MAX_CONTEXT_MESSAGES * 2) {
      // Summarize older messages into rollingSummary to save token context
      const olderMessages = conv.messages.slice(0, conv.messages.length - config.RETRIEVAL.MAX_CONTEXT_MESSAGES);
      const summarySnippets = olderMessages
        .map((m) => `${m.role.toUpperCase()}: ${m.content.slice(0, 80)}`)
        .join(' | ');
      conv.rollingSummary = `Prior topics: ${summarySnippets}`.slice(0, 1000);
    }

    saveDatabase();
    return message;
  },

  getSlidingContext(conversationId, limit = config.RETRIEVAL.MAX_CONTEXT_MESSAGES) {
    const conv = dbState.conversations[conversationId];
    if (!conv) return { messages: [], rollingSummary: '' };

    const recent = conv.messages.slice(-limit);
    return {
      messages: recent,
      rollingSummary: conv.rollingSummary || '',
      repo: conv.repo,
      commitSha: conv.commitSha,
    };
  },

  // --- Summaries ---
  getSummary({ repo, revision, scope = 'repo', target = 'root' }) {
    const key = `${repo.toLowerCase()}:${revision || 'latest'}:${scope}:${target}`;
    return dbState.summaries[key] || null;
  },

  saveSummary({ repo, revision, scope = 'repo', target = 'root', summary, sections, keyFiles }) {
    const key = `${repo.toLowerCase()}:${revision || 'latest'}:${scope}:${target}`;
    const record = {
      key,
      repo,
      revision: revision || 'latest',
      scope,
      target,
      summary,
      sections: sections || [],
      keyFiles: keyFiles || [],
      generatedAt: new Date().toISOString(),
    };
    dbState.summaries[key] = record;
    saveDatabase();
    return record;
  },

  // --- Repository Index Cache ---
  findCachedIndex(repo) {
    if (!dbState.indexCache) return null;
    const prefix = `${repo.toLowerCase()}:`;
    for (const [key, val] of Object.entries(dbState.indexCache)) {
      if (key.startsWith(prefix) && val.files && val.files.length > 0) {
        return val;
      }
    }
    return null;
  },

  getIndexCache(repo, revision) {
    const key = `${repo.toLowerCase()}:${revision || 'head'}`;
    return dbState.indexCache[key] || null;
  },

  setIndexCache(repo, revision, data) {
    const key = `${repo.toLowerCase()}:${revision || 'head'}`;
    dbState.indexCache[key] = {
      ...data,
      cachedAt: new Date().toISOString(),
    };
    saveDatabase();
  },

  // --- Raw File Content Cache ---
  getFileCache(repo, path, ref = 'head') {
    const key = `${repo.toLowerCase()}:${path.toLowerCase()}:${ref || 'head'}`;
    return dbState.fileCache ? dbState.fileCache[key] || null : null;
  },

  setFileCache(repo, path, ref = 'head', content) {
    const key = `${repo.toLowerCase()}:${path.toLowerCase()}:${ref || 'head'}`;
    if (!dbState.fileCache) dbState.fileCache = {};
    dbState.fileCache[key] = {
      content,
      cachedAt: new Date().toISOString(),
    };
    saveDatabase();
  },
};
