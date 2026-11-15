/**
 * M11-5 — 확장 저장 브리지의 39page 쪽 (ADR 0028).
 *
 * 실제 store · 실제 저장소(jsdom localStorage)로 본다. 핵심 보장:
 * - 기존 store 명령으로만 쓰고, 저장소를 다시 읽어 확인한 뒤에만 성공
 * - **정확히 한 번** — 같은 요청 ID 는 브리지가 다시 떠도(새 handler) 한 번만 저장
 * - 부분 성공(목록 O · 곡 X) 뒤 같은 ID 재시도는 목록을 또 만들지 않는다
 * - 확장에서 만든 목록은 대시보드 선택을 바꾸지 않는다 · 보호 상태면 쓰지 않는다
 * - 허용한 확장의 offscreen 안에서만 일한다
 */
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import * as ext from '../../extension/src/shared/bridgeMessages'

import { createBridgeHandler, type BridgeHandler } from '@/features/bridge/bridgeHandler'
import { startBridge, type BridgeWindow } from '@/features/bridge/bridgeHost'
import {
  BRIDGE_NAMESPACE,
  derivedIds,
  isTrustedAncestry,
  parseAllowedExtensionOrigins,
  parseBridgeRequest,
  type BridgePayload,
  type BridgeResponse,
} from '@/features/bridge/bridgeProtocol'
import { STORAGE_KEYS } from '@/shared/storage'
import { isCallerId, libraryStorage, useLibraryStore } from '@/stores/library'
import { momentsStorage, useMomentsStore } from '@/stores/moments'

const EXT = 'chrome-extension://pkagnijdhfmkodpdfgdehfdghcgbfpoa'
const A = 'aaaaaaaaaaa'
const B = 'bbbbbbbbbbb'
let seq = 0
const rid = (): string => `req-${String((seq += 1)).padStart(16, '0')}`
const realLocalStorage = globalThis.localStorage

function seedLibrary(): void {
  globalThis.localStorage.setItem(
    STORAGE_KEYS.library,
    JSON.stringify({
      version: 1,
      data: {
        playlists: [
          {
            id: 'mine',
            name: 'MINE',
            tracks: [{ id: 't1', source: 'youtube', videoId: A, title: 'Alpha' }],
          },
          { id: 'drive', name: '드라이브', tracks: [] },
        ],
        selectedPlaylistId: 'mine',
      },
    }),
  )
}

/** 브리지 한 벌 — 새로 만들면 "offscreen 이 다시 떴다" 와 같다 (메모리 기록 없음, 저장소는 그대로). */
function bridge(): BridgeHandler & { library: ReturnType<typeof useLibraryStore> } {
  setActivePinia(createPinia())
  const library = useLibraryStore()
  const moments = useMomentsStore()
  library.restore()
  moments.restore()
  const handler = createBridgeHandler({
    library,
    moments,
    readLibrary: () => libraryStorage.read(),
    readMoments: () => momentsStorage.read(),
  })
  return Object.assign(handler, { library })
}

function call(h: BridgeHandler, payload: BridgePayload, id = rid()): Promise<BridgeResponse> {
  return h.handle({ id, deadline: Date.now() + 8_000, payload })
}

const stored = () => libraryStorage.read().value
const storedMoments = () => momentsStorage.read().value
const data = (r: BridgeResponse) => (r.ok ? (r.data as Record<string, unknown>) : null)
const code = (r: BridgeResponse) => (r.ok ? null : r.error.code)

beforeEach(() => {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: realLocalStorage,
    writable: true,
  })
  globalThis.localStorage.clear()
  seedLibrary()
})

afterEach(() => {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: realLocalStorage,
    writable: true,
  })
  globalThis.localStorage.clear()
  vi.restoreAllMocks()
})

/* ================================================================== *
 * A. 계약
 * ================================================================== */

