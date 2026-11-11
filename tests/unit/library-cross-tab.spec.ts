/**
 * 탭 간 라이브러리 정합성 (M10-3, ADR 0024).
 *
 * "탭" 하나 = Pinia 하나. 두 store 가 같은 `localStorage` 를 공유한다 — 실제 두
 * 탭과 같다. `storage` 이벤트는 같은 창에서 생기지 않으므로 다른 탭이 보낸 것처럼
 * 손으로 쏜다.
 *
 * jsdom 은 저장소를 즉시 공유하므로 **동시 저장 경합**(서로 상대의 쓰기를 보기 전에
 * 둘 다 쓰는 경우)은 여기서 재현되지 않는다 — 실제 Chromium 두 탭에서 잰다
 * (IMPLEMENTATION_PLAN.md M10-3).
 */
import { createPinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { STORAGE_KEYS } from '@/shared/storage'
import type { LibraryData } from '@/shared/types'
import { LIBRARY_STORAGE_VERSION, useLibraryStore } from '@/stores/library'

const KEY = STORAGE_KEYS.library
const A_VIDEO = 'dQw4w9WgXcQ'
const B_VIDEO = 'jNQXAC9IVRw'
const realLocalStorage = globalThis.localStorage

type Store = ReturnType<typeof useLibraryStore>

/** 새 탭을 연다 — main.ts 와 같은 순서(복원 → 첫 실행 목록)로. */
function openTab(): Store {
  const store = useLibraryStore(createPinia())
  store.restore()
  store.seedFirstRunPlaylist('MY RECORDS')
  return store
}

/** 다른 탭이 쓴 뒤 이 창에 도착하는 `storage` 이벤트. */
function deliverStorageEvent(key: string | null = KEY): void {
  globalThis.dispatchEvent(new StorageEvent('storage', { key }))
}

function raw(): string | null {
  return globalThis.localStorage.getItem(KEY)
}

function stored(): LibraryData {
  return JSON.parse(raw() as string).data as LibraryData
}

function titles(data: {
  playlists: readonly { tracks: readonly { title: string }[] }[]
}): string[] {
  return data.playlists.flatMap((playlist) => playlist.tracks.map((track) => track.title))
}

function firstId(store: Store): string {
  const id = store.playlists[0]?.id
  if (id === undefined) throw new Error('플레이리스트가 없다')
  return id
}

/** setItem 만 용량 초과로 던지는 저장소. 읽기는 실제 저장소를 그대로 쓴다. */
function quotaExceededOnWrite(): void {
  const real = realLocalStorage
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => real.getItem(key),
      setItem: () => {
        throw new DOMException('full', 'QuotaExceededError')
      },
      removeItem: (key: string) => real.removeItem(key),
      clear: () => real.clear(),
      key: (index: number) => real.key(index),
      get length() {
        return real.length
      },
    },
  })
}

beforeEach(() => {
  realLocalStorage.clear()
})

afterEach(() => {
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: realLocalStorage })
})

describe('시나리오 — 다른 탭이 추가한 트랙이 사라지지 않는다', () => {
  it('A 로드 → B 가 추가 → A 가 선택만 바꿔도 B 의 트랙이 저장소에 남는다', () => {
    const tabA = openTab()
    const playlistId = firstId(tabA)
    const tabB = openTab()

    expect(tabB.addTrack(playlistId, { videoId: B_VIDEO, title: 'B 가 넣은 곡' })).toMatchObject({
      ok: true,
      persisted: true,
    })

    // A 는 아직 모른다 (이벤트가 늦게 오거나 오지 않는 경우).
    expect(titles(tabA)).toEqual([])
    const result = tabA.selectPlaylist(playlistId)

    expect(result).toEqual({ ok: false, reason: 'conflict' })
    expect(titles(stored())).toEqual(['B 가 넣은 곡'])
    // A 는 최신을 다시 읽었다 — 화면에도 보인다.
    expect(titles(tabA)).toEqual(['B 가 넣은 곡'])
  })

  it('충돌 뒤 다시 시도하면 최신 위에서 저장된다 — 두 탭의 변경이 모두 남는다', () => {
    const tabA = openTab()
    const playlistId = firstId(tabA)
    const tabB = openTab()

    tabB.addTrack(playlistId, { videoId: B_VIDEO, title: 'B 곡' })
    expect(tabA.addTrack(playlistId, { videoId: A_VIDEO, title: 'A 곡' })).toEqual({
      ok: false,
      reason: 'conflict',
    })
    expect(titles(stored())).toEqual(['B 곡'])

    expect(tabA.addTrack(playlistId, { videoId: A_VIDEO, title: 'A 곡' })).toMatchObject({
      ok: true,
      persisted: true,
    })
    expect(titles(stored())).toEqual(['B 곡', 'A 곡'])
  })

  it('storage 이벤트가 오면 쓰기 전에 이미 최신이다 — 충돌 없이 이어서 저장', () => {
    const tabA = openTab()
    const tabB = openTab()
    const listening = tabA.watchExternalChanges()

    tabB.addTrack(firstId(tabB), { videoId: B_VIDEO, title: 'B 곡' })
    deliverStorageEvent()

    expect(titles(tabA)).toEqual(['B 곡'])
    expect(tabA.externalChange).toEqual({ sequence: 1, discardedUnsaved: false })
    expect(tabA.addTrack(firstId(tabA), { videoId: A_VIDEO, title: 'A 곡' })).toMatchObject({
      ok: true,
      persisted: true,
    })
    expect(titles(stored())).toEqual(['B 곡', 'A 곡'])
    listening()
  })
})

