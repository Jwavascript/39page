/**
 * Record Library 드로어의 열림 상태를 공유하는 통로.
 *
 * 드로어를 여는 트리거(`DeckWidget`)와 드로어 자신(`RecordLibraryDrawer`)은
 * `WidgetHost` 를 사이에 두고 떨어져 있다. `DeckWidget` 은 레지스트리를 통해
 * 렌더되므로 props 로 상태를 내려보내려면 `WidgetHost` 와 `DashboardShell`
 * 까지 드로어 전용 prop 을 꿰어야 한다.
 *
 * 그래서 주입을 쓴다. M1-5 의 `PLAYER_ADAPTER_FACTORY` 와 같은 이유이고 같은
 * 방식이다 (`docs/decisions/0006-player-adapter-ownership.md`).
 *
 * 전역 Pinia store 를 새로 만들지 않는다. 열림 여부는 화면 하나의 UI 상태이고
 * 영속화 대상도 아니다.
 */
import type { InjectionKey, Ref } from 'vue'

export interface LibraryDrawerController {
  /** 열려 있는지. */
  readonly isOpen: Readonly<Ref<boolean>>
  /** 드로어 루트의 DOM id. 트리거의 `aria-controls` 가 가리킨다. */
  readonly drawerId: string
  /** 연다. 트리거 쪽에서 호출한다. */
  open(): void
  /** 닫는다. 닫기 버튼·Escape 에서 호출한다. */
  close(): void
}

export const LIBRARY_DRAWER: InjectionKey<LibraryDrawerController> = Symbol('39page.libraryDrawer')
