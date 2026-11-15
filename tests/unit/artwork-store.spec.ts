/**
 * M12-3 — 앨범아트 store (`stores/artwork`, ADR 0033 · ARTWORK_DESIGN §3).
 *
 * 저장이 확정된 뒤에만 반영 · 트랙이 없으면 거절 · 라이브러리 삭제 뒤 연결 정리 · 고아 정리(유예 · 보호 상태) ·
 * 탭 간 알림과 충돌 · 저장소를 열 수 없을 때.
 */
import { IDBFactory } from 'fake-indexeddb'
import { createPinia, setActivePinia, type Pinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createArtworkRepository, openArtworkDb } from '@/features/artwork/artworkRepository'
import { validateArtwork, type ValidatedArtwork } from '@/features/artwork/imageValidation'
import { ORPHAN_GRACE_MS, useArtworkStore } from '@/stores/artwork'
import { useLibraryStore } from '@/stores/library'

import { fakeImageTools, fileOf, gifBytes, pngBytes } from '../support/artworkFixtures'

const VIDEO = 'aaaaaaaaaaa'

async function validated(seed = 1): Promise<ValidatedArtwork> {
  const result = await validateArtwork(
    fileOf(pngBytes(seed), `${String(seed)}.png`),
    fakeImageTools(),
  )
  if (!result.ok) throw new Error(result.reason)
  return result.artwork
}

/** 두 탭 사이의 알림 — 한쪽이 보내면 다른 쪽이 받는다. */
function channelPair() {
  const a = {
    onmessage: null as ((event: MessageEvent) => void) | null,
    postMessage: (m: unknown) => b.onmessage?.({ data: m } as MessageEvent),
  }
  const b = {
    onmessage: null as ((event: MessageEvent) => void) | null,
    postMessage: (m: unknown) => a.onmessage?.({ data: m } as MessageEvent),
  }
  return [a, b] as const
}

let factory: IDBFactory

beforeEach(() => {
  globalThis.localStorage.clear()
  factory = new IDBFactory()
  setActivePinia(createPinia())
})

afterEach(() => {
  globalThis.localStorage.clear()
  vi.useRealTimers()
})

async function libraryWithTrack() {
  const library = useLibraryStore()
  library.restore()
  const created = await library.createPlaylist('ART')
  if (!created.ok) throw new Error('playlist')
  const added = await library.addTrack(created.playlistId, { videoId: VIDEO, title: 'One' })
  if (!added.ok || added.trackId === undefined) throw new Error('track')
  return { library, key: { playlistId: created.playlistId, trackId: added.trackId } }
}

describe('A. 열기 · 읽기', () => {
  it('열면 ready, 연결이 없으면 모든 트랙이 auto', async () => {
    const store = useArtworkStore()
    await store.init({ factory, channel: null })
    expect(store.status).toBe('ready')
    expect(store.preferenceFor({ playlistId: 'p', trackId: 't' })).toEqual({ mode: 'auto' })
    expect(store.revisionFor({ playlistId: 'p', trackId: 't' })).toBe(0)
  })

  it('IndexedDB 를 열 수 없으면 unavailable — 쓰기는 거절하고 아무것도 바꾸지 않는다', async () => {
    const broken = {
      open: () => {
        throw new DOMException('blocked', 'SecurityError')
      },
    } as unknown as IDBFactory
    const store = useArtworkStore()
    await store.init({ factory: broken, channel: null })
    expect(store.status).toBe('unavailable')
    const { key } = await libraryWithTrack()
    expect(await store.useDefault(key, VIDEO, 0)).toEqual({ ok: false, reason: 'unavailable' })
  })
})

