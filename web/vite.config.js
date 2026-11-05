import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [vue(), tailwindcss()],
  // 5173 is often taken by other Vite apps; keep Verdikt on its own port
  server: { port: 5180, strictPort: true, host: '127.0.0.1' },
  preview: { port: 4180, strictPort: true, host: '127.0.0.1' },
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
})
