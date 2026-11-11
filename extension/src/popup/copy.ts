/** 팝업의 문구. 컴포넌트는 이 표를 그리기만 한다. */
import type { ErrorCode, PageKind, UnsupportedReason } from '@/shared/messages'

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
  status: '준비 중',
  body: '다음 단계(M10-3)에서 이 자리에 들어옵니다. 지금은 아무것도 저장하지 않습니다.',
} as const

export const UNKNOWN_TITLE = '제목을 읽지 못했습니다'
