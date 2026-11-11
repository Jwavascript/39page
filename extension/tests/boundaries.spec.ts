/**
 * 구조 규칙을 고정한다 — ADR 0022 · 0023, EXTENSION_DESIGN.md §1 · §7.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const ROOT = process.cwd()
const SRC = resolve(ROOT, 'src')

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? sourceFiles(path) : [path]
  })
}

const files = sourceFiles(SRC).filter((path) => /\.(ts|vue|html|css)$/.test(path))
const read = (path: string) => readFileSync(path, 'utf8')

/**
 * 주석을 뺀 코드. 규칙을 적은 주석("`v-html` 금지")에 걸리지 않고 코드만 본다.
 * 블록 주석 · 줄 주석(`://` 는 남긴다) · HTML 주석.
 */
const code = (path: string) =>
  read(path)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/(^|[^:\\])\/\/.*$/gm, '$1')
const rel = (path: string) => relative(ROOT, path)

/** 패턴에 걸리는 파일 목록 — 비어 있어야 한다. 실패하면 어느 파일인지 보인다. */
const offenders = (paths: string[], pattern: RegExp) =>
  paths.filter((path) => pattern.test(code(path))).map(rel)

/** 웹앱에서 가져와도 되는 것 — 의존성 없는 순수 모듈과 변수뿐인 토큰 CSS. */
const WEB_IMPORT_ALLOWLIST = [
  '@web/shared/utils/youtube',
  '@web/shared/utils/time',
  '@web/styles/tokens.css',
  '@web/themes/mono-vinyl/tokens.css',
]

describe('구조 규칙', () => {
  it('웹앱 코드는 허용 목록만 가져온다', () => {
    const found = files.flatMap((path) =>
      [...code(path).matchAll(/from\s+'(@web\/[^']+)'|import\s+'(@web\/[^']+)'/g)].map(
        (match) => match[1] ?? match[2],
      ),
    )
    expect(found.length).toBeGreaterThan(0)
    for (const specifier of found) expect(WEB_IMPORT_ALLOWLIST).toContain(specifier)
  })

  it('상대 경로로 웹앱 src 에 닿지 않는다 (별칭을 우회하지 않는다)', () => {
    expect(offenders(files, /from\s+'(\.\.\/){2,}/)).toEqual([])
  })

  it('shared 는 chrome API 를 부르지 않는다', () => {
    expect(
      offenders(
        files.filter((p) => p.includes(`${SRC}/shared/`)),
        /\bchrome\./,
      ),
    ).toEqual([])
  })

  it('컴포넌트는 chrome API 를 직접 부르지 않는다 (bridge 만)', () => {
    expect(
      offenders(
        files.filter((p) => p.endsWith('.vue')),
        /\bchrome\./,
      ),
    ).toEqual([])
  })

  it('v-html · innerHTML 쓰기가 없다 — 페이지에서 온 제목을 HTML 로 해석하지 않는다', () => {
    expect(offenders(files, /v-html|\.innerHTML\s*=|insertAdjacentHTML/)).toEqual([])
  })

  it('네트워크 요청이 없다 (fetch · XMLHttpRequest · WebSocket · sendBeacon)', () => {
    expect(offenders(files, /\bfetch\s*\(|XMLHttpRequest|new WebSocket|sendBeacon/)).toEqual([])
  })

  it('저장소에 손대지 않는다 — 이 단계는 아무것도 저장하지 않는다', () => {
    expect(offenders(files, /localStorage|sessionStorage|chrome\.storage|indexedDB/)).toEqual([])
  })

  it('content script 는 페이지의 postMessage 를 듣지 않는다', () => {
    expect(
      offenders(
        files.filter((p) => p.includes(`${SRC}/content/`)),
        /addEventListener\(\s*'message'|postMessage/,
      ),
    ).toEqual([])
  })

  it('외부 연결을 받는 리스너가 없다 (onMessageExternal · onConnectExternal)', () => {
    expect(offenders(files, /onMessageExternal|onConnectExternal/)).toEqual([])
  })
})

describe('manifest 원본 (EXTENSION_DESIGN.md §7)', () => {
  const manifest = JSON.parse(read(resolve(ROOT, 'manifest.json'))) as Record<string, unknown>
  const pkg = JSON.parse(read(resolve(ROOT, 'package.json'))) as { version: string }

  it('MV3 · 권한은 activeTab 과 scripting 뿐', () => {
    expect(manifest.manifest_version).toBe(3)
    expect(manifest.permissions).toEqual(['activeTab', 'scripting'])
  })

  it('상시 접근·외부 연결 키가 없다', () => {
    for (const key of [
      'host_permissions',
      'optional_host_permissions',
      'content_scripts',
      'externally_connectable',
      'web_accessible_resources',
      'content_security_policy',
    ]) {
      expect(Object.keys(manifest)).not.toContain(key)
    }
  })

  it('서비스 워커는 모듈이고 이름이 빌드 산출물과 같다', () => {
    expect(manifest.background).toEqual({ service_worker: 'background.js', type: 'module' })
    expect((manifest.action as { default_popup: string }).default_popup).toBe(
      'src/popup/index.html',
    )
  })

  it('버전이 package.json 과 같다', () => {
    expect(manifest.version).toBe(pkg.version)
  })
})
