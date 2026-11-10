import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'

// Static build, relative base so it can be served from any path. results/*.json at the repo root
// are imported directly, so the numbers on screen are the files the ML scripts wrote.
export default defineConfig({
  base: './',
  plugins: [react()],
  resolve: { alias: { '@results': path.resolve(__dirname, '../results') } },
  server: { fs: { allow: ['..'] } },
  build: { chunkSizeWarningLimit: 1600 },
})
