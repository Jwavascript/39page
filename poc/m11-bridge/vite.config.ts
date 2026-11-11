/**
 * M11-1 저장 브리지 PoC 빌드 — **운영 빌드와 분리**.
 *
 * 운영 `npm run build` 는 루트 `vite.config.ts` 로 `index.html` 하나만 만든다 (이 파일을 읽지
 * 않는다). 이 설정은 같은 origin 에서 대시보드와 브리지가 **같은 저장소**를 쓰도록 셋을 함께
 * 만든다 — 대시보드(`index.html`) · 브리지 · 탐침. 산출물은 `poc/m11-bridge/dist/web` (Git 제외).
 *
 *   npx vite build   --config poc/m11-bridge/vite.config.ts
 *   npx vite preview --config poc/m11-bridge/vite.config.ts   # http://127.0.0.1:4173
 */
import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

const repoRoot = fileURLToPath(new URL('../../', import.meta.url))
const here = (path: string): string => fileURLToPath(new URL(path, import.meta.url))

export default defineConfig({
  root: repoRoot,
  plugins: [vue()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('../../src', import.meta.url)) },
  },
  publicDir: fileURLToPath(new URL('../../public', import.meta.url)),
  build: {
    outDir: here('./dist/web'),
    emptyOutDir: true,
    sourcemap: false,
    rolldownOptions: {
      input: {
        index: fileURLToPath(new URL('../../index.html', import.meta.url)),
        bridge: here('./web/bridge.html'),
        probe: here('./web/probe.html'),
      },
    },
  },
  preview: { host: '127.0.0.1', port: 4173, strictPort: true },
})
