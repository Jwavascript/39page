/**
 * YouTube 위 플로팅 패널 — 서비스 워커 쪽 (M11-5B).
 *
 * - 아이콘 · 단축키가 패널을 연다. 정상 경로에서는 **새 탭을 열지 않는다** — 저장은 패널 안에서 저장 브리지로.
 * - 탭마다 "지시" 하나를 들고 있다: 몇 번째 지시인지(`seq`), 어느 탭으로(음악 · Moment), 단축키로 잡은 시점.
 *   패널은 1.5초마다 `panel/sync` 로 지시와 지금 영상을 받아 간다 (워커가 다시 떠도 패널이 상태를 가진다).
 * - 패널 문서 묶기: 워커가 패널을 연 뒤 처음 동기화한 문서(`documentId`)만 그 탭의 패널이다. 같은 탭에서
 *   다른 문서(예: 페이지 스크립트가 따로 띄운 패널 iframe)가 보내면 거절한다.
 * - 수집 화면(새 탭)은 사용자가 패널에서 고를 때만 연다 (대체 경로).
 */
import { buildMomentCollectUrl } from '@/shared/collectUrl'
import { fail, ok, type ContentRequest, type ErrorCode, type Result } from '@/shared/messages'
import type { CaptureOutcome, PanelMode, PanelOpened, PanelSync } from '@/shared/panelMessages'

import { capturePlaybackNow } from './captureMoment'
import { inspectTab } from './inspectTab'
import { openCollect, type OpenCollectDeps } from './openCollect'
import { PortError } from './tabsPort'

/** 패널을 연 뒤 이 시간 안에 처음 동기화한 문서를 그 탭의 패널로 묶는다. */
export const PANEL_BIND_WINDOW_MS = 15_000

export interface PanelSession {
  seq: number
  mode: PanelMode
  capture: CaptureOutcome | null
  documentId: string | null
  /** 이 시각까지 새 문서를 묶을 수 있다 (패널을 연 직후). */
  bindUntil: number
}

export interface PanelDeps extends OpenCollectDeps {
  readonly sessions: Map<number, PanelSession>
}

async function askContent(
  deps: PanelDeps,
  tabId: number,
  message: ContentRequest,
): Promise<unknown> {
  try {
    return await deps.port.sendToContent(tabId, message)
  } catch (error) {
    if (!(error instanceof PortError) || error.failure !== 'no-receiver') throw error
  }
  // content script 가 아직 없다 — 넣고 한 번 더.
  await deps.port.injectContent(tabId)
  return deps.port.sendToContent(tabId, message)
}

function portCode(error: unknown): ErrorCode {
  if (error instanceof PortError) {
    if (error.failure === 'no-tab') return 'no-tab'
    if (error.failure === 'timeout') return 'timeout'
    if (error.failure === 'no-receiver') return 'no-receiver'
  }
  return 'internal'
}

/**
 * 패널을 연다 (아이콘 · 단축키 · 팝업). Moment 로 열면 **지금** 시점을 잡는다 — 누른 순간이다.
 * 영상 페이지가 아니면 열지 않고 `unsupported` 를 돌려준다 (부르는 쪽이 아이콘 배지로 알린다).
 */
export async function openPanel(
  deps: PanelDeps,
  tabId: number,
  mode: PanelMode,
): Promise<Result<PanelOpened | { status: 'unsupported'; reason: string }>> {
  const inspected = await inspectTab(deps.port, tabId)
  if (!inspected.ok) return inspected
  const page = inspected.data
  if (page.status !== 'video') return ok({ status: 'unsupported', reason: page.reason })

  let capture: CaptureOutcome | null = null
  if (mode === 'moment') {
    const captured = await capturePlaybackNow(deps, tabId, page.videoId)
    if (!captured.ok) return captured
    capture = captured.data
  }

  const session = deps.sessions.get(tabId)
  const next: PanelSession = {
    seq: (session?.seq ?? 0) + 1,
    mode,
    capture,
    documentId: session?.documentId ?? null,
    bindUntil: deps.now() + PANEL_BIND_WINDOW_MS,
  }
  deps.sessions.set(tabId, next)

  let reply: unknown
  try {
    reply = await askContent(deps, tabId, { v: 1, type: 'panel/open' })
  } catch (error) {
    return fail(portCode(error), '패널을 띄우지 못했다')
  }
  const data = (reply as { ok?: boolean; data?: { status?: string } } | null)?.data
  if (
    (reply as { ok?: boolean } | null)?.ok !== true ||
    (data?.status !== 'opened' && data?.status !== 'focused')
  ) {
    return fail('no-receiver', '패널을 띄우지 못했다')
  }
  // 새로 띄웠으면 새 문서가 묶인다. 이미 떠 있으면(같은 문서) 그대로다.
  if (data.status === 'opened') next.documentId = null
  return ok({ status: data.status })
}

