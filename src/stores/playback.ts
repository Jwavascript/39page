/**
 * 재생 상태.
 *
 * M1-5에서 데이터 구조와 기본 불변조건을 두었고, M3-2에서 큐 진행 액션
 * (`advance` / `back`)을 더했다. M9-4 에서 "지금 명령이 실제로 재생을
 * 시작했는가" (`hasStartedPlaying`) 를 코디네이터의 지역 변수에서 이리로
 * 옮겼다 — 화면이 그 사실을 **반응형으로** 알아야 Moment 저장 버튼을 켜고
 * 끌 수 있다.
 *
 * **이 store 는 어댑터를 부르지 않는다.** 재생 명령과 이벤트 반영은
 * `features/playback` 의 Playback Coordinator 가 한다 (ADR 0009).
 * 여기는 "무엇이 큐에 있고 지금 몇 번째인가" 만 안다.
 *
 * 경계 규칙:
 * - `theme` store를 import하지 않는다. `theme`도 이 store를 import하지 않는다.
 *   테마 전환이 재생 상태에 닿지 않는 것을 구조로 보장한다
 *   (`AGENTS.md` 규칙 4, 5).
 * - **어댑터 인스턴스나 DOM 노드를 state에 넣지 않는다.** Pinia가 프록시로
 *   감싸면 외부 플레이어와 DOM이 반응형 그래프에 끌려들어간다. 어댑터는
 *   `PlayerSurface`가 지역 변수로 보유한다.
 */
import { computed, ref } from 'vue'
import { defineStore } from 'pinia'

import type { PlayerState, Track } from '@/shared/types'

/** 상태 메시지의 어조. 승인된 디자인의 `.status` / `.status.warning`에 대응한다. */
export type StatusTone = 'info' | 'warning'

/** 큐가 비었을 때의 인덱스. */
export const NO_QUEUE_INDEX = -1

