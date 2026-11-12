import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueDevTools from 'vite-plugin-vue-devtools'

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue(), vueDevTools()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    rolldownOptions: {
      /*
       * 두 입구 — 대시보드(`index.html`)와 확장 저장 브리지(`bridge.html`, M11-5 · ADR 0028).
       * 브리지는 대시보드를 싣지 않는다 (Pinia + 라이브러리 · Moments store 만).
       */
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        bridge: fileURLToPath(new URL('./bridge.html', import.meta.url)),
      },
    },
  },
})
