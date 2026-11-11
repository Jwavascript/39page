/**
 * Background 서비스 워커 진입점 (Manifest V3).
 *
 * 리스너는 **최상위에서 동기로** 등록한다. 워커는 30초 유휴 뒤 종료되고 메시지가
 * 오면 다시 깨어난다 — 그때 이 파일이 처음부터 다시 실행된다. 전역 변수에 상태를
 * 두지 않는다 (공식 서비스 워커 수명 주기 문서). 중복 기록(5초)만 워커 메모리에 있다 —
 * 워커가 다시 시작되면 사라져 탭이 하나 더 열릴 수 있지만 저장은 수집 화면의
 * 클릭으로만 일어나므로 데이터가 두 번 들어가지 않는다 (EXTENSION_DESIGN.md §9).
 */
import { fail } from '@/shared/messages'

import { createChromeActionPort } from './chromeActionPort'
import { createChromeTabsPort } from './chromeTabsPort'
import { handleCommand } from './commands'
import { createCollectDeduper } from './openCollect'
import { createBackgroundRouter } from './router'

/** content script 질의 한도. 주입·재시도까지 합쳐도 Popup 의 10초 안에 끝난다. */
const CONTENT_TIMEOUT_MS = 3_000
/** manifest `action.default_title` 과 같다 — 배지를 지울 때 툴팁을 되돌린다. */
const DEFAULT_TITLE = '39page — YouTube 에서 담기'

const port = createChromeTabsPort({ contentTimeoutMs: CONTENT_TIMEOUT_MS })
// 팝업과 단축키가 같은 중복 기록을 쓴다 — 어느 쪽으로 눌러도 5초 안 같은 요청은 한 탭.
const collect = {
  // 빌드 때 정해진다 — 운영은 https://39page.com 고정 (collectOrigin.ts).
  origin: __COLLECT_ORIGIN__,
  deduper: createCollectDeduper(),
  newRequestId: () => crypto.randomUUID(),
  now: () => Date.now(),
}

const router = createBackgroundRouter({
  port,
  extensionId: chrome.runtime.id,
  extensionOrigin: chrome.runtime.getURL(''),
  collect,
})

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  router.handle(message, sender).then(sendResponse, () => {
    sendResponse(fail('internal', '확장 내부 오류'))
  })
  // sendResponse 를 비동기로 부른다. promise 반환은 Chrome 148 부터라 쓰지 않는다.
  return true
})

// 단축키 (M10-5). 실행이 그 탭에 activeTab 을 준다.
const action = createChromeActionPort(DEFAULT_TITLE)
chrome.commands.onCommand.addListener((command, tab) => {
  void handleCommand(
    { port, ...collect, action, later: (run, ms) => setTimeout(run, ms) },
    command,
    tab,
  )
})
