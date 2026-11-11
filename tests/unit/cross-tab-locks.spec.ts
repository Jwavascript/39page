/**
 * store 의 쓰기가 탭 간 잠금을 지난다 (M10-3 안정화, ADR 0025).
 *
 * `navigator.locks` 자리에 브라우저 전체 하나짜리 가짜 잠금 관리자를 끼운다
 * (`tests/support/fakeTabs.ts`). "탭" 하나 = Pinia 하나이고 jsdom 의 `localStorage`
 * 를 함께 쓴다 — 전파가 즉시라서 영수증 기다림은 바로 끝난다. 늦은 전파의 경합은
 * `cross-tab-gate.spec.ts` 가 따로 고정한다.
 *
 * 여기서 보는 것:
 * - 대시보드 · 수집 화면 · 가져오기가 **같은 잠금**을 지나고 결과를 정확히 말한다.
 * - 거절(`conflict` · `busy` · `stale`)이면 아무것도 쓰지 않는다.
 * - 어떤 호출부도 잠금을 건너 저장소에 쓰지 않는다 (원문 검사).
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useCollect } from '@/features/collect/useCollect'
import {
  LOCK_TIMEOUT_MS,
  STORAGE_KEYS,
  VISIBILITY_TIMEOUT_MS,
  currentLockManager,
} from '@/shared/storage'
import type { LibraryData, Moment, MomentsData } from '@/shared/types'
import { useLibraryStore } from '@/stores/library'
import { MOMENTS_STORAGE_VERSION, useMomentsStore } from '@/stores/moments'

import { FakeLockWorld } from '../support/fakeTabs'

const LIBRARY = STORAGE_KEYS.library
const MOMENTS = STORAGE_KEYS.moments
const A_VIDEO = 'dQw4w9WgXcQ'
const B_VIDEO = 'jNQXAC9IVRw'
const REQUEST = 'req_0123456789abcdef'
const realLocalStorage = globalThis.localStorage

let world: FakeLockWorld

function installLocks(): void {
  world = new FakeLockWorld()
  Object.defineProperty(globalThis.navigator, 'locks', {
    configurable: true,
    value: world.forTab('page'),
  })
}

function removeLocks(): void {
  delete (globalThis.navigator as { locks?: unknown }).locks
}

beforeEach(() => {
  realLocalStorage.clear()
  installLocks()
})

afterEach(() => {
  removeLocks()
  vi.useRealTimers()
  vi.restoreAllMocks()
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: realLocalStorage })
})

type Library = ReturnType<typeof useLibraryStore>
type Moments = ReturnType<typeof useMomentsStore>

async function openLibraryTab(): Promise<Library> {
  const store = useLibraryStore(createPinia())
  store.restore()
  await store.seedFirstRunPlaylist('MY RECORDS')
  return store
}

function openMomentsTab(): Moments {
  const store = useMomentsStore(createPinia())
  store.restore()
  return store
}

function storedLibrary(): LibraryData {
  return JSON.parse(globalThis.localStorage.getItem(LIBRARY) as string).data as LibraryData
}

function storedTitles(): string[] {
  return storedLibrary().playlists.flatMap((playlist) => playlist.tracks.map((t) => t.title))
}

function storedMoments(): MomentsData {
  return JSON.parse(globalThis.localStorage.getItem(MOMENTS) as string).data as MomentsData
}

function moment(overrides: Partial<Moment> = {}): Moment {
  return {
    id: 'm-1',
    source: 'youtube',
    videoId: A_VIDEO,
    atSeconds: 83,
    note: '처음 메모',
    title: 'Song',
    createdAt: '2026-11-07T01:00:00.000Z',
    updatedAt: '2026-11-07T01:00:00.000Z',
    ...overrides,
  }
}

function seedMoments(list: Moment[]): void {
  globalThis.localStorage.setItem(
    MOMENTS,
    JSON.stringify({ version: MOMENTS_STORAGE_VERSION, data: list }),
  )
}

/** 다른 탭이 쓰기 잠금을 붙잡고 놓지 않는다. 잡은 뒤에 놓는 함수를 돌려준다. */
function holdWriteLock(name: string): Promise<() => void> {
  return new Promise((granted) => {
    void world.forTab('other').request(
      `${name}:write`,
      { mode: 'exclusive' },
      () =>
        new Promise<void>((release) => {
          granted(release)
        }),
    )
  })
}

