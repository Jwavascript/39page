/**
 * M11-1 저장 브리지 PoC — 메시지 계약 v1 (순수 모듈).
 *
 * ⚠ 실험 코드다. 운영 빌드(`vite build`)의 입력이 아니며 `src/` 가 이 파일을 가져오지 않는다.
 * 설계: `docs/architecture/M11_BRIDGE_POC.md` · ADR 0028.
 *
 * 브리지 페이지(39page origin)가 받는 요청과 돌려주는 응답의 모양만 정한다. store 를 모른다.
 */
import { isYouTubeVideoId } from '@/shared/utils/youtube'

export const BRIDGE_NAMESPACE = '39page-bridge'
export const BRIDGE_PROTOCOL_VERSION = 1

/**
 * 브리지를 부를 수 있는 확장 origin — **빌드에 박는다.** 주소·쿼리로 받지 않는다.
 *
 * PoC 확장은 manifest `key` 로 ID 를 고정했다 (`poc/m11-bridge/extension/manifest.json`).
 * 운영에서는 스토어 ID(+ 개발용 고정 ID)가 들어간다 — 결정이 필요하다 (TODO, ADR 0028).
 */
export const POC_EXTENSION_ID = 'pkagnijdhfmkodpdfgdehfdghcgbfpoa'
export const ALLOWED_EXTENSION_ORIGINS: readonly string[] = [
  `chrome-extension://${POC_EXTENSION_ID}`,
]

/** 요청 ID — 수집 URL 계약 v1 의 `req` 와 같은 규칙. */
const REQUEST_ID = /^[A-Za-z0-9_-]{16,64}$/
const MAX_TITLE_LENGTH = 100
const MAX_NAME_LENGTH = 60
const MAX_NOTE_LENGTH = 500
const MAX_AT_SECONDS = 999_999
const MAX_PLAYLIST_ID_LENGTH = 64

export type BridgeOp =
  | 'hello'
  | 'library/list'
  | 'track/add'
  | 'playlist/create-and-add'
  | 'moment/add'
  | 'moment/list-for-video'
  | 'track/find'
  | 'moment/find'

export const WRITE_OPS: readonly BridgeOp[] = ['track/add', 'playlist/create-and-add', 'moment/add']

export type BridgePayload =
  | { op: 'hello' }
  | { op: 'library/list'; videoId: string | null }
  | { op: 'track/add'; playlistId: string; videoId: string; title: string | null }
  | { op: 'playlist/create-and-add'; name: string; videoId: string; title: string | null }
  | { op: 'moment/add'; videoId: string; atSeconds: number; note: string; title: string | null }
  | { op: 'moment/list-for-video'; videoId: string }
  | { op: 'track/find'; playlistId: string; videoId: string }
  | { op: 'moment/find'; videoId: string; atSeconds: number; since: string }

export interface BridgeRequest {
  readonly id: string
  /** 이 시각(epoch ms)이 지났으면 쓰기를 **시작하지 않는다** — 호출부가 이미 포기했다. */
  readonly deadline: number
  readonly payload: BridgePayload
}

export type BridgeErrorCode =
  | 'bad-request'
  | 'unsupported-version'
  | 'unsupported-op'
  | 'id-reused'
  | 'expired'
  /** 저장소가 보호(손상·상위 버전)·사용 불가 상태 — 쓰지 않았다 (ADR 0007). */
  | 'blocked'
  /** store 는 받았지만 저장소에 쓰지 못했다 (용량 등). 메모리도 되돌렸다. */
  | 'not-persisted'
  /** 썼다고 했는데 다시 읽어 보니 없다 — 성공이라 하지 않는다. */
  | 'not-verified'
  | 'conflict'
  | 'busy'
  | 'not-found'
  | 'invalid-video-id'
  | 'invalid-time'
  | 'empty-name'
  /** 목록은 만들었고 곡은 못 담았다. `detail.playlistId` 로 다시 담는다. */
  | 'partial'
  | 'internal'

export interface BridgeError {
  readonly code: BridgeErrorCode
  /** 같은 요청을 다시 보내도 되는지 (새 ID 로). */
  readonly retryable: boolean
  readonly detail?: Record<string, unknown>
}

