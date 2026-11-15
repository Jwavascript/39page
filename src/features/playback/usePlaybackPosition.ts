/**
 * 지금 재생 위치 — "이 곡의 Moments" 목록에 **지금** 선을 긋기 위한 것 (M11-7C).
 *
 * 재생 위치는 반응형 상태가 아니다 — 어댑터가 물어볼 때만 알려 준다(`capturePosition()`). 그래서 소리가 나는
 * 동안에만 1초마다 묻는다. 멈추면 마지막 값을 그대로 두고 묻지 않는다. 위치를 믿을 수 없으면(재생 전 ·
 * 곡을 바꾸는 중) `null` — 0 으로 바꾸지 않는다 (ADR 0020).
 *
 * 화면 표시용이다. Moment 를 저장할 때의 시점은 이것을 쓰지 않고 누른 순간 코디네이터에게 다시 묻는다.
 */
import { inject, onScopeDispose, readonly, ref, watch, type Ref } from 'vue'

import { PLAYBACK_COORDINATOR } from '@/features/playback/playbackCoordinator'
import { usePlaybackStore } from '@/stores/playback'

/** 묻는 간격. 시점 표시는 초 단위라 이보다 촘촘할 까닭이 없다. */
export const POSITION_POLL_MS = 1000

export interface PlaybackPosition {
  /** 지금 영상 · 초. 모르면 `null`. */
  readonly position: Readonly<Ref<{ videoId: string; seconds: number } | null>>
}

export function usePlaybackPosition(): PlaybackPosition {
  const coordinator = inject(PLAYBACK_COORDINATOR, null)
  const playback = usePlaybackStore()
  const position = ref<{ videoId: string; seconds: number } | null>(null)

  let timer: ReturnType<typeof setInterval> | null = null

  function read(): void {
    const captured = coordinator?.capturePosition() ?? null
    position.value =
      captured === null ? null : { videoId: captured.videoId, seconds: captured.atSeconds }
  }

  function stop(): void {
    if (timer !== null) clearInterval(timer)
    timer = null
  }

  watch(
    () => [playback.isPlaying, playback.currentTrack?.id ?? null] as const,
    ([playing, trackId]) => {
      stop()
      if (trackId === null) {
        position.value = null
        return
      }
      read()
      if (playing && coordinator !== null) timer = setInterval(read, POSITION_POLL_MS)
    },
    { immediate: true },
  )

  onScopeDispose(stop)

  return { position: readonly(position) }
}
