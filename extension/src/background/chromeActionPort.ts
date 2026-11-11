/** `ActionPort` 의 실제 구현 — `chrome.action` (권한 없이 쓸 수 있다). */
import type { ActionPort } from './actionPort'

export function createChromeActionPort(defaultTitle: string): ActionPort {
  return {
    async flag(tabId, message) {
      try {
        await chrome.action.setBadgeBackgroundColor({ tabId, color: '#b3261e' })
        await chrome.action.setBadgeText({ tabId, text: '!' })
        await chrome.action.setTitle({ tabId, title: `39page — ${message}` })
      } catch {
        /* 탭이 닫혔다 — 알릴 곳이 없다 */
      }
    },
    async clear(tabId) {
      try {
        await chrome.action.setBadgeText({ tabId, text: '' })
        await chrome.action.setTitle({ tabId, title: defaultTitle })
      } catch {
        /* 탭이 닫혔다 */
      }
    },
  }
}
