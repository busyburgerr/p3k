import { defineConfig } from 'vite'
import vueJsx from '@vitejs/plugin-vue-jsx'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  plugins: [vueJsx()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  // localhost на Windows резолвится только в ::1, и браузер не достучится по 127.0.0.1
  server: { host: '127.0.0.1', port: 3000 },
})
