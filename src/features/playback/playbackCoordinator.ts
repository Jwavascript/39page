/**
 * Playback Coordinator 의 **계약**.
 *
 * 구현은 `createPlaybackCoordinator.ts` 에 있다. 이 파일은 타입과 주입 키만
 * 담고 store 를 import 하지 않는다 — Record Library 가 재생을 요청할 때
 * 재생 구현 전체를 끌어오지 않게 하기 위해서다.
 * `features/archive/archiveController.ts` 와 같은 구조다.
 *
 * 코디네이터가 있는 이유: 라이브러리와 재생은 **서로를 몰라야 한다**
 * (`AGENTS.md` 규칙 2, `SYSTEM_DESIGN.md` §6.1). 두 store 를 잇는 조립은
 * 상위 계층의 일이고, 그 조립이 여기다. `library` 는 읽기만 하고
 * `playback` 에는 큐 스냅샷을 쓴다. 두 store 는 여전히 서로를 모른다.
 *
 * 누가 무엇을 쓰는가:
 *   `RecordLibraryDrawer` → `PlaybackRequests` · `PlaybackLibraryNotices`
 *   `PlayerTransport`     → `PlaybackTransport` (버튼 3개) · `PlaybackModes` (셔플 · 반복, ADR 0038)
 *   `PlayerSurface`       → `attachAdapter` (플레이어·가시성 연결만)
 *   `DashboardShell`      → `PlaybackVisibility` (가리기 전 통지)
 *   Moments UI (M9-4)     → `PlaybackMoments` (시점 캡처 · Moment 재생)
 */
import type { InjectionKey, Ref } from 'vue'

import type { RepeatMode, Track } from '@/shared/types'

import type { PlayerAdapter, PlayerAdapterEvents } from './PlayerAdapter'
import type { PlayerPresence } from './playerVisibility'

/** 재생 요청이 거절된 이유. */
export type PlayRequestFailure =
  /** 그런 플레이리스트가 없다 */
  | 'playlist-not-found'
  /** 트랙이 하나도 없다. 빈 목록은 재생할 수 없다 */
  | 'empty-playlist'
  /** 그 플레이리스트에 그런 트랙이 없다 */
  | 'track-not-found'
  /**
   * 플레이어가 가려져 있거나 너무 작다 (M3-4).
   *
   * 큐를 **바꾸지 않는다.** 아무 일도 일어나지 않은 상태로 거절한다.
   * 가려진 플레이어로 소리만 내지 않기 위해서다 (개발자 정책 III.I.9).
   */
  | 'player-hidden'

export type PlayRequestResult = { ok: true } | { ok: false; reason: PlayRequestFailure }

/**
 * Moment 재생이 거절된 이유 (M9-3, ADR 0020).
 *
 * 기존 `PlayRequestFailure` 를 **포함한다** — `player-hidden` 은 다른 재생
 * 요청과 같은 가시성 가드에서 같은 이유로 나온다. 둘이 더 있다.
 */
export type MomentPlayFailure =
  | PlayRequestFailure
  /** `videoId` 가 11자 형식이 아니거나 `atSeconds` 가 0 이상 정수가 아니다 */
  | 'invalid-moment'
  /**
   * 등록된 플레이어가 없다. 명령을 받을 곳이 없으므로 **성공으로 돌려주지
   * 않는다** — 재생을 시작할 수 없으면 `ok: true` 가 아니다.
   */
  | 'player-unavailable'

export type MomentPlayResult = { ok: true } | { ok: false; reason: MomentPlayFailure }

/**
 * `capturePosition()` 이 찍어 주는 값 (M9-3). Moment 를 만들 재료다.
 *
 * 저장은 하지 않는다. Moments store 에 넣는 것은 UI 의 일이다 — 코디네이터는
 * 재생을 알고 저장을 모른다 (`MOMENTS_DESIGN.md` §4).
 */
export interface MomentCapture {
  videoId: string
  /** `position()` 의 실수를 **내림한 정수**. 도메인 규칙은 여기서 적용한다. */
  atSeconds: number
  /** 지금 화면에 보이는 제목. 그대로 Moment 의 스냅샷이 된다. */
  title: string
}

