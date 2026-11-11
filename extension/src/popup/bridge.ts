/**
 * Popup 이 확장의 나머지와 이야기하는 유일한 길.
 *
 * 컴포넌트·composable 은 `chrome.*` 를 직접 부르지 않는다 — 이 인터페이스만 안다
 * (`AGENTS.md` 규칙 3). 테스트는 가짜 bridge 를 `provide` 한다.
 */
import type { InjectionKey } from 'vue'

import {
  fail,
  parseCollectOpened,
  parseMomentCaptured,
  parsePageInspection,
  parseResult,
  PROTOCOL_VERSION,
  type CollectOpened,
  type ExtensionRequest,
  type MomentCaptured,
  type PageInspection,
  type Result,
} from '@/shared/messages'
import { withTimeout } from '@/shared/timeout'

export type TabEvent =
  /** 지켜보는 탭의 주소·제목·로드 상태가 바뀌었다. */
  | { readonly kind: 'updated'; readonly tabId: number }
  /** 어느 창에서든 활성 탭이 바뀌었다 — 이 창인지는 다시 물어 확인한다. */
  | { readonly kind: 'activated'; readonly tabId: number }

export interface PopupBridge {
  /** 이 팝업이 속한 창의 활성 탭. 없으면 `null`. */
  activeTabId(): Promise<number | null>
  inspect(tabId: number): Promise<Result<PageInspection>>
  /** Quick Add — 사용자가 본 영상(`videoId`)으로 수집 화면을 연다 (M10-3). */
  collect(tabId: number, videoId: string): Promise<Result<CollectOpened>>
  /** Moment 캡처 — 누른 순간의 재생 시점으로 수집 화면을 연다 (M10-4). */
  captureMoment(tabId: number, videoId: string): Promise<Result<MomentCaptured>>
  /** 구독을 끊는 함수를 돌려준다. */
  subscribe(listener: (event: TabEvent) => void): () => void
}

export const BRIDGE_KEY: InjectionKey<PopupBridge> = Symbol('popup-bridge')

/** Background 가 content 주입·재시도(3초 × 2)까지 마치기에 넉넉한 한도. */
export const INSPECT_TIMEOUT_MS = 10_000

class TimeoutError extends Error {}

export function createChromeBridge(timeoutMs = INSPECT_TIMEOUT_MS): PopupBridge {
  /** Background 에 묻고 응답을 계약대로 검증한다. 실패는 결과로 돌려준다. */
  async function send<T>(
    request: ExtensionRequest,
    parseData: (data: unknown) => T | null,
  ): Promise<Result<T>> {
    try {
      const reply: unknown = await withTimeout(
        chrome.runtime.sendMessage(request),
        timeoutMs,
        () => new TimeoutError(),
      )
      return parseResult(reply, parseData)
    } catch (error) {
      return error instanceof TimeoutError
        ? fail('timeout', '확장이 제때 답하지 않았다')
        : fail('internal', '확장과 연결하지 못했다')
    }
  }

  return {
    async activeTabId() {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
      return tab?.id ?? null
    },

    inspect(tabId) {
      return send({ v: PROTOCOL_VERSION, type: 'tab/inspect', tabId }, parsePageInspection)
    },

    captureMoment(tabId, videoId) {
      return send(
        { v: PROTOCOL_VERSION, type: 'moment/capture', tabId, videoId },
        parseMomentCaptured,
      )
    },
    collect(tabId, videoId) {
      return send({ v: PROTOCOL_VERSION, type: 'collect/open', tabId, videoId }, parseCollectOpened)
    },

    subscribe(listener) {
      const onUpdated = (
        tabId: number,
        change: { url?: string; title?: string; status?: string },
      ) => {
        if (
          change.url !== undefined ||
          change.title !== undefined ||
          change.status === 'complete'
        ) {
          listener({ kind: 'updated', tabId })
        }
      }
      const onActivated = (info: { tabId: number }) => {
        listener({ kind: 'activated', tabId: info.tabId })
      }
      chrome.tabs.onUpdated.addListener(onUpdated)
      chrome.tabs.onActivated.addListener(onActivated)
      return () => {
        chrome.tabs.onUpdated.removeListener(onUpdated)
        chrome.tabs.onActivated.removeListener(onActivated)
      }
    },
  }
}
