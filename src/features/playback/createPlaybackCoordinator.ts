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
 *
 * 늦게 도착한 비동기 사건을 버리는 규칙 (M3-5):
 *
 * | 사건                        | 버리는 조건                                  |
 * | --------------------------- | -------------------------------------------- |
 * | 모든 사건                   | 그 어댑터의 연결이 이미 끊겼다 (`detach()`)  |
 * | `ENDED`                     | 그 트랙이 재생된 적이 없다 (M3-2)            |
 * | `error` · `autoplayBlocked` | 큐가 비어 있다 — 붙일 트랙이 없다            |
 *
 * **오류는 버리지 않는다.** "이미 재생된 트랙의 오류는 이전 적재의 늦은
 * 신호" 라는 규칙을 한 번 넣어봤지만 되돌렸다. 그 규칙은 재생 중에 생긴
 * 진짜 오류를 **조용히 삼킨다** — 화면은 `재생 중` 인데 소리는 나지 않는
 * 상태가 되고, 이것이 M3-5 가 없애려는 바로 그 "조용한 실패" 다.
 * 틀린 안내는 사용자가 보고 판단할 수 있지만, 없는 안내는 그럴 수 없다.
 *
 * **IFrame API 는 사건에 적재 식별자를 주지 않는다.** 그래서 `load(B)` 직후
 * `B` 의 첫 상태가 오기 전에 도착한 `A` 의 오류는 `B` 의 것으로 보인다.
 * 이 창은 수 밀리초이고, `B` 가 실제로 재생되면 `stateChange('playing')` 이
 * 안내를 지워 저절로 바로잡힌다. 더 좁히려면 API 쪽 지원이 필요하다.
 */
import type { Track } from '@/shared/types'
import { useLibraryStore } from '@/stores/library'
import { usePlaybackStore } from '@/stores/playback'

import type {
  PlayerAdapter,
  PlayerAdapterEvents,
  PlayerErrorInfo,
  PlayerErrorKind,
} from './PlayerAdapter'
import type {
  PlaybackCoordinator,
  PlayerAttachment,
  PlayRequestResult,
} from './playbackCoordinator'
import type { PlayerHiddenReason, PlayerPresence } from './playerVisibility'

/** 큐 끝에서 멈췄을 때. 반복하지 않는다 (M3-0.1). */
const QUEUE_FINISHED_MESSAGE = '마지막 곡까지 재생했습니다.'

/**
 * 가시성 때문에 재생을 시작하지 못했을 때 (M3-4).
 *
 * 드로어가 가린 경우의 "닫고 누르세요" 안내는 **드로어가** 한다. 가린 것을
 * 아는 쪽이 거기이고, 이 문구가 나가는 `.status` 영역은 좁은 화면에서
 * 드로어와 함께 숨기 때문이다.
 */
const START_BLOCKED_MESSAGE: Record<PlayerHiddenReason, string> = {
  covered: '영상이 화면에 보이지 않아 재생할 수 없어요. 플레이어가 보이는 곳에서 ▶ 를 눌러주세요.',
  'too-small': `영상 영역이 너무 작아 재생할 수 없어요 (최소 200×200). 창을 키워주세요.`,
}

/** 가리기 직전에 멈출 때. 승인된 프로토타입의 문구를 그대로 쓴다. */
const WILL_HIDE_PAUSE_MESSAGE = '작은 화면에서는 영상이 가려져 일시정지됩니다.'

/** 이미 가려진 것을 뒤늦게 발견해 멈출 때. 프로토타입의 문구다. */
const COVERED_PAUSE_MESSAGE = '영상이 화면에서 가려져 일시정지됐어요. 돌아와서 ▶ 를 눌러주세요.'

