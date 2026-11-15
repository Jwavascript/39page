/**
 * Moments 보관함의 **순수** 검색 · 보기 계층 (M11-4, `M11_UX_DESIGN.md` §5-2 · §5-3).
 *
 * store 도 DOM 도 모른다. `groupMoments` 가 만든 묶음을 받아 검색 · 거르기 · 접기 · 점진 표시가
 * 그릴 모양을 돌려준다. 그래서 1 · 10 · 5,000 개 모두를 고정값으로 시험할 수 있다.
 *
 * 정한 것
 * - **검색은 제목과 메모.** 제목은 라이브러리의 현재 제목과 그 영상 Moment 들의 저장 당시
 *   스냅샷 제목 모두다 — 목록에서 이름을 바꿔도 옛 이름으로 찾을 수 있다.
 * - **정규화**: 유니코드 NFC + 소문자. macOS 에서 붙여 넣은 한글(NFD)도 같은 글자로 찾는다.
 * - **띄어쓰기로 나눈 낱말은 모두 들어 있어야** 맞는다 (AND). 제목의 낱말과 메모의 낱말을
 *   섞어도 된다 — "드라이브 후렴" 은 제목이 드라이브이고 메모에 후렴이 있는 순간을 찾는다.
 * - 데이터 처리는 병목이 아니다 (M9-6: 5,000개 묶기 7ms). 정규화한 글은 데이터가 바뀔 때 한 번만
 *   만들고, 검색은 그 글에서 부분 문자열을 찾는다.
 */
import type { Moment } from '@/shared/types'

import type { MomentGroup } from './momentsView'

/** 검색 · 비교용 정규화. 화면에 그리는 글은 바꾸지 않는다. */
export function normalizeForSearch(text: string): string {
  return text.normalize('NFC').toLowerCase()
}

/** 검색어 → 낱말들 (정규화, 빈 낱말 없음, 같은 낱말 한 번). 빈 검색어는 빈 배열. */
export function searchTerms(query: string): string[] {
  const terms = normalizeForSearch(query)
    .split(/\s+/u)
    .filter((term) => term !== '')
  return [...new Set(terms)]
}

/** 묶음 하나의 검색 색인. */
interface GroupIndex {
  /** 현재 제목 + 스냅샷 제목들, 정규화. */
  titleKey: string
  /** Moment id → 정규화한 메모. */
  notes: Map<string, string>
}

export type MomentsSearchIndex = ReadonlyMap<string, GroupIndex>

/** 묶음들로 검색 색인을 만든다 — 데이터가 바뀔 때 한 번. */
export function buildSearchIndex(groups: readonly MomentGroup[]): MomentsSearchIndex {
  const index = new Map<string, GroupIndex>()
  for (const group of groups) {
    const titles = new Set<string>([group.title])
    const notes = new Map<string, string>()
    for (const moment of group.moments) {
      if (moment.title.trim() !== '') titles.add(moment.title)
      notes.set(moment.id, normalizeForSearch(moment.note))
    }
    index.set(group.videoId, { titleKey: normalizeForSearch([...titles].join('\n')), notes })
  }
  return index
}

/**
 * 검색 결과 — 맞는 Moment 의 id 들. 검색어가 없으면 `null` (거르지 않는다).
 *
 * 낱말마다 "제목 또는 메모" 에 있어야 한다. 제목에 있는 낱말은 그 묶음의 모든 Moment 에 맞는다.
 */
export function searchMoments(
  index: MomentsSearchIndex,
  terms: readonly string[],
): Set<string> | null {
  if (terms.length === 0) return null
  const matched = new Set<string>()
  for (const entry of index.values()) {
    const missingFromTitle = terms.filter((term) => !entry.titleKey.includes(term))
    for (const [id, note] of entry.notes) {
      if (missingFromTitle.every((term) => note.includes(term))) matched.add(id)
    }
  }
  return matched
}

/** 강조 표시용 조각. `match` 인 조각을 `<mark>` 로 그린다. */
export interface TextSegment {
  text: string
  match: boolean
}

/**
 * 글에서 검색 낱말이 나온 자리를 조각으로 나눈다.
 *
 * 정규화한 글과 원문의 길이가 다르면(드문 대소문자 변환 · 분해된 한글) 자리를 맞출 수 없다 —
 * 그때는 강조하지 않고 원문 그대로 돌려준다. 찾기는 그래도 된다 (`searchMoments`).
 */
export function highlight(text: string, terms: readonly string[]): TextSegment[] {
  if (terms.length === 0 || text === '') return [{ text, match: false }]
  const display = text.normalize('NFC')
  const folded = display.toLowerCase()
  if (folded.length !== display.length) return [{ text, match: false }]

  const marks = Array.from({ length: display.length }, () => false)
  for (const term of terms) {
    let from = folded.indexOf(term)
    while (from !== -1) {
      for (let i = from; i < from + term.length; i += 1) marks[i] = true
      from = folded.indexOf(term, from + term.length)
    }
  }

  const segments: TextSegment[] = []
  let start = 0
  for (let i = 1; i <= display.length; i += 1) {
    if (i === display.length || marks[i] !== marks[start]) {
      segments.push({ text: display.slice(start, i), match: marks[start] === true })
      start = i
    }
  }
  return segments
}

