/**
 * Record Library 상태.
 *
 * 플레이리스트의 생성·이름 변경·삭제·선택과 영속화를 담당한다.
 *
 * **재생과 완전히 분리된다.** 라이브러리에서 선택한 플레이리스트와 실제
 * 재생 중인 대기열은 서로 다른 상태다. 이 store 는 `playback` store 를
 * import 하지 않고 재생 큐를 건드리지 않는다. 사용자가 목록의 재생 버튼을
 * 누르는 흐름은 상위 UI 계층이 두 store 를 조립해 만든다
 * (`AGENTS.md` 규칙 2, 4 / `docs/architecture/SYSTEM_DESIGN.md` §6.1).
 *
 * **데이터 보존을 우선한다.** 라이브러리는 사용자가 직접 축적한 데이터이므로
 * 테마 설정과 다르게 다룬다. 저장된 원본을 읽지 못했거나 일부만 복구한
 * 경우에는 `protected` 상태가 되어, 평범한 수정이 원본을 조용히 덮어쓰지
 * 않는다. 수정은 메모리에서 계속 되지만 저장만 막는다.
 */
import { computed, readonly, ref } from 'vue'
import { defineStore } from 'pinia'

import {
  STORAGE_KEYS,
  defineStorage,
  type ReadOutcome,
  type WriteFailureReason,
} from '@/shared/storage'
import { isYouTubeVideoId } from '@/shared/utils/youtube'
import { createId } from '@/shared/utils/id'
import type { LibraryData, Playlist, Track } from '@/shared/types'

/** 라이브러리 저장 스키마 버전. */
export const LIBRARY_STORAGE_VERSION = 1

/** 플레이리스트 이름 최대 길이 (`MVP_SPEC.md` F4). */
export const MAX_PLAYLIST_NAME_LENGTH = 60

/** 트랙 제목 최대 길이 (`MVP_SPEC.md` F4). */
export const MAX_TRACK_TITLE_LENGTH = 100

/** 제목을 비웠을 때 쓰는 기본 표기 (`MVP_SPEC.md` F4). */
export function defaultTrackTitle(videoId: string): string {
  return `YouTube · ${videoId}`
}

/* ------------------------------------------------------------------ *
 * 검증과 정규화
 * ------------------------------------------------------------------ */

/** 정규화 과정에서 원본과 달라진 내용. */
export interface LibraryNormalizationReport {
  /** 버린 플레이리스트 수. */
  droppedPlaylists: number
  /** 버린 트랙 수. */
  droppedTracks: number
  /** `selectedPlaylistId` 를 보정했는지. */
  repairedSelection: boolean
}

