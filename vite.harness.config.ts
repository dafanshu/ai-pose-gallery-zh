import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Separate build: the original site config and deployment are untouched.
export default defineConfig({
  base: '/api/ai-pose-studio/app/',
  publicDir: false,
  plugins: [tanstackRouter({ target: 'react', autoCodeSplitting: true }), react(), tailwindcss()],
  resolve: { alias: { '@': path.resolve(import.meta.dirname, './src') } },
  build: { outDir: 'harness/app', emptyOutDir: true },
})
