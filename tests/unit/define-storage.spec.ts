import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { STORAGE_KEYS, defineStorage } from '@/shared/storage'
import type { Playlist } from '@/shared/types'

/** 테스트용 스키마. 실제 라이브러리 스키마는 M2에서 확정한다. */
interface Fixture {
  lists: Playlist[]
  selected: string
}

const KEY = 'test.fixture'
const VERSION = 2

/** `DefineStorageOptions.migrate`의 시그니처. `vi.fn` 타입 인자로 쓴다. */
type Migrate = (data: unknown, fromVersion: number) => unknown

function makeFallback(): Fixture {
  return { lists: [{ id: 'default', name: 'MY RECORDS', tracks: [] }], selected: 'default' }
}

/**
 * 테스트용 검증기.
 *
 * 정규화도 수행한다 (`selected`가 존재하지 않는 id면 첫 목록으로 보정).
 * `MVP_SPEC.md` F9의 `safeLoad` 패턴을 따른다.
 */
function validate(value: unknown): Fixture | null {
  if (typeof value !== 'object' || value === null) return null
  const candidate = value as Partial<Fixture>
  if (!Array.isArray(candidate.lists) || candidate.lists.length === 0) return null
  if (typeof candidate.selected !== 'string') return null

  const lists = candidate.lists.filter(
    (list): list is Playlist =>
      typeof list === 'object' &&
      list !== null &&
      typeof list.id === 'string' &&
      typeof list.name === 'string' &&
      Array.isArray(list.tracks),
  )
  if (lists.length === 0) return null

  const first = lists[0]
  if (first === undefined) return null
  const selected = lists.some((list) => list.id === candidate.selected)
    ? candidate.selected
    : first.id

  return { lists, selected }
}

function createStorage(overrides: Partial<Parameters<typeof defineStorage<Fixture>>[0]> = {}) {
  return defineStorage<Fixture>({
    key: KEY,
    version: VERSION,
    fallback: makeFallback,
    validate,
    ...overrides,
  })
}

/** 봉투를 거치지 않고 저장소에 직접 원시 문자열을 넣는다. */
function seedRaw(raw: string): void {
  globalThis.localStorage.setItem(KEY, raw)
}

function readRaw(): string | null {
  return globalThis.localStorage.getItem(KEY)
}

const realLocalStorage = globalThis.localStorage

/** `localStorage` 전체를 교체한다. 접근 자체가 던지는 상황도 만들 수 있다. */
function stubLocalStorage(descriptor: PropertyDescriptor): void {
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, ...descriptor })
}

interface FakeStorage {
  storage: Storage
  calls: { getItem: number; setItem: number; removeItem: number; clear: number }
  behavior: { getItem?: () => never; setItem?: () => never }
}

/**
 * 손으로 만든 `Storage` 구현.
 *
 * jsdom의 `localStorage`는 프록시라서 `vi.spyOn`으로 인스턴스 메서드를
 * 가릴 수 없다 (정의한 속성이 저장 항목으로 취급된다). 호출 횟수를 세거나
 * 예외를 주입해야 하는 테스트는 이 구현을 끼워 넣는다.
 */
function createFakeStorage(seed?: string): FakeStorage {
  const map = new Map<string, string>()
  if (seed !== undefined) map.set(KEY, seed)

  const calls = { getItem: 0, setItem: 0, removeItem: 0, clear: 0 }
  const behavior: { getItem?: () => never; setItem?: () => never } = {}

  const storage: Storage = {
    get length() {
      return map.size
    },
    key(index: number) {
      return [...map.keys()][index] ?? null
    },
    getItem(key: string) {
      calls.getItem += 1
      behavior.getItem?.()
      return map.get(key) ?? null
    },
    setItem(key: string, value: string) {
      calls.setItem += 1
      behavior.setItem?.()
      map.set(key, value)
    },
    removeItem(key: string) {
      calls.removeItem += 1
      map.delete(key)
    },
    clear() {
      calls.clear += 1
      map.clear()
    },
  }

  return { storage, calls, behavior }
}

/** 가짜 저장소를 설치하고 핸들을 돌려준다. */
function installFakeStorage(seed?: string): FakeStorage {
  const fake = createFakeStorage(seed)
  stubLocalStorage({ value: fake.storage, writable: true })
  return fake
}

