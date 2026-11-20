/**
 * NOW PLAYLIST 위젯의 판단 (M11-7B, ADR 0030 · ADR 0038).
 *
 * 위젯이 보여 주는 것은 둘 중 하나다 — **섞지 않는다.**
 *
 * | 보기      | 언제                                              | 무엇                                   |
 * | --------- | ------------------------------------------------- | -------------------------------------- |
 * | `queue`   | 재생 큐가 있다                                    | 큐 — 실제 재생 순서 · 지금 곡          |
 * | `standby` | 큐가 없다, 또는 고른 목록을 **재생하지 못했다**   | 보관함에서 고른 목록 — "재생 대기"     |
 * | `none`    | 큐도 고른 목록도 없다                             | 빈 상태 안내                           |
 *
 * - "고른 목록"(`library.selectedPlaylistId`)과 "재생 큐"(`coordinator.queue`)는 다른 상태다. 다만 재생 중에
 *   **"목록 바꾸기" 로 고르면 그 목록을 바로 처음부터 재생한다** (ADR 0038 — M11-7B 의 "고르기만 해서는
 *   재생이 바뀌지 않는다" 를 대체). 빈 목록이거나 영상이 가려져 재생하지 못하면 그 목록을 "재생 대기" 로 보인다.
 * - 큐는 출처 목록을 따라간다 — 곡 추가 · 삭제 · 순서 변경에 안내를 띄우지 않는다 (ADR 0038).
 * - 큐의 출처는 코디네이터가 준다. 모르면(`unknown`) 목록 이름을 지어내지 않고 "현재 재생 큐" 라 한다.
 * - 재생은 **요청만** 한다. playback store 를 보지 않는다 (ADR 0009) — 코디네이터 계약만 안다.
 * - 저장하는 것은 "고른 목록" 하나뿐이고(기존 `selectPlaylist`) 새 저장 상태를 만들지 않는다.
 */
import { computed, inject, ref, watch, type ComputedRef, type Ref } from 'vue'

import { ARCHIVE } from '@/features/archive/archiveController'
import { LIBRARY_BUSY_MESSAGE, LIBRARY_CONFLICT_MESSAGE } from '@/features/library/libraryFeedback'
import {
  PLAYBACK_COORDINATOR,
  PLAY_REFUSED_HIDDEN_MESSAGE,
  REPEAT_LABEL,
  type PlayRequestFailure,
  type PlayRequestResult,
  type QueueSourceState,
} from '@/features/playback/playbackCoordinator'
import type { Playlist, Track } from '@/shared/types'
import { useLibraryStore } from '@/stores/library'

/** 출처를 모르는 큐의 이름. 목록 이름을 추정하지 않는다. */
export const UNKNOWN_QUEUE_LABEL = '현재 재생 큐'

export type NowPlaylistView = 'queue' | 'standby' | 'none'

/** 좁은 화면에서 접혀 있을 때 보이는 줄 수 (지금 곡 주변). */
export const COLLAPSED_ROW_COUNT = 5

export interface NowPlaylistRow {
  /** 큐 보기에서는 큐 안의 자리, 대기 보기에서는 목록 안의 자리. */
  readonly index: number
  readonly track: Track
  readonly isCurrent: boolean
  /** 접힌 상태(좁은 화면)에서도 보이는 줄인지. */
  readonly inWindow: boolean
}

export interface PlaylistChoice {
  readonly id: string
  readonly name: string
  readonly trackCount: number
  /** 지금 재생 큐의 출처인지. */
  readonly isPlaying: boolean
  /** 보관함에서 고른 목록인지. */
  readonly isSelected: boolean
}

export interface NowPlaylistModel {
  readonly view: ComputedRef<NowPlaylistView>
  /** 머리말의 이름 — 큐 보기: 출처 목록 이름(모르면 중립 라벨), 대기 보기: 고른 목록 이름. */
  readonly name: ComputedRef<string>
  /** 큐 보기에서 실제로 소리가 나는 중인지 (일시정지 · 적재 중이면 `false`). */
  readonly isSounding: ComputedRef<boolean>
  readonly rows: ComputedRef<readonly NowPlaylistRow[]>
  readonly trackCount: ComputedRef<number>
  /** 큐 보기에서 지금 곡의 자리 (1 부터). 대기 보기에서는 `null`. */
  readonly position: ComputedRef<number | null>
  readonly sourceState: ComputedRef<QueueSourceState | null>
  /** 큐 보기에서, 보관함에서 고른 목록이 큐의 출처와 다를 때 그 이름. 같거나 없으면 `null`. */
  readonly otherSelectedName: ComputedRef<string | null>
  /** 대기 보기에서, 따로 재생 중인 큐의 이름. 큐가 없으면 `null`. 안내 상자 없이 부제에 짧게 적는다. */
  readonly playingElsewhereName: ComputedRef<string | null>
  /** 큐 보기에서 셔플 · 반복이 켜져 있으면 그 이름들 (예: `셔플 · 전체 반복`). 모두 꺼져 있으면 `null`. */
  readonly modesText: ComputedRef<string | null>
  /** "목록 바꾸기" 로 고르면 바로 재생하는가 — 재생 큐가 있을 때다. 펼친 목록의 안내 문구가 이것을 따른다. */
  readonly pickPlays: ComputedRef<boolean>
  readonly choices: ComputedRef<readonly PlaylistChoice[]>
  readonly isPickerOpen: Ref<boolean>
  readonly isExpanded: Ref<boolean>
  readonly notice: Ref<string>

