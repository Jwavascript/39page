// @vitest-environment node
/**
 * M12-3 — 앨범아트 저장소 (IndexedDB, ADR 0033 · ARTWORK_DESIGN §3).
 *
 * `fake-indexeddb` 로 실제 트랜잭션 의미를 본다 — 한 트랜잭션 · 충돌 · 취소 · 참조 수 · 정리. Node 환경이다:
 * jsdom 의 Blob 은 구조적 복제를 지나면 Blob 이 아니게 된다 (브라우저에서는 그대로다).
 */
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  ARTWORK_DB_NAME,
  createArtworkRepository,
  openArtworkDb,
  type ArtworkRepository,
  type NewAsset,
} from '@/features/artwork/artworkRepository'
import type { ArtworkAssignment } from '@/shared/types/artwork'

const A = { playlistId: 'p1', trackId: 't1' }
const B = { playlistId: 'p1', trackId: 't2' }
const SAME_TRACK_OTHER_LIST = { playlistId: 'p2', trackId: 't1' }
const NOW = new Date('2026-11-15T03:00:00.000Z')

function asset(seed: string, size = 8): NewAsset {
  const id = seed.repeat(64).slice(0, 64)
  return {
    asset: {
      id,
      mimeType: 'image/png',
      byteSize: size,
      width: 10,
      height: 10,
      animated: false,
      createdAt: NOW.toISOString(),
    },
    blob: new Blob([new Uint8Array(size).fill(seed.charCodeAt(0))], { type: 'image/png' }),
    poster: null,
  }
}

let factory: IDBFactory
let repo: ArtworkRepository

beforeEach(async () => {
  factory = new IDBFactory()
  repo = createArtworkRepository(await openArtworkDb(factory))
})

afterEach(() => {
  repo.close()
  vi.restoreAllMocks()
})

const custom = (item: NewAsset) =>
  ({ mode: 'custom', assetId: item.asset.id, newAsset: item }) as const

describe('A. 한 트랙의 선호 바꾸기', () => {
  it('custom — 자산 · 바이트 · 연결이 함께 저장되고 수정 번호가 1 이 된다', async () => {
    const a = asset('a')
    const result = await repo.setPreference(A, 'vvvvvvvvvvv', custom(a), 0, NOW)
    expect(result.ok).toBe(true)

    const snap = await repo.snapshot()
    expect(snap.assignments).toEqual([
      {
        playlistId: 'p1',
        trackId: 't1',
        videoId: 'vvvvvvvvvvv',
        mode: 'custom',
        assetId: a.asset.id,
        revision: 1,
        updatedAt: NOW.toISOString(),
      },
    ])
    expect(snap.assets.map((item) => item.id)).toEqual([a.asset.id])
    const stored = await repo.getBlob(a.asset.id)
    expect(stored?.blob.size).toBe(8)
  })

  it('default · auto — auto 는 레코드를 지운다 (레코드 없음 = auto)', async () => {
    await repo.setPreference(A, 'vvvvvvvvvvv', { mode: 'default' }, 0, NOW)
    expect((await repo.snapshot()).assignments[0]?.mode).toBe('default')
    await repo.setPreference(A, 'vvvvvvvvvvv', { mode: 'auto' }, 1, NOW)
    expect((await repo.snapshot()).assignments).toEqual([])
  })

  it('그림을 바꾸면 아무도 쓰지 않게 된 옛 자산을 같은 트랜잭션에서 지운다', async () => {
    const a = asset('a')
    const b = asset('b')
    await repo.setPreference(A, 'v', custom(a), 0, NOW)
    await repo.setPreference(A, 'v', custom(b), 1, NOW)

    const snap = await repo.snapshot()
    expect(snap.assets.map((item) => item.id)).toEqual([b.asset.id])
    expect(await repo.getBlob(a.asset.id)).toBeNull()
    expect(snap.assignments[0]?.revision).toBe(2)
  })

  it('같은 이미지를 여러 트랙이 쓰면 한 번만 저장하고, 마지막 사용자가 떠날 때 지운다', async () => {
    const a = asset('a')
    await repo.setPreference(A, 'v', custom(a), 0, NOW)
    await repo.setPreference(B, 'v', custom(a), 0, NOW)
    expect((await repo.snapshot()).assets).toHaveLength(1)

    await repo.setPreference(A, 'v', { mode: 'auto' }, 1, NOW)
    expect((await repo.snapshot()).assets).toHaveLength(1) // B 가 아직 쓴다

    await repo.setPreference(B, 'v', { mode: 'default' }, 1, NOW)
    expect((await repo.snapshot()).assets).toHaveLength(0)
  })

  it('같은 트랙 id 라도 목록이 다르면 다른 연결이다 — 같은 영상에 다른 그림', async () => {
    await repo.setPreference(A, 'v', custom(asset('a')), 0, NOW)
    await repo.setPreference(SAME_TRACK_OTHER_LIST, 'v', custom(asset('b')), 0, NOW)
    const snap = await repo.snapshot()
    expect(
      snap.assignments.map((item) => [item.playlistId, item.trackId, item.assetId?.[0]]),
    ).toEqual([
      ['p1', 't1', 'a'],
      ['p2', 't1', 'b'],
    ])
  })
})

