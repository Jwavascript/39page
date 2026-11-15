/**
 * 곡별 앨범아트 — 화면이 읽는 경계 (M12-3, ADR 0033 · ARTWORK_DESIGN §3).
 *
 * 저장은 `features/artwork/artworkRepository.ts`(IndexedDB) 가 하고, 이 store 는 **연결 표와 자산 메타를 메모리에**
 * 둔다 — 지금 곡의 그림을 찾는 일이 매번 IndexedDB 를 열지 않는다. 바이트(Blob)는 반응형 상태에 넣지 않는다.
 *
 * 쓰기는 모두 저장소 트랜잭션이 **확정된 뒤에만** 메모리에 반영한다 — 저장에 실패한 것을 바뀐 것처럼 보이지
 * 않는다. 다른 탭이 바꾸면 `BroadcastChannel`(없으면 창이 다시 보일 때)로 알고 다시 읽는다.
 *
 * 라이브러리를 **읽기만** 한다 — 트랙이 있는지 보고, 트랙 · 목록 삭제가 저장된 뒤 그 연결을 지운다
 * (`$onAction`). 라이브러리 저장 형식 · 쓰기 경로에는 끼어들지 않는다.
 */
import { computed, ref, shallowRef } from 'vue'
import { defineStore } from 'pinia'

import {
  createArtworkRepository,
  openArtworkDb,
  type ArtworkBlobRecord,
  type ArtworkRepository,
  type ArtworkWriteFailure,
  type NewAsset,
} from '@/features/artwork/artworkRepository'
import type { ValidatedArtwork } from '@/features/artwork/imageValidation'
import {
  trackKeyString,
  type ArtworkAsset,
  type ArtworkAssignment,
  type ArtworkPreference,
  type TrackKey,
} from '@/shared/types/artwork'
import { libraryStorage, useLibraryStore } from '@/stores/library'

export type ArtworkStatus = 'idle' | 'loading' | 'ready' | 'unavailable'

/** 쓰기 실패 이유 — 저장소의 것에 "트랙이 없다" 를 더한다. */
export type ArtworkChangeFailure = ArtworkWriteFailure | 'track-missing'

export type ArtworkChangeResult =
  { readonly ok: true } | { readonly ok: false; readonly reason: ArtworkChangeFailure }

export const ARTWORK_FAILURE_MESSAGE: Readonly<Record<ArtworkChangeFailure, string>> = {
  conflict: '다른 탭에서 이 곡의 앨범아트가 바뀌었습니다. 지금 것을 보고 다시 골라 주세요.',
  quota:
    '저장 공간이 부족해 저장하지 못했습니다. 쓰지 않는 그림을 정리하거나 더 작은 파일을 골라 주세요.',
  unavailable: '이 브라우저에서 앨범아트 저장소를 열 수 없습니다 (비공개 창 · 저장소 차단 등).',
  failed: '앨범아트를 저장하지 못했습니다. 다시 시도해 주세요.',
  'track-missing': '이 곡이 목록에서 지워졌습니다. 앨범아트를 저장하지 않았습니다.',
}

/** 탭 간 알림 채널 이름. */
export const ARTWORK_CHANNEL = '39page-artwork'

/**
 * 고아 정리의 유예 — 이보다 최근에 바뀐 연결은 라이브러리에 아직 없어도 지우지 않는다. 다른 탭이 방금 곡을
 * 더하고 그림을 붙였는데 이 탭이 그 곡을 아직 읽지 못한 짧은 틈을 덮는다 (ARTWORK_DESIGN §3-3).
 */
export const ORPHAN_GRACE_MS = 10 * 60 * 1000

export interface ArtworkInitOptions {
  readonly factory?: IDBFactory
  /** 탭 간 알림. 테스트가 바꿔 끼운다. 없으면 브라우저의 `BroadcastChannel`. */
  readonly channel?: {
    postMessage(message: unknown): void
    onmessage: ((event: MessageEvent) => void) | null
  } | null
}

export interface StorageEstimate {
  readonly usage: number | null
  readonly quota: number | null
  readonly persisted: boolean | null
}

