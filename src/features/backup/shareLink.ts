/**
 * 링크 공유 — `#share?v=1&d=…` (ADR 0040).
 *
 * 첨부 파일을 올릴 수 없는 곳(커뮤니티 게시판 등)에 목록 · 곡 · Moment 를 **링크 하나**로 건네기 위한 형식이다.
 * 서버가 없다 — 내용을 압축해 주소 **조각(`#` 뒤)** 에 싣는다. 조각은 서버로 가지 않으므로 39page 서버 · 요청 기록에
 * 남지 않는다 (수집 링크와 같은 원칙, ADR 0023 결정 2).
 *
 * ```text
 * https://39page.com/#share?v=1&d=<base64url( raw DEFLATE( UTF-8 JSON ) )>
 *
 * JSON (짧은 키):
 *   k  "p" 목록 | "t" 곡 하나 | "m" Moment 하나
 *   n  목록 이름 (k = "p" 일 때만, 선택)
 *   t  [[영상 ID, 제목?], …]            — 순서대로. 제목은 선택 (빼면 받는 쪽이 YouTube 에서 찾는다)
 *   m  [[곡 자리, 초, 메모?], …]         — 선택. 곡 자리는 t 안의 위치 (0 부터)
 * ```
 *
 * 주소 조각은 **누구나 만들 수 있다.** 그래서 읽기는 길이 · 압축 해제 크기 · 개수 · 글자 · 형식을 모두 본 뒤에만 내용을
 * 돌려준다. 실행하거나 HTML 로 해석하지 않고, 통과해도 저장하지 않는다 — 저장은 받는 사람이 미리보기에서 누를 때만.
 * 앨범아트(직접 올린 그림)는 싣지 않는다 — 링크에 들어가기엔 너무 크다. 받는 쪽에서는 썸네일 · 기본 그림으로 보인다.
 *
 * 순수 함수다 — store · 저장소 · DOM 을 만지지 않는다.
 */
import { deflateSync, Inflate } from 'fflate'

import type { Moment, Playlist, Track } from '@/shared/types'
import { isYouTubeVideoId } from '@/shared/utils/youtube'

/** 공유 링크 조각의 머리. `#share` 하나 또는 `#share?…`. */
export const SHARE_HASH_PREFIX = '#share'

/** 지원하는 형식 버전. 문자열로 비교한다. 의미가 바뀌면 올린다. */
export const SHARE_LINK_VERSION = '1'

/** `d` 의 최대 길이(글자). 이보다 긴 링크는 만들지도 읽지도 않는다 — 그만큼이면 파일 공유(ZIP)가 맞다. */
export const MAX_SHARE_DATA_LENGTH = 16_000

/** 압축을 푼 JSON 의 최대 크기(바이트). 작은 링크가 엄청나게 풀리는 것(압축 폭탄)을 막는다. */
export const MAX_SHARE_JSON_BYTES = 128 * 1024

/** 링크 하나에 담는 곡 · Moment 수의 상한. */
export const MAX_SHARE_LINK_TRACKS = 1000
export const MAX_SHARE_LINK_MOMENTS = 1000

/** Moment 시점의 상한 — 수집 링크와 같다 (999999초 ≈ 277시간). */
export const MAX_SHARE_AT_SECONDS = 999_999

/**
 * 이보다 긴 링크는 "일부 게시판에서 잘릴 수 있어요" 라고 알린다 (주소 전체 길이). 만들 수는 있다 — 어디까지 받아
 * 주는지는 게시판마다 다르다.
 */
export const SHARE_LINK_SOFT_LIMIT = 2000

/**
 * 글자 수 상한 — 라이브러리 · Moments 의 입력 상한과 같다 (테스트가 고정한다). 이 순수 모듈이 store 를 끌어오지
 * 않게 값을 따로 둔다 (`collectRequest.ts` 와 같은 방식).
 */
export const MAX_SHARE_NAME_LENGTH = 60
export const MAX_SHARE_TITLE_LENGTH = 100
export const MAX_SHARE_NOTE_LENGTH = 500

export type ShareLinkKind = 'playlist' | 'track' | 'moment'

export interface ShareLinkTrack {
  readonly videoId: string
  /** 보낸 사람의 곡 이름. 링크에 넣지 않았으면 `''` — 받는 쪽이 YouTube 에서 찾거나 기본 이름을 쓴다. */
  readonly title: string
}