describe('B. 실패해도 이전 그림이 남는다', () => {
  it('수정 번호가 다르면(다른 탭이 먼저 바꿈) conflict — 아무것도 쓰지 않는다', async () => {
    const a = asset('a')
    await repo.setPreference(A, 'v', custom(a), 0, NOW)
    // 이 탭은 0 을 보고 있었다.
    const result = await repo.setPreference(A, 'v', custom(asset('b')), 0, NOW)
    expect(result).toEqual({ ok: false, reason: 'conflict' })

    const snap = await repo.snapshot()
    expect(snap.assignments[0]?.assetId).toBe(a.asset.id)
    expect(snap.assets.map((item) => item.id)).toEqual([a.asset.id]) // b 는 들어가지 않았다
  })

  it('용량 부족(QuotaExceededError) — 트랜잭션이 통째로 취소되어 이전 그림 그대로', async () => {
    const a = asset('a')
    await repo.setPreference(A, 'v', custom(a), 0, NOW)

    const put = IDBObjectStore.prototype.put
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (
      this: IDBObjectStore,
      ...args: Parameters<IDBObjectStore['put']>
    ) {
      if (this.name === 'blobs') throw new DOMException('full', 'QuotaExceededError')
      return put.apply(this, args)
    })

    const result = await repo.setPreference(A, 'v', custom(asset('b')), 1, NOW)
    expect(result).toEqual({ ok: false, reason: 'quota' })

    vi.restoreAllMocks()
    const snap = await repo.snapshot()
    expect(snap.assignments).toHaveLength(1)
    expect(snap.assignments[0]?.assetId).toBe(a.asset.id)
    expect(snap.assignments[0]?.revision).toBe(1)
    expect(snap.assets.map((item) => item.id)).toEqual([a.asset.id])
    expect(await repo.getBlob(a.asset.id)).not.toBeNull()
  })

  it('없는 자산을 가리키는 연결은 만들지 않는다', async () => {
    const result = await repo.setPreference(
      A,
      'v',
      { mode: 'custom', assetId: 'f'.repeat(64) },
      0,
      NOW,
    )
    expect(result.ok).toBe(false)
    expect((await repo.snapshot()).assignments).toEqual([])
  })
})

describe('C. 삭제 · 정리', () => {
  it('forget — 트랙들의 연결과 아무도 안 쓰는 자산을 지운다', async () => {
    const a = asset('a')
    const b = asset('b')
    await repo.setPreference(A, 'v', custom(a), 0, NOW)
    await repo.setPreference(B, 'v', custom(b), 0, NOW)
    const result = await repo.forget([A, { playlistId: 'nope', trackId: 'x' }])
    expect(result).toEqual({ ok: true, removed: 1 })
    const snap = await repo.snapshot()
    expect(snap.assignments.map((item) => item.trackId)).toEqual(['t2'])
    expect(snap.assets.map((item) => item.id)).toEqual([b.asset.id])
  })

  it('cleanUp — 남길 연결만 남기고, 연결 없는 자산을 지운다', async () => {
    await repo.setPreference(A, 'v', custom(asset('a')), 0, NOW)
    await repo.setPreference(B, 'v', custom(asset('b')), 0, NOW)
    await repo.stageAssets([asset('c')]) // 아무도 안 쓰는 자산
    const result = await repo.cleanUp((assignment) => assignment.trackId === 't2')
    expect(result).toEqual({ ok: true, removedAssignments: 1, removedAssets: 2 })
    expect((await repo.snapshot()).assets.map((item) => item.id[0])).toEqual(['b'])
  })
})

