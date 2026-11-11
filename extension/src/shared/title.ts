/**
 * 페이지에서 읽은 영상 제목을 정리한다 (`docs/architecture/EXTENSION_DESIGN.md` §3-2).
 *
 * 제목은 웹페이지가 정한 문자열이다 — **신뢰하지 않는 입력**으로 다룬다. 여기서는
 * 보이기 좋게 다듬고 길이를 묶을 뿐이고, 저장할 때는 웹앱이 자기 규칙
 * (`normalizeTitle`)으로 다시 다듬는다. 화면은 텍스트로만 그린다.
 */

/** 웹앱 `MAX_TRACK_TITLE_LENGTH` 와 같은 값 — 호환성 테스트가 고정한다. */
export const MAX_TITLE_LENGTH = 100

/**
 * C0·C1 제어 문자를 공백으로 바꾼다.
 *
 * 정규식 대신 코드 범위로 본다 — 제어 문자 정규식은 린트 규칙(no-control-regex)에
 * 걸리고, 그 예외 주석은 ESLint `--fix` 가 "쓰이지 않는 지시" 로 지운다 (M10-2 에서 겪음).
 */
function replaceControlChars(text: string): string {
  let out = ''
  for (const char of text) {
    const code = char.charCodeAt(0)
    out += code <= 0x1f || (code >= 0x7f && code <= 0x9f) ? ' ' : char
  }
  return out
}

/**
 * 양방향 텍스트 **재정의** 문자(LRE·RLE·PDF·LRO·RLO, LRI·RLI·FSI·PDI).
 * 표시 순서를 뒤집어 제목을 다르게 보이게 할 수 있다. 일반 아랍어·히브리어
 * 글자는 건드리지 않는다.
 */
const BIDI_OVERRIDES = /[\u202a-\u202e\u2066-\u2069]/g

/** YouTube 가 탭 제목 앞에 붙이는 알림 수 — `(3) `. */
const NOTIFICATION_PREFIX = /^\(\d+\+?\)\s+/

/** YouTube 가 탭 제목 뒤에 붙이는 사이트 이름. */
const SITE_SUFFIX = / - YouTube$/

/** UTF-16 길이로 자르되 서로게이트 쌍을 가르지 않는다 (웹앱의 `slice` 와 같은 단위). */
function truncate(text: string, max: number): string {
  if (text.length <= max) return text
  const code = text.charCodeAt(max - 1)
  const cut = code >= 0xd800 && code <= 0xdbff ? max - 1 : max
  return text.slice(0, cut)
}

/** 다듬은 제목. 남는 것이 없으면 `null`. */
export function cleanTitle(raw: unknown): string | null {
  if (typeof raw !== 'string') return null

  const text = replaceControlChars(raw)
    .replace(BIDI_OVERRIDES, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(NOTIFICATION_PREFIX, '')
    .replace(SITE_SUFFIX, '')
    .trim()

  // 로드 중인 페이지의 제목은 사이트 이름뿐이다 — 영상 제목이 아니다.
  if (text === '' || text === 'YouTube') return null

  return truncate(text, MAX_TITLE_LENGTH).trim() || null
}
