/**
 * 수집 URL 계약 v1 — 웹앱 쪽 검증 (M10-3B · M10-4, ADR 0023, `EXTENSION_DESIGN.md` §5-1).
 *
 * ```
 * https://39page.com/#collect?v=1&kind=track&videoId=<11자>&title=<선택>&req=<요청 ID>
 * https://39page.com/#collect?v=1&kind=moment&videoId=<11자>&atSeconds=<정수>&title=<선택>&req=<요청 ID>
 * ```
 *
 * **메모는 주소에 싣지 않는다** (M10-4). 메모는 사용자가 수집 화면에서 쓴다 — 주소에
 * `note` · `memo` 가 있으면 거절한다. 다른 사이트가 메모를 미리 채운 링크로 사용자를
 * 속이지 못하게.
 *
 * 주소 조각은 **누구나 만들 수 있다** — 확장이 아닌 다른 사이트의 링크일 수도 있다.
 * 그래서 이 파일은 조각을 **데이터로만** 읽는다. 실행하거나 HTML 로 해석하지 않고,
 * 통과해도 저장하지 않는다. 저장은 사용자가 수집 화면에서 누를 때만 일어난다.
 *
 * 순수 함수다. 저장소·DOM·store 를 만지지 않는다.
 */
import { isYouTubeVideoId } from '@/shared/utils/youtube'

/** 수집 화면을 여는 조각의 머리. `#collect` 하나 또는 `#collect?…`. */
export const COLLECT_HASH_PREFIX = '#collect'

/** 지원하는 계약 버전. 문자열로 비교한다 (`v=1.0` 같은 변형을 받지 않는다). */
export const COLLECT_PROTOCOL_VERSION = '1'

/** 조각 전체의 상한. 정상 요청은 1KB 를 넘지 않는다. */
export const MAX_COLLECT_FRAGMENT_LENGTH = 2048

/** 제목 상한 — 라이브러리 `MAX_TRACK_TITLE_LENGTH` 와 같다 (테스트가 고정한다). */
export const MAX_COLLECT_TITLE_LENGTH = 100

/** 요청 ID — 확장이 만든다 (`crypto.randomUUID()`). 중복 처리에 쓴다. */
const REQUEST_ID = /^[A-Za-z0-9_-]{16,64}$/

/**
 * `atSeconds` 상한 — 6자리(999999초 ≈ 277시간). 0 은 받는다 (확인된 0초).
 * 앞자리 0 · 부호 · 소수점 · 지수 · 공백은 받지 않는다 — 한 가지 표기만.
 */
export const MAX_COLLECT_AT_SECONDS = 999_999
const AT_SECONDS = /^(0|[1-9][0-9]{0,5})$/

/** 계약의 필드. 이것만 읽고 나머지는 무시한다 (거절 목록은 따로). */
const KNOWN_FIELDS = ['v', 'kind', 'videoId', 'title', 'req', 'atSeconds'] as const

/** 주소로 받지 않는 필드 — 메모는 수집 화면에서만 쓴다 (M10-4). */
const FORBIDDEN_FIELDS = ['note', 'memo'] as const

export type CollectRejectReason =
  /** 수집 조각이 아니다. */
  | 'not-collect'
  /** 조각이 상한보다 길다. */
  | 'too-long'
  /** 같은 필드가 두 번 나온다 — 어느 쪽이 맞는지 모호하다. */
  | 'duplicate-field'
  /** 버전이 없다. */
  | 'missing-version'
  /** 버전이 1 이 아니다. */
  | 'unsupported-version'
  /** `track` · `moment` 가 아니다. */
  | 'unsupported-kind'
  /**
   * 이 종류에 맞지 않는 필드가 있다 (M10-4) — `track` 의 `atSeconds`, 어느 종류든
   * `note` · `memo`(메모는 주소로 받지 않는다).
   */
  | 'unexpected-field'
  /** `moment` 의 `atSeconds` 가 없거나 0 이상 정수가 아니다 (음수·소수·NaN·Infinity·지수·부호). */
  | 'invalid-time'
  /** 11자 YouTube 영상 ID 가 아니다. */
  | 'invalid-video-id'
  /** 제어 문자·양방향 재정의 문자가 있거나 100자를 넘는다. */
  | 'invalid-title'
  /** 요청 ID 형식이 아니다. */
  | 'invalid-request-id'

