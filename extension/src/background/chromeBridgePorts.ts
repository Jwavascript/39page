/**
 * 저장 브리지의 `chrome.*` 연결 (M11-5). 판단은 `bridgeClient.ts` 가 한다 — 여기는 옮기기만 한다.
 */
import type { OffscreenMessage } from '@/shared/bridgeMessages'

import type { OffscreenPort, PermissionPort } from './bridgeClient'

/** manifest 의 offscreen 입구 (빌드 산출물 경로). */
export const OFFSCREEN_PATH = 'src/offscreen/index.html'

export function createChromeOffscreenPort(): OffscreenPort {
  return {
    async exists() {
      const contexts = await chrome.runtime.getContexts({
        contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
      })
      return contexts.length > 0
    },
    async create(gen) {
      await chrome.offscreen.createDocument({
        url: `${OFFSCREEN_PATH}?gen=${String(gen)}`,
        reasons: [chrome.offscreen.Reason.IFRAME_SCRIPTING],
        justification:
          '39page 사이트의 저장 페이지를 iframe 으로 띄워, 사용자가 YouTube 위 패널에서 고른 곡 · Moment 를 39page 의 기존 저장 규칙으로 저장합니다.',
      })
    },
    async close() {
      await chrome.offscreen.closeDocument()
    },
    send(message: OffscreenMessage) {
      return chrome.runtime.sendMessage(message)
    },
  }
}

export function createChromePermissionPort(originPattern: string): PermissionPort {
  return {
    contains: () => chrome.permissions.contains({ origins: [originPattern] }),
  }
}
