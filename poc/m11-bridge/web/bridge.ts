/**
 * M11-1 저장 브리지 PoC — 39page origin 의 화면 없는 브리지 페이지.
 *
 * ⚠ 실험 코드다. 운영 빌드(`vite build`)의 입력이 아니다. PoC 빌드
 * (`poc/m11-bridge/vite.config.ts`)만 이 페이지를 만든다.
 *
 * 두 가지 자리에서 실험한다.
 * 1. **액자 모드 (후보 B)** — 확장의 offscreen 문서가 이 페이지를 iframe 으로 띄운다. 확장에
 *    39page 호스트 권한이 있으면 이 iframe 은 **최상위 파티션**(사용자의 실제 39page 저장소)을
 *    쓴다 (Chrome 공식 문서, PoC 실측 P0). 부모(확장)와 `postMessage` 로 말한다.
 * 2. **연결 모드 (후보 A)** — 사람이 연 39page 탭(최상위)이 `externally_connectable` 로 확장에
 *    포트를 연다 (`?mode=connect`). 확장이 그 포트로 요청을 보낸다.
 *
 * 대시보드 · 플레이어 · 위젯을 띄우지 않는다. 최초 실행 기본 목록도 만들지 않는다 —
 * 브리지는 사용자가 39page 를 연 적이 없어도 뜰 수 있기 때문이다.
 */
import { createPinia } from 'pinia'

import { libraryStorage, useLibraryStore } from '@/stores/library'
import { momentsStorage, useMomentsStore } from '@/stores/moments'

import { createBridgeHandler } from './bridgeHandlers'
import {
  BRIDGE_NAMESPACE,
  POC_EXTENSION_ID,
  isTrustedAncestry,
  parseBridgeRequest,
  respondError,
  type BridgeResponse,
} from './bridgeProtocol'

/** PoC 결함 주입 — 하네스가 CDP 로 이 iframe 에서 직접 정한다. 계약에는 없다. */
interface PocFaults {
  /** 이만큼의 응답을 **저장한 뒤** 버린다 (응답 중단 흉내). */
  dropResponses?: number
  /** 응답 전에 기다린다 (지연 흉내). */
  delayMs?: number
  /**
   * 다음 `addTrack` 하나를 store 를 부르지 않고 이 이유로 거절한다 — "목록은 만들었는데 곡은 못
   * 담음"(부분 성공)을 결정적으로 만든다. 실제 브라우저에서 잠금 경합으로 만들려면 다른 탭이
   * 두 명령 사이(수 ms)에 잠금을 잡아야 해서 재현이 우연에 달린다.
   */
  failNextAddWith?: 'busy' | 'conflict' | 'not-found'
}
declare global {
  var __pocFaults: PocFaults | undefined
}

const root = document.documentElement
const log = (text: string): void => {
  const line = document.createElement('div')
  line.textContent = `${new Date().toISOString()} ${text}`
  document.body.append(line)
}

const pinia = createPinia()
const library = useLibraryStore(pinia)
const moments = useMomentsStore(pinia)
library.restore()
moments.restore()
// 다른 탭(대시보드 · 수집 화면)의 저장을 반영한다. 진짜 방어는 쓰기 직전 비교 + 잠금이다.
library.watchExternalChanges()
moments.watchExternalChanges()

/** 결함 주입이 없으면 store 그대로다. */
const libraryForBridge = new Proxy(library, {
  get(target, property, receiver) {
    const reason = globalThis.__pocFaults?.failNextAddWith
    if (property === 'addTrack' && reason !== undefined) {
      globalThis.__pocFaults = { ...globalThis.__pocFaults, failNextAddWith: undefined }
      log(`fault: addTrack refused with ${reason}`)
      return () => Promise.resolve({ ok: false, reason })
    }
    return Reflect.get(target, property, receiver) as unknown
  },
})

const handler = createBridgeHandler({
  library: libraryForBridge,
  moments,
  readLibrary: () => libraryStorage.read(),
  readMoments: () => momentsStorage.read(),
})