describe('A. 계약 — 명령 목록 · 입력 검증 · 확장 쪽과 같은 규칙', () => {
  const env = (payload: unknown, id: unknown = rid()) => ({
    ns: BRIDGE_NAMESPACE,
    v: 1,
    kind: 'request',
    id,
    deadline: Date.now() + 1000,
    payload,
  })

  it('목록에 없는 명령 · 틀린 입력은 거절한다', () => {
    expect(parseBridgeRequest({ ns: 'other' })).toBeNull()
    expect(parseBridgeRequest(env({ op: 'eval', code: 'x' }))).toMatchObject({
      ok: false,
      error: { code: 'unsupported-op' },
    })
    expect(parseBridgeRequest(env({ op: 'hello' }, 'short'))).toMatchObject({ ok: false, id: null })
    const bad: unknown[] = [
      { op: 'track/add', playlistId: 'mine', videoId: 'not-an-id', title: null },
      { op: 'track/add', playlistId: '', videoId: A },
      { op: 'moment/add', videoId: A, atSeconds: -1, note: '' },
      { op: 'moment/add', videoId: A, atSeconds: 1.5, note: '' },
      { op: 'moment/add', videoId: A, atSeconds: 1, note: 'x'.repeat(501) },
      { op: 'moment/add', videoId: A, atSeconds: 1, note: 'bidi ‮' },
      { op: 'playlist/create-and-add', name: '   ', videoId: A },
      { op: 'playlist/create-and-add', name: 'n'.repeat(61), videoId: A },
      { op: 'track/add', playlistId: 'mine', videoId: A, title: 't'.repeat(101) },
      { op: 'request/status', kind: 'track', target: rid(), playlistId: null },
    ]
    for (const payload of bad) {
      expect(parseBridgeRequest(env(payload))?.ok).toBe(false)
      // 확장 쪽 검증도 같은 값을 거절한다 (서비스 워커가 먼저 걸러 낸다).
      expect(ext.parseBridgePayload(payload)).toBeNull()
    }
  })

  it('확장 쪽 계약과 이름 · 한도 · 실패 코드가 같다', () => {
    expect(ext.BRIDGE_NAMESPACE).toBe(BRIDGE_NAMESPACE)
    expect(ext.WRITE_OPS).toEqual(['track/add', 'playlist/create-and-add', 'moment/add'])
    const good: unknown[] = [
      { op: 'hello' },
      { op: 'library/list', videoId: A },
      { op: 'track/add', playlistId: 'mine', videoId: A, title: '제목', allowDuplicate: true },
      { op: 'playlist/create-and-add', name: '새 목록', videoId: A, title: null },
      { op: 'moment/add', videoId: A, atSeconds: 83, note: '후렴\n둘째 줄', title: null },
      { op: 'request/status', kind: 'playlist', target: rid(), playlistId: null },
    ]
    for (const payload of good) {
      const web = parseBridgeRequest(env(payload))
      expect(web?.ok).toBe(true)
      expect(ext.parseBridgePayload(payload)).toEqual(web?.ok ? web.request.payload : null)
    }
  })

  it('저장 항목 id 는 요청 ID 에서 정해지고 store 의 형식에 맞다', () => {
    const ids = derivedIds('0123456789abcdef-xyz')
    expect(ids).toEqual({
      playlistId: 'ext-0123456789abcdef-xyz-list',
      trackId: 'ext-0123456789abcdef-xyz',
      momentId: 'ext-0123456789abcdef-xyz',
    })
    expect(Object.values(ids).every(isCallerId)).toBe(true)
  })

  it('허용 확장 · 자리 — 비어 있으면 꺼짐, 최상위 · 웹사이트 액자는 거절', () => {
    expect(parseAllowedExtensionOrigins(' pkagnijdhfmkodpdfgdehfdghcgbfpoa , bad, ')).toEqual([EXT])
    expect(parseAllowedExtensionOrigins(undefined)).toEqual([])
    expect(isTrustedAncestry([EXT], false, [])).toBe(false)
    expect(isTrustedAncestry([EXT], false, [EXT])).toBe(true)
    expect(isTrustedAncestry([EXT], true, [EXT])).toBe(false)
    expect(isTrustedAncestry(['https://www.youtube.com', EXT], false, [EXT])).toBe(false)
    expect(isTrustedAncestry(null, false, [EXT])).toBe(false)
  })
})

/* ================================================================== *
 * B. 저장 — 확인 뒤에만 성공, 대시보드 선택 유지
 * ================================================================== */

