/**
 * 앨범아트 저장소 — IndexedDB `39page-artwork` (M12-3, ADR 0033 · ARTWORK_DESIGN §3).
 *
 * | store         | keyPath                    | 색인                  |
 * | ------------- | -------------------------- | --------------------- |
 * | `assets`      | `id`                       | —                     |
 * | `blobs`       | `id`                       | —                     |
 * | `assignments` | `['playlistId','trackId']` | `assetId` (custom 만) |
 *
 * **모든 변경은 한 readwrite 트랜잭션** 이다 — 자산 · 바이트 · 연결 · 옛 자산 정리가 함께 되거나 함께 취소된다.
 * 실패(용량 · 충돌 · 오류)하면 이전 그림이 그대로 남는다. 같은 store 를 쓰는 트랜잭션은 탭을 넘어 직렬화된다.
 *
 * 이 모듈은 Vue · Pinia 를 모른다 — 화면이 읽는 경계는 `stores/artwork.ts` 다. 라이브러리도 모른다 — 트랙이
 * 있는지는 부르는 쪽이 본다.
 */
import type { ArtworkAsset, ArtworkAssignment, TrackKey } from '@/shared/types/artwork'

export const ARTWORK_DB_NAME = '39page-artwork'
export const ARTWORK_DB_VERSION = 1

const ASSETS = 'assets'
const BLOBS = 'blobs'
const ASSIGNMENTS = 'assignments'
const BY_ASSET = 'byAsset'

export interface ArtworkBlobRecord {
  readonly id: string
  readonly blob: Blob
  readonly poster: Blob | null
}

/** 쓰기 실패 이유. */
export type ArtworkWriteFailure =
  /** 다른 탭이 이 트랙의 그림을 먼저 바꿨다 — 아무것도 쓰지 않았다. */
  | 'conflict'
  /** 저장 공간이 모자라 트랜잭션이 취소됐다 — 아무것도 쓰지 않았다. */
  | 'quota'
  /** 저장소를 열 수 없다 (IndexedDB 없음 · 비공개 창 · 새 버전). */
  | 'unavailable'
  /** 그 밖의 오류로 트랜잭션이 취소됐다. */
  | 'failed'

export type ArtworkWriteResult =
  | { readonly ok: true; readonly assignment: ArtworkAssignment | null }
  | { readonly ok: false; readonly reason: ArtworkWriteFailure }

/** 새 자산 (메타 + 바이트). 같은 id 가 있으면 다시 쓰지 않는다. */
export interface NewAsset {
  readonly asset: ArtworkAsset
  readonly blob: Blob
  readonly poster: Blob | null
}

/** 한 트랙의 새 선호. `auto` 는 레코드 삭제다. */
export type PreferenceWrite =
  | { readonly mode: 'auto' }
  | { readonly mode: 'default' }
  | { readonly mode: 'custom'; readonly assetId: string; readonly newAsset?: NewAsset }

export interface ArtworkSnapshot {
  readonly assignments: ArtworkAssignment[]
  readonly assets: ArtworkAsset[]
}

export interface ArtworkExport extends ArtworkSnapshot {
  readonly blobs: ArtworkBlobRecord[]
}

/* ------------------------------------------------------------------ *
 * IDB 약속 도우미
 * ------------------------------------------------------------------ */

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('IDB request failed'))
  })
}

/** 트랜잭션이 **확정**될 때 끝난다 — `complete` 전에는 성공이라 하지 않는다. */
function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onabort = () => reject(tx.error ?? new DOMException('aborted', 'AbortError'))
    tx.onerror = () => {
      /* abort 로 이어진다 */
    }
  })
}

/** 실패한 트랜잭션은 일부만 확정되지 않게 취소한다. 이미 끝났으면 아무 일도 없다. */
function abort(tx: IDBTransaction): void {
  try {
    tx.abort()
  } catch {
    /* 이미 끝남 */
  }
}

function failureOf(error: unknown): ArtworkWriteFailure {
  if (error instanceof ConflictError) return 'conflict'
  const name = (error as { name?: string } | null)?.name
  if (name === 'QuotaExceededError') return 'quota'
  if (name === 'InvalidStateError' || name === 'VersionError') return 'unavailable'
  return 'failed'
}

class ConflictError extends Error {}

const keyOf = (key: TrackKey): [string, string] => [key.playlistId, key.trackId]