/** `playMoment()` 의 대상. 저장된 `Moment` 에서 필요한 것만 뗀 모양이다. */
export interface MomentTarget {
  videoId: string
  atSeconds: number
  /**
   * 그 영상이 **라이브러리 어디에도 없을 때** 단일 곡 큐의 표시 이름으로 쓴다.
   * 라이브러리에 있으면 그쪽 제목이 쓰이므로 무시된다. 생략하면
   * `YouTube · <videoId>` 다.
   */
  title?: string
}

/**
 * Music Moments 명령 (M9-3, ADR 0020). Moments UI 가 쓰는 부분이다.
 *
 * UI 는 어댑터도 YouTube API 도 모른 채 이 둘만 부른다.
 */
/** `captureClock()` 의 값 (ADR 0046). */
export interface PlaybackClock {
  readonly videoId: string
  /** 소수 초. */
  readonly seconds: number
  /** 영상 길이(초). 플레이어가 아직 모르면 `null`. */
  readonly duration: number | null
}

export interface PlaybackMoments {
  /**
   * 지금 재생 중인 영상의 시점을 찍는다.
   *
   * 다음은 전부 **`null`** 이다 — 숫자를 지어내지 않고 0초로 대체하지 않는다.
   * - 현재 트랙이 없다 · 플레이어가 등록돼 있지 않다
   * - 플레이어가 아직 시점을 모른다 (준비 전 · 영상 전환 직후)
   * - 플레이어의 값이 유한한 0 이상의 수가 아니다
   *
   * `null` 이면 저장 버튼은 **비활성**이어야 한다.
   */
  capturePosition(): MomentCapture | null

  /**
   * 가사 맞추기용 재생 시계 (ADR 0046) — `capturePosition()` 과 **같은 판정**이되 초를 내리지 않고, 곡 길이(모르면
   * `null`)를 함께 준다. 표시용이다 — 저장에 쓰지 않는다.
   */
  captureClock(): PlaybackClock | null

  /**
   * Moment 가 가리키는 지점부터 재생한다.
   *
   * 다른 재생 요청과 **같은 가시성 가드**를 지난다 (ADR 0011) — 가려져 있으면
   * `player-hidden` 으로 거절되고 큐는 바뀌지 않는다. 영상·시점 이동 정책과
   * 큐 규칙은 `createPlaybackCoordinator.ts` 의 `playMoment` 에 있다.
   */
  playMoment(target: MomentTarget): MomentPlayResult
}

/**
 * `player-hidden` 으로 거절됐을 때 **누른 자리**에 띄울 안내 (M7-1).
 *
 * 세 표면(편집 시트 · 플레이리스트 위젯 · 데크)이 같은 문구를 쓰므로 여기에
 * 한 번만 둔다. 재생을 요청하는 쪽들이 공유하는 유일한 모듈이 이 계약 파일이다.
 *
 * 코디네이터도 플레이어의 `.status` 에 비슷한 안내를 적지만 **그것으로는
 * 부족하다.** 세로 화면의 시트는 플레이어를 덮을 수 있고, 그러면 그 안내도
 * 함께 덮인다. 사용자가 보고 있는 곳에 있어야 읽힌다.
 *
 * M6-5 에서 이 문구를 지웠다가 M7-1 에서 되살렸다. 그때의 근거("플레이어는
 * 가려지지 않는다")가 시트 도입으로 더 이상 성립하지 않는다.
 *
 * **"창을 닫으세요" 라고 말하지 않는다** (M7-2). 재생을 누르면 시트가 스스로
 * 비켜주므로 닫는 것은 더 이상 사용자가 할 일이 아니고, 위젯·데크에서 눌렀을
 * 때는 닫을 창이 없을 수도 있다. 남은 사정은 **영상이 화면 밖**인 경우다.
 */
export const PLAY_REFUSED_HIDDEN_MESSAGE =
  '영상이 가려져 재생할 수 없어요. 영상이 보이는 곳으로 올린 뒤 다시 눌러주세요.'

/**
 * 재생 요청 입구. 라이브러리 UI 가 쓰는 부분이다.
 *
 * 요청은 **플레이리스트와 트랙의 id** 로 한다. 호출부가 큐를 만들어 넘기지
 * 않는다. 스냅샷을 뜨는 책임이 한 곳에 모여 있어야 "큐는 재생 시작 시점의
 * 복사본" 이라는 보장이 흩어지지 않는다.
 */