describe('B. 음악 담기 · 새 목록', () => {
  it('목록 조회 — 곡 수와 이 영상이 이미 있는 자리', async () => {
    const h = bridge()
    const r = await call(h, { op: 'library/list', videoId: A })
    expect(data(r)?.playlists).toEqual([
      { id: 'mine', name: 'MINE', trackCount: 1, positions: [1] },
      { id: 'drive', name: '드라이브', trackCount: 0, positions: [] },
    ])
  })

  it('기존 목록에 담기 — 저장소에서 확인한 위치 · 요청 ID 에서 정한 곡 id', async () => {
    const h = bridge()
    const id = rid()
    const r = await call(
      h,
      { op: 'track/add', playlistId: 'drive', videoId: B, title: 'Bravo', allowDuplicate: false },
      id,
    )
    expect(data(r)).toMatchObject({
      playlistId: 'drive',
      position: 1,
      verified: true,
      existed: false,
    })
    expect(stored().playlists[1]?.tracks).toEqual([
      { id: derivedIds(id).trackId, source: 'youtube', videoId: B, title: 'Bravo' },
    ])
  })

  it('같은 영상이 이미 있으면 묻는다 — "한 번 더" 를 고른 경우만 담는다', async () => {
    const h = bridge()
    const first = await call(h, {
      op: 'track/add',
      playlistId: 'mine',
      videoId: A,
      title: null,
      allowDuplicate: false,
    })
    expect(first.ok ? null : first.error).toMatchObject({
      code: 'already-in-playlist',
      detail: { positions: [1] },
    })
    expect(stored().playlists[0]?.tracks).toHaveLength(1)
    const again = await call(h, {
      op: 'track/add',
      playlistId: 'mine',
      videoId: A,
      title: null,
      allowDuplicate: true,
    })
    expect(data(again)).toMatchObject({ position: 2 })
  })

  it('새 목록 + 담기 — 대시보드의 선택 목록을 바꾸지 않는다', async () => {
    const h = bridge()
    const id = rid()
    const r = await call(
      h,
      { op: 'playlist/create-and-add', name: '  새벽  ', videoId: B, title: 'Bravo' },
      id,
    )
    expect(data(r)).toMatchObject({
      playlistId: derivedIds(id).playlistId,
      playlistName: '새벽',
      created: true,
      position: 1,
    })
    const saved = stored()
    expect(saved.selectedPlaylistId).toBe('mine')
    expect(saved.playlists.map((p) => p.name)).toEqual(['MINE', '드라이브', '새벽'])
    // 웹앱의 기존 "＋ 새 목록" 은 그대로 만든 목록을 고른다.
    const app = useLibraryStore()
    await app.createPlaylist('웹앱에서')
    expect(app.selectedPlaylist?.name).toBe('웹앱에서')
  })

  it('부분 성공 — 목록만 저장되면 partial, 같은 ID 로 다시 보내면 곡만 담고 목록은 하나', async () => {
    const h = bridge()
    const id = rid()
    const realAdd = h.library.addTrack
    vi.spyOn(h.library, 'addTrack').mockResolvedValueOnce({ ok: false, reason: 'busy' })
    const partial = await call(
      h,
      { op: 'playlist/create-and-add', name: '부분', videoId: B, title: null },
      id,
    )
    expect(partial.ok ? null : partial.error).toMatchObject({
      code: 'partial',
      retryable: true,
      detail: { playlistId: derivedIds(id).playlistId, cause: 'busy' },
    })
    expect(stored().playlists.filter((p) => p.name === '부분')).toHaveLength(1)

    // 상태 조회 — 목록은 있고 곡은 없다.
    const status = await call(h, {
      op: 'request/status',
      kind: 'playlist',
      target: id,
      playlistId: null,
    })
    expect(data(status)).toMatchObject({ state: 'partial', playlistName: '부분' })

    // 새 브리지(offscreen 이 다시 떴다)에서 같은 ID 로 — 메모리 기록이 없어도 목록을 또 만들지 않는다.
    vi.mocked(h.library.addTrack).mockImplementation(realAdd)
    const retry = await call(
      bridge(),
      { op: 'playlist/create-and-add', name: '부분', videoId: B, title: null },
      id,
    )
    expect(data(retry)).toMatchObject({ created: false, position: 1 })
    const lists = stored().playlists.filter((p) => p.name === '부분')
    expect(lists).toHaveLength(1)
    expect(lists[0]?.tracks).toHaveLength(1)
  })
})