describe('다른 탭의 이름 변경 · 삭제', () => {
  it('B 가 이름을 바꾸면 A 의 이름 변경은 거절되고 B 의 이름이 남는다', () => {
    const tabA = openTab()
    const id = firstId(tabA)
    const tabB = openTab()

    tabB.renamePlaylist(id, 'B 의 이름')
    expect(tabA.renamePlaylist(id, 'A 의 이름')).toEqual({ ok: false, reason: 'conflict' })
    expect(stored().playlists[0]?.name).toBe('B 의 이름')
    expect(tabA.playlists[0]?.name).toBe('B 의 이름')
  })

  it('B 가 지운 목록에 A 가 추가하면 거절 → 다시 하면 not-found (되살리지 않는다)', () => {
    const tabA = openTab()
    const doomed = firstId(tabA)
    tabA.createPlaylist('남는 목록')
    const tabB = openTab()

    tabB.deletePlaylist(doomed)
    expect(tabA.addTrack(doomed, { videoId: A_VIDEO })).toEqual({ ok: false, reason: 'conflict' })
    expect(tabA.addTrack(doomed, { videoId: A_VIDEO })).toEqual({ ok: false, reason: 'not-found' })
    expect(stored().playlists.map((playlist) => playlist.name)).toEqual(['남는 목록'])
  })

  it('다시 읽을 때 이 탭의 선택은 그 목록이 남아 있으면 유지한다', () => {
    const tabA = openTab()
    const first = firstId(tabA)
    tabA.createPlaylist('둘째')
    const second = tabA.playlists[1]?.id as string
    tabA.selectPlaylist(first)
    const tabB = openTab()
    tabB.selectPlaylist(second)
    tabB.renamePlaylist(second, '둘째 (B)')

    tabA.reload()
    expect(tabA.selectedPlaylistId).toBe(first)

    tabB.deletePlaylist(first)
    tabA.reload()
    expect(tabA.selectedPlaylistId).toBe(second)
  })
})