  playRow(row: NowPlaylistRow): void
  playStandbyFromStart(): void
  togglePicker(): void
  /**
   * 그 목록을 고른다 (고른 목록을 바꾼다). 재생 큐가 있으면 **그 목록을 처음부터 바로 재생**한다 —
   * 재생 중인 목록을 고르면 그 큐를 보인다. 큐가 없으면 "재생 대기" 로 보일 뿐이다.
   */
  pick(id: string): Promise<void>
  /** 보관함 음악 탭에서 지금 보이는 목록을 편집한다. */
  openInArchive(): Promise<void>
  /** 고른 목록의 링크 추가로 바로 간다 (빈 목록). */
  addLink(): void
  openArchive(): void
}

const REFUSED_MESSAGE: Readonly<Record<PlayRequestFailure, string>> = {
  'empty-playlist': '이 목록에 아직 곡이 없어요.',
  'playlist-not-found': '대상을 찾을 수 없습니다.',
  'track-not-found': '대상을 찾을 수 없습니다.',
  'player-hidden': PLAY_REFUSED_HIDDEN_MESSAGE,
}

/** 접힌 상태에서 보일 창 — 지금 곡이 둘째 줄쯤에 오게, 끝에서는 뒤로 당긴다. */
function windowStart(count: number, current: number): number {
  if (count <= COLLAPSED_ROW_COUNT) return 0
  const start = Math.max(0, current - 1)
  return Math.min(start, count - COLLAPSED_ROW_COUNT)
}