export interface ShareLinkMoment {
  readonly videoId: string
  readonly atSeconds: number
  /** 링크에 넣지 않았으면 `''`. */
  readonly note: string
}

export interface ShareLinkContent {
  readonly kind: ShareLinkKind
  /** 목록 이름. 목록이 아니거나 넣지 않았으면 `''`. */
  readonly name: string
  readonly tracks: readonly ShareLinkTrack[]
  readonly moments: readonly ShareLinkMoment[]
}

export type ShareLinkProblem =
  /** 공유 링크 조각이 아니다. */
  | 'not-share'
  /** 링크가 상한보다 길거나, 풀었더니 너무 크다. */
  | 'too-long'
  /** 버전이 없다. */
  | 'missing-version'
  /** 이 39page 가 모르는 버전이다 (더 새 39page 가 만든 링크일 수 있다). */
  | 'unsupported-version'
  /** 내용(`d`)이 없다 — 링크가 잘렸을 가능성이 크다. */
  | 'missing-data'
  /** 내용을 풀 수 없다 — 잘렸거나 손상됐다. */
  | 'corrupt'
  /** 풀었지만 형식이 맞지 않는다. */
  | 'invalid'
  /** 곡 · Moment 가 상한보다 많다. */
  | 'too-many'

export type ShareLinkParse =
  | { readonly ok: true; readonly content: ShareLinkContent }
  | { readonly ok: false; readonly problem: ShareLinkProblem }

const KIND_CODE: Readonly<Record<ShareLinkKind, string>> = {
  playlist: 'p',
  track: 't',
  moment: 'm',
}
const KIND_OF: Readonly<Record<string, ShareLinkKind>> = { p: 'playlist', t: 'track', m: 'moment' }

/* ------------------------------------------------------------------ *
 * 글자 규칙
 * ------------------------------------------------------------------ */

/**
 * 쓸 수 없는 글자 — C0 · C1 제어 문자와 양방향 텍스트 재정의 · 격리 문자 (수집 링크 · 브리지와 같은 규칙).
 * 메모만 줄바꿈(LF)을 받는다.
 */
function isForbiddenCode(code: number, allowNewline: boolean): boolean {
  if (allowNewline && code === 0x0a) return false
  if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) return true
  return (code >= 0x202a && code <= 0x202e) || (code >= 0x2066 && code <= 0x2069)
}

function hasForbidden(text: string, allowNewline: boolean): boolean {
  for (const char of text) {
    if (isForbiddenCode(char.charCodeAt(0), allowNewline)) return true
  }
  return false
}

/** 만들 때: 쓸 수 없는 글자를 걷어내고(줄바꿈은 메모만) 앞뒤 공백을 지운 뒤 상한에서 자른다 (글자 단위). */
function clean(text: string, max: number, allowNewline = false): string {
  const kept = [...text.replace(/\r\n?/g, '\n')]
    .filter((char) => !isForbiddenCode(char.charCodeAt(0), allowNewline))
    .join('')
    .trim()
  return [...kept].slice(0, max).join('').trim()
}

/** 읽을 때: 문자열 · 글자 규칙 · 상한을 지키는지. 지키면 앞뒤 공백을 지운 값, 아니면 `null`. */
function readText(value: unknown, max: number, allowNewline = false): string | null {
  if (typeof value !== 'string') return null
  if (hasForbidden(value, allowNewline)) return null
  const trimmed = value.trim()
  return [...trimmed].length > max ? null : trimmed
}

/* ------------------------------------------------------------------ *
 * base64url · 압축
 * ------------------------------------------------------------------ */

const BASE64URL = /^[A-Za-z0-9_-]+$/

function toBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (let at = 0; at < bytes.length; at += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000))
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(text: string): Uint8Array | null {
  if (!BASE64URL.test(text) || text.length % 4 === 1) return null
  const padded =
    text.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (text.length % 4)) % 4)
  let binary: string
  try {
    binary = atob(padded)
  } catch {
    return null
  }
  const bytes = new Uint8Array(binary.length)
  for (let at = 0; at < binary.length; at += 1) bytes[at] = binary.charCodeAt(at)
  return bytes
}