beforeEach(() => {
  globalThis.localStorage.clear()
})

afterEach(() => {
  stubLocalStorage({ value: realLocalStorage, writable: true })
  globalThis.localStorage.clear()
  vi.restoreAllMocks()
})

describe('STORAGE_KEYS', () => {
  it('버전 없는 고정 키를 쓴다', () => {
    expect(STORAGE_KEYS.library).toBe('39page.library')
    expect(STORAGE_KEYS.theme).toBe('39page.theme')
    expect(STORAGE_KEYS.moments).toBe('39page.moments')
  })
})

describe('정상 읽기/쓰기', () => {
  it('쓴 값을 그대로 읽는다', () => {
    const storage = createStorage()
    const value: Fixture = {
      lists: [
        {
          id: 'a',
          name: 'A',
          tracks: [{ id: 't1', source: 'youtube', videoId: 'dQw4w9WgXcQ', title: 'T' }],
        },
      ],
      selected: 'a',
    }

    expect(storage.write(value)).toEqual({ ok: true })
    expect(storage.read()).toEqual({ value, outcome: 'stored' })
  })

  it('저장 객체에 version과 data를 담는다', () => {
    const storage = createStorage()
    storage.write(makeFallback())

    const raw = readRaw()
    expect(raw).not.toBeNull()
    expect(JSON.parse(raw as string)).toEqual({ version: VERSION, data: makeFallback() })
  })

  it('저장된 값이 없으면 기본값과 empty를 돌려준다', () => {
    const storage = createStorage()
    expect(storage.read()).toEqual({ value: makeFallback(), outcome: 'empty' })
  })

  it('검증기가 정규화한 값을 돌려준다', () => {
    const storage = createStorage()
    // selected가 존재하지 않는 id를 가리킨다 -> 첫 목록으로 보정된다.
    seedRaw(
      JSON.stringify({
        version: VERSION,
        data: { lists: [{ id: 'only', name: 'Only', tracks: [] }], selected: 'missing' },
      }),
    )

    const result = storage.read()
    expect(result.outcome).toBe('stored')
    expect(result.value.selected).toBe('only')
  })

  it('key와 version을 노출한다', () => {
    const storage = createStorage()
    expect(storage.key).toBe(KEY)
    expect(storage.version).toBe(VERSION)
  })

  it('정수가 아닌 version은 정의 시점에 거부한다', () => {
    expect(() => createStorage({ version: 1.5 })).toThrow(TypeError)
  })
})

describe('손상된 데이터', () => {
  it.each([
    ['JSON이 아님', '{not json'],
    ['잘린 JSON', '{"version":2,"data":'],
    ['빈 문자열', ''],
    ['원시값', '42'],
    ['null', 'null'],
    ['배열', '[1,2,3]'],
    ['봉투 아님 — version 없음', '{"data":{}}'],
    ['봉투 아님 — data 없음', '{"version":2}'],
    ['version이 숫자가 아님', '{"version":"2","data":{}}'],
    ['version이 소수', '{"version":2.5,"data":{}}'],
  ])('%s -> malformed', (_label, raw) => {
    const storage = createStorage()
    seedRaw(raw)

    const result = storage.read()
    expect(result.outcome).toBe('malformed')
    expect(result.value).toEqual(makeFallback())
  })
})

describe('필수 필드 누락 / 검증 실패', () => {
  it.each([
    ['빈 객체', {}],
    ['lists 누락', { selected: 'a' }],
    ['selected 누락', { lists: [{ id: 'a', name: 'A', tracks: [] }] }],
    ['lists가 배열이 아님', { lists: 'nope', selected: 'a' }],
    ['lists가 비어 있음', { lists: [], selected: 'a' }],
    ['항목에 name 누락', { lists: [{ id: 'a', tracks: [] }], selected: 'a' }],
    ['항목에 tracks 누락', { lists: [{ id: 'a', name: 'A' }], selected: 'a' }],
    ['selected가 문자열이 아님', { lists: [{ id: 'a', name: 'A', tracks: [] }], selected: 7 }],
  ])('%s -> invalid', (_label, data) => {
    const storage = createStorage()
    seedRaw(JSON.stringify({ version: VERSION, data }))

    const result = storage.read()
    expect(result.outcome).toBe('invalid')
    expect(result.value).toEqual(makeFallback())
  })
})