/* ================================================================== *
 * C. Moment — 정확히 한 번
 * ================================================================== */

describe('C. Moment 저장 · 응답 유실 · 재시도', () => {
  it('저장 — 확인된 값(시점 · 메모 저장 여부)을 돌려준다', async () => {
    const h = bridge()
    const r = await call(h, {
      op: 'moment/add',
      videoId: A,
      atSeconds: 83,
      note: '후렴',
      title: 'Alpha',
    })
    expect(data(r)).toMatchObject({
      videoId: A,
      atSeconds: 83,
      noteSaved: true,
      existed: false,
      verified: true,
    })
    expect(storedMoments()).toHaveLength(1)
  })

  it('응답을 잃고 같은 ID 로 다시 보내면 — 브리지가 다시 떴어도 — 하나만 저장된다', async () => {
    const id = rid()
    const payload: BridgePayload = {
      op: 'moment/add',
      videoId: A,
      atSeconds: 83,
      note: '한 번만',
      title: null,
    }
    await call(bridge(), payload, id) // 저장은 됐고 답은 잃었다고 하자
    const status = await call(bridge(), {
      op: 'request/status',
      kind: 'moment',
      target: id,
      playlistId: null,
    })
    expect(data(status)).toMatchObject({ state: 'saved', atSeconds: 83, noteSaved: true })
    const retry = await call(bridge(), payload, id)
    expect(data(retry)).toMatchObject({ existed: true })
    expect(storedMoments()).toHaveLength(1)
  })

  it('같은 순간 겹쳐 온 재전송은 한 번 실행되고, 같은 ID 에 다른 내용은 거절', async () => {
    const h = bridge()
    const id = rid()
    const payload: BridgePayload = {
      op: 'moment/add',
      videoId: A,
      atSeconds: 10,
      note: '',
      title: null,
    }
    const [one, two] = await Promise.all([call(h, payload, id), call(h, payload, id)])
    expect(one).toEqual(two)
    expect(storedMoments()).toHaveLength(1)
    const reused = await call(h, { ...payload, atSeconds: 11 }, id)
    expect(code(reused)).toBe('id-reused')
  })

  it('조회 — 보내지 않은 요청은 not-found', async () => {
    const r = await call(bridge(), {
      op: 'request/status',
      kind: 'moment',
      target: rid(),
      playlistId: null,
    })
    expect(data(r)).toEqual({ state: 'not-found' })
  })
})

/* ================================================================== *
 * D. 보호 · 실패 — 쓰지 않는다
 * ================================================================== */

