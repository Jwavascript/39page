/**
 * 툴바 아이콘으로 알리기 (M10-5) — 단축키는 팝업이 없으므로, 담지 못했을 때 그 탭의
 * 아이콘에 배지(`!`)와 이유(툴팁)를 단다. 권한이 필요 없다 (`chrome.action`).
 *
 * 라우터·단축키 처리기는 이 인터페이스만 안다. 실제 구현은 `chromeActionPort.ts`.
 */
export interface ActionPort {
  /** 그 탭의 아이콘에만 배지와 툴팁을 단다. */
  flag(tabId: number, message: string): Promise<void>
  /** 그 탭의 배지와 툴팁을 기본으로 되돌린다. */
  clear(tabId: number): Promise<void>
  /**
   * 그 탭에서 아이콘을 누를 때 팝업을 띄울지 (M11-6). `false` 면 `action.onClicked` 로 바로 패널을 연다 —
   * 팝업이 잠깐 떴다 닫히는 깜빡임이 없다. 탭이 닫히면 Chrome 이 지운다.
   */
  usePopup(tabId: number, enabled: boolean): Promise<void>
  /** 팝업을 연다 — Chrome 127+ 만. 없으면 아무것도 하지 않는다. */
  openPopup(): Promise<void>
}
