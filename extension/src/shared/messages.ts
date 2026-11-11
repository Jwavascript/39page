/**
 * 확장 내부 메시지 계약 v1 (`docs/architecture/EXTENSION_DESIGN.md` §6, ADR 0023 결정 5).
 *
 * 모든 수신 지점(Background · Content · Popup)이 **이 파일의 검증 함수만** 쓴다.
 * 받은 값은 `unknown` 으로 시작한다 — 메시지는 구조화 복제를 거친 임의의 값이고,
 * content script 쪽은 공격자가 만든 것으로 가정한다 (공식 messaging 문서).
 *
 * `chrome.*` 를 부르지 않는 순수 모듈이다.
 */

/** 계약 버전. 바꾸면 모든 수신 지점이 옛 버전을 `unsupported-version` 으로 거절한다. */
export const PROTOCOL_VERSION = 1

export type ErrorCode =
  /** 봉투는 맞지만 필드가 틀렸다. */
  | 'bad-request'
  /** 모르는 `type`. */
  | 'unsupported-type'
  /** `v` 가 지원하는 버전이 아니다. */
  | 'unsupported-version'
  /** 우리 확장의 페이지가 보낸 것이 아니다. */
  | 'forbidden-sender'
  /** 탭이 닫혔거나 없다. */
  | 'no-tab'
  /** 주입 뒤에도 content script 가 답하지 않는다. */
  | 'no-receiver'
  /** 정해진 시간 안에 답이 없다. */
  | 'timeout'
  /** 예상하지 못한 예외. 메시지에 내부 정보를 싣지 않는다. */
  | 'internal'
  /**
   * 사용자가 본 영상과 지금 탭의 영상이 다르다 (M10-3). 자동 재생·SPA 이동으로
   * 그 사이 바뀌었다. 다른 영상을 담지 않도록 거절하고 다시 보여 준다.
   */
  | 'page-changed'

export const ERROR_CODES: readonly ErrorCode[] = [
  'bad-request',
  'unsupported-type',
  'unsupported-version',
  'forbidden-sender',
  'no-tab',
  'no-receiver',
  'timeout',
  'internal',
  'page-changed',
]

export interface ErrorBody {
  readonly code: ErrorCode
  readonly message: string
}

export type Result<T> =
  | { readonly v: typeof PROTOCOL_VERSION; readonly ok: true; readonly data: T }
  | { readonly v: typeof PROTOCOL_VERSION; readonly ok: false; readonly error: ErrorBody }

export function ok<T>(data: T): Result<T> {
  return { v: PROTOCOL_VERSION, ok: true, data }
}

export function fail(code: ErrorCode, message: string): Result<never> {
  return { v: PROTOCOL_VERSION, ok: false, error: { code, message } }
}

/* ------------------------------------------------------------------ *
 * 요청
 * ------------------------------------------------------------------ */

/** Popup → Background. */
export type ExtensionRequest =
  | {
      readonly v: typeof PROTOCOL_VERSION
      readonly type: 'tab/inspect'
      readonly tabId: number
    }
  | {
      /**
       * Quick Add (M10-3) — 수집 화면을 연다. `videoId` 는 **사용자가 팝업에서 본**
       * 영상이다. Background 가 탭을 다시 확인해 다르면 `page-changed` 로 거절한다.
       */
      readonly v: typeof PROTOCOL_VERSION
      readonly type: 'collect/open'
      readonly tabId: number
      readonly videoId: string
    }
  | {
      /**
       * Music Moment 캡처 (M10-4) — 지금 재생 시점을 **누른 순간** 읽어 수집 화면을 연다.
       * `videoId` 는 사용자가 팝업에서 본 영상이다. 탭의 플레이어가 다른 영상이면
       * `page-changed` 로 거절한다.
       */
      readonly v: typeof PROTOCOL_VERSION
      readonly type: 'moment/capture'
      readonly tabId: number
      readonly videoId: string
    }

/**
 * Background → Content. 재생 시점은 content 가 아니라 메인 세계에서 직접 읽는다
 * (M10-4, `capturePlaybackInPage`) — 플레이어 메서드는 격리된 세계에서 보이지 않는다.
 */
export type ContentRequest = {
  readonly v: typeof PROTOCOL_VERSION
  readonly type: 'page/read'
}

export type ParseOutcome<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: ErrorBody }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function rejected(code: ErrorCode, message: string): ParseOutcome<never> {
  return { ok: false, error: { code, message } }
}

/**
 * 봉투를 확인한다 — 객체인지, 버전, `type` 이 문자열인지.
 * 순서가 뜻을 정한다: 버전이 다르면 `type` 을 보지 않는다.
 */
