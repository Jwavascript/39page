/**
 * 외부 플레이어를 감싸는 어댑터 계약.
 *
 * Vue 컴포넌트는 YouTube IFrame API를 **직접 호출하지 않는다.** 외부 플레이어의
 * 생성과 제거는 이 계약의 구현체가 담당하고, 컴포넌트는 안정적인 DOM 영역만
 * 제공한다 (`AGENTS.md` 규칙 4).
 *
 * 구현체는 둘이다.
 *   `YouTubeIFramePlayerAdapter` — 실제 IFrame API (M3-1)
 *   `FakePlayerAdapter` — 테스트용. 같은 계약을 실제로 구현한다
 *
 * M3-1 에서 계약을 한 번 개정했다 (ADR 0008): `mount()` 가 이벤트 핸들러를,
 * `load()` 가 자동재생 의도를 받는다. 두 인자 모두 **선택**이라 이벤트를
 * 쓰지 않는 호출부는 그대로다.
 *
 * M9-3 에서 두 번째로 개정했다 (ADR 0020): `position()` 과 `seek()` 이 늘고,
 * `load()` 가 시작 시점(`startSeconds`)을 선택으로 받는다. Music Moments 가
 * "지금 몇 초인가" 를 묻고 "그 초로 가라" 고 명령하기 위해서다. 두 메서드는
 * **필수**다 — 선택이면 두 구현체가 조용히 갈라진다.
 */
import type { InjectionKey } from 'vue'

import type { PlayerState } from '@/shared/types'

/**
 * 재생이 실패한 이유. YouTube 숫자 코드를 도메인 종류로 바꾼 값이다.
 *
 * 변환은 **어댑터 안에서만** 한다. 밖에서 `code === 101 || code === 150` 을
 * 쓰면 YouTube 특이사항이 UI 코드로 새어 나간다.
 */
export type PlayerErrorKind =
  /** API 스크립트 자체를 못 받았다. YouTube 오류 코드가 아니다 */
  | 'api-unavailable'
  /** 2 — 파라미터 값이 잘못됐다 (영상 ID 가 11자가 아닌 경우 등) */
  | 'invalid-parameter'
  /** 5 — HTML5 플레이어에서 재생할 수 없다 */
  | 'not-playable'
  /** 100 — 영상을 찾을 수 없다 (삭제·비공개) */
  | 'not-found'
  /** 101 · 150 — 영상 소유자가 임베드 재생을 허용하지 않는다 */
  | 'embed-not-allowed'
  /** 153 — 요청에 HTTP `Referer` 헤더가 없다 */
  | 'referrer-missing'
  /** 문서에 없는 코드 */
  | 'unknown'

export interface PlayerErrorInfo {
  kind: PlayerErrorKind
  /**
   * YouTube 원본 코드. 승인된 디자인이 사용자에게 번호를 보여준다 (`오류 101`).
   * 스크립트 로드 실패에는 코드가 없어 `null` 이다.
   */
  code: number | null
}

/**
 * 어댑터가 알려주는 사건. 전부 선택이다.
 *
 * 폴링으로 대체할 수 없는 것만 둔다. `ENDED` 는 즉시 다음 상태로 넘어가므로
 * 간격 안에서 사라지고, 자동재생 차단은 상태값에 흔적을 남기지 않는다.
 *
 * 구독/해지 API 를 두지 않는다. 핸들러 수명이 마운트 수명과 같아서
 * `destroy()` 가 버리면 끝이다 (ADR 0008).
 */
export interface PlayerAdapterEvents {
  /**
   * 플레이어가 명령을 받을 수 있게 됐다.
   *
   * 보류했던 요청은 어댑터가 **이 콜백 전에** 이미 흘려보낸다. 호출부가
   * 여기서 다시 `play()` 를 부를 필요가 없다.
   */
  ready?(): void

  /**
   * 재생 상태가 **바뀌었다.** 같은 상태를 두 번 알리지 않는다.
   *
   * YouTube 숫자값이 아니라 도메인 `PlayerState` 가 들어온다.
   */
  stateChange?(state: PlayerState): void