export type BridgeResponse =
  | { ns: typeof BRIDGE_NAMESPACE; v: 1; kind: 'response'; id: string; ok: true; data: unknown }
  | {
      ns: typeof BRIDGE_NAMESPACE
      v: 1
      kind: 'response'
      id: string
      ok: false
      error: BridgeError
    }

export function respondOk(id: string, data: unknown): BridgeResponse {
  return { ns: BRIDGE_NAMESPACE, v: 1, kind: 'response', id, ok: true, data }
}

export function respondError(id: string, error: BridgeError): BridgeResponse {
  return { ns: BRIDGE_NAMESPACE, v: 1, kind: 'response', id, ok: false, error }
}

const RETRYABLE: ReadonlySet<BridgeErrorCode> = new Set(['conflict', 'busy', 'expired', 'internal'])

export function bridgeError(code: BridgeErrorCode, detail?: Record<string, unknown>): BridgeError {
  return detail === undefined
    ? { code, retryable: RETRYABLE.has(code) }
    : { code, retryable: RETRYABLE.has(code), detail }
}

/** 수집 URL 계약과 같은 금지 문자 — C0·C1 제어 문자와 양방향 재정의 문자. */
function hasForbiddenCharacter(text: string, allowNewline: boolean): boolean {
  for (const char of text) {
    const code = char.charCodeAt(0)
    if (allowNewline && code === 0x0a) continue
    if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) return true
    if ((code >= 0x202a && code <= 0x202e) || (code >= 0x2066 && code <= 0x2069)) return true
  }
  return false
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 선택 제목 — 없거나 비면 `null`. 규칙을 어기면 `undefined`(거절). */
function readTitle(value: unknown): string | null | undefined {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (trimmed.length > MAX_TITLE_LENGTH || hasForbiddenCharacter(trimmed, false)) return undefined
  return trimmed === '' ? null : trimmed
}

function readAtSeconds(value: unknown): number | undefined {
  return typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= MAX_AT_SECONDS
    ? value
    : undefined
}

function readPlaylistId(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_PLAYLIST_ID_LENGTH
    ? value
    : undefined
}

export type ParseResult =
  { ok: true; request: BridgeRequest } | { ok: false; id: string | null; error: BridgeError }

function refuse(id: string | null, code: BridgeErrorCode, field?: string): ParseResult {
  return { ok: false, id, error: bridgeError(code, field === undefined ? undefined : { field }) }
}

/**
 * 받은 값을 계약 v1 로 검증한다. 던지지 않는다.
 *
 * 봉투가 아니면(`ns` 가 다르다) `null` — 다른 용도의 postMessage 이므로 답하지도 않는다.
 */
