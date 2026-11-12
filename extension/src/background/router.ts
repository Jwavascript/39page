/**
 * Background 메시지 라우터 (`docs/architecture/EXTENSION_DESIGN.md` §6).
 *
 * 1. 보낸 쪽 — 우리 확장의 **페이지**만 (content script · 다른 확장 · 웹페이지 거절)
 * 2. 봉투·필드 검증 — `@/shared/messages` 의 함수 하나
 * 3. 처리 — 예상하지 못한 예외는 `internal` 로 바꾸고 내부 정보를 싣지 않는다
 *
 * 상태를 갖지 않는다. 서비스 워커가 언제 다시 시작해도 같은 답을 한다.
 */
import { fail, ok, parseExtensionRequest, type Result } from '@/shared/messages'

import type { BridgeState } from '@/shared/bridgeMessages'

import type { BridgeClient } from './bridgeClient'
import { captureMoment } from './captureMoment'
import {
  bindPanel,
  capturePanel,
  closePanel,
  collectFromPanel,
  isBoundPanel,
  openPanel,
  syncPanel,
  type PanelSession,
} from './panel'
import { inspectTab } from './inspectTab'
import { openCollect, type CollectDeduper } from './openCollect'
import type { TabsPort } from './tabsPort'

/** `chrome.runtime.MessageSender` 중 라우터가 보는 부분. */
export interface SenderLike {
  readonly id?: string
  readonly url?: string
  /** 탭 안의 확장 페이지(YouTube 위 패널)면 그 탭 (M11-5). 팝업 · 서비스 워커는 없다. */
  readonly tab?: { readonly id?: number }
  /** 보낸 문서 (Chrome 106+). 패널을 그 탭의 한 문서에 묶는다. */
  readonly documentId?: string
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
  /** YouTube 위 패널 (M11-5B) — 탭마다의 지시 · 묶인 문서. 워커 메모리다. */
  readonly panel?: {
    readonly sessions: Map<number, PanelSession>
    /**
     * 패널 페이지 경로 (`/src/panel/index.html`). 보낸 쪽이 우리 확장 origin(`isTrustedSender`)이고 이
     * 경로면 패널 요청이다. 경로로 본다 — `use_dynamic_url` 자원은 워커의 `getURL()` 이 세션마다 바뀌는
     * 동적 주소를 돌려주지만, 패널이 보낸 `sender.url` 은 확장 ID 주소다 (실측 2026-11-12).
     */
    readonly panelPath: string
  }
  /** 저장 브리지 (M11-5). 없으면 브리지 요청을 `unsupported-type` 으로 거절한다 (시험 · 구버전 구성). */
  readonly bridge?: {
    readonly client: BridgeClient
    readonly origin: string
    readonly originPattern: string
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

    /*
     * 패널(탭 안의 확장 페이지)에서 온 요청 — 대상 탭은 보낸 쪽 탭이고, 그 탭에 묶인 문서여야 한다.
     * 처음 동기화(`panel/sync`)가 연 직후의 문서를 묶는다. 묶이지 않은 패널 문서는 아무것도 못 한다.
     */
    const panel = deps.panel
    const fromPanel =
      panel !== undefined &&
      typeof sender.url === 'string' &&
      new URL(sender.url).pathname === panel.panelPath
    const panelTab = sender.tab?.id
    const panelDeps =
      panel === undefined
        ? undefined
        : { port: deps.port, ...deps.collect, sessions: panel.sessions }
    if (fromPanel) {
      if (panelDeps === undefined || panelTab === undefined) {
        return fail('forbidden-sender', '탭 밖의 패널')
      }
      const allowed =
        parsed.value.type === 'panel/sync'
          ? bindPanel(panelDeps, panelTab, sender.documentId)
          : isBoundPanel(panelDeps, panelTab, sender.documentId)
      if (!allowed) return fail('forbidden-sender', '이 탭에 묶인 패널이 아니다')
    } else if (
      parsed.value.type === 'panel/sync' ||
      parsed.value.type === 'panel/capture' ||
      parsed.value.type === 'panel/close' ||
      parsed.value.type === 'panel/collect'
    ) {
      return fail('forbidden-sender', '패널만 보낼 수 있다')
    }

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
        case 'bridge/state': {
          if (deps.bridge === undefined) return fail('unsupported-type', '저장 브리지가 없다')
          const state: BridgeState = {
            permission: (await deps.bridge.client.hasPermission()) ? 'granted' : 'not-granted',
            origins: [deps.bridge.originPattern],
            origin: deps.bridge.origin,
          }
          return ok(state)
        }
        case 'bridge/call':
          if (deps.bridge === undefined) return fail('unsupported-type', '저장 브리지가 없다')
          return ok(await deps.bridge.client.call(parsed.value.payload, parsed.value.requestId))
        case 'panel/open':
          if (panelDeps === undefined) return fail('unsupported-type', '패널이 없다')
          return await openPanel(panelDeps, parsed.value.tabId, parsed.value.mode)
        case 'panel/sync':
          if (panelDeps === undefined || panelTab === undefined) break
          return await syncPanel(panelDeps, panelTab)
        case 'panel/capture':
          if (panelDeps === undefined || panelTab === undefined) break
          return await capturePanel(panelDeps, panelTab, parsed.value.videoId)
        case 'panel/close':
          if (panelDeps === undefined || panelTab === undefined) break
          return await closePanel(panelDeps, panelTab)
        case 'panel/collect':
          if (panelDeps === undefined || panelTab === undefined) break
          return await collectFromPanel(panelDeps, panelTab, parsed.value)
      }
      return fail('forbidden-sender', '패널 요청을 받을 수 없다')
    } catch {
      return fail('internal', '확장 내부 오류')
    }
  }

  return { handle }
}
