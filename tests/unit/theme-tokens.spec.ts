import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { THEMES, THEME_LIST, getThemeMetadata } from '@/themes'
import { DEFAULT_THEME_KEY, THEME_KEYS, type ThemeKey } from '@/shared/types'

/*
 * 토큰 값과 승인된 레퍼런스의 **정적 비교**.
 *
 * jsdom은 CSS 커스텀 프로퍼티의 계산값을 신뢰할 수 있게 돌려주지 않으므로
 * (`getComputedStyle`로 변수 상속·속성 선택자 해석을 검증할 수 없다)
 * 여기서는 파일 텍스트를 직접 비교한다. 브라우저에서의 실제 적용 확인은
 * 별도로 수행하고 보고한다.
 *
 * 우선순위 규칙에 따라 two-themes-v09.html을 기준으로 삼는다.
 * v09는 mono-vinyl-v08.html의 상위집합이다 (design/references/README.md).
 */

/**
 * 프로젝트 루트 기준으로 파일을 읽는다.
 *
 * `import.meta.url`을 쓰지 않는다. Vue 모듈 그래프를 끌어들이는 spec에서는
 * Vitest 변환 방식에 따라 file: URL이 아닐 수 있다.
 */
function readFile(relative: string): string {
  return readFileSync(resolve(process.cwd(), relative), 'utf8')
}

const REFERENCE_V09 = readFile('design/references/two-themes-v09.html')
const REFERENCE_V08 = readFile('design/references/mono-vinyl-v08.html')

const SHARED_TOKENS_CSS = readFile('src/styles/tokens.css')
const BASE_CSS = readFile('src/styles/base.css')
const THEME_CSS: Record<ThemeKey, string> = {
  'mono-vinyl': readFile('src/themes/mono-vinyl/tokens.css'),
  'kawaii-synth-cassette': readFile('src/themes/kawaii-synth-cassette/tokens.css'),
}

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '')
}

/** `#fff` / `#0005` 같은 축약형을 6·8자리로 펼쳐 비교 가능하게 만든다. */
function normalizeHex(hex: string): string {
  const body = hex.slice(1).toLowerCase()
  if (body.length === 3 || body.length === 4) {
    return `#${[...body].map((c) => c + c).join('')}`
  }
  return `#${body}`
}

function hexesIn(text: string): string[] {
  return (text.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []).map(normalizeHex)
}

/** 테마 파일의 선언 블록에서 커스텀 프로퍼티를 뽑는다. */
function tokensOf(css: string): Map<string, string> {
  const clean = stripComments(css)
  const body = clean.slice(clean.indexOf('{') + 1, clean.lastIndexOf('}'))
  const tokens = new Map<string, string>()
  for (const decl of body.split(';')) {
    const match = /^\s*(--[a-z0-9-]+)\s*:\s*([\s\S]+)$/.exec(decl)
    if (match) {
      const [, name, value] = match
      if (name !== undefined && value !== undefined) {
        tokens.set(name, value.trim())
      }
    }
  }
  return tokens
}

/** 레퍼런스 CSS에서 특정 선택자의 특정 속성 값을 찾는다. */
function referenceDeclaration(html: string, selector: string, property: string): string {
  // 주석을 먼저 지운다. 레퍼런스에는 선택자 바로 앞에 주석이 붙은 규칙이 있다.
  const css = stripComments(/<style>([\s\S]*?)<\/style>/.exec(html)?.[1] ?? '')
  // matchAll은 0번이 전체 매치다. 캡처 그룹은 1번부터다.
  for (const [, rawSelector, rawBody] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = (rawSelector ?? '').split(',').map((s) => s.replace(/\s+/g, ' ').trim())
    if (!selectors.includes(selector)) continue
    for (const decl of (rawBody ?? '').split(';')) {
      const index = decl.indexOf(':')
      if (index === -1) continue
      if (decl.slice(0, index).trim() === property) {
        return decl.slice(index + 1).trim()
      }
    }
  }
  throw new Error(`reference declaration not found: ${selector} { ${property} }`)
}

/** 공백을 모두 제거해 포맷 차이를 무시하고 값만 비교한다. */
function squash(value: string): string {
  return value.replace(/\s+/g, '').toLowerCase()
}