/**
 * 한 줄에 보일 메모.
 *
 * 보통은 첫 줄이다 (F14). 검색 중인데 첫 줄에 낱말이 없고 다른 줄에 있으면 **그 줄**을
 * "…" 와 함께 보인다 — 왜 이 순간이 결과에 있는지 줄에서 보이게.
 */
export function noteLine(note: string, terms: readonly string[]): string {
  const lines = note.split(/\r?\n/u).map((line) => line.trim())
  const first = lines[0] ?? ''
  if (terms.length === 0) return first
  const has = (line: string): boolean => {
    const folded = normalizeForSearch(line)
    return terms.some((term) => folded.includes(term))
  }
  if (has(first)) return first
  const hit = lines.slice(1).find(has)
  return hit === undefined ? first : `… ${hit}`
}

/* ------------------------------------------------------------------ *
 * 보기 — 전체(묶음) · 최근(평면) · 이 곡 · 한 곡
 * ------------------------------------------------------------------ */

/** 보관함 Moments 탭의 보기. 저장하지 않는 화면 상태다. */
export type MomentsArchiveView = 'all' | 'recent' | 'current' | 'video'

/** 점진 표시 · 상한 (`M11_UX_DESIGN.md` §5-3). */
export const GROUP_PAGE_SIZE = 30
/** 최근(평면) 보기는 줄 단위로 더 그린다. */
export const RECENT_PAGE_SIZE = 50
/** 펼친 묶음 하나가 한 번에 그리는 줄. 한 곡에 수백 개가 있어도 그 묶음이 화면을 다 먹지 않게. */
export const GROUP_ROW_PAGE_SIZE = 50
/** 검색 결과가 이보다 많으면 앞의 이만큼만 그리고 검색어를 좁혀 달라고 한다. */
export const SEARCH_ROW_LIMIT = 200
/** 전체 보기에서 묶음이 이보다 많으면 최근 몇 묶음만 펼친다. */
export const EXPAND_ALL_UP_TO = 6
export const EXPAND_RECENT_GROUPS = 3

/**
 * 묶음의 기본 펼침.
 *
 * - 이 곡 · 한 곡 · 검색 결과: 펼친다 (찾으려고 좁힌 것이다)
 * - 전체: 묶음이 6개 이하면 모두, 넘으면 **최근 3묶음과 지금 곡**만
 *
 * 사용자가 머리를 눌러 바꾼 것은 이 기본값보다 앞선다 (`useMomentsArchive`).
 */
export function defaultExpanded(input: {
  view: MomentsArchiveView
  searching: boolean
  groupCount: number
  position: number
  isCurrent: boolean
}): boolean {
  if (input.view !== 'all' || input.searching) return true
  if (input.groupCount <= EXPAND_ALL_UP_TO) return true
  return input.position < EXPAND_RECENT_GROUPS || input.isCurrent
}

/** 해석하지 못하는 날짜는 가장 오래된 것으로 본다 (`momentsView.ts` 와 같은 규칙). */
function createdKey(createdAt: string): number {
  const parsed = Date.parse(createdAt)
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY
}

/**
 * 최근 보기 — 묶지 않고 **저장 시각 역순**. 같은 시각이면 나중에 추가된 것이 앞이다.
 *
 * 저장 배열(추가 순서)의 위치를 순위로 쓴다. 저장 배열은 바꾸지 않는다.
 */
export function recentMoments(moments: ReadonlyArray<Readonly<Moment>>): Readonly<Moment>[] {
  return moments
    .map((moment, index) => ({ moment, index, created: createdKey(moment.createdAt) }))
    .sort((a, b) => {
      if (a.created !== b.created) return a.created > b.created ? -1 : 1
      return b.index - a.index
    })
    .map((entry) => entry.moment)
}

/* ------------------------------------------------------------------ *
 * 라이브러리 연결 — 영상이 든 목록
 * ------------------------------------------------------------------ */

export interface PlaylistRef {
  id: string
  name: string
}

interface PlaylistSource {
  readonly id: string
  readonly name: string
  readonly tracks: ReadonlyArray<{ readonly videoId: string }>
}

/**
 * 영상 ID → 그 영상이 든 목록들 (라이브러리 순서, 한 목록은 한 번).
 *
 * 같은 영상이 한 목록에 여러 번 있어도 한 번만 적는다 (§5-4). 라이브러리를 고치지 않는다.
 */
export function playlistsByVideo(
  playlists: ReadonlyArray<PlaylistSource>,
): Map<string, PlaylistRef[]> {
  const index = new Map<string, PlaylistRef[]>()
  for (const playlist of playlists) {
    const seen = new Set<string>()
    for (const track of playlist.tracks) {
      if (seen.has(track.videoId)) continue
      seen.add(track.videoId)
      const list = index.get(track.videoId)
      const ref = { id: playlist.id, name: playlist.name }
      if (list === undefined) index.set(track.videoId, [ref])
      else list.push(ref)
    }
  }
  return index
}
