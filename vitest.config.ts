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
      root: fileURLToPath(new URL('./', import.meta.url)),
    },
  }),
)