const REFERENCE_HEXES = new Set(hexesIn(REFERENCE_V09))

describe('테마 CSS 파일 구조', () => {
  it('두 테마 파일이 모두 로드된다', () => {
    for (const key of THEME_KEYS) {
      expect(THEME_CSS[key].length).toBeGreaterThan(0)
    }
  })

  it('mono-vinyl이 data-theme 없이도 기본 테마로 적용된다', () => {
    // bare `:root`가 선택자에 함께 있어야 Theme Store 없이도 기본값이 걸린다.
    expect(THEME_CSS['mono-vinyl']).toContain(':root,')
    expect(THEME_CSS['mono-vinyl']).toContain(":root[data-theme='mono-vinyl']")
  })

  it('kawaii는 data-theme 속성에서만 적용된다', () => {
    const css = THEME_CSS['kawaii-synth-cassette']
    expect(css).toContain(":root[data-theme='kawaii-synth-cassette']")
    // bare `:root {`로 전역에 새지 않아야 한다.
    expect(stripComments(css)).not.toMatch(/:root\s*\{/)
  })

  it('기본 테마는 mono-vinyl이다', () => {
    expect(DEFAULT_THEME_KEY).toBe('mono-vinyl')
  })
})

describe('토큰 집합 일관성', () => {
  it('두 테마가 정확히 같은 토큰 이름을 정의한다', () => {
    const mono = [...tokensOf(THEME_CSS['mono-vinyl']).keys()].sort()
    const kawaii = [...tokensOf(THEME_CSS['kawaii-synth-cassette']).keys()].sort()

    // 한쪽에만 있는 토큰은 테마 전환 시 조용히 빈 값이 된다.
    expect(kawaii).toEqual(mono)
  })

  it('테마마다 토큰을 중복 선언하지 않는다', () => {
    for (const key of THEME_KEYS) {
      const clean = stripComments(THEME_CSS[key])
      const names = [...clean.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1])
      expect(new Set(names).size).toBe(names.length)
    }
  })

  it('공통 토큰 파일에는 포커스 링 외의 색을 두지 않는다', () => {
    const tokens = tokensOf(SHARED_TOKENS_CSS)
    const colored = [...tokens].filter(([, value]) => value.includes('#'))
    expect(colored.map(([name]) => name)).toEqual(['--focus-ring-color'])
  })

  it('색 토큰 이름은 색임을 알 수 있게 끝난다', () => {
    for (const key of THEME_KEYS) {
      for (const [name, value] of tokensOf(THEME_CSS[key])) {
        if (!value.startsWith('#')) continue
        expect(name, `${name} 는 단일 색 값이다`).toMatch(/-color$/)
      }
    }
  })
})

describe('토큰 값이 승인된 레퍼런스에서 왔는지', () => {
  it.each(THEME_KEYS)('%s 의 모든 색 리터럴이 레퍼런스에 존재한다', (key) => {
    const unknown: string[] = []
    for (const [name, value] of tokensOf(THEME_CSS[key])) {
      for (const hex of hexesIn(value)) {
        if (!REFERENCE_HEXES.has(hex)) unknown.push(`${name}: ${hex}`)
      }
    }
    // 레퍼런스에 없는 색은 임의로 만들어낸 값이다.
    expect(unknown).toEqual([])
  })

  it('공유 포커스 링 색이 레퍼런스와 일치한다', () => {
    expect(referenceDeclaration(REFERENCE_V09, 'button:focus-visible', 'outline')).toBe(
      '2px solid #f0e2c8',
    )
    const shared = tokensOf(SHARED_TOKENS_CSS)
    expect(shared.get('--focus-ring-color')).toBe('#f0e2c8')
    expect(shared.get('--focus-ring-width')).toBe('2px')
    expect(shared.get('--focus-ring-offset')).toBe('3px')
  })
})

