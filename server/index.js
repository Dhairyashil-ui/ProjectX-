import http from 'http';
import { handleAiApiRequest } from './routes.js';
import { config } from './config.js';

/**
 * Vite plugin that mounts the backend /api/ai endpoints into the Vite dev server
 */
export function gitStoryAiBackendPlugin() {
  return {
    name: 'gitstory-ai-backend',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (req.url && req.url.startsWith('/api/')) {
          try {
            await handleAiApiRequest(req, res);
          } catch (err) {
            console.error('[Backend Middleware Error]', err);
            res.statusCode = 500;
            res.end(JSON.stringify({ error: err.message, code: 'INTERNAL_ERROR' }));
          }
        } else {
          next();
        }
      });
      console.log(`[GitStory Backend] Mounted /api endpoints on Vite server with model: ${config.GROQ.MODEL}`);
    },
  };
}

/**
 * Standalone Node HTTP server for testing or production deployment
 */
export function startStandaloneServer(port = 3001) {
  const server = http.createServer(async (req, res) => {
    // Add CORS headers for standalone mode
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      return res.end();
    }

    if (req.url && req.url.startsWith('/api/')) {
      await handleAiApiRequest(req, res);
    } else {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));
    }
  });

  server.listen(port, () => {
    console.log(`[GitStory AI Server] Running on http://localhost:${port}`);
  });

  return server;
}

// Start standalone if executed directly via CLI
if (process.argv[1] && process.argv[1].endsWith('index.js')) {
  startStandaloneServer(process.env.PORT || 3001);
}