/**
 * 압축을 푼다 — **실제로 풀린 양**을 세며 조금씩. 상한을 넘으면 그 자리에서 멈춘다 (작은 입력이 수 MB 로 풀리는 것을
 * 끝까지 풀지 않는다). 잘린 · 손상된 입력은 `null`.
 */
function inflateCapped(data: Uint8Array, max: number): Uint8Array | 'too-large' | null {
  const chunks: Uint8Array[] = []
  let total = 0
  let over = false
  let ended = false
  const inflater = new Inflate((chunk, final) => {
    total += chunk.length
    if (total > max) {
      over = true
      return
    }
    chunks.push(chunk)
    if (final) ended = true
  })
  try {
    const STEP = 256
    for (let at = 0; at < data.length && !over; at += STEP) {
      inflater.push(data.subarray(at, at + STEP), at + STEP >= data.length)
    }
  } catch {
    return over ? 'too-large' : null
  }
  if (over) return 'too-large'
  if (!ended) return null
  const out = new Uint8Array(total)
  let at = 0
  for (const chunk of chunks) {
    out.set(chunk, at)
    at += chunk.length
  }
  return out
}

/* ------------------------------------------------------------------ *
 * 만들기
 * ------------------------------------------------------------------ */

/**
 * 내용을 조각(`#share?v=1&d=…`)으로 만든다. 같은 내용이면 같은 조각이다 (키 순서 · 압축 수준 고정).
 *
 * 글자는 여기서 한 번 더 다듬는다 — 쓸 수 없는 글자를 걷어내고 상한에서 자른다. 곡 자리를 찾을 수 없는 Moment 는
 * 넣지 않는다.
 */
export function encodeShareLink(content: ShareLinkContent): string {
  const tracks = content.tracks
    .filter((track) => isYouTubeVideoId(track.videoId))
    .slice(0, MAX_SHARE_LINK_TRACKS)
  const position = new Map<string, number>()
  tracks.forEach((track, index) => {
    if (!position.has(track.videoId)) position.set(track.videoId, index)
  })
  const moments = content.moments
    .filter(
      (moment) =>
        position.has(moment.videoId) &&
        Number.isInteger(moment.atSeconds) &&
        moment.atSeconds >= 0 &&
        moment.atSeconds <= MAX_SHARE_AT_SECONDS,
    )
    .slice(0, MAX_SHARE_LINK_MOMENTS)

  const name = content.kind === 'playlist' ? clean(content.name, MAX_SHARE_NAME_LENGTH) : ''
  const wire: Record<string, unknown> = { k: KIND_CODE[content.kind] }
  if (name !== '') wire.n = name
  wire.t = tracks.map((track) => {
    const title = clean(track.title, MAX_SHARE_TITLE_LENGTH)
    return title === '' ? [track.videoId] : [track.videoId, title]
  })
  if (moments.length > 0) {
    wire.m = moments.map((moment) => {
      const note = clean(moment.note, MAX_SHARE_NOTE_LENGTH, true)
      const at = position.get(moment.videoId) ?? 0
      return note === '' ? [at, moment.atSeconds] : [at, moment.atSeconds, note]
    })
  }

  const json = new Uint8Array(new TextEncoder().encode(JSON.stringify(wire)))
  const data = toBase64Url(deflateSync(json, { level: 9 }))
  return `${SHARE_HASH_PREFIX}?v=${SHARE_LINK_VERSION}&d=${data}`
}

/* ------------------------------------------------------------------ *
 * 라이브러리 → 링크 내용
 * ------------------------------------------------------------------ */

/** 무엇을 넣을지. 곡 이름을 빼면 링크가 짧아지고, 받는 쪽이 YouTube 에서 제목을 찾는다. */
export interface ShareLinkOptions {
  readonly titles: boolean
  /** Moment 메모. 켰을 때만 넣는다 — 링크를 가진 누구나 읽을 수 있다. */
  readonly notes: boolean
}

/**
 * 링크에 실을 곡 이름. 끄면 `''`. 이름을 지은 적 없는 곡의 기본 이름(`YouTube · <id>`)도 `''` 다 — 실어 봐야 길이만
 * 늘고, 받는 쪽이 YouTube 에서 실제 제목을 찾는 편이 낫다.
 */
function linkTitle(track: Pick<Track, 'videoId' | 'title'>, options: ShareLinkOptions): string {
  if (!options.titles) return ''
  return track.title === `YouTube · ${track.videoId}` ? '' : track.title
}

