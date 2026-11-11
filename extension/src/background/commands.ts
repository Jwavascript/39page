/**
 * 단축키 (M10-5) — 팝업을 열지 않고 Quick Add · Moment 캡처를 한다.
 *
 * - 단축키 실행은 그 탭에 `activeTab` 을 준다 (공식 activeTab 문서). 새 권한이 없다.
 * - 팝업과 **같은 경로**를 쓴다 — 탭을 확인하고(`inspectTab`), `openCollect` ·
 *   `captureMoment` 를 부른다. 확인한 영상이 곧 "사용자가 본 영상" 이다.
 * - 성공하면 수집 화면이 열린다(그것이 알림이다). 담지 못하면 그 탭의 아이콘에 `!` 와
 *   이유를 단다 — 6초 뒤 지운다. 저장은 하지 않는다 (수집 화면에서 사용자가 한다).
 */
import { CAPTURE_REFUSAL_COPY } from '@/shared/feedbackCopy'
import type { ErrorCode, UnsupportedReason } from '@/shared/messages'

import type { ActionPort } from './actionPort'
import { captureMoment } from './captureMoment'
import { inspectTab } from './inspectTab'
import { openCollect, type OpenCollectDeps } from './openCollect'

export const COMMANDS = { quickAdd: 'quick-add', captureMoment: 'capture-moment' } as const
export const BADGE_CLEAR_MS = 6_000

export type CommandOutcome =
  | { readonly kind: 'opened' | 'focused'; readonly tabId: number }
  | { readonly kind: 'flagged'; readonly message: string }
  /** 모르는 명령 — 아무것도 하지 않는다. */
  | { readonly kind: 'ignored' }

const UNSUPPORTED_MESSAGE: Readonly<Record<UnsupportedReason, string>> = {
  'not-youtube': 'YouTube 영상 페이지에서 단축키를 눌러 주세요.',
  'not-video-page': 'YouTube 영상을 연 뒤 단축키를 눌러 주세요.',
  'youtube-music': 'YouTube Music 은 아직 지원하지 않습니다.',
  'no-access': '이 페이지를 읽을 수 없습니다.',
  restricted: '이 페이지에서는 쓸 수 없습니다.',
}

function errorMessage(code: ErrorCode): string {
  if (code === 'page-changed') return '그 사이 영상이 바뀌었습니다. 다시 눌러 주세요.'
  if (code === 'no-tab') return '탭을 찾을 수 없습니다.'
  if (code === 'timeout') return '페이지가 제때 답하지 않았습니다. 다시 눌러 주세요.'
  return `수집 화면을 열지 못했습니다. (코드: ${code})`
}

export interface CommandDeps extends OpenCollectDeps {
  readonly action: ActionPort
  /** 배지를 지우는 타이머 — 테스트가 바꿔 낀다. */
  readonly later: (run: () => void, ms: number) => void
}

async function run(deps: CommandDeps, command: string, tabId: number): Promise<CommandOutcome> {
  if (command !== COMMANDS.quickAdd && command !== COMMANDS.captureMoment) {
    return { kind: 'ignored' }
  }

  const inspected = await inspectTab(deps.port, tabId)
  if (!inspected.ok) return { kind: 'flagged', message: errorMessage(inspected.error.code) }
  const page = inspected.data
  if (page.status !== 'video') {
    return { kind: 'flagged', message: UNSUPPORTED_MESSAGE[page.reason] }
  }

  if (command === COMMANDS.quickAdd) {
    const opened = await openCollect(deps, tabId, page.videoId)
    return opened.ok
      ? { kind: opened.data.status, tabId: opened.data.tabId }
      : { kind: 'flagged', message: errorMessage(opened.error.code) }
  }

  const captured = await captureMoment(deps, tabId, page.videoId)
  if (!captured.ok) return { kind: 'flagged', message: errorMessage(captured.error.code) }
  if (captured.data.status === 'refused') {
    return { kind: 'flagged', message: CAPTURE_REFUSAL_COPY[captured.data.reason] }
  }
  return { kind: captured.data.status, tabId: captured.data.tabId }
}

/** 단축키 하나를 처리한다. 어떤 실패도 던지지 않는다 — 아이콘으로 알린다. */
export async function handleCommand(
  deps: CommandDeps,
  command: string,
  tab: { readonly id?: number } | undefined,
): Promise<CommandOutcome> {
  const tabId = tab?.id
  if (tabId === undefined || !Number.isSafeInteger(tabId) || tabId < 0) {
    return { kind: 'ignored' }
  }

  let outcome: CommandOutcome
  try {
    outcome = await run(deps, command, tabId)
  } catch {
    outcome = { kind: 'flagged', message: '확장 내부 오류 — 다시 눌러 주세요.' }
  }

  if (outcome.kind === 'flagged') {
    await deps.action.flag(tabId, outcome.message)
    deps.later(() => void deps.action.clear(tabId), BADGE_CLEAR_MS)
  } else if (outcome.kind !== 'ignored') {
    // 앞서 단 배지가 남아 있으면 지운다 — 이번에는 담았다.
    await deps.action.clear(tabId)
  }
  return outcome
}
