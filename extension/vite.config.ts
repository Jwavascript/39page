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
 * 개발 빌드 전용 공개 키 (M11-5) — 압축해제 설치의 확장 ID 를 `pkagnijdhfmkodpdfgdehfdghcgbfpoa` 로
 * 고정한다 (M11-1 PoC 와 같은 키, 개인 키는 저장소에 없다). 39page 개발 빌드가 이 ID 를 브리지 허용
 * 목록에 넣는다. **운영 빌드에는 넣지 않는다** — 검사기(`check-manifest.mjs`)가 `key` 를 막는다.
 */
const DEV_EXTENSION_KEY =
  'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAtQtVG8fSbzjMJlJ+HsQt5JoeKTPG6TNMcRmi8Nl9T8ZsAxp+HK53clyX0UGJ6T1C60b3w6guWkMnZAqZA+Yf4AigQtAyvH63zakQbva9y0FYYF+4aLOhGNSxyJ4CgLisk/sD15icEQA0+1gab2v5/HfjHDHEopyakn7kvE96wTsXTt0W2673CPpv+da9Lw8gNpQ/A2WHSspw7a1ahx6RQpNh3yl4BSgKJKB9gkB9mb3zFiu2fx/1ZVtRsQ8sjvj2yS7LdEdtVSsWBNUw0PQIYGW+e2lhtuwx8OUIkFTT54xdMghk4vxRYOx8kfpngaW9+U4ikolhmDIlGZ5jGYQcHQIDAQAB'

/**
 * 원본 `manifest.json` 과 아이콘(`icons/icon-<크기>.png`)을 내보낸다. 깨진 JSON 이면 빌드를 멈춘다.
 * 정적 폴더(publicDir)를 쓰지 않으므로 dist 에 들어가는 것은 이 목록뿐이다.
 *
 * 개발 빌드만 바꾼다 (M11-5): 39page 호스트 권한을 개발 origin 으로, 그리고 고정 ID 용 `key`.
 * 운영 빌드는 원본 그대로다 — `https://39page.com/*` 하나.
 */
function emitManifest(mode: string, collectOrigin: string): Plugin {
  return {
    name: '39page-emit-manifest',
    generateBundle() {
      const raw = readFileSync(new URL('./manifest.json', import.meta.url), 'utf8')
      const manifest = JSON.parse(raw) as Record<string, unknown>
      const source =
        mode === 'development'
          ? `${JSON.stringify(
              {
                ...manifest,
                key: DEV_EXTENSION_KEY,
                optional_host_permissions: [`${collectOrigin}/*`],
              },
              null,
              2,
            )}
`
          : raw
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
    plugins: [vue(), emitManifest(mode, collectOrigin)],
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
          // 39page 저장 브리지를 띄우는 offscreen 문서 (M11-5).
          offscreen: fileURLToPath(new URL('./src/offscreen/index.html', import.meta.url)),
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