function linkMoments(
  moments: readonly Moment[] | null,
  order: readonly string[],
  options: ShareLinkOptions,
): ShareLinkMoment[] {
  if (moments === null) return []
  const position = new Map<string, number>()
  order.forEach((videoId, index) => {
    if (!position.has(videoId)) position.set(videoId, index)
  })
  return moments
    .filter((moment) => position.has(moment.videoId))
    .map((moment) => ({
      videoId: moment.videoId,
      atSeconds: moment.atSeconds,
      note: options.notes ? moment.note : '',
    }))
    .sort(
      (a, b) =>
        (position.get(a.videoId) ?? 0) - (position.get(b.videoId) ?? 0) ||
        a.atSeconds - b.atSeconds,
    )
}

/** 목록 하나 — 이름과 곡을 목록 순서대로. `moments` 를 주면 그 곡들의 영상 것만 넣는다. */
export function playlistLinkContent(
  playlist: Playlist,
  moments: readonly Moment[] | null,
  options: ShareLinkOptions,
): ShareLinkContent {
  return {
    kind: 'playlist',
    name: playlist.name,
    tracks: playlist.tracks.map((track) => ({
      videoId: track.videoId,
      title: linkTitle(track, options),
    })),
    moments: linkMoments(
      moments,
      playlist.tracks.map((track) => track.videoId),
      options,
    ),
  }
}

/** 곡 하나. `moments` 를 주면 그 영상의 Moments 를 넣는다. */
export function trackLinkContent(
  track: Track,
  moments: readonly Moment[] | null,
  options: ShareLinkOptions,
): ShareLinkContent {
  return {
    kind: 'track',
    name: '',
    tracks: [{ videoId: track.videoId, title: linkTitle(track, options) }],
    moments: linkMoments(moments, [track.videoId], options),
  }
}

/** Moment 하나. `title` 은 화면에 보이는 그 곡의 이름(라이브러리 → Moment 스냅샷 순). */
export function momentLinkContent(
  moment: Moment,
  title: string,
  options: ShareLinkOptions,
): ShareLinkContent {
  return {
    kind: 'moment',
    name: '',
    tracks: [
      { videoId: moment.videoId, title: linkTitle({ videoId: moment.videoId, title }, options) },
    ],
    moments: [
      {
        videoId: moment.videoId,
        atSeconds: moment.atSeconds,
        note: options.notes ? moment.note : '',
      },
    ],
  }
}

/** 공유 링크 전체 주소. `base` 는 39page 의 주소(조각 없이) — 보통 `location.origin + location.pathname`. */
export function shareLinkUrl(base: string, content: ShareLinkContent): string {
  return `${base.replace(/#.*$/, '')}${encodeShareLink(content)}`
}

/* ------------------------------------------------------------------ *
 * 읽기
 * ------------------------------------------------------------------ */

/** 조각이 공유 링크인지. `#shared` 같은 다른 조각과 헷갈리지 않는다. */
export function isShareHash(hash: string): boolean {
  return hash === SHARE_HASH_PREFIX || hash.startsWith(`${SHARE_HASH_PREFIX}?`)
}

