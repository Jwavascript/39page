import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { createPinia, setActivePinia, type Pinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { STORAGE_KEYS } from '@/shared/storage'
import { DEFAULT_THEME_KEY } from '@/shared/types'
import { THEME_STORAGE_VERSION, useThemeStore } from '@/stores/theme'

/**
 * 프로젝트 루트 기준으로 소스를 읽는다.
 *
 * `import.meta.url`을 쓰지 않는다. Vue 모듈 그래프를 끌어들이는 spec에서는
 * Vitest 변환 방식에 따라 file: URL이 아닐 수 있다. vitest.config.ts가
 * root를 프로젝트 루트로 지정하므로 cwd 기준이 안정적이다.
 */
function readSource(relative: string): string {
  return readFileSync(resolve(process.cwd(), relative), 'utf8')
}

const KEY = STORAGE_KEYS.theme
const realLocalStorage = globalThis.localStorage

function stubLocalStorage(descriptor: PropertyDescriptor): void {
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, ...descriptor })
}

/** 저장소에 원시 문자열을 직접 넣는다. */
function seedRaw(raw: string): void {
  globalThis.localStorage.setItem(KEY, raw)
}

function readRaw(): string | null {
  return globalThis.localStorage.getItem(KEY)
}

function envelope(data: unknown, version = THEME_STORAGE_VERSION): string {
  return JSON.stringify({ version, data })
}

function domTheme(): string | undefined {
  return document.documentElement.dataset.theme
}

let pinia: Pinia

beforeEach(() => {
  globalThis.localStorage.clear()
  delete document.documentElement.dataset.theme
  pinia = createPinia()
  setActivePinia(pinia)
})

afterEach(() => {
  stubLocalStorage({ value: realLocalStorage, writable: true })
  globalThis.localStorage.clear()
  delete document.documentElement.dataset.theme
})

describe('1. 기본 테마', () => {
  it('기본 테마는 mono-vinyl이다', () => {
    const theme = useThemeStore()
    expect(DEFAULT_THEME_KEY).toBe('mono-vinyl')
    expect(theme.current).toBe('mono-vinyl')
  })

  it('store 생성 시점에 DOM에 기본 테마가 반영된다', () => {
    useThemeStore()
    expect(domTheme()).toBe('mono-vinyl')
  })

  it('메타데이터를 레지스트리에서 가져온다', () => {
    const theme = useThemeStore()
    expect(theme.metadata.name).toBe('Mono Vinyl')
    expect(theme.metadata.label).toBe('01 / MONO VINYL')
    expect(theme.available.map((option) => option.key)).toEqual([
      'mono-vinyl',
      'kawaii-synth-cassette',
    ])
  })
})

describe('2. 테마 변경', () => {
  it('kawaii-synth-cassette로 변경된다', () => {
    const theme = useThemeStore()
    theme.setTheme('kawaii-synth-cassette')

    expect(theme.current).toBe('kawaii-synth-cassette')
    expect(theme.metadata.name).toBe('Kawaii Synth Cassette')
  })

  it('다시 mono-vinyl로 되돌릴 수 있다', () => {
    const theme = useThemeStore()
    theme.setTheme('kawaii-synth-cassette')
    theme.setTheme('mono-vinyl')

    expect(theme.current).toBe('mono-vinyl')
    expect(domTheme()).toBe('mono-vinyl')
  })
})

describe('3. 변경한 테마 저장', () => {
  it('선택한 테마를 version/data 봉투로 저장한다', () => {
    const theme = useThemeStore()
    expect(theme.setTheme('kawaii-synth-cassette')).toBe(true)

    expect(JSON.parse(readRaw() as string)).toEqual({
      version: THEME_STORAGE_VERSION,
      data: 'kawaii-synth-cassette',
    })
    expect(theme.lastWriteFailure).toBeNull()
  })

  it('고정 저장 키를 쓴다', () => {
    useThemeStore().setTheme('kawaii-synth-cassette')
    expect(KEY).toBe('39page.theme')
    expect(readRaw()).not.toBeNull()
  })
})

describe('4. 저장된 테마 복원', () => {
  it('저장된 테마를 복원한다', () => {
    seedRaw(envelope('kawaii-synth-cassette'))
    const theme = useThemeStore()

    expect(theme.restore()).toBe('stored')
    expect(theme.current).toBe('kawaii-synth-cassette')
    expect(domTheme()).toBe('kawaii-synth-cassette')
  })

  it('저장값이 없으면 기본 테마를 유지한다', () => {
    const theme = useThemeStore()
    expect(theme.restore()).toBe('empty')
    expect(theme.current).toBe('mono-vinyl')
  })

  it('복원은 저장소에 쓰지 않는다', () => {
    const raw = envelope('kawaii-synth-cassette')
    seedRaw(raw)
    useThemeStore().restore()

    expect(readRaw()).toBe(raw)
  })

  it('복원 결과를 outcome으로 알린다', () => {
    const theme = useThemeStore()
    expect(theme.restoreOutcome).toBeNull()
    theme.restore()
    expect(theme.restoreOutcome).toBe('empty')
  })
})

