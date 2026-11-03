import { fileURLToPath } from 'node:url'
import { mergeConfig, defineConfig, configDefaults } from 'vitest/config'
import viteConfig from './vite.config.ts'

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: 'jsdom',
      // Tests live in `tests/`; co-located `__tests__` folders are also picked up.
      include: ['tests/**/*.{test,spec}.{ts,tsx}', 'src/**/__tests__/*.{test,spec}.{ts,tsx}'],
      exclude: [...configDefaults.exclude],
      /*
       * 기본값 5초는 이 개발 기기(8코어 Android/Termux)에서 전체 실행 시
       * 간헐적으로 모자란다. 앱을 마운트하는 통합 테스트가 병렬 부하 아래
       * 5초를 넘겨 **단독 실행에서는 통과하는데** 전체 실행에서 터진다.
       * 검증을 약화시키지 않고 한도만 올린다.
       */
      testTimeout: 15_000,
      root: fileURLToPath(new URL('./', import.meta.url)),
    },
  }),
)
