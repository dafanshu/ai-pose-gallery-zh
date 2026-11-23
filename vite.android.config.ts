import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  base: './',
  publicDir: false,
  define: { __ANDROID_STUDIO__: true },
  plugins: [
    {
      name: 'android-studio-shell',
      transformIndexHtml: { order: 'pre', handler: () => `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; form-action 'none'; base-uri 'none'; object-src 'none'">
  <title>角色工作台</title>
</head>
<body>
  <div id="root"></div>
  <script type="module" src="/src/main.tsx"></script>
</body>
</html>` },
    },
    tanstackRouter({ target: 'react', autoCodeSplitting: true }),
    react(),
    tailwindcss(),
  ],
  resolve: { alias: { '@': path.resolve(import.meta.dirname, './src') } },
  build: { outDir: 'mobile/android/www', emptyOutDir: true },
})
