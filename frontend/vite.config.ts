import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const reactCalendarTimelineRoot = path.resolve(__dirname, '../vendor/react-calendar-timeline')

/** Emit browser source maps for production builds (larger deploy). Set Heroku config var SOURCEMAP=1 or run `SOURCEMAP=1 npm run build`. */
const prodSourcemap =
  process.env.SOURCEMAP === '1' ||
  process.env.SOURCEMAP === 'true' ||
  process.env.VITE_SOURCEMAP === '1'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    // The app depends on `file:../vendor/react-calendar-timeline`, which can leave nested
    // `react` / `react-dom` under that package. Force a single React instance so hooks
    // (e.g. useContext) match the app tree — fixes "Cannot read properties of null (reading 'useContext')" on schedule.
    alias: {
      react: path.resolve(__dirname, 'node_modules/react'),
      'react-dom': path.resolve(__dirname, 'node_modules/react-dom'),
      'react/jsx-runtime': path.resolve(__dirname, 'node_modules/react/jsx-runtime'),
      'react/jsx-dev-runtime': path.resolve(__dirname, 'node_modules/react/jsx-dev-runtime'),
    },
    dedupe: ['react', 'react-dom'],
  },
  build: {
    sourcemap: prodSourcemap,
  },
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
