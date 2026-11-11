/**
 * content script 의 메시지 리스너.
 *
 * - 우리 확장(`sender.id`)이 보낸 것만 답한다.
 * - 같은 검증 함수(`parseContentRequest`)로 확인하고, 모르는 요청은 실패로 답한다.
 * - 먼저 말하지 않는다. 페이지의 `postMessage` 를 듣지 않는다.
 */
import { fail, ok, parseContentRequest, type PageSnapshot, type Result } from '@/shared/messages'

export type ContentListener = (
  message: unknown,
  sender: { readonly id?: string },
  sendResponse: (response: Result<unknown>) => void,
) => false

export function createContentListener(deps: {
  readonly extensionId: string
  readonly read: () => PageSnapshot
}): ContentListener {
  return (message, sender, sendResponse) => {
    if (sender.id !== deps.extensionId) {
      sendResponse(fail('forbidden-sender', '이 확장이 보낸 요청만 받는다'))
      return false
    }

    const parsed = parseContentRequest(message)
    if (!parsed.ok) {
      sendResponse(fail(parsed.error.code, parsed.error.message))
      return false
    }

    try {
      sendResponse(ok(deps.read()))
    } catch {
      sendResponse(fail('internal', '페이지를 읽지 못했다'))
    }
    // 응답을 이미 보냈다 — 채널을 열어 둘 필요가 없다.
    return false
  }
}

/** `chrome.runtime.onMessage` 중 설치에 필요한 부분. */
export interface MessageEventLike {
  addListener(listener: ContentListener): void
  removeListener(listener: ContentListener): void
}

/** 격리된 세계의 전역에 지금 리스너를 걸어 둔다. */
export const LISTENER_SLOT = '__page39ContentListener'

/**
 * 리스너를 **하나만** 건다.
 *
 * 같은 문서에 다시 주입되면(수신자 없음 → 재주입 경쟁, 확장 새로고침 뒤의 고아
 * 스크립트) 앞의 리스너를 떼고 새로 건다. 떼기가 실패해도(옛 확장 문맥) 새
 * 리스너는 건다.
 */
export function installContentListener(
  events: MessageEventLike,
  slotOwner: Record<string, unknown>,
  listener: ContentListener,
): void {
  const previous = slotOwner[LISTENER_SLOT]
  if (typeof previous === 'function') {
    try {
      events.removeListener(previous as ContentListener)
    } catch {
      /* 옛 확장 문맥 — 이미 끊겼다 */
    }
  }
  events.addListener(listener)
  slotOwner[LISTENER_SLOT] = listener
}