export function useNowPlaylist(): NowPlaylistModel {
  const library = useLibraryStore()
  const coordinator = inject(PLAYBACK_COORDINATOR, null)
  const archive = inject(ARCHIVE, null)

  const queue = computed(() => coordinator?.queue.value ?? null)

  /**
   * 큐가 있는데도 **고른 다른 목록을 보이는 중인지.** "목록 바꾸기" 로 고른 목록을 재생하지 못했을 때(빈 목록 ·
   * 영상이 가려짐) 켜지고, 새 큐가 시작되거나 재생 중인 목록을 다시 고르면 꺼진다. 저장하지 않는다.
   */
  const isBrowsing = ref(false)
  const isPickerOpen = ref(false)
  const isExpanded = ref(false)
  const notice = ref('')

  // 큐가 새로 떠지면(재생 시작 · 다시 뜨기) 큐 보기로 돌아온다. 큐가 사라지면 볼 큐가 없다.
  watch(
    () => queue.value?.tracks,
    () => {
      isBrowsing.value = false
    },
  )

  const selected = computed<Playlist | null>(() => library.selectedPlaylist)

  const view = computed<NowPlaylistView>(() => {
    if (queue.value !== null && !isBrowsing.value) return 'queue'
    if (selected.value !== null) return 'standby'
    return queue.value !== null ? 'queue' : 'none'
  })

  const queueName = computed<string>(() => queue.value?.source?.name ?? UNKNOWN_QUEUE_LABEL)

  const name = computed<string>(() =>
    view.value === 'queue' ? queueName.value : (selected.value?.name ?? ''),
  )

  const isSounding = computed<boolean>(() => coordinator?.nowPlaying.value?.playing ?? false)

  const rows = computed<readonly NowPlaylistRow[]>(() => {
    const current = view.value === 'queue' ? (queue.value?.index ?? 0) : 0
    const tracks =
      view.value === 'queue' ? (queue.value?.tracks ?? []) : (selected.value?.tracks ?? [])
    const start = windowStart(tracks.length, current)
    return tracks.map((track, index) => ({
      index,
      track,
      isCurrent: view.value === 'queue' && index === current,
      inWindow: index >= start && index < start + COLLAPSED_ROW_COUNT,
    }))
  })

  const trackCount = computed<number>(() => rows.value.length)
  const position = computed<number | null>(() =>
    view.value === 'queue' && queue.value !== null ? queue.value.index + 1 : null,
  )
  const sourceState = computed<QueueSourceState | null>(() =>
    view.value === 'queue' ? (queue.value?.sourceState ?? null) : null,
  )

  const otherSelectedName = computed<string | null>(() => {
    if (view.value !== 'queue' || selected.value === null) return null
    return selected.value.id === queue.value?.source?.playlistId ? null : selected.value.name
  })

  const playingElsewhereName = computed<string | null>(() =>
    view.value === 'standby' && queue.value !== null ? queueName.value : null,
  )

  const modesText = computed<string | null>(() => {
    const modes = coordinator?.modes.value
    if (view.value !== 'queue' || modes === undefined) return null
    const parts = [
      ...(modes.shuffle ? ['셔플'] : []),
      ...(modes.repeat === 'off' ? [] : [REPEAT_LABEL[modes.repeat]]),
    ]
    return parts.length === 0 ? null : parts.join(' · ')
  })

  const pickPlays = computed<boolean>(() => queue.value !== null)

  const choices = computed<readonly PlaylistChoice[]>(() => {
    const playingId = queue.value?.source?.playlistId ?? null
    return library.playlists.map((playlist) => ({
      id: playlist.id,
      name: playlist.name,
      trackCount: playlist.tracks.length,
      isPlaying: playlist.id === playingId,
      isSelected: playlist.id === library.selectedPlaylistId,
    }))
  })

  function report(result: PlayRequestResult | undefined): void {
    notice.value = result === undefined || result.ok ? '' : REFUSED_MESSAGE[result.reason]
  }

  /** 재생 전에 보관함이 비켜 준 뒤 요청한다 (M7-2 의 순서 — 같은 틱이면 가림이 아직 남아 있다). */
  function request(play: () => PlayRequestResult | undefined): void {
    notice.value = ''
    void (async () => {
      await archive?.stepAside()
      report(play())
    })()
  }

  function playRow(row: NowPlaylistRow): void {
    if (view.value === 'queue') {
      request(() => coordinator?.playQueueIndex(row.index))
      return
    }
    const playlist = selected.value
    if (playlist === null) return
    // 대기 목록의 곡 — 그 목록이 새 큐가 된다. 트랙 id 로 고르므로 같은 영상이 여러 번 있어도 그 줄이다.
    request(() => coordinator?.playTrack(playlist.id, row.track.id))
  }

  function playStandbyFromStart(): void {
    const playlist = selected.value
    if (playlist === null) return
    request(() => coordinator?.playPlaylist(playlist.id))
  }

  function togglePicker(): void {
    isPickerOpen.value = !isPickerOpen.value
  }

  async function pick(id: string): Promise<void> {
    notice.value = ''
    if (id !== library.selectedPlaylistId) {
      const result = await library.selectPlaylist(id)
      if (!result.ok) {
        notice.value =
          result.reason === 'conflict'
            ? LIBRARY_CONFLICT_MESSAGE
            : result.reason === 'busy'
              ? LIBRARY_BUSY_MESSAGE
              : '대상을 찾을 수 없습니다.'
        return
      }
    }
    isPickerOpen.value = false
    isExpanded.value = false

    // 큐가 없으면 고른 목록을 "재생 대기" 로 보일 뿐이다 — 아무것도 재생하고 있지 않았다.
    // 재생 중인 목록을 다시 골랐으면 그 큐를 보인다 (처음부터 다시 틀지 않는다).
    const current = queue.value
    if (current === null || current.source?.playlistId === id) {
      isBrowsing.value = false
      return
    }

    // 재생 중에 다른 목록을 골랐다 — 그 목록을 처음부터 바로 재생한다 (ADR 0038). 빈 목록은 재생할 수 없으니
    // "재생 대기" 로 보인다 (링크 추가로 이어진다). 지금 재생은 그대로다.
    const playlist = library.getPlaylist(id)
    if (playlist === undefined || playlist.tracks.length === 0) {
      isBrowsing.value = true
      return
    }

    await archive?.stepAside()
    const result = coordinator?.playPlaylist(id)
    // 재생하지 못했으면(영상이 가려짐 등) 고른 목록을 "재생 대기" 로 보인다 — 곡을 누르면 다시 시도된다.
    if (result !== undefined && !result.ok) {
      isBrowsing.value = true
      notice.value = REFUSED_MESSAGE[result.reason]
    }
  }

  async function openInArchive(): Promise<void> {
    notice.value = ''
    // 큐를 보고 있으면 그 출처 목록을 골라서 연다 — "이 목록 편집" 이 다른 목록을 열지 않게.
    const sourceId = view.value === 'queue' ? queue.value?.source?.playlistId : undefined
    if (
      sourceId !== undefined &&
      sourceId !== library.selectedPlaylistId &&
      library.getPlaylist(sourceId) !== undefined
    ) {
      const result = await library.selectPlaylist(sourceId)
      if (!result.ok) {
        notice.value =
          result.reason === 'conflict' ? LIBRARY_CONFLICT_MESSAGE : LIBRARY_BUSY_MESSAGE
        return
      }
    }
    // 목록이 이미 정해졌다 — 좁은 화면에서도 목록 단계를 건너뛰고 그 목록의 곡으로 간다.
    archive?.open('music', { showDetail: true })
  }

  function addLink(): void {
    archive?.open('music', { addLink: true })
  }

  function openArchive(): void {
    archive?.open('music')
  }

  return {
    view,
    name,
    isSounding,
    rows,
    trackCount,
    position,
    sourceState,
    otherSelectedName,
    playingElsewhereName,
    modesText,
    pickPlays,
    choices,
    isPickerOpen,
    isExpanded,
    notice,
    playRow,
    playStandbyFromStart,
    togglePicker,
    pick,
    openInArchive,
    addLink,
    openArchive,
  }
}
