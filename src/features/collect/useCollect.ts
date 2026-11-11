/**
 * 수집 화면의 상태 (M10-3B, ADR 0023).
 *
 * - 조각을 계약 v1 로 검증한다. 통과해도 **저장하지 않는다.**
 * - 사용자가 플레이리스트를 고르고 "추가" 를 누를 때만 라이브러리 store 의 공식
 *   API(`addTrack`)를 부른다. `localStorage` 를 직접 만지지 않는다.
 * - 저장 결과(성공 · 저장 실패 · 다른 탭 충돌 · 목록 없음)를 그대로 화면 상태로
 *   옮긴다. 저장되지 않았는데 성공으로 보이게 하지 않는다.
 * - 저장은 탭 간 잠금 안에서 끝난다 (ADR 0025). 끝나기 전에는 `saving` 이고, 그동안
 *   다시 누를 수 없다. 성공 안내는 저장이 끝난 뒤에만 나온다.
 * - 같은 플레이리스트에 같은 영상이 있으면 알린다. 막지는 않는다 — 같은 영상을
 *   여러 번 넣는 것은 라이브러리의 기존 허용 동작이다 (`addTrack`).
 */
import { computed, readonly, ref, watch, type ComputedRef, type Ref } from 'vue'

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
  /** 다른 탭이 저장하는 중이라 잠금을 얻지 못했다 (ADR 0025). 아무것도 바꾸지 않았다. */
  | 'busy'
  /** 계약을 통과한 ID 를 라이브러리가 거절했다 — 일어나면 안 되는 경로. */
  | 'invalid-video-id'
  /**
   * 저장했던 곡이 목록에서 없어졌다 (M10-3C) — 다른 탭에서 지웠거나, 거의 같은
   * 순간 다른 탭의 저장에 덮였다. 다시 추가할 수 있게 되돌린다.
   */
  | 'lost'

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
  /** 저장 중 — 잠금을 기다리거나 쓰는 중이다. */
  readonly saving: Readonly<Ref<boolean>>
  readonly canAdd: ComputedRef<boolean>
  /** 저장이 끝나면(성공 · 실패 모두) 이행한다. */
  add(): Promise<void>
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
  const saving = ref(false)
  const saved = ref<{ playlistName: string; trackTitle: string; trackId: string } | null>(null)

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

  /*
   * 저장한 곡이 아직 있는지 지켜본다 (M10-3C). 두 탭이 거의 같은 순간(실측 8–19ms
   * 안) 저장하면 이 탭의 곡이 다른 탭의 저장에 덮일 수 있다 (ADR 0024 "한계").
   * 그때 "추가했습니다" 를 남겨 두지 않고 되돌린다.
   */
  watch(
    () => library.playlists,
    () => {
      const current = saved.value
      if (current === null) return
      const present = library.playlists.some((playlist) =>
        playlist.tracks.some((track) => track.id === current.trackId),
      )
      if (!present) {
        saved.value = null
        failure.value = 'lost'
      }
    },
  )

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
    if (saved.value !== null) {
      return {
        kind: 'saved',
        playlistName: saved.value.playlistName,
        trackTitle: saved.value.trackTitle,
      }
    }
    if (library.status !== 'ready') return { kind: 'blocked', status: library.status }
    return { kind: 'choosing', failure: failure.value }
  })

  const canAdd = computed<boolean>(
    () => phase.value.kind === 'choosing' && selectedId.value !== null && !saving.value,
  )

  async function add(): Promise<void> {
    // 한 번만 — 저장 중에 다시 눌러도, 저장 뒤 다시 눌러도 한 곡만 들어간다.
    if (!canAdd.value || request === null || selectedId.value === null) return

    const target = selectedId.value
    saving.value = true
    let result
    try {
      result = await library.addTrack(target, {
        videoId: request.videoId,
        title: request.title ?? undefined,
      })
    } finally {
      saving.value = false
    }

    if (!result.ok) {
      // 다른 탭 충돌이면 store 가 최신을 이미 다시 읽었다 — 목록이 바뀌어 보인다.
      failure.value =
        result.reason === 'conflict' ||
        result.reason === 'invalid-video-id' ||
        result.reason === 'busy'
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
    saved.value = {
      playlistName: playlist?.name ?? '',
      trackTitle: track?.title ?? '',
      trackId: result.trackId ?? '',
    }
    clearRequest()
  }

  return {
    request,
    phase,
    choices,
    selectedId,
    duplicatePositions,
    saving: readonly(saving),
    canAdd,
    add,
  }
}
