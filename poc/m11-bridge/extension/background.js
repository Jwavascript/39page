/**
 * M11-1 저장 브리지 PoC — Background 서비스 워커.
 *
 * ⚠ 실험 코드. 운영 확장과 별개다.
 *
 * - 아이콘 클릭 → 그 YouTube 탭에 플로팅 패널을 넣는다 (activeTab + scripting).
 * - 패널의 요청을 브리지로 보낸다. 경로 둘:
 *   - `offscreen` (후보 B): offscreen 문서 안의 39page iframe. 39page 탭이 없어도 된다.
 *   - `tab-port` (후보 A): 39page 탭이 externally_connectable 로 열어 둔 포트.
 * - **저장하지 않는다.** 저장은 브리지(웹앱 store)가 하고, 확장은 그 결과를 전달할 뿐이다.
 * - 상태를 오래 들고 있지 않는다 — 워커는 언제든 다시 시작된다. 진행 중 요청 기록(같은 ID 를
 *   한 번만 보내기)만 메모리에 있다.
 */
import {
  BRIDGE_ORIGIN,
  CALL_TIMEOUT_MS,
  NS,
  PROBE_URL,
  bridgeEnvelope,
  isBridgePortSender,
  isBridgeResponseFor,
  isPanelSender,
  validateBridgeCall,
} from './protocol.js'

const PANEL_URL = chrome.runtime.getURL('panel.html')
const startedAt = Date.now()
/** 같은 요청 ID 는 한 번만 브리지로 보낸다 (연속 클릭 · 패널의 재전송). */
const inflight = new Map()
/** 연결 모드 39page 탭의 포트. 워커가 다시 시작되면 비고, 탭이 다시 연결한다. */
const tabPorts = []

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const transportError = (code) => ({ transport: 'error', code })

/* --------------------------- 플로팅 패널 --------------------------- */

chrome.action.onClicked.addListener((tab) => {
  if (tab.id === undefined) return
  void chrome.scripting
    .executeScript({ target: { tabId: tab.id }, files: ['float.js'] })
    .catch(() => undefined)
})

/** 메인 세계에서 플레이어를 **한 번** 읽는다 (M10-4 와 같은 출처). 결과는 다시 검증한다. */
function readPlayerInPage() {
  const player = document.querySelector('#movie_player')
  if (player === null || typeof player.getVideoData !== 'function') return null
  const data = player.getVideoData() ?? {}
  const time = typeof player.getCurrentTime === 'function' ? player.getCurrentTime() : null
  const state = typeof player.getPlayerState === 'function' ? player.getPlayerState() : null
  const ad = player.classList.contains('ad-showing') || player.classList.contains('ad-interrupting')
  return {
    videoId: typeof data.video_id === 'string' ? data.video_id : null,
    title: typeof data.title === 'string' ? data.title : null,
    time: typeof time === 'number' && Number.isFinite(time) ? time : null,
    state: typeof state === 'number' ? state : null,
    ad,
    isLive: data.isLive === true,
  }
}

async function readVideo(tabId) {
  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: readPlayerInPage,
  })
  const v = result?.result
  if (v === null || typeof v !== 'object') return { ok: false, reason: 'no-player' }
  if (typeof v.videoId !== 'string' || !/^[A-Za-z0-9_-]{11}$/.test(v.videoId)) {
    return { ok: false, reason: 'no-video' }
  }
  const title = typeof v.title === 'string' ? v.title.trim().slice(0, 100) || null : null
  // 시점은 재생(1) · 일시정지(2) · 끝(0) · 버퍼링(3) 에서만 믿는다. 광고 · 라이브는 거절.
  const reliable = [0, 1, 2, 3].includes(v.state) && !v.ad && !v.isLive && v.time !== null && v.time >= 0
  return {
    ok: true,
    videoId: v.videoId,
    title,
    atSeconds: reliable ? Math.floor(v.time) : null,
    state: v.state,
    ad: v.ad === true,
  }
}

/* --------------------------- offscreen 경로 --------------------------- */

let creating = null

async function hasOffscreen() {
  const contexts = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] })
  return contexts.length > 0
}

async function ensureOffscreen() {
  if (await hasOffscreen()) return
  creating ??= chrome.offscreen
    .createDocument({
      url: 'offscreen.html',
      reasons: ['IFRAME_SCRIPTING'],
      justification: '39page 저장소를 쓰는 39page 브리지 페이지를 iframe 으로 띄워 요청을 전달한다',
    })
    .finally(() => {
      creating = null
    })
  await creating
}

async function callOffscreen(request) {
  await ensureOffscreen()
  const reply = await chrome.runtime.sendMessage({
    target: 'offscreen',
    type: 'bridge/forward',
    request,
  })
  return reply ?? transportError('no-reply')
}