  /**
   * 재생이 실패했다.
   *
   * 순서가 정해져 있다: `stateChange('error')` 가 **먼저**, 이것이 **나중**이다.
   * 상태만 보는 구독자와 이유까지 보는 구독자가 같은 순서를 본다.
   */
  error?(info: PlayerErrorInfo): void

  /**
   * 브라우저가 자동재생을 막았다.
   *
   * 오류가 아니다. 사용자가 플레이어의 ▶ 를 직접 누르면 재생된다.
   */
  autoplayBlocked?(): void
}

export interface PlayerLoadOptions {
  /**
   * `true` → 즉시 재생 (`loadVideoById`).
   * 생략·`false` → 적재만 하고 대기 (`cueVideoById`).
   *
   * 어느 쪽인지는 호출부만 안다. 사용자가 트랙을 눌렀으면 즉시 재생이고,
   * 복원된 포인터나 큐 이동 준비는 대기다 (`MVP_SPEC.md` F3).
   */
  autoplay?: boolean

  /**
   * 이 초부터 시작한다 (M9-3, ADR 0020). 생략하면 처음부터.
   *
   * **`load` 의 인자인 이유**: 다른 영상의 시점으로 갈 때 `load()` 뒤에
   * `seek()` 을 따로 부르면 경쟁이 생긴다 — 새 영상이 준비되기 전의 `seek`
   * 은 이전 영상에 적용되거나 사라진다. YouTube 가 공식으로 주는
   * `loadVideoById({ videoId, startSeconds })` 에 실어 보내면 경쟁할 것이 없다.
   *
   * 준비 전에 보류된 요청에도 **함께 보존된다.** 유효하지 않은 값
   * (음수 · `NaN` · `Infinity`)은 **없는 것으로 취급**한다 — 처음부터 적재한다.
   * 조용히 다른 시점으로 가는 것보다 처음부터 트는 것이 사용자가 알아차리기
   * 쉽다.
   */
  startSeconds?: number
}

/**
 * 플레이어에 보낼 수 있는 초인가. **유한한 0 이상의 수**다.
 *
 * 어댑터 계층의 규칙이라 소수를 허용한다 — 플레이어는 소수 초를 받는다.
 * "정수 초" 는 Moment 도메인의 규칙이고 그쪽에서 적용한다 (`stores/moments`).
 *
 * 두 구현체가 **같은 함수**를 쓴다. 각자 적으면 갈라진다.
 */