describe('D. 보호 상태 · 저장 실패 · 마감 · 다른 탭', () => {
  it('손상된 Moments · 상위 버전 라이브러리 — blocked, 원본 그대로', async () => {
    globalThis.localStorage.setItem(STORAGE_KEYS.moments, '{broken')
    globalThis.localStorage.setItem(STORAGE_KEYS.library, JSON.stringify({ version: 99, data: {} }))
    const before = {
      moments: globalThis.localStorage.getItem(STORAGE_KEYS.moments),
      library: globalThis.localStorage.getItem(STORAGE_KEYS.library),
    }
    const h = bridge()
    const m = await call(h, { op: 'moment/add', videoId: A, atSeconds: 1, note: '', title: null })
    expect(m.ok ? null : m.error).toMatchObject({
      code: 'blocked',
      detail: { store: 'moments', status: 'protected' },
    })
    const t = await call(h, { op: 'playlist/create-and-add', name: 'x', videoId: A, title: null })
    expect(code(t)).toBe('blocked')
    expect(globalThis.localStorage.getItem(STORAGE_KEYS.moments)).toBe(before.moments)
    expect(globalThis.localStorage.getItem(STORAGE_KEYS.library)).toBe(before.library)
  })

  it('저장소 쓰기 실패 — not-persisted, 메모리도 되돌린다', async () => {
    const map = new Map<string, string>(
      Object.entries({
        [STORAGE_KEYS.library]: realLocalStorage.getItem(STORAGE_KEYS.library) ?? '',
      }),
    )
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      writable: true,
      value: {
        get length() {
          return map.size
        },
        key: (i: number) => [...map.keys()][i] ?? null,
        getItem: (k: string) => map.get(k) ?? null,
        setItem: (k: string, v: string) => {
          if (k === STORAGE_KEYS.moments) throw new DOMException('full', 'QuotaExceededError')
          map.set(k, v)
        },
        removeItem: (k: string) => void map.delete(k),
        clear: () => map.clear(),
      } satisfies Storage,
    })
    const h = bridge()
    const r = await call(h, { op: 'moment/add', videoId: A, atSeconds: 5, note: '', title: null })
    expect(code(r)).toBe('not-persisted')
    expect(map.has(STORAGE_KEYS.moments)).toBe(false)
  })

  it('마감이 지난 쓰기는 시작하지 않는다 · 너무 먼 마감은 믿지 않는다', async () => {
    const h = bridge()
    const late = await h.handle({
      id: rid(),
      deadline: Date.now() - 1,
      payload: { op: 'moment/add', videoId: A, atSeconds: 1, note: '', title: null },
    })
    expect(code(late)).toBe('expired')
    const far = await h.handle({
      id: rid(),
      deadline: Date.now() + 120_000,
      payload: { op: 'moment/add', videoId: A, atSeconds: 1, note: '', title: null },
    })
    expect(code(far)).toBe('bad-request')
    expect(storedMoments()).toHaveLength(0)
  })

  it('다른 탭이 그 사이 쓴 것을 반영한다 — 충돌 없이 이어서 담는다', async () => {
    const h = bridge()
    await call(h, { op: 'library/list', videoId: null })
    // 대시보드 탭이 목록을 하나 만들었다.
    const other = JSON.parse(globalThis.localStorage.getItem(STORAGE_KEYS.library) ?? '{}')
    other.data.playlists.push({ id: 'tab2', name: '다른 탭', tracks: [] })
    globalThis.localStorage.setItem(STORAGE_KEYS.library, JSON.stringify(other))
    const r = await call(h, {
      op: 'track/add',
      playlistId: 'tab2',
      videoId: B,
      title: null,
      allowDuplicate: false,
    })
    expect(data(r)).toMatchObject({ playlistName: '다른 탭', position: 1 })
    expect(stored().playlists.map((p) => p.id)).toEqual(['mine', 'drive', 'tab2'])
  })
})

/* ================================================================== *
 * E. 자리 — 허용한 확장의 offscreen 안에서만
 * ================================================================== */

describe('E. 브리지 페이지 — 자리 · 보낸 쪽 확인', () => {
  function fakeWindow(ancestors: string[], top = false) {
    const posted: { message: unknown; origin: string }[] = []
    let listener: ((event: MessageEvent) => void) | null = null
    const parent = {
      postMessage: (message: unknown, origin: string) => void posted.push({ message, origin }),
    }
    const self = {}
    const win: BridgeWindow = {
      location: { ancestorOrigins: Object.assign([...ancestors], { length: ancestors.length }) },
      parent,
      top: top ? self : {},
      self,
      addEventListener: (_type, l) => {
        listener = l
      },
    }
    const dispatch = (data: unknown, origin: string, source: unknown = parent) =>
      listener?.({ data, origin, source } as unknown as MessageEvent)
    return { win, posted, dispatch, hasListener: () => listener !== null }
  }

  it('허용 목록이 비었거나 · 최상위거나 · 웹사이트 액자면 리스너도 준비 신호도 없다', () => {
    for (const [ancestors, top, allowed] of [
      [[EXT], false, []],
      [[], true, [EXT]],
      [['https://www.youtube.com', EXT], false, [EXT]],
      [['https://evil.example'], false, [EXT]],
    ] as const) {
      const w = fakeWindow([...ancestors], top)
      const create = vi.fn<() => BridgeHandler>(() => bridge())
      expect(startBridge(w.win, allowed, create)).toBe('refused')
      expect(w.hasListener()).toBe(false)
      expect(create).not.toHaveBeenCalled()
      // 액자 안이면 내용 없는 "refused" 신호만 — 상태 · 데이터는 싣지 않는다.
      for (const { message } of w.posted)
        expect(message).toEqual({ ns: BRIDGE_NAMESPACE, v: 1, kind: 'refused' })
    }
  })

  it('허용한 확장의 offscreen 안 — 준비를 알리고, 그 부모 · origin 의 요청만 답한다', async () => {
    const w = fakeWindow([EXT])
    expect(startBridge(w.win, [EXT], () => bridge())).toBe('started')
    expect(w.posted[0]).toMatchObject({ origin: EXT, message: { kind: 'ready' } })

    const request = {
      ns: BRIDGE_NAMESPACE,
      v: 1,
      kind: 'request',
      id: rid(),
      deadline: Date.now() + 5000,
      payload: { op: 'hello' },
    }
    w.dispatch(request, 'https://www.youtube.com') // 다른 origin
    w.dispatch(request, EXT, {}) // 부모가 아닌 창
    await new Promise((r) => setTimeout(r, 0))
    expect(w.posted).toHaveLength(1)

    w.dispatch(request, EXT)
    await vi.waitFor(() => expect(w.posted).toHaveLength(2))
    expect(w.posted[1]).toMatchObject({ origin: EXT, message: { kind: 'response', ok: true } })
  })
})

