/**
 * M11-1 저장 브리지 PoC 확장 — 공용 상수와 검증 (순수 모듈).
 *
 * ⚠ 실험 코드다. 운영 확장(`extension/`)과 별개이며 배포하지 않는다. 개발 전용 origin
 * (`http://127.0.0.1:4173`)만 안다 — 운영 `https://39page.com` 의 사용자 데이터에 닿지 않는다.
 */

/** 브리지 페이지가 사는 origin. PoC 는 격리된 로컬 빌드만 쓴다. */
export const BRIDGE_ORIGIN = 'http://127.0.0.1:4173'
export const BRIDGE_PATH = '/poc/m11-bridge/web/bridge.html'
export const BRIDGE_URL = `${BRIDGE_ORIGIN}${BRIDGE_PATH}`
export const PROBE_URL = `${BRIDGE_ORIGIN}/poc/m11-bridge/web/probe.html`

export const NS = '39page-poc'
export const BRIDGE_NS = '39page-bridge'

/** 쓰기 요청을 브리지가 시작해도 되는 마지막 순간 — 지금부터 이만큼. */
export const WRITE_START_WINDOW_MS = 8_000
/**
 * 확장 쪽 전체 한도. 브리지는 마감 전에 시작한 쓰기를 잠금 5초 + 확인 1.5초 안에 끝내므로
 * 시작 창(8초)에 그것을 더한 값보다 길게 기다린다 — "포기했는데 나중에 저장됨" 을 줄인다.
 */
export const CALL_TIMEOUT_MS = 16_000

const REQUEST_ID = /^[A-Za-z0-9_-]{16,64}$/
const ROUTES = new Set(['offscreen', 'tab-port'])

/** 이 확장의 패널(YouTube 위 iframe 안의 확장 페이지)이 보낸 메시지인지. */
export function isPanelSender(sender, runtimeId, panelUrl) {
  if (sender === null || typeof sender !== 'object') return false
  if (sender.id !== runtimeId) return false
  if (typeof sender.url !== 'string' || !sender.url.startsWith(panelUrl)) return false
  // content script 가 보낸 메시지는 sender.url 이 웹페이지 주소다 — 위에서 걸린다.
  return true
}

/** 39page 탭이 externally_connectable 로 연 포트가 브리지 페이지에서 왔는지. */
export function isBridgePortSender(sender) {
  if (sender === null || typeof sender !== 'object') return false
  if (sender.origin !== BRIDGE_ORIGIN || typeof sender.url !== 'string') return false
  try {
    const url = new URL(sender.url)
    return url.origin === BRIDGE_ORIGIN && url.pathname === BRIDGE_PATH
  } catch {
    return false
  }
}

/** 패널 → Background `bridge/call` 의 모양. 내용 검증은 브리지(웹앱)가 다시 한다. */
export function validateBridgeCall(message) {
  if (message === null || typeof message !== 'object') return null
  if (message.ns !== NS || message.v !== 1 || message.type !== 'bridge/call') return null
  if (!ROUTES.has(message.route)) return null
  const request = message.request
  if (request === null || typeof request !== 'object') return null
  if (typeof request.id !== 'string' || !REQUEST_ID.test(request.id)) return null
  if (typeof request.deadline !== 'number') return null
  if (request.payload === null || typeof request.payload !== 'object') return null
  return { route: message.route, request }
}

/** 브리지 요청 봉투 — postMessage · 포트로 보낼 그대로. */
export function bridgeEnvelope(request) {
  return {
    ns: BRIDGE_NS,
    v: 1,
    kind: 'request',
    id: request.id,
    deadline: request.deadline,
    payload: request.payload,
  }
}

/** 브리지 응답이 그 요청의 것인지. */
export function isBridgeResponseFor(data, id) {
  return (
    data !== null &&
    typeof data === 'object' &&
    data.ns === BRIDGE_NS &&
    data.kind === 'response' &&
    data.id === id
  )
}