describe('잠금 관리자', () => {
  it('브라우저에 Web Locks 가 있으면 그것을 쓴다', () => {
    expect(currentLockManager()).not.toBeNull()
    removeLocks()
    expect(currentLockManager()).toBeNull()
  })
})

/* ================================================================== *
 * 라이브러리 — 대시보드 · 수집 화면 · 가져오기
 * ================================================================== */

describe('라이브러리 — 같은 순간의 쓰기', () => {
  it('두 탭이 같은 순간 다른 곡을 더하면 하나는 충돌로 거절되고, 다시 누르면 둘 다 남는다', async () => {
    const tabA = await openLibraryTab()
    const tabB = await openLibraryTab()
    const id = tabA.playlists[0]?.id as string

    const [a, b] = await Promise.all([
      tabA.addTrack(id, { videoId: A_VIDEO, title: 'A 곡' }),
      tabB.addTrack(id, { videoId: B_VIDEO, title: 'B 곡' }),
    ])

    expect(a).toMatchObject({ ok: true, persisted: true })
    expect(b).toEqual({ ok: false, reason: 'conflict' })
    // 거절된 탭은 최신을 다시 읽었다.
    expect(tabB.playlists[0]?.tracks.map((track) => track.title)).toEqual(['A 곡'])

    expect(await tabB.addTrack(id, { videoId: B_VIDEO, title: 'B 곡' })).toMatchObject({
      ok: true,
    })
    expect(storedTitles()).toEqual(['A 곡', 'B 곡'])
  })

  it('저장이 끝나기 전에는 결과가 오지 않는다 — 잠금을 기다리는 동안 이행하지 않는다', async () => {
    const tab = await openLibraryTab()
    const release = await holdWriteLock(LIBRARY)
    let settled = false

    const pending = tab
      .addTrack(tab.playlists[0]?.id as string, { videoId: A_VIDEO })
      .then((result) => {
        settled = true
        return result
      })
    await Promise.resolve()
    await Promise.resolve()
    expect(settled).toBe(false)
    expect(storedTitles()).toEqual([])

    release()
    expect(await pending).toMatchObject({ ok: true, persisted: true })
  })

  it(`다른 탭이 ${String(LOCK_TIMEOUT_MS)}ms 넘게 잠그면 busy — 메모리도 저장소도 그대로다`, async () => {
    vi.useFakeTimers()
    const tab = await openLibraryTab()
    const before = globalThis.localStorage.getItem(LIBRARY)
    await holdWriteLock(LIBRARY)

    const pending = tab.addTrack(tab.playlists[0]?.id as string, { videoId: A_VIDEO })
    await vi.advanceTimersByTimeAsync(LOCK_TIMEOUT_MS + 10)

    expect(await pending).toEqual({ ok: false, reason: 'busy' })
    expect(tab.playlists[0]?.tracks).toEqual([])
    expect(globalThis.localStorage.getItem(LIBRARY)).toBe(before)
  })

  it('앞 탭의 쓰기가 보이지 않으면(영수증 번호가 저장소보다 크다) 쓰지 않고 다시 읽는다', async () => {
    vi.useFakeTimers()
    const tab = await openLibraryTab()
    const before = globalThis.localStorage.getItem(LIBRARY)
    const sequence = tab.externalChange?.sequence ?? 0
    // 다른 탭이 번호 99 를 썼다고 영수증을 걸었는데 이 탭 저장소에는 아직 없다.
    void world
      .forTab('other')
      .request(
        `${LIBRARY}:rev:99:${String(Date.now())}`,
        { mode: 'shared' },
        () => new Promise(() => undefined),
      )

    const pending = tab.addTrack(tab.playlists[0]?.id as string, { videoId: A_VIDEO })
    await vi.advanceTimersByTimeAsync(VISIBILITY_TIMEOUT_MS + 10)

    expect(await pending).toEqual({ ok: false, reason: 'conflict' })
    expect(globalThis.localStorage.getItem(LIBRARY)).toBe(before)
    expect(tab.externalChange?.sequence).toBe(sequence + 1)
  })

  it('보호 상태의 수정은 잠그지 않고 쓰지도 않는다 — 동시에 해도 원본은 그대로다', async () => {
    globalThis.localStorage.setItem(LIBRARY, '{broken')
    const tabA = await openLibraryTab()
    const tabB = await openLibraryTab()
    expect(tabA.status).toBe('protected')

    const [a, b] = await Promise.all([tabA.createPlaylist('A 목록'), tabB.createPlaylist('B 목록')])

    expect(a).toMatchObject({ ok: true, persisted: false })
    expect(b).toMatchObject({ ok: true, persisted: false })
    expect(globalThis.localStorage.getItem(LIBRARY)).toBe('{broken')
    expect(world.heldNames()).toEqual([])
  })

  it('첫 실행을 두 탭이 같은 순간 해도 기본 목록은 하나다', async () => {
    const tabA = useLibraryStore(createPinia())
    const tabB = useLibraryStore(createPinia())
    tabA.restore()
    tabB.restore()

    const [a, b] = await Promise.all([
      tabA.seedFirstRunPlaylist('MY RECORDS'),
      tabB.seedFirstRunPlaylist('MY RECORDS'),
    ])

    expect(a).toMatchObject({ ok: true })
    // 두 번째는 잠금 안에서 바뀐 원문을 보고 거절된다 — 두 번째 기본 목록을 만들지 않는다.
    expect(b).toEqual({ ok: false, reason: 'conflict' })
    expect(storedLibrary().playlists).toHaveLength(1)
  })
})

