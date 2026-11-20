/**
 * 공유 카드 이미지 — 무엇을 어떤 틀로 그릴지 (ADR 0041). 순수 함수다 — 캔버스 · store · DOM 을 만지지 않는다.
 *
 * 게시판에 올리고 그 이미지에 공유 링크(ADR 0040)를 거는 카드. 틀은 테마와 곡 수로 정한다.
 *
 * | 내용            | Kawaii Synth Cassette        | Mono Vinyl                 |
 * | --------------- | ---------------------------- | -------------------------- |
 * | 목록 1–10곡     | 카세트 J카드 1080×1350       | LP 뒷면 1080×1080          |
 * | 목록 11곡 이상  | 영수증 (민트 종이)           | 영수증 (베이지 종이)       |
 * | 곡 하나 · Moment | 싱글 1080×1350 (도트 카세트) | 7인치 싱글 1080×1080 (LP) |
 *
 * 넣지 않는 것: QR · 링크 안내 문구 (사용자 결정, 2026-11-20), YouTube 썸네일 · 로고 (YouTube 정책 —
 * `docs/product/SHARE_CARD_RESEARCH.md` §4). 곡 이름의 "(Official Video)" · "MV" 같은 꼬리는 카드에서만 뗀다.
 */
import type { InjectionKey } from 'vue'

import type { ShareLinkContent } from './shareLink'

export type ShareCardTheme = 'kawaii' | 'mono'
export type ShareCardTemplate = 'jcard' | 'lp' | 'single' | 'receipt'

export const SHARE_CARD_WIDTH = 1080
/** J카드 · LP 한 장에 담는 곡 수 (SIDE A 5 + SIDE B 5). 넘으면 영수증. */
export const SHARE_CARD_SIDE_LIMIT = 10
/** 영수증 이미지의 최대 높이 — 게시판 전용 긴 판 (약 43곡). 넘으면 "+N곡 더". */
export const SHARE_CARD_MAX_HEIGHT = 3240

export interface ShareCardRow {
  /** 줄 번호 — J카드 · LP 는 `A1` · `B2`, 영수증은 `01`. */
  readonly no: string
  readonly title: string
  /** 그 곡의 첫 Moment 시점 (`1:23`). 없으면 `null`. */
  readonly moment: string | null
}

export interface ShareCardModel {
  readonly theme: ShareCardTheme
  readonly template: ShareCardTemplate
  readonly kind: ShareLinkContent['kind']
  readonly width: number
  /** 영수증은 그릴 때 정해진다(곡 이름 줄 수에 따라) — 여기서는 J카드 · LP · 싱글만 고정값. */
  readonly height: number | null
  /** 목록 이름 또는 곡 이름. */
  readonly heading: string
  /** J카드 · LP 의 두 면. 영수증 · 싱글은 빈 배열. */
  readonly sides: readonly (readonly ShareCardRow[])[]
  /** 영수증의 곡 줄 (상한 안의 것만 — 넘치면 `more`). */
  readonly rows: readonly ShareCardRow[]
  readonly totalTracks: number
  readonly momentCount: number
  /** 싱글: Moment 시점과 메모 (메모는 링크에 넣을 때만). */
  readonly moment: { readonly at: string; readonly note: string } | null
  /** `2026.11.20` */
  readonly date: string
  /** `21:42` */
  readonly time: string
  /** LP 카탈로그 번호 흉내 — `39P-1120` (월일). */
  readonly catalog: string
}

/* ------------------------------------------------------------------ *
 * 글자
 * ------------------------------------------------------------------ */

/** 카드에서만 떼는 꼬리 — 대괄호 · 괄호 안의 Official · MV · Audio · Video · Lyrics · 가사 · 뮤직비디오, 끝의 "MV". */
const TAIL_IN_BRACKETS =
  /\s*[[(（【](?:[^\])）】]*?\b(?:official|m\/?v|audio|video|lyrics?|visualizer)\b[^\])）】]*|가사|뮤직\s?비디오)[\])）】]/gi
const TAIL_AT_END = /\s+(?:official\s+)?(?:m\/?v|music\s+video)$/i

/** 곡 이름을 카드에 쓸 모양으로 — 저장된 이름은 그대로 두고 그리는 글자만 다듬는다. */
export function tidyTitle(title: string): string {
  const cleaned = title
    .replace(TAIL_IN_BRACKETS, '')
    .replace(TAIL_AT_END, '')
    .replace(/\s+/g, ' ')
    .trim()
  return cleaned === '' ? title.trim() : cleaned
}

/** `83` → `1:23`, `3723` → `1:02:03`. */
export function formatAt(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = String(s % 60).padStart(2, '0')
  return h > 0 ? `${String(h)}:${String(m).padStart(2, '0')}:${sec}` : `${String(m)}:${sec}`
}

/** `Intl.Segmenter` 의 쓰는 부분만 — 프로젝트의 TS lib 에 아직 없다 (Chrome 87 · Safari 14.1 · Firefox 125). */
type GraphemeSegmenter = new (
  locales?: string,
  options?: { granularity: 'grapheme' },
) => { segment(input: string): Iterable<{ segment: string }> }

