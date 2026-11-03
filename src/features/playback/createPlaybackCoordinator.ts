/**
 * Playback Coordinator 구현 (M3-2).
 *
 * 라이브러리에서 큐를 뜨고, 어댑터에 명령을 보내고, 어댑터의 사건을
 * `playback` store 에 반영한다. **두 store 를 잇는 유일한 지점이다.**
 *
 * ```
 *   library store ──읽기──▶ Coordinator ──쓰기──▶ playback store
 *                                │  ▲
 *                          명령  │  │  사건
 *                                ▼  │
 *                          PlayerAdapter (PlayerSurface 가 소유)
 * ```
 *
 * 소유권 (ADR 0006, ADR 0009):
 * - 어댑터를 **만들거나 없애지 않는다.** `PlayerSurface` 가 등록해준 것을
 *   빌려 쓰고, 언마운트하면 돌려준다.
 * - 어댑터와 내부 플래그를 **반응형으로 감싸지 않는다.** 평범한 지역 변수다.
 *   Pinia state 에 넣으면 외부 플레이어가 반응형 그래프에 끌려들어간다.
 * - store 는 `playback` 에만 쓴다. `library` 는 읽기만 한다.
 */
import type { Track } from '@/shared/types'
import { useLibraryStore } from '@/stores/library'
import { usePlaybackStore } from '@/stores/playback'

import type { PlayerAdapter, PlayerAdapterEvents, PlayerErrorInfo } from './PlayerAdapter'
import type {
  PlaybackCoordinator,
  PlayerAttachment,
  PlayRequestResult,
} from './playbackCoordinator'

/** 큐 끝에서 멈췄을 때. 반복하지 않는다 (M3-0.1). */
const QUEUE_FINISHED_MESSAGE = '마지막 곡까지 재생했습니다.'

/**
 * 사용자에게 보일 오류 안내.
 *
 * 코드별로 문구를 가르지 않는다. 승인된 프로토타입도 한 문장에 번호만
 * 붙인다. **코드별 상세 안내와 `YOUTUBE에서 열기 ↗` 링크는 M3-5** 다.
 */
function errorMessage(info: PlayerErrorInfo): string {
  if (info.kind === 'api-unavailable') {
    return 'YouTube 플레이어를 불러오지 못했어요. 네트워크를 확인해주세요.'
  }
  return `이 영상은 재생되지 않아요 (오류 ${String(info.code)}). 다음 곡을 직접 선택해주세요.`
}

