/**
 * YouTube URL에서 영상 ID를 추출하는 순수 함수.
 *
 * 허용 범위는 `docs/product/MVP_SPEC.md` F4에서 확정했다.
 * - 호스트: `youtube.com`, `music.youtube.com`, `youtube-nocookie.com`, `youtu.be`
 *   (`www.` / `m.` 접두사 허용)
 * - 경로: `/watch?v=`, `/shorts/<id>`, `/embed/<id>`, `/live/<id>`, `youtu.be/<id>`
 *
 * 예외를 던지지 않는다. 실패는 항상 `{ ok: false, reason }`으로 돌려준다.
 */

/** 영상 ID 형식. YouTube의 11자 ID. */
const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/

/** `/watch?v=` 외에 경로에서 ID를 꺼내는 형식. */
const PATH_ID_PATTERN = /^\/(?:shorts|embed|live)\/([^/?#]+)/

/** 긴 형식 호스트. 정규화 후 값과 비교한다. */
const LONG_FORM_HOSTS: readonly string[] = [
  'youtube.com',
  'music.youtube.com',
  'youtube-nocookie.com',
]

/** 짧은 형식 호스트. 첫 경로 조각이 영상 ID다. */
const SHORT_FORM_HOST = 'youtu.be'

/** http / https 외의 스킴은 받지 않는다. */
const ALLOWED_PROTOCOLS: readonly string[] = ['http:', 'https:']

export type YouTubeUrlFailureReason =
  /** 입력이 비어 있거나 공백뿐이다. */
  | 'empty'
  /** URL로 해석할 수 없다. 스킴이 없는 입력도 여기에 해당한다. */
  | 'malformed-url'
  /** URL이지만 http/https가 아니다. */
  | 'unsupported-protocol'
  /** YouTube 호스트가 아니다. */
  | 'unsupported-host'
  /** YouTube 호스트지만 지원하지 않는 경로다. */
  | 'unsupported-path'
  /** 경로에서 값을 찾았지만 11자 영상 ID 형식이 아니다. */
  | 'invalid-video-id'

export type YouTubeUrlParseResult =
  | { readonly ok: true; readonly videoId: string }
  | { readonly ok: false; readonly reason: YouTubeUrlFailureReason }

/** 값이 YouTube 영상 ID 형식인지 확인한다. 저장 데이터 검증에도 쓴다. */
export function isYouTubeVideoId(value: unknown): value is string {
  return typeof value === 'string' && VIDEO_ID_PATTERN.test(value)
}

/**
 * `www.` 와 `m.` 접두사를 떼고 소문자로 맞춘다.
 *
 * `music.youtube.com`은 `m.` 접두사와 겹치지 않는다 (`'music.'`은 `'m.'`로
 * 시작하지 않는다).
 */
function normalizeHost(hostname: string): string {
  let host = hostname.toLowerCase()
  if (host.startsWith('www.')) host = host.slice(4)
  if (host.startsWith('m.')) host = host.slice(2)
  return host
}

function failure(reason: YouTubeUrlFailureReason): YouTubeUrlParseResult {
  return { ok: false, reason }
}

/**
 * 긴 형식 호스트에서 ID 후보를 꺼낸다.
 * 지원하지 않는 경로면 `null`을 돌려준다.
 */
function longFormCandidate(url: URL): string | null {
  if (url.pathname === '/watch') {
    return url.searchParams.get('v') ?? ''
  }

  const match = PATH_ID_PATTERN.exec(url.pathname)
  if (match) {
    return match[1] ?? ''
  }

  return null
}

/**
 * 짧은 형식(`youtu.be/<id>`)에서 ID 후보를 꺼낸다.
 * 경로가 비어 있으면 `null`을 돌려준다.
 */
function shortFormCandidate(url: URL): string | null {
  const [first] = url.pathname.split('/').filter(Boolean)
  return first ?? null
}

/** YouTube URL에서 영상 ID를 추출한다. */
export function parseYouTubeVideoId(input: string): YouTubeUrlParseResult {
  const trimmed = input.trim()
  if (trimmed === '') {
    return failure('empty')
  }

  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    return failure('malformed-url')
  }

  if (!ALLOWED_PROTOCOLS.includes(url.protocol)) {
    return failure('unsupported-protocol')
  }

  const host = normalizeHost(url.hostname)

  let candidate: string | null
  if (host === SHORT_FORM_HOST) {
    candidate = shortFormCandidate(url)
  } else if (LONG_FORM_HOSTS.includes(host)) {
    candidate = longFormCandidate(url)
  } else {
    return failure('unsupported-host')
  }

  if (candidate === null) {
    return failure('unsupported-path')
  }

  if (!isYouTubeVideoId(candidate)) {
    return failure('invalid-video-id')
  }

  return { ok: true, videoId: candidate }
}

/**
 * 영상 ID 를 YouTube 시청 페이지 주소로 바꾼다 (M3-5).
 *
 * 재생할 수 없는 영상에 `YOUTUBE에서 열기 ↗` 링크를 띄울 때 쓴다
 * (`MVP_SPEC.md` F3). 승인된 레퍼런스의 `videoLink()` 와 같은 형식이다.
 *
 * **ID 를 검증하고 인코딩한다.** 저장된 라이브러리가 손상됐거나 미래 버전에서
 * 온 값일 수 있으므로, 주소를 만드는 자리에서 다시 확인한다. 형식이 아니면
 * `null` 이고 링크를 띄우지 않는다. 임의의 문자열이 주소로 들어가지 않는다.
 *
 * 인코딩은 **두 번째 방어선**이다. 검증을 통과한 11자는 전부
 * `[A-Za-z0-9_-]` 라서 `encodeURIComponent` 가 바꾸는 글자가 없다 — 그래서
 * 인코딩을 지워도 어떤 테스트도 깨지지 않는다(의도된 중복). 나중에 ID 형식이
 * 느슨해지면 이 줄이 먼저 막는다. 지우지 않는다.
 */
export function youtubeWatchUrl(videoId: string, atSeconds?: number): string | null {
  if (!isYouTubeVideoId(videoId)) return null

  const base = `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`
  // 시점은 0 이상 정수만 싣는다 (M10-4 수집 화면의 "그 지점에서 보기"). 아니면 싣지 않는다.
  if (atSeconds === undefined || !Number.isSafeInteger(atSeconds) || atSeconds < 0) return base
  return `${base}&t=${String(atSeconds)}s`
}