/** 패널 문서 확인 — 묶인 문서이거나, 연 직후라 지금 묶을 수 있으면 `true`. */
export function bindPanel(deps: PanelDeps, tabId: number, documentId: string | undefined): boolean {
  if (documentId === undefined || documentId === '') return false
  const session = deps.sessions.get(tabId)
  if (session === undefined) return false
  if (session.documentId === documentId) return true
  if (session.documentId === null && deps.now() <= session.bindUntil) {
    session.documentId = documentId
    return true
  }
  return false
}

export function isBoundPanel(
  deps: PanelDeps,
  tabId: number,
  documentId: string | undefined,
): boolean {
  const session = deps.sessions.get(tabId)
  return session !== undefined && documentId !== undefined && session.documentId === documentId
}

/** 패널의 정기 동기화 — 지시와 지금 영상. */
export async function syncPanel(deps: PanelDeps, tabId: number): Promise<Result<PanelSync>> {
  const session = deps.sessions.get(tabId)
  if (session === undefined) return fail('forbidden-sender', '이 탭의 패널이 아니다')
  const inspected = await inspectTab(deps.port, tabId)
  if (!inspected.ok) return inspected
  return ok({
    seq: session.seq,
    mode: session.mode,
    capture: session.capture,
    page: inspected.data,
  })
}

export async function closePanel(
  deps: PanelDeps,
  tabId: number,
): Promise<Result<{ closed: true }>> {
  deps.sessions.delete(tabId)
  try {
    await deps.port.sendToContent(tabId, { v: 1, type: 'panel/close' })
  } catch {
    // 탭이 닫혔거나 이동했다 — 패널도 함께 사라졌다.
  }
  return ok({ closed: true })
}

/**
 * 기존 수집 화면으로 연다 (대체 경로, 사용자가 패널에서 고른 경우만). 곡은 M10 과 같은 길(지금 탭의
 * 영상과 같아야 한다), Moment 는 패널이 고정한 시점을 그대로 넘긴다 — 메모는 주소에 싣지 않는다.
 */
export async function collectFromPanel(
  deps: PanelDeps,
  tabId: number,
  request: {
    kind: 'track' | 'moment'
    videoId: string
    atSeconds: number | null
    title: string | null
  },
): Promise<Result<{ status: 'opened' | 'focused'; tabId: number }>> {
  if (request.kind === 'track') return openCollect(deps, tabId, request.videoId)
  const tab = await deps.port.getTab(tabId)
  if (tab === null) return fail('no-tab', '탭을 찾을 수 없다')
  const atSeconds = request.atSeconds ?? 0
  const key = `moment:${request.videoId}@${String(atSeconds)}`
  const recent = deps.deduper.recent.get(key)
  if (
    recent !== undefined &&
    deps.now() - recent.at < 5_000 &&
    (await deps.port.focusTab(recent.tabId))
  ) {
    return ok({ status: 'focused', tabId: recent.tabId })
  }
  const created = await deps.port.createTab({
    url: buildMomentCollectUrl(deps.origin, {
      videoId: request.videoId,
      title: request.title,
      atSeconds,
      requestId: deps.newRequestId(),
    }),
    openerTabId: tabId,
    index: tab.index + 1,
    windowId: tab.windowId,
  })
  deps.deduper.recent.set(key, { tabId: created.id, at: deps.now() })
  return ok({ status: 'opened', tabId: created.id })
}

/** 패널의 "지금 시점 다시 잡기". */
export async function capturePanel(
  deps: PanelDeps,
  tabId: number,
  videoId: string,
): Promise<Result<CaptureOutcome>> {
  return capturePlaybackNow(deps, tabId, videoId)
}
