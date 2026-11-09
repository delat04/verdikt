import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [vue(), tailwindcss()],
  // 5173 is often taken by other Vite apps; keep Verdikt on its own port
  server: { port: 5180, strictPort: true, host: '127.0.0.1' },
  preview: { port: 4180, strictPort: true, host: '127.0.0.1' },
  // Bryntum's themes use modern CSS that an older default target would rewrite away in the build
  build: { cssTarget: ['chrome123', 'edge123', 'firefox120', 'safari17.5'] },
  // Every AG package pre-bundles in one pass, so dev loads a single AG Grid: with two, Studio's theme belongs to
  // one copy and its widgets render with the other (AG Grid error #240) and never finish loading
  optimizeDeps: {
    include: ['ag-grid-community', 'ag-grid-vue3', 'ag-grid-enterprise', 'ag-charts-community', 'ag-charts-enterprise', 'ag-stack', 'ag-studio', 'ag-studio-vue3'],
  },
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
})
