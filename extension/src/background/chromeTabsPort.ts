/**
 * `TabsPort` 의 실제 구현 — `chrome.tabs` · `chrome.scripting`.
 *
 * Chrome 은 실패를 오류 **문구**로만 알려 준다. 문구를 실패 종류로 옮기는 일은
 * `classifyChromeError` 한 곳에서 하고, 실제 Chromium 에서 확인한다 (M10-2).
 */
import { withTimeout } from '@/shared/timeout'

import { readPlayersInPage } from './pageFunctions'
import { PortError, type PortFailure, type TabsPort } from './tabsPort'

/** content script 가 manifest 에 없으므로 주입할 파일 이름을 여기서만 안다. */
export const CONTENT_SCRIPT_FILE = 'content.js'

export function classifyChromeError(error: unknown): PortFailure {
  const message = error instanceof Error ? error.message : String(error)
  if (/Receiving end does not exist|message port closed before a response/i.test(message)) {
    return 'no-receiver'
  }
  if (/No tab with id|tab was closed|Frame with ID \d+ was removed/i.test(message)) return 'no-tab'
  if (/Cannot access|Missing host permission|cannot be scripted|permission/i.test(message)) {
    return 'no-access'
  }
  return 'other'
}

function toPortError(error: unknown): PortError {
  if (error instanceof PortError) return error
  const message = error instanceof Error ? error.message : String(error)
  return new PortError(classifyChromeError(error), message)
}

export function createChromeTabsPort(options: { readonly contentTimeoutMs: number }): TabsPort {
  return {
    async getTab(tabId) {
      try {
        const tab = await chrome.tabs.get(tabId)
        return { id: tab.id ?? tabId, url: tab.url }
      } catch {
        return null
      }
    },

    async sendToContent(tabId, message) {
      try {
        return await withTimeout(
          chrome.tabs.sendMessage(tabId, message, { frameId: 0 }),
          options.contentTimeoutMs,
          () => new PortError('timeout', 'content script 가 제때 답하지 않았다'),
        )
      } catch (error) {
        throw toPortError(error)
      }
    },

    async injectContent(tabId) {
      try {
        await chrome.scripting.executeScript({
          target: { tabId, frameIds: [0] },
          files: [CONTENT_SCRIPT_FILE],
        })
      } catch (error) {
        throw toPortError(error)
      }
    },

    async readPlayers(tabId) {
      try {
        const [first] = await chrome.scripting.executeScript({
          target: { tabId, frameIds: [0] },
          world: 'MAIN',
          func: readPlayersInPage,
        })
        return first?.result ?? null
      } catch (error) {
        throw toPortError(error)
      }
    },
  }
}
