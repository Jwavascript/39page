/**
 * M11-6 — 출시 ZIP 만들기(`scripts/package.mjs`)가 빌드의 모든 HTML 입구를 받는다.
 *
 * 재현: M11-5 가 패널 · offscreen 입구를 더했지만 패키지 허용 목록은 팝업만 알아 `npm run package` 가
 * "예상하지 못한 파일 — src/offscreen/index.html · src/panel/index.html" 로 멈췄다.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const ROOT = resolve(__dirname, '..')
const read = (path: string) => readFileSync(resolve(ROOT, path), 'utf8')

describe('출시 ZIP', () => {
  it('vite 입구의 HTML 페이지가 모두 패키지 허용 목록과 필수 목록에 있다', () => {
    const entries = [...read('vite.config.ts').matchAll(/'\.\/(src\/[a-z]+\/index\.html)'/g)].map(
      (match) => match[1] as string,
    )
    expect(entries.sort()).toEqual([
      'src/offscreen/index.html',
      'src/panel/index.html',
      'src/popup/index.html',
    ])
    const script = read('scripts/package.mjs')
    const allowed = new RegExp(/const ALLOWED =\s*\/(.+)\/\n/.exec(script)?.[1] ?? '^$')
    for (const entry of entries) {
      expect({ entry, allowed: allowed.test(entry) }).toEqual({ entry, allowed: true })
      expect(script).toContain(`'${entry}'`)
    }
  })
})
