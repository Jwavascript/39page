import { readFileSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'

import { defineConfig, loadEnv, type Plugin } from 'vite'
import vue from '@vitejs/plugin-vue'

import { resolveCollectOrigin } from './src/shared/collectOrigin'

/**
 * 확장 본 빌드 — Popup(HTML) 과 Background 서비스 워커 (ADR 0022 결정 3).
 *
 * content script 는 모듈이 아닌 한 파일이어야 해서 따로 빌드한다
 * (`vite.content.config.ts`). 두 빌드가 같은 `dist/` 를 쓰므로 이 빌드가 먼저
 * 비우고, content 빌드는 비우지 않는다.
 */

/** 아이콘 크기 (M10-6). manifest 가 가리키는 파일과 같아야 한다 — 검사기가 확인한다. */
const ICON_SIZES = [16, 32, 48, 128] as const

/**
 * 원본 `manifest.json` 과 아이콘(`icons/icon-<크기>.png`)을 그대로 내보낸다. 깨진 JSON 이면
 * 빌드를 멈춘다. 정적 폴더(publicDir)를 쓰지 않으므로 dist 에 들어가는 것은 이 목록뿐이다.
 */
function emitManifest(): Plugin {
  return {
    name: '39page-emit-manifest',
    generateBundle() {
      const source = readFileSync(new URL('./manifest.json', import.meta.url), 'utf8')
      JSON.parse(source)
      this.emitFile({ type: 'asset', fileName: 'manifest.json', source })
      for (const size of ICON_SIZES) {
        const fileName = `icons/icon-${String(size)}.png`
        this.emitFile({
          type: 'asset',
          fileName,
          source: readFileSync(new URL(`./${fileName}`, import.meta.url)),
        })
      }
    },
  }
}

export default defineConfig(({ mode }) => {
  /*
   * 수집 화면 origin (M10-3). 운영 빌드는 https://39page.com 고정이고, 개발 빌드만
   * 허용 목록의 localhost 를 쓸 수 있다. 틀리면 여기서 빌드가 멈춘다.
   */
  const env = {
    ...loadEnv(mode, fileURLToPath(new URL('.', import.meta.url)), 'VITE_'),
    ...process.env,
  }
  const collectOrigin = resolveCollectOrigin(mode, env.VITE_COLLECT_ORIGIN)

  return {
    define: { __COLLECT_ORIGIN__: JSON.stringify(collectOrigin) },
    plugins: [vue(), emitManifest()],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
        '@web': fileURLToPath(new URL('../src', import.meta.url)),
      },
    },
    // 정적 파일 폴더를 쓰지 않는다. dist 에 들어가는 것은 빌드가 만든 것뿐이다.
    publicDir: false,
    build: {
      outDir: 'dist',
      emptyOutDir: true,
      sourcemap: false,
      // 확장 페이지 CSP 는 인라인 스크립트를 막는다. 폴리필도 필요 없다 (최신 Chrome).
      modulePreload: { polyfill: false },
      rolldownOptions: {
        input: {
          popup: fileURLToPath(new URL('./src/popup/index.html', import.meta.url)),
          background: fileURLToPath(new URL('./src/background/index.ts', import.meta.url)),
        },
        output: {
          // manifest 가 이름으로 가리키므로 해시를 붙이지 않는다.
          entryFileNames: (chunk) =>
            chunk.name === 'background' ? 'background.js' : 'assets/[name]-[hash].js',
        },
      },
    },
  }
})