/* ------------------------------------------------------------------ *
 * 열기
 * ------------------------------------------------------------------ */

/**
 * 데이터베이스를 연다. 없거나(IndexedDB 없음) 막혔거나(비공개 창 · 다른 탭의 새 버전) 실패하면 던진다 —
 * 부르는 쪽이 `unavailable` 로 다룬다. 덮어쓰지 않는다.
 */
export function openArtworkDb(
  factory: IDBFactory | undefined = globalThis.indexedDB,
): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (factory === undefined) {
      reject(new Error('IndexedDB 를 쓸 수 없습니다.'))
      return
    }
    let req: IDBOpenDBRequest
    try {
      req = factory.open(ARTWORK_DB_NAME, ARTWORK_DB_VERSION)
    } catch (error) {
      reject(error instanceof Error ? error : new Error(String(error)))
      return
    }
    req.onupgradeneeded = () => {
      const db = req.result
      // 버전 1 — 처음 만든다. 다음 버전은 이전 버전을 이어 받는 단계를 여기에 더한다.
      if (!db.objectStoreNames.contains(ASSETS)) db.createObjectStore(ASSETS, { keyPath: 'id' })
      if (!db.objectStoreNames.contains(BLOBS)) db.createObjectStore(BLOBS, { keyPath: 'id' })
      if (!db.objectStoreNames.contains(ASSIGNMENTS)) {
        const store = db.createObjectStore(ASSIGNMENTS, { keyPath: ['playlistId', 'trackId'] })
        store.createIndex(BY_ASSET, 'assetId', { unique: false })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'))
    req.onblocked = () => reject(new Error('IndexedDB open blocked'))
  })
}

/* ------------------------------------------------------------------ *
 * 저장소
 * ------------------------------------------------------------------ */

export interface ArtworkRepository {
  /** 연결 · 자산 메타를 한 시점의 사진으로 읽는다. 바이트는 읽지 않는다. */
  snapshot(): Promise<ArtworkSnapshot>
  /** 한 자산의 바이트. 없으면 `null` (연결은 있는데 자산이 사라짐). */
  getBlob(assetId: string): Promise<ArtworkBlobRecord | null>
  /**
   * 한 트랙의 선호를 바꾼다. 트랜잭션 안에서 지금 수정 번호가 `expectedRevision`(없으면 0)과 다르면
   * `conflict` 로 거절한다. 옛 custom 자산을 아무도 쓰지 않게 되면 함께 지운다.
   */
  setPreference(
    key: TrackKey,
    videoId: string,
    next: PreferenceWrite,
    expectedRevision: number,
    now: Date,
  ): Promise<ArtworkWriteResult>
  /** 트랙들의 연결을 지우고 쓰지 않게 된 자산을 지운다 (트랙 · 목록 삭제가 저장된 뒤). */
  forget(keys: readonly TrackKey[]): Promise<{ ok: boolean; removed: number }>
  /**
   * 정리: `keep(assignment)` 가 거짓인 연결을 지우고, 어느 연결도 쓰지 않는 자산을 지운다.
   * `missing` — 자산이 없는 custom 연결 (지우지 않고 알린다).
   */
  cleanUp(
    keep: (assignment: ArtworkAssignment) => boolean,
  ): Promise<{ ok: boolean; removedAssignments: number; removedAssets: number }>
  /** 백업 · 공유용 — 한 readonly 트랜잭션에서 연결 · 자산 · 바이트를 읽는다. */
  exportAll(): Promise<ArtworkExport>
  /** 자산 추가만 (스테이징). 이미 있는 id 는 건너뛴다. 넣은 id 를 돌려준다. */
  stageAssets(
    assets: readonly NewAsset[],
  ): Promise<{ ok: true; added: string[] } | { ok: false; reason: ArtworkWriteFailure }>
  /** 연결을 통째로 바꾼다 — 한 트랜잭션 (ZIP 복원 확정). */
  replaceAssignments(next: readonly ArtworkAssignment[]): Promise<ArtworkWriteResult>
  /** 연결을 더한다 (공유 가져오기) — 같은 키는 덮어쓴다. 한 트랜잭션. */
  putAssignments(next: readonly ArtworkAssignment[]): Promise<ArtworkWriteResult>
  /** 주어진 자산 중 어느 연결도 쓰지 않는 것만 지운다 (스테이징 되돌리기). */
  removeUnused(ids: readonly string[]): Promise<number>
  close(): void
}

