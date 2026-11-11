/**
 * 수집 화면의 상태 (M10-3B, ADR 0023).
 *
 * - 조각을 계약 v1 로 검증한다. 통과해도 **저장하지 않는다.**
 * - 사용자가 플레이리스트를 고르고 "추가" 를 누를 때만 라이브러리 store 의 공식
 *   API(`addTrack`)를 부른다. `localStorage` 를 직접 만지지 않는다.
 * - 저장 결과(성공 · 저장 실패 · 다른 탭 충돌 · 목록 없음)를 그대로 화면 상태로
 *   옮긴다. 저장되지 않았는데 성공으로 보이게 하지 않는다.
 * - 같은 플레이리스트에 같은 영상이 있으면 알린다. 막지는 않는다 — 같은 영상을
 *   여러 번 넣는 것은 라이브러리의 기존 허용 동작이다 (`addTrack`).
 */
import { computed, ref, watch, type ComputedRef, type Ref } from 'vue'

import { useLibraryStore } from '@/stores/library'

import {
  parseCollectRequest,
  type CollectRejectReason,
  type CollectTrackRequest,
} from './collectRequest'

export type CollectFailure =
  /** 다른 탭이 먼저 바꿨다. 최신 목록을 다시 읽었다. */
  | 'conflict'
  /** 고른 목록이 없어졌다 (다른 탭에서 삭제). */
  | 'not-found'
  /** 저장소에 쓰지 못했다 (용량 부족 등). 라이브러리는 바뀌지 않았다. */
  | 'write-failed'
  /** 계약을 통과한 ID 를 라이브러리가 거절했다 — 일어나면 안 되는 경로. */
  | 'invalid-video-id'

export type CollectPhase =
  /** 요청을 열 수 없다. 아무것도 하지 않는다. */
  | { readonly kind: 'rejected'; readonly reason: CollectRejectReason }
  /** 라이브러리가 보호·사용 불가 상태라 저장할 수 없다 (ADR 0007). */
  | { readonly kind: 'blocked'; readonly status: 'protected' | 'unavailable' }
  /** 고르는 중. */
  | { readonly kind: 'choosing'; readonly failure: CollectFailure | null }
  /** 저장했다. */
  | { readonly kind: 'saved'; readonly playlistName: string; readonly trackTitle: string }

export interface PlaylistChoice {
  readonly id: string
  readonly name: string
  readonly trackCount: number
}

export interface CollectState {
  readonly request: CollectTrackRequest | null
  readonly phase: ComputedRef<CollectPhase>
  readonly choices: ComputedRef<PlaylistChoice[]>
  readonly selectedId: Ref<string | null>
  /** 고른 목록에 이 영상이 이미 몇 번째에 있는지 (1부터). 없으면 빈 배열. */
  readonly duplicatePositions: ComputedRef<number[]>
  readonly canAdd: ComputedRef<boolean>
  add(): void
}

export interface CollectOptions {
  /** 성공 뒤 주소 조각을 지운다 — 새로고침이 같은 요청을 다시 묻지 않게. */
  readonly clearRequest?: () => void
}

function clearHashFromAddressBar(): void {
  const { pathname, search } = globalThis.location
  globalThis.history.replaceState(globalThis.history.state, '', `${pathname}${search}`)
}

export function useCollect(hash: string, options: CollectOptions = {}): CollectState {
  const library = useLibraryStore()
  const clearRequest = options.clearRequest ?? clearHashFromAddressBar

  const parsed = parseCollectRequest(hash)
  const request = parsed.ok ? parsed.request : null

  const failure = ref<CollectFailure | null>(null)
  const saved = ref<{ playlistName: string; trackTitle: string } | null>(null)

  const choices = computed<PlaylistChoice[]>(() =>
    library.playlists.map((playlist) => ({
      id: playlist.id,
      name: playlist.name,
      trackCount: playlist.tracks.length,
    })),
  )

  /** 대시보드에서 고른 목록이 있으면 그것, 없으면 첫 목록. */
  function defaultSelection(): string | null {
    const current = library.selectedPlaylistId
    if (current !== null && choices.value.some((choice) => choice.id === current)) return current
    return choices.value[0]?.id ?? null
  }

  // 수집 화면에서의 선택은 이 화면의 상태다 — 라이브러리의 선택(저장되는 값)을 바꾸지 않는다.
  const selectedId = ref<string | null>(defaultSelection())

  // 다른 탭에서 목록이 지워지면 고른 것을 다시 맞춘다.
  watch(choices, () => {
    if (!choices.value.some((choice) => choice.id === selectedId.value)) {
      selectedId.value = defaultSelection()
    }
  })

  const duplicatePositions = computed<number[]>(() => {
    if (request === null) return []
    const playlist = library.playlists.find((item) => item.id === selectedId.value)
    if (playlist === undefined) return []
    return playlist.tracks.flatMap((track, index) =>
      track.videoId === request.videoId ? [index + 1] : [],
    )
  })

  const phase = computed<CollectPhase>(() => {
    if (!parsed.ok) return { kind: 'rejected', reason: parsed.reason }
    if (saved.value !== null) return { kind: 'saved', ...saved.value }
    if (library.status !== 'ready') return { kind: 'blocked', status: library.status }
    return { kind: 'choosing', failure: failure.value }
  })

  const canAdd = computed<boolean>(
    () => phase.value.kind === 'choosing' && selectedId.value !== null,
  )

  function add(): void {
    // 한 번만 — 저장 뒤 다시 눌러도, 연속으로 눌러도 한 곡만 들어간다.
    if (!canAdd.value || request === null || selectedId.value === null) return

    const target = selectedId.value
    const result = library.addTrack(target, {
      videoId: request.videoId,
      title: request.title ?? undefined,
    })

    if (!result.ok) {
      // 다른 탭 충돌이면 store 가 최신을 이미 다시 읽었다 — 목록이 바뀌어 보인다.
      failure.value =
        result.reason === 'conflict' || result.reason === 'invalid-video-id'
          ? result.reason
          : 'not-found'
      return
    }

    if (!result.persisted) {
      // 메모리에만 들어갔다. 저장소의 상태로 되돌려 다시 시도가 두 곡을 넣지 않게 한다.
      library.reload()
      failure.value = 'write-failed'
      return
    }

    const playlist = library.getPlaylist(target)
    const track = playlist?.tracks.find((item) => item.id === result.trackId)
    failure.value = null
    saved.value = { playlistName: playlist?.name ?? '', trackTitle: track?.title ?? '' }
    clearRequest()
  }

  return { request, phase, choices, selectedId, duplicatePositions, canAdd, add }
}
