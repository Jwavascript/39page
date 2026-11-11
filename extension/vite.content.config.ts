import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vite'

/**
 * content script 빌드 — `content.js` 한 파일, IIFE.
 *
 * `scripting.executeScript({ files })` 로 주입하는 파일은 ES 모듈이 아니다.
 * import 가 남으면 실행되지 않으므로 모든 것을 한 파일에 넣는다 (ADR 0022 결정 3).
 */
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@web': fileURLToPath(new URL('../src', import.meta.url)),
    },
  },
  publicDir: false,
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    sourcemap: false,
    lib: {
      entry: fileURLToPath(new URL('./src/content/index.ts', import.meta.url)),
      formats: ['iife'],
      name: 'page39Content',
      fileName: () => 'content.js',
    },
  },
})