/* --------------------------- 탭 포트 경로 --------------------------- */

chrome.runtime.onConnectExternal.addListener((port) => {
  // 허용한 origin 의 **브리지 페이지**만. 같은 origin 의 다른 페이지(대시보드 등)도 거절한다.
  if (!isBridgePortSender(port.sender)) {
    port.disconnect()
    return
  }
  const entry = { port, pending: new Map(), ready: false }
  tabPorts.push(entry)
  port.onMessage.addListener((message) => {
    if (message?.kind === 'ready') entry.ready = true
    const resolve = message?.id === undefined ? undefined : entry.pending.get(message.id)
    if (resolve !== undefined && isBridgeResponseFor(message, message.id)) {
      entry.pending.delete(message.id)
      resolve({ transport: 'ok', response: message })
    }
  })
  port.onDisconnect.addListener(() => {
    const index = tabPorts.indexOf(entry)
    if (index !== -1) tabPorts.splice(index, 1)
    for (const resolve of entry.pending.values()) resolve(transportError('tab-closed'))
    entry.pending.clear()
  })
})

function callTabPort(request) {
  const entry = tabPorts.at(-1)
  if (entry === undefined) return Promise.resolve(transportError('no-bridge-tab'))
  return new Promise((resolve) => {
    entry.pending.set(request.id, resolve)
    entry.port.postMessage(bridgeEnvelope(request))
  })
}

/* --------------------------- 라우터 --------------------------- */

function route(call) {
  const fingerprint = JSON.stringify(call.request.payload)
  const existing = inflight.get(call.request.id)
  if (existing !== undefined) {
    // 같은 ID 에 다른 내용 — 앞 요청의 결과를 돌려주면 다른 요청이 성공한 것처럼 보인다.
    return existing.fingerprint === fingerprint ? existing.result : Promise.resolve(transportError('id-reused'))
  }
  const run = call.route === 'offscreen' ? callOffscreen(call.request) : callTabPort(call.request)
  const bounded = Promise.race([run, sleep(CALL_TIMEOUT_MS).then(() => transportError('timeout'))])
    .catch(() => transportError('internal'))
    .finally(() => setTimeout(() => inflight.delete(call.request.id), 60_000))
  inflight.set(call.request.id, { fingerprint, result: bounded })
  return bounded
}

async function handle(message, sender) {
  if (message?.target === 'offscreen') return undefined // offscreen 문서 몫
  if (message?.ns !== NS || message?.v !== 1) return { ok: false, code: 'bad-request' }
  // 패널만 받는다 — content script · 다른 확장 페이지 · 웹페이지는 여기 올 수 없거나 거절된다.
  if (!isPanelSender(sender, chrome.runtime.id, PANEL_URL)) {
    return { ok: false, code: 'forbidden-sender' }
  }
  switch (message.type) {
    case 'video/read':
      if (sender.tab?.id === undefined) return { ok: false, reason: 'no-tab' }
      return readVideo(sender.tab.id).catch(() => ({ ok: false, reason: 'no-access' }))
    case 'bridge/call': {
      const call = validateBridgeCall(message)
      if (call === null) return { transport: 'error', code: 'bad-request' }
      return route(call)
    }
    case 'collect/fallback': {
      // 검증된 대체 경로 — M10 수집 화면을 YouTube 탭 옆에 연다 (저장은 그 화면에서).
      const { kind, videoId, atSeconds } = message
      if (!/^[A-Za-z0-9_-]{11}$/.test(videoId ?? '')) return { ok: false }
      const params = new URLSearchParams({ v: '1', kind, videoId, req: crypto.randomUUID() })
      if (kind === 'moment' && Number.isSafeInteger(atSeconds)) params.set('atSeconds', String(atSeconds))
      await chrome.tabs.create({
        url: `${BRIDGE_ORIGIN}/#collect?${params.toString()}`,
        index: (sender.tab?.index ?? 0) + 1,
        openerTabId: sender.tab?.id,
      })
      return { ok: true }
    }
    case 'poc/status':
      return {
        ok: true,
        startedAt,
        offscreen: await hasOffscreen(),
        tabPorts: tabPorts.length,
        inflight: inflight.size,
      }
    case 'probe/offscreen':
      await ensureOffscreen()
      return chrome.runtime.sendMessage({ target: 'offscreen', type: 'probe', url: PROBE_URL })
    default:
      return { ok: false, code: 'unsupported-type' }
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.target === 'offscreen') return false
  handle(message, sender).then(sendResponse, () => sendResponse(transportError('internal')))
  return true
})