export function parseBridgeRequest(value: unknown): ParseResult | null {
  if (!isRecord(value) || value.ns !== BRIDGE_NAMESPACE || value.kind !== 'request') return null

  const id = typeof value.id === 'string' && REQUEST_ID.test(value.id) ? value.id : null
  if (id === null) return refuse(null, 'bad-request', 'id')
  if (value.v !== BRIDGE_PROTOCOL_VERSION) return refuse(id, 'unsupported-version')
  if (typeof value.deadline !== 'number' || !Number.isFinite(value.deadline)) {
    return refuse(id, 'bad-request', 'deadline')
  }
  const p = value.payload
  if (!isRecord(p) || typeof p.op !== 'string') return refuse(id, 'bad-request', 'payload')

  const ok = (payload: BridgePayload): ParseResult => ({
    ok: true,
    request: { id, deadline: value.deadline as number, payload },
  })

  switch (p.op) {
    case 'hello':
      return ok({ op: 'hello' })
    case 'library/list': {
      if (p.videoId !== undefined && p.videoId !== null && !isYouTubeVideoId(p.videoId)) {
        return refuse(id, 'invalid-video-id')
      }
      return ok({ op: 'library/list', videoId: (p.videoId as string | null | undefined) ?? null })
    }
    case 'track/add':
    case 'track/find': {
      const playlistId = readPlaylistId(p.playlistId)
      if (playlistId === undefined) return refuse(id, 'bad-request', 'playlistId')
      if (!isYouTubeVideoId(p.videoId)) return refuse(id, 'invalid-video-id')
      if (p.op === 'track/find') return ok({ op: 'track/find', playlistId, videoId: p.videoId })
      const title = readTitle(p.title)
      if (title === undefined) return refuse(id, 'bad-request', 'title')
      return ok({ op: 'track/add', playlistId, videoId: p.videoId, title })
    }
    case 'playlist/create-and-add': {
      if (typeof p.name !== 'string') return refuse(id, 'bad-request', 'name')
      const name = p.name.trim()
      if (name === '') return refuse(id, 'empty-name')
      if (name.length > MAX_NAME_LENGTH || hasForbiddenCharacter(name, false)) {
        return refuse(id, 'bad-request', 'name')
      }
      if (!isYouTubeVideoId(p.videoId)) return refuse(id, 'invalid-video-id')
      const title = readTitle(p.title)
      if (title === undefined) return refuse(id, 'bad-request', 'title')
      return ok({ op: 'playlist/create-and-add', name, videoId: p.videoId, title })
    }
    case 'moment/add': {
      if (!isYouTubeVideoId(p.videoId)) return refuse(id, 'invalid-video-id')
      const atSeconds = readAtSeconds(p.atSeconds)
      if (atSeconds === undefined) return refuse(id, 'invalid-time')
      const note = p.note ?? ''
      if (typeof note !== 'string' || note.length > MAX_NOTE_LENGTH) {
        return refuse(id, 'bad-request', 'note')
      }
      if (hasForbiddenCharacter(note, true)) return refuse(id, 'bad-request', 'note')
      const title = readTitle(p.title)
      if (title === undefined) return refuse(id, 'bad-request', 'title')
      return ok({ op: 'moment/add', videoId: p.videoId, atSeconds, note, title })
    }
    case 'moment/list-for-video':
      if (!isYouTubeVideoId(p.videoId)) return refuse(id, 'invalid-video-id')
      return ok({ op: 'moment/list-for-video', videoId: p.videoId })
    case 'moment/find': {
      if (!isYouTubeVideoId(p.videoId)) return refuse(id, 'invalid-video-id')
      const atSeconds = readAtSeconds(p.atSeconds)
      if (atSeconds === undefined) return refuse(id, 'invalid-time')
      if (typeof p.since !== 'string' || Number.isNaN(Date.parse(p.since))) {
        return refuse(id, 'bad-request', 'since')
      }
      return ok({ op: 'moment/find', videoId: p.videoId, atSeconds, since: p.since })
    }
    default:
      return refuse(id, 'unsupported-op')
  }
}

/**
 * 이 문서가 브리지로 일해도 되는 자리인지 — **조상 전체가 허용한 확장 origin** 이어야 한다.
 *
 * - 최상위(액자 없음)면 거절 — 브리지 화면은 사람이 여는 곳이 아니다.
 * - 조상 중 하나라도 웹사이트(예: `https://www.youtube.com`)면 거절. 그 자리의 저장소는
 *   최상위 사이트 기준으로 **분할**돼 사용자의 39page 데이터가 아니다 (PoC 실측 P0c).
 *   잠금 관리자도 따로라 탭 간 잠금(ADR 0025)이 깨진다.
 * - `ancestorOrigins` 가 없는 브라우저는 판단하지 못하므로 거절한다 (Chrome 은 있다).
 */
export function isTrustedAncestry(
  ancestorOrigins: readonly string[] | null,
  isTopLevel: boolean,
  allowed: readonly string[] = ALLOWED_EXTENSION_ORIGINS,
): boolean {
  if (isTopLevel || ancestorOrigins === null || ancestorOrigins.length === 0) return false
  return ancestorOrigins.every((origin) => allowed.includes(origin))
}

/** 같은 ID 에 다른 내용이 오면 거절하기 위한 지문. */
export function payloadFingerprint(payload: BridgePayload): string {
  return JSON.stringify(payload)
}
