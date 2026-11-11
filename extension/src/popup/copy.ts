/** 팝업의 문구. 컴포넌트는 이 표를 그리기만 한다. */
import { formatTimestamp } from '@web/shared/utils/time'

import { CAPTURE_REFUSAL_COPY } from '@/shared/feedbackCopy'
import type { ErrorCode, PageKind, UnsupportedReason } from '@/shared/messages'

import type { MomentCaptureState } from './useMomentCapture'
import type { QuickAddState } from './useQuickAdd'

export interface NoticeCopy {
  readonly title: string
  readonly body: string
}

export const PAGE_KIND_LABEL: Readonly<Record<PageKind, string>> = {
  watch: '영상',
  shorts: 'Shorts',
  live: '라이브',
  embed: '임베드',
}

export const LOADING_COPY: NoticeCopy = {
  title: '현재 탭을 확인하는 중',
  body: '잠시만 기다려 주세요.',
}

export const UNSUPPORTED_COPY: Readonly<Record<UnsupportedReason, NoticeCopy>> = {
  'not-youtube': {
    title: 'YouTube 영상 페이지가 아닙니다',
    body: 'YouTube 에서 담고 싶은 영상을 연 뒤 아이콘을 눌러 주세요.',
  },
  'not-video-page': {
    title: '영상 페이지가 아닙니다',
    body: '홈 · 검색 · 채널 화면에서는 쓸 수 없습니다. 영상을 연 뒤 다시 눌러 주세요.',
  },
  'youtube-music': {
    title: 'YouTube Music 은 아직 지원하지 않습니다',
    body: '같은 곡을 youtube.com 의 영상 페이지에서 열어 주세요.',
  },
  'no-access': {
    title: '이 페이지를 읽을 수 없습니다',
    body: 'YouTube 영상 페이지에서 아이콘을 다시 눌러 주세요. 다른 사이트로 이동하면 읽기 권한이 사라집니다.',
  },
  restricted: {
    title: '이 페이지에서는 쓸 수 없습니다',
    body: '브라우저 내부 페이지는 확장이 읽을 수 없습니다.',
  },
}

export function errorCopy(code: ErrorCode): NoticeCopy {
  if (code === 'no-tab') {
    return { title: '탭을 찾을 수 없습니다', body: '탭이 닫혔을 수 있습니다. 다시 시도해 주세요.' }
  }
  if (code === 'timeout') {
    return {
      title: '확장이 제때 답하지 않았습니다',
      body: '페이지가 무거울 수 있습니다. 다시 시도해 주세요.',
    }
  }
  return { title: '확장 내부 오류', body: `다시 시도해 주세요. (코드: ${code})` }
}

export const QUICK_ADD_COPY = {
  title: '플레이리스트에 담기',
  button: '플레이리스트에 추가',
  busy: '여는 중…',
  help: '39page 에서 플레이리스트를 고른 뒤 저장합니다. 이 버튼만으로는 저장되지 않습니다.',
} as const

/** Quick Add 결과 문구. 아직 누르지 않았으면 `null`. */
export function quickAddMessage(state: QuickAddState): string | null {
  switch (state.kind) {
    case 'idle':
    case 'busy':
      return null
    case 'done':
      return state.status === 'focused'
        ? '이미 열어 둔 39page 수집 화면으로 옮겼습니다.'
        : '39page 수집 화면을 열었습니다. 그 탭에서 플레이리스트를 골라 저장하세요.'
    case 'error':
      if (state.code === 'page-changed') {
        return '그 사이 영상이 바뀌었습니다. 지금 영상을 다시 보여 드렸으니 확인 후 다시 눌러 주세요.'
      }
      if (state.code === 'no-tab') return '탭을 찾을 수 없습니다. 다시 시도해 주세요.'
      if (state.code === 'timeout') return '확장이 제때 답하지 않았습니다. 다시 시도해 주세요.'
      return `수집 화면을 열지 못했습니다. 다시 시도해 주세요. (코드: ${state.code})`
  }
}

export const UNKNOWN_TITLE = '제목을 읽지 못했습니다'

/* ---------- Music Moment (M10-4) ---------- */

export const MOMENT_COPY = {
  title: '지금 이 순간',
  button: '현재 Moment 저장',
  busy: '시점 읽는 중…',
  help: '누른 순간의 재생 시점을 고정합니다. 메모는 39page 에서 쓰고 저장합니다. 이 버튼만으로는 저장되지 않습니다.',
} as const

/** 거절 이유 문구 — 단축키와 함께 쓴다 (`@/shared/feedbackCopy`). */
export { CAPTURE_REFUSAL_COPY }

/** Moment 캡처 결과 문구. 아직 누르지 않았으면 `null`. */
export function momentCaptureMessage(state: MomentCaptureState): string | null {
  switch (state.kind) {
    case 'idle':
    case 'busy':
      return null
    case 'done': {
      const time = formatTimestamp(state.atSeconds)
      return state.status === 'focused'
        ? `같은 순간(${time})을 담은 39page 화면으로 옮겼습니다.`
        : `${time} 을 고정했습니다. 열린 39page 탭에서 메모를 쓰고 저장하세요.`
    }
    case 'refused':
      return CAPTURE_REFUSAL_COPY[state.reason]
    case 'error':
      if (state.code === 'page-changed') {
        return '그 사이 영상이 바뀌었습니다. 지금 영상을 다시 보여 드렸으니 확인 후 다시 눌러 주세요.'
      }
      if (state.code === 'no-tab') return '탭을 찾을 수 없습니다. 다시 시도해 주세요.'
      if (state.code === 'timeout') return '확장이 제때 답하지 않았습니다. 다시 시도해 주세요.'
      return `Moment 화면을 열지 못했습니다. 다시 시도해 주세요. (코드: ${state.code})`
  }
}
