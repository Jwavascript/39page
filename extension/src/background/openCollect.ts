/**
 * `collect/open` — Quick Add (M10-3, ADR 0023).
 *
 * 1. 탭을 **다시** 확인한다. 사용자가 팝업에서 본 영상과 지금 탭의 영상이 다르면
 *    (`자동 재생` · SPA 이동) `page-changed` 로 거절한다 — 다른 곡을 담지 않는다.
 *    제목도 지금 확인한 값을 쓰므로 ID 와 제목이 같은 영상을 가리킨다 (§3-2 의 방어).
 * 2. 같은 영상의 요청이 진행 중이거나 5초 안에 연 수집 탭이 살아 있으면 **그 탭을
 *    앞으로** 가져온다 — 빠른 연속 클릭이 탭을 여러 개 만들지 않는다.
 * 3. 아니면 수집 URL(계약 v1)을 만들어 YouTube 탭 바로 옆에 연다.
 *
 * 저장은 하지 않는다. 39page 수집 화면에서 사용자가 누를 때 웹앱이 한다.
 *
 * 중복 기록은 **서비스 워커 메모리**에 둔다 — `storage` 권한을 더하지 않으려는
 * 선택이다(EXTENSION_DESIGN.md §9). 워커는 메시지를 처리한 뒤 30초는 깨어 있으므로
 * 5초 창은 대개 지켜진다. 그 사이 워커가 다시 시작되면 기록이 사라져 탭이 하나 더
 * 열릴 수 있다 — 그래도 저장은 수집 화면의 명시적 클릭으로만 일어나므로 데이터가
 * 두 번 들어가지 않는다.
 */
import { fail, ok, type CollectOpened, type Result } from '@/shared/messages'
import { buildCollectUrl } from '@/shared/collectUrl'

import { inspectTab } from './inspectTab'
import type { TabsPort } from './tabsPort'

export const COLLECT_DEDUPE_WINDOW_MS = 5_000

export interface CollectDeduper {
  readonly recent: Map<string, { readonly tabId: number; readonly at: number }>
  readonly inflight: Map<string, Promise<Result<CollectOpened>>>
}

export function createCollectDeduper(): CollectDeduper {
  return { recent: new Map(), inflight: new Map() }
}

export interface OpenCollectDeps {
  readonly port: TabsPort
  /** 빌드 때 정해진 수집 origin (`collectOrigin.ts`). */
  readonly origin: string
  readonly deduper: CollectDeduper
  readonly newRequestId: () => string
  readonly now: () => number
}

async function openFresh(
  deps: OpenCollectDeps,
  tabId: number,
  expectedVideoId: string,
): Promise<Result<CollectOpened>> {
  const inspected = await inspectTab(deps.port, tabId)
  if (!inspected.ok) return fail(inspected.error.code, inspected.error.message)

  const page = inspected.data
  if (page.status !== 'video' || page.videoId !== expectedVideoId) {
    return fail('page-changed', '팝업이 보여 준 영상과 지금 탭의 영상이 다르다')
  }

  const recent = deps.deduper.recent.get(expectedVideoId)
  if (recent !== undefined && deps.now() - recent.at < COLLECT_DEDUPE_WINDOW_MS) {
    if (await deps.port.focusTab(recent.tabId))
      return ok({ status: 'focused', tabId: recent.tabId })
  }

  const source = await deps.port.getTab(tabId)
  if (source === null) return fail('no-tab', '탭을 찾을 수 없다')

  const url = buildCollectUrl(deps.origin, {
    videoId: page.videoId,
    title: page.title,
    requestId: deps.newRequestId(),
  })
  const created = await deps.port.createTab({
    url,
    openerTabId: tabId,
    index: source.index + 1,
    windowId: source.windowId,
  })
  deps.deduper.recent.set(expectedVideoId, { tabId: created.id, at: deps.now() })
  return ok({ status: 'opened', tabId: created.id })
}

export async function openCollect(
  deps: OpenCollectDeps,
  tabId: number,
  expectedVideoId: string,
): Promise<Result<CollectOpened>> {
  // 같은 영상의 요청이 이미 진행 중이면 그 결과를 같이 쓴다 — 동시에 두 탭을 열지 않는다.
  const pending = deps.deduper.inflight.get(expectedVideoId)
  if (pending !== undefined) {
    const shared = await pending
    return shared.ok ? ok({ status: 'focused', tabId: shared.data.tabId }) : shared
  }

  const task = openFresh(deps, tabId, expectedVideoId)
  deps.deduper.inflight.set(expectedVideoId, task)
  try {
    return await task
  } finally {
    deps.deduper.inflight.delete(expectedVideoId)
  }
}
