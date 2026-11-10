/**
 * Moments 화면의 안내 문구 (M9-4).
 *
 * 저장 여부를 성공과 **뭉뚱그리지 않는다.** `persisted: false` 는 "메모리에는
 * 들어갔지만 브라우저에 남지 않았다" 이고, 새로고침하면 사라진다. 그것을
 * "저장했어요" 로 말하면 사용자가 데이터를 잃는다 (M8-4 와 같은 원칙).
 */
import type { WriteFailureReason } from '@/shared/storage'
import type { MomentsStatus } from '@/stores/moments'

export type FeedbackTone = 'info' | 'warning'

export interface MomentFeedback {
  tone: FeedbackTone
  text: string
}

export function info(text: string): MomentFeedback {
  return { tone: 'info', text }
}

export function warning(text: string): MomentFeedback {
  return { tone: 'warning', text }
}

/**
 * 저장되지 않은 **이유**. Moments store 의 상태에서 읽는다.
 *
 * 보호 상태가 가장 먼저다 — 그 상태에서는 쓰기를 시도조차 하지 않으므로
 * `lastWriteFailure` 가 비어 있을 수 있다 (ADR 0007).
 */
export function unsavedReason(store: {
  readonly status: MomentsStatus
  readonly lastWriteFailure: WriteFailureReason | null
}): string {
  if (store.status === 'protected')
    return '저장된 Moments 원본을 읽지 못해 덮어쓰지 않고 보호하는 중이에요.'
  if (store.status === 'unavailable') return '브라우저 저장소를 쓸 수 없어요.'
  if (store.lastWriteFailure === 'quota-exceeded') return '브라우저 저장 공간이 부족해요.'
  return '저장 중 오류가 났어요.'
}
