/**
 * 데크에 그려진 ▶ / ■ 를 실제 동작으로 잇는 뷰 모델 (M6-6).
 *
 * 실기기 검증에서 두 번 보고된 문제를 푼다 — LP·카세트 아트의 재생·정지
 * 표시가 **그림일 뿐 눌러도 아무 일도 하지 않았다** (`M6_PLAN.md` §5-a).
 * 누를 수 있어 보이는 것이 동작하지 않는 것은 그 자체로 결함이다.
 *
 * `playback` store 를 **읽기만** 하고, 명령은 주입된 Playback Coordinator 에
 * 넘긴다. `PlayerAdapter` 도 YouTube API 도 부르지 않는다 (`AGENTS.md` 규칙 4).
 * 표현은 컴포넌트가, 판단은 여기가 맡는다 (규칙 3).
 *
 * `useTransport` 와 왜 따로 있는가: 플레이어의 트랜스포트는 **큐가 이미 있을
 * 때**의 조작이다 (`canToggle = currentTrack !== null`). 데크의 ▶ 는 그보다
 * 앞선 자리에 있다 — 아직 아무것도 고르지 않은 상태에서 눌리는 첫 버튼이다.
 * 그래서 큐가 없으면 **선택된 플레이리스트를 처음부터** 재생한다. 이것이
 * 세로 화면에서 드로어를 열지 않고도 음악을 시작할 수 있는 경로다 (보고 5번).
 *
 * 두 store 를 함께 보지만 서로 잇지는 않는다. 라이브러리에서는 **선택된
 * 목록의 id** 만 읽고, 큐를 만드는 일은 코디네이터가 한다
 * (`SYSTEM_DESIGN.md` §6.1).
 */
import { computed, inject, ref, type ComputedRef } from 'vue'

import { usePlaybackStore } from '@/stores/playback'
import { useLibraryStore } from '@/stores/library'
import { LIBRARY_DRAWER } from '@/features/library/drawerController'

import {
  PLAYBACK_COORDINATOR,
  PLAY_REFUSED_HIDDEN_MESSAGE,
  type PlayRequestFailure,
  type PlayRequestResult,
} from '../playback/playbackCoordinator'

/**
 * 재생 요청이 거절됐을 때 데크 옆에 띄울 문구.
 *
 * `player-hidden` 문구는 드로어·플레이리스트 위젯과 **공유한다** (M7-1).
 * 세로 시트가 플레이어를 덮으면 플레이어의 `.status` 도 함께 덮이므로, 누른
 * 자리에서 말해야 읽힌다.
 */
const REFUSED_MESSAGE: Record<PlayRequestFailure, string> = {
  'empty-playlist': '이 목록에 아직 레코드가 없어요. 레코드를 먼저 추가해주세요.',
  'playlist-not-found': '재생할 목록을 먼저 선택해주세요.',
  'track-not-found': '재생할 트랙을 찾을 수 없어요.',
  'player-hidden': PLAY_REFUSED_HIDDEN_MESSAGE,
}

export interface DeckTransportModel {
  /**
   * ▶ 의 접근성 이름.
   *
   * 보이는 그림은 레퍼런스가 정한 `▶ PLAY` 로 고정이지만, 실제 동작은 상태에
   * 따라 **이어서 재생**이거나 **목록 처음부터 재생**이다. 보조기기에는 그
   * 차이를 말해준다.
   */
  playLabel: ComputedRef<string>

  /**
   * ■ 의 접근성 이름.
   *
   * 레퍼런스의 글자는 `STOP` 이지만 실제 동작은 **일시정지**다. 재생 위치를
   * 버리지 않는다. 그림의 글자는 바꿀 수 없으므로(규칙 6) 접근성 이름이
   * 사실을 말한다.
   */
  pauseLabel: ComputedRef<string>

  /** Mono Vinyl 의 `START / STOP` 하나짜리 키에 쓸 이름. */
  toggleLabel: ComputedRef<string>

  /** 거절 사유 안내. 비어 있으면 띄우지 않는다. */
  notice: ComputedRef<string>

  /** ▶ — 멈춰 있으면 이어서, 큐가 없으면 선택된 목록을 처음부터. */
  play(): void

  /** ■ — 소리가 날 때만 멈춘다. 멈춰 있으면 아무 일도 하지 않는다. */
  pause(): void

  /** 하나짜리 키용. 소리가 나면 멈추고, 아니면 `play()` 와 같다. */
  toggle(): void
}

export function useDeckTransport(): DeckTransportModel {
  const playback = usePlaybackStore()
  const library = useLibraryStore()

  /**
   * 주입되지 않으면 명령이 아무 데도 가지 않는다. 데크를 단독으로 마운트하는
   * 테스트를 위한 기본값이다 (`useTransport` 와 같은 이유).
   */
  const coordinator = inject(PLAYBACK_COORDINATOR, null)

  /**
   * 재생 전에 레코드 시트를 비켜달라고 부탁하는 통로 (M7-2).
   *
   * 계약 파일만 가져온다. 세로 화면에서 시트가 플레이어를 덮고 있으면 데크의
   * ▶ 도 거절되므로, 세 표면이 모두 같은 길을 쓴다.
   */
  const drawer = inject(LIBRARY_DRAWER, null)

  const refusal = ref('')
  const notice = computed<string>(() => refusal.value)

  /** `loading` 도 포함한다 — 버퍼링 중에 ■ 를 누르면 시작을 취소해야 한다. */
  const isSounding = computed<boolean>(
    () => playback.playerState === 'playing' || playback.playerState === 'loading',
  )

  /** 큐가 이미 있으면 그 자리에서 이어서 재생한다. */
  const hasQueue = computed<boolean>(() => playback.currentTrack !== null)

  const playLabel = computed<string>(() =>
    hasQueue.value ? '재생' : '선택한 목록을 처음부터 재생',
  )
  const pauseLabel = computed<string>(() => '일시정지')
  const toggleLabel = computed<string>(() => (isSounding.value ? '일시정지' : playLabel.value))

  /** 결과를 안내로 옮긴다. 성공이면 지운다. */
  function report(result: PlayRequestResult | undefined): void {
    refusal.value = result === undefined || result.ok ? '' : REFUSED_MESSAGE[result.reason]
  }

  function play(): void {
    refusal.value = ''

    const selectedId = library.selectedPlaylistId
    if (!hasQueue.value && selectedId === null) {
      refusal.value = REFUSED_MESSAGE['playlist-not-found']
      return
    }

    void (async () => {
      // 시트가 플레이어를 덮고 있으면 먼저 비켜준다 (M7-2).
      await drawer?.stepAside()

      // 큐가 있으면 트랜스포트와 같은 동작이다. 가시성 판단은 코디네이터가 한다.
      if (hasQueue.value) {
        coordinator?.togglePlay()
        return
      }
      if (selectedId === null) return

      report(coordinator?.playPlaylist(selectedId))
    })()
  }

  function pause(): void {
    refusal.value = ''
    // 멈춰 있을 때 누르면 `togglePlay()` 가 **재생을 시작한다.** ■ 가 재생을
    // 시작하면 그림과 동작이 어긋나므로 소리가 날 때만 보낸다.
    if (!isSounding.value) return

    coordinator?.togglePlay()
  }

  function toggle(): void {
    if (isSounding.value) {
      pause()
      return
    }
    play()
  }

  return {
    playLabel,
    pauseLabel,
    toggleLabel,
    notice,
    play,
    pause,
    toggle,
  }
}
