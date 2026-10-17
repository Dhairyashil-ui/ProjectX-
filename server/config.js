import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');

// Simple zero-dependency .env loader
function loadEnv() {
  const envPath = path.join(PROJECT_ROOT, '.env');
  if (fs.existsSync(envPath)) {
    try {
      const content = fs.readFileSync(envPath, 'utf8');
      const lines = content.split(/\r?\n/);
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx > 0) {
          const key = trimmed.slice(0, eqIdx).trim();
          const val = trimmed.slice(eqIdx + 1).trim().replace(/^['"]|['"]$/g, '');
          if (!process.env[key]) {
            process.env[key] = val;
          }
        }
      }
    } catch (err) {
      console.warn('[Config] Could not parse .env file:', err.message);
    }
  }
}

loadEnv();

export const config = {
  PROJECT_ROOT,
  DATA_DIR: process.env.VERCEL ? path.join('/tmp', 'gitstory_data') : path.join(__dirname, 'data'),
  GROQ: {
    API_KEY: process.env.GROQ_API_KEY || '',
    MODEL: process.env.GROQ_MODEL || 'qwen/qwen3.8-27b',
    BASE_URL: process.env.GROQ_BASE_URL || 'https://api.groq.com/openai/v1',
    MAX_TOKENS: 1024, // Minimal output token footprint
    TEMPERATURE: 0.1,
    TIMEOUT_MS: 30000,
  },
  GITHUB: {
    TOKEN: process.env.GITHUB_TOKEN || '',
    API_BASE: 'https://api.github.com',
  },
  RETRIEVAL: {
    MAX_CANDIDATE_FILES: 4, // Targeted concise evidence
    MAX_FILE_LINES: 50,      // Focused snippet length to save input tokens
    MAX_SEARCH_RESULTS: 8,
    MAX_CONTEXT_MESSAGES: 6, // Concise sliding window
  }
};

/**
 * Dynamically update Groq API key or model in memory and persist to .env
 */
export function updateGroqConfig({ apiKey, model }) {
  if (apiKey !== undefined) {
    config.GROQ.API_KEY = apiKey.trim();
    process.env.GROQ_API_KEY = apiKey.trim();
  }
  if (model !== undefined) {
    config.GROQ.MODEL = model.trim();
    process.env.GROQ_MODEL = model.trim();
  }

  // Update .env file
  try {
    const envPath = path.join(PROJECT_ROOT, '.env');
    let currentContent = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
    
    if (apiKey) {
      if (/^GROQ_API_KEY=/m.test(currentContent)) {
        currentContent = currentContent.replace(/^GROQ_API_KEY=.*$/m, `GROQ_API_KEY=${config.GROQ.API_KEY}`);
      } else {
        currentContent += `\nGROQ_API_KEY=${config.GROQ.API_KEY}`;
      }
    }
    if (model) {
      if (/^GROQ_MODEL=/m.test(currentContent)) {
        currentContent = currentContent.replace(/^GROQ_MODEL=.*$/m, `GROQ_MODEL=${config.GROQ.MODEL}`);
      } else {
        currentContent += `\nGROQ_MODEL=${config.GROQ.MODEL}`;
      }
    }
    fs.writeFileSync(envPath, currentContent.trim() + '\n', 'utf8');
  } catch (err) {
    console.error('[Config] Failed to update .env:', err.message);
  }

  return { success: true, model: config.GROQ.MODEL, hasKey: Boolean(config.GROQ.API_KEY) };
}
