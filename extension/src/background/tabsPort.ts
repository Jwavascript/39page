/**
 * Background 가 탭에 하는 일 세 가지 — 조회 · content 질의 · content 주입.
 *
 * 라우터는 이 인터페이스만 안다. 테스트는 가짜를 넣고, 실제 구현은
 * `chromeTabsPort.ts` 가 `chrome.tabs` · `chrome.scripting` 으로 한다.
 */
import type { ContentRequest } from '@/shared/messages'

export interface TabInfo {
  readonly id: number
  /** `activeTab` 이나 호스트 권한이 없으면 `undefined` (공식 tabs 레퍼런스). */
  readonly url: string | undefined
}

export type PortFailure =
  /** 그 탭에 우리 content script 리스너가 없다. */
  | 'no-receiver'
  /** 권한이 없거나 제한된 페이지라 주입할 수 없다. */
  | 'no-access'
  /** 탭이 사라졌다. */
  | 'no-tab'
  | 'timeout'
  | 'other'

export class PortError extends Error {
  readonly failure: PortFailure

  constructor(failure: PortFailure, message: string) {
    super(message)
    this.name = 'PortError'
    this.failure = failure
  }
}

export interface TabsPort {
  /** 탭이 없으면 `null`. */
  getTab(tabId: number): Promise<TabInfo | null>
  /** 최상위 프레임의 content script 에 묻는다. 실패는 `PortError` 로 거절한다. */
  sendToContent(tabId: number, message: ContentRequest): Promise<unknown>
  /** `content.js` 를 최상위 프레임에 주입한다. 실패는 `PortError` 로 거절한다. */
  injectContent(tabId: number): Promise<void>
  /**
   * 최상위 프레임의 메인 세계에서 `readPlayersInPage` 를 실행하고 그 결과를
   * **검증하지 않은 채** 돌려준다. 실패는 `PortError` 로 거절한다.
   */
  readPlayers(tabId: number): Promise<unknown>
}