describe('복합 배경을 단순화하지 않았는지', () => {
  it('mono 워크스페이스 배경이 레퍼런스와 완전히 일치한다', () => {
    const expected = referenceDeclaration(REFERENCE_V09, '.workspace', 'background')
    const actual = tokensOf(THEME_CSS['mono-vinyl']).get('--workspace-background')
    expect(squash(actual ?? '')).toBe(squash(expected))
  })

  it('kawaii 워크스페이스 배경이 2개 레이어를 그대로 유지한다', () => {
    const expected = referenceDeclaration(REFERENCE_V09, '.theme-kawaii .workspace', 'background')
    const actual = tokensOf(THEME_CSS['kawaii-synth-cassette']).get('--workspace-background') ?? ''

    expect(squash(actual)).toBe(squash(expected))
    // radial 그라디언트 + 스캔라인이 모두 남아 있어야 한다.
    expect(actual).toContain('radial-gradient')
    expect(actual).toContain('repeating-linear-gradient')
  })

  it('마스코트 패널 그라디언트가 테마별로 보존된다', () => {
    expect(squash(tokensOf(THEME_CSS['mono-vinyl']).get('--mascot-panel-background') ?? '')).toBe(
      squash(referenceDeclaration(REFERENCE_V09, '.mascot-panel', 'background')),
    )
    expect(
      squash(tokensOf(THEME_CSS['kawaii-synth-cassette']).get('--mascot-panel-background') ?? ''),
    ).toBe(squash(referenceDeclaration(REFERENCE_V09, '.theme-kawaii .mascot-panel', 'background')))
  })
})

describe('테마별 주요 토큰 값', () => {
  /** [토큰, mono 기대값, kawaii 기대값] */
  const CASES: ReadonlyArray<readonly [string, string, string]> = [
    ['--page-background-color', '#11110f', '#081825'],
    ['--workspace-border-color', '#38332c', '#5b9e9f'],
    ['--text-color', '#e9e2d7', '#e2fff6'],
    ['--text-muted-color', '#bcb4a6', '#b2d7d5'],
    ['--text-dim-color', '#8f887b', '#769dac'],
    ['--line-color', '#504a41', '#3f7480'],
    ['--metal-color', '#aaa295', '#82d8ce'],
    ['--accent-color', '#d8cebe', '#ff9bc5'],
    ['--accent-text-color', '#221e1a', '#3f2340'],
    ['--accent-strong-color', '#d5cab9', '#ff9bc5'],
    ['--brand-text-color', '#dad3c7', '#b5ffec'],
    ['--button-surface-color', '#26231e', '#214052'],
    ['--pill-surface-color', '#28251f', '#214052'],
    ['--clock-dot-color', '#e1d8c8', '#a9ffe5'],
    ['--video-border-color', '#665f55', '#66c3bf'],
    ['--video-surface-color', '#0f0e0d', '#091c2a'],
    ['--now-title-text-color', '#e9e2d7', '#f7d7e9'],
    ['--drawer-surface-color', '#1d1b18', '#132b3a'],
    ['--row-selected-surface-color', '#393329', '#2c5663'],
    ['--row-selected-border-color', '#c5b7a3', '#92ead9'],
    ['--toast-surface-color', '#ded3c1', '#a7ffdf'],
    ['--toast-text-color', '#2d261f', '#17384a'],
    ['--mascot-dot-color', '#ffffff', '#a8ffe7'],
    ['--mascot-message-text-color', '#e3e0d8', '#ffafd2'],
    ['--deck-open-focus-ring-color', '#eee2d0', '#ff8fc3'],
  ]

  it.each(CASES)('%s', (token, mono, kawaii) => {
    expect(tokensOf(THEME_CSS['mono-vinyl']).get(token)).toBe(mono)
    expect(tokensOf(THEME_CSS['kawaii-synth-cassette']).get(token)).toBe(kawaii)
  })

  it('경계선 색을 2개로 합치지 않았다', () => {
    const mono = tokensOf(THEME_CSS['mono-vinyl'])
    const borders = [
      mono.get('--header-border-color'),
      mono.get('--info-border-color'),
      mono.get('--rule-color'),
      mono.get('--footer-border-color'),
      mono.get('--workspace-border-color'),
      mono.get('--drawer-border-color'),
      mono.get('--drawer-head-border-color'),
      mono.get('--drawer-foot-border-color'),
    ]
    // 승인된 디자인의 농도 차이가 살아 있어야 한다.
    expect(new Set(borders).size).toBeGreaterThanOrEqual(7)
  })

  it('mono 토큰 값이 v08 레퍼런스와도 일치한다', () => {
    // v08은 Mono Vinyl 디자인의 기준 문서다.
    const v08 = new Set(hexesIn(REFERENCE_V08))
    expect(v08.has(normalizeHex('#38332c'))).toBe(true)
    expect(referenceDeclaration(REFERENCE_V08, '.workspace', 'background')).toBe(
      referenceDeclaration(REFERENCE_V09, '.workspace', 'background'),
    )
  })
})

