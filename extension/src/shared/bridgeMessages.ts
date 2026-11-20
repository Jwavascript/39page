/**
 * 확장 저장 브리지 — 확장 쪽 계약 (M11-5, ADR 0028).
 *
 * 세 구간의 모양을 정한다. **순수 모듈** — `chrome.*` 를 부르지 않고 아무것도 가져오지 않는다 (웹앱의
 * 시험이 이 파일을 직접 가져와 39page 쪽 계약 `src/features/bridge/bridgeProtocol.ts` 와 맞는지 본다).
 *
 *   패널 → 서비스 워커   `bridge/state` · `bridge/call` (`parseBridgeCall` 로 검증)
 *   서비스 워커 → offscreen   `{ target: 'offscreen', kind: 'ready' | 'call', gen, request }`
 *   offscreen → 39page 브리지   postMessage 봉투 `{ ns: '39page-bridge', v: 1, kind: 'request', … }`
 *
 * 명령은 아래 목록뿐이다. 임의 store 함수 · 코드를 부를 길이 없다. 입력 규칙은 39page 쪽과 같다 —
 * 서비스 워커가 먼저 걸러 내고, 39page 브리지가 한 번 더 검증한다.
 */

export const BRIDGE_NAMESPACE = '39page-bridge'
export const BRIDGE_PROTOCOL_VERSION = 1
/** 39page 의 브리지 입구 — 확장이 띄우는 유일한 39page 주소다. */
export const BRIDGE_PATH = '/bridge.html'

export const MAX_TITLE_LENGTH = 100
export const MAX_NAME_LENGTH = 60
export const MAX_NOTE_LENGTH = 500
export const MAX_AT_SECONDS = 999_999
const MAX_PLAYLIST_ID_LENGTH = 100

/** 요청 ID — 저장 항목 id 의 재료다 (39page 의 `derivedIds`). 같은 쓰기를 다시 보낼 때 그대로 쓴다. */
export const REQUEST_ID = /^[A-Za-z0-9_-]{16,64}$/
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/

/** 39page 호스트 권한 패턴 — 정확한 origin 하나 (`optional_host_permissions`). */
export function bridgeOriginPattern(origin: string): string {
  return `${origin}/*`
}

export type BridgeReadOp = 'hello' | 'library/list' | 'moment/list-for-video' | 'request/status'
export type BridgeWriteOp = 'track/add' | 'playlist/create-and-add' | 'moment/add'
export type BridgeOp = BridgeReadOp | BridgeWriteOp
export const WRITE_OPS: readonly BridgeOp[] = ['track/add', 'playlist/create-and-add', 'moment/add']
export type WriteKind = 'track' | 'playlist' | 'moment'

export type BridgePayload =
  | { op: 'hello' }
  | { op: 'library/list'; videoId: string | null }
  | { op: 'moment/list-for-video'; videoId: string }
  | {
      op: 'track/add'
      playlistId: string
      videoId: string
      title: string | null
      allowDuplicate: boolean
    }
  | { op: 'playlist/create-and-add'; name: string; videoId: string; title: string | null }
  | { op: 'moment/add'; videoId: string; atSeconds: number; note: string; title: string | null }
  | { op: 'request/status'; kind: WriteKind; target: string; playlistId: string | null }

/** 39page 브리지의 실패 코드 (39page `BridgeErrorCode` 와 같다 — 웹앱 시험이 맞춘다). */
export type BridgeErrorCode =
  | 'bad-request'
  | 'unsupported-version'
  | 'unsupported-op'
  | 'id-reused'
  | 'expired'
  | 'blocked'
  | 'not-persisted'
  | 'not-verified'
  | 'conflict'
  | 'busy'
  | 'not-found'
  | 'invalid-video-id'
  | 'invalid-time'
  | 'empty-name'
  | 'already-in-playlist'
  | 'duplicate-id'
  | 'partial'
  | 'internal'

export const BRIDGE_ERROR_CODES: readonly BridgeErrorCode[] = [
  'bad-request',
  'unsupported-version',
  'unsupported-op',
  'id-reused',
  'expired',
  'blocked',
  'not-persisted',
  'not-verified',
  'conflict',
  'busy',
  'not-found',
  'invalid-video-id',
  'invalid-time',
  'empty-name',
  'already-in-playlist',
  'duplicate-id',
  'partial',
  'internal',
]

export interface BridgeError {
  readonly code: BridgeErrorCode
  readonly retryable: boolean
  readonly detail?: Record<string, unknown>
}

