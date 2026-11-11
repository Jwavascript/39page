/**
 * Background 서비스 워커 진입점 (Manifest V3).
 *
 * 리스너는 **최상위에서 동기로** 등록한다. 워커는 30초 유휴 뒤 종료되고 메시지가
 * 오면 다시 깨어난다 — 그때 이 파일이 처음부터 다시 실행된다. 전역 변수에 상태를
 * 두지 않는다 (공식 서비스 워커 수명 주기 문서).
 */
import { fail } from '@/shared/messages'

import { createChromeTabsPort } from './chromeTabsPort'
import { createCollectDeduper } from './openCollect'
import { createBackgroundRouter } from './router'

/** content script 질의 한도. 주입·재시도까지 합쳐도 Popup 의 10초 안에 끝난다. */
const CONTENT_TIMEOUT_MS = 3_000

const router = createBackgroundRouter({
  port: createChromeTabsPort({ contentTimeoutMs: CONTENT_TIMEOUT_MS }),
  extensionId: chrome.runtime.id,
  extensionOrigin: chrome.runtime.getURL(''),
  collect: {
    // 빌드 때 정해진다 — 운영은 https://39page.com 고정 (collectOrigin.ts).
    origin: __COLLECT_ORIGIN__,
    deduper: createCollectDeduper(),
    newRequestId: () => crypto.randomUUID(),
    now: () => Date.now(),
  },
})

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  router.handle(message, sender).then(sendResponse, () => {
    sendResponse(fail('internal', '확장 내부 오류'))
  })
  // sendResponse 를 비동기로 부른다. promise 반환은 Chrome 148 부터라 쓰지 않는다.
  return true
})
