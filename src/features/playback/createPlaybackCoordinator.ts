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
 *
 * Music Moments (M9-3, ADR 0020): `capturePosition()` 과 `playMoment()` 을
 * 더했다. 둘 다 **재생만** 안다 — Moment 를 저장하거나 읽지 않는다. 저장은
 * Moments store 의 일이고 그 둘을 잇는 것은 UI 다 (`MOMENTS_DESIGN.md` §4).
 * 시점 이동도 **적재된 플레이어에 보내는 명령**이라 iframe 은 바뀌지 않는다
 * (ADR 0002).
 *
 * 큐는 출처 목록을 따른다 (ADR 0038): 목록에 곡을 더하거나 · 지우거나 · 순서나 이름을 바꾸면 큐가 바로
 * 같아진다. 라이브러리는 여전히 **읽기만** 한다 — 이 파일이 출처 목록을 지켜보고 playback store 에 쓴다.
 * 셔플 · 반복도 여기서 큐의 순서와 끝 처리로 구현한다.
 */
import { computed, watch } from 'vue'

import { REPEAT_MODES, type RepeatMode, type Track } from '@/shared/types'
import { insertedRandomly, randomIndex, shuffled, type RandomSource } from '@/shared/utils/shuffle'
import { isYouTubeVideoId } from '@/shared/utils/youtube'
import { defaultTrackTitle, useLibraryStore } from '@/stores/library'
import { isValidAtSeconds } from '@/stores/moments'
import { usePlaybackStore, type QueueSource } from '@/stores/playback'

import type {
  PlayerAdapter,
  PlayerAdapterEvents,
  PlayerErrorInfo,
  PlayerErrorKind,
} from './PlayerAdapter'
import type {
  MomentCapture,
  PlaybackClock,
  MomentPlayResult,
  MomentTarget,
  NowPlaying,
  PlaybackCoordinator,
  PlaybackModesView,
  PlayerAttachment,
  PlayRequestResult,
  QueueView,
} from './playbackCoordinator'
import type { PlayerHiddenReason, PlayerPresence } from './playerVisibility'

/** 반복이 꺼진 채로 큐 끝에서 멈췄을 때 (M3-0.1). */
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

/** 라이브러리가 통째로 교체됐을 때 (M8-3). */
const LIBRARY_REPLACED_MESSAGE = '백업을 복원해 재생을 멈췄습니다. 목록에서 다시 골라주세요.'

export interface PlaybackCoordinatorOptions {
  /** 셔플에 쓸 난수 (ADR 0038). 테스트가 순서를 정할 때만 넘긴다. 기본값은 `Math.random`. */
  readonly random?: RandomSource
}

/** 두 트랙 목록이 같은가 — 트랙 id · 영상 · 제목과 그 순서. */
function sameTracks(a: readonly Track[], b: readonly Track[]): boolean {
  return (
    a.length === b.length &&
    a.every((track, position) => {
      const other = b[position]
      return (
        other !== undefined &&
        other.id === track.id &&
        other.videoId === track.videoId &&
        other.title === track.title
      )
    })
  )
}