/**
 * 서비스 워커가 패널에 돌려주는 결과.
 *
 * - `ok` — 39page 가 저장소에서 확인했다.
 * - `error` — 39page 가 답했고 **쓰지 않았다**(또는 `partial`: 목록만 만들었다).
 * - `uncertain` — 쓰기를 보냈는데 답을 잃었다. **저장됐을 수도 있다** — 성공이라 하지 않고, 같은 요청
 *   ID 로 확인(`request/status`)하거나 다시 보낸다(정확히 한 번 — 같은 ID 는 한 번만 저장된다).
 * - `unavailable` — 보내지 않았다 (권한 없음 · 브리지를 띄우지 못함 · 운영 브리지 꺼짐).
 */
export type BridgeCallResult =
  | { readonly outcome: 'ok'; readonly data: unknown }
  | { readonly outcome: 'error'; readonly error: BridgeError }
  | { readonly outcome: 'uncertain'; readonly reason: UncertainReason }
  | { readonly outcome: 'unavailable'; readonly reason: UnavailableReason }

export type UncertainReason =
  /** 정해진 시간 안에 답이 없다. */
  | 'timeout'
  /** offscreen 문서 · 브리지가 답하기 전에 사라졌다 (워커 · 문서 재시작). */
  | 'disconnected'
  /** 처리 중에 39page 권한이 바뀌었다 — 연결을 닫았다. */
  | 'permission-changed'

export type UnavailableReason =
  /** 준비 신호 또는 읽기 응답의 시간 초과. 원인은 단정하지 않는다. */
  | 'timeout'
  /** 39page 사이트 접근 권한이 없다 — 패널이 요청하거나 수집 화면으로 간다. */
  | 'permission'
  /** offscreen 문서 · 브리지 페이지를 띄우지 못했다 (오프라인 · 39page 장애). */
  | 'bridge-failed'
  /** 브리지가 이 확장을 받지 않는다 (39page 빌드의 허용 목록에 없음). */
  | 'not-allowed'
  /** 이 브라우저에 필요한 API 가 없다. */
  | 'unsupported'

export type PermissionState = 'granted' | 'not-granted'

/** `bridge/state` 의 답. */
export interface BridgeState {
  readonly permission: PermissionState
  /** 요청할 권한 — 패널이 `chrome.permissions.request({ origins })` 에 그대로 넣는다. */
  readonly origins: readonly string[]
  readonly origin: string
}

/* ------------------------------------------------------------------ *
 * 검증
 * ------------------------------------------------------------------ */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** C0 · C1 제어 문자와 양방향 재정의 문자 — 39page 의 `hasForbiddenCharacter` 와 같다. */
export function hasForbiddenCharacter(text: string, allowNewline: boolean): boolean {
  for (const char of text) {
    const code = char.charCodeAt(0)
    if (allowNewline && code === 0x0a) continue
    if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) return true
    if ((code >= 0x202a && code <= 0x202e) || (code >= 0x2066 && code <= 0x2069)) return true
  }
  return false
}

const isVideoId = (value: unknown): value is string =>
  typeof value === 'string' && VIDEO_ID.test(value)

function readTitle(value: unknown): string | null | undefined {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (trimmed.length > MAX_TITLE_LENGTH || hasForbiddenCharacter(trimmed, false)) return undefined
  return trimmed === '' ? null : trimmed
}

function readPlaylistId(value: unknown): string | undefined {
  return typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_PLAYLIST_ID_LENGTH &&
    !hasForbiddenCharacter(value, false)
    ? value
    : undefined
}

/**
 * 패널이 보낸 `payload` 를 검증해 깨끗한 값으로 돌려준다. 틀리면 `null`.
 * 39page 쪽 `parseBridgeRequest` 와 같은 규칙이다 — 여기서 걸러 내 불필요한 브리지 기동을 막는다.
 */