describe('B. 쓰기', () => {
  it('custom 을 저장하면 그 뒤에야 메모리에 반영된다 — 사용량 · 수정 번호', async () => {
    const { key } = await libraryWithTrack()
    const store = useArtworkStore()
    await store.init({ factory, channel: null })
    const art = await validated()

    const pending = store.setCustom(key, VIDEO, art, 0)
    expect(store.preferenceFor(key)).toEqual({ mode: 'auto' }) // 확정 전
    expect(await pending).toEqual({ ok: true })
    expect(store.preferenceFor(key)).toEqual({ mode: 'custom', assetId: art.id })
    expect(store.revisionFor(key)).toBe(1)
    expect(store.usage).toEqual({ assets: 1, bytes: art.byteSize })
    expect(store.customCount).toBe(1)
  })

  it('라이브러리에 없는 트랙에는 저장하지 않는다 (삭제와 변경 경합)', async () => {
    const { library, key } = await libraryWithTrack()
    const store = useArtworkStore()
    await store.init({ factory, channel: null })
    await library.removeTrack(key.playlistId, key.trackId)

    expect(await store.setCustom(key, VIDEO, await validated(), 0)).toEqual({
      ok: false,
      reason: 'track-missing',
    })
    expect(store.usage.assets).toBe(0)
  })

  it('auto 로 되돌리면 연결과 쓰지 않게 된 자산이 사라진다', async () => {
    const { key } = await libraryWithTrack()
    const store = useArtworkStore()
    await store.init({ factory, channel: null })
    await store.setCustom(key, VIDEO, await validated(), 0)
    expect(await store.useAuto(key, VIDEO, 1)).toEqual({ ok: true })
    expect(store.preferenceFor(key)).toEqual({ mode: 'auto' })
    expect(store.usage.assets).toBe(0)
  })
})

describe('C. 라이브러리 삭제 뒤 정리', () => {
  it('곡 삭제가 저장되면 그 곡의 연결 · 자산을 지운다', async () => {
    const { library, key } = await libraryWithTrack()
    const store = useArtworkStore()
    await store.init({ factory, channel: null })
    await store.setCustom(key, VIDEO, await validated(), 0)

    await library.removeTrack(key.playlistId, key.trackId)
    await vi.waitFor(() => expect(store.assignmentFor(key)).toBeNull())
    expect(store.usage.assets).toBe(0)
  })

  it('목록 삭제가 저장되면 그 목록의 모든 곡 연결을 지운다', async () => {
    const { library, key } = await libraryWithTrack()
    const second = await library.addTrack(key.playlistId, { videoId: VIDEO, title: 'Two' })
    const store = useArtworkStore()
    await store.init({ factory, channel: null })
    await store.setCustom(key, VIDEO, await validated(1), 0)
    const key2 = { playlistId: key.playlistId, trackId: second.ok ? (second.trackId ?? '') : '' }
    await store.useDefault(key2, VIDEO, 0)

    await library.deletePlaylist(key.playlistId)
    await vi.waitFor(() => expect(store.assignments.size).toBe(0))
    expect(store.usage.assets).toBe(0)
  })

  it('순서를 바꿔도 연결이 그대로다 (id 기반)', async () => {
    const { library, key } = await libraryWithTrack()
    await library.addTrack(key.playlistId, { videoId: VIDEO, title: 'Two' })
    const store = useArtworkStore()
    await store.init({ factory, channel: null })
    await store.useDefault(key, VIDEO, 0)
    await library.moveTrackTo(key.playlistId, key.trackId, 1)
    expect(store.preferenceFor(key)).toEqual({ mode: 'default' })
  })

  it('cleanUp — 라이브러리에 없는 오래된 연결만 지우고, 최근 연결은 유예한다', async () => {
    const { key } = await libraryWithTrack()
    const store = useArtworkStore()
    await store.init({ factory, channel: null })
    // 다른 저장소 연결로 "라이브러리에 없는" 연결 둘 — 오래된 것 · 방금 것.
    const repo = createArtworkRepository(await openArtworkDb(factory))
    const old = new Date(Date.now() - ORPHAN_GRACE_MS - 60_000)
    await repo.setPreference(
      { playlistId: 'gone', trackId: 'old' },
      VIDEO,
      { mode: 'default' },
      0,
      old,
    )
    await repo.setPreference(
      { playlistId: 'gone', trackId: 'new' },
      VIDEO,
      { mode: 'default' },
      0,
      new Date(),
    )
    await store.useDefault(key, VIDEO, 0)
    repo.close()

    const result = await store.cleanUp()
    expect(result).toEqual({ ok: true, removedAssignments: 1, removedAssets: 0 })
    expect(store.assignmentFor({ playlistId: 'gone', trackId: 'old' })).toBeNull()
    expect(store.assignmentFor({ playlistId: 'gone', trackId: 'new' })).not.toBeNull()
    expect(store.assignmentFor(key)).not.toBeNull()
  })

  it('cleanUp — 라이브러리를 온전히 읽을 수 없으면(보호) 아무것도 지우지 않는다', async () => {
    globalThis.localStorage.setItem('39page.library', '{broken')
    const library = useLibraryStore()
    library.restore()
    expect(library.status).toBe('protected')
    const store = useArtworkStore()
    await store.init({ factory, channel: null })
    expect(await store.cleanUp()).toEqual({ ok: false, reason: 'library-unreadable' })
  })
})

