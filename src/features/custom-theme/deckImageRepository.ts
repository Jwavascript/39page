/**
 * 커스텀 테마의 데크 그림 — IndexedDB `39page-theme` (ADR 0045).
 *
 * 앨범아트 저장소(`39page-artwork`)와 **따로** 둔다. 그 저장소는 어느 곡도 쓰지 않는 그림을 지우고
 * (`cleanUp`), 전체 백업 복원이 연결을 통째로 바꾼다(`replaceAssignments`) — 곡에 붙지 않은 데크 그림은 거기서
 * 사라진다. 이 저장소에는 레코드가 하나(`id: 'deck'`)뿐이다.
 *
 * | store  | keyPath | 레코드                                   |
 * | ------ | ------- | ---------------------------------------- |
 * | `deck` | `id`    | 그림 바이트 · 포스터 · 메타 · 표시 · 수정 번호 |
 *
 * 쓰기는 한 readwrite 트랜잭션이다. 지금 수정 번호가 기대와 다르면 `conflict` 로 거절한다 (다른 탭이 먼저 바꿈).
 * Vue · Pinia 를 모른다 — 화면이 읽는 경계는 `stores/customTheme.ts` 다.
 */
import {
  readArtworkDisplay,
  type ArtworkDisplay,
  type ArtworkMimeType,
} from '@/shared/types/artwork'

export const THEME_DB_NAME = '39page-theme'
export const THEME_DB_VERSION = 1

const DECK = 'deck'
const DECK_ID = 'deck'

/** 저장된 데크 그림. `assetId` 는 내용의 SHA-256 (앨범아트와 같은 검증을 거친 바이트). */
export interface DeckImageRecord {
  readonly id: typeof DECK_ID
  readonly assetId: string
  readonly mimeType: ArtworkMimeType
  readonly byteSize: number
  readonly width: number
  readonly height: number
  readonly animated: boolean
  readonly blob: Blob
  /** 움직이는 GIF 의 첫 프레임 (PNG). 정지 그림이면 `null`. */
  readonly poster: Blob | null
  readonly display: ArtworkDisplay
  /** 1 부터. 지우면 레코드가 없다(0). */
  readonly revision: number
  readonly updatedAt: string
}

/** 새로 쓸 그림 — 수정 번호 · 시각은 저장소가 매긴다. */
export type DeckImageWrite = Omit<DeckImageRecord, 'id' | 'revision' | 'updatedAt'>

export type DeckWriteFailure = 'conflict' | 'quota' | 'unavailable' | 'failed'

export type DeckWriteResult =
  | { readonly ok: true; readonly record: DeckImageRecord | null }
  | { readonly ok: false; readonly reason: DeckWriteFailure }

class ConflictError extends Error {}

function failureOf(error: unknown): DeckWriteFailure {
  if (error instanceof ConflictError) return 'conflict'
  const name = (error as { name?: string } | null)?.name
  if (name === 'QuotaExceededError') return 'quota'
  if (name === 'InvalidStateError' || name === 'VersionError') return 'unavailable'
  return 'failed'
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('IDB request failed'))
  })
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onabort = () => reject(tx.error ?? new DOMException('aborted', 'AbortError'))
    tx.onerror = () => {
      /* abort 로 이어진다 */
    }
  })
}

/** 저장소에서 읽은 레코드가 온전한지 — 아니면 없는 것으로 본다(덮어쓰지는 않는다). */
function readRecord(value: unknown): DeckImageRecord | null {
  if (typeof value !== 'object' || value === null) return null
  const record = value as Partial<DeckImageRecord>
  if (record.id !== DECK_ID || !(record.blob instanceof Blob)) return null
  if (typeof record.assetId !== 'string' || typeof record.revision !== 'number') return null
  const display = readArtworkDisplay(record.display)
  if (display === null) return null
  return { ...(record as DeckImageRecord), display }
}

export function openThemeDb(
  factory: IDBFactory | undefined = globalThis.indexedDB,
): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (factory === undefined) {
      reject(new Error('IndexedDB 를 쓸 수 없습니다.'))
      return
    }
    let req: IDBOpenDBRequest
    try {
      req = factory.open(THEME_DB_NAME, THEME_DB_VERSION)
    } catch (error) {
      reject(error instanceof Error ? error : new Error(String(error)))
      return
    }
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(DECK)) db.createObjectStore(DECK, { keyPath: 'id' })
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'))
    req.onblocked = () => reject(new Error('IndexedDB open blocked'))
  })
}

export interface DeckImageRepository {
  read(): Promise<DeckImageRecord | null>
  /**
   * 그림을 바꾸거나(`next`) 지운다(`null`). 트랜잭션 안의 지금 수정 번호가 `expectedRevision` 과 다르면 `conflict`.
   * `display` 만 바꿀 때도 바이트를 함께 준다 — 같은 Blob 이라 다시 복사하지 않는다.
   */
  write(next: DeckImageWrite | null, expectedRevision: number, now: Date): Promise<DeckWriteResult>
  close(): void
}

export function createDeckImageRepository(db: IDBDatabase): DeckImageRepository {
  return {
    async read() {
      const tx = db.transaction(DECK, 'readonly')
      return readRecord(await request(tx.objectStore(DECK).get(DECK_ID)))
    },

    async write(next, expectedRevision, now) {
      let tx: IDBTransaction
      try {
        tx = db.transaction(DECK, 'readwrite')
      } catch (error) {
        return { ok: false, reason: failureOf(error) }
      }
      const finished = done(tx)
      let written: DeckImageRecord | null = null
      try {
        const store = tx.objectStore(DECK)
        const current = readRecord(await request(store.get(DECK_ID)))
        if ((current?.revision ?? 0) !== expectedRevision) throw new ConflictError()
        if (next === null) {
          store.delete(DECK_ID)
        } else {
          const display = readArtworkDisplay(next.display)
          if (display === null) throw new Error('invalid display')
          written = {
            ...next,
            display,
            id: DECK_ID,
            revision: (current?.revision ?? 0) + 1,
            updatedAt: now.toISOString(),
          }
          store.put(written)
        }
      } catch (error) {
        try {
          tx.abort()
        } catch {
          /* 이미 끝남 */
        }
        await finished.catch(() => {})
        return { ok: false, reason: failureOf(error) }
      }
      try {
        await finished
      } catch (error) {
        return { ok: false, reason: failureOf(error) }
      }
      return { ok: true, record: written }
    },

    close() {
      db.close()
    },
  }
}
