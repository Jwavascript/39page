/**
 * M11-1 PoC — 브리지 요청 처리. **실제 store** 와 jsdom localStorage 로 돌린다.
 *
 * jsdom 에는 Web Locks 가 없어 store 가 잠금 없이 바로 실행한다 (ADR 0025 결정 6). 잠금이 있는
 * 실제 경합은 하네스(`harness/run.mjs` S5-race)가 실제 Chrome 에서 본다.
 */
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { libraryStorage, useLibraryStore } from '@/stores/library'
import { momentsStorage, useMomentsStore } from '@/stores/moments'

import { createBridgeHandler, type BridgeDeps } from '../web/bridgeHandlers'
import type { BridgePayload, BridgeResponse } from '../web/bridgeProtocol'

const VIDEO = 'dQw4w9WgXcQ'
let seq = 0
const nextId = (): string => `req_test_${String(++seq).padStart(8, '0')}`

function setup(overrides: Partial<BridgeDeps> = {}) {
  const library = useLibraryStore()
  const moments = useMomentsStore()
  library.restore()
  moments.restore()
  const handler = createBridgeHandler({
    library,
    moments,
    readLibrary: () => libraryStorage.read(),
    readMoments: () => momentsStorage.read(),
    ...overrides,
  })
  const run = (payload: BridgePayload, id = nextId(), deadline = Date.now() + 5_000) =>
    handler.handle({ id, deadline, payload })
  return { library, moments, handler, run }
}

function data(response: BridgeResponse): Record<string, unknown> {
  if (!response.ok) throw new Error(`expected ok, got ${response.error.code}`)
  return response.data as Record<string, unknown>
}

function errorOf(response: BridgeResponse) {
  if (response.ok) throw new Error('expected error')
  return response.error
}

beforeEach(() => {
  localStorage.clear()
  setActivePinia(createPinia())
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('곡 담기', () => {
  it('store 로 저장하고 저장소를 다시 읽어 확인한 뒤에만 ok', async () => {
    const { library, run } = setup()
    const created = await library.createPlaylist('MY RECORDS')
    if (!created.ok) throw new Error('setup')
    const res = await run({
      op: 'track/add',
      playlistId: created.playlistId,
      videoId: VIDEO,
      title: 'Song',
    })
    expect(data(res)).toMatchObject({ position: 1, verified: true, playlistName: 'MY RECORDS' })
    expect(libraryStorage.read().value.playlists[0]?.tracks[0]).toMatchObject({
      videoId: VIDEO,
      title: 'Song',
    })
  })

  it('같은 요청 ID — 다시 실행하지 않는다 · 다른 내용이면 id-reused', async () => {
    const { library, run } = setup()
    const created = await library.createPlaylist('A')
    if (!created.ok) throw new Error('setup')
    const id = nextId()
    const payload: BridgePayload = {
      op: 'track/add',
      playlistId: created.playlistId,
      videoId: VIDEO,
      title: null,
    }
    const [a, b] = await Promise.all([run(payload, id), run(payload, id)])
    const c = await run(payload, id)
    expect(data(a).trackId).toBe(data(b).trackId)
    expect(data(c).trackId).toBe(data(a).trackId)
    expect(libraryStorage.read().value.playlists[0]?.tracks).toHaveLength(1)
    const reused = await run({ ...payload, title: 'other' }, id)
    expect(errorOf(reused).code).toBe('id-reused')
  })

  it('마감이 지났으면 시작하지 않는다 · 너무 먼 마감은 거절', async () => {
    const { library, run } = setup()
    const created = await library.createPlaylist('A')
    if (!created.ok) throw new Error('setup')
    const payload: BridgePayload = {
      op: 'track/add',
      playlistId: created.playlistId,
      videoId: VIDEO,
      title: null,
    }
    expect(errorOf(await run(payload, nextId(), Date.now() - 1)).code).toBe('expired')
    expect(errorOf(await run(payload, nextId(), Date.now() + 120_000)).code).toBe('bad-request')
    expect(libraryStorage.read().value.playlists[0]?.tracks).toHaveLength(0)
  })

  it('저장소 쓰기 실패 — not-persisted 이고 메모리도 저장소 상태로 되돌린다', async () => {
    const { library, run } = setup()
    const created = await library.createPlaylist('A')
    if (!created.ok) throw new Error('setup')
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError')
    })
    const res = await run({
      op: 'track/add',
      playlistId: created.playlistId,
      videoId: VIDEO,
      title: null,
    })
    expect(errorOf(res).code).toBe('not-persisted')
    expect(library.playlists[0]?.tracks).toHaveLength(0)
  })

  it('다시 읽어 보니 없으면 not-verified — 성공이라 하지 않는다', async () => {
    const empty = { value: { playlists: [], selectedPlaylistId: null }, outcome: 'stored' as const }
    const { library, run } = setup({ readLibrary: () => empty })
    const created = await library.createPlaylist('A')
    if (!created.ok) throw new Error('setup')
    const res = await run({
      op: 'track/add',
      playlistId: created.playlistId,
      videoId: VIDEO,
      title: null,
    })
    expect(errorOf(res).code).toBe('not-verified')
  })

  it('보호 상태(상위 버전)면 store 를 부르지 않고 blocked · 원본 그대로', async () => {
    const future = JSON.stringify({
      version: 99,
      data: { playlists: [], selectedPlaylistId: null },
    })
    localStorage.setItem('39page.library', future)
    const { run } = setup()
    const res = await run({ op: 'track/add', playlistId: 'p', videoId: VIDEO, title: null })
    expect(errorOf(res)).toMatchObject({
      code: 'blocked',
      detail: { store: 'library', status: 'protected' },
    })
    expect(localStorage.getItem('39page.library')).toBe(future)
  })
})

