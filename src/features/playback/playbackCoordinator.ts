/**
 * Playback Coordinator 의 **계약**.
 *
 * 구현은 `createPlaybackCoordinator.ts` 에 있다. 이 파일은 타입과 주입 키만
 * 담고 store 를 import 하지 않는다 — Record Library 가 재생을 요청할 때
 * 재생 구현 전체를 끌어오지 않게 하기 위해서다.
 * `features/library/drawerController.ts` 와 같은 구조다.
 *
 * 코디네이터가 있는 이유: 라이브러리와 재생은 **서로를 몰라야 한다**
 * (`AGENTS.md` 규칙 2, `SYSTEM_DESIGN.md` §6.1). 두 store 를 잇는 조립은
 * 상위 계층의 일이고, 그 조립이 여기다. `library` 는 읽기만 하고
 * `playback` 에는 큐 스냅샷을 쓴다. 두 store 는 여전히 서로를 모른다.
 *
 * 누가 무엇을 쓰는가:
 *   `RecordLibraryDrawer` → `PlaybackRequests` (재생 요청만)
 *   `PlayerTransport`     → `PlaybackTransport` (버튼 3개)
 *   `PlayerSurface`       → `attachAdapter` (플레이어 연결만)
 */
import type { InjectionKey } from 'vue'

import type { PlayerAdapter, PlayerAdapterEvents } from './PlayerAdapter'

/** 재생 요청이 거절된 이유. */
export type PlayRequestFailure =
  /** 그런 플레이리스트가 없다 */
  | 'playlist-not-found'
  /** 트랙이 하나도 없다. 빈 목록은 재생할 수 없다 */
  | 'empty-playlist'
  /** 그 플레이리스트에 그런 트랙이 없다 */
  | 'track-not-found'

export type PlayRequestResult = { ok: true } | { ok: false; reason: PlayRequestFailure }

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
 * 반복·셔플·탐색·볼륨 명령을 두지 않는다 (M3-0.1 · 0.3 · 0.4).
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
   * 큐 끝에서는 **움직이지 않고** `false`. 처음으로 돌아가지 않는다 (M3-0.1).
   */
  next(): boolean

  /** 이전 곡으로 간다. 큐 처음에서는 움직이지 않고 `false`. */
  previous(): boolean
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

export interface PlaybackCoordinator extends PlaybackRequests, PlaybackTransport {
  /**
   * 플레이어 어댑터를 등록한다.
   *
   * **어댑터를 만들고 없애는 책임은 여전히 `PlayerSurface` 에 있다**
   * (ADR 0006). 코디네이터는 빌려 쓸 뿐이고, Pinia state 나 `ref` 에
   * 넣지 않는다.
   *
   * MVP 에는 플레이어가 하나뿐이다. 두 번째가 등록되면 마지막 것이 이긴다.
   */
  attachAdapter(adapter: PlayerAdapter): PlayerAttachment
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
