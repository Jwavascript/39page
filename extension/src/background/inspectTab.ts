/**
 * `tab/inspect` — 탭이 다루는 영상 페이지인지, 그렇다면 `videoId` 와 제목을 돌려준다
 * (`docs/architecture/EXTENSION_DESIGN.md` §2 · §3 · §8).
 *
 * "지원하지 않는 페이지" 는 오류가 아니라 정상 결과다. 페이지를 읽지 못해도
 * 실패하지 않는다 — 제목만 비우고 영상 정보는 준다.
 */
import {
  fail,
  ok,
  parsePageSnapshot,
  parsePlayerCandidates,
  parseResult,
  PROTOCOL_VERSION,
  type ContentRequest,
  type PageInspection,
  type PageSnapshot,
  type PlayerCandidate,
  type Result,
  type TitleSource,
} from '@/shared/messages'
import { cleanTitle } from '@/shared/title'
import { classifyPageUrl } from '@/shared/youtubePage'

import { PortError, type TabsPort } from './tabsPort'

const PAGE_READ: ContentRequest = { v: PROTOCOL_VERSION, type: 'page/read' }

export interface PickedTitle {
  readonly text: string
  readonly source: TitleSource
}

/**
 * 제목을 고른다 (§3-2, M10-2 실측으로 정한 규칙).
 *
 * 1. 플레이어(`getVideoData`)가 **주소의 영상**을 띄우고 있으면 그 제목 —
 *    ID 와 제목이 한 객체에서 함께 오므로 서로 어긋나지 않는다.
 * 2. 시청 페이지의 `ytd-watch-flexy[video-id]` 가 주소의 영상이면 제목 줄 —
 *    실측에서 이 둘은 같은 순간에 바뀌었다.
 * 3. 그 밖에는 `null`. `document.title` · 탭 제목은 쓰지 않는다 — SPA 이동 뒤
 *    약 1초 동안 **이전 영상의 제목**이다. 틀린 제목보다 빈 제목이 낫다.
 */
export function pickTitle(
  videoId: string,
  players: readonly PlayerCandidate[] | null,
  snapshot: PageSnapshot | null,
): PickedTitle | null {
  const player = players?.find((candidate) => candidate.videoId === videoId)
  const fromPlayer = cleanTitle(player?.title)
  if (fromPlayer !== null) return { text: fromPlayer, source: 'player' }

  if (snapshot !== null && snapshot.watch.videoId === videoId) {
    const heading = cleanTitle(snapshot.watch.heading)
    if (heading !== null) return { text: heading, source: 'heading' }
  }

  return null
}

/** 메인 세계의 플레이어를 읽는다. 어떤 실패도 던지지 않는다 — `null`. */
export async function readPlayers(
  port: TabsPort,
  tabId: number,
): Promise<PlayerCandidate[] | null> {
  try {
    return parsePlayerCandidates(await port.readPlayers(tabId))
  } catch {
    return null
  }
}

async function askContent(port: TabsPort, tabId: number): Promise<PageSnapshot | null> {
  const reply = await port.sendToContent(tabId, PAGE_READ)
  const result = parseResult(reply, parsePageSnapshot)
  return result.ok ? result.data : null
}

/**
 * content script 에 묻는다. 수신자가 없으면 **한 번** 주입하고 다시 묻는다.
 * 어떤 실패도 던지지 않는다 — `null` 이면 제목 줄을 쓰지 못할 뿐이다.
 */
export async function readSnapshot(port: TabsPort, tabId: number): Promise<PageSnapshot | null> {
  try {
    return await askContent(port, tabId)
  } catch (error) {
    if (!(error instanceof PortError) || error.failure !== 'no-receiver') return null
  }

  try {
    await port.injectContent(tabId)
    return await askContent(port, tabId)
  } catch {
    return null
  }
}

export async function inspectTab(port: TabsPort, tabId: number): Promise<Result<PageInspection>> {
  const tab = await port.getTab(tabId)
  if (tab === null) return fail('no-tab', '탭을 찾을 수 없다')

  // activeTab 이 없거나 회수되면 주소가 보이지 않는다.
  if (tab.url === undefined || tab.url === '') {
    return ok({ status: 'unsupported', reason: 'no-access' })
  }

  const page = classifyPageUrl(tab.url)
  if (page.kind === 'unsupported') return ok({ status: 'unsupported', reason: page.reason })

  const [players, snapshot] = await Promise.all([
    readPlayers(port, tabId),
    readSnapshot(port, tabId),
  ])
  const title = pickTitle(page.videoId, players, snapshot)

  return ok({
    status: 'video',
    videoId: page.videoId,
    pageKind: page.pageKind,
    title: title?.text ?? null,
    titleSource: title?.source ?? null,
  })
}
