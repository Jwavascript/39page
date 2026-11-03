/**
 * 트랜스포트 UI 가 쓰는 뷰 모델 (M3-3).
 *
 * `playback` store 를 **읽기만** 하고, 명령은 주입된 Playback Coordinator 에
 * 넘긴다. 여기서 `PlayerAdapter` 나 YouTube API 를 부르지 않는다
 * (`AGENTS.md` 규칙 4, ADR 0009).
 *
 * 표현은 컴포넌트가, 로직은 이 composable 이 맡는다 (`AGENTS.md` 규칙 3).
 */
import { computed, inject, type ComputedRef } from 'vue'

import type { PlayerState } from '@/shared/types'
import { youtubeWatchUrl } from '@/shared/utils/youtube'
import { usePlaybackStore } from '@/stores/playback'

import { PLAYBACK_COORDINATOR } from './playbackCoordinator'

/**
 * 재생 상태를 사람이 읽는 말로.
 *
 * **이 값은 라이브 리전에 넣지 않는다.** `NOW PLAYING` 부제에 적는다.
 * 라이브 리전에 넣으면 상태가 바뀔 때마다 보조기기가 읽어 시끄러워진다.
 */
const STATE_LABEL: Readonly<Record<PlayerState, string>> = {
  idle: '대기 중',
  loading: '불러오는 중',
  playing: '재생 중',
  paused: '일시정지',
  ended: '재생 완료',
  error: '재생 실패',
}

/** 승인된 디자인의 초기 문구들. */
const EMPTY_TITLE = '재생할 음악을 선택하세요'
const EMPTY_SUBTITLE = 'LP를 클릭하거나 링크를 추가할 수 있어요.'
const EMPTY_QUEUE_STATUS = '재생 목록을 만들고 YouTube 링크를 추가해 보세요.'

export interface TransportModel {
  /** `NOW PLAYING` 아래 큰 제목. */
  title: ComputedRef<string>
  /** 큐 위치와 상태. 예: `2 / 5 · YOUTUBE · 재생 중` */
  subtitle: ComputedRef<string>

  /**
   * 라이브 리전에 넣을 문구.
   *
   * 의도적으로 띄운 안내(`playback.statusMessage`)만 담는다. 큐가 아직
   * 없을 때만 승인된 기본 문구를 쓰고, 재생 중에는 **비운다.**
   */
  statusText: ComputedRef<string>
  /** 경고 어조인지. `.status.warning` 에 대응한다. */
  isWarning: ComputedRef<boolean>

  /** 토글 버튼이 ⏸ 를 보여줄지 (`false` 면 ▶). */
  showsPause: ComputedRef<boolean>
  /** 토글 버튼의 접근성 이름. 보이는 기호와 뜻이 같아야 한다. */
  toggleLabel: ComputedRef<string>

  canToggle: ComputedRef<boolean>
  canPrevious: ComputedRef<boolean>
  canNext: ComputedRef<boolean>

  /**
   * `YOUTUBE에서 열기 ↗` 주소 (M3-5). 현재 트랙이 없으면 `null` 이다.
   *
   * 승인된 디자인처럼 **오류일 때만 띄우지 않는다.** 곡을 고른 뒤에는 항상
   * 보인다 — 재생이 되는 영상도 YouTube 에서 열어볼 이유가 있고, 재생이
   * 깨진 순간에 링크가 "새로 나타나는" 것보다 이미 있는 편이 낫다.
   */
  youtubeUrl: ComputedRef<string | null>

  /** 영상이 아직 없어 안내를 띄울지. 어댑터 소유 영역 **밖**에 그린다. */
  showsPlaceholder: ComputedRef<boolean>

  toggle(): void
  previous(): void
  next(): void
}

export function useTransport(): TransportModel {
  const playback = usePlaybackStore()

  /**
   * 주입되지 않으면 명령이 아무 데도 가지 않는다. 컴포넌트를 단독으로
   * 마운트하는 테스트를 위한 기본값이다.
   */
  const coordinator = inject(PLAYBACK_COORDINATOR, null)

  const title = computed<string>(() => playback.currentTrack?.title ?? EMPTY_TITLE)

  const subtitle = computed<string>(() => {
    if (playback.currentTrack === null) return EMPTY_SUBTITLE

    const position = `${String(playback.queueIndex + 1)} / ${String(playback.queue.length)}`
    return `${position} · YOUTUBE · ${STATE_LABEL[playback.playerState]}`
  })

  const statusText = computed<string>(() => {
    if (playback.statusMessage !== '') return playback.statusMessage
    // 재생 중에는 비운다. 상태를 여기에 적으면 바뀔 때마다 읽힌다.
    return playback.currentTrack === null ? EMPTY_QUEUE_STATUS : ''
  })

  const isWarning = computed<boolean>(
    () => playback.statusMessage !== '' && playback.statusTone === 'warning',
  )

  /**
   * `loading` 도 ⏸ 다.
   *
   * 사용자가 방금 재생을 눌러 플레이어가 올라오는 중이다. ▶ 를 보여주면
   * 또 누르게 되고 그 누름은 아무 일도 하지 않는다. ⏸ 를 보여주면 **시작을
   * 취소**할 수 있다 — 어댑터의 `pause()` 가 보류한 재생 요청을 지운다.
   */
  const showsPause = computed<boolean>(
    () => playback.playerState === 'playing' || playback.playerState === 'loading',
  )

  const toggleLabel = computed<string>(() => (showsPause.value ? '일시정지' : '재생'))

  const youtubeUrl = computed<string | null>(() => {
    const videoId = playback.currentTrack?.videoId
    return videoId === undefined ? null : youtubeWatchUrl(videoId)
  })

  /*
   * 트랙을 고르는 순간 iframe 이 들어선다. 그 전까지만 안내를 보여준다.
   * 재생이 실패해도 영상 영역에는 YouTube 의 오류 화면이 남으므로 안내를
   * 다시 덮지 않는다 — 승인된 프로토타입도 한 번 숨기면 다시 띄우지 않는다.
   */
  const showsPlaceholder = computed<boolean>(() => playback.currentTrack === null)

  const canToggle = computed<boolean>(() => playback.currentTrack !== null)
  const canPrevious = computed<boolean>(() => playback.queueIndex > 0)
  const canNext = computed<boolean>(
    () => playback.queueIndex >= 0 && playback.queueIndex < playback.queue.length - 1,
  )

  /*
   * 경계에서 한 번 더 막는다. 버튼은 이미 비활성이지만, 비활성 표시와
   * 실제 동작이 **따로 놀지 않게** 한다. 코디네이터도 큐 범위를 지킨다.
   */
  function toggle(): void {
    if (!canToggle.value) return
    coordinator?.togglePlay()
  }

  function previous(): void {
    if (!canPrevious.value) return
    coordinator?.previous()
  }

  function next(): void {
    if (!canNext.value) return
    coordinator?.next()
  }

  return {
    title,
    subtitle,
    statusText,
    isWarning,
    showsPause,
    toggleLabel,
    canToggle,
    canPrevious,
    canNext,
    youtubeUrl,
    showsPlaceholder,
    toggle,
    previous,
    next,
  }
}