describe('수집 화면(Quick Add) 과 대시보드가 같은 길을 지난다', () => {
  function collectIn(pinia: ReturnType<typeof createPinia>, videoId = B_VIDEO) {
    setActivePinia(pinia)
    return useCollect(`#collect?v=1&kind=track&videoId=${videoId}&req=${REQUEST}`, {
      clearRequest: () => undefined,
    })
  }

  it('대시보드가 같은 순간 이름을 바꾸면 수집 화면은 충돌을 알리고, 다시 누르면 둘 다 남는다', async () => {
    const dashboard = await openLibraryTab()
    const collectPinia = createPinia()
    const collectStore = useLibraryStore(collectPinia)
    collectStore.restore()
    const collect = collectIn(collectPinia)
    const id = dashboard.playlists[0]?.id as string

    const [renamed] = await Promise.all([dashboard.renamePlaylist(id, '새 이름'), collect.add()])

    expect(renamed).toMatchObject({ ok: true })
    expect(collect.phase.value).toEqual({ kind: 'choosing', failure: 'conflict' })
    expect(storedLibrary().playlists[0]?.tracks).toEqual([])

    await collect.add()
    expect(collect.phase.value).toMatchObject({ kind: 'saved', playlistName: '새 이름' })
    expect(storedLibrary().playlists[0]?.name).toBe('새 이름')
    expect(storedLibrary().playlists[0]?.tracks.map((track) => track.videoId)).toEqual([B_VIDEO])
  })

  it('잠금을 기다리는 동안 saving 이고 다시 눌러도 한 곡만 들어간다', async () => {
    await openLibraryTab()
    const pinia = createPinia()
    useLibraryStore(pinia).restore()
    const collect = collectIn(pinia)
    const release = await holdWriteLock(LIBRARY)

    const first = collect.add()
    expect(collect.saving.value).toBe(true)
    expect(collect.canAdd.value).toBe(false)
    const second = collect.add()

    release()
    await Promise.all([first, second])

    expect(collect.saving.value).toBe(false)
    expect(collect.phase.value.kind).toBe('saved')
    expect(storedLibrary().playlists[0]?.tracks).toHaveLength(1)
  })

  it('잠금을 얻지 못하면 busy 를 알리고 저장하지 않는다 — 다시 누를 수 있다', async () => {
    vi.useFakeTimers()
    await openLibraryTab()
    const pinia = createPinia()
    useLibraryStore(pinia).restore()
    const collect = collectIn(pinia)
    const release = await holdWriteLock(LIBRARY)

    const pending = collect.add()
    await vi.advanceTimersByTimeAsync(LOCK_TIMEOUT_MS + 10)
    await pending

    expect(collect.phase.value).toEqual({ kind: 'choosing', failure: 'busy' })
    expect(collect.canAdd.value).toBe(true)
    expect(storedLibrary().playlists[0]?.tracks).toEqual([])

    release()
    await vi.advanceTimersByTimeAsync(0)
    await collect.add()
    expect(collect.phase.value.kind).toBe('saved')
  })

  it('저장 실패 뒤 다시 시도하면 한 번만 저장된다', async () => {
    await openLibraryTab()
    const pinia = createPinia()
    useLibraryStore(pinia).restore()
    const collect = collectIn(pinia)
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => {
      throw new DOMException('full', 'QuotaExceededError')
    })

    await collect.add()
    expect(collect.phase.value).toEqual({ kind: 'choosing', failure: 'write-failed' })
    expect(storedLibrary().playlists[0]?.tracks).toEqual([])

    setItem.mockRestore()
    await collect.add()
    expect(collect.phase.value.kind).toBe('saved')
    expect(storedLibrary().playlists[0]?.tracks).toHaveLength(1)
  })
})