export function createPlaybackCoordinator(): PlaybackCoordinator {
  const library = useLibraryStore()
  const playback = usePlaybackStore()

  /** 등록된 어댑터. 반응형이 아니다 (ADR 0006). */
  let adapter: PlayerAdapter | null = null

  /**
   * 지금 트랙이 **한 번이라도 재생됐는지.**
   *
   * `ENDED` 를 받아도 이것이 `false` 면 다음 곡으로 넘기지 않는다.
   * 사용자가 곡을 빠르게 연달아 고르면, 바꾸기 직전 트랙의 `ENDED` 가
   * 새 트랙을 적재한 **뒤에** 도착할 수 있다. 그 신호를 그대로 믿으면
   * 사용자가 고른 곡을 건너뛰고 그 다음 곡이 나온다.
   * 재생된 적 없는 트랙은 끝날 수도 없다.
   */
  let hasStartedPlaying = false

  /**
   * 사용자의 명시적인 다음 동작을 기다리는 중인지.
   *
   * 오류나 자동재생 차단 뒤에 켜진다. 켜져 있는 동안 `ENDED` 가 와도
   * 자동으로 넘기지 않는다 (M3-0.7 — 재생 불가 영상에서 자동 건너뛰기 금지).
   * 재생이 실제로 시작되거나 사용자가 새로 요청하면 꺼진다.
   */
  let awaitingUserAction = false

  /**
   * 라이브러리의 트랙을 **큐 스냅샷**으로 복사한다.
   *
   * 배열만이 아니라 트랙 객체까지 복사한다. 얕게 복사하면 큐와 라이브러리가
   * 같은 객체를 가리켜, "재생 중 목록을 편집해도 큐는 그대로" 라는 보장이
   * 라이브러리의 구현 세부(제자리 수정을 하지 않는다)에 기대게 된다.
   */
  function snapshot(tracks: readonly Track[]): Track[] {
    return tracks.map((track) => ({ ...track }))
  }

  /** 현재 트랙을 어댑터에 보낸다. 사용자 요청이므로 즉시 재생이다. */
  function commandCurrentTrack(): void {
    const track = playback.currentTrack
    if (track === null) return

    hasStartedPlaying = false
    // 어댑터가 API·플레이어 준비 전 요청을 보류했다가 한 번만 실행한다
    // (ADR 0008). 여기서 준비 여부를 따로 따지지 않는다.
    adapter?.load(track.videoId, { autoplay: true })
  }

  function startQueue(tracks: readonly Track[], index: number): PlayRequestResult {
    playback.setQueue(snapshot(tracks), index)
    playback.setStatus('')
    awaitingUserAction = false
    commandCurrentTrack()
    return { ok: true }
  }

  function playPlaylist(playlistId: string): PlayRequestResult {
    const playlist = library.getPlaylist(playlistId)
    if (playlist === undefined) return { ok: false, reason: 'playlist-not-found' }
    // 빈 목록은 재생할 수 없다. 큐도 건드리지 않는다.
    if (playlist.tracks.length === 0) return { ok: false, reason: 'empty-playlist' }

    return startQueue(playlist.tracks, 0)
  }

  function playTrack(playlistId: string, trackId: string): PlayRequestResult {
    const playlist = library.getPlaylist(playlistId)
    if (playlist === undefined) return { ok: false, reason: 'playlist-not-found' }
    if (playlist.tracks.length === 0) return { ok: false, reason: 'empty-playlist' }

    const index = playlist.tracks.findIndex((track) => track.id === trackId)
    if (index === -1) return { ok: false, reason: 'track-not-found' }

    // 고른 트랙 하나가 아니라 **목록 전체**가 큐가 된다. 그 트랙부터 시작할 뿐이다.
    return startQueue(playlist.tracks, index)
  }

  function handleEnded(): void {
    // 재생된 적 없는 트랙의 ENDED 는 이전 트랙의 늦은 신호다.
    if (!hasStartedPlaying) return
    // 오류 뒤에는 사용자의 다음 동작을 기다린다.
    if (awaitingUserAction) return

    if (!playback.advance()) {
      // 큐 끝. 반복하지 않고 멈춘다 (M3-0.1).
      playback.setStatus(QUEUE_FINISHED_MESSAGE)
      return
    }

    commandCurrentTrack()
  }

  /**
   * 어댑터가 알려주는 사건의 입구.
   *
   * 객체 하나를 공유한다. 어댑터가 여러 번 붙었다 떨어져도 같은 핸들러다.
   */
  const events: PlayerAdapterEvents = {
    stateChange: (state) => {
      playback.setPlayerState(state)

      if (state === 'playing') {
        hasStartedPlaying = true
        awaitingUserAction = false
        playback.setStatus('')
        return
      }

      if (state === 'ended') handleEnded()
    },

    error: (info) => {
      // 자동으로 다음 곡으로 넘기지 않는다 (M3-0.7).
      awaitingUserAction = true
      playback.setStatus(errorMessage(info), 'warning')
    },

    autoplayBlocked: () => {
      // 오류가 아니다. 사용자가 플레이어의 ▶ 를 누르면 재생된다.
      // 상세 안내와 재시도 UX 는 M3-5 다.
      awaitingUserAction = true
      playback.setStatus('브라우저가 자동재생을 막았어요. 영상의 ▶ 를 눌러주세요.', 'warning')
    },
  }

  function attachAdapter(next: PlayerAdapter): PlayerAttachment {
    adapter = next

    return {
      events,
      detach: () => {
        // 다른 어댑터가 이미 자리를 차지했으면 건드리지 않는다.
        if (adapter === next) adapter = null
      },
    }
  }

  return { playPlaylist, playTrack, attachAdapter }
}