function readEnvelope(
  value: unknown,
): ParseOutcome<{ type: string; body: Record<string, unknown> }> {
  if (!isRecord(value)) return rejected('bad-request', '메시지가 객체가 아니다')
  if (typeof value.v !== 'number') return rejected('bad-request', '버전(v)이 없다')
  if (value.v !== PROTOCOL_VERSION)
    return rejected('unsupported-version', `지원하지 않는 버전 ${value.v}`)
  if (typeof value.type !== 'string') return rejected('bad-request', '종류(type)가 없다')
  return { ok: true, value: { type: value.type, body: value } }
}

/** YouTube 영상 ID 형식 — 웹앱 `isYouTubeVideoId` 와 같은 규칙 (호환성 테스트). */
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/

function isTabId(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

export function parseExtensionRequest(value: unknown): ParseOutcome<ExtensionRequest> {
  const envelope = readEnvelope(value)
  if (!envelope.ok) return envelope

  const { type, body } = envelope.value
  if (type === 'tab/inspect') {
    if (!isTabId(body.tabId)) return rejected('bad-request', 'tabId 가 0 이상의 정수가 아니다')
    return { ok: true, value: { v: PROTOCOL_VERSION, type, tabId: body.tabId } }
  }
  if (type === 'collect/open' || type === 'moment/capture') {
    if (!isTabId(body.tabId)) return rejected('bad-request', 'tabId 가 0 이상의 정수가 아니다')
    if (typeof body.videoId !== 'string' || !VIDEO_ID.test(body.videoId)) {
      return rejected('bad-request', 'videoId 가 11자 영상 ID 가 아니다')
    }
    return {
      ok: true,
      value: { v: PROTOCOL_VERSION, type, tabId: body.tabId, videoId: body.videoId },
    }
  }
  return rejected('unsupported-type', '모르는 요청')
}

export function parseContentRequest(value: unknown): ParseOutcome<ContentRequest> {
  const envelope = readEnvelope(value)
  if (!envelope.ok) return envelope

  if (envelope.value.type === 'page/read') {
    return { ok: true, value: { v: PROTOCOL_VERSION, type: 'page/read' } }
  }
  return rejected('unsupported-type', '모르는 요청')
}

/* ------------------------------------------------------------------ *
 * 응답 데이터
 * ------------------------------------------------------------------ */

/**
 * content script 가 페이지에서 읽은 그대로. **신뢰하지 않는 값**이다.
 *
 * `document.title` 은 싣지 않는다 — SPA 이동 뒤 약 1초 동안 이전 영상의 제목이라
 * 제목 출처로 쓸 수 없다 (M10-2 실측, EXTENSION_DESIGN.md §3-2).
 */
export interface PageSnapshot {
  readonly href: string
  readonly watch: {
    /** `ytd-watch-flexy[video-id]` — 시청 페이지가 지금 띄운 영상. */
    readonly videoId: string | null
    /** 시청 페이지의 제목 줄. */
    readonly heading: string | null
  }
}

/** 페이지에서 온 문자열의 상한. 넘으면 버린다 — 정상 페이지는 넘지 않는다. */
export const SNAPSHOT_HREF_MAX = 4096
export const SNAPSHOT_TEXT_MAX = 2000

function boundedString(value: unknown, max: number): string | null {
  return typeof value === 'string' && value.length <= max ? value : null
}

/** content 응답의 `data` 를 확인한다. 모양이 다르면 `null` — 쓰지 않는다. */
export function parsePageSnapshot(value: unknown): PageSnapshot | null {
  if (!isRecord(value) || !isRecord(value.watch)) return null

  const href = boundedString(value.href, SNAPSHOT_HREF_MAX)
  if (href === null) return null

  const rawVideoId = value.watch.videoId
  const rawHeading = value.watch.heading
  const videoId = rawVideoId === null ? null : boundedString(rawVideoId, 64)
  const heading = rawHeading === null ? null : boundedString(rawHeading, SNAPSHOT_TEXT_MAX)
  // null 은 "없다" 로 받아들이지만, 다른 타입이나 너무 긴 값은 응답 전체를 버린다.
  if ((rawVideoId !== null && videoId === null) || (rawHeading !== null && heading === null)) {
    return null
  }

  return { href, watch: { videoId, heading } }
}

/** 메인 세계에서 읽은 플레이어 하나 (`readPlayersInPage`). **신뢰하지 않는 값**이다. */
export interface PlayerCandidate {
  readonly videoId: string
  readonly title: string | null
}

/** 플레이어 후보 목록을 확인한다. 모양이 다르면 `null` — 쓰지 않는다. */
export function parsePlayerCandidates(value: unknown): PlayerCandidate[] | null {
  if (!Array.isArray(value) || value.length > 4) return null
  const list: PlayerCandidate[] = []
  for (const item of value) {
    if (!isRecord(item)) return null
    const videoId = boundedString(item.videoId, 64)
    const title = item.title === null ? null : boundedString(item.title, SNAPSHOT_TEXT_MAX)
    if (videoId === null || (item.title !== null && title === null)) return null
    list.push({ videoId, title })
  }
  return list
}

export type PageKind = 'watch' | 'shorts' | 'live' | 'embed'

export type UnsupportedReason =
  /** YouTube 가 아닌 사이트. */
  | 'not-youtube'
  /** YouTube 지만 영상 페이지가 아니다 (홈 · 검색 · 채널 · 잘못된 ID). */
  | 'not-video-page'
  /** YouTube Music — M10 범위 밖 (EXTENSION_DESIGN.md §3). */
  | 'youtube-music'
  /** 주소를 볼 권한이 없다 (activeTab 회수 · 제한된 페이지). */
  | 'no-access'
  /** `chrome://` 등 확장이 다룰 수 없는 페이지. */
  | 'restricted'

export const UNSUPPORTED_REASONS: readonly UnsupportedReason[] = [
  'not-youtube',
  'not-video-page',
  'youtube-music',
  'no-access',
  'restricted',
]

/** 제목을 어디서 읽었나. `player` = 메인 세계의 `getVideoData()`, `heading` = 시청 페이지 제목 줄. */
export type TitleSource = 'player' | 'heading'

/** `tab/inspect` 의 결과. "지원하지 않는 페이지" 는 오류가 아니라 정상 결과다. */
export type PageInspection =
  | {
      readonly status: 'video'
      readonly videoId: string
      readonly pageKind: PageKind
      readonly title: string | null
      readonly titleSource: TitleSource | null
    }
  | { readonly status: 'unsupported'; readonly reason: UnsupportedReason }

const PAGE_KINDS: readonly PageKind[] = ['watch', 'shorts', 'live', 'embed']
const TITLE_SOURCES: readonly TitleSource[] = ['player', 'heading']

/** Background 의 응답 `data` 를 Popup 이 확인한다. */
export function parsePageInspection(value: unknown): PageInspection | null {
  if (!isRecord(value)) return null

  if (value.status === 'unsupported') {
    return UNSUPPORTED_REASONS.includes(value.reason as UnsupportedReason)
      ? { status: 'unsupported', reason: value.reason as UnsupportedReason }
      : null
  }

  if (value.status !== 'video') return null
  if (typeof value.videoId !== 'string' || !VIDEO_ID.test(value.videoId)) return null
  if (!PAGE_KINDS.includes(value.pageKind as PageKind)) return null

  const title = value.title === null ? null : boundedString(value.title, SNAPSHOT_TEXT_MAX)
  if (value.title !== null && title === null) return null

  const titleSource = value.titleSource
  if (titleSource !== null && !TITLE_SOURCES.includes(titleSource as TitleSource)) return null
  if ((title === null) !== (titleSource === null)) return null

  return {
    status: 'video',
    videoId: value.videoId,
    pageKind: value.pageKind as PageKind,
    title,
    titleSource: titleSource as TitleSource | null,
  }
}

/**
 * 응답 봉투를 확인하고 `data` 를 `parseData` 로 검사한다.
 * 모양이 틀리면 `internal` 실패로 바꾼다 — 받는 쪽이 틀린 값을 쓰지 않게.
 */
export function parseResult<T>(value: unknown, parseData: (data: unknown) => T | null): Result<T> {
  if (!isRecord(value) || value.v !== PROTOCOL_VERSION || typeof value.ok !== 'boolean') {
    return fail('internal', '응답 형식이 아니다')
  }

  if (value.ok) {
    const data = parseData(value.data)
    return data === null ? fail('internal', '응답 데이터 형식이 아니다') : ok(data)
  }

  const error = value.error
  if (
    !isRecord(error) ||
    !ERROR_CODES.includes(error.code as ErrorCode) ||
    typeof error.message !== 'string'
  ) {
    return fail('internal', '오류 응답 형식이 아니다')
  }
  return fail(error.code as ErrorCode, error.message.slice(0, 300))
}

/** `collect/open` 의 결과. `focused` 는 방금 연 같은 요청의 탭을 다시 앞으로 가져왔다는 뜻. */
export interface CollectOpened {
  readonly status: 'opened' | 'focused'
  readonly tabId: number
}

export function parseCollectOpened(value: unknown): CollectOpened | null {
  if (!isRecord(value)) return null
  if (value.status !== 'opened' && value.status !== 'focused') return null
  if (!isTabId(value.tabId)) return null
  return { status: value.status, tabId: value.tabId }
}

/* ------------------------------------------------------------------ *
 * Music Moment 캡처 (M10-4)
 * ------------------------------------------------------------------ */

/**
 * 메인 세계에서 **한 번에** 읽은 플레이어 상태 (`capturePlaybackInPage`).
 * 영상 ID · 제목 · 시점이 같은 순간 같은 플레이어에서 온다. **신뢰하지 않는 값**이다.
 */
export interface PlaybackSnapshot {
  readonly videoId: string | null
  readonly title: string | null
  /** `getCurrentTime()` — 유한한 수가 아니면 `null`. */
  readonly currentTime: number | null
  /** `getPlayerState()` — -1 시작 전 · 0 끝 · 1 재생 · 2 일시정지 · 3 버퍼링 · 5 대기. */
  readonly state: number | null
  readonly duration: number | null
  /** 광고가 재생 중 (`ad-showing` · `ad-interrupting`). */
  readonly adShowing: boolean
  /** 라이브 방송 (`getVideoData().isLive` · 라이브 표시). */
  readonly live: boolean
}

function finiteOrNull(value: unknown): number | null | undefined {
  if (value === null) return null
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/** 스냅샷 모양을 확인한다. 틀리면 `null` — 쓰지 않는다. */
export function parsePlaybackSnapshot(value: unknown): PlaybackSnapshot | null {
  if (!isRecord(value)) return null
  const videoId = value.videoId === null ? null : boundedString(value.videoId, 64)
  const title = value.title === null ? null : boundedString(value.title, SNAPSHOT_TEXT_MAX)
  const currentTime = finiteOrNull(value.currentTime)
  const state = finiteOrNull(value.state)
  const duration = finiteOrNull(value.duration)
  if ((value.videoId !== null && videoId === null) || (value.title !== null && title === null)) {
    return null
  }
  if (currentTime === undefined || state === undefined || duration === undefined) return null
  if (typeof value.adShowing !== 'boolean' || typeof value.live !== 'boolean') return null
  return {
    videoId,
    title,
    currentTime,
    state,
    duration,
    adShowing: value.adShowing,
    live: value.live,
  }
}

export type CaptureRefusal =
  /** Shorts — MVP 범위 밖. */
  | 'shorts'
  /** 라이브 방송 — MVP 범위 밖 (시점이 계속 움직이고 다시 볼 때 같은 지점이 아닐 수 있다). */
  | 'live'
  /** 광고가 재생 중이다 — 그 시점은 영상의 시점이 아니다. */
  | 'ad'
  /** 재생이 시작되지 않았거나 불러오는 중이다 — 시점이 확정되지 않았다. */
  | 'not-started'
  /** 플레이어를 읽지 못했다. */
  | 'unreadable'
  /** 시청 페이지가 아니다 (임베드 등). */
  | 'not-watch'

export const CAPTURE_REFUSALS: readonly CaptureRefusal[] = [
  'shorts',
  'live',
  'ad',
  'not-started',
  'unreadable',
  'not-watch',
]

/** `moment/capture` 의 결과. 거절은 오류가 아니라 정상 결과다. */
export type MomentCaptured =
  | {
      readonly status: 'opened' | 'focused'
      readonly tabId: number
      readonly videoId: string
      readonly atSeconds: number
    }
  | { readonly status: 'refused'; readonly reason: CaptureRefusal }

export function parseMomentCaptured(value: unknown): MomentCaptured | null {
  if (!isRecord(value)) return null
  if (value.status === 'refused') {
    return CAPTURE_REFUSALS.includes(value.reason as CaptureRefusal)
      ? { status: 'refused', reason: value.reason as CaptureRefusal }
      : null
  }
  if (value.status !== 'opened' && value.status !== 'focused') return null
  if (!isTabId(value.tabId)) return null
  if (typeof value.videoId !== 'string' || !VIDEO_ID.test(value.videoId)) return null
  const atSeconds = value.atSeconds
  if (typeof atSeconds !== 'number' || !Number.isSafeInteger(atSeconds) || atSeconds < 0) {
    return null
  }
  return { status: value.status, tabId: value.tabId, videoId: value.videoId, atSeconds }
}