export interface PlaybackRequests {
  /** 목록 전체를 큐로 만들고 **처음부터** 재생한다. */
  playPlaylist(playlistId: string): PlayRequestResult

  /** 목록 전체를 큐로 만들고 **그 트랙부터** 재생한다. */
  playTrack(playlistId: string, trackId: string): PlayRequestResult
}

/**
 * 트랜스포트 명령 (M3-3). 컨트롤 3개가 쓰는 부분이다.
 *
 * UI 는 `PlayerAdapter` 도 YouTube API 도 직접 부르지 않는다. 여기를 거친다.
 * 탐색·볼륨 명령을 두지 않는다 (M3-0.3 · 0.4). 셔플 · 반복은 `PlaybackModes` 다 (ADR 0038).
 */
export interface PlaybackTransport {
  /**
   * 재생 중이면 멈추고, 아니면 재생한다.
   *
   * 현재 트랙이 없으면 아무 일도 하지 않는다. 상태별 동작은
   * `createPlaybackCoordinator.ts` 의 표에 있다.
   */
  togglePlay(): void

  /**
   * 다음 곡으로 간다.
   *
   * 큐 끝에서는 반복이 꺼져 있으면 **움직이지 않고** `false` (M3-0.1), 켜져 있으면 처음으로 간다.
   */
  next(): boolean

  /** 이전 곡으로 간다. 큐 처음에서는 반복이 꺼져 있으면 움직이지 않고 `false`, 켜져 있으면 끝으로 간다. */
  previous(): boolean
}

/**
 * 반복 모드의 이름 (ADR 0038). Now Playing 카드의 반복 단추와 NOW PLAYLIST 의 표시가 같은 말을 쓴다 —
 * 두 표면이 공유하는 모듈이 이 계약 파일이다 (`PLAY_REFUSED_HIDDEN_MESSAGE` 와 같은 이유).
 */
export const REPEAT_LABEL: Readonly<Record<RepeatMode, string>> = {
  off: '반복 끔',
  all: '전체 반복',
  one: '한 곡 반복',
}

/** 지금 재생 방식 (ADR 0038). */
export interface PlaybackModesView {
  readonly shuffle: boolean
  readonly repeat: RepeatMode
}

/**
 * 셔플 · 반복 (ADR 0038). Now Playing 카드의 단추가 쓰고, NOW PLAYLIST 가 표시만 읽는다.
 *
 * **저장하지 않는다** — 큐처럼 이 탭의 메모리에만 있다. 바꿔도 지금 곡 · 재생 위치는 그대로다 —
 * 플레이어에는 아무 명령도 가지 않고 큐의 순서만 바뀐다.
 */
export interface PlaybackModes {
  readonly modes: Readonly<Ref<PlaybackModesView>>

  /**
   * 셔플을 켜거나 끈다.
   *
   * 켜면 지금 곡을 큐의 맨 앞에 두고 나머지를 섞는다. 끄면 목록 순서로 돌아가 지금 곡의 자리에 선다.
   * 큐가 없으면 표시만 바뀌고, 다음에 시작하는 큐부터 섞인다.
   */
  setShuffle(on: boolean): void

  setRepeat(mode: RepeatMode): void
}

/**
 * 라이브러리 변경 통지 (M3-5). 백업 복원이 쓴다.
 *
 * 트랙 하나의 추가 · 삭제 · 순서 · 이름 변경은 **알릴 필요가 없다** — 코디네이터가 큐의 출처 목록을 직접
 * 지켜보고 따라간다 (ADR 0038). M3-5 의 `trackRemoved` 는 그래서 없앴다.
 */
export interface PlaybackLibraryNotices {
  /**
   * 라이브러리가 **통째로 교체됐다** (M8-3, 백업 복원).
   *
   * 멈추고 **큐를 비운다.** 큐가 출처 목록을 따라가더라도 교체는 다르게 다룬다 — 같은 id 의 목록이 새
   * 내용으로 돌아올 수 있고, 복원은 사용자가 "지금까지와 다른 보관함" 을 고른 것이다. 듣던 곡이 이어지면
   * 무엇이 복원됐는지 헷갈린다. 목록에서 다시 고르게 한다.
   *
   * **교체가 성공했을 때만 부른다.** 실패한 복원 때문에 재생을 멈추지 않는다.
   */
  libraryReplaced(): void
}

