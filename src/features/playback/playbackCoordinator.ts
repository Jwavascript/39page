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
 *   `RecordLibraryDrawer` → `PlaybackRequests` · `PlaybackLibraryNotices`
 *   `PlayerTransport`     → `PlaybackTransport` (버튼 3개)
 *   `PlayerSurface`       → `attachAdapter` (플레이어·가시성 연결만)
 *   `DashboardShell`      → `PlaybackVisibility` (가리기 전 통지)
 */
import type { InjectionKey } from 'vue'

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

/**
 * 라이브러리 변경 통지 (M3-5). Record Library UI 가 쓴다.
 *
 * 큐는 스냅샷이므로 라이브러리를 고쳐도 자동으로 끊기지 않는다. 재생 중인
 * 곡이 지워진 경우만 예외다 — 멈추고 알려야 한다 (`MVP_SPEC.md` F4).
 * 그 판단을 코디네이터가 하도록 **사실만** 알린다.
 */
export interface PlaybackLibraryNotices {
  /**
   * 트랙이 라이브러리에서 지워졌다.
   *
   * 지금 재생 중인 트랙이면 멈추고 안내한다. 아니면 아무 일도 없다.
   * 큐는 어느 경우에도 바뀌지 않는다.
   */
  trackRemoved(trackId: string): void

  /**
   * 라이브러리가 **통째로 교체됐다** (M8-3, 백업 복원).
   *
   * 멈추고 **큐를 비운다.** 트랙 하나가 지워진 것과 다르게 다루는 이유:
   *
   * 큐는 재생 시작 시점의 스냅샷이고, 라이브러리를 편집해도 흔들리지 않는 것이
   * 그 성질이다 (`MVP_SPEC.md` F4). 그런데 통째로 교체되면 큐가 가리키는
   * 라이브러리 자체가 사라진다 — 계속 재생하면 사용자가 **목록에서 찾을 수
   * 없는 곡**이 흐르고, 다음·이전은 없는 트랙 사이를 오간다. 스냅샷을 지키는
   * 것이 오히려 혼란이 되는 유일한 경우다.
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

export interface PlaybackCoordinator
  extends PlaybackRequests, PlaybackTransport, PlaybackLibraryNotices, PlaybackVisibility {
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