export function isValidPlayerSeconds(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

export interface PlayerAdapter {
  /**
   * 플레이어를 `container` 안에 만들 **준비를 한다.**
   *
   * 어댑터는 `container`의 **자식 노드를 직접 생성해 소유한다.**
   * `container` 자체는 Vue가 소유하므로 교체하거나 지우지 않는다.
   *
   * 실제 `YT.Player` 는 **첫 `load()` 에서** 만든다. 재생할 영상이 생기기
   * 전에는 youtube.com iframe 을 붙이지 않는다 — 승인된 프로토타입의 동작이고,
   * 음악을 틀지 않는 방문에 외부 요청을 만들지 않기 위해서다 (ADR 0008).
   *
   * **중복 호출은 no-op이다.** 이미 마운트된 상태에서 다시 부르면 두 번째
   * 인스턴스를 만들지 않고 기존 노드를 그대로 둔다. 테마 전환이나 재렌더로
   * 실수로 다시 불려도 재생이 끊기지 않게 하기 위한 방어다.
   *
   * @param events 생략하면 사건을 알리지 않는다. `destroy()` 가 버린다.
   */
  mount(container: HTMLElement, events?: PlayerAdapterEvents): void

  /**
   * 플레이어를 제거하고 자신이 만든 자식 노드를 정리한다.
   *
   * 이 뒤에 도착하는 비동기 콜백은 **무효다.** 구현체가 걸러낸다.
   *
   * **중복 호출은 no-op이다.** 마운트되지 않은 상태에서 불러도 던지지 않는다.
   * `destroy()` 이후 `mount()`를 다시 부르면 새로 만든다.
   */
  destroy(): void

  /**
   * 영상을 적재한다. **어댑터와 플레이어를 재생성하지 않는다.**
   *
   * API 나 플레이어가 아직 준비되지 않았으면 구현체가 요청을 보류하고,
   * 준비된 뒤 **한 번** 실행한다. 보류 중에 다시 부르면 마지막 것만 남는다.
   * 마운트되지 않은 상태에서는 아무 일도 하지 않는다.
   */
  load(videoId: string, options?: PlayerLoadOptions): void

  /**
   * 재생한다.
   *
   * 준비 전이면 보류한다. 적재된 영상이 없으면 아무 일도 하지 않는다.
   */
  play(): void

  /**
   * 일시정지한다. 보류 중이던 재생 요청도 함께 취소한다.
   */
  pause(): void

  /**
   * 현재 재생 상태.
   *
   * YouTube의 숫자 상태값(-1, 0, 1, 2, 3, 5)을 노출하지 않는다. 숫자 →
   * `PlayerState` 변환은 구현체 내부에서만 일어난다.
   */
  state(): PlayerState

  /**
   * 현재 재생 위치(초) (M9-3, ADR 0020).
   *
   * 플레이어가 준 값을 **그대로** 전한다 — 소수일 수 있다. 내림은 도메인
   * 규칙이므로 호출부(코디네이터)가 한다.
   *
   * 다음은 전부 **`null`** 이다. 숫자를 지어내지 않는다.
   * - 마운트 전 · 플레이어 준비 전 · 적재된 영상이 없다
   * - 플레이어가 **마지막으로 적재를 명령한 영상과 다른 영상**을 보고하고
   *   있다 — 영상 전환 직후의 창이다. 그때의 숫자는 이전 영상의 것이다
   * - 플레이어의 응답이 유한한 0 이상의 수가 아니다
   *
   * `0` 과 `null` 이 다르다. `0` 은 "맨 앞" 이고 `null` 은 "모른다" 다.
   * 이 둘을 섞으면 0초짜리 Moment 가 생긴다.
   */
  position(): number | null

  /**
   * 적재된 **같은 영상** 안에서 지정한 초로 이동한다 (M9-3, ADR 0020).
   *
   * 플레이어 인스턴스와 iframe 을 그대로 둔다 — 적재된 플레이어에 보내는
   * 명령이지 재생성이 아니다 (ADR 0002).
   *
   * 준비 전이면 **보류하지 않고 버린다.** `load()` 와 달리 보류 큐를 두지
   * 않는다 — 다른 영상으로 가려면 `load(videoId, { startSeconds })` 를 쓴다.
   * 유효하지 않은 초(음수 · `NaN` · `Infinity`)도 **조용히 적용하지 않는다.**
   *
   * 이동 뒤의 재생·정지는 플레이어가 정한다. YouTube 는 **일시정지 중이면
   * 그대로 멈춰 있고, 그 밖의 상태에서는 재생을 시작한다.** 재생을 보장하려면
   * 호출부가 `play()` 를 이어서 부른다.
   */
  seek(seconds: number): void
}

/** 어댑터를 만드는 팩토리. 인스턴스를 공유하지 않기 위해 팩토리로 주입한다. */
export type PlayerAdapterFactory = () => PlayerAdapter

/**
 * 어댑터 팩토리 주입 키.
 *
 * `PlayerSurface`는 이 키로 팩토리를 받는다. 주입되지 않으면 어댑터를 만들지
 * 않고 "연결되지 않음" 상태로 표시한다.
 *
 * - 테스트: `global.provide`로 `FakePlayerAdapter` 팩토리를 넣는다.
 * - 앱: `main.ts`가 `YouTubeIFramePlayerAdapter` 팩토리를 넣는다 (M3-1).
 *
 * props 로 넘기지 않는 이유: `PlayerSurface`는 `WidgetHost`가 레지스트리를
 * 보고 렌더하므로, props를 쓰려면 `WidgetHost`·`DashboardShell`까지 팩토리를
 * 꿰어야 한다. 주입이 그 세 파일을 건드리지 않는 가장 단순한 방법이다.
 */
export const PLAYER_ADAPTER_FACTORY: InjectionKey<PlayerAdapterFactory> = Symbol(
  '39page.playerAdapterFactory',
)
