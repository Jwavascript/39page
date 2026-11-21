/**
 * YouTube 제목 → LRCLIB 검색어 · 고르기 (ADR 0046).
 *
 * 실측(2026-11-22): LRCLIB 검색은 **라틴 글자 낱말만** 맞춘다. "アストロノーツ" · "밤편지" 로는 엉뚱한 곡이 나오고,
 * "Astronauts siinamota" · "Through the Night IU" 로는 맞는 곡이 나온다. 그래서
 *
 * 1. 제목에서 꼬리표(Official MV · 가사 · feat. 등)를 떼고 **라틴 낱말**로 먼저 찾는다.
 * 2. 라틴 낱말이 없으면 정리한 제목 그대로 한 번 찾아본다(앞으로 고쳐질 수 있다).
 * 3. 결과는 **곡 길이(±4초)** 와 **제목 낱말 · 한자/가나/한글 덩어리가 겹치는지**로 거른다 — 엉뚱한 결과를 고르지 않는다.
 *
 * 못 찾으면 화면에서 직접 검색해 고르게 한다(`useLyrics`). 순수 함수다.
 */
import type { LyricsRecord } from './lrclibClient'

/** 검색어에서 뺄 낱말 — 영상 꼬리표. */
const NOISE = new Set([
  'official',
  'mv',
  'm',
  'v',
  'music',
  'video',
  'audio',
  'lyric',
  'lyrics',
  'visualizer',
  'feat',
  'ft',
  'featuring',
  'with',
  'cover',
  'ver',
  'version',
  'hd',
  'hq',
  '4k',
  'live',
  'full',
  'the',
  'and',
  'a',
  'of',
  'by',
  'vs',
  'x',
])

/** 괄호 안이 꼬리표뿐이면 통째로 뗀다 — `( Official MV )` · `[가사]` · `【MV】`. */
const TAG_IN_BRACKETS =
  /[[(（【「『]\s*(?:official|m\/?v|music\s*video|audio|lyrics?|visualizer|가사|뮤직\s*비디오|공식|full|hd|4k)[^\])）】」』]*[\])）】」』]/gi

const CJK = /[぀-ヿ㐀-鿿가-힯豈-﫿]+/g

const normalize = (value: string): string => value.normalize('NFKC').toLowerCase()

/** 라틴 · 숫자 낱말 (2자 이상, 꼬리표 제외). */
export function latinWords(value: string): string[] {
  const words = normalize(value).match(/[a-z0-9][a-z0-9'’.&+-]*/g) ?? []
  return words
    .map((word) => word.replace(/[.'’&+-]+$/g, ''))
    .filter((word) => word.length >= 2 && !NOISE.has(word))
}

/** 한자 · 가나 · 한글 덩어리 (2자 이상). */
export function cjkRuns(value: string): string[] {
  return (normalize(value).match(CJK) ?? []).filter((run) => run.length >= 2)
}

/** 영상 제목에서 꼬리표를 뗀 것. */
export function cleanTitle(title: string): string {
  return title.normalize('NFKC').replace(TAG_IN_BRACKETS, ' ').replace(/\s+/g, ' ').trim()
}

/** 보낼 검색어 — 많아야 둘. 라틴 낱말이 먼저다. */
export function lyricsQueries(title: string): string[] {
  const clean = cleanTitle(title)
  const words = [...new Set(latinWords(clean))]
  const queries: string[] = []
  if (words.length > 0 && words.join('').length >= 3) queries.push(words.slice(0, 8).join(' '))
  if (cjkRuns(clean).length > 0 && clean !== '') queries.push(clean.slice(0, 120))
  return queries
}

export interface MatchTarget {
  readonly title: string
  /** 영상 길이(초). 모르면 `null` — 그때는 제목이 더 많이 겹쳐야 한다. */
  readonly duration: number | null
}

/** 쓸 가사가 있는가 — 싱크 · 일반 · 연주곡 표시 중 하나. */
export function hasLyrics(record: LyricsRecord): boolean {
  return record.syncedLyrics !== null || record.plainLyrics !== null || record.instrumental
}

/** 곡 이름에서 가수 쪽(" - " · " / " 로 나뉜 조각 중 가수 이름이 든 것)을 뗀 것. 다 떼지면 원래 이름. */
export function trackCore(record: LyricsRecord): string {
  const artist = normalize(record.artistName)
  const artistWords = new Set(latinWords(record.artistName))
  // "(feat. 하츠네 미쿠)" · "feat. X" 는 곡 이름이 아니라 함께 부른 사람이다.
  const name = record.trackName
    .replace(/[([（【]\s*(?:feat\.?|ft\.?|featuring|with|con|cv\.?)\s[^)\]）】]*[)\]）】]/gi, ' ')
    .replace(/\s(?:feat\.?|ft\.?|featuring)\s.*$/i, ' ')
  const parts = name.split(/\s+[-–—/|]\s+/).map((part) => part.trim())
  const kept = parts.filter((part) => {
    const text = normalize(part)
    if (artist !== '' && text.includes(artist)) return false
    return !latinWords(part).some((word) => artistWords.has(word) && word.length >= 4)
  })
  return (kept.length > 0 ? kept : parts).join(' ')
}

/** 이 결과가 이 영상의 곡으로 보이는 정도. 아니면 `null`. */
export function matchScore(record: LyricsRecord, target: MatchTarget): number | null {
  if (!hasLyrics(record)) return null
  let durationPenalty = 0
  if (target.duration !== null && record.duration > 0) {
    const diff = Math.abs(record.duration - target.duration)
    if (diff > 4) return null
    durationPenalty = diff * 5
  }

  const titleWords = new Set(latinWords(target.title))
  const artistWords = latinWords(record.artistName)
  const artistHits = artistWords.filter((word) => titleWords.has(word)).length

  // 곡 이름만 본다 — "가수 - 곡" 꼴이면 가수 쪽을 뗀다. 가수 이름이 겹치는 것을 곡이 맞는 것으로 보지 않는다
  // (실측: "椎名もた(siinamota) - 少女A" 가 "椎名もた -「普通に歳をとるコトすら」" 에 붙었다).
  const track = trackCore(record)
  const trackWords = latinWords(track)
  const trackHits = trackWords.filter((word) => titleWords.has(word)).length
  const titleText = normalize(target.title)
  const trackText = normalize(track)
  const cjkHit =
    cjkRuns(target.title).some((run) => trackText.includes(run)) ||
    cjkRuns(track).some((run) => titleText.includes(run))

  // 곡 이름이 제목에 나와야 한다 — 라틴 낱말의 절반 이상, 또는 한자/가나/한글 덩어리.
  const trackMatches = cjkHit || (trackWords.length > 0 && trackHits * 2 >= trackWords.length)
  if (!trackMatches) return null
  // 길이를 모르면 가수까지 겹쳐야 믿는다.
  if (target.duration === null && artistHits === 0 && !cjkHit) return null

  return (
    (record.syncedLyrics !== null ? 100 : 0) +
    trackHits * 10 +
    artistHits * 8 +
    (cjkHit ? 15 : 0) -
    durationPenalty
  )
}

/** 가장 그럴듯한 결과. 없으면 `null`. */
export function pickLyrics(
  records: readonly LyricsRecord[],
  target: MatchTarget,
): LyricsRecord | null {
  let best: LyricsRecord | null = null
  let bestScore = Number.NEGATIVE_INFINITY
  for (const record of records) {
    const score = matchScore(record, target)
    if (score !== null && score > bestScore) {
      best = record
      bestScore = score
    }
  }
  return best
}