describe('새 목록 만들고 담기', () => {
  it('한 요청으로 목록과 곡을 저장한다', async () => {
    const { run } = setup()
    const res = await run({
      op: 'playlist/create-and-add',
      name: '즉석',
      videoId: VIDEO,
      title: 'S',
    })
    expect(data(res)).toMatchObject({ created: true, position: 1, playlistName: '즉석' })
    const stored = libraryStorage.read().value
    expect(stored.playlists).toHaveLength(1)
    expect(stored.playlists[0]?.tracks).toHaveLength(1)
  })

  it('부분 성공 — 목록은 저장, 곡은 실패 → partial + 만든 목록 ID (전체 성공이 아니다)', async () => {
    const real = useLibraryStore()
    const flaky = new Proxy(real, {
      get(target, property, receiver) {
        if (property === 'addTrack') return () => Promise.resolve({ ok: false, reason: 'busy' })
        return Reflect.get(target, property, receiver) as unknown
      },
    })
    const { run } = setup({ library: flaky })
    const res = await run({
      op: 'playlist/create-and-add',
      name: '반쪽',
      videoId: VIDEO,
      title: null,
    })
    const error = errorOf(res)
    expect(error.code).toBe('partial')
    const stored = libraryStorage.read().value
    expect(stored.playlists).toHaveLength(1)
    expect(stored.playlists[0]?.tracks).toHaveLength(0)
    expect(error.detail).toMatchObject({
      playlistId: stored.playlists[0]?.id,
      cause: 'busy',
      step: 'add',
    })
  })

  it('알려 두기: createPlaylist 는 새 목록을 선택한다 — 대시보드의 선택이 바뀐다 (M11 결정 필요)', async () => {
    const { library, run } = setup()
    const first = await library.createPlaylist('기존')
    if (!first.ok) throw new Error('setup')
    await run({ op: 'playlist/create-and-add', name: '새것', videoId: VIDEO, title: null })
    expect(libraryStorage.read().value.selectedPlaylistId).not.toBe(first.playlistId)
  })
})

describe('Moment', () => {
  it('저장 → 확인 · 영상별 목록 · 저장 여부 조회', async () => {
    const { run } = setup()
    const since = new Date(Date.now() - 1_000).toISOString()
    const res = await run({
      op: 'moment/add',
      videoId: VIDEO,
      atSeconds: 83,
      note: '후렴',
      title: 'S',
    })
    const momentId = data(res).momentId
    expect(momentsStorage.read().value.map((m) => m.id)).toEqual([momentId])
    const list = data(await run({ op: 'moment/list-for-video', videoId: VIDEO }))
    expect(list.moments).toHaveLength(1)
    const found = data(await run({ op: 'moment/find', videoId: VIDEO, atSeconds: 83, since }))
    expect(found.matches).toEqual([{ id: momentId, note: '후렴' }])
    const none = data(await run({ op: 'moment/find', videoId: VIDEO, atSeconds: 84, since }))
    expect(none.matches).toEqual([])
  })

  it('손상된 Moments — blocked, 원본 보존, 라이브러리 쓰기는 영향 없음', async () => {
    const broken = '{"version":1,"data":[{"broken":'
    localStorage.setItem('39page.moments', broken)
    const { run } = setup()
    const res = await run({ op: 'moment/add', videoId: VIDEO, atSeconds: 1, note: '', title: null })
    expect(errorOf(res)).toMatchObject({ code: 'blocked', detail: { store: 'moments' } })
    expect(localStorage.getItem('39page.moments')).toBe(broken)
    const created = await run({
      op: 'playlist/create-and-add',
      name: 'L',
      videoId: VIDEO,
      title: null,
    })
    expect(created.ok).toBe(true)
  })
})
