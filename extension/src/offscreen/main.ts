/**
 * offscreen 문서 진입점 (M11-5). 세대(`gen`)는 서비스 워커가 주소에 적는다 — `offscreenHost.ts`.
 */
import { BRIDGE_PATH } from '@/shared/bridgeMessages'

import { createOffscreenHost } from './offscreenHost'

const gen = Number(new URLSearchParams(location.search).get('gen') ?? 'NaN')
const frame = document.createElement('iframe')
frame.src = `${__COLLECT_ORIGIN__}${BRIDGE_PATH}`

const host = createOffscreenHost({
  gen: Number.isSafeInteger(gen) ? gen : -1,
  bridgeOrigin: __COLLECT_ORIGIN__,
  extensionId: chrome.runtime.id,
  workerUrl: chrome.runtime.getURL('background.js'),
  frame,
  // 5분 동안 요청이 없으면 워커에 알린다 — 워커가 확인하고 닫는다 (M11-6).
  idleMs: 5 * 60_000,
  notifyIdle: (gen) => {
    void chrome.runtime.sendMessage({ v: 1, type: 'offscreen/idle', gen }).catch(() => undefined)
  },
})

globalThis.addEventListener('message', (event) => host.onFrameMessage(event))
chrome.runtime.onMessage.addListener((message, sender, sendResponse) =>
  host.onRuntimeMessage(message, sender, sendResponse),
)
document.body.append(frame)
