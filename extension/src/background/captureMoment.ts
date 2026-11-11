/**
 * `moment/capture` — Music Moment 캡처 (M10-4, ADR 0023).
 *
 * 1. 탭 주소를 **다시** 확인한다. 팝업이 보여 준 영상과 다르면 `page-changed`.
 *    Shorts · 라이브 · 임베드는 MVP 범위 밖이라 거절한다 (오류가 아니라 정상 결과).
 * 2. 메인 세계에서 플레이어 상태를 **한 번에** 읽는다 (`capturePlaybackInPage`) —
 *    영상 ID · 제목 · 시점이 같은 순간 같은 객체에서 온다.
 * 3. `decideCapture` 가 판정한다. 광고 · 시작 전 · 불러오는 중 · 읽지 못함은 거절하고,
 *    **지어낸 0초를 만들지 않는다.** 재생·일시정지 중의 0초는 확인된 0초다.
 * 4. 시점을 정수(내림)로 고정해 수집 주소(`kind=moment`)를 만들고 YouTube 탭 옆에 연다.
 *    메모는 싣지 않는다 — 39page 수집 화면에서 쓴다. 저장도 그 화면에서 한다.
 *
 * 빠른 연속 클릭: 같은 탭 · 같은 영상의 캡처가 진행 중이면 그 결과를 같이 쓰고,
 * 5초 안에 같은 영상 · 같은 시점으로 연 수집 탭이 살아 있으면 그 탭을 앞으로 가져온다.
 */
import { MAX_AT_SECONDS, buildMomentCollectUrl } from '@/shared/collectUrl'
import {
  fail,
  ok,
  parsePlaybackSnapshot,
  type CaptureRefusal,
  type MomentCaptured,
  type PlaybackSnapshot,
  type Result,
} from '@/shared/messages'
import { cleanTitle } from '@/shared/title'
import { classifyPageUrl } from '@/shared/youtubePage'

import { COLLECT_DEDUPE_WINDOW_MS, type OpenCollectDeps } from './openCollect'
import { PortError } from './tabsPort'

/** YouTube 플레이어 상태 (IFrame Player API 와 같은 값). */
export const PLAYER_STATE = {
  unstarted: -1,
  ended: 0,
  playing: 1,
  paused: 2,
  buffering: 3,
  cued: 5,
} as const

export type CaptureDecision =
  | { readonly kind: 'capture'; readonly atSeconds: number; readonly title: string | null }
  | { readonly kind: 'refused'; readonly reason: CaptureRefusal }
  /** 플레이어가 다른 영상을 띄우고 있다 (자동 다음 영상 · SPA 이동 중). */
  | { readonly kind: 'page-changed' }

const refused = (reason: CaptureRefusal): CaptureDecision => ({ kind: 'refused', reason })

/** 순수 판정. 스냅샷과 주소의 영상 ID 만 본다. */
export function decideCapture(
  snapshot: PlaybackSnapshot | null,
  expectedVideoId: string,
): CaptureDecision {
  if (snapshot === null || snapshot.videoId === null) return refused('unreadable')
  if (snapshot.videoId !== expectedVideoId) return { kind: 'page-changed' }
  if (snapshot.adShowing) return refused('ad')
  if (snapshot.live) return refused('live')

  const { state, currentTime, duration } = snapshot
  if (state === null || currentTime === null) return refused('unreadable')
  if (state === PLAYER_STATE.unstarted || state === PLAYER_STATE.cued) return refused('not-started')
  // 막 불러오는 중의 0 근처는 "모름" 이다 — 확인된 0 이 아니다.
  if (state === PLAYER_STATE.buffering && currentTime < 1) return refused('not-started')
  const known: readonly number[] = [
    PLAYER_STATE.ended,
    PLAYER_STATE.playing,
    PLAYER_STATE.paused,
    PLAYER_STATE.buffering,
  ]
  if (!known.includes(state)) return refused('unreadable')
  if (currentTime < 0) return refused('unreadable')
  if (duration !== null && duration > 0 && currentTime > duration + 1) return refused('unreadable')

  const atSeconds = Math.floor(currentTime)
  if (atSeconds > MAX_AT_SECONDS) return refused('unreadable')
  return { kind: 'capture', atSeconds, title: cleanTitle(snapshot.title) }
}