describe('D. 백업 · 복원을 위한 단계', () => {
  it('stageAssets — 추가만, 같은 id 는 다시 쓰지 않는다', async () => {
    expect(await repo.stageAssets([asset('a'), asset('b')])).toEqual({
      ok: true,
      added: [asset('a').asset.id, asset('b').asset.id],
    })
    expect(await repo.stageAssets([asset('a')])).toEqual({ ok: true, added: [] })
  })

  it('replaceAssignments — 하나라도 자산이 없으면 아무것도 바꾸지 않는다 (원자적)', async () => {
    await repo.setPreference(A, 'v', custom(asset('a')), 0, NOW)
    const before = (await repo.snapshot()).assignments
    const next: ArtworkAssignment[] = [
      { ...before[0]!, trackId: 'n1' },
      {
        playlistId: 'p',
        trackId: 'n2',
        videoId: 'v',
        mode: 'custom',
        assetId: 'e'.repeat(64),
        revision: 1,
        updatedAt: NOW.toISOString(),
      },
    ]
    const result = await repo.replaceAssignments(next)
    expect(result.ok).toBe(false)
    expect((await repo.snapshot()).assignments).toEqual(before)
  })

  it('replaceAssignments — 성공하면 통째로 바뀐다', async () => {
    await repo.setPreference(A, 'v', custom(asset('a')), 0, NOW)
    const next: ArtworkAssignment[] = [
      {
        playlistId: 'q',
        trackId: 'z',
        videoId: 'v',
        mode: 'default',
        revision: 1,
        updatedAt: NOW.toISOString(),
      },
    ]
    expect((await repo.replaceAssignments(next)).ok).toBe(true)
    expect((await repo.snapshot()).assignments).toEqual(next)
  })

  it('exportAll — 연결 · 자산 · 바이트를 한 시점에서 읽는다', async () => {
    await repo.setPreference(A, 'v', custom(asset('a', 5)), 0, NOW)
    const all = await repo.exportAll()
    expect(all.assignments).toHaveLength(1)
    expect(all.assets).toHaveLength(1)
    expect(new Uint8Array(await all.blobs[0]!.blob.arrayBuffer())).toEqual(
      new Uint8Array(5).fill(97),
    )
  })

  it('removeUnused — 연결이 쓰는 자산은 지우지 않는다 (스테이징 되돌리기)', async () => {
    await repo.setPreference(A, 'v', custom(asset('a')), 0, NOW)
    await repo.stageAssets([asset('b')])
    expect(await repo.removeUnused([asset('a').asset.id, asset('b').asset.id])).toBe(1)
    expect((await repo.snapshot()).assets.map((item) => item.id[0])).toEqual(['a'])
  })
})

describe('E. 열기', () => {
  it('IndexedDB 가 없으면 던진다 — 부르는 쪽이 unavailable 로 다룬다', async () => {
    await expect(openArtworkDb(undefined as unknown as IDBFactory)).rejects.toThrow('IndexedDB')
  })

  it('두 연결(두 탭)이 같은 데이터베이스를 본다', async () => {
    const other = createArtworkRepository(await openArtworkDb(factory))
    await repo.setPreference(A, 'v', { mode: 'default' }, 0, NOW)
    expect((await other.snapshot()).assignments).toHaveLength(1)
    // 다른 탭이 낡은 수정 번호로 쓰면 충돌.
    expect(await other.setPreference(A, 'v', { mode: 'auto' }, 0, NOW)).toEqual({
      ok: false,
      reason: 'conflict',
    })
    other.close()
    expect(ARTWORK_DB_NAME).toBe('39page-artwork')
  })
})