describe('저장 실패 · 손상 · 미지원 버전', () => {
  it('A 의 쓰기 실패(저장 안 된 변경) 뒤 B 의 변경이 오면 최신으로 맞추고 그렇다고 알린다', () => {
    const tabA = openTab()
    const id = firstId(tabA)
    const tabB = openTab()
    const listening = tabA.watchExternalChanges()

    quotaExceededOnWrite()
    expect(tabA.addTrack(id, { videoId: A_VIDEO, title: '저장 안 된 곡' })).toMatchObject({
      ok: true,
      persisted: false,
    })
    expect(tabA.lastWriteFailure).toBe('quota-exceeded')
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: realLocalStorage,
    })

    tabB.addTrack(id, { videoId: B_VIDEO, title: 'B 곡' })
    deliverStorageEvent()

    expect(titles(tabA)).toEqual(['B 곡'])
    expect(tabA.lastWriteFailure).toBeNull()
    expect(tabA.externalChange).toEqual({ sequence: 1, discardedUnsaved: true })

    // 다음 저장이 성공하면 "사라졌다" 안내는 내려간다.
    tabA.addTrack(id, { videoId: A_VIDEO, title: 'A 곡' })
    expect(tabA.externalChange?.discardedUnsaved).toBe(false)
    listening()
  })

  it('쓰기 실패 뒤 저장소가 그대로면 다음 변경은 충돌이 아니다 (기존 재시도 동작)', () => {
    const tabA = openTab()
    const id = firstId(tabA)

    quotaExceededOnWrite()
    tabA.addTrack(id, { videoId: A_VIDEO, title: '첫 곡' })
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: realLocalStorage,
    })

    expect(tabA.addTrack(id, { videoId: B_VIDEO, title: '둘째 곡' })).toMatchObject({
      ok: true,
      persisted: true,
    })
    expect(titles(stored())).toEqual(['첫 곡', '둘째 곡'])
  })

  it('다른 탭(새 버전 앱)이 미지원 버전을 쓰면 이 탭은 보호 상태가 되고 원문을 덮지 않는다', () => {
    const tabA = openTab()
    const listening = tabA.watchExternalChanges()
    const future = JSON.stringify({ version: LIBRARY_STORAGE_VERSION + 1, data: { future: true } })

    realLocalStorage.setItem(KEY, future)
    deliverStorageEvent()

    expect(tabA.status).toBe('protected')
    expect(tabA.protectedReason).toBe('version-mismatch')
    expect(tabA.createPlaylist('메모리에만')).toMatchObject({ ok: true, persisted: false })
    expect(raw()).toBe(future)
    listening()
  })

  it('다른 탭이 원문을 망가뜨려도 이 탭이 덮어써 "고치지" 않는다', () => {
    const tabA = openTab()
    const id = firstId(tabA)

    realLocalStorage.setItem(KEY, '{broken')
    expect(tabA.addTrack(id, { videoId: A_VIDEO })).toEqual({ ok: false, reason: 'conflict' })
    expect(tabA.status).toBe('protected')
    expect(tabA.addTrack(id, { videoId: A_VIDEO }).ok).toBe(false)
    expect(raw()).toBe('{broken')
  })

  it('보호 상태의 탭은 다른 탭이 읽을 수 있는 값으로 바꾸면 다시 저장할 수 있게 된다', () => {
    realLocalStorage.setItem(KEY, '{broken')
    const tabA = openTab()
    const listening = tabA.watchExternalChanges()
    expect(tabA.status).toBe('protected')
    tabA.createPlaylist('세션 전용')

    const good: LibraryData = {
      playlists: [{ id: 'p1', name: '복원됨', tracks: [] }],
      selectedPlaylistId: 'p1',
    }
    realLocalStorage.setItem(KEY, JSON.stringify({ version: LIBRARY_STORAGE_VERSION, data: good }))
    deliverStorageEvent()

    expect(tabA.status).toBe('ready')
    expect(tabA.playlists.map((playlist) => playlist.name)).toEqual(['복원됨'])
    expect(tabA.externalChange?.discardedUnsaved).toBe(true)
    expect(tabA.addTrack('p1', { videoId: A_VIDEO })).toMatchObject({ ok: true, persisted: true })
    listening()
  })
})

describe('여러 탭에서 연속 수정', () => {
  it('이벤트 없이 번갈아 고쳐도 충돌 → 재시도로 모든 변경이 남는다', () => {
    const tabA = openTab()
    const id = firstId(tabA)
    const tabB = openTab()
    const expected: string[] = []
    const firstAttempts: string[] = []

    for (let round = 0; round < 5; round += 1) {
      for (const [tab, name] of [
        [tabA, `A${round}`],
        [tabB, `B${round}`],
      ] as const) {
        const first = tab.addTrack(id, { videoId: A_VIDEO, title: name })
        firstAttempts.push(first.ok ? 'ok' : first.reason)
        // 충돌이었으면 최신을 읽은 뒤 다시 누른다. 이미 저장됐으면 두 번 넣지 않는다.
        const final = first.ok ? first : tab.addTrack(id, { videoId: A_VIDEO, title: name })
        expect(final).toMatchObject({ ok: true, persisted: true })
        expected.push(name)
      }
    }

    // 이벤트가 없으니 탭이 바뀔 때마다 한 번씩 거절된다 — 맨 처음 A 만 바로 저장된다.
    expect(firstAttempts).toEqual(['ok', ...Array.from({ length: 9 }, () => 'conflict')])
    expect(titles(stored())).toEqual(expected)
  })

  it('이벤트가 오면 충돌 없이 이어진다', () => {
    const tabA = openTab()
    const id = firstId(tabA)
    const tabB = openTab()
    const stopA = tabA.watchExternalChanges()

    for (let round = 0; round < 5; round += 1) {
      expect(tabA.addTrack(id, { videoId: A_VIDEO, title: `A${round}` }).ok).toBe(true)
      tabB.reload() // B 쪽 탭이 이벤트를 받은 것과 같다
      expect(tabB.addTrack(id, { videoId: B_VIDEO, title: `B${round}` }).ok).toBe(true)
      deliverStorageEvent()
    }

    expect(titles(stored())).toHaveLength(10)
    expect(titles(tabA)).toEqual(titles(stored()))
    stopA()
  })

  it('첫 실행을 두 탭이 동시에 해도 기본 목록은 하나다', () => {
    const tabA = useLibraryStore(createPinia())
    const tabB = useLibraryStore(createPinia())
    tabA.restore()
    tabB.restore()

    expect(tabA.seedFirstRunPlaylist('MY RECORDS')).toMatchObject({ ok: true, persisted: true })
    expect(tabB.seedFirstRunPlaylist('MY RECORDS')).toEqual({ ok: false, reason: 'conflict' })
    expect(stored().playlists).toHaveLength(1)
    expect(tabB.playlists).toHaveLength(1)
  })
})

