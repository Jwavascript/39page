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
})

globalThis.addEventListener('message', (event) => host.onFrameMessage(event))
chrome.runtime.onMessage.addListener((message, sender, sendResponse) =>
  host.onRuntimeMessage(message, sender, sendResponse),
)
document.body.append(frame)