export function createArtworkRepository(db: IDBDatabase): ArtworkRepository {
  /** 한 트랜잭션 안에서: 아무 연결도 쓰지 않으면 자산 · 바이트를 지운다. */
  async function dropIfUnused(tx: IDBTransaction, assetId: string): Promise<boolean> {
    const used = await request(tx.objectStore(ASSIGNMENTS).index(BY_ASSET).count(assetId))
    if (used > 0) return false
    tx.objectStore(ASSETS).delete(assetId)
    tx.objectStore(BLOBS).delete(assetId)
    return true
  }

  async function putAsset(tx: IDBTransaction, item: NewAsset): Promise<boolean> {
    const exists = await request(tx.objectStore(ASSETS).count(item.asset.id))
    if (exists > 0) return false
    tx.objectStore(ASSETS).put(item.asset)
    const record: ArtworkBlobRecord = { id: item.asset.id, blob: item.blob, poster: item.poster }
    tx.objectStore(BLOBS).put(record)
    return true
  }

  return {
    async snapshot() {
      const tx = db.transaction([ASSIGNMENTS, ASSETS], 'readonly')
      const [assignments, assets] = await Promise.all([
        request(tx.objectStore(ASSIGNMENTS).getAll() as IDBRequest<ArtworkAssignment[]>),
        request(tx.objectStore(ASSETS).getAll() as IDBRequest<ArtworkAsset[]>),
      ])
      return { assignments, assets }
    },

    async getBlob(assetId) {
      const tx = db.transaction(BLOBS, 'readonly')
      const record = (await request(tx.objectStore(BLOBS).get(assetId))) as
        ArtworkBlobRecord | undefined
      return record ?? null
    },

    async setPreference(key, videoId, next, expectedRevision, now) {
      let tx: IDBTransaction
      try {
        tx = db.transaction([ASSETS, BLOBS, ASSIGNMENTS], 'readwrite')
      } catch (error) {
        return { ok: false, reason: failureOf(error) }
      }
      const finished = done(tx)
      let written: ArtworkAssignment | null = null
      try {
        const store = tx.objectStore(ASSIGNMENTS)
        const current = (await request(store.get(keyOf(key)))) as ArtworkAssignment | undefined
        if ((current?.revision ?? 0) !== expectedRevision) throw new ConflictError()

        if (next.mode === 'custom' && next.newAsset !== undefined) await putAsset(tx, next.newAsset)
        if (next.mode === 'custom') {
          // 연결할 자산이 실제로 있어야 한다 — 없는 자산을 가리키는 연결을 만들지 않는다.
          const exists = await request(tx.objectStore(ASSETS).count(next.assetId))
          if (exists === 0) throw new Error('asset missing')
        }

        if (next.mode === 'auto') {
          store.delete(keyOf(key))
        } else {
          written = {
            playlistId: key.playlistId,
            trackId: key.trackId,
            videoId,
            mode: next.mode,
            ...(next.mode === 'custom' ? { assetId: next.assetId } : {}),
            revision: (current?.revision ?? 0) + 1,
            updatedAt: now.toISOString(),
          }
          store.put(written)
        }

        const previous = current?.mode === 'custom' ? current.assetId : undefined
        if (previous !== undefined && !(next.mode === 'custom' && next.assetId === previous)) {
          await dropIfUnused(tx, previous)
        }
      } catch (error) {
        abort(tx)
        await finished.catch(() => {})
        return { ok: false, reason: failureOf(error) }
      }
      try {
        await finished
      } catch (error) {
        return { ok: false, reason: failureOf(error) }
      }
      return { ok: true, assignment: written }
    },

    async forget(keys) {
      if (keys.length === 0) return { ok: true, removed: 0 }
      const tx = db.transaction([ASSETS, BLOBS, ASSIGNMENTS], 'readwrite')
      const finished = done(tx)
      let removed = 0
      try {
        const store = tx.objectStore(ASSIGNMENTS)
        const freed = new Set<string>()
        for (const key of keys) {
          const current = (await request(store.get(keyOf(key)))) as ArtworkAssignment | undefined
          if (current === undefined) continue
          store.delete(keyOf(key))
          removed += 1
          if (current.assetId !== undefined) freed.add(current.assetId)
        }
        for (const id of freed) await dropIfUnused(tx, id)
        await finished
        return { ok: true, removed }
      } catch {
        abort(tx)
        await finished.catch(() => {})
        return { ok: false, removed: 0 }
      }
    },

    async cleanUp(keep) {
      const tx = db.transaction([ASSETS, BLOBS, ASSIGNMENTS], 'readwrite')
      const finished = done(tx)
      try {
        const store = tx.objectStore(ASSIGNMENTS)
        const all = (await request(store.getAll())) as ArtworkAssignment[]
        let removedAssignments = 0
        const used = new Set<string>()
        for (const assignment of all) {
          if (keep(assignment)) {
            if (assignment.assetId !== undefined) used.add(assignment.assetId)
            continue
          }
          store.delete([assignment.playlistId, assignment.trackId])
          removedAssignments += 1
        }
        const ids = (await request(tx.objectStore(ASSETS).getAllKeys())) as string[]
        let removedAssets = 0
        for (const id of ids) {
          if (used.has(id)) continue
          tx.objectStore(ASSETS).delete(id)
          tx.objectStore(BLOBS).delete(id)
          removedAssets += 1
        }
        await finished
        return { ok: true, removedAssignments, removedAssets }
      } catch {
        abort(tx)
        await finished.catch(() => {})
        return { ok: false, removedAssignments: 0, removedAssets: 0 }
      }
    },

    async exportAll() {
      const tx = db.transaction([ASSIGNMENTS, ASSETS, BLOBS], 'readonly')
      const [assignments, assets, blobs] = await Promise.all([
        request(tx.objectStore(ASSIGNMENTS).getAll() as IDBRequest<ArtworkAssignment[]>),
        request(tx.objectStore(ASSETS).getAll() as IDBRequest<ArtworkAsset[]>),
        request(tx.objectStore(BLOBS).getAll() as IDBRequest<ArtworkBlobRecord[]>),
      ])
      return { assignments, assets, blobs }
    },

    async stageAssets(assets) {
      let tx: IDBTransaction
      try {
        tx = db.transaction([ASSETS, BLOBS], 'readwrite')
      } catch (error) {
        return { ok: false, reason: failureOf(error) }
      }
      const finished = done(tx)
      const added: string[] = []
      try {
        for (const item of assets) {
          const exists = await request(tx.objectStore(ASSETS).count(item.asset.id))
          if (exists > 0) continue
          tx.objectStore(ASSETS).put(item.asset)
          tx.objectStore(BLOBS).put({ id: item.asset.id, blob: item.blob, poster: item.poster })
          added.push(item.asset.id)
        }
        await finished
        return { ok: true, added }
      } catch (error) {
        abort(tx)
        await finished.catch(() => {})
        return { ok: false, reason: failureOf(error) }
      }
    },

    async replaceAssignments(next) {
      return writeAssignments(next, true)
    },

    async putAssignments(next) {
      return writeAssignments(next, false)
    },

    async removeUnused(ids) {
      if (ids.length === 0) return 0
      const tx = db.transaction([ASSETS, BLOBS, ASSIGNMENTS], 'readwrite')
      const finished = done(tx)
      let removed = 0
      try {
        for (const id of ids) if (await dropIfUnused(tx, id)) removed += 1
        await finished
        return removed
      } catch {
        abort(tx)
        await finished.catch(() => {})
        return 0
      }
    },

    close() {
      db.close()
    },
  }

  async function writeAssignments(
    next: readonly ArtworkAssignment[],
    replace: boolean,
  ): Promise<ArtworkWriteResult> {
    let tx: IDBTransaction
    try {
      tx = db.transaction([ASSETS, ASSIGNMENTS], 'readwrite')
    } catch (error) {
      return { ok: false, reason: failureOf(error) }
    }
    const finished = done(tx)
    try {
      const store = tx.objectStore(ASSIGNMENTS)
      if (replace) store.clear()
      for (const assignment of next) {
        if (assignment.mode === 'custom') {
          const exists = await request(tx.objectStore(ASSETS).count(assignment.assetId ?? ''))
          if (exists === 0) throw new Error('asset missing')
        }
        store.put(assignment)
      }
      await finished
      return { ok: true, assignment: null }
    } catch (error) {
      abort(tx)
      await finished.catch(() => {})
      return { ok: false, reason: failureOf(error) }
    }
  }
}