describe('모션 · 기하 토큰', () => {
  it('승인된 모션 값을 보존한다', () => {
    const shared = tokensOf(SHARED_TOKENS_CSS)
    expect(shared.get('--duration-spin-33')).toBe('1.8s')
    expect(shared.get('--duration-spin-45')).toBe('1.33333s')
    expect(shared.get('--duration-spool')).toBe('1.9s')
    expect(shared.get('--duration-breath')).toBe('1s')
  })

  it('승인된 기하 값을 보존한다', () => {
    const shared = tokensOf(SHARED_TOKENS_CSS)
    expect(shared.get('--size-drawer-width')).toBe('340px')
    expect(shared.get('--size-workspace-min-height')).toBe('650px')
    expect(shared.get('--size-shell-max-width')).toBe('1920px')
    expect(shared.get('--size-video-min')).toBe('200px')
    expect(shared.get('--ratio-deck')).toBe('900 / 570')
    expect(shared.get('--ratio-video')).toBe('16 / 9')
  })

  it('prefers-reduced-motion에서 모션 토큰을 0s로 바꾼다', () => {
    const reduced = /@media \(prefers-reduced-motion: reduce\)([\s\S]*)$/.exec(BASE_CSS)?.[1] ?? ''
    for (const token of [
      '--duration-spin-33',
      '--duration-spin-45',
      '--duration-spool',
      '--duration-breath',
    ]) {
      expect(reduced).toContain(`${token}: 0s`)
    }
  })

  it('base.css가 공통 스타일을 토큰으로만 참조한다', () => {
    expect(BASE_CSS).toContain('box-sizing: border-box')
    expect(BASE_CSS).toContain('color-scheme: dark')
    expect(BASE_CSS).toContain('background: var(--page-background-color)')
    expect(BASE_CSS).toContain(':focus-visible')
    // 색 리터럴을 직접 쓰지 않는다.
    expect(hexesIn(stripComments(BASE_CSS))).toEqual([])
  })
})

describe('테마 레지스트리', () => {
  it('키 목록과 기본 테마를 중복 정의하지 않는다', () => {
    const source = readFile('src/themes/index.ts')
    expect(source).toContain("from '@/shared/types'")
    // 레지스트리가 자체 키 배열이나 기본값을 만들지 않아야 한다.
    expect(source).not.toMatch(/THEME_KEYS\s*=/)
    expect(source).not.toMatch(/DEFAULT_THEME_KEY\s*=/)
  })

  it('모든 테마 키에 메타데이터가 있다', () => {
    expect(Object.keys(THEMES).sort()).toEqual([...THEME_KEYS].sort())
    for (const key of THEME_KEYS) {
      const meta = getThemeMetadata(key)
      expect(meta.key).toBe(key)
      expect(meta.name.length).toBeGreaterThan(0)
      expect(meta.label.length).toBeGreaterThan(0)
      expect(meta.description.length).toBeGreaterThan(0)
    }
  })

  it('레이블이 승인된 디자인 문구와 일치한다', () => {
    expect(THEMES['mono-vinyl'].label).toBe('01 / MONO VINYL')
    expect(THEMES['kawaii-synth-cassette'].label).toBe('02 / SYNTH CASSETTE')
    for (const meta of THEME_LIST) {
      expect(REFERENCE_V09).toContain(meta.label)
    }
  })

  it('THEME_LIST가 표시 순서를 따른다', () => {
    expect(THEME_LIST.map((meta) => meta.key)).toEqual([...THEME_KEYS])
  })
})
