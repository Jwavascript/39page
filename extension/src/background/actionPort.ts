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
}