/**
 * 오류 종류별 안내 (M3-5).
 *
 * 숫자 코드가 아니라 **도메인 종류**로 가른다. 코드 → 종류 변환은 어댑터가
 * 하고 (`SYSTEM_DESIGN.md` §8.1), 여기는 사용자가 다음에 무엇을 할 수
 * 있는지만 말한다. 101 과 150 이 같은 문구인 것은 같은 사정이기 때문이다.
 *
 * 자동으로 다음 곡으로 넘기지 않으므로 (M3-0.7) 어느 문구든 **사용자가 할
 * 일**로 끝난다.
 */
const ERROR_MESSAGE: Readonly<Record<PlayerErrorKind, string>> = {
  'api-unavailable':
    'YouTube 플레이어를 불러오지 못했어요. 네트워크를 확인하고 ▶ 를 다시 눌러주세요.',
  'invalid-parameter': '영상 주소가 올바르지 않아 재생할 수 없어요. 링크를 다시 등록해주세요.',
  'not-playable': '이 브라우저의 플레이어에서 재생할 수 없는 영상이에요. YouTube 에서 열어보세요.',
  'not-found': '영상을 찾을 수 없어요. 삭제되었거나 비공개로 바뀐 것 같아요.',
  'embed-not-allowed':
    '이 영상은 다른 사이트에서 재생할 수 없도록 설정돼 있어요. YouTube 에서 열어보세요.',
  'referrer-missing': '브라우저가 참조 정보를 보내지 않아 YouTube 가 재생을 거부했어요.',
  unknown: '이 영상은 재생되지 않아요. 다음 곡을 직접 선택해주세요.',
}

/**
 * 사용자에게 보일 오류 안내.
 *
 * 승인된 프로토타입처럼 **번호를 함께 보여준다.** 사용자가 검색하거나
 * 알려줄 수 있는 유일한 단서다. 스크립트 로드 실패에는 번호가 없다.
 */
function errorMessage(info: PlayerErrorInfo): string {
  const base = ERROR_MESSAGE[info.kind]
  return info.code === null ? base : `${base} (오류 ${String(info.code)})`
}

/** 재생 중인 트랙이 라이브러리에서 지워졌을 때 (`MVP_SPEC.md` F4). */
const TRACK_REMOVED_MESSAGE = '재생 중이던 곡이 목록에서 삭제돼 재생을 멈췄습니다.'

/** 라이브러리가 통째로 교체됐을 때 (M8-3). */
const LIBRARY_REPLACED_MESSAGE = '백업을 복원해 재생을 멈췄습니다. 목록에서 다시 골라주세요.'

