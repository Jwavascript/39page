/** 수집 화면의 문구. 컴포넌트는 이 표를 그리기만 한다. */
import type { CollectRejectReason } from './collectRequest'
import type { CollectFailure } from './useCollect'
import type { CollectMomentFailure } from './useCollectMoment'

export const REJECT_DETAIL: Readonly<Record<CollectRejectReason, string>> = {
  'not-collect': '수집 요청 주소가 아닙니다.',
  'too-long': '요청 주소가 너무 깁니다.',
  'duplicate-field': '같은 항목이 두 번 들어 있어 어느 값이 맞는지 알 수 없습니다.',
  'missing-version': '확장 프로그램과 39page 의 버전이 맞지 않습니다. 확장을 업데이트해 주세요.',
  'unsupported-version':
    '확장 프로그램과 39page 의 버전이 맞지 않습니다. 확장을 업데이트해 주세요.',
  'unsupported-kind': '아직 지원하지 않는 요청입니다.',
  'invalid-video-id': 'YouTube 영상 ID 가 올바르지 않습니다.',
  'invalid-title': '영상 제목이 너무 길거나 쓸 수 없는 글자가 들어 있습니다.',
  'invalid-request-id': '요청 번호가 올바르지 않습니다.',
  'unexpected-field':
    '요청에 받지 않는 항목이 들어 있습니다. 메모는 주소로 받지 않고 이 화면에서만 씁니다.',
  'invalid-time': '저장할 재생 시점이 올바르지 않습니다.',
}

export const BLOCKED_DETAIL = {
  protected:
    '저장된 라이브러리를 읽지 못해 자동 저장을 멈춘 상태입니다. 원본은 보존 중입니다. 대시보드에서 상태를 확인해 주세요.',
  unavailable: '브라우저 저장소를 쓸 수 없어 추가할 수 없습니다.',
} as const

export const FAILURE_DETAIL: Readonly<Record<CollectFailure, string>> = {
  conflict:
    '다른 탭에서 라이브러리가 바뀌어 최신 목록을 불러왔습니다. 저장하지 않았으니 확인 후 다시 추가해 주세요.',
  'not-found': '고른 플레이리스트가 없어졌습니다. 다른 목록을 골라 주세요.',
  'write-failed':
    '저장하지 못했습니다 (브라우저 저장 공간 부족 등). 라이브러리는 바뀌지 않았습니다.',
  'invalid-video-id': 'YouTube 영상 ID 가 올바르지 않아 추가하지 않았습니다.',
  busy: '다른 39page 탭이 저장하는 중이라 이번에는 저장하지 않았습니다. 잠시 뒤 다시 추가해 주세요.',
  lost: '방금 추가한 곡이 목록에서 없어졌습니다 — 다른 탭에서 지웠거나, 거의 같은 순간 다른 탭의 저장에 덮였습니다. 다시 추가할 수 있습니다.',
}

export const NOTHING_SAVED = '아무것도 저장하지 않았습니다.'
export const SAVE_ONLY_ON_CLICK = '추가를 누르기 전에는 아무것도 저장하지 않습니다.'

/* ---------- Music Moment (M10-4) ---------- */

export const MOMENT_BLOCKED_DETAIL = {
  protected:
    '저장된 Moments 를 읽지 못해 자동 저장을 멈춘 상태입니다. 원본은 보존 중입니다. 대시보드에서 상태를 확인해 주세요.',
  unavailable: '브라우저 저장소를 쓸 수 없어 Moment 를 저장할 수 없습니다.',
} as const

export const MOMENT_FAILURE_DETAIL: Readonly<Record<CollectMomentFailure, string>> = {
  conflict:
    '다른 탭에서 Moments 가 바뀌어 최신 목록을 불러왔습니다. 저장하지 않았으니 메모를 확인하고 다시 저장해 주세요.',
  busy: '다른 39page 탭이 저장하는 중이라 이번에는 저장하지 않았습니다. 잠시 뒤 다시 저장해 주세요.',
  'write-failed':
    '저장하지 못했습니다 (브라우저 저장 공간 부족 등). Moments 는 바뀌지 않았습니다. 메모는 그대로 있습니다.',
  'too-long': '메모는 500자까지 쓸 수 있습니다.',
  invalid: '영상이나 시점이 올바르지 않아 저장하지 않았습니다.',
  lost: '방금 저장한 Moment 가 목록에서 없어졌습니다 — 다른 탭에서 지웠을 수 있습니다. 다시 저장할 수 있습니다.',
}

export const MOMENT_SAVE_ONLY_ON_CLICK =
  '“Moment 저장” 을 누르기 전에는 아무것도 저장하지 않습니다. 시점은 확장 버튼을 누른 순간으로 고정됐습니다.'