/* ================================================================== *
 * F. store 선택 옵션 — 기존 호출은 그대로
 * ================================================================== */

describe('F. store — select · 부르는 쪽 id', () => {
  it('createPlaylist 기본은 고르고, select:false 는 선택을 그대로 둔다', async () => {
    setActivePinia(createPinia())
    const library = useLibraryStore()
    library.restore()
    await library.createPlaylist('기본')
    expect(library.selectedPlaylist?.name).toBe('기본')
    await library.createPlaylist('조용히', { select: false })
    expect(library.selectedPlaylist?.name).toBe('기본')
  })

  it('같은 id 로 두 번 — 두 번째는 쓰지 않고 existed, 내용이 다르면 duplicate-id, 형식이 틀리면 거절', async () => {
    setActivePinia(createPinia())
    const library = useLibraryStore()
    library.restore()
    const id = 'ext-0123456789abcdef-list'
    const first = await library.createPlaylist('목록', { id, select: false })
    expect(first).toMatchObject({ ok: true, playlistId: id, persisted: true })
    expect(first.ok && first.existed).toBeFalsy()
    const raw = globalThis.localStorage.getItem(STORAGE_KEYS.library)
    expect(await library.createPlaylist('목록', { id })).toMatchObject({ ok: true, existed: true })
    expect(globalThis.localStorage.getItem(STORAGE_KEYS.library)).toBe(raw)
    expect(await library.createPlaylist('다른 이름', { id })).toEqual({
      ok: false,
      reason: 'duplicate-id',
    })
    expect(await library.createPlaylist('x', { id: 'plain-id' })).toEqual({
      ok: false,
      reason: 'duplicate-id',
    })

    const trackId = 'ext-0123456789abcdef'
    expect(await library.addTrack(id, { videoId: A, id: trackId })).toMatchObject({
      ok: true,
      trackId,
    })
    expect(await library.addTrack(id, { videoId: A, id: trackId })).toMatchObject({ existed: true })
    expect(await library.addTrack(id, { videoId: B, id: trackId })).toEqual({
      ok: false,
      reason: 'duplicate-id',
    })
    expect(await library.addTrack('mine', { videoId: A, id: trackId })).toEqual({
      ok: false,
      reason: 'duplicate-id',
    })
    expect(library.getPlaylist(id)?.tracks).toHaveLength(1)

    const moments = useMomentsStore()
    moments.restore()
    const mid = 'ext-0123456789abcdef'
    expect(await moments.add({ videoId: A, atSeconds: 3, id: mid })).toMatchObject({
      ok: true,
      momentId: mid,
    })
    expect(await moments.add({ videoId: A, atSeconds: 3, id: mid })).toMatchObject({
      existed: true,
    })
    expect(await moments.add({ videoId: A, atSeconds: 4, id: mid })).toEqual({
      ok: false,
      reason: 'duplicate-id',
    })
    expect(moments.count).toBe(1)
  })
})
