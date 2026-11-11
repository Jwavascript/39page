/**
 * Background 메시지 라우터 (`docs/architecture/EXTENSION_DESIGN.md` §6).
 *
 * 1. 보낸 쪽 — 우리 확장의 **페이지**만 (content script · 다른 확장 · 웹페이지 거절)
 * 2. 봉투·필드 검증 — `@/shared/messages` 의 함수 하나
 * 3. 처리 — 예상하지 못한 예외는 `internal` 로 바꾸고 내부 정보를 싣지 않는다
 *
 * 상태를 갖지 않는다. 서비스 워커가 언제 다시 시작해도 같은 답을 한다.
 */
import { fail, parseExtensionRequest, type Result } from '@/shared/messages'

import { captureMoment } from './captureMoment'
import { inspectTab } from './inspectTab'
import { openCollect, type CollectDeduper } from './openCollect'
import type { TabsPort } from './tabsPort'

/** `chrome.runtime.MessageSender` 중 라우터가 보는 부분. */
export interface SenderLike {
  readonly id?: string
  readonly url?: string
}

export interface RouterDeps {
  readonly port: TabsPort
  readonly extensionId: string
  /** `chrome.runtime.getURL('')` — `chrome-extension://<id>/`. */
  readonly extensionOrigin: string
  /** Quick Add (M10-3) · Moment 캡처 (M10-4) — 같은 수집 origin · 같은 중복 기록. */
  readonly collect: {
    readonly origin: string
    readonly deduper: CollectDeduper
    readonly newRequestId: () => string
    readonly now: () => number
  }
}

export function isTrustedSender(sender: SenderLike, deps: RouterDeps): boolean {
  return (
    sender.id === deps.extensionId &&
    typeof sender.url === 'string' &&
    sender.url.startsWith(deps.extensionOrigin)
  )
}

export function createBackgroundRouter(deps: RouterDeps) {
  async function handle(message: unknown, sender: SenderLike): Promise<Result<unknown>> {
    if (!isTrustedSender(sender, deps)) {
      return fail('forbidden-sender', '이 확장의 페이지가 보낸 요청만 받는다')
    }

    const parsed = parseExtensionRequest(message)
    if (!parsed.ok) return fail(parsed.error.code, parsed.error.message)

    try {
      switch (parsed.value.type) {
        case 'tab/inspect':
          return await inspectTab(deps.port, parsed.value.tabId)
        case 'collect/open':
          return await openCollect(
            { port: deps.port, ...deps.collect },
            parsed.value.tabId,
            parsed.value.videoId,
          )
        case 'moment/capture':
          return await captureMoment(
            { port: deps.port, ...deps.collect },
            parsed.value.tabId,
            parsed.value.videoId,
          )
      }
    } catch {
      return fail('internal', '확장 내부 오류')
    }
  }

  return { handle }
}