function fail(problem: ShareLinkProblem): ShareLinkParse {
  return { ok: false, problem }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 압축을 푼 JSON 을 검증해 내용으로 바꾼다. 하나라도 어기면 `null` — 일부만 받지 않는다. */
function readWire(wire: unknown): ShareLinkContent | 'too-many' | null {
  if (!isRecord(wire) || typeof wire.k !== 'string') return null
  const kind = KIND_OF[wire.k]
  if (kind === undefined) return null

  if (!Array.isArray(wire.t) || wire.t.length === 0) return null
  if (wire.t.length > MAX_SHARE_LINK_TRACKS) return 'too-many'
  if (kind !== 'playlist' && wire.t.length !== 1) return null
  const tracks: ShareLinkTrack[] = []
  for (const raw of wire.t as unknown[]) {
    if (!Array.isArray(raw) || raw.length < 1 || raw.length > 2) return null
    const [videoId, rawTitle] = raw as unknown[]
    if (!isYouTubeVideoId(videoId)) return null
    const title = rawTitle === undefined ? '' : readText(rawTitle, MAX_SHARE_TITLE_LENGTH)
    if (title === null) return null
    tracks.push({ videoId, title })
  }

  let name = ''
  if (wire.n !== undefined) {
    if (kind !== 'playlist') return null
    const read = readText(wire.n, MAX_SHARE_NAME_LENGTH)
    if (read === null) return null
    name = read
  }

  const moments: ShareLinkMoment[] = []
  if (wire.m !== undefined) {
    if (!Array.isArray(wire.m)) return null
    if (wire.m.length > MAX_SHARE_LINK_MOMENTS) return 'too-many'
    for (const raw of wire.m as unknown[]) {
      if (!Array.isArray(raw) || raw.length < 2 || raw.length > 3) return null
      const [at, seconds, rawNote] = raw as unknown[]
      if (typeof at !== 'number' || !Number.isInteger(at) || at < 0 || at >= tracks.length) {
        return null
      }
      if (
        typeof seconds !== 'number' ||
        !Number.isInteger(seconds) ||
        seconds < 0 ||
        seconds > MAX_SHARE_AT_SECONDS
      ) {
        return null
      }
      const note = rawNote === undefined ? '' : readText(rawNote, MAX_SHARE_NOTE_LENGTH, true)
      if (note === null) return null
      const track = tracks[at]
      if (track === undefined) return null
      moments.push({ videoId: track.videoId, atSeconds: seconds, note })
    }
  }
  if (kind === 'moment' && moments.length !== 1) return null

  return { kind, name, tracks, moments }
}

/**
 * 공유 링크 조각을 읽고 **모두** 검증한다. 아무것도 쓰지 않는다.
 *
 * 순서: 조각 모양 → 길이 → 매개변수(중복 · 버전) → base64url → 압축 해제(상한) → UTF-8 → JSON → 형식 · 개수 · 글자.
 */
export function parseShareLink(hash: string): ShareLinkParse {
  if (!isShareHash(hash)) return fail('not-share')
  if (hash.length > MAX_SHARE_DATA_LENGTH + 64) return fail('too-long')

  const params = new URLSearchParams(hash.slice(SHARE_HASH_PREFIX.length + 1))
  if (params.getAll('v').length > 1 || params.getAll('d').length > 1) return fail('invalid')
  const version = params.get('v')
  if (version === null) return fail('missing-version')
  if (version !== SHARE_LINK_VERSION) return fail('unsupported-version')

  const data = params.get('d')
  if (data === null || data === '') return fail('missing-data')
  if (data.length > MAX_SHARE_DATA_LENGTH) return fail('too-long')
  const bytes = fromBase64Url(data)
  if (bytes === null) return fail('corrupt')

  const inflated = inflateCapped(bytes, MAX_SHARE_JSON_BYTES)
  if (inflated === 'too-large') return fail('too-long')
  if (inflated === null) return fail('corrupt')

  let wire: unknown
  try {
    wire = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(inflated))
  } catch {
    return fail('corrupt')
  }
  const content = readWire(wire)
  if (content === 'too-many') return fail('too-many')
  return content === null ? fail('invalid') : { ok: true, content }
}

/** 받는 사람에게 보일 안내 — 무엇을 하면 되는지로 끝난다. */
export const SHARE_LINK_PROBLEM_MESSAGE: Readonly<Record<ShareLinkProblem, string>> = {
  'not-share': '공유 링크가 아니에요.',
  'too-long': '링크가 너무 길어 열 수 없어요. 보낸 사람에게 파일 공유(ZIP)로 받아 주세요.',
  'missing-version':
    '공유 링크의 일부가 빠졌어요. 링크가 잘리지 않았는지 확인하고 다시 열어 주세요.',
  'unsupported-version':
    '더 새로운 39page 에서 만든 링크예요. 새로고침한 뒤에도 같으면 보낸 사람에게 알려 주세요.',
  'missing-data':
    '공유 링크의 내용이 비어 있어요. 링크가 잘리지 않았는지 확인하고 다시 열어 주세요.',
  corrupt: '공유 링크가 잘렸거나 손상됐어요. 보낸 사람에게 링크를 다시 받아 주세요.',
  invalid: '공유 링크의 내용이 올바르지 않아요. 보낸 사람에게 링크를 다시 받아 주세요.',
  'too-many': '공유한 곡이나 Moment 가 너무 많아요. 보낸 사람에게 파일 공유(ZIP)로 받아 주세요.',
}
