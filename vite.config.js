import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// Config estándar de Vite + Vue. El backend ahora vive en
// functions/api/ (Cloudflare Pages Functions + D1), así que en
// desarrollo lo levantás aparte con `npm run pages:dev` (wrangler,
// puerto 8788 por defecto) y este proxy lo conecta a `npm run dev`.
export default defineConfig({
  plugins: [vue()],
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:8788',
        changeOrigin: true,
      },
    },
  },
})