describe('5. 알 수 없는 테마 키', () => {
  it.each([
    ['알 수 없는 문자열', envelope('neon-cyberpunk')],
    ['빈 문자열', envelope('')],
    ['숫자', envelope(42)],
    ['null', envelope(null)],
    ['객체', envelope({ key: 'mono-vinyl' })],
    ['배열', envelope(['mono-vinyl'])],
  ])('%s 은 기본 테마로 복구된다', (_label, raw) => {
    seedRaw(raw)
    const theme = useThemeStore()

    expect(theme.restore()).toBe('invalid')
    expect(theme.current).toBe('mono-vinyl')
    expect(domTheme()).toBe('mono-vinyl')
  })

  it('setTheme에 알 수 없는 값이 들어와도 기본 테마로 떨어진다', () => {
    const theme = useThemeStore()
    // 런타임 입력(저장 데이터, DOM 속성 등)을 모사한다.
    theme.setTheme('neon-cyberpunk' as never)

    expect(theme.current).toBe('mono-vinyl')
    expect(domTheme()).toBe('mono-vinyl')
  })
})

describe('6. 저장소 오류에서도 전환은 동작한다', () => {
  it('localStorage 접근이 던져도 전환된다', () => {
    stubLocalStorage({
      get() {
        throw new Error('access denied')
      },
    })
    const theme = useThemeStore()

    expect(() => theme.setTheme('kawaii-synth-cassette')).not.toThrow()
    expect(theme.setTheme('kawaii-synth-cassette')).toBe(false)
    expect(theme.current).toBe('kawaii-synth-cassette')
    expect(domTheme()).toBe('kawaii-synth-cassette')
    expect(theme.lastWriteFailure).toBe('unavailable')
  })

  it('쓰기가 용량 초과로 실패해도 전환된다', () => {
    const map = new Map<string, string>()
    stubLocalStorage({
      value: {
        get length() {
          return map.size
        },
        key: (index: number) => [...map.keys()][index] ?? null,
        getItem: (key: string) => map.get(key) ?? null,
        setItem: () => {
          throw new DOMException('exceeded', 'QuotaExceededError')
        },
        removeItem: (key: string) => void map.delete(key),
        clear: () => map.clear(),
      } satisfies Storage,
      writable: true,
    })
    const theme = useThemeStore()

    expect(theme.setTheme('kawaii-synth-cassette')).toBe(false)
    expect(theme.current).toBe('kawaii-synth-cassette')
    expect(theme.lastWriteFailure).toBe('quota-exceeded')
  })

  it('저장소를 쓸 수 없어도 복원이 던지지 않는다', () => {
    stubLocalStorage({ value: undefined, writable: true })
    const theme = useThemeStore()

    expect(() => theme.restore()).not.toThrow()
    expect(theme.restore()).toBe('unavailable')
    expect(theme.current).toBe('mono-vinyl')
  })
})

describe('7. 손상·미래 버전 데이터를 덮어쓰지 않는다', () => {
  it.each([
    ['손상된 JSON', '{not json', 'malformed'],
    ['봉투 아님', '"mono-vinyl"', 'malformed'],
    ['미래 버전', envelope('kawaii-synth-cassette', THEME_STORAGE_VERSION + 1), 'version-mismatch'],
    ['알 수 없는 키', envelope('neon-cyberpunk'), 'invalid'],
  ])('%s — 초기화 도중 저장 데이터가 보존된다', (_label, raw, expected) => {
    seedRaw(raw)
    const theme = useThemeStore()

    expect(theme.restore()).toBe(expected)
    expect(theme.current).toBe('mono-vinyl')
    // 복원이 기본값으로 떨어져도 원본은 그대로 남아야 한다.
    expect(readRaw()).toBe(raw)
  })

  it('미래 버전 데이터는 사용자가 테마를 선택할 때만 덮어써진다', () => {
    const future = envelope('kawaii-synth-cassette', THEME_STORAGE_VERSION + 1)
    seedRaw(future)
    const theme = useThemeStore()

    theme.restore()
    expect(readRaw()).toBe(future)

    // 명시적 선택은 저장을 시도한다.
    theme.setTheme('kawaii-synth-cassette')
    expect(readRaw()).not.toBe(future)
    expect(JSON.parse(readRaw() as string).version).toBe(THEME_STORAGE_VERSION)
  })
})