/** 그래핌(사람이 보는 글자) 단위로 나눈다 — 이모지 · 결합 문자가 반으로 잘리지 않게. 없으면 코드 포인트 단위. */
export function graphemes(text: string): string[] {
  const Segmenter = (Intl as unknown as { Segmenter?: GraphemeSegmenter }).Segmenter
  if (typeof Segmenter === 'function') {
    return [...new Segmenter(undefined, { granularity: 'grapheme' }).segment(text)].map(
      (part) => part.segment,
    )
  }
  return [...text]
}

/** 글자 폭을 재는 함수 (캔버스의 `measureText(text).width`). */
export type Measure = (text: string) => number

const ELLIPSIS = '…'

/** 한 줄에 맞춘다 — 넘치면 그래핌 단위로 줄이고 "…" 를 붙인다. */
export function fitLine(text: string, maxWidth: number, measure: Measure): string {
  if (measure(text) <= maxWidth) return text
  const parts = graphemes(text)
  let low = 0
  let high = parts.length
  while (low < high) {
    const mid = Math.ceil((low + high) / 2)
    if (measure(`${parts.slice(0, mid).join('').trimEnd()}${ELLIPSIS}`) <= maxWidth) low = mid
    else high = mid - 1
  }
  return low === 0 ? ELLIPSIS : `${parts.slice(0, low).join('').trimEnd()}${ELLIPSIS}`
}

/**
 * 여러 줄로 나눈다 — 한글도 **낱말 안에서 끊지 않는다**(CSS keep-all). 한 낱말이 한 줄보다 길 때만 그래핌에서 끊는다.
 * `maxLines` 를 넘으면 마지막 줄에 "…".
 */
export function wrapLines(
  text: string,
  maxWidth: number,
  maxLines: number,
  measure: Measure,
): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let line = ''
  const pushLine = (value: string): void => {
    lines.push(value)
  }
  for (let index = 0; index < words.length; index += 1) {
    const word = words[index] ?? ''
    const candidate = line === '' ? word : `${line} ${word}`
    if (measure(candidate) <= maxWidth) {
      line = candidate
      continue
    }
    if (line !== '') {
      pushLine(line)
      line = ''
    }
    // 낱말 하나가 한 줄보다 길다 — 그래핌에서 끊는다.
    if (measure(word) > maxWidth) {
      let chunk = ''
      for (const part of graphemes(word)) {
        if (chunk !== '' && measure(chunk + part) > maxWidth) {
          pushLine(chunk)
          chunk = ''
        }
        chunk += part
      }
      line = chunk
    } else {
      line = word
    }
  }
  if (line !== '') pushLine(line)

  if (lines.length <= maxLines) return lines
  // 남은 글을 마지막 줄에 넣는다 — 잘렸다는 것이 보이게 늘 "…" 로 끝낸다.
  const kept = lines.slice(0, maxLines - 1)
  const rest = lines.slice(maxLines - 1).join(' ')
  const last = fitLine(rest, maxWidth, measure)
  kept.push(last.endsWith(ELLIPSIS) ? last : fitLine(`${rest}${ELLIPSIS}`, maxWidth, measure))
  return kept
}

/* ------------------------------------------------------------------ *
 * 틀 고르기
 * ------------------------------------------------------------------ */

function two(value: number): string {
  return String(value).padStart(2, '0')
}

/** 공유 링크의 내용(곡 이름 포함 판)으로 카드 모델을 만든다. */
export function buildShareCard(
  content: ShareLinkContent,
  theme: ShareCardTheme,
  now: Date,
): ShareCardModel {
  const date = `${String(now.getFullYear())}.${two(now.getMonth() + 1)}.${two(now.getDate())}`
  const time = `${two(now.getHours())}:${two(now.getMinutes())}`
  const catalog = `39P-${two(now.getMonth() + 1)}${two(now.getDate())}`

  const firstMoment = new Map<string, number>()
  for (const moment of content.moments) {
    const seen = firstMoment.get(moment.videoId)
    if (seen === undefined || moment.atSeconds < seen)
      firstMoment.set(moment.videoId, moment.atSeconds)
  }
  const titleOf = (track: { videoId: string; title: string }): string =>
    tidyTitle(track.title === '' ? `YouTube · ${track.videoId}` : track.title)

  const base = {
    theme,
    kind: content.kind,
    width: SHARE_CARD_WIDTH,
    totalTracks: content.tracks.length,
    momentCount: content.moments.length,
    date,
    time,
    catalog,
  }

  if (content.kind !== 'playlist') {
    const track = content.tracks[0]
    const moment = content.kind === 'moment' ? (content.moments[0] ?? null) : null
    return {
      ...base,
      template: 'single',
      height: theme === 'kawaii' ? 1350 : 1080,
      heading: track === undefined ? '' : titleOf(track),
      sides: [],
      rows: [],
      moment: moment === null ? null : { at: formatAt(moment.atSeconds), note: moment.note },
    }
  }

  const heading = content.name.trim() === '' ? '공유한 목록' : content.name.trim()
  const atOf = (videoId: string): string | null => {
    const at = firstMoment.get(videoId)
    return at === undefined ? null : formatAt(at)
  }

  if (content.tracks.length <= SHARE_CARD_SIDE_LIMIT) {
    const half = Math.ceil(content.tracks.length / 2)
    const side = (from: number, to: number, label: string): ShareCardRow[] =>
      content.tracks.slice(from, to).map((track, index) => ({
        no: `${label}${String(index + 1)}`,
        title: titleOf(track),
        moment: atOf(track.videoId),
      }))
    const a = side(0, half, 'A')
    const b = side(half, content.tracks.length, 'B')
    return {
      ...base,
      template: theme === 'kawaii' ? 'jcard' : 'lp',
      height: theme === 'kawaii' ? 1350 : 1080,
      heading,
      sides: b.length === 0 ? [a] : [a, b],
      rows: [],
      moment: null,
    }
  }

  return {
    ...base,
    template: 'receipt',
    height: null,
    heading,
    sides: [],
    rows: content.tracks.map((track, index) => ({
      no: two(index + 1),
      title: titleOf(track),
      moment: atOf(track.videoId),
    })),
    moment: null,
  }
}