describe('버전 불일치', () => {
  it('migrate가 없으면 version-mismatch를 돌려준다', () => {
    const storage = createStorage()
    seedRaw(JSON.stringify({ version: 1, data: { legacy: true } }))

    expect(storage.read()).toEqual({ value: makeFallback(), outcome: 'version-mismatch' })
  })

  it('상위 버전은 migrate가 있어도 되돌리지 않는다', () => {
    const migrate = vi.fn<Migrate>()
    const storage = createStorage({ migrate })
    seedRaw(JSON.stringify({ version: VERSION + 1, data: { future: true } }))

    expect(storage.read().outcome).toBe('version-mismatch')
    expect(migrate).not.toHaveBeenCalled()
  })
})

describe('마이그레이션', () => {
  it('이전 버전을 옮겨 읽는다', () => {
    const migrate = vi.fn<Migrate>((data, fromVersion) => {
      expect(fromVersion).toBe(1)
      const legacy = data as { names: string[] }
      return {
        lists: legacy.names.map((name, index) => ({ id: `l${index}`, name, tracks: [] })),
        selected: 'l0',
      }
    })
    const storage = createStorage({ migrate })
    seedRaw(JSON.stringify({ version: 1, data: { names: ['OLD A', 'OLD B'] } }))

    const result = storage.read()
    expect(result.outcome).toBe('migrated')
    expect(result.value.lists.map((list) => list.name)).toEqual(['OLD A', 'OLD B'])
    expect(migrate).toHaveBeenCalledTimes(1)
  })

  it('마이그레이션이 예외를 던지면 migration-failed를 돌려준다', () => {
    const storage = createStorage({
      migrate: () => {
        throw new Error('boom')
      },
    })
    seedRaw(JSON.stringify({ version: 1, data: { legacy: true } }))

    const result = storage.read()
    expect(result.outcome).toBe('migration-failed')
    expect(result.value).toEqual(makeFallback())
  })

  it('마이그레이션 결과가 검증을 통과하지 못하면 migration-failed를 돌려준다', () => {
    const storage = createStorage({ migrate: () => ({ lists: 'still wrong' }) })
    seedRaw(JSON.stringify({ version: 1, data: { legacy: true } }))

    expect(storage.read().outcome).toBe('migration-failed')
  })

  it('마이그레이션 성공 시에도 저장소에 다시 쓰지 않는다', () => {
    const raw = JSON.stringify({ version: 1, data: { names: ['OLD'] } })
    const storage = createStorage({
      migrate: (data) => ({
        lists: (data as { names: string[] }).names.map((name) => ({ id: 'x', name, tracks: [] })),
        selected: 'x',
      }),
    })
    seedRaw(raw)

    expect(storage.read().outcome).toBe('migrated')
    expect(readRaw()).toBe(raw)
  })
})

describe('기본값 반환 시 기존 저장 데이터 보존', () => {
  it.each([
    ['손상된 JSON', '{not json'],
    ['검증 실패', JSON.stringify({ version: VERSION, data: { lists: [] } })],
    ['버전 불일치', JSON.stringify({ version: 1, data: { legacy: true } })],
  ])('%s — 저장소를 지우거나 덮어쓰지 않는다', (_label, raw) => {
    const fake = installFakeStorage(raw)
    const storage = createStorage()

    expect(storage.read().value).toEqual(makeFallback())

    expect(readRaw()).toBe(raw)
    expect(fake.calls.setItem).toBe(0)
    expect(fake.calls.removeItem).toBe(0)
    expect(fake.calls.clear).toBe(0)
  })

  it('마이그레이션 실패 — 저장소를 지우거나 덮어쓰지 않는다', () => {
    const raw = JSON.stringify({ version: 1, data: { legacy: true } })
    const fake = installFakeStorage(raw)
    const storage = createStorage({
      migrate: () => {
        throw new Error('boom')
      },
    })

    expect(storage.read()).toEqual({ value: makeFallback(), outcome: 'migration-failed' })

    expect(readRaw()).toBe(raw)
    expect(fake.calls.setItem).toBe(0)
    expect(fake.calls.removeItem).toBe(0)
    expect(fake.calls.clear).toBe(0)
  })
})

