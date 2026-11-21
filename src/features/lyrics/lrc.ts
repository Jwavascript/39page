/**
 * LRC 가사 읽기 (ADR 0046) — `[mm:ss.xx] 가사` 줄을 시간 순 줄 목록으로.
 *
 * 순수 함수다. 한 줄에 시각이 여럿(`[00:12.00][00:45.10] 후렴`)이면 각각 한 줄이 된다. `[offset:+200]` 은 밀리초 단위로
 * 모든 시각을 앞당긴다(LRC 관례 — 양수면 가사가 빨리 나온다). `[ar:…]` 같은 머리 태그 · 시각 없는 줄은 버린다.
 */

export interface LyricLine {
  /** 초. */
  readonly time: number
  readonly text: string
}

const STAMP = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g
const OFFSET = /^\[offset:\s*([+-]?\d+)\s*\]$/i

export function parseSyncedLyrics(lrc: string): LyricLine[] {
  let offsetSeconds = 0
  const lines: { time: number; text: string; order: number }[] = []
  let order = 0
  for (const raw of lrc.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trim()
    const offset = OFFSET.exec(line)
    if (offset !== null) {
      offsetSeconds = Number(offset[1]) / 1000
      continue
    }
    const times: number[] = []
    let rest = line
    STAMP.lastIndex = 0
    let match: RegExpExecArray | null
    let end = 0
    while ((match = STAMP.exec(line)) !== null && match.index === end) {
      const minutes = Number(match[1])
      const seconds = Number(match[2])
      const fraction = match[3] === undefined ? 0 : Number(`0.${match[3]}`)
      times.push(minutes * 60 + seconds + fraction)
      end = STAMP.lastIndex
    }
    if (times.length === 0) continue
    rest = line.slice(end).trim()
    for (const time of times) lines.push({ time, text: rest, order: order++ })
  }
  return lines
    .map((line) => ({ ...line, time: Math.max(0, line.time - offsetSeconds) }))
    .sort((a, b) => a.time - b.time || a.order - b.order)
    .map(({ time, text }) => ({ time, text }))
}

/** 싱크 없는 가사 — 줄로 나누고 앞뒤 빈 줄을 버린다 (가운데 빈 줄은 연 구분이라 남긴다). */
export function plainLyricLines(text: string): string[] {
  const lines = text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.trim())
  while (lines.length > 0 && lines[0] === '') lines.shift()
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
  return lines
}

/** 지금 부를 줄 — 시각이 `seconds` 이하인 마지막 줄. 첫 줄 전이면 -1. */
export function activeLineIndex(lines: readonly LyricLine[], seconds: number): number {
  let low = 0
  let high = lines.length - 1
  let found = -1
  while (low <= high) {
    const mid = (low + high) >> 1
    if ((lines[mid]?.time ?? Number.POSITIVE_INFINITY) <= seconds) {
      found = mid
      low = mid + 1
    } else {
      high = mid - 1
    }
  }
  return found
}