export function parseBridgePayload(value: unknown): BridgePayload | null {
  if (!isRecord(value) || typeof value.op !== 'string') return null
  switch (value.op) {
    case 'hello':
      return { op: 'hello' }
    case 'library/list':
      if (value.videoId !== null && value.videoId !== undefined && !isVideoId(value.videoId)) {
        return null
      }
      return { op: 'library/list', videoId: (value.videoId as string | null | undefined) ?? null }
    case 'moment/list-for-video':
      return isVideoId(value.videoId)
        ? { op: 'moment/list-for-video', videoId: value.videoId }
        : null
    case 'track/add': {
      const playlistId = readPlaylistId(value.playlistId)
      const title = readTitle(value.title)
      if (playlistId === undefined || !isVideoId(value.videoId) || title === undefined) return null
      if (value.allowDuplicate !== undefined && typeof value.allowDuplicate !== 'boolean') {
        return null
      }
      return {
        op: 'track/add',
        playlistId,
        videoId: value.videoId,
        title,
        allowDuplicate: value.allowDuplicate === true,
      }
    }
    case 'playlist/create-and-add': {
      if (typeof value.name !== 'string') return null
      const name = value.name.trim()
      const title = readTitle(value.title)
      if (name === '' || name.length > MAX_NAME_LENGTH || hasForbiddenCharacter(name, false)) {
        return null
      }
      if (!isVideoId(value.videoId) || title === undefined) return null
      return { op: 'playlist/create-and-add', name, videoId: value.videoId, title }
    }
    case 'moment/add': {
      const at = value.atSeconds
      const note = value.note ?? ''
      const title = readTitle(value.title)
      if (!isVideoId(value.videoId) || title === undefined) return null
      if (typeof at !== 'number' || !Number.isSafeInteger(at) || at < 0 || at > MAX_AT_SECONDS) {
        return null
      }
      if (typeof note !== 'string' || note.length > MAX_NOTE_LENGTH) return null
      if (hasForbiddenCharacter(note, true)) return null
      return { op: 'moment/add', videoId: value.videoId, atSeconds: at, note, title }
    }
    case 'request/status': {
      const kind = value.kind
      if (kind !== 'track' && kind !== 'playlist' && kind !== 'moment') return null
      if (typeof value.target !== 'string' || !REQUEST_ID.test(value.target)) return null
      if (kind === 'track') {
        const playlistId = readPlaylistId(value.playlistId)
        return playlistId === undefined
          ? null
          : { op: 'request/status', kind, target: value.target, playlistId }
      }
      return { op: 'request/status', kind, target: value.target, playlistId: null }
    }
    default:
      return null
  }
}

/** 39page 브리지로 보내는 봉투. */
export interface BridgeEnvelope {
  readonly ns: typeof BRIDGE_NAMESPACE
  readonly v: typeof BRIDGE_PROTOCOL_VERSION
  readonly kind: 'request'
  readonly id: string
  readonly deadline: number
  readonly payload: BridgePayload
}

export function envelope(id: string, deadline: number, payload: BridgePayload): BridgeEnvelope {
  return {
    ns: BRIDGE_NAMESPACE,
    v: BRIDGE_PROTOCOL_VERSION,
    kind: 'request',
    id,
    deadline,
    payload,
  }
}

export type BridgeAnswer =
  | { readonly ok: true; readonly id: string; readonly data: unknown }
  | { readonly ok: false; readonly id: string; readonly error: BridgeError }

/** 39page 브리지의 답을 검증한다. 모양이 틀리면 `null` — 답을 받지 못한 것과 같이 다룬다. */
export function parseBridgeAnswer(value: unknown): BridgeAnswer | null {
  if (!isRecord(value) || value.ns !== BRIDGE_NAMESPACE || value.kind !== 'response') return null
  if (value.v !== BRIDGE_PROTOCOL_VERSION || typeof value.id !== 'string') return null
  if (value.ok === true) return { ok: true, id: value.id, data: value.data }
  if (value.ok !== false || !isRecord(value.error)) return null
  const code = value.error.code
  if (typeof code !== 'string' || !BRIDGE_ERROR_CODES.includes(code as BridgeErrorCode)) return null
  return {
    ok: false,
    id: value.id,
    error: {
      code: code as BridgeErrorCode,
      retryable: value.error.retryable === true,
      ...(isRecord(value.error.detail) ? { detail: value.error.detail } : {}),
    },
  }
}

/** 브리지가 "쓰지 않았다" 고 확실히 말한 실패인지 — 아니면(모르는 답 · `internal`) 확인이 필요하다. */
export function isDefinitelyNotWritten(code: BridgeErrorCode): boolean {
  return code !== 'internal' && code !== 'not-verified'
}

/* ------------------------------------------------------------------ *
 * 서비스 워커 ↔ offscreen
 * ------------------------------------------------------------------ */

export type OffscreenMessage =
  | { readonly target: 'offscreen'; readonly kind: 'ready'; readonly gen: number }
  | {
      readonly target: 'offscreen'
      readonly kind: 'call'
      readonly gen: number
      readonly request: BridgeEnvelope
      /** offscreen 이 브리지 답을 기다리는 한도. */
      readonly waitMs: number
    }

export type OffscreenReply =
  | { readonly ok: true; readonly status?: unknown; readonly answer?: unknown }
  | {
      readonly ok: false
      readonly transport: 'not-ready' | 'timeout' | 'stale-gen' | 'not-allowed' | 'bad-request'
    }

export function isOffscreenMessage(value: unknown): value is OffscreenMessage {
  if (!isRecord(value) || value.target !== 'offscreen') return false
  if (typeof value.gen !== 'number' || !Number.isSafeInteger(value.gen)) return false
  if (value.kind === 'ready') return true
  return (
    value.kind === 'call' &&
    isRecord(value.request) &&
    typeof value.waitMs === 'number' &&
    Number.isFinite(value.waitMs)
  )
}