describe('저장소 접근 예외', () => {
  it('localStorage 접근 자체가 던지면 unavailable을 돌려준다', () => {
    stubLocalStorage({
      get() {
        throw new Error('access denied')
      },
    })
    const storage = createStorage()

    expect(storage.read()).toEqual({ value: makeFallback(), outcome: 'unavailable' })
    expect(storage.write(makeFallback())).toEqual({ ok: false, reason: 'unavailable' })
  })

  it('localStorage가 없으면 unavailable을 돌려준다', () => {
    stubLocalStorage({ value: undefined, writable: true })
    const storage = createStorage()

    expect(storage.read().outcome).toBe('unavailable')
    expect(storage.write(makeFallback())).toEqual({ ok: false, reason: 'unavailable' })
  })

  it('getItem이 던지면 unavailable을 돌려준다', () => {
    const fake = installFakeStorage()
    fake.behavior.getItem = () => {
      throw new Error('read blocked')
    }
    const storage = createStorage()

    expect(storage.read().outcome).toBe('unavailable')
    expect(() => storage.read()).not.toThrow()
  })
})

describe('쓰기 실패', () => {
  it('용량 초과를 quota-exceeded로 보고한다', () => {
    const fake = installFakeStorage()
    fake.behavior.setItem = () => {
      throw new DOMException('exceeded', 'QuotaExceededError')
    }
    const storage = createStorage()

    const result = storage.write(makeFallback())
    expect(result.ok).toBe(false)
    expect(result).toMatchObject({ reason: 'quota-exceeded' })
  })

  it('레거시 용량 초과 코드도 quota-exceeded로 보고한다', () => {
    const fake = installFakeStorage()
    fake.behavior.setItem = () => {
      throw new DOMException('exceeded', 'NS_ERROR_DOM_QUOTA_REACHED')
    }
    const storage = createStorage()

    expect(storage.write(makeFallback())).toMatchObject({ reason: 'quota-exceeded' })
  })

  it('그 외 쓰기 오류를 unknown으로 보고한다', () => {
    const fake = installFakeStorage()
    fake.behavior.setItem = () => {
      throw new Error('nope')
    }
    const storage = createStorage()

    expect(storage.write(makeFallback())).toMatchObject({ ok: false, reason: 'unknown' })
  })

  it('직렬화할 수 없는 값을 serialize-failed로 보고한다', () => {
    const fake = installFakeStorage()
    const storage = createStorage()
    const circular: Record<string, unknown> = {}
    circular.self = circular

    const result = storage.write(circular as unknown as Fixture)
    expect(result).toMatchObject({ ok: false, reason: 'serialize-failed' })
    // 직렬화가 먼저 실패하므로 저장소에 접근조차 하지 않는다.
    expect(fake.calls.setItem).toBe(0)
    expect(readRaw()).toBeNull()
  })

  it('쓰기 실패가 예외로 전파되지 않는다', () => {
    const fake = installFakeStorage()
    fake.behavior.setItem = () => {
      throw new Error('nope')
    }
    const storage = createStorage()

    expect(() => storage.write(makeFallback())).not.toThrow()
  })
})

describe('기본값 참조 격리', () => {
  it('읽기마다 새 기본값 객체를 돌려준다', () => {
    const storage = createStorage()

    const first = storage.read().value
    const second = storage.read().value

    expect(first).not.toBe(second)
    expect(first.lists).not.toBe(second.lists)
  })

  it('돌려받은 기본값을 변형해도 다음 기본값이 오염되지 않는다', () => {
    const storage = createStorage()

    const first = storage.read().value
    first.lists.push({ id: 'injected', name: 'INJECTED', tracks: [] })
    first.selected = 'injected'

    expect(storage.read().value).toEqual(makeFallback())
  })

  it('실패 경로에서도 기본값이 격리된다', () => {
    const storage = createStorage()
    seedRaw('{not json')

    const first = storage.read().value
    first.lists.length = 0

    expect(storage.read().value).toEqual(makeFallback())
  })
})