/* ------------------------------------------------------------------ *
 * 영수증 높이 — 그리기와 같은 상수를 쓴다
 * ------------------------------------------------------------------ */

export const RECEIPT = {
  outerTop: 56,
  outerBottom: 74,
  paperPadTop: 50,
  paperPadBottom: 64,
  headerFixed: 34 + 12 + 28 + 14 + 14 + 28, // 브랜드 · 줄 · 날짜 · 간격 · 간격 · 곡 수
  nameLine: 72,
  dash: 48,
  columns: 40,
  row: 56,
  more: 52,
  totals: 44,
  cta: 52,
  thanks: 70,
} as const

/** 영수증 이미지의 높이 — 보이는 곡 줄 수 · "+N곡 더" · Moment 유무 · 목록 이름 줄 수로. */
export function receiptHeight(options: {
  rows: number
  more: boolean
  moments: boolean
  nameLines: number
}): number {
  const paper =
    RECEIPT.paperPadTop +
    RECEIPT.headerFixed +
    RECEIPT.nameLine * options.nameLines +
    RECEIPT.dash +
    (options.moments ? RECEIPT.columns : 0) +
    RECEIPT.row * options.rows +
    (options.more ? RECEIPT.more : 0) +
    RECEIPT.dash +
    RECEIPT.totals * (options.moments ? 2 : 1) +
    RECEIPT.dash +
    RECEIPT.cta +
    RECEIPT.thanks +
    RECEIPT.paperPadBottom
  return RECEIPT.outerTop + paper + RECEIPT.outerBottom
}

/** 높이 상한 안에 들어가는 곡 줄 수. 다 들어가면 전부, 아니면 "+N곡 더" 한 줄을 남기고 줄인다. */
export function receiptRowsThatFit(total: number, moments: boolean, nameLines: number): number {
  if (receiptHeight({ rows: total, more: false, moments, nameLines }) <= SHARE_CARD_MAX_HEIGHT) {
    return total
  }
  let rows = total - 1
  while (
    rows > 0 &&
    receiptHeight({ rows, more: true, moments, nameLines }) > SHARE_CARD_MAX_HEIGHT
  ) {
    rows -= 1
  }
  return rows
}

/* ------------------------------------------------------------------ *
 * 그리는 쪽 — 주입
 * ------------------------------------------------------------------ */

export interface ShareCardImage {
  readonly blob: Blob
  readonly width: number
  readonly height: number
}

/** 모델을 PNG 로 그린다. 그릴 수 없으면(캔버스 없음) `null`. */
export type ShareCardRenderer = (model: ShareCardModel) => Promise<ShareCardImage | null>

/**
 * 카드를 그리는 함수 — `main.ts` 가 캔버스 구현을 넣는다(처음 쓸 때 내려받는다). 플레이어 어댑터 팩토리와 같은 방식이다:
 * 테스트는 가짜를 넣고, 넣지 않으면 "이 브라우저에서는 이미지를 만들 수 없어요" 다.
 */
export const SHARE_CARD_RENDERER: InjectionKey<ShareCardRenderer> = Symbol(
  '39page.shareCardRenderer',
)

/* ------------------------------------------------------------------ *
 * 파일 이름
 * ------------------------------------------------------------------ */

/** `여름 밤.39page.png` — 파일 이름에 쓸 수 없는 글자를 걷어낸다 (공유 파일과 같은 규칙). */
export function shareCardFileName(name: string): string {
  const safe = [...name.replace(/[\\/:*?"<>|]/g, '_')]
    .map((char) => (char.charCodeAt(0) < 0x20 ? '_' : char))
    .join('')
    .trim()
    .slice(0, 60)
  return `${safe === '' ? '39page' : safe}.39page.png`
}
