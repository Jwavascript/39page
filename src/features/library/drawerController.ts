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

  /**
   * 재생을 요청하기 **전에** 플레이어를 가리지 않도록 비켜준다 (M7-2).
   *
   * 세로 화면에서 이 드로어는 화면 하단을 덮는 시트다. 그 상태에서 재생을
   * 요청하면 가드가 거절한다 — 실기기에서 "두 번째 곡으로 바꾸려고 재생을
   * 눌러도 오류가 나서 영상이 바뀌지 않는다" 로 보고됐다. 사용자는 안내를
   * 읽고 직접 닫기보다 **그냥 닫히고 재생되는 것**을 원했다.
   *
   * 왜 호출부가 부르는가: 재생 요청(`playPlaylist` 등)은 **동기**다. 코디네이터
   * 안에서 비켜달라고 기다릴 수 없다. 그래서 요청하기 전에 호출부가 기다린다.
   *
   * **가리지 않으면 아무 일도 하지 않는다.** 넓은 화면에서는 드로어가 정보 열
   * 안에서 끝나므로 닫지 않는다 — 편집 중인 맥락을 괜히 잃지 않는다. 가리는지
   * 아는 쪽이 셸이므로 판단도 셸이 한다.
   */
  stepAside(): Promise<void>
}

export const LIBRARY_DRAWER: InjectionKey<LibraryDrawerController> = Symbol('39page.libraryDrawer')
