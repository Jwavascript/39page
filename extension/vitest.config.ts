import { fileURLToPath } from 'node:url'
import { mergeConfig, defineConfig, configDefaults } from 'vitest/config'
import viteConfig from './vite.config.ts'

export default defineConfig((env) =>
  mergeConfig(
    viteConfig(env),
    defineConfig({
      test: {
        environment: 'jsdom',
        include: ['tests/**/*.{test,spec}.ts'],
        // Node 25+ 의 전역 Web Storage 가 jsdom 것을 가리지 않게 (웹앱 tests/setup/webStorage.ts 와 같다).
        setupFiles: ['tests/support/webStorage.ts'],
        exclude: [...configDefaults.exclude],
        // 웹앱과 같은 이유로 올린다 — 이 기기(Termux)에서 병렬 실행이 느리다.
        testTimeout: 15_000,
        root: fileURLToPath(new URL('./', import.meta.url)),
      },
    }),
  ),
)
