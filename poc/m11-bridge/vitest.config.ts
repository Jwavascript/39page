/**
 * M11-1 PoC 단위 시험 — 루트 `npm test` 와 분리한다 (실험 코드).
 *
 *   npx vitest run --config poc/m11-bridge/vitest.config.ts
 */
import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('../../src', import.meta.url)) } },
  test: {
    root: fileURLToPath(new URL('../../', import.meta.url)),
    environment: 'jsdom',
    setupFiles: ['tests/setup/noNetwork.ts'],
    include: ['poc/m11-bridge/tests/**/*.spec.ts'],
  },
})