describe('가져오기(replaceAll) 와 평범한 저장', () => {
  it('미리보기 뒤 다른 탭이 저장했으면 잠금 안에서 알아채고 교체하지 않는다', async () => {
    const importer = await openLibraryTab()
    const other = await openLibraryTab()
    const expectedRaw = globalThis.localStorage.getItem(LIBRARY)

    await other.addTrack(other.playlists[0]?.id as string, { videoId: B_VIDEO, title: '남의 곡' })
    const result = await importer.replaceAll(
      { playlists: [{ id: 'x', name: 'FROM FILE', tracks: [] }], selectedPlaylistId: 'x' },
      { expectedRaw },
    )

    expect(result).toEqual({ ok: false, reason: 'stale' })
    expect(storedTitles()).toEqual(['남의 곡'])
    // 메모리도 바꾸지 않았다.
    expect(importer.playlists[0]?.name).toBe('MY RECORDS')
  })

  it('같은 순간의 평범한 저장과 가져오기 — 먼저 잠근 쪽만 반영되고 나머지는 거절된다', async () => {
    const importer = await openLibraryTab()
    const other = await openLibraryTab()
    const expectedRaw = globalThis.localStorage.getItem(LIBRARY)

    const [added, replaced] = await Promise.all([
      other.addTrack(other.playlists[0]?.id as string, { videoId: B_VIDEO, title: '남의 곡' }),
      importer.replaceAll(
        { playlists: [{ id: 'x', name: 'FROM FILE', tracks: [] }], selectedPlaylistId: 'x' },
        { expectedRaw },
      ),
    ])

    expect(added).toMatchObject({ ok: true })
    expect(replaced).toEqual({ ok: false, reason: 'stale' })
    expect(storedTitles()).toEqual(['남의 곡'])
  })

  it('잠금을 얻지 못하면 busy — 교체하지 않는다', async () => {
    vi.useFakeTimers()
    const importer = await openLibraryTab()
    const before = globalThis.localStorage.getItem(LIBRARY)
    await holdWriteLock(LIBRARY)

    const pending = importer.replaceAll({ playlists: [], selectedPlaylistId: null })
    await vi.advanceTimersByTimeAsync(LOCK_TIMEOUT_MS + 10)

    expect(await pending).toEqual({ ok: false, reason: 'busy' })
    expect(globalThis.localStorage.getItem(LIBRARY)).toBe(before)
  })
})