export function createPlaybackCoordinator(): PlaybackCoordinator {
  const library = useLibraryStore()
  const playback = usePlaybackStore()

  /** 등록된 어댑터. 반응형이 아니다 (ADR 0006). */
  let adapter: PlayerAdapter | null = null

  /**
   * 등록된 플레이어 영역 (M3-4).
   *
   * 영역을 소유한 쪽(`PlayerSurface`)이 어댑터와 함께 넘긴다.
   * **없으면 판정하지 않는다** — 영역이 없으면 가려질 것도 없다.
   */
  let presence: PlayerPresence | null = null

  /**
   * 우리 UI 가 뷰포트 하단을 덮은 높이 (M7-1).
   *
   * 반응형이 아니다. 가리는 쪽(`DashboardShell`)이 숫자로 알려주고 측정에
   * 그대로 넘긴다. 무엇이 가리는지는 모른다.
   */
  let bottomObstruction = 0

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

  /**
   * 지금 재생을 시작할 수 없는 이유. 잴 수 없으면 `null`(허용)이다.
   *
   * 재생을 **시작하는 모든 경로**가 이것을 먼저 본다 (M3-4).
   *
   * 화면 밖이면 **한 번 끌어와 본 뒤** 다시 잰다. 좁은 화면의 단일 열
   * 배치에서는 플레이어가 화면 한참 아래에 있어, 끌어오지 않으면 사용자가
   * 수동으로 스크롤하기 전까지 아무것도 재생할 수 없다. 드로어가 덮은
   * `display: none` 은 끌어와도 보이지 않으므로 재측정이 다시 거절한다.
   */
  function startBlock(): PlayerHiddenReason | null {
    if (presence === null) return null

    const first = presence.measure(bottomObstruction)
    if (first.ok) return null
    if (first.reason !== 'covered') return first.reason

    presence.reveal()
    const second = presence.measure(bottomObstruction)
    return second.ok ? null : second.reason
  }

  /**
   * 지금 띄워둔 안내가 **가시성 때문**인지 (M5).
   *
   * 가려짐이 풀리면 지워야 한다. 그대로 두면 "영상이 보이지 않아 재생할 수
   * 없어요" 가 영상이 다시 보이는 동안에도 남아 사실과 어긋난다. 오류 안내는
   * 사정이 그대로이므로 지우지 않는다 — 그래서 출처를 기억한다.
   */
  let visibilityNotice = false

  /** 가시성 때문에 시작을 거절한다. 큐는 건드리지 않는다. */
  function refuseStart(reason: PlayerHiddenReason): void {
    awaitingUserAction = true
    visibilityNotice = true
    playback.setStatus(START_BLOCKED_MESSAGE[reason], 'warning')
  }

  /**
   * 가시성 때문에 멈춘다.
   *
   * 다시 보이게 되어도 **자동으로 재생하지 않는다.** 사용자가 ▶ 를 눌러야
   * 한다 — 보이게 됐다는 것만으로 소리를 내면 사용자가 의도하지 않은 재생이다.
   */
  function pauseForVisibility(message: string): void {
    adapter?.pause()
    awaitingUserAction = true
    visibilityNotice = true
    playback.setStatus(message)
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

  /**
   * 현재 트랙을 처음부터 재생한다. **사용자의 명시적 요청**에서만 부른다.
   *
   * 앞선 안내를 지우고 "사용자 조작 대기" 를 푼다. 그래야 오류로 멈춰 있던
   * 큐가 다시 흐른다.
   */
  function startCurrent(): void {
    clearStatus()
    commandCurrentTrack()
  }

  /** 안내를 지우고 대기 상태를 푼다. 사용자의 요청이 받아들여졌을 때다. */
  function clearStatus(): void {
    visibilityNotice = false
    awaitingUserAction = false
    playback.setStatus('')
  }

  function startQueue(tracks: readonly Track[], index: number): PlayRequestResult {
    // 가려져 있으면 **큐도 바꾸지 않는다.** 아무 일도 없던 것처럼 거절한다.
    const blocked = startBlock()
    if (blocked !== null) {
      refuseStart(blocked)
      return { ok: false, reason: 'player-hidden' }
    }

    playback.setQueue(snapshot(tracks), index)
    startCurrent()
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

  /**
   * 재생 / 일시정지 토글 (M3-3).
   *
   * | 상태                | 버튼  | 누르면                                      |
   * | ------------------- | ----- | ------------------------------------------- |
   * | `playing` `loading` | Ⅱ     | `pause()` — 준비 중이면 보류한 재생도 취소   |
   * | `paused` `idle` `ended` | ▶ | `play()` — `ended` 는 그 자리에서 다시 재생  |
   * | `error`             | ▶     | 같은 트랙을 **다시 적재**한다                |
   *
   * `error` 만 `play()` 가 아닌 이유: 실패한 플레이어에 `playVideo()` 를
   * 보내면 아무 일도 일어나지 않는다. 다시 적재해야 재시도가 된다.
   * 오류 코드별 안내와 외부 링크는 M3-5 다.
   */
  function togglePlay(): void {
    if (playback.currentTrack === null) return

    const state = playback.playerState
    if (state === 'playing' || state === 'loading') {
      adapter?.pause()
      return
    }

    // 여기서부터는 재생을 **시작**한다. 가려져 있으면 하지 않는다 (M3-4).
    const blocked = startBlock()
    if (blocked !== null) {
      refuseStart(blocked)
      return
    }

    if (state === 'error') {
      startCurrent()
      return
    }

    // 'paused' · 'idle' · 'ended'
    clearStatus()
    adapter?.play()
  }

  function next(): boolean {
    // 가시성을 큐 이동보다 먼저 본다. 거절했는데 위치만 움직이면 안 된다.
    const blocked = startBlock()
    if (blocked !== null) {
      refuseStart(blocked)
      return false
    }

    if (!playback.advance()) return false

    startCurrent()
    return true
  }

  function previous(): boolean {
    const blocked = startBlock()
    if (blocked !== null) {
      refuseStart(blocked)
      return false
    }

    if (!playback.back()) return false

    startCurrent()
    return true
  }

  function handleEnded(): void {
    // 재생된 적 없는 트랙의 ENDED 는 이전 트랙의 늦은 신호다.
    if (!hasStartedPlaying) return
    // 오류 뒤에는 사용자의 다음 동작을 기다린다.
    if (awaitingUserAction) return

    // 가려진 곳에서 다음 곡을 시작하지 않는다. 위치도 움직이지 않는다.
    const blocked = startBlock()
    if (blocked !== null) {
      refuseStart(blocked)
      return
    }

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
        clearStatus()
        return
      }

      if (state === 'ended') handleEnded()
    },

    error: (info) => {
      // 붙일 곳이 없는 사건이다. 큐를 비운 뒤 도착한 늦은 신호일 수 있다.
      if (playback.currentTrack === null) return

      // 자동으로 다음 곡으로 넘기지 않는다 (M3-0.7).
      awaitingUserAction = true
      // 가시성 안내가 아니다. 영상이 다시 보여도 이 안내는 남아야 한다.
      visibilityNotice = false
      playback.setStatus(errorMessage(info), 'warning')
    },

    autoplayBlocked: () => {
      if (playback.currentTrack === null) return

      /*
       * 오류가 아니다. 영상은 적재돼 있고 시작만 막혔다.
       *
       * 어댑터가 낙관적으로 세웠던 `loading` 을 `idle` 로 되돌려주므로
       * 토글이 ▶ 를 보여준다 (M3-5). 사용자는 그 ▶ 로도, 영상 안의 ▶ 로도
       * 다시 요청할 수 있다.
       */
      awaitingUserAction = true
      visibilityNotice = false
      playback.setStatus(
        '브라우저가 자동재생을 막았어요. ▶ 를 다시 누르거나 영상의 ▶ 를 눌러주세요.',
        'warning',
      )
    },
  }

  /**
   * 라이브러리에서 트랙이 지워졌다 (M3-5, `MVP_SPEC.md` F4).
   *
   * 큐는 스냅샷이라 **자동으로 끊기지 않는다.** 지금 그 곡을 틀고 있었다면
   * 멈추고 알린다. 큐는 그대로 둔다 — 스냅샷이라는 보장을 여기서 깨면
   * "재생 중 목록을 편집해도 큐가 흔들리지 않는다" 가 무너진다.
   *
   * 자동으로 다음 곡으로 넘기지도 않는다. 사용자가 방금 뭔가를 지웠고,
   * 그 결과로 다른 곡이 울리기 시작하면 놀란다 (M3-0.7 과 같은 이유).
   *
   * 트랙 id 는 `createId()` 가 만든 UUID 라서 플레이리스트가 달라도 겹치지
   * 않는다. 같은 영상을 두 목록에 넣어도 id 는 서로 다르다.
   */
  function trackRemoved(trackId: string): void {
    if (playback.currentTrack?.id !== trackId) return

    adapter?.pause()
    awaitingUserAction = true
    visibilityNotice = false
    playback.setStatus(TRACK_REMOVED_MESSAGE, 'warning')
  }

  /**
   * 라이브러리가 통째로 교체됐다 (M8-3).
   *
   * 멈추고 **큐를 비운다.** `playback.reset()` 이 큐·현재 트랙·상태를 모두
   * 안전한 빈 상태로 되돌리므로, 뒤이어 안내만 다시 세운다.
   *
   * 내부 플래그도 함께 되돌린다 — 이전 큐의 늦은 `ENDED` 가 새 상태를
   * 건드리지 못하게 한다.
   */
  function libraryReplaced(): void {
    adapter?.pause()

    playback.reset()
    hasStartedPlaying = false
    awaitingUserAction = false
    visibilityNotice = false

    playback.setStatus(LIBRARY_REPLACED_MESSAGE)
  }

  /** 플레이어가 곧 가려진다 (M3-4). 가려지기 **전에** 멈춘다. */
  function playerWillHide(): void {
    if (!isSounding()) return

    pauseForVisibility(WILL_HIDE_PAUSE_MESSAGE)
  }

  /** 가시성이 바뀌었을 수 있다. 다시 재서 필요하면 멈춘다 (M3-4). */
  function revalidatePlayerVisibility(): void {
    const verdict = presence?.measure(bottomObstruction)
    if (verdict === undefined) return

    if (verdict.ok) {
      /*
       * 다시 보인다. 가시성 때문에 띄운 안내만 지운다 (M5).
       *
       * 재생을 되살리지는 **않는다.** 보이게 됐다는 것만으로 소리를 내면
       * 사용자가 의도하지 않은 재생이다 (M3-4). 사용자 조작 대기 플래그도
       * 그대로 둔다 — 다음 동작은 사용자가 고른다.
       */
      if (visibilityNotice) {
        visibilityNotice = false
        playback.setStatus('')
      }
      return
    }

    if (!isSounding()) return

    pauseForVisibility(COVERED_PAUSE_MESSAGE)
  }

  /**
   * 지금 소리가 나거나 곧 날 상태인지.
   *
   * `loading` 도 포함한다. 버퍼링 중에 가려지면 그대로 두면 **가려진 채로
   * 재생이 시작된다.** 어댑터의 `pause()` 는 보류한 재생도 취소한다 (M3-1).
   */
  function isSounding(): boolean {
    return playback.playerState === 'playing' || playback.playerState === 'loading'
  }

  /**
   * 하단 가림 높이가 바뀌었다 (M7-1).
   *
   * 값이 같으면 아무 일도 하지 않는다 — `resize` 마다 같은 값이 들어올 수
   * 있고, 그때마다 재측정하면 멈춘 이유를 덮어쓴다.
   *
   * 바뀌었으면 **즉시 다시 잰다.** 시트가 올라와 덮는 순간 멈춰야 하고,
   * 닫혀 걷히는 순간 가시성 안내가 지워져야 한다. 되살려 재생하지는 않는다.
   */
  function setBottomObstruction(px: number): void {
    const next = Math.max(0, px)
    if (next === bottomObstruction) return

    bottomObstruction = next
    revalidatePlayerVisibility()
  }

  function attachAdapter(instance: PlayerAdapter, area?: PlayerPresence): PlayerAttachment {
    adapter = instance
    presence = area ?? null

    /*
     * 이 연결에만 해당하는 핸들러다 (M3-5).
     *
     * 연결이 끊긴 뒤 도착한 사건을 버린다. 실제 어댑터는 세대 번호로 자기
     * 콜백을 무효화하지만(M3-1), 그것은 **어댑터의** 약속이다. 코디네이터가
     * 어댑터의 성실함에 기대지 않고 제 쪽에서도 막는다.
     */
    let attached = true

    const scoped: PlayerAdapterEvents = {
      stateChange: (state) => {
        if (attached) events.stateChange?.(state)
      },
      error: (info) => {
        if (attached) events.error?.(info)
      },
      autoplayBlocked: () => {
        if (attached) events.autoplayBlocked?.()
      },
    }

    return {
      events: scoped,
      detach: () => {
        attached = false

        // 다른 어댑터가 이미 자리를 차지했으면 건드리지 않는다.
        if (adapter !== instance) return

        adapter = null
        presence = null
      },
    }
  }

  return {
    playPlaylist,
    playTrack,
    togglePlay,
    next,
    previous,
    trackRemoved,
    libraryReplaced,
    playerWillHide,
    revalidatePlayerVisibility,
    setBottomObstruction,
    attachAdapter,
  }
}
