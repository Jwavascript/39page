/**
 * M11-1 저장 브리지 PoC — offscreen 문서 (후보 B 의 몸체).
 *
 * ⚠ 실험 코드.
 *
 * 39page 브리지 페이지를 iframe 으로 띄우고 Background 의 요청을 `postMessage` 로 전달한다.
 * 확장이 그 origin 의 호스트 권한을 가지면 이 iframe 은 **최상위 파티션**을 쓴다 — 사용자의
 * 39page 탭과 같은 localStorage · 잠금 관리자 (Chrome 공식 문서 "Storage and cookies",
 * PoC 실측 P0). offscreen 문서에서는 `chrome.runtime` 만 쓸 수 있다 (공식 문서).
 */
import { BRIDGE_ORIGIN, BRIDGE_URL, bridgeEnvelope, isBridgeResponseFor } from './protocol.js'

/** 브리지가 "준비됨" 을 보내기까지 기다리는 한도. 넘으면 다시 띄운다. */
const READY_TIMEOUT_MS = 6_000
/** 요청 하나의 한도 — Background 의 전체 한도보다 짧다. */
const RESPONSE_TIMEOUT_MS = 15_000

let frame = null
let ready = null
let readyStatus = null
/** id → 응답을 기다리는 함수들 (같은 id 를 두 번 보내도 한 번만 전달한다). */
const pending = new Map()

/** "준비됨" 을 기다리는 promise — 브리지가 보내면 `resolveNow(true)`, 한도를 넘으면 `false`. */
function createReady() {
  let resolveNow
  const promise = new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), READY_TIMEOUT_MS)
    resolveNow = (value) => {
      clearTimeout(timer)
      resolve(value)
    }
  })
  promise.resolveNow = resolveNow
  return promise
}

function mount() {
  frame?.remove()
  frame = document.createElement('iframe')
  frame.src = BRIDGE_URL
  readyStatus = null
  ready = createReady()
  document.body.append(frame)
}

globalThis.addEventListener('message', (event) => {
  // 우리가 띄운 브리지 iframe 이 보낸 것만 — 출처와 창을 함께 본다.
  if (frame === null || event.source !== frame.contentWindow || event.origin !== BRIDGE_ORIGIN) return
  const data = event.data
  if (data?.ns !== '39page-bridge') return
  if (data.kind === 'ready') {
    readyStatus = data.status
    ready.resolveNow(true)
    return
  }
  if (isBridgeResponseFor(data, data.id)) {
    const waiters = pending.get(data.id)
    pending.delete(data.id)
    for (const resolve of waiters ?? []) resolve({ transport: 'ok', response: data })
  }
})

async function forward(request) {
  if (frame === null) mount()
  let ok = await ready
  if (!ok) {
    // 한 번 다시 띄운다 (서버가 잠깐 없었거나 브리지가 죽었다).
    mount()
    ok = await ready
  }
  if (!ok) return { transport: 'error', code: 'bridge-unavailable' }

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pending.delete(request.id)
      resolve({ transport: 'error', code: 'timeout' })
    }, RESPONSE_TIMEOUT_MS)
    const done = (value) => {
      clearTimeout(timer)
      resolve(value)
    }
    const waiters = pending.get(request.id)
    if (waiters !== undefined) {
      waiters.push(done)
      return
    }
    pending.set(request.id, [done])
    frame.contentWindow.postMessage(bridgeEnvelope(request), BRIDGE_ORIGIN)
  })
}

/** 저장소 파티션 측정 (P0) — 탐침 iframe 을 따로 띄워 보고를 받는다. */
function probe(url) {
  return new Promise((resolve) => {
    const probeFrame = document.createElement('iframe')
    probeFrame.src = url
    const timer = setTimeout(() => {
      probeFrame.remove()
      resolve({ ok: false, reason: 'timeout' })
    }, 8_000)
    const onMessage = (event) => {
      if (event.source !== probeFrame.contentWindow) return
      if (event.data?.ns !== '39page-poc-probe' || event.data.kind !== 'loaded') return
      clearTimeout(timer)
      globalThis.removeEventListener('message', onMessage)
      probeFrame.remove()
      resolve({ ok: true, report: event.data.report })
    }
    globalThis.addEventListener('message', onMessage)
    document.body.append(probeFrame)
  })
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.target !== 'offscreen' || sender.id !== chrome.runtime.id) return false
  if (message.type === 'bridge/forward') {
    void forward(message.request).then(sendResponse)
    return true
  }
  if (message.type === 'probe') {
    void probe(message.url).then(sendResponse)
    return true
  }
  if (message.type === 'status') {
    sendResponse({ mounted: frame !== null, readyStatus })
    return false
  }
  return false
})

mount()
