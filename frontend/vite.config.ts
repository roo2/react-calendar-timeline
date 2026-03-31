import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const reactCalendarTimelineRoot = path.resolve(__dirname, '../vendor/react-calendar-timeline')

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    fs: {
      // Custom `allow` replaces defaults; include app root (index.html) and the linked fork.
      allow: [__dirname, reactCalendarTimelineRoot],
    },
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
})