describe('8. DOM data-theme 동기화', () => {
  it('상태 변경이 즉시 DOM에 반영된다', () => {
    const theme = useThemeStore()

    theme.setTheme('kawaii-synth-cassette')
    expect(domTheme()).toBe('kawaii-synth-cassette')

    theme.setTheme('mono-vinyl')
    expect(domTheme()).toBe('mono-vinyl')
  })

  it('복원 결과가 DOM에 반영된다', () => {
    seedRaw(envelope('kawaii-synth-cassette'))
    useThemeStore().restore()
    expect(domTheme()).toBe('kawaii-synth-cassette')
  })

  it('모든 전환 후 DOM과 store가 일치한다', () => {
    const theme = useThemeStore()
    for (const key of ['kawaii-synth-cassette', 'mono-vinyl', 'kawaii-synth-cassette'] as const) {
      theme.setTheme(key)
      expect(domTheme()).toBe(theme.current)
    }
  })
})

describe('10. 재생·라이브러리와의 분리', () => {
  const STORE_SOURCE = readSource('src/stores/theme.ts')

  it('theme store가 재생·라이브러리·플레이어를 import하지 않는다', () => {
    const imports = [...STORE_SOURCE.matchAll(/^\s*import[\s\S]*?from\s+'([^']+)'/gm)].map(
      (match) => match[1] ?? '',
    )
    expect(imports.length).toBeGreaterThan(0)

    const forbidden = imports.filter((specifier) =>
      /playback|library|player|youtube/i.test(specifier),
    )
    expect(forbidden).toEqual([])
  })

  it('ThemeSwitcher도 재생·라이브러리를 import하지 않는다', () => {
    const source = readSource('src/components/ui/ThemeSwitcher.vue')
    expect(/playback|library|player/i.test(source)).toBe(false)
  })

  it('테마 전환 후에도 theme store만 등록된다', () => {
    const theme = useThemeStore()
    theme.setTheme('kawaii-synth-cassette')
    theme.restore()

    // 다른 store를 끌어들이면 pinia에 등록되어 드러난다.
    expect(Object.keys(pinia.state.value)).toEqual(['theme'])
  })
})

describe('초기 테마 적용 스크립트 (index.html)', () => {
  const INDEX_HTML = readSource('index.html')

  it('첫 페인트 전에 저장된 테마를 적용한다', () => {
    // 모듈 스크립트는 first-paint 이후에 실행되므로 인라인 스크립트가 필요하다.
    expect(INDEX_HTML).toContain('document.documentElement.dataset.theme')
    const headEnd = INDEX_HTML.indexOf('</head>')
    expect(INDEX_HTML.indexOf('dataset.theme')).toBeLessThan(headEnd)
  })

  it('store 와 같은 저장 키를 쓴다', () => {
    // 키가 어긋나면 복원이 조용히 실패한다.
    expect(INDEX_HTML).toContain(`'${KEY}'`)
  })

  it('기본 테마를 명시한다', () => {
    expect(INDEX_HTML).toContain(`data-theme="${DEFAULT_THEME_KEY}"`)
  })

  it('검증 로직을 중복하지 않는다', () => {
    // 테마 키 목록을 다시 적지 않는다. 알 수 없는 값은 CSS 가 되돌리고
    // 마운트 시 store 가 검증된 값으로 덮어쓴다.
    expect(INDEX_HTML).not.toContain('kawaii-synth-cassette')
    expect(INDEX_HTML).not.toContain('THEME_KEYS')
  })

  it('저장값이 없거나 손상되어도 던지지 않는다', () => {
    expect(INDEX_HTML).toMatch(/try\s*\{/)
    expect(INDEX_HTML).toMatch(/catch\s*\(/)
  })
})

describe('키·메타데이터 중복 정의 방지', () => {
  it('store가 테마 키 목록이나 기본값을 다시 정의하지 않는다', () => {
    const source = readSource('src/stores/theme.ts')
    expect(source).toContain("from '@/shared/types'")
    expect(source).toContain("from '@/themes'")
    expect(source).not.toMatch(/THEME_KEYS\s*=/)
    expect(source).not.toMatch(/DEFAULT_THEME_KEY\s*=/)
    expect(source).not.toMatch(/THEMES\s*=/)
    expect(source).not.toMatch(/'mono-vinyl'\s*\|/)
  })
})