export const usePlaybackStore = defineStore('playback', () => {
  /** 현재 트랙. 없으면 `null`이다. */
  const currentTrack = ref<Track | null>(null)

  /**
   * 재생 대기열.
   *
   * 재생 시작 시점의 플레이리스트 **스냅샷**이다. 재생 중 라이브러리를
   * 편집해도 큐가 즉시 흔들리지 않는다 (`MVP_SPEC.md` F4). 스냅샷을 만드는
   * 연동은 M3이다.
   */
  const queue = ref<Track[]>([])

  /** 큐 안의 현재 위치. 큐가 비면 `NO_QUEUE_INDEX`다. */
  const queueIndex = ref<number>(NO_QUEUE_INDEX)

  /** 도메인 재생 상태. YouTube 숫자 상태값이 아니다. */
  const playerState = ref<PlayerState>('idle')

  /** 사용자에게 보여줄 상태·오류 메시지. */
  const statusMessage = ref<string>('')
  const statusTone = ref<StatusTone>('info')

  /**
   * 지금 트랙이 **마지막 재생 명령 이후** 실제로 재생을 시작했는지 (M3-2 · M9-4).
   *
   * 쓰는 곳은 Playback Coordinator 하나다 — 적재·시점 이동을 명령하면
   * `false`, 플레이어가 `playing` 을 알리면 `true`. 이 값이 두 가지를 막는다.
   *
   * - **늦게 도착한 `ENDED`** (M3-2). 재생된 적 없는 트랙은 끝날 수도 없다.
   *   사용자가 곡을 빠르게 바꾸면 직전 곡의 끝 신호가 새 곡을 건너뛰게 만든다.
   * - **전환 중의 가짜 위치** (M9-4). 새 영상을 적재하면 플레이어는 지정 시점
   *   으로 가기 전 약 200ms 동안 `0` 을 보고한다 (M9-3 실측). 그 `0` 은 영상은
   *   맞고 시간만 틀린 값이라 어댑터의 영상 식별 판정으로는 거를 수 없다.
   *   `playing` 이 온 뒤의 위치만 믿는다.
   *
   * M9-3 까지는 코디네이터의 지역 변수였다. 같은 사실을 두 곳에 두면 갈라지므로
   * **옮겼다** — 사본을 만들지 않았다.
   */
  const hasStartedPlaying = ref<boolean>(false)

  const isEmpty = computed<boolean>(() => queue.value.length === 0)

  /**
   * 지금 소리가 나고 있는가 (M4).
   *
   * 데크 회전과 마스코트 호흡이 이 값을 본다. 정의를 한 곳에 두어 두 위젯이
   * 서로 다르게 판단하지 않게 한다. 테마 UI 는 플레이어를 직접 부르지 않고
   * 이 store 만 읽는다 (`AGENTS.md` 규칙 4).
   */
  const isPlaying = computed<boolean>(() => playerState.value === 'playing')

  /**
   * 플레이어가 보고하는 재생 위치를 **믿을 수 있는지** (M9-4).
   *
   * Moment 저장 버튼의 활성 상태와 코디네이터의 `capturePosition()` 이 **같은
   * 판정**을 쓴다. 둘이 따로 판정하면 버튼은 켜졌는데 저장이 거절되거나, 그
   * 반대가 된다.
   *
   * - 현재 트랙이 있다
   * - 마지막 명령 이후 실제로 재생이 시작됐다 (`hasStartedPlaying`)
   * - 지금 `idle` 도 `error` 도 아니다. `paused` · `loading`(재생 중 버퍼링) ·
   *   `ended` 의 위치는 플레이어가 실제로 가 있던 자리다
   *
   * 정상적으로 확인된 **0초는 유효하다** — 이 판정은 숫자를 보지 않는다.
   * 숫자 검증은 코디네이터가 어댑터의 값을 받을 때 한다.
   */
  const isPositionReliable = computed<boolean>(
    () =>
      currentTrack.value !== null &&
      hasStartedPlaying.value &&
      playerState.value !== 'idle' &&
      playerState.value !== 'error',
  )

  /**
   * 큐와 현재 위치를 함께 설정한다.
   *
   * 불변조건: `queueIndex`는 큐 범위 안이거나, 큐가 비면 `NO_QUEUE_INDEX`다.
   * `currentTrack`은 항상 `queue[queueIndex]`와 일치한다.
   */
  function setQueue(tracks: readonly Track[], startIndex = 0): void {
    queue.value = [...tracks]

    if (queue.value.length === 0) {
      queueIndex.value = NO_QUEUE_INDEX
      currentTrack.value = null
      return
    }

    const clamped = Math.min(Math.max(startIndex, 0), queue.value.length - 1)
    queueIndex.value = clamped
    currentTrack.value = queue.value[clamped] ?? null
  }

  /** 큐 안의 위치를 옮긴다. 범위를 벗어난 값은 무시한다. */
  function setQueueIndex(index: number): boolean {
    if (index < 0 || index >= queue.value.length) return false

    queueIndex.value = index
    currentTrack.value = queue.value[index] ?? null
    return true
  }

  /**
   * 큐에서 한 칸 앞으로 간다.
   *
   * 큐 끝에서는 **움직이지 않고** `false` 를 돌려준다. 처음으로 돌아가지
   * 않는다 — 반복은 MVP 범위 밖이다 (M3-0.1, `BACKLOG.md` §5).
   */
  function advance(): boolean {
    return setQueueIndex(queueIndex.value + 1)
  }

  /** 큐에서 한 칸 뒤로 간다. 큐 처음에서는 움직이지 않는다. */
  function back(): boolean {
    return setQueueIndex(queueIndex.value - 1)
  }

  function setPlayerState(next: PlayerState): void {
    playerState.value = next
  }

  function setStatus(message: string, tone: StatusTone = 'info'): void {
    statusMessage.value = message
    statusTone.value = tone
  }

  /** 코디네이터만 부른다. 명령하면 `false`, 플레이어가 `playing` 을 알리면 `true`. */
  function setHasStartedPlaying(value: boolean): void {
    hasStartedPlaying.value = value
  }

  /** 안전한 빈 상태로 되돌린다. */
  function reset(): void {
    currentTrack.value = null
    queue.value = []
    queueIndex.value = NO_QUEUE_INDEX
    playerState.value = 'idle'
    statusMessage.value = ''
    statusTone.value = 'info'
    hasStartedPlaying.value = false
  }

  return {
    currentTrack,
    queue,
    queueIndex,
    playerState,
    statusMessage,
    statusTone,
    hasStartedPlaying,
    isEmpty,
    isPlaying,
    isPositionReliable,
    setQueue,
    setQueueIndex,
    advance,
    back,
    setPlayerState,
    setStatus,
    setHasStartedPlaying,
    reset,
  }
})
