/**
 * 재생 상태.
 *
 * M1-5에서는 **데이터 구조와 기본 불변조건만** 둔다. 실제 재생 명령 연결,
 * YouTube 이벤트 구독, 다음 곡 자동 전환, 반복 정책, 자동재생 차단 대응,
 * 임베드 오류 처리, 플레이리스트 연동은 M3에서 한다.
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

  const isEmpty = computed<boolean>(() => queue.value.length === 0)

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

  function setPlayerState(next: PlayerState): void {
    playerState.value = next
  }

  function setStatus(message: string, tone: StatusTone = 'info'): void {
    statusMessage.value = message
    statusTone.value = tone
  }

  /** 안전한 빈 상태로 되돌린다. */
  function reset(): void {
    currentTrack.value = null
    queue.value = []
    queueIndex.value = NO_QUEUE_INDEX
    playerState.value = 'idle'
    statusMessage.value = ''
    statusTone.value = 'info'
  }

  return {
    currentTrack,
    queue,
    queueIndex,
    playerState,
    statusMessage,
    statusTone,
    isEmpty,
    setQueue,
    setQueueIndex,
    setPlayerState,
    setStatus,
    reset,
  }
})