async function answer(raw: unknown): Promise<BridgeResponse | null> {
  const parsed = parseBridgeRequest(raw)
  if (parsed === null) return null
  if (!parsed.ok) return respondError(parsed.id ?? 'invalid', parsed.error)
  const response = await handler.handle(parsed.request)
  const faults = globalThis.__pocFaults
  if (faults?.delayMs !== undefined) await new Promise((r) => setTimeout(r, faults.delayMs))
  if (faults?.dropResponses !== undefined && faults.dropResponses > 0) {
    faults.dropResponses -= 1
    log(`fault: dropped response ${parsed.request.id}`)
    return null
  }
  return response
}

function statusSnapshot(): Record<string, unknown> {
  return {
    library: { status: library.status, protectedReason: library.protectedReason },
    moments: { status: moments.status, protectedReason: moments.protectedReason },
    locks: typeof navigator.locks === 'object',
  }
}

const isTopLevel = globalThis.top === globalThis.self
const ancestors = globalThis.location.ancestorOrigins
  ? Array.from(globalThis.location.ancestorOrigins)
  : null

if (!isTopLevel) {
  if (!isTrustedAncestry(ancestors, isTopLevel)) {
    // 허용하지 않은 자리 — 아무에게도 답하지 않는다. 부모에게 거절 이유도 알리지 않는다.
    root.dataset.bridge = 'refused'
    log(`refused: ancestors=${JSON.stringify(ancestors)}`)
  } else {
    const parentOrigin = ancestors?.[0] ?? ''
    root.dataset.bridge = 'framed'
    globalThis.addEventListener('message', (event: MessageEvent) => {
      // 보낸 이가 바로 위 부모이고 그 origin 이 허용 목록의 확장일 때만.
      if (event.source !== globalThis.parent || event.origin !== parentOrigin) return
      void answer(event.data).then((response) => {
        if (response !== null) globalThis.parent.postMessage(response, parentOrigin)
      })
    })
    globalThis.parent.postMessage(
      { ns: BRIDGE_NAMESPACE, v: 1, kind: 'ready', status: statusSnapshot() },
      parentOrigin,
    )
    log(`framed bridge ready for ${parentOrigin}`)
  }
} else if (new URLSearchParams(globalThis.location.search).get('mode') === 'connect') {
  connectToExtension()
} else {
  root.dataset.bridge = 'idle'
  log('top-level without ?mode=connect — nothing to do')
}

/* ------------------------------------------------------------------ *
 * 연결 모드 (후보 A) — externally_connectable
 * ------------------------------------------------------------------ */

interface PagePort {
  postMessage(message: unknown): void
  onMessage: { addListener(cb: (message: unknown) => void): void }
  onDisconnect: { addListener(cb: () => void): void }
}
interface PageRuntime {
  connect?: (extensionId: string, info: { name: string }) => PagePort
  lastError?: { message?: string }
}

function connectToExtension(): void {
  const runtime = (globalThis as unknown as { chrome?: { runtime?: PageRuntime } }).chrome?.runtime
  if (runtime?.connect === undefined) {
    // 확장이 이 origin 을 externally_connectable 로 열지 않았거나 설치되지 않았다.
    root.dataset.bridge = 'no-runtime'
    log('chrome.runtime.connect unavailable')
    return
  }
  let connects = 0
  let disconnects = 0
  const open = (): void => {
    const port = runtime.connect?.(POC_EXTENSION_ID, { name: 'bridge-tab' })
    if (port === undefined) return
    connects += 1
    root.dataset.connects = String(connects)
    root.dataset.bridge = 'connected'
    port.onMessage.addListener((message) => {
      void answer(message).then((response) => {
        if (response !== null) port.postMessage(response)
      })
    })
    port.onDisconnect.addListener(() => {
      disconnects += 1
      root.dataset.disconnects = String(disconnects)
      root.dataset.bridge = 'disconnected'
      log(`port disconnected (${runtime.lastError?.message ?? 'no error'}) — reconnect in 1s`)
      setTimeout(open, 1_000)
    })
    port.postMessage({ ns: BRIDGE_NAMESPACE, v: 1, kind: 'ready', status: statusSnapshot() })
    log(`connected #${connects}`)
  }
  open()
}
