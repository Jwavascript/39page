/**
 * 직접 고른 가사 (ADR 0046) — 영상마다 "이 LRCLIB 가사" 를 기억한다. 자동으로 못 찾은 곡(일본어 · 한국어 제목 등)을
 * 사용자가 한 번 검색해 고르면 다음부터 그 가사를 바로 받는다.
 *
 * `localStorage` `39page.lyrics` — `{ version: 1, data: { picks: { [videoId]: { id, label } } } }`. 가사 글자는 저장하지
 * 않는다(LRCLIB 에서 다시 받는다). 오래된 것부터 지워 500곡까지만 둔다. 백업에는 아직 넣지 않는다(TODO, ADR 0046).
 */
import { STORAGE_KEYS, defineStorage } from '@/shared/storage'
import { isYouTubeVideoId } from '@/shared/utils/youtube'

export const LYRICS_STORAGE_VERSION = 1
export const MAX_LYRICS_PICKS = 500

export interface LyricsPick {
  /** LRCLIB 레코드 id. */
  readonly id: number
  /** 고를 때 본 "곡 · 가수" — 화면 표시용. */
  readonly label: string
}

export interface LyricsChoices {
  readonly picks: Readonly<Record<string, LyricsPick>>
}

export function readLyricsChoices(value: unknown): LyricsChoices | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const picks = (value as Record<string, unknown>).picks
  if (typeof picks !== 'object' || picks === null || Array.isArray(picks)) return null
  const read: Record<string, LyricsPick> = {}
  for (const [videoId, raw] of Object.entries(picks)) {
    if (!isYouTubeVideoId(videoId) || typeof raw !== 'object' || raw === null) continue
    const { id, label } = raw as Record<string, unknown>
    if (typeof id !== 'number' || !Number.isInteger(id) || id <= 0) continue
    read[videoId] = { id, label: typeof label === 'string' ? label.slice(0, 200) : '' }
  }
  return { picks: read }
}

export const lyricsChoicesStorage = defineStorage<LyricsChoices>({
  key: STORAGE_KEYS.lyrics,
  version: LYRICS_STORAGE_VERSION,
  fallback: () => ({ picks: {} }),
  validate: readLyricsChoices,
})

/** 고른 것을 더한다(같은 영상이면 바꾼다). 넘치면 앞(오래된 것)부터 지운다. */
export function withPick(choices: LyricsChoices, videoId: string, pick: LyricsPick): LyricsChoices {
  const { [videoId]: _old, ...rest } = choices.picks
  const entries = [...Object.entries(rest), [videoId, pick] as const]
  return { picks: Object.fromEntries(entries.slice(-MAX_LYRICS_PICKS)) }
}

export function withoutPick(choices: LyricsChoices, videoId: string): LyricsChoices {
  const { [videoId]: _old, ...rest } = choices.picks
  return { picks: rest }
}
