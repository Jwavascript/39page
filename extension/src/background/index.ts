/**
 * Background 서비스 워커 진입점 (Manifest V3).
 *
 * 리스너는 **최상위에서 동기로** 등록한다. 워커는 30초 유휴 뒤 종료되고 메시지가
 * 오면 다시 깨어난다 — 그때 이 파일이 처음부터 다시 실행된다. 전역 변수에 상태를
 * 두지 않는다 (공식 서비스 워커 수명 주기 문서). 중복 기록(5초)만 워커 메모리에 있다 —
 * 워커가 다시 시작되면 사라져 탭이 하나 더 열릴 수 있지만 저장은 수집 화면의
 * 클릭으로만 일어나므로 데이터가 두 번 들어가지 않는다 (EXTENSION_DESIGN.md §9).
 */
import { bridgeOriginPattern } from '@/shared/bridgeMessages'
import { fail } from '@/shared/messages'

import { PANEL_PATH } from '@/shared/panelMessages'

import { createBridgeClient } from './bridgeClient'
import type { PanelSession } from './panel'
import { createChromeOffscreenPort, createChromePermissionPort } from './chromeBridgePorts'

import { createChromeActionPort } from './chromeActionPort'
import { createChromeTabsPort } from './chromeTabsPort'
import { COMMANDS, handleCommand } from './commands'
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

/*
 * 저장 브리지 (M11-5, ADR 0028). 39page origin 은 수집 화면과 같다 — 운영은 https://39page.com 고정.
 * 권한이 바뀌면 세대를 올리고 offscreen 을 닫는다. 워커가 다시 시작하면 내력을 모르는 문서를 닫는다.
 */
const bridgeOrigin = __COLLECT_ORIGIN__
const originPattern = bridgeOriginPattern(bridgeOrigin)
const bridgeClient = createBridgeClient({
  offscreen: createChromeOffscreenPort(),
  permissions: createChromePermissionPort(originPattern),
  now: () => Date.now(),
})
void bridgeClient.startup()
chrome.permissions.onAdded.addListener(() => void bridgeClient.permissionChanged())
chrome.permissions.onRemoved.addListener(() => void bridgeClient.permissionChanged())

/** 탭마다 패널 지시 · 묶인 문서 (M11-5B). 워커가 다시 시작하면 사라진다 — 패널을 다시 열면 다시 묶는다. */
const sessions = new Map<number, PanelSession>()
chrome.tabs.onRemoved.addListener((tabId) => sessions.delete(tabId))

const router = createBackgroundRouter({
  port,
  extensionId: chrome.runtime.id,
  extensionOrigin: chrome.runtime.getURL(''),
  collect,
  bridge: { client: bridgeClient, origin: bridgeOrigin, originPattern },
  panel: {
    sessions,
    panelPath: `/${PANEL_PATH}`,
    // 팝업이 패널을 열었다 — 그 탭의 다음 클릭은 팝업 없이 바로 (깜빡임 없음).
    onOpened: (tabId: number) => void action.usePopup(tabId, false),
  },
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
const commandDeps = {
  port,
  ...collect,
  sessions,
  action,
  later: (run: () => void, ms: number) => setTimeout(run, ms),
}
chrome.commands.onCommand.addListener((command, tab) => {
  void handleCommand(commandDeps, command, tab).then((outcome) => afterOpen(tab?.id, outcome.kind))
})

/*
 * 아이콘 (M11-6) — 그 탭에서 패널을 한 번 연 뒤로는 팝업을 끄고 `onClicked` 로 바로 연다. 팝업이 잠깐 떴다
 * 닫히는 깜빡임은 탭마다 첫 클릭 한 번뿐이다. 그 탭이 YouTube 영상 밖으로 가 패널을 열 수 없으면 팝업을 다시
 * 켜고(Chrome 127+ 는 바로 띄운다) 배지로 이유를 알린다.
 */
chrome.action.onClicked.addListener((tab) => {
  void handleCommand(commandDeps, COMMANDS.quickAdd, tab).then(async (outcome) => {
    if (outcome.kind === 'flagged' && tab.id !== undefined) {
      await action.usePopup(tab.id, true)
      await action.openPopup()
    } else afterOpen(tab.id, outcome.kind)
  })
})

function afterOpen(tabId: number | undefined, kind: string): void {
  if (tabId !== undefined && (kind === 'opened' || kind === 'focused'))
    void action.usePopup(tabId, false)
}