describe('변경이 없는 일반 저장 · 이벤트 거르기', () => {
  it('한 탭에서의 연속 저장은 충돌하지 않는다', () => {
    const tab = openTab()
    const id = firstId(tab)
    for (const title of ['1', '2', '3']) {
      expect(tab.addTrack(id, { videoId: A_VIDEO, title })).toMatchObject({
        ok: true,
        persisted: true,
      })
    }
    tab.renamePlaylist(id, '새 이름')
    tab.moveTrack(id, tab.playlists[0]?.tracks[2]?.id as string, 'up')
    expect(tab.externalChange).toBeNull()
    expect(titles(stored())).toEqual(['1', '3', '2'])
  })

  it('다른 키의 이벤트 · 원문이 같은 이벤트는 다시 읽지 않는다', () => {
    const tab = openTab()
    const listening = tab.watchExternalChanges()

    deliverStorageEvent(STORAGE_KEYS.theme)
    deliverStorageEvent(STORAGE_KEYS.moments)
    deliverStorageEvent(KEY) // 원문은 그대로
    expect(tab.externalChange).toBeNull()

    listening()
    realLocalStorage.setItem(
      KEY,
      JSON.stringify({ version: 1, data: { playlists: [], selectedPlaylistId: null } }),
    )
    deliverStorageEvent(KEY) // 끊은 뒤에는 듣지 않는다
    expect(tab.externalChange).toBeNull()
  })

  it('다른 탭이 저장소를 비우면(key: null) 비운 상태를 읽는다 — 첫 실행 목록을 다시 만들지 않는다', () => {
    const tab = openTab()
    const listening = tab.watchExternalChanges()

    realLocalStorage.clear()
    deliverStorageEvent(null)

    expect(tab.playlists).toEqual([])
    expect(raw()).toBeNull()
    listening()
  })
})

describe('백업 가져오기(replaceAll)와 함께', () => {
  const imported: LibraryData = {
    playlists: [{ id: 'imp', name: '가져온 목록', tracks: [] }],
    selectedPlaylistId: 'imp',
  }

  it('가져오기 뒤 같은 탭의 다음 변경은 충돌이 아니다 (기준 원문이 옮겨졌다)', () => {
    const tab = openTab()
    expect(tab.replaceAll(imported)).toMatchObject({ persisted: true, verified: true })
    expect(tab.addTrack('imp', { videoId: A_VIDEO })).toMatchObject({ ok: true, persisted: true })
  })

  it('다른 탭의 가져오기는 이 탭의 낡은 변경을 막고, 이벤트로 화면에 반영된다', () => {
    const tabA = openTab()
    const oldId = firstId(tabA)
    const tabB = openTab()

    tabB.replaceAll(imported)
    expect(tabA.addTrack(oldId, { videoId: A_VIDEO })).toEqual({ ok: false, reason: 'conflict' })
    expect(tabA.playlists.map((playlist) => playlist.name)).toEqual(['가져온 목록'])
    expect(stored()).toEqual(imported)
  })

  it('가져오기의 쓰기가 실패하면 다음 변경도 막히지 않고 원래 원문은 그대로', () => {
    const tab = openTab()
    const before = raw()
    quotaExceededOnWrite()
    expect(tab.replaceAll(imported)).toMatchObject({ persisted: false })
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: realLocalStorage,
    })
    expect(raw()).toBe(before)
  })
})

describe('저장소에 접근할 수 없게 된 것은 다른 탭의 변경이 아니다', () => {
  it('세션 도중 저장소가 막히면 메모리의 목록을 지키고 "저장되지 않음" 으로 알린다', () => {
    const tab = openTab()
    const id = firstId(tab)
    tab.addTrack(id, { videoId: A_VIDEO, title: '저장된 곡' })

    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() {
        throw new DOMException('denied', 'SecurityError')
      },
    })

    expect(tab.addTrack(id, { videoId: B_VIDEO, title: '메모리 곡' })).toMatchObject({
      ok: true,
      persisted: false,
    })
    expect(titles(tab)).toEqual(['저장된 곡', '메모리 곡'])
    expect(tab.externalChange).toBeNull()
  })
})