/* ================================================================== *
 * Moments
 * ================================================================== */

describe('Moments — 같은 순간의 쓰기', () => {
  it('두 탭이 같은 순간 다른 Moment 를 더하면 하나는 충돌, 다시 누르면 둘 다 남는다', async () => {
    const tabA = openMomentsTab()
    const tabB = openMomentsTab()

    const [a, b] = await Promise.all([
      tabA.add({ videoId: A_VIDEO, atSeconds: 10, note: 'A' }),
      tabB.add({ videoId: B_VIDEO, atSeconds: 20, note: 'B' }),
    ])

    expect(a).toMatchObject({ ok: true, persisted: true })
    expect(b).toEqual({ ok: false, reason: 'conflict' })
    expect(await tabB.add({ videoId: B_VIDEO, atSeconds: 20, note: 'B' })).toMatchObject({
      ok: true,
    })
    expect(storedMoments().map((item) => item.note)).toEqual(['A', 'B'])
  })

  it('지운 Moment 의 메모를 다른 탭이 (모른 채) 고치면 — 되살리지 않는다', async () => {
    seedMoments([moment({ id: 'x' }), moment({ id: 'y', atSeconds: 5 })])
    const remover = openMomentsTab()
    const editor = openMomentsTab()

    const [removed, edited] = await Promise.all([
      remover.remove('x'),
      editor.updateNote('x', '고친 메모'),
    ])

    expect(removed).toMatchObject({ ok: true })
    expect(edited).toEqual({ ok: false, reason: 'conflict' })
    // 다시 시도하면 없는 것을 알린다 — 지운 것이 돌아오지 않는다.
    expect(await editor.updateNote('x', '고친 메모')).toEqual({ ok: false, reason: 'not-found' })
    expect(storedMoments().map((item) => item.id)).toEqual(['y'])
  })

  it('고친 메모를 다른 탭이 (모른 채) 지우려 하면 — 거절하고 고친 메모를 보여준 뒤 다시 묻는다', async () => {
    seedMoments([moment({ id: 'x' })])
    const editor = openMomentsTab()
    const remover = openMomentsTab()

    const [edited, removed] = await Promise.all([
      editor.updateNote('x', '고친 메모'),
      remover.remove('x'),
    ])

    expect(edited).toMatchObject({ ok: true })
    expect(removed).toEqual({ ok: false, reason: 'conflict' })
    expect(remover.getMoment('x')?.note).toBe('고친 메모')
    expect(storedMoments()[0]?.note).toBe('고친 메모')
  })

  it('잠금을 얻지 못하면 busy — 저장소는 그대로다', async () => {
    vi.useFakeTimers()
    const tab = openMomentsTab()
    await holdWriteLock(MOMENTS)

    const pending = tab.add({ videoId: A_VIDEO, atSeconds: 1 })
    await vi.advanceTimersByTimeAsync(LOCK_TIMEOUT_MS + 10)

    expect(await pending).toEqual({ ok: false, reason: 'busy' })
    expect(tab.moments).toEqual([])
    expect(globalThis.localStorage.getItem(MOMENTS)).toBeNull()
  })

  it('라이브러리와 Moments 는 서로 다른 잠금이다 — 한쪽이 붙잡혀도 다른 쪽은 쓴다', async () => {
    vi.useFakeTimers()
    await holdWriteLock(LIBRARY)
    const tab = openMomentsTab()

    const pending = tab.add({ videoId: A_VIDEO, atSeconds: 1 })
    await vi.advanceTimersByTimeAsync(10)

    expect(await pending).toMatchObject({ ok: true, persisted: true })
  })

  it('가져오기의 Moments 교체도 미리보기 뒤의 변경을 덮지 않는다', async () => {
    const importer = openMomentsTab()
    const other = openMomentsTab()
    const expectedRaw = globalThis.localStorage.getItem(MOMENTS)

    await other.add({ videoId: A_VIDEO, atSeconds: 3, note: '남의 Moment' })
    const result = await importer.replaceAllMoments([], { expectedRaw })

    expect(result).toEqual({ ok: false, reason: 'stale' })
    expect(storedMoments().map((item) => item.note)).toEqual(['남의 Moment'])
  })

  it('다른 탭의 저장을 들으면 다시 읽는다 — 저장 못 한 변경이 사라졌으면 그렇다고 남긴다', async () => {
    const tab = openMomentsTab()
    const other = openMomentsTab()
    const stop = tab.watchExternalChanges()

    await other.add({ videoId: A_VIDEO, atSeconds: 3, note: '남의 Moment' })
    globalThis.dispatchEvent(new StorageEvent('storage', { key: MOMENTS }))

    expect(tab.moments.map((item) => item.note)).toEqual(['남의 Moment'])
    expect(tab.externalChange).toEqual({
      sequence: 1,
      discardedUnsaved: false,
      possiblyOverwritten: false,
    })
    stop()
  })
})