/**
 * 가시성 통지 (M3-4). 플레이어를 가리는 쪽이 쓴다.
 *
 * 왜 통지를 받는가: 재생 쪽은 드로어도 브레이크포인트도 모른다. 가리는 것을
 * **아는 쪽**(`DashboardShell`)이 가리기 **전에** 알려줘야 그 사이 가려진 채로
 * 소리가 나지 않는다.
 */
export interface PlaybackVisibility {
  /**
   * 플레이어가 곧 가려진다고 알린다. 재생 중이면 즉시 멈춘다.
   *
   * 가려진 **뒤**에 알리면 늦다. 관찰자는 비동기라 그 사이 한 프레임 이상
   * 가려진 채로 재생된다 (개발자 정책 III.I.9).
   */
  playerWillHide(): void

  /**
   * 가시성이 바뀌었을 수 있다고 알린다. 다시 재서 필요하면 멈춘다.
   *
   * 멈췄다가 다시 보이게 되어도 **자동으로 재생하지 않는다.** 사용자가
   * 다시 눌러야 한다.
   */
  revalidatePlayerVisibility(): void

  /**
   * 뷰포트 **하단**을 우리 UI 가 덮은 높이를 알린다 (M7-1). 0 이면 가림 없음.
   *
   * 세로 화면의 레코드 시트가 플레이어를 덮을 수 있게 되면서 필요해졌다.
   * 가시성 측정은 **덮인 것을 스스로 알 수 없으므로**(`playerVisibility.ts`)
   * 가리는 쪽이 숫자를 넘겨야 한다. 재생 쪽은 무엇이 가리는지 모른다 — 시트도
   * 드로어도 브레이크포인트도 모르고 픽셀만 안다 (`AGENTS.md` 규칙 4).
   *
   * 값이 바뀌면 **즉시 다시 잰다.** 덮이는 순간 멈춰야 하고, 걷히는 순간
   * 안내가 지워져야 한다. 멈춘 뒤 자동으로 재생하지는 않는다.
   */
  setBottomObstruction(px: number): void
}

/** `attachAdapter()` 가 돌려주는 연결. */
export interface PlayerAttachment {
  /**
   * `adapter.mount()` 에 그대로 넘길 핸들러 묶음.
   *
   * 코디네이터가 소유한다. 호출부가 다시 감싸지 않는다.
   */
  readonly events: PlayerAdapterEvents

  /** 연결을 끊는다. `PlayerSurface` 가 언마운트에서 부른다. */
  detach(): void
}

/**
 * 지금 큐의 곡 (M11-3). 라이브러리 화면이 "재생 중" 을 표시할 때 읽는다.
 *
 * 화면은 playback store 를 직접 보지 않는다 (ADR 0009 — 라이브러리가 아는 것은 이 계약뿐이다).
 * 그래서 계약이 **읽기 전용 보기**를 내준다. 바꾸는 방법은 여전히 요청(`playTrack` 등)뿐이다.
 */
export interface NowPlaying {
  /** 큐의 트랙 id — 라이브러리 트랙 id 와 같다. 라이브러리 밖 영상(Moment 재생)이면 라이브러리에 없을 수 있다. */
  readonly trackId: string
  readonly videoId: string
  /** 실제로 소리가 나는 중인지. 일시정지 · 적재 중이면 `false` (그래도 "지금 곡" 이다). */
  readonly playing: boolean
}

export interface PlaybackNowPlaying {
  readonly nowPlaying: Readonly<Ref<NowPlaying | null>>
}

/* ------------------------------------------------------------------ *
 * 재생 큐 보기 (M11-7B, ADR 0030 · ADR 0038)
 * ------------------------------------------------------------------ */