describe('D. 두 탭', () => {
  async function twoTabs() {
    const [channelA, channelB] = channelPair()
    const piniaA: Pinia = createPinia()
    const piniaB: Pinia = createPinia()
    setActivePinia(piniaA)
    const { key } = await libraryWithTrack()
    const a = useArtworkStore(piniaA)
    await a.init({ factory, channel: channelA })
    setActivePinia(piniaB)
    useLibraryStore(piniaB).restore()
    const b = useArtworkStore(piniaB)
    await b.init({ factory, channel: channelB })
    return { a, b, key }
  }

  it('한 탭이 저장하면 다른 탭이 알림을 받고 다시 읽는다', async () => {
    const { a, b, key } = await twoTabs()
    await a.setCustom(key, VIDEO, await validated(), 0)
    await vi.waitFor(() => expect(b.preferenceFor(key).mode).toBe('custom'))
  })

  it('낡은 수정 번호로 저장하면 conflict — 이전 그림이 남고, 지금 것을 다시 읽는다', async () => {
    const { a, b, key } = await twoTabs()
    const seenByB = b.revisionFor(key) // 0
    await a.setCustom(key, VIDEO, await validated(1), seenByB)
    const result = await b.setCustom(key, VIDEO, await validated(2), seenByB)
    expect(result).toEqual({ ok: false, reason: 'conflict' })
    const kept = a.preferenceFor(key)
    expect(b.preferenceFor(key)).toEqual(kept)
    expect(b.usage.assets).toBe(1)
  })
})

describe('E. 연결은 있는데 자산이 없음', () => {
  it('missing 으로 드러낸다 — 숨기지 않는다', async () => {
    const { key } = await libraryWithTrack()
    const store = useArtworkStore()
    await store.init({ factory, channel: null })
    const art = await validated()
    await store.setCustom(key, VIDEO, art, 0)

    // 저장소 밖에서 자산만 사라진 상황 (브라우저가 일부를 지움 · 손상).
    const db = await openArtworkDb(factory)
    const tx = db.transaction(['assets', 'blobs'], 'readwrite')
    tx.objectStore('assets').delete(art.id)
    tx.objectStore('blobs').delete(art.id)
    await new Promise((resolve) => (tx.oncomplete = resolve))
    db.close()
    await store.reload()

    expect(store.missing.map((item) => item.trackId)).toEqual([key.trackId])
  })

  it('움직이는 GIF 는 포스터와 함께 저장된다', async () => {
    const { key } = await libraryWithTrack()
    const store = useArtworkStore()
    await store.init({ factory, channel: null })
    const result = await validateArtwork(fileOf(gifBytes(2), 'a.gif'), fakeImageTools())
    if (!result.ok) throw new Error(result.reason)
    await store.setCustom(key, VIDEO, result.artwork, 0)
    expect(store.assetFor(result.artwork.id)?.animated).toBe(true)
    const record = await store.loadBlob(result.artwork.id)
    expect(record?.poster).not.toBeNull()
  })
})
