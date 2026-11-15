/** `ActionPort` 의 실제 구현 — `chrome.action` (권한 없이 쓸 수 있다). */
import type { ActionPort } from './actionPort'

/** manifest `action.default_popup` 과 같다. */
export const POPUP_PATH = 'src/popup/index.html'

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
    async usePopup(tabId, enabled) {
      try {
        await chrome.action.setPopup({ tabId, popup: enabled ? POPUP_PATH : '' })
      } catch {
        /* 탭이 닫혔다 */
      }
    },
    async openPopup() {
      const open = (chrome.action as { openPopup?: () => Promise<void> }).openPopup
      if (typeof open !== 'function') return
      try {
        await open()
      } catch {
        /* 창이 없거나 이 버전에서 막혔다 — 배지가 대신 알린다 */
      }
    },
  }
}