export const useArtworkStore = defineStore('artwork', () => {
  const library = useLibraryStore()

  const status = ref<ArtworkStatus>('idle')
  /** 트랙 키 문자열 → 연결. 레코드가 없으면 auto. */
  const assignments = shallowRef<ReadonlyMap<string, ArtworkAssignment>>(new Map())
  const assets = shallowRef<ReadonlyMap<string, ArtworkAsset>>(new Map())
  /** 다시 읽은 횟수 — 바이트 캐시를 무효로 할 때 화면이 본다. */
  const generation = ref(0)

  let repository: ArtworkRepository | null = null
  let channel: ArtworkInitOptions['channel'] = null
  let initPromise: Promise<void> | null = null
  /** 바이트 캐시. 반응형이 아니다 — Blob 을 프록시로 감싸지 않는다. */
  const blobCache = new Map<string, Promise<ArtworkBlobRecord | null>>()

  async function reload(): Promise<void> {
    if (repository === null) return
    try {
      const snapshot = await repository.snapshot()
      assignments.value = new Map(
        snapshot.assignments.map((assignment) => [trackKeyString(assignment), assignment]),
      )
      const nextAssets = new Map(snapshot.assets.map((asset) => [asset.id, asset]))
      for (const id of blobCache.keys()) if (!nextAssets.has(id)) blobCache.delete(id)
      assets.value = nextAssets
      generation.value += 1
    } catch {
      status.value = 'unavailable'
    }
  }

  function announce(): void {
    try {
      channel?.postMessage({ type: 'changed' })
    } catch {
      /* 알림은 보조다 — 다른 탭은 창이 다시 보일 때 읽는다 */
    }
  }

  function onVisible(): void {
    if (typeof document !== 'undefined' && document.visibilityState === 'visible') void reload()
  }

  /** 저장소를 열고 읽는다. 여러 번 불러도 한 번만 연다. */
  function init(options: ArtworkInitOptions = {}): Promise<void> {
    if (initPromise !== null) return initPromise
    status.value = 'loading'
    initPromise = (async () => {
      try {
        const db = await openArtworkDb(options.factory)
        db.onversionchange = () => {
          // 다른 탭의 새 빌드가 버전을 올린다 — 막지 않고 닫는다. 이 탭은 새로고침해야 쓸 수 있다.
          db.close()
          repository = null
          status.value = 'unavailable'
        }
        repository = createArtworkRepository(db)
      } catch {
        status.value = 'unavailable'
        return
      }
      await reload()
      if (status.value === 'loading') status.value = 'ready'

      channel =
        options.channel !== undefined
          ? options.channel
          : typeof BroadcastChannel === 'function'
            ? new BroadcastChannel(ARTWORK_CHANNEL)
            : null
      if (channel !== null) channel.onmessage = () => void reload()
      if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisible)
      watchLibraryDeletes()
    })()
    return initPromise
  }

  /* ---------------------------------------------------------------- *
   * 읽기
   * ---------------------------------------------------------------- */

  function assignmentFor(key: TrackKey): ArtworkAssignment | null {
    return assignments.value.get(trackKeyString(key)) ?? null
  }

  function preferenceFor(key: TrackKey): ArtworkPreference {
    const assignment = assignmentFor(key)
    if (assignment === null) return { mode: 'auto' }
    if (assignment.mode === 'custom' && assignment.assetId !== undefined) {
      return { mode: 'custom', assetId: assignment.assetId }
    }
    return { mode: 'default' }
  }

  /** 설정 화면이 열 때 기억하는 수정 번호. 연결이 없으면 0. */
  function revisionFor(key: TrackKey): number {
    return assignmentFor(key)?.revision ?? 0
  }

  function assetFor(id: string): ArtworkAsset | null {
    return assets.value.get(id) ?? null
  }

  /** 자산 바이트. 없으면(사라짐 · 저장소 없음) `null`. 같은 자산은 한 번만 읽는다. */
  function loadBlob(assetId: string): Promise<ArtworkBlobRecord | null> {
    const repo = repository
    if (repo === null) return Promise.resolve(null)
    const cached = blobCache.get(assetId)
    if (cached !== undefined) return cached
    const loading = repo.getBlob(assetId).catch(() => null)
    blobCache.set(assetId, loading)
    void loading.then((record) => {
      if (record === null) blobCache.delete(assetId)
    })
    return loading
  }

  /** 앨범아트 사용량 — 자산 store 의 바이트 합. */
  const usage = computed(() => {
    let bytes = 0
    for (const asset of assets.value.values()) bytes += asset.byteSize
    return { assets: assets.value.size, bytes }
  })

  /** 연결은 있는데 자산이 없는 트랙 (손상). 숨기지 않고 보인다. */
  const missing = computed<ArtworkAssignment[]>(() =>
    [...assignments.value.values()].filter(
      (assignment) =>
        assignment.mode === 'custom' &&
        (assignment.assetId === undefined || !assets.value.has(assignment.assetId)),
    ),
  )

  /** 사용자 이미지를 쓰는 연결 수 (JSON 백업 안내에 쓴다). */
  const customCount = computed(
    () =>
      [...assignments.value.values()].filter((assignment) => assignment.mode === 'custom').length,
  )

  /* ---------------------------------------------------------------- *
   * 쓰기
   * ---------------------------------------------------------------- */

  function trackExists(key: TrackKey): boolean {
    return (
      library.getPlaylist(key.playlistId)?.tracks.some((track) => track.id === key.trackId) ?? false
    )
  }

  async function change(
    key: TrackKey,
    videoId: string,
    write: Parameters<ArtworkRepository['setPreference']>[2],
    expectedRevision: number,
  ): Promise<ArtworkChangeResult> {
    if (repository === null) return { ok: false, reason: 'unavailable' }
    if (!trackExists(key)) return { ok: false, reason: 'track-missing' }
    const result = await repository.setPreference(key, videoId, write, expectedRevision, new Date())
    if (!result.ok) {
      // 충돌이면 지금 것을 다시 읽어 화면이 최신을 보이게 한다.
      if (result.reason === 'conflict') await reload()
      return result
    }
    await reload()
    announce()
    return { ok: true }
  }

  function setCustom(
    key: TrackKey,
    videoId: string,
    artwork: ValidatedArtwork,
    expectedRevision: number,
  ): Promise<ArtworkChangeResult> {
    const newAsset: NewAsset = {
      asset: {
        id: artwork.id,
        mimeType: artwork.mimeType,
        byteSize: artwork.byteSize,
        width: artwork.width,
        height: artwork.height,
        animated: artwork.animated,
        createdAt: new Date().toISOString(),
      },
      blob: artwork.blob,
      poster: artwork.poster,
    }
    return change(key, videoId, { mode: 'custom', assetId: artwork.id, newAsset }, expectedRevision)
  }

  function useDefault(key: TrackKey, videoId: string, expectedRevision: number) {
    return change(key, videoId, { mode: 'default' }, expectedRevision)
  }

  function useAuto(key: TrackKey, videoId: string, expectedRevision: number) {
    return change(key, videoId, { mode: 'auto' }, expectedRevision)
  }

  /** 트랙들의 연결을 지운다 — 라이브러리에서 그 트랙이 **저장된 뒤** 지워졌을 때. */
  async function forgetTracks(keys: readonly TrackKey[]): Promise<void> {
    if (repository === null || keys.length === 0) return
    const known = keys.filter((key) => assignmentFor(key) !== null)
    if (known.length === 0) return
    const result = await repository.forget(known)
    if (result.removed > 0) {
      await reload()
      announce()
    }
  }

  /**
   * 정리 — 라이브러리에 없는 트랙의 연결(유예 시간보다 오래된 것)과 아무도 쓰지 않는 자산을 지운다.
   *
   * 라이브러리를 **저장소에서 다시 읽어** 판단한다 (이 탭의 메모리가 낡았을 수 있다). 라이브러리를 온전히 읽을
   * 수 없으면(보호 · 불가 · 손상) 아무것도 지우지 않는다.
   */
  async function cleanUp(
    now = new Date(),
  ): Promise<
    | { ok: true; removedAssignments: number; removedAssets: number }
    | { ok: false; reason: 'library-unreadable' | 'unavailable' | 'failed' }
  > {
    if (repository === null) return { ok: false, reason: 'unavailable' }
    if (library.status !== 'ready') return { ok: false, reason: 'library-unreadable' }
    // `read()` 는 저장소에 쓰지 않는다. 검증까지 마친 값이다.
    const stored = libraryStorage.read()
    if (
      stored.outcome !== 'stored' &&
      stored.outcome !== 'migrated' &&
      stored.outcome !== 'empty'
    ) {
      return { ok: false, reason: 'library-unreadable' }
    }
    const data = stored.value
    const live = new Set<string>()
    for (const playlist of data.playlists) {
      for (const track of playlist.tracks) {
        live.add(trackKeyString({ playlistId: playlist.id, trackId: track.id }))
      }
    }
    const cutoff = now.getTime() - ORPHAN_GRACE_MS
    const result = await repository.cleanUp(
      (assignment) =>
        live.has(trackKeyString(assignment)) || Date.parse(assignment.updatedAt) > cutoff,
    )
    if (!result.ok) return { ok: false, reason: 'failed' }
    await reload()
    if (result.removedAssignments + result.removedAssets > 0) announce()
    return result as { ok: true; removedAssignments: number; removedAssets: number }
  }

  /** 라이브러리 삭제가 저장된 뒤 그 트랙들의 연결을 지운다. */
  function watchLibraryDeletes(): void {
    library.$onAction(({ name, args, after }) => {
      if (name === 'removeTrack') {
        const [playlistId, trackId] = args as [string, string]
        after((result) => {
          const outcome = result as { ok: boolean; persisted?: boolean }
          if (outcome.ok && outcome.persisted === true) void forgetTracks([{ playlistId, trackId }])
        })
      } else if (name === 'deletePlaylist') {
        const [playlistId] = args as [string]
        const keys = (library.getPlaylist(playlistId)?.tracks ?? []).map((track) => ({
          playlistId,
          trackId: track.id,
        }))
        after((result) => {
          const outcome = result as { ok: boolean; persisted?: boolean }
          if (outcome.ok && outcome.persisted === true) void forgetTracks(keys)
        })
      }
    })
  }

  /** 브라우저 전체 저장 공간 (`navigator.storage.estimate`). 모르면 `null`. */
  async function estimate(): Promise<StorageEstimate> {
    const storage = (globalThis.navigator as Navigator | undefined)?.storage
    try {
      const [estimateResult, persisted] = await Promise.all([
        typeof storage?.estimate === 'function' ? storage.estimate() : Promise.resolve(null),
        typeof storage?.persisted === 'function' ? storage.persisted() : Promise.resolve(null),
      ])
      return {
        usage: estimateResult?.usage ?? null,
        quota: estimateResult?.quota ?? null,
        persisted,
      }
    } catch {
      return { usage: null, quota: null, persisted: null }
    }
  }

  /** "이 브라우저에 오래 보관 요청" — **사용자가 누를 때만** 부른다. 결과를 그대로 돌려준다. */
  async function requestPersist(): Promise<boolean | null> {
    const storage = (globalThis.navigator as Navigator | undefined)?.storage
    if (typeof storage?.persist !== 'function') return null
    try {
      return await storage.persist()
    } catch {
      return null
    }
  }

  /** 백업 · 공유 계층이 쓰는 저장소 (M12-4). 열리지 않았으면 `null`. */
  function repositoryForTransfer(): ArtworkRepository | null {
    return repository
  }

  /** 외부(백업 복원 · 공유 가져오기)가 저장소를 바꾼 뒤 다시 읽고 알린다. */
  async function refreshAfterTransfer(): Promise<void> {
    await reload()
    announce()
  }

  return {
    status,
    assignments,
    assets,
    generation,
    usage,
    missing,
    customCount,
    init,
    reload,
    assignmentFor,
    preferenceFor,
    revisionFor,
    assetFor,
    loadBlob,
    setCustom,
    useDefault,
    useAuto,
    forgetTracks,
    cleanUp,
    estimate,
    requestPersist,
    repositoryForTransfer,
    refreshAfterTransfer,
  }
})