/**
 * 큐의 출처 목록이 지금 어떤 상태인가.
 *
 * | 값          | 뜻                                                                         |
 * | ----------- | -------------------------------------------------------------------------- |
 * | `unknown`   | 출처를 모른다 (목록 밖 영상의 Moment 재생 등). **목록 이름을 추정하지 않는다** |
 * | `in-sync`   | 큐가 출처 목록을 따르고 있다 — 곡 추가 · 삭제 · 순서 · 이름이 바로 반영된다   |
 * | `deleted`   | 출처 목록이 지워졌다 — 큐는 끝까지 재생할 수 있다                            |
 *
 * M11-7B 의 `changed`(목록이 바뀌었는데 큐는 그대로)는 없앴다 — 큐가 목록을 바로 따라간다 (ADR 0038).
 */
export type QueueSourceState = 'unknown' | 'in-sync' | 'deleted'

/**
 * 지금 재생 큐의 **읽기 전용 보기**.
 *
 * "보관함에서 고른 목록" 과 다른 것이다 — 고른 목록을 바꿔도 이 보기는 바뀌지 않는다
 * (`SYSTEM_DESIGN.md` §6.1). 화면은 playback store 를 직접 보지 않고 이것을 읽는다 (ADR 0009).
 */
export interface QueueView {
  /** 큐의 트랙 — **실제 재생 순서**다 (셔플이면 섞인 순서). */
  readonly tracks: readonly Track[]
  /** 지금 곡의 큐 안 위치 (0 부터). */
  readonly index: number
  /**
   * 출처 목록. 모르면 `null`.
   * `name` 은 목록이 아직 있으면 **지금 이름**, 지워졌으면 큐를 뜬 순간의 이름이다.
   */
  readonly source: { readonly playlistId: string; readonly name: string } | null
  readonly sourceState: QueueSourceState
}

export interface PlaybackQueue {
  /** 지금 큐. 큐가 비어 있으면 `null` — 화면은 그때 고른 목록을 "재생 대기" 로 보인다. */
  readonly queue: Readonly<Ref<QueueView | null>>

  /**
   * **큐 안의 그 자리**로 옮겨 처음부터 재생한다.
   *
   * 큐를 다시 뜨지 않는다 — 보이는 순서와 들리는 순서가 같다. 자리(인덱스)로 고르므로 같은 영상이
   * 큐에 여러 번 있어도 누른 그 항목이 재생된다. 지금 곡의 자리를 주면 그 곡을 처음부터 다시 튼다.
   * 다른 재생 요청과 같은 가시성 가드를 지난다 — 가려져 있으면 `player-hidden`, 위치는 그대로.
   * 범위를 벗어나면 `track-not-found`.
   */
  playQueueIndex(index: number): PlayRequestResult
}

export interface PlaybackCoordinator
  extends
    PlaybackNowPlaying,
    PlaybackQueue,
    PlaybackModes,
    PlaybackRequests,
    PlaybackTransport,
    PlaybackLibraryNotices,
    PlaybackVisibility,
    PlaybackMoments {
  /**
   * 플레이어 어댑터를 등록한다.
   *
   * **어댑터를 만들고 없애는 책임은 여전히 `PlayerSurface` 에 있다**
   * (ADR 0006). 코디네이터는 빌려 쓸 뿐이고, Pinia state 나 `ref` 에
   * 넣지 않는다.
   *
   * MVP 에는 플레이어가 하나뿐이다. 두 번째가 등록되면 마지막 것이 이긴다.
   *
   * `presence` 는 **그 플레이어 영역을 재고 끌어오는 쪽**이다 (M3-4).
   * 영역을 소유한 쪽만 할 수 있으므로 어댑터와 함께 등록한다. 넘기지 않으면
   * 가시성 판정을 하지 않는다 — 플레이어 영역 없이 코디네이터만 세우는
   * 테스트를 위한 기본값이다.
   */
  attachAdapter(adapter: PlayerAdapter, presence?: PlayerPresence): PlayerAttachment
}

/**
 * 코디네이터 주입 키.
 *
 * `src/app/App.vue` 가 하나 만들어 내려보낸다. 두 기능을 모두 아는 유일한
 * 계층이 거기다 (`SYSTEM_DESIGN.md` §6.1).
 *
 * 주입되지 않으면 소비자는 아무 요청도 하지 않는다. 컴포넌트를 단독으로
 * 마운트하는 테스트가 코디네이터 없이도 동작하게 하기 위해서다.
 */
export const PLAYBACK_COORDINATOR: InjectionKey<PlaybackCoordinator> = Symbol(
  '39page.playbackCoordinator',
)