async function captureFresh(
  deps: OpenCollectDeps,
  tabId: number,
  expectedVideoId: string,
): Promise<Result<MomentCaptured>> {
  const tab = await deps.port.getTab(tabId)
  if (tab === null) return fail('no-tab', '탭을 찾을 수 없다')

  // 주소가 안 보이면(권한 회수 · 다른 사이트로 이동) 팝업이 다시 확인하게 한다.
  if (tab.url === undefined || tab.url === '') {
    return fail('page-changed', '탭의 주소를 볼 수 없다')
  }
  const page = classifyPageUrl(tab.url)
  if (page.kind === 'unsupported' || page.videoId !== expectedVideoId) {
    return fail('page-changed', '팝업이 보여 준 영상과 지금 탭의 영상이 다르다')
  }
  if (page.pageKind === 'shorts') return ok({ status: 'refused', reason: 'shorts' })
  if (page.pageKind === 'live') return ok({ status: 'refused', reason: 'live' })
  if (page.pageKind === 'embed') return ok({ status: 'refused', reason: 'not-watch' })

  let raw: unknown
  try {
    raw = await deps.port.capturePlayback(tabId)
  } catch (error) {
    if (error instanceof PortError && error.failure === 'no-tab') {
      return fail('no-tab', '탭을 찾을 수 없다')
    }
    return ok({ status: 'refused', reason: 'unreadable' })
  }

  const decision = decideCapture(parsePlaybackSnapshot(raw), page.videoId)
  if (decision.kind === 'page-changed') {
    return fail('page-changed', '플레이어가 다른 영상을 띄우고 있다')
  }
  if (decision.kind === 'refused') return ok({ status: 'refused', reason: decision.reason })

  const recentKey = `moment:${page.videoId}@${String(decision.atSeconds)}`
  const recent = deps.deduper.recent.get(recentKey)
  if (recent !== undefined && deps.now() - recent.at < COLLECT_DEDUPE_WINDOW_MS) {
    if (await deps.port.focusTab(recent.tabId)) {
      return ok({
        status: 'focused',
        tabId: recent.tabId,
        videoId: page.videoId,
        atSeconds: decision.atSeconds,
      })
    }
  }

  const url = buildMomentCollectUrl(deps.origin, {
    videoId: page.videoId,
    title: decision.title,
    atSeconds: decision.atSeconds,
    requestId: deps.newRequestId(),
  })
  const created = await deps.port.createTab({
    url,
    openerTabId: tabId,
    index: tab.index + 1,
    windowId: tab.windowId,
  })
  deps.deduper.recent.set(recentKey, { tabId: created.id, at: deps.now() })
  return ok({
    status: 'opened',
    tabId: created.id,
    videoId: page.videoId,
    atSeconds: decision.atSeconds,
  })
}

/** 진행 중인 캡처의 결과를 같이 쓴다 — 키는 탭 · 영상 (시점은 읽기 전이라 모른다). */
const inflight = new WeakMap<
  OpenCollectDeps['deduper'],
  Map<string, Promise<Result<MomentCaptured>>>
>()

export async function captureMoment(
  deps: OpenCollectDeps,
  tabId: number,
  expectedVideoId: string,
): Promise<Result<MomentCaptured>> {
  let pendingByKey = inflight.get(deps.deduper)
  if (pendingByKey === undefined) {
    pendingByKey = new Map()
    inflight.set(deps.deduper, pendingByKey)
  }
  const key = `${String(tabId)}:${expectedVideoId}`
  const pending = pendingByKey.get(key)
  if (pending !== undefined) {
    const shared = await pending
    return shared.ok && shared.data.status !== 'refused'
      ? ok({ ...shared.data, status: 'focused' })
      : shared
  }

  const task = captureFresh(deps, tabId, expectedVideoId)
  pendingByKey.set(key, task)
  try {
    return await task
  } finally {
    pendingByKey.delete(key)
  }
}
