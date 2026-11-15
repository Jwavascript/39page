/**
 * YouTube 위 플로팅 패널 계약 (M11-5B). 순수 모듈 — `chrome.*` 를 부르지 않는다.
 *
 * 신뢰 경계
 *   패널(확장 페이지 iframe) → 서비스 워커   `panel/*` · `bridge/*`. 대상 탭은 메시지가 아니라 **보낸 쪽의
 *     탭**(`sender.tab.id`)이다 — 패널은 자기가 떠 있는 탭에만 손댄다. 처음 동기화한 문서(`documentId`)에
 *     묶이고, 다른 문서의 패널 요청은 거절한다.
 *   서비스 워커 → content script   `panel/open` · `panel/close` (YouTube 페이지는 이 길에 닿지 못한다).
 *   팝업 → 서비스 워커   `panel/open` (탭 ID 를 싣는다 — 팝업은 탭 밖에 있다).
 */
import type { CaptureRefusal, PageInspection } from './messages'

export type PanelMode = 'music' | 'moment'
export const PANEL_MODES: readonly PanelMode[] = ['music', 'moment']

/** 확장 안의 패널 페이지 경로 — manifest `web_accessible_resources` 와 같다. */
export const PANEL_PATH = 'src/panel/index.html'

/** 누른 순간 고정한 재생 시점. */
export interface PanelCapture {
  readonly videoId: string
  readonly atSeconds: number
  readonly title: string | null
  /** 잡은 시각 (epoch ms) — 다시 잡으면 바뀐다. */
  readonly at: number
}

export type CaptureOutcome =
  | ({ readonly status: 'captured' } & PanelCapture)
  | { readonly status: 'refused'; readonly reason: CaptureRefusal }

/** `panel/sync` 의 답. */
export interface PanelSync {
  /** 단축키 · 아이콘을 다시 누를 때마다 오른다. 패널은 바뀐 번호를 보면 그 지시(탭 · 캡처)를 따른다. */
  readonly seq: number
  readonly mode: PanelMode
  /** 그 지시와 함께 잡은 시점 (Moment 단축키). */
  readonly capture: CaptureOutcome | null
  /** 지금 탭이 보여 주는 영상 — SPA 이동을 따라간다. */
  readonly page: PageInspection
}

export type PanelOpened = { readonly status: 'opened' | 'focused' }

export function isPanelMode(value: unknown): value is PanelMode {
  return typeof value === 'string' && PANEL_MODES.includes(value as PanelMode)
}