export interface LibraryNormalizationResult {
  data: LibraryData
  report: LibraryNormalizationReport
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

/** 트랙 하나를 검증한다. 형식이 맞지 않으면 `null`. */
function normalizeTrack(value: unknown): Track | null {
  if (!isRecord(value)) return null
  if (!isNonEmptyString(value.id)) return null
  // MVP 의 트랙 소스는 YouTube 단독이다.
  if (value.source !== 'youtube') return null
  // 11자 영상 ID 형식을 지킨다. 깨진 videoId 는 재생할 수 없다.
  if (!isYouTubeVideoId(value.videoId)) return null
  if (typeof value.title !== 'string') return null

  return { id: value.id, source: 'youtube', videoId: value.videoId, title: value.title }
}

/**
 * 저장소에서 읽은 알 수 없는 값을 `LibraryData` 로 정규화한다.
 *
 * 되살릴 수 있는 항목은 살리고 불량 항목만 버린다. 무엇을 버렸는지
 * `report` 로 알린다. 호출자는 이 보고를 보고 원본을 덮어쓸지 판단한다.
 *
 * 형태가 근본적으로 다르면(객체가 아님, `playlists` 가 배열이 아님)
 * `null` 을 돌려준다. 이때는 복구할 것이 없다.
 */
export function normalizeLibraryData(value: unknown): LibraryNormalizationResult | null {
  if (!isRecord(value)) return null
  if (!Array.isArray(value.playlists)) return null

  const report: LibraryNormalizationReport = {
    droppedPlaylists: 0,
    droppedTracks: 0,
    repairedSelection: false,
  }

  const playlists: Playlist[] = []
  const seenPlaylistIds = new Set<string>()

  for (const candidate of value.playlists) {
    if (!isRecord(candidate) || !isNonEmptyString(candidate.id)) {
      report.droppedPlaylists += 1
      continue
    }
    if (typeof candidate.name !== 'string' || !Array.isArray(candidate.tracks)) {
      report.droppedPlaylists += 1
      continue
    }
    // 중복 id 는 조회·편집을 모호하게 만든다. 처음 것만 남긴다.
    if (seenPlaylistIds.has(candidate.id)) {
      report.droppedPlaylists += 1
      continue
    }
    seenPlaylistIds.add(candidate.id)

    const tracks: Track[] = []
    const seenTrackIds = new Set<string>()

    for (const rawTrack of candidate.tracks) {
      const track = normalizeTrack(rawTrack)
      if (track === null || seenTrackIds.has(track.id)) {
        report.droppedTracks += 1
        continue
      }
      seenTrackIds.add(track.id)
      // 순서를 유지한다.
      tracks.push(track)
    }

    playlists.push({ id: candidate.id, name: candidate.name, tracks })
  }

  const rawSelected = value.selectedPlaylistId
  let selectedPlaylistId: string | null = null

  if (typeof rawSelected === 'string' && seenPlaylistIds.has(rawSelected)) {
    selectedPlaylistId = rawSelected
  } else {
    // 존재하지 않는 선택은 첫 번째 목록으로 보정한다. 목록이 없으면 null.
    selectedPlaylistId = playlists[0]?.id ?? null
    const wasAlreadyNull = rawSelected === null || rawSelected === undefined
    report.repairedSelection = !(wasAlreadyNull && selectedPlaylistId === null)
  }

  return { data: { playlists, selectedPlaylistId }, report }
}

/* ------------------------------------------------------------------ *
 * 영속화
 * ------------------------------------------------------------------ */

function emptyLibrary(): LibraryData {
  return { playlists: [], selectedPlaylistId: null }
}

/**
 * 마지막 정규화 보고.
 *
 * `defineStorage` 의 `validate` 는 `T | null` 만 돌려줄 수 있어서 무엇을
 * 버렸는지 전달할 수 없다. `validate` 는 `read()` 안에서 **동기적으로**
 * 한 번 호출되므로, 여기에 적어두고 `read()` 직후에 읽으면 안전하다.
 */
let lastReport: LibraryNormalizationReport | null = null

/**
 * 보고를 꺼내고 비운다. `read()` 직후에 한 번만 호출한다.
 *
 * 함수로 감싼 이유: 변수를 직접 읽으면 TypeScript 가 바로 위의 `= null`
 * 대입만 보고 `never` 로 좁힌다. `read()` 안에서 채워진다는 것을 알 수 없다.
 */
function takeNormalizationReport(): LibraryNormalizationReport | null {
  const report = lastReport
  lastReport = null
  return report
}

export const libraryStorage = defineStorage<LibraryData>({
  key: STORAGE_KEYS.library,
  version: LIBRARY_STORAGE_VERSION,
  fallback: emptyLibrary,
  validate: (value) => {
    const result = normalizeLibraryData(value)
    lastReport = result?.report ?? null
    return result?.data ?? null
  },
})

/* ------------------------------------------------------------------ *
 * Store
 * ------------------------------------------------------------------ */

/**
 * 저장소에 대한 현재 상태.
 *
 * - `ready` — 정상. 수정하면 저장된다.
 * - `unavailable` — 저장소에 접근할 수 없다. 메모리에서만 동작한다.
 * - `protected` — 저장된 원본을 읽지 못했거나 일부만 복구했다.
 *   **덮어쓰기를 막는다.** 수정은 메모리에서 되지만 저장되지 않는다.
 */
export type LibraryStatus = 'ready' | 'unavailable' | 'protected'

/** 원본을 보호하는 이유. */
export type LibraryProtectedReason =
  /** JSON 이 깨졌거나 봉투 형태가 아니다. */
  | 'malformed'
  /** 봉투는 읽었지만 복구할 수 있는 데이터가 없다. */
  | 'invalid'
  /** 지원하지 않는 스키마 버전이다 (대개 상위 버전). */
  | 'version-mismatch'
  /** 일부만 복구했다. 나머지를 덮어쓰면 영구히 잃는다. */
  | 'partial-recovery'

export type LibraryMutationFailure =
  /** 공백만 있는 이름이다. */
  | 'empty-name'
  /** 해당 id 의 플레이리스트나 트랙이 없다. */
  | 'not-found'
  /** 11자 YouTube 영상 ID 형식이 아니다. */
  | 'invalid-video-id'
  /** 목록 경계라 더 옮길 수 없다. */
  | 'out-of-range'
  /**
   * 다른 탭이 저장소의 라이브러리를 바꿨다 (M10-3, ADR 0024).
   *
   * 이 탭의 상태가 낡았으므로 **쓰지 않았다.** 최신 원본을 다시 읽었고 이번
   * 변경은 적용하지 않았다 — 사용자가 확인하고 다시 시도한다.
   */
  | 'conflict'

export type LibraryMutationResult =
  | {
      readonly ok: true
      /** 변경 대상 플레이리스트의 id. 생성 시에는 새로 발급한 id. */
      readonly playlistId: string
      /** 트랙을 다룬 동작에서 그 트랙의 id. 추가 시에는 새로 발급한 id. */
      readonly trackId?: string
      /** 저장소에 반영됐는지. `false` 면 메모리에만 반영됐다. */
      readonly persisted: boolean
    }
  | { readonly ok: false; readonly reason: LibraryMutationFailure }

function failure(reason: LibraryMutationFailure): LibraryMutationResult {
  return { ok: false, reason }
}

/**
 * 다른 탭의 변경을 이 탭에 다시 읽어 들였다는 기록 (M10-3, ADR 0024).
 *
 * `sequence` 는 다시 읽을 때마다 하나씩 는다 — 화면이 "또 바뀌었다" 를 알 수 있다.
 * `discardedUnsaved` 는 그때 **이 탭에서 저장하지 못한 변경**(쓰기 실패 ·
 * 보호 상태의 세션 전용 변경)이 있었고 그것이 사라졌다는 뜻이다.
 */
export interface LibraryExternalChange {
  readonly sequence: number
  readonly discardedUnsaved: boolean
}

/** 다른 탭의 `storage` 이벤트를 받을 대상. 테스트가 바꿔 낄 수 있게 좁힌다. */
export interface StorageEventTarget {
  addEventListener(type: 'storage', listener: (event: StorageEvent) => void): void
  removeEventListener(type: 'storage', listener: (event: StorageEvent) => void): void
}

/**
 * `replaceAll` 의 결과 (M8-3).
 *
 * 평범한 액션과 모양이 다르다. 대상 id 가 없고, **저장 실패 이유를 그대로
 * 돌려준다** — 가져오기가 "라이브러리는 반영됐지만 저장은 실패했다" 를 사용자에게
 * 정확히 말해야 하기 때문이다.
 */
export interface LibraryReplaceResult {
  /** 메모리 반영은 항상 성공한다. 이 값은 저장 여부가 아니다. */
  readonly ok: true
  /** 저장소에 반영됐는지. */
  readonly persisted: boolean
  /** 저장 실패 이유. 성공이면 `null`. */
  readonly writeFailure: WriteFailureReason | null
  /**
   * 쓴 값을 **다시 읽어 확인했는지** (M8-4).
   *
   * `persisted` 가 `true` 일 때만 뜻이 있다. 쓰기는 성공했다고 했는데 다시
   * 읽으니 달라지는 저장소가 있을 수 있다 — 그 경우를 **성공으로 보고하지
   * 않기 위해** 따로 센다.
   *
   * 되돌리지는 않는다. 되돌리려면 저장 계층에 원문 쓰기 경로를 열어야 하고,
   * 그것은 "쓰기는 봉투를 거친다" 는 보장을 깬다. 대신 정직하게 알린다.
   */
  readonly verified: boolean
}

/**
 * 비교를 위한 정규 형태 (M8-4).
 *
 * 키 순서가 달라도 같은 데이터로 보려면 한 번 다시 쌓아야 한다. 호출부가
 * `{ name, id, tracks }` 순으로 넘겨도 검증이 헛되게 실패하지 않는다.
 */
function canonicalLibrary(data: LibraryData): string {
  return JSON.stringify({
    playlists: data.playlists.map((playlist) => ({
      id: playlist.id,
      name: playlist.name,
      tracks: playlist.tracks.map((track) => ({
        id: track.id,
        source: track.source,
        videoId: track.videoId,
        title: track.title,
      })),
    })),
    selectedPlaylistId: data.selectedPlaylistId,
  })
}

/** 앞뒤 공백을 떼고 길이를 자른다. 공백뿐이면 `null`. */
function normalizeName(name: string): string | null {
  const trimmed = name.trim()
  return trimmed === '' ? null : trimmed.slice(0, MAX_PLAYLIST_NAME_LENGTH)
}

/**
 * 트랙 제목을 다듬는다.
 *
 * 이름과 달리 **빈 값을 거부하지 않는다.** 비우면 `YouTube · <videoId>` 를
 * 쓰는 것이 승인된 동작이다 (`MVP_SPEC.md` F4).
 */
function normalizeTitle(title: string | undefined, videoId: string): string {
  const trimmed = (title ?? '').trim()
  return trimmed === '' ? defaultTrackTitle(videoId) : trimmed.slice(0, MAX_TRACK_TITLE_LENGTH)
}

export const useLibraryStore = defineStore('library', () => {
  const items = ref<Playlist[]>([])
  const selectedId = ref<string | null>(null)

  const status = ref<LibraryStatus>('ready')
  const protectedReason = ref<LibraryProtectedReason | null>(null)
  const restoreOutcome = ref<ReadOutcome | null>(null)
  const lastWriteFailure = ref<WriteFailureReason | null>(null)
  const externalChange = ref<LibraryExternalChange | null>(null)

  /*
   * 탭 간 정합성 (M10-3, ADR 0024).
   *
   * `baselineRaw` — 이 탭이 **마지막으로 읽거나 쓴 저장소 원문**. 다음에 쓰기
   * 직전에 지금 원문과 비교한다. 다르면 다른 탭이 그 사이에 썼다는 뜻이고,
   * 이 탭의 메모리 상태로 쓰면 그 변경을 지운다 — 그래서 쓰지 않는다.
   *
   * `dirty` — 메모리에만 있고 저장되지 않은 변경이 있다 (쓰기 실패 · 보호 상태).
   * 다시 읽을 때 그것이 사라진다는 것을 알리기 위해 센다.
   *
   * 화면에 그릴 것이 아니라 비교용이므로 ref 가 아니다.
   */
  let baselineRaw: string | null = null
  let dirty = false

  /** 수정이 저장소에 반영될 수 있는 상태인지. */
  const canPersist = computed<boolean>(() => status.value === 'ready')

  const selectedPlaylist = computed<Playlist | null>(
    () => items.value.find((playlist) => playlist.id === selectedId.value) ?? null,
  )

  /** id 로 플레이리스트를 찾는다. 없으면 `undefined`. */
  function getPlaylist(id: string): Playlist | undefined {
    return items.value.find((playlist) => playlist.id === id)
  }

  /**
   * 다른 탭이 이 탭의 기준 원문 이후에 저장소를 바꿨는지 (`ready` 일 때만 뜻이 있다).
   *
   * 저장소에 **접근할 수 없게 된** 경우는 다른 탭의 변경이 아니다 — `raw()` 의
   * `null` 이 "비었다" 인지 "못 읽는다" 인지 먼저 가른다. 못 읽으면 메모리를 지키고
   * 쓰기가 실패하게 둔다 (기존 동작, ADR 0007).
   */
  function hasExternalChange(): boolean {
    return (
      status.value === 'ready' && libraryStorage.available() && libraryStorage.raw() !== baselineRaw
    )
  }

  /**
   * 저장소의 최신 원본을 다시 읽는다 (M10-3). **읽기만 한다.**
   *
   * `restore()` 를 그대로 쓴다 — 손상·미지원 버전이면 `protected` 로 바뀌어 이후
   * 쓰기를 막는다 (ADR 0007 이 다른 탭이 쓴 값에도 그대로 적용된다).
   *
   * **선택은 이 탭의 것을 지킨다** — 그 목록이 아직 있으면. 선택은 탭마다의 화면
   * 상태에 가깝고, 다른 탭이 목록을 고를 때마다 이 탭의 드로어가 바뀌면 놀랍다.
   * 다음 쓰기 때 이 탭의 선택이 저장되지만 데이터를 잃지는 않는다.
   */
  function reload(): void {
    const keepSelection = selectedId.value
    const discardedUnsaved = dirty

    restore()

    if (keepSelection !== null && items.value.some((playlist) => playlist.id === keepSelection)) {
      selectedId.value = keepSelection
    }
    // 메모리가 저장소와 같아졌다 — 저장 실패 안내는 더 이상 사실이 아니다.
    lastWriteFailure.value = null
    externalChange.value = {
      sequence: (externalChange.value?.sequence ?? 0) + 1,
      discardedUnsaved,
    }
  }

  /**
   * 변경 액션의 첫 줄 — 낡은 상태에서 시작하지 않게 한다 (M10-3).
   *
   * 다른 탭이 바꿨으면 최신을 다시 읽고 `conflict` 로 거절한다. 이 탭의 메모리로
   * 쓰지 않으므로 다른 탭의 변경이 남는다.
   */
  function staleGuard(): LibraryMutationResult | null {
    if (!hasExternalChange()) return null
    reload()
    return failure('conflict')
  }

  type PersistOutcome = 'written' | 'skipped' | 'failed' | 'conflict'

  /**
   * 현재 상태를 저장한다.
   *
   * `protected` / `unavailable` 상태에서는 쓰지 않는다. 저장 실패는
   * 예외로 전파하지 않고 결과로 알린다.
   *
   * 쓰기 **직전에** 저장소 원문을 기준 원문과 다시 비교한다 (M10-3). 액션 첫 줄의
   * `staleGuard` 와 같은 동기 실행 안이라 보통은 겹치지만, 새 액션이 가드를
   * 빠뜨려도 여기서 막힌다. 다르면 메모리의 이번 변경을 버리고 최신을 다시 읽는다.
   */
  function persist(): PersistOutcome {
    if (!canPersist.value) {
      dirty = true
      return 'skipped'
    }

    if (libraryStorage.available() && libraryStorage.raw() !== baselineRaw) {
      reload()
      return 'conflict'
    }

    const result = libraryStorage.write({
      playlists: items.value,
      selectedPlaylistId: selectedId.value,
    })
    lastWriteFailure.value = result.ok ? null : result.reason

    if (!result.ok) {
      dirty = true
      return 'failed'
    }

    baselineRaw = libraryStorage.raw()
    dirty = false
    // 저장에 성공했다 — "저장하지 못한 변경이 사라졌다" 안내는 할 일을 다 했다.
    if (externalChange.value?.discardedUnsaved) {
      externalChange.value = { ...externalChange.value, discardedUnsaved: false }
    }
    return 'written'
  }

  function success(playlistId: string, trackId?: string): LibraryMutationResult {
    const outcome = persist()
    if (outcome === 'conflict') return failure('conflict')
    return { ok: true, playlistId, trackId, persisted: outcome === 'written' }
  }

  /**
   * 한 플레이리스트의 트랙 배열만 바꾼다.
   *
   * 다른 플레이리스트는 **같은 객체 참조**로 남는다. 편집하지 않은 목록이
   * 바뀌지 않는다는 것을 구조로 보장한다.
   */
  function replaceTracks(index: number, playlist: Playlist, tracks: Track[]): void {
    const next = [...items.value]
    next[index] = { ...playlist, tracks }
    items.value = next
  }

  /**
   * 저장된 라이브러리를 복원한다.
   *
   * **읽기만 한다.** 손상된 데이터나 상위 버전 데이터를 지우거나 덮어쓰지
   * 않는다. 복구할 수 없으면 빈 상태를 화면에 주되 원본은 보호한다.
   */
  function restore(): ReadOutcome {
    lastReport = null
    // 같은 동기 실행 안에서 읽으므로 이 원문이 아래 read() 가 해석한 원문이다.
    baselineRaw = libraryStorage.raw()
    dirty = false
    const { value, outcome } = libraryStorage.read()
    const report = takeNormalizationReport()

    restoreOutcome.value = outcome
    items.value = value.playlists
    selectedId.value = value.selectedPlaylistId

    if (outcome === 'unavailable') {
      status.value = 'unavailable'
      protectedReason.value = null
      return outcome
    }

    if (outcome === 'malformed' || outcome === 'invalid' || outcome === 'version-mismatch') {
      status.value = 'protected'
      protectedReason.value = outcome
      return outcome
    }

    if (outcome === 'migration-failed') {
      status.value = 'protected'
      protectedReason.value = 'invalid'
      return outcome
    }

    // 'stored' / 'migrated' / 'empty'.
    // 일부만 살린 경우에도 원본을 덮어쓰면 버린 항목을 영구히 잃는다.
    const lostData = report !== null && (report.droppedPlaylists > 0 || report.droppedTracks > 0)
    status.value = lostData ? 'protected' : 'ready'
    protectedReason.value = lostData ? 'partial-recovery' : null

    return outcome
  }

  /** 새 플레이리스트를 만들고 선택한다. 트랙은 비어 있다. */
  function createPlaylist(name: string): LibraryMutationResult {
    const stale = staleGuard()
    if (stale !== null) return stale

    const normalized = normalizeName(name)
    if (normalized === null) return failure('empty-name')

    const playlist: Playlist = { id: createId(), name: normalized, tracks: [] }
    items.value = [...items.value, playlist]
    selectedId.value = playlist.id

    return success(playlist.id)
  }

  /** 이름만 바꾼다. id 와 트랙은 그대로 둔다. */
  function renamePlaylist(id: string, name: string): LibraryMutationResult {
    const stale = staleGuard()
    if (stale !== null) return stale

    const index = items.value.findIndex((playlist) => playlist.id === id)
    if (index === -1) return failure('not-found')

    const normalized = normalizeName(name)
    if (normalized === null) return failure('empty-name')

    const current = items.value[index]
    if (current === undefined) return failure('not-found')

    // 트랙 배열은 같은 참조를 유지한다. 이름 변경이 트랙을 건드리지 않는다.
    const next = [...items.value]
    next[index] = { ...current, name: normalized }
    items.value = next

    return success(id)
  }

  /**
   * 플레이리스트를 삭제한다.
   *
   * 선택된 목록을 지웠다면 **결정적으로** 다음 목록을 고른다. 지운 자리의
   * 항목을 쓰고, 마지막이었다면 그 앞을 쓴다. 남은 목록이 없으면 `null`.
   */
  function deletePlaylist(id: string): LibraryMutationResult {
    const stale = staleGuard()
    if (stale !== null) return stale

    const index = items.value.findIndex((playlist) => playlist.id === id)
    if (index === -1) return failure('not-found')

    const next = items.value.filter((playlist) => playlist.id !== id)
    items.value = next

    if (selectedId.value === id) {
      const fallbackIndex = Math.min(index, next.length - 1)
      selectedId.value = next.length === 0 ? null : (next[fallbackIndex]?.id ?? null)
    }

    return success(id)
  }

  /**
   * 트랙을 플레이리스트 **끝에** 추가한다.
   *
   * `videoId` 는 11자 YouTube 영상 ID 여야 한다. 복원 때 쓰는
   * `normalizeTrack` 과 **같은 기준**(`isYouTubeVideoId`)으로 검증하므로,
   * 추가한 트랙이 다음 복원에서 버려지는 일이 없다.
   *
   * URL 문자열을 저장하지 않는다. 데이터 모델의 `videoId` 만 남긴다.
   * 같은 영상을 여러 번 넣을 수 있고, 그때도 `track.id` 는 서로 다르다.
   */
  function addTrack(
    playlistId: string,
    input: { videoId: string; title?: string },
  ): LibraryMutationResult {
    const stale = staleGuard()
    if (stale !== null) return stale

    const index = items.value.findIndex((playlist) => playlist.id === playlistId)
    if (index === -1) return failure('not-found')

    if (!isYouTubeVideoId(input.videoId)) return failure('invalid-video-id')

    const playlist = items.value[index]
    if (playlist === undefined) return failure('not-found')

    const track: Track = {
      id: createId(),
      source: 'youtube',
      videoId: input.videoId,
      title: normalizeTitle(input.title, input.videoId),
    }

    replaceTracks(index, playlist, [...playlist.tracks, track])
    return success(playlistId, track.id)
  }

  /** 트랙 하나를 뺀다. 나머지 트랙의 id 와 순서는 그대로다. */
  function removeTrack(playlistId: string, trackId: string): LibraryMutationResult {
    const stale = staleGuard()
    if (stale !== null) return stale

    const index = items.value.findIndex((playlist) => playlist.id === playlistId)
    if (index === -1) return failure('not-found')

    const playlist = items.value[index]
    if (playlist === undefined) return failure('not-found')
    if (!playlist.tracks.some((track) => track.id === trackId)) return failure('not-found')

    replaceTracks(
      index,
      playlist,
      playlist.tracks.filter((track) => track.id !== trackId),
    )
    return success(playlistId, trackId)
  }

  /**
   * 트랙을 한 칸 올리거나 내린다.
   *
   * 경계를 넘는 요청은 `out-of-range` 로 거절하고 **상태를 바꾸지 않는다.**
   * 교환만 하므로 트랙의 id 와 내용은 그대로다.
   */
  function moveTrack(
    playlistId: string,
    trackId: string,
    direction: 'up' | 'down',
  ): LibraryMutationResult {
    const stale = staleGuard()
    if (stale !== null) return stale

    const index = items.value.findIndex((playlist) => playlist.id === playlistId)
    if (index === -1) return failure('not-found')

    const playlist = items.value[index]
    if (playlist === undefined) return failure('not-found')

    const from = playlist.tracks.findIndex((track) => track.id === trackId)
    if (from === -1) return failure('not-found')

    const to = direction === 'up' ? from - 1 : from + 1
    if (to < 0 || to >= playlist.tracks.length) return failure('out-of-range')

    const tracks = [...playlist.tracks]
    const moved = tracks[from]
    const swapped = tracks[to]
    if (moved === undefined || swapped === undefined) return failure('out-of-range')

    tracks[to] = moved
    tracks[from] = swapped

    replaceTracks(index, playlist, tracks)
    return success(playlistId, trackId)
  }

  /**
   * 트랙의 표시 이름을 바꾼다 (M6-5).
   *
   * `id` · `videoId` · 순서는 그대로다. 이름만 바뀐다. 다른 플레이리스트는
   * `replaceTracks` 덕분에 같은 객체 참조로 남는다.
   *
   * **빈 값을 거부하지 않는다.** `addTrack` 과 **같은** `normalizeTitle` 을
   * 쓰므로 제목을 비우면 `YouTube · <videoId>` 로 되돌아간다
   * (`MVP_SPEC.md` F4). 두 경로가 같은 규칙을 쓰는 것이 중요하다 — 추가할
   * 때와 고칠 때 빈 제목의 뜻이 달라지면 사용자가 예측할 수 없다.
   */
  function renameTrack(playlistId: string, trackId: string, title: string): LibraryMutationResult {
    const stale = staleGuard()
    if (stale !== null) return stale

    const index = items.value.findIndex((playlist) => playlist.id === playlistId)
    if (index === -1) return failure('not-found')

    const playlist = items.value[index]
    if (playlist === undefined) return failure('not-found')

    const from = playlist.tracks.findIndex((track) => track.id === trackId)
    if (from === -1) return failure('not-found')

    const current = playlist.tracks[from]
    if (current === undefined) return failure('not-found')

    const tracks = [...playlist.tracks]
    tracks[from] = { ...current, title: normalizeTitle(title, current.videoId) }

    replaceTracks(index, playlist, tracks)
    return success(playlistId, trackId)
  }

  /**
   * 라이브러리를 **통째로 교체한다** (M8-3). ⚠ **보호 우회 경로다.**
   *
   * ADR 0007 은 `protected` / `unavailable` 에서 **평범한 수정**의 저장을
   * 막는다. 읽지 못한 원본을 첫 쓰기로 잃지 않기 위해서다. 그 ADR 은 동시에
   * 남겨 두었다:
   *
   * > "기존 데이터를 버리고 새로 시작" 같은 명시적 조작을 제공해야 한다.
   * > 그 확인 UI 와 강제 초기화 액션은 이번 범위에 없다.
   *
   * 이 액션이 그 조작이다. **백업 가져오기 경로에서만 부른다** — 사용자가
   * 미리보기를 보고 "교체하고 가져오기" 를 누른 뒤에만. 다른 곳에서 부르면
   * ADR 0007 이 무의미해지므로 테스트로 호출 지점을 고정한다
   * (`tests/unit/backup-import.spec.ts`).
   *
   * `persist()` 를 쓰지 않는다. 그 함수는 `canPersist` 로 막혀 있고, 막혀
   * 있는 것이 평범한 경로에서는 옳다. 여기서는 **의도적으로** 그 문을 지난다.
   *
   * 저장이 실패하면 **`status` 를 바꾸지 않는다.** 원본이 아직 저장소에
   * 그대로 있으므로 보호를 풀 이유가 없다. 메모리는 교체된 상태로 남고
   * `persisted: false` 로 알린다.
   *
   * @param data **이미 검증된** `LibraryData`. 방어적으로 다시 정규화하지
   *   않는다 — 호출부가 `normalizeLibraryData` 로 검증하고 사용자에게 버린
   *   항목까지 보여준 뒤에 넘긴다. 여기서 또 버리면 사용자가 승인한 것과
   *   저장되는 것이 달라진다.
   */
  function replaceAll(data: LibraryData): LibraryReplaceResult {
    // 트랙 배열까지 복사한다. 호출부가 넘긴 객체와 store 가 참조를 공유하지 않는다.
    items.value = data.playlists.map((playlist) => ({
      ...playlist,
      tracks: playlist.tracks.map((track) => ({ ...track })),
    }))
    selectedId.value = data.selectedPlaylistId

    const result = libraryStorage.write({
      playlists: items.value,
      selectedPlaylistId: selectedId.value,
    })

    lastWriteFailure.value = result.ok ? null : result.reason

    if (!result.ok) {
      dirty = true
      return { ok: true, persisted: false, writeFailure: result.reason, verified: false }
    }

    // 다음 쓰기의 비교 기준을 새 원문으로 옮긴다 (M10-3). 가져오기의 신선도 검사는
    // 가져오기 경로가 따로 한다 (ADR 0018) — 여기서는 덮어쓰기를 막지 않는다.
    baselineRaw = libraryStorage.raw()
    dirty = false

    /*
     * 사용자가 원본을 버리기로 **결정했고** 그 결정이 저장됐다. 보호할
     * 원본이 더는 없으므로 보호를 푼다.
     */
    status.value = 'ready'
    protectedReason.value = null

    /*
     * 쓴 값을 다시 읽어 확인한다 (M8-4).
     *
     * 복원은 한 번만 일어나므로 파싱 한 번을 더 해도 된다. 쓰기가 성공했다고
     * 했는데 읽으니 달라지는 경우를 **성공으로 보고하지 않기** 위해서다.
     */
    const readBack = libraryStorage.read()
    const verified =
      readBack.outcome === 'stored' &&
      canonicalLibrary(readBack.value) ===
        canonicalLibrary({ playlists: items.value, selectedPlaylistId: selectedId.value })

    return { ok: true, persisted: true, writeFailure: null, verified }
  }

  /**
   * 최초 실행일 때만 기본 플레이리스트를 만든다.
   *
   * **`restore()` 와 분리된 별도 액션이다.** 복원이 저장소를 건드리지 않는다는
   * 보장을 지키기 위해서다. 앱 시작 시 `restore()` 다음에 명시적으로 부른다.
   *
   * 다음을 **모두** 만족할 때만 만든다.
   * - `restoreOutcome === 'empty'` — 저장된 값이 **아예 없었다.**
   *   `'stored'` 인데 목록이 비어 있는 경우는 사용자가 전부 지운 것이므로
   *   최초 실행이 아니다. 여기서 기본 목록을 만들면 사용자의 의사를 뒤집는다.
   * - `status === 'ready'` — `protected` / `unavailable` 에서는 만들지 않는다.
   *   원본을 읽지 못한 상태에서 기본값을 쓰면 원본을 덮어쓸 수 있다.
   * - 목록이 비어 있다.
   *
   * @returns 만들었으면 생성 결과, 아니면 `null`.
   */
  function seedFirstRunPlaylist(name: string): LibraryMutationResult | null {
    if (restoreOutcome.value !== 'empty') return null
    if (status.value !== 'ready') return null
    if (items.value.length > 0) return null

    return createPlaylist(name)
  }

  /** 존재하는 플레이리스트만 선택한다. 트랙과 재생 상태는 건드리지 않는다. */
  function selectPlaylist(id: string): LibraryMutationResult {
    const stale = staleGuard()
    if (stale !== null) return stale

    if (getPlaylist(id) === undefined) return failure('not-found')

    selectedId.value = id
    return success(id)
  }

  /**
   * 다른 탭의 저장을 듣는다 (M10-3, ADR 0024). 끊는 함수를 돌려준다.
   *
   * `storage` 이벤트는 **다른** 탭이 쓸 때만 온다. 라이브러리 키(또는 전체 비우기,
   * `key === null`)가 바뀌었고 원문이 기준과 다르면 다시 읽는다. 쓰기 직전 비교
   * (`persist`)가 진짜 방어이고, 이것은 화면을 최신으로 맞추는 일이다 — 이벤트가
   * 늦게 오거나 오지 않아도 낡은 쓰기는 막힌다.
   */
  function watchExternalChanges(
    target: StorageEventTarget = globalThis as unknown as StorageEventTarget,
  ): () => void {
    const onStorage = (event: StorageEvent): void => {
      if (event.key !== null && event.key !== libraryStorage.key) return
      if (status.value === 'unavailable' || !libraryStorage.available()) return
      if (libraryStorage.raw() === baselineRaw) return
      reload()
    }
    target.addEventListener('storage', onStorage)
    return () => target.removeEventListener('storage', onStorage)
  }

  return {
    // 상태 — 읽기 전용으로 노출한다. 변경은 액션으로만 한다.
    playlists: readonly(items),
    selectedPlaylistId: readonly(selectedId),
    status: readonly(status),
    protectedReason: readonly(protectedReason),
    restoreOutcome: readonly(restoreOutcome),
    lastWriteFailure: readonly(lastWriteFailure),
    externalChange: readonly(externalChange),

    // 파생
    canPersist,
    selectedPlaylist,

    // 조회
    getPlaylist,

    // 액션
    restore,
    reload,
    watchExternalChanges,
    seedFirstRunPlaylist,
    createPlaylist,
    renamePlaylist,
    deletePlaylist,
    selectPlaylist,
    addTrack,
    removeTrack,
    moveTrack,
    renameTrack,

    // ⚠ 보호 우회. 백업 가져오기 경로에서만 부른다 (ADR 0007 · 0018).
    replaceAll,
  }
})