export function createPlaybackCoordinator(
  options: PlaybackCoordinatorOptions = {},
): PlaybackCoordinator {
  const library = useLibraryStore()
  const playback = usePlaybackStore()
  const random: RandomSource = options.random ?? Math.random

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

  /*
   * "지금 트랙이 한 번이라도 재생됐는가" 는 `playback.hasStartedPlaying` 이다.
   *
   * `ENDED` 를 받아도 이것이 `false` 면 다음 곡으로 넘기지 않는다.
   * 사용자가 곡을 빠르게 연달아 고르면, 바꾸기 직전 트랙의 `ENDED` 가
   * 새 트랙을 적재한 **뒤에** 도착할 수 있다. 그 신호를 그대로 믿으면
   * 사용자가 고른 곡을 건너뛰고 그 다음 곡이 나온다.
   * 재생된 적 없는 트랙은 끝날 수도 없다.
   *
   * M9-3 까지 이 함수의 지역 변수였다. M9-4 에서 store 로 옮겼다 — 화면이
   * 같은 사실로 Moment 저장 버튼을 켜고 꺼야 한다. 쓰는 곳은 여전히 여기뿐이다.
   */

  /**
   * 사용자의 명시적인 다음 동작을 기다리는 중인지.
   *
   * 오류나 자동재생 차단 뒤에 켜진다. 켜져 있는 동안 `ENDED` 가 와도
   * 자동으로 넘기지 않는다 (M3-0.7 — 재생 불가 영상에서 자동 건너뛰기 금지).
   * 재생이 실제로 시작되거나 사용자가 새로 요청하면 꺼진다.
   */
  let awaitingUserAction = false

  /**
   * 라이브러리의 트랙을 큐에 넣을 **복사본**으로 만든다.
   *
   * 배열만이 아니라 트랙 객체까지 복사한다. 큐가 라이브러리 객체를 직접 들고 있으면 플레이어 쪽 상태가
   * 라이브러리의 구현 세부(제자리 수정을 하지 않는다)에 기댄다. 목록이 바뀌면 `followSource` 가 새
   * 복사본으로 다시 맞춘다 (ADR 0038).
   */
  function snapshot(tracks: readonly Track[]): Track[] {
    return tracks.map((track) => ({ ...track }))
  }

  /**
   * 목록 순서의 트랙들로 **재생 순서**를 만든다 (ADR 0038).
   *
   * 셔플이 꺼져 있으면 목록 순서 그대로다. 켜져 있으면 시작 곡을 맨 앞에 두고 나머지를 섞는다 — 시작
   * 곡은 지금 들릴 곡이고, 나머지는 반복이 꺼져 있어도 한 번씩 들린다.
   */
  function playOrder(
    list: readonly Track[],
    startIndex: number,
  ): { tracks: Track[]; index: number } {
    const first = list[startIndex]
    if (!playback.shuffle || first === undefined || list.length <= 1) {
      return { tracks: [...list], index: startIndex }
    }
    const rest = list.filter((_, position) => position !== startIndex)
    return { tracks: [first, ...shuffled(rest, random)], index: 0 }
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

  /**
   * 현재 트랙을 어댑터에 보낸다. 사용자 요청이므로 즉시 재생이다.
   *
   * `startSeconds` 는 Moment 재생이 넘긴다 (M9-3). 일반 트랙 재생은 넘기지
   * 않으므로 **처음부터** 다. 시점은 `load` 의 인자로 함께 실려 가고 뒤따르는
   * `seek` 이 없다 — 준비 전 보류에도 시점이 함께 남는다 (ADR 0020).
   */
  function commandCurrentTrack(startSeconds?: number): void {
    const track = playback.currentTrack
    if (track === null) return

    playback.setHasStartedPlaying(false)
    // 어댑터가 API·플레이어 준비 전 요청을 보류했다가 한 번만 실행한다
    // (ADR 0008). 여기서 준비 여부를 따로 따지지 않는다.
    adapter?.load(track.videoId, { autoplay: true, startSeconds })
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

  /**
   * 지금 곡을 **소리 없이** 플레이어에 올려 둔다 (ADR 0038).
   *
   * 지금 곡이 목록에서 지워져 다른 곡으로 옮겼는데 재생을 이어 가지 않을 때 쓴다. 화면의 "지금 곡" 과
   * 플레이어에 올라간 영상이 어긋나지 않게 한다 — 어긋나면 ▶ 가 지운 곡을 다시 튼다.
   */
  function cueCurrentTrack(): void {
    const track = playback.currentTrack
    if (track === null) return

    playback.setHasStartedPlaying(false)
    adapter?.load(track.videoId, { autoplay: false })
  }

  /** 안내를 지우고 대기 상태를 푼다. 사용자의 요청이 받아들여졌을 때다. */
  function clearStatus(): void {
    visibilityNotice = false
    awaitingUserAction = false
    playback.setStatus('')
  }

  function startQueue(
    tracks: readonly Track[],
    index: number,
    source: QueueSource | null,
  ): PlayRequestResult {
    // 가려져 있으면 **큐도 바꾸지 않는다.** 아무 일도 없던 것처럼 거절한다.
    const blocked = startBlock()
    if (blocked !== null) {
      refuseStart(blocked)
      return { ok: false, reason: 'player-hidden' }
    }

    const list = snapshot(tracks)
    const order = playOrder(list, index)
    playback.setQueue(order.tracks, order.index, source, list)
    startCurrent()
    return { ok: true }
  }

  function playPlaylist(playlistId: string): PlayRequestResult {
    const playlist = library.getPlaylist(playlistId)
    if (playlist === undefined) return { ok: false, reason: 'playlist-not-found' }
    // 빈 목록은 재생할 수 없다. 큐도 건드리지 않는다.
    if (playlist.tracks.length === 0) return { ok: false, reason: 'empty-playlist' }

    // 셔플이면 "처음부터" 의 첫 곡도 무작위다 — 늘 같은 곡으로 시작하면 섞은 것 같지 않다.
    const start = playback.shuffle ? randomIndex(playlist.tracks.length, random) : 0
    return startQueue(playlist.tracks, start, { playlistId: playlist.id, name: playlist.name })
  }

  function playTrack(playlistId: string, trackId: string): PlayRequestResult {
    const playlist = library.getPlaylist(playlistId)
    if (playlist === undefined) return { ok: false, reason: 'playlist-not-found' }
    if (playlist.tracks.length === 0) return { ok: false, reason: 'empty-playlist' }

    const index = playlist.tracks.findIndex((track) => track.id === trackId)
    if (index === -1) return { ok: false, reason: 'track-not-found' }

    // 고른 트랙 하나가 아니라 **목록 전체**가 큐가 된다. 그 트랙부터 시작할 뿐이다.
    return startQueue(playlist.tracks, index, { playlistId: playlist.id, name: playlist.name })
  }

  /* ---------------------------------------------------------------- *
   * 재생 큐 보기 (M11-7B)
   * ---------------------------------------------------------------- */

  /** 큐 안의 그 자리로 옮겨 재생한다. 큐를 다시 뜨지 않는다. */
  function playQueueIndex(index: number): PlayRequestResult {
    if (!Number.isInteger(index) || index < 0 || index >= playback.queue.length) {
      return { ok: false, reason: 'track-not-found' }
    }

    // 가시성을 위치 이동보다 먼저 본다 — 거절했는데 "지금 곡" 표시만 바뀌면 안 된다.
    const blocked = startBlock()
    if (blocked !== null) {
      refuseStart(blocked)
      return { ok: false, reason: 'player-hidden' }
    }

    playback.setQueueIndex(index)
    startCurrent()
    return { ok: true }
  }

  /* ---------------------------------------------------------------- *
   * 큐가 출처 목록을 따른다 (ADR 0038)
   * ---------------------------------------------------------------- */

  /**
   * 큐를 출처 목록의 지금 모습에 맞춘다. 출처 목록이 바뀔 때마다 아래 관찰자가 **동기로** 부른다 —
   * 보관함 편집 · 확장 저장 · 다른 탭의 변경이 모두 같은 길이다. 안내를 띄우지 않는다.
   *
   * | 지금 곡                 | 큐                                         | 플레이어                          |
   * | ----------------------- | ------------------------------------------ | --------------------------------- |
   * | 바뀐 목록에 **있다**    | 새 목록(셔플이면 섞인 순서 유지 + 새 곡 끼움) · 지금 곡 자리 | **명령 없음** — 소리 · 위치 그대로 |
   * | 지워졌고 뒤에 곡이 있다 | 새 목록 · 지운 곡 다음 곡                  | 소리가 나던 중이면 그 곡을 재생, 아니면 올려만 둔다 |
   * | 지워졌고 뒤에 곡이 없다 | 반복이면 처음 곡(위와 같다), 아니면 앞쪽 마지막 곡 | 올려만 둔다 (큐 끝처럼 멈춘다)    |
   * | 지워져 목록이 비었다    | 비운다                                     | 멈춘다                            |
   *
   * 지금 곡은 **트랙 id** 로 찾는다 (같은 영상이 여러 번 있을 수 있다). 출처 목록이 지워지면 따라갈 것이
   * 없으므로 큐는 그대로 끝까지 재생된다 (`deleted`).
   */
  function followSource(list: readonly Track[]): void {
    const source = playback.queueSource
    const current = playback.currentTrack
    if (source === null || current === null) return
    if (sameTracks(list, playback.queueListOrder)) return

    const fresh = snapshot(list)
    const byId = new Map(fresh.map((track) => [track.id, track]))
    const oldQueue = playback.queue
    const oldIndex = playback.queueIndex
    const currentSurvives = byId.has(current.id)

    let order: Track[] = fresh
    if (playback.shuffle) {
      // 지금까지 섞인 순서를 지키고(지운 곡만 빼고 · 이름은 새것으로), 새 곡은 아직 듣지 않은 자리에 끼운다.
      const kept = oldQueue.flatMap((track) => {
        const next = byId.get(track.id)
        return next === undefined ? [] : [next]
      })
      const keptIds = new Set(kept.map((track) => track.id))
      const added = fresh.filter((track) => !keptIds.has(track.id))
      const before = oldQueue.slice(0, oldIndex).filter((track) => byId.has(track.id)).length
      order = insertedRandomly(kept, added, currentSurvives ? before : before - 1, random)
    }

    const playlist = library.getPlaylist(source.playlistId)
    const nextSource: QueueSource = {
      playlistId: source.playlistId,
      name: playlist?.name ?? source.name,
    }

    if (currentSurvives) {
      const at = order.findIndex((track) => track.id === current.id)
      playback.setQueue(order, at, nextSource, fresh)
      return
    }

    // 지금 곡이 목록에서 빠졌다.
    if (order.length === 0) {
      stopForEmptySource()
      return
    }

    const indexOf = (track: Track): number => order.findIndex((item) => item.id === track.id)
    let target = -1
    for (const track of oldQueue.slice(oldIndex + 1)) {
      target = indexOf(track)
      if (target !== -1) break
    }
    let continues = target !== -1
    if (target === -1 && playback.wraps) {
      target = 0
      continues = true
    }
    if (target === -1) {
      // 뒤에 남은 곡이 없다 — 큐 끝처럼 앞쪽의 마지막 곡에 서서 멈춘다.
      for (const track of oldQueue.slice(0, oldIndex).reverse()) {
        target = indexOf(track)
        if (target !== -1) break
      }
      if (target === -1) target = order.length - 1
    }

    const wasSounding = isSounding()
    playback.setQueue(order, target, nextSource, fresh)
    // 지운 곡에 붙어 있던 안내(오류 등)는 더 이상 사실이 아니다.
    clearStatus()

    if (continues && wasSounding) {
      const blocked = startBlock()
      if (blocked === null) {
        commandCurrentTrack()
        return
      }
      refuseStart(blocked)
    }
    cueCurrentTrack()
  }

  /** 지금 곡이 지워져 출처 목록이 비었다 — 멈추고 큐를 비운다. 셔플 · 반복은 그대로다. */
  function stopForEmptySource(): void {
    adapter?.pause()
    playback.reset()
    awaitingUserAction = false
    visibilityNotice = false
  }

  /*
   * 출처 목록을 지켜본다. 라이브러리는 목록을 바꿀 때마다 **새 배열**로 갈아 끼우므로(`replaceTracks` ·
   * `restore`) 배열 참조가 바뀌면 내용이 바뀐 것이다. 동기 관찰자인 이유: 목록이 바뀐 순간과 큐가 따라간
   * 순간 사이에 "다음 곡" · 화면이 옛 큐를 보는 틈을 두지 않는다. `setQueue` 는 출처를 맨 마지막에 바꾸므로
   * 큐를 새로 뜨는 중에 불려도 반쯤 바뀐 큐를 보지 않는다.
   */
  watch(
    () => {
      const source = playback.queueSource
      return source === null ? undefined : library.getPlaylist(source.playlistId)?.tracks
    },
    (tracks) => {
      if (tracks !== undefined) followSource(tracks)
    },
    { flush: 'sync' },
  )

  /* ---------------------------------------------------------------- *
   * 셔플 · 반복 (ADR 0038)
   * ---------------------------------------------------------------- */

  const modes = computed<PlaybackModesView>(() => ({
    shuffle: playback.shuffle,
    repeat: playback.repeat,
  }))

  /**
   * 셔플을 켜거나 끈다. 지금 곡 · 재생 위치는 그대로다 — 플레이어에 명령하지 않고 큐의 순서만 바꾼다.
   *
   * 켜면 지금 곡을 맨 앞에 두고 나머지를 섞는다. 끄면 목록 순서로 돌아가 지금 곡의 자리에 선다.
   */
  function setShuffle(on: boolean): void {
    if (playback.shuffle === on) return
    playback.setShuffle(on)

    const current = playback.currentTrack
    if (current === null) return
    const list = playback.queueListOrder
    const at = list.findIndex((track) => track.id === current.id)
    if (at === -1) return

    const order = playOrder(list, at)
    playback.setQueue(order.tracks, order.index, playback.queueSource, list)
  }

  function setRepeat(mode: RepeatMode): void {
    if (!REPEAT_MODES.includes(mode)) return
    playback.setRepeat(mode)
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
    if (!playback.hasStartedPlaying) return
    // 오류 뒤에는 사용자의 다음 동작을 기다린다.
    if (awaitingUserAction) return

    // 가려진 곳에서 다음 곡을 시작하지 않는다. 위치도 움직이지 않는다.
    const blocked = startBlock()
    if (blocked !== null) {
      refuseStart(blocked)
      return
    }

    // 한 곡 반복 — 같은 자리에서 처음부터 다시 (ADR 0038). 수동 ⏭ · ⏮ 는 평소처럼 옮긴다.
    if (playback.repeat === 'one') {
      commandCurrentTrack()
      return
    }

    if (!playback.advance()) {
      // 큐 끝. 반복이 꺼져 있으면 멈춘다 (M3-0.1). 전체 반복이면 `advance` 가 처음으로 돌아간다.
      playback.setStatus(QUEUE_FINISHED_MESSAGE)
      return
    }

    commandCurrentTrack()
  }

  /* ---------------------------------------------------------------- *
   * Music Moments (M9-3, ADR 0020)
   * ---------------------------------------------------------------- */

  /**
   * 지금 재생 중인 영상의 시점을 찍는다.
   *
   * **같은 순간에 같은 영상의 값**임을 이렇게 보장한다. `currentTrack` 은
   * 어댑터에 적재를 명령하기 **직전에** 동기적으로 바뀌고(`setQueue` ·
   * `setQueueIndex` → `commandCurrentTrack`), 어댑터의 `position()` 은
   * 플레이어가 **마지막으로 명령받은 영상**을 보고할 때만 숫자를 준다
   * (계약). 둘을 한 호출 안에서 읽으므로 사이에 끼어들 명령이 없다. 전환
   * 직후 플레이어가 아직 이전 영상을 보고하는 창에서는 `null` 이다 —
   * 오래된 위치가 새 영상의 Moment 로 저장되는 길이 없다.
   *
   * 내림은 여기서 한다. 어댑터는 플레이어의 실수를 그대로 전하고, "정수 초"
   * 는 도메인 규칙이다 (`MOMENTS_DESIGN.md` §4). 유효하지 않은 값은 0 으로
   * 바꾸지 않고 `null` 이다.
   */
  function capturePosition(): MomentCapture | null {
    const track = playback.currentTrack
    if (track === null || adapter === null) return null

    /*
     * 마지막 명령 이후 **실제로 재생이 시작된 뒤의** 위치만 믿는다 (M9-4).
     *
     * 새 영상을 적재하면 플레이어는 지정 시점으로 가기 전 약 200ms 동안 `0` 을
     * 보고한다 (M9-3 실측). 그 `0` 은 **영상은 맞고 시간만 틀리다** — 어댑터의
     * 영상 식별 판정을 통과한다. 그대로 찍으면 0초짜리 Moment 가 생긴다.
     * 저장 버튼의 활성 상태도 같은 판정(`isPositionReliable`)을 쓴다.
     */
    if (!playback.isPositionReliable) return null

    const raw = adapter.position()
    // 어댑터가 이미 가리지만 다른 구현체를 믿지 않는다 — 한 번 더 본다.
    if (raw === null || !Number.isFinite(raw) || raw < 0) return null

    return { videoId: track.videoId, atSeconds: Math.floor(raw), title: track.title }
  }

  /** 가사 맞추기용 시계 (ADR 0046) — `capturePosition` 과 같은 판정, 초는 내리지 않는다. */
  function captureClock(): PlaybackClock | null {
    const track = playback.currentTrack
    if (track === null || adapter === null || !playback.isPositionReliable) return null
    const raw = adapter.position()
    if (raw === null || !Number.isFinite(raw) || raw < 0) return null
    const length = adapter.duration?.() ?? null
    return {
      videoId: track.videoId,
      seconds: raw,
      duration: length !== null && Number.isFinite(length) && length > 0 ? length : null,
    }
  }

  /**
   * 지금 적재된 영상 안에서 `seek` 으로 옮길 수 있는가.
   *
   * 플레이어가 그 영상의 위치를 알고 있어야 한다 — 준비 전이면 `seek` 은
   * 버려지고 `play` 만 보류되어 **처음부터** 재생된다. 오류 상태의 플레이어에
   * 보내는 `seek` 도 아무 일을 하지 않는다 (`togglePlay` 가 오류에서 다시
   * 적재하는 것과 같은 이유). 두 경우는 시점을 실어 다시 적재한다.
   */
  function canSeekInPlace(): boolean {
    return adapter?.position() !== null && playback.playerState !== 'error'
  }

  /**
   * 그 영상을 라이브러리에서 찾는다 (`MOMENTS_DESIGN.md` §4-2).
   * **선택된 플레이리스트**를 먼저, 그다음 라이브러리 순서다. 같은 영상이
   * 한 목록에 여러 번 있으면 처음 것부터다.
   */
  function locateInLibrary(
    videoId: string,
  ): { tracks: readonly Track[]; index: number; source: QueueSource } | null {
    const selected = library.selectedPlaylist
    const ordered =
      selected === null
        ? library.playlists
        : [selected, ...library.playlists.filter((playlist) => playlist.id !== selected.id)]

    for (const playlist of ordered) {
      const index = playlist.tracks.findIndex((track) => track.videoId === videoId)
      if (index !== -1) {
        return {
          tracks: playlist.tracks,
          index,
          source: { playlistId: playlist.id, name: playlist.name },
        }
      }
    }
    return null
  }

  /**
   * 라이브러리 어디에도 없는 영상을 위한 **단일 곡**.
   *
   * "트랙을 지워도 Moment 는 산다" 를 실제 동작으로 만드는 자리다. id 는
   * 라이브러리의 UUID 와 겹칠 수 없는 모양이라 `trackRemoved(id)` 가 이것을
   * 집지 못한다. 제목은 Moment 의 스냅샷을 쓰고, 없으면 트랙과 같은 대체
   * 표기다 — 새 규칙을 만들지 않는다.
   */
  function standaloneTrack(videoId: string, title: string | undefined): Track {
    const trimmed = title?.trim() ?? ''
    return {
      id: `moment:${videoId}`,
      source: 'youtube',
      videoId,
      title: trimmed === '' ? defaultTrackTitle(videoId) : trimmed,
    }
  }

  /**
   * Moment 가 가리키는 지점부터 재생한다.
   *
   * 영상 선택과 큐 규칙 — 위에서부터 **처음 맞는 줄**이다.
   *
   * | 그 `videoId` 가 있는 곳   | 큐                                | 명령                            |
   * | ------------------------- | --------------------------------- | ------------------------------- |
   * | **지금 영상**, 위치를 안다 | 그대로                            | `seek` + `play` — 재적재 없음   |
   * | 지금 영상, 준비 전·오류    | 그대로                            | 같은 영상을 시점과 함께 재적재  |
   * | **현재 큐**의 다른 자리    | **그대로**, 위치만 옮김           | `load(videoId, { startSeconds })` |
   * | 선택된 플레이리스트        | 그 목록, 그 트랙부터              | 같음                            |
   * | 다른 플레이리스트          | 처음 발견한 목록                  | 같음                            |
   * | 어디에도 없다              | **그 한 곡** — 이전·다음 비활성   | 같음                            |
   *
   * 셋째 줄은 M9-1 §4-2 에 없던 것을 M9-3 이 더했다. 듣고 있던 큐 안의 영상인데
   * 선택 목록이 바뀌었다는 이유로 큐를 갈아치우면, 사용자가 듣던 순서가
   * 예고 없이 바뀐다. 듣던 큐(셔플이면 섞인 순서)를 지킨다.
   *
   * 가시성 가드는 **다른 재생 요청과 같다** (ADR 0011). 가려져 있으면 큐도
   * 바꾸지 않고 `player-hidden` 으로 거절한다. 거절 문구도 같은 자리에 뜬다.
   *
   * 시점은 **정확히 그 초**다. 앞당기지 않는다 (ADR 0020 결정 5).
   */
  function playMoment(target: MomentTarget): MomentPlayResult {
    // 저장소에서 온 값이라도 믿지 않는다. 재생 전에 한 번 더 본다.
    if (!isYouTubeVideoId(target.videoId) || !isValidAtSeconds(target.atSeconds)) {
      return { ok: false, reason: 'invalid-moment' }
    }
    // 명령을 받을 플레이어가 없으면 시작할 수 없다. 성공으로 돌려주지 않는다.
    if (adapter === null) return { ok: false, reason: 'player-unavailable' }

    const blocked = startBlock()
    if (blocked !== null) {
      refuseStart(blocked)
      return { ok: false, reason: 'player-hidden' }
    }

    const { videoId, atSeconds } = target
    const current = playback.currentTrack

    if (current !== null && current.videoId === videoId) {
      if (canSeekInPlace()) {
        clearStatus()
        /*
         * 이 명령의 재생이 시작되기 전에 오는 `ENDED` 는 그 명령보다 오래된
         * 신호다 — 끝나 가던 영상에서 시점을 되돌리는 순간 끝 신호가 뒤늦게
         * 도착할 수 있다. 그것을 믿으면 사용자가 고른 순간을 건너뛰고 다음
         * 곡이 나온다. `load` 경로가 쓰는 것과 같은 규칙이다.
         */
        playback.setHasStartedPlaying(false)
        adapter.seek(atSeconds)
        // YouTube 는 일시정지 중의 seek 에서 멈춘 채로 남는다. 재생을 보장한다.
        adapter.play()
        return { ok: true }
      }

      // 준비 전이거나 오류다. 큐는 그대로 두고 시점을 실어 다시 적재한다.
      clearStatus()
      commandCurrentTrack(atSeconds)
      return { ok: true }
    }

    const inQueue = playback.queue.findIndex((track) => track.videoId === videoId)
    if (inQueue !== -1) {
      // 듣고 있던 큐 안이다. 큐를 바꾸지 않고 자리만 옮긴다.
      playback.setQueueIndex(inQueue)
    } else {
      const located = locateInLibrary(videoId)
      // 목록에서 찾았으면 그 목록이 출처다. 어디에도 없으면 출처를 **모른다** (추정하지 않는다).
      if (located !== null) {
        const list = snapshot(located.tracks)
        const order = playOrder(list, located.index)
        playback.setQueue(order.tracks, order.index, located.source, list)
      } else playback.setQueue([standaloneTrack(videoId, target.title)], 0)
    }

    clearStatus()
    commandCurrentTrack(atSeconds)
    return { ok: true }
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
        playback.setHasStartedPlaying(true)
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
      playback.setStatus(errorMessage(info), 'warning', 'player-error')
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

    // `reset()` 이 `hasStartedPlaying` 도 되돌린다 — 이전 큐의 늦은 ENDED 를 막는다.
    playback.reset()
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

  /** 지금 큐의 곡 — 읽기 전용 보기 (M11-3, `NowPlaying`). */
  const nowPlaying = computed<NowPlaying | null>(() => {
    const track = playback.currentTrack
    if (track === null) return null
    return { trackId: track.id, videoId: track.videoId, playing: playback.isPlaying }
  })

  /**
   * 지금 큐 — 읽기 전용 보기 (M11-7B, `QueueView`).
   *
   * 출처 목록이 있으면 큐는 그 목록을 따르고 있다 (`followSource` 가 동기로 맞춘다 — ADR 0038). 이름은
   * 목록의 **지금 이름**이다.
   */
  const queue = computed<QueueView | null>(() => {
    const tracks = playback.queue
    if (tracks.length === 0) return null

    const index = playback.queueIndex
    const stored = playback.queueSource
    if (stored === null) return { tracks, index, source: null, sourceState: 'unknown' }

    const playlist = library.getPlaylist(stored.playlistId)
    if (playlist === undefined) return { tracks, index, source: stored, sourceState: 'deleted' }

    return {
      tracks,
      index,
      source: { playlistId: playlist.id, name: playlist.name },
      sourceState: 'in-sync',
    }
  })

  return {
    nowPlaying,
    queue,
    playQueueIndex,
    modes,
    setShuffle,
    setRepeat,
    playPlaylist,
    playTrack,
    togglePlay,
    next,
    previous,
    libraryReplaced,
    playerWillHide,
    revalidatePlayerVisibility,
    setBottomObstruction,
    attachAdapter,

    // Music Moments (M9-3). 재생만 안다 — 저장은 Moments store 의 일이다.
    capturePosition,
    captureClock,
    playMoment,
  }
}
