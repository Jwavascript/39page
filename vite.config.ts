import { fileURLToPath, URL } from 'node:url'

import { defineConfig, loadEnv, type Plugin } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueDevTools from 'vite-plugin-vue-devtools'

/** Chrome 확장 ID — a–p 32자. */
const EXTENSION_ID = /^[a-p]{32}$/
/** 개발 · 시험용 고정 ID (확장 개발 빌드의 공개 키, ADR 0028 결정 14). 운영 빌드에 들어가면 안 된다. */
const DEV_EXTENSION_ID = 'pkagnijdhfmkodpdfgdehfdghcgbfpoa'

/**
 * 브리지를 부를 수 있는 확장 ID (`VITE_BRIDGE_EXTENSION_IDS`, 쉼표) — 빌드 때 검사한다 (M11-6).
 * 형식이 틀린 값이 있으면 빌드를 멈춘다(조용히 버리면 운영 브리지가 이유 없이 꺼진다). 개발 ID 는
 * `VITE_BRIDGE_DEV_BUILD=1` 인 시험 빌드에서만 받는다 — 운영 산출물에 섞이지 않게.
 */
export function bridgeExtensionIds(env: Record<string, string | undefined>): string[] {
  const ids = (env.VITE_BRIDGE_EXTENSION_IDS ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter((id) => id !== '')
  const bad = ids.filter((id) => !EXTENSION_ID.test(id))
  if (bad.length > 0) throw new Error(`VITE_BRIDGE_EXTENSION_IDS 형식이 아니다 — ${bad.join(', ')}`)
  if (ids.includes(DEV_EXTENSION_ID) && env.VITE_BRIDGE_DEV_BUILD !== '1') {
    throw new Error(
      '개발용 확장 ID 가 브리지 허용 목록에 있다 — 시험 빌드면 VITE_BRIDGE_DEV_BUILD=1 을 함께 준다',
    )
  }
  return ids
}

/**
 * `bridge.html` 의 응답 헤더 (Cloudflare Workers 정적 자원 `_headers`, M11-6).
 *
 * `frame-ancestors` — 허용한 확장의 문서만 이 페이지를 액자로 띄울 수 있다. 목록이 비면 `'none'`
 * (브리지 꺼짐과 같다). 스크립트의 조상 확인(`bridgeHost.ts`)이 1차 방어이고 이것은 한 겹 더다.
 * Workers 정적 자원은 기본 `html_handling` 에서 `/bridge.html` 을 `/bridge` 로 옮기므로 둘 다 둔다.
 */
export function bridgeHeaders(ids: readonly string[]): string {
  const ancestors =
    ids.length === 0 ? "'none'" : ids.map((id) => `chrome-extension://${id}`).join(' ')
  const block = [
    `  Content-Security-Policy: frame-ancestors ${ancestors}`,
    '  X-Content-Type-Options: nosniff',
    '  Referrer-Policy: no-referrer',
  ].join('\n')
  return `/bridge.html\n${block}\n/bridge\n${block}\n`
}

function emitBridgeHeaders(ids: readonly string[]): Plugin {
  return {
    name: '39page-bridge-headers',
    apply: 'build',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: '_headers', source: bridgeHeaders(ids) })
    },
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const ids = bridgeExtensionIds({ ...loadEnv(mode, process.cwd(), 'VITE_'), ...process.env })
  return {
    plugins: [vue(), vueDevTools(), emitBridgeHeaders(ids)],
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
  }
})
