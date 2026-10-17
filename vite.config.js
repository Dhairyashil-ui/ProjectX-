import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { gitStoryAiBackendPlugin } from './server/index.js'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    gitStoryAiBackendPlugin()
  ],
  server: {
    port: 5173,
    open: false,
    host: true
  }
})
