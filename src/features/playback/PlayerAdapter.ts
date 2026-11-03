/**
 * 외부 플레이어를 감싸는 어댑터 계약.
 *
 * Vue 컴포넌트는 YouTube IFrame API를 **직접 호출하지 않는다.** 외부 플레이어의
 * 생성과 제거는 이 계약의 구현체가 담당하고, 컴포넌트는 안정적인 DOM 영역만
 * 제공한다 (`AGENTS.md` 규칙 4).
 *
 * M1-5에서는 계약과 수명주기만 확정한다. 실제 구현체
 * (`YouTubeIFramePlayerAdapter`)는 M3에서 만든다.
 * 이벤트 구독, 재시도, API 스크립트 로더는 지금 두지 않는다.
 */
import type { InjectionKey } from 'vue'

import type { PlayerState } from '@/shared/types'

export interface PlayerAdapter {
  /**
   * 플레이어를 `container` 안에 만든다.
   *
   * 어댑터는 `container`의 **자식 노드를 직접 생성해 소유한다.**
   * `container` 자체는 Vue가 소유하므로 교체하거나 지우지 않는다.
   * M3에서 `YT.Player`가 그 자식 노드를 iframe으로 교체한다.
   *
   * **중복 호출은 no-op이다.** 이미 마운트된 상태에서 다시 부르면 두 번째
   * 인스턴스를 만들지 않고 기존 노드를 그대로 둔다. 테마 전환이나 재렌더로
   * 실수로 다시 불려도 재생이 끊기지 않게 하기 위한 방어다.
   */
  mount(container: HTMLElement): void

  /**
   * 플레이어를 제거하고 자신이 만든 자식 노드를 정리한다.
   *
   * **중복 호출은 no-op이다.** 마운트되지 않은 상태에서 불러도 던지지 않는다.
   * `destroy()` 이후 `mount()`를 다시 부르면 새로 만든다.
   */
  destroy(): void

  /**
   * 영상을 적재한다. 어댑터를 재생성하지 않는다.
   *
   * M3에서는 `loadVideoById` / `cueVideoById`로 구현한다. API가 아직 준비되지
   * 않았으면 구현체가 내부적으로 요청을 보류한다 (프로토타입의 `wantsPlay` 패턴).
   */
  load(videoId: string): void

  play(): void

  pause(): void

  /**
   * 현재 재생 상태.
   *
   * YouTube의 숫자 상태값(-1, 0, 1, 2, 3, 5)을 노출하지 않는다. 숫자 →
   * `PlayerState` 변환은 구현체 내부에서만 일어난다.
   */
  state(): PlayerState
}

/** 어댑터를 만드는 팩토리. 인스턴스를 공유하지 않기 위해 팩토리로 주입한다. */
export type PlayerAdapterFactory = () => PlayerAdapter

/**
 * 어댑터 팩토리 주입 키.
 *
 * `PlayerSurface`는 이 키로 팩토리를 받는다. 주입되지 않으면 어댑터를 만들지
 * 않고 "연결되지 않음" 상태로 표시한다 — M1-5의 기본 상태다.
 *
 * - 테스트: `global.provide`로 `FakePlayerAdapter` 팩토리를 넣는다.
 * - M3: `main.ts`에서 `app.provide(...)`로 실제 어댑터 팩토리를 넣는다.
 *
 * props 로 넘기지 않는 이유: `PlayerSurface`는 `WidgetHost`가 레지스트리를
 * 보고 렌더하므로, props를 쓰려면 `WidgetHost`·`DashboardShell`까지 팩토리를
 * 꿰어야 한다. 주입이 그 세 파일을 건드리지 않는 가장 단순한 방법이다.
 */
export const PLAYER_ADAPTER_FACTORY: InjectionKey<PlayerAdapterFactory> = Symbol(
  '39page.playerAdapterFactory',
)
