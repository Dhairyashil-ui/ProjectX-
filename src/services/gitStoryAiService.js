/**
 * Client service for GitStory AI
 * Handles communications with backend /api/ai endpoints,
 * SSE streaming, conversation persistence, and repository summaries.
 */

export class GitStoryAiService {
  /**
   * Health check and model verification status
   */
  static async checkHealth() {
    try {
      const res = await fetch('/api/ai/health');
      if (!res.ok) throw new Error(`Health check returned status ${res.status}`);
      return await res.json();
    } catch (err) {
      console.warn('[GitStory AI] Health check error:', err.message);
      return {
        status: 'error',
        groqConfigured: false,
        model: 'qwen/qwen3.8-27b',
        modelVerified: false,
        error: err.message,
      };
    }
  }

  /**
   * Update Groq API key or model configuration securely on backend
   */
  static async updateConfig({ apiKey, model }) {
    const res = await fetch('/api/ai/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey, model }),
    });
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || `Failed to update configuration (${res.status})`);
    }
    return res.json();
  }

  /**
   * List saved conversations for a repository
   */
  static async listConversations(repo) {
    const safeRepo = encodeURIComponent(repo);
    const res = await fetch(`/api/ai/conversations?repo=${safeRepo}`);
    if (!res.ok) throw new Error(`Failed to list conversations: ${res.status}`);
    const data = await res.json();
    return data.conversations || [];
  }

  /**
   * Create a new conversation for a repository
   */
  static async createConversation(repo, title = '') {
    const res = await fetch('/api/ai/conversations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repo, title }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `Failed to create conversation: ${res.status}`);
    }
    const data = await res.json();
    return data.conversation;
  }

  /**
   * Get conversation details with full message history
   */
  static async getConversation(conversationId) {
    const res = await fetch(`/api/ai/conversations/${encodeURIComponent(conversationId)}`);
    if (!res.ok) {
      if (res.status === 404) return null;
      throw new Error(`Failed to retrieve conversation: ${res.status}`);
    }
    const data = await res.json();
    return data.conversation;
  }

  /**
   * Delete an existing conversation
   */
  static async deleteConversation(conversationId) {
    const res = await fetch(`/api/ai/conversations/${encodeURIComponent(conversationId)}`, {
      method: 'DELETE',
    });
    return res.ok;
  }

  /**
   * Stream a chat completion from GitStory AI using Server-Sent Events (SSE)
   */
  static async streamChat({
    repo,
    conversationId,
    query,
    token = '',
    onMetadata,
    onChunk,
    onDone,
    onError,
    signal,
  }) {
    let response;
    try {
      response = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          repo,
          conversationId,
          query,
          stream: true,
          token,
        }),
        signal,
      });
    } catch (err) {
      if (err.name === 'AbortError') return;
      if (onError) onError(err);
      throw err;
    }

    if (!response.ok) {
      let errData = {};
      try {
        errData = await response.json();
      } catch {
        // ignore
      }
      const error = new Error(errData.error || `Request failed with status ${response.status}`);
      error.code = errData.code;
      error.details = errData.details;
      if (onError) onError(error);
      throw error;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    let accumulatedText = '';
    let currentEvent = 'message';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) {
            currentEvent = 'message';
            continue;
          }

          if (trimmed.startsWith('event: ')) {
            currentEvent = trimmed.slice(7).trim();
            continue;
          }

          if (trimmed.startsWith('data: ')) {
            const dataStr = trimmed.slice(6);
            try {
              const payload = JSON.parse(dataStr);
              if (currentEvent === 'metadata') {
                if (onMetadata) onMetadata(payload);
              } else if (currentEvent === 'chunk') {
                accumulatedText += payload.delta;
                if (onChunk) onChunk(payload.delta, accumulatedText);
              } else if (currentEvent === 'done') {
                if (onDone) onDone(accumulatedText, payload);
              } else if (currentEvent === 'error') {
                const streamErr = new Error(payload.error || 'Streaming error');
                streamErr.code = payload.code;
                if (onError) onError(streamErr);
              }
            } catch (jsonErr) {
              // Ignore partial JSON
            }
          }
        }
      }

      if (onDone) onDone(accumulatedText);
    } catch (streamErr) {
      if (streamErr.name === 'AbortError') return;
      if (onError) onError(streamErr);
      throw streamErr;
    }
  }

  /**
   * Generate or retrieve cached repository summary
   */
  static async generateSummary({ repo, scope = 'repo', target = '', token = '' }) {
    const res = await fetch('/api/ai/summary', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repo, scope, target, token }),
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      const error = new Error(errData.error || `Summary request failed (${res.status})`);
      error.code = errData.code;
      error.details = errData.details;
      throw error;
    }

    return res.json();
  }

  /**
   * Fetch specific file content with lines
   */
  static async getFileContent(repo, filePath) {
    const safeRepo = encodeURIComponent(repo);
    const safePath = encodeURIComponent(filePath);
    const res = await fetch(`/api/ai/file?repo=${safeRepo}&path=${safePath}`);
    if (!res.ok) {
      throw new Error(`Failed to load file: ${res.status}`);
    }
    return res.json();
  }
}
