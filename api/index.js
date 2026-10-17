import { handleAiApiRequest } from '../server/routes.js';

/**
 * Vercel Serverless Function Handler for GitStory AI API
 * Handles all /api/ai/* endpoints (health, config, conversations, chat streaming, summaries, files)
 */
export default async function handler(req, res) {
  try {
    return await handleAiApiRequest(req, res);
  } catch (err) {
    console.error('[Vercel Serverless Error]', err);
    const status = err.status || 500;
    const code = err.code || 'SERVERLESS_ERROR';
    if (typeof res.status === 'function' && typeof res.json === 'function') {
      return res.status(status).json({
        error: err.message || 'Internal Serverless Error',
        code,
      });
    }
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({
      error: err.message || 'Internal Serverless Error',
      code,
    }));
  }
}