/* ================================================================== *
 * Web Locks 가 없는 환경
 * ================================================================== */

describe('Web Locks 가 없는 환경', () => {
  beforeEach(() => removeLocks())

  it('명령은 바로 반영되고(이미 이행된 결과) 기준 원문 비교는 그대로 막는다', async () => {
    const tabA = await openLibraryTab()
    const tabB = await openLibraryTab()
    const id = tabA.playlists[0]?.id as string

    const pending = tabA.addTrack(id, { videoId: A_VIDEO, title: 'A 곡' })
    // await 전에 이미 반영됐다 — 잠금이 없으면 지금 실행한다.
    expect(storedTitles()).toEqual(['A 곡'])
    expect(await pending).toMatchObject({ ok: true })

    expect(await tabB.addTrack(id, { videoId: B_VIDEO })).toEqual({
      ok: false,
      reason: 'conflict',
    })
    expect(storedTitles()).toEqual(['A 곡'])
  })
})

/* ================================================================== *
 * 우회 금지 — 원문 검사
 * ================================================================== */

describe('어떤 호출부도 잠금을 건너 쓰지 않는다', () => {
  const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')

  it.each([
    [
      'src/stores/library.ts',
      'libraryStorage',
      [
        'createPlaylist',
        'renamePlaylist',
        'deletePlaylist',
        'selectPlaylist',
        'addTrack',
        'removeTrack',
        'moveTrack',
        'renameTrack',
        'seedFirstRunPlaylist',
        'replaceAll',
      ],
    ],
    [
      'src/stores/moments.ts',
      'momentsStorage',
      ['add', 'addMoments', 'updateNote', 'remove', 'replaceAllMoments'],
    ],
  ] as const)(
    '%s — 공개 쓰기 명령은 모두 잠금 문(command · gated · mutation)으로 시작한다',
    (path, _storage, actions) => {
      const source = read(path)
      const bypassing = actions.filter((action) => {
        const match = new RegExp(`\\n  function ${action}\\([^]*?\\{\\n\\s*return (\\w+)`).exec(
          source,
        )
        return !['command', 'gated', 'mutation'].includes(match?.[1] ?? '')
      })
      expect(bypassing).toEqual([])
    },
  )

  it('저장소 쓰기는 store 안에만 있다 — 화면·수집·가져오기는 직접 쓰지 않는다', () => {
    const offenders: string[] = []
    const files = [
      'src/features/collect/useCollect.ts',
      'src/features/backup/useBackupImport.ts',
      'src/features/library/RecordLibraryDrawer.vue',
      'src/features/library/PlaylistWidget.vue',
      'src/features/moments/useMomentCapture.ts',
      'src/features/moments/useMomentsBrowser.ts',
      'src/main.ts',
    ]
    for (const file of files) {
      const source = read(file)
      if (/(libraryStorage|momentsStorage)\.write\(/.test(source)) offenders.push(file)
      if (/localStorage\.setItem\(/.test(source)) offenders.push(file)
    }
    expect(offenders).toEqual([])
  })
})