export interface CollectTrackRequest {
  readonly v: 1
  readonly kind: 'track'
  readonly videoId: string
  /** 앞뒤 공백을 뗀 제목. 없거나 비면 `null` — 라이브러리가 기본 제목을 쓴다. */
  readonly title: string | null
  readonly requestId: string
}

/** Music Moment 캡처 (M10-4). 시점은 확장이 **누른 순간** 고정한 값이다. */
export interface CollectMomentRequest {
  readonly v: 1
  readonly kind: 'moment'
  readonly videoId: string
  readonly title: string | null
  /** 0 이상 정수(초). 0 은 "확인된 0초" 다 — 확장은 읽지 못한 시점을 0 으로 보내지 않는다. */
  readonly atSeconds: number
  readonly requestId: string
}

export type CollectRequest = CollectTrackRequest | CollectMomentRequest

export type CollectParseResult =
  | { readonly ok: true; readonly request: CollectRequest }
  | { readonly ok: false; readonly reason: CollectRejectReason }

function reject(reason: CollectRejectReason): CollectParseResult {
  return { ok: false, reason }
}

/** 조각이 수집 화면을 가리키는지. `#collection` 같은 다른 조각과 헷갈리지 않는다. */
export function isCollectHash(hash: string): boolean {
  return hash === COLLECT_HASH_PREFIX || hash.startsWith(`${COLLECT_HASH_PREFIX}?`)
}

/**
 * 제목에 쓸 수 없는 글자 — C0·C1 제어 문자와 양방향 텍스트 재정의 문자.
 * 정규식 대신 코드 범위로 본다 (제어 문자 정규식은 린트 예외가 필요하다).
 */
function hasForbiddenCharacter(text: string): boolean {
  for (const char of text) {
    const code = char.charCodeAt(0)
    if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) return true
    if ((code >= 0x202a && code <= 0x202e) || (code >= 0x2066 && code <= 0x2069)) return true
  }
  return false
}

export function parseCollectRequest(hash: string): CollectParseResult {
  if (hash.length > MAX_COLLECT_FRAGMENT_LENGTH) return reject('too-long')
  if (!isCollectHash(hash)) return reject('not-collect')

  const params = new URLSearchParams(hash.slice(COLLECT_HASH_PREFIX.length + 1))
  for (const field of KNOWN_FIELDS) {
    if (params.getAll(field).length > 1) return reject('duplicate-field')
  }

  const version = params.get('v')
  if (version === null) return reject('missing-version')
  if (version !== COLLECT_PROTOCOL_VERSION) return reject('unsupported-version')

  for (const field of FORBIDDEN_FIELDS) {
    if (params.has(field)) return reject('unexpected-field')
  }

  const kind = params.get('kind')
  if (kind !== 'track' && kind !== 'moment') return reject('unsupported-kind')
  if (kind === 'track' && params.has('atSeconds')) return reject('unexpected-field')

  const videoId = params.get('videoId')
  if (!isYouTubeVideoId(videoId)) return reject('invalid-video-id')

  const requestId = params.get('req')
  if (requestId === null || !REQUEST_ID.test(requestId)) return reject('invalid-request-id')

  const rawTitle = params.get('title')
  const trimmed = rawTitle === null ? '' : rawTitle.trim()
  if (hasForbiddenCharacter(trimmed) || trimmed.length > MAX_COLLECT_TITLE_LENGTH) {
    return reject('invalid-title')
  }

  const title = trimmed === '' ? null : trimmed

  if (kind === 'track') {
    return { ok: true, request: { v: 1, kind: 'track', videoId, title, requestId } }
  }

  const rawTime = params.get('atSeconds')
  if (rawTime === null || !AT_SECONDS.test(rawTime)) return reject('invalid-time')
  const atSeconds = Number(rawTime)
  if (!Number.isSafeInteger(atSeconds) || atSeconds > MAX_COLLECT_AT_SECONDS) {
    return reject('invalid-time')
  }

  return { ok: true, request: { v: 1, kind: 'moment', videoId, title, atSeconds, requestId } }
}
