/**
 * 마스코트의 재생 상태 반응 (M4).
 *
 * 도메인 `PlayerState` → **기분**(mood) → 표정 패턴과 문구.
 *
 * 왜 한 겹 더 두는가: `PlayerState` 는 여섯 가지인데 표정은 그만큼 필요하지
 * 않다. `idle` · `loading` · `ended` 는 모두 "지금 울리지 않는다" 이고
 * 같은 표정을 쓴다. 중간 개념을 두면 상태가 늘어도 표정 테이블이 늘지 않는다.
 *
 * 마스코트는 **`playback` store 만 읽는다.** 플레이어나 어댑터를 모른다
 * (`AGENTS.md` 규칙 4).
 */
import type { PlayerState, ThemeKey } from '@/shared/types'

import {
  COMPANION_01_ALERT,
  COMPANION_01_RESTING,
  MASCOT_PATTERNS,
  type DotPattern,
} from './patterns'

export type MascotMood =
  /** 울리지 않는다 — `idle` · `loading` · `ended` */
  | 'idle'
  /** 울리고 있다 */
  | 'playing'
  /** 적재돼 있지만 멈췄다 */
  | 'paused'
  /** 재생에 실패했다 */
  | 'error'

/**
 * 재생 상태를 기분으로 옮긴다.
 *
 * `loading` 을 `playing` 으로 보지 않는다. 아직 소리가 나지 않는데 호흡
 * 애니메이션이 돌면 재생 중인 것처럼 보인다 (`AGENTS.md` 규칙 9의 정신).
 */
export function moodFromPlayerState(state: PlayerState): MascotMood {
  if (state === 'playing') return 'playing'
  if (state === 'paused') return 'paused'
  if (state === 'error') return 'error'

  return 'idle'
}

/**
 * 기분별 표정. 적히지 않은 기분은 테마의 기본 패턴을 쓴다.
 *
 * `playing` 에 따로 패턴을 두지 않는다. 승인된 디자인은 같은 패턴에
 * **호흡 애니메이션**을 얹는 방식이고, 그 방식을 그대로 쓴다.
 */
const MOOD_PATTERNS: Partial<Record<MascotMood, DotPattern>> = {
  paused: COMPANION_01_RESTING,
  error: COMPANION_01_ALERT,
}

export function mascotPattern(theme: ThemeKey, mood: MascotMood): DotPattern {
  return MOOD_PATTERNS[mood] ?? MASCOT_PATTERNS[theme]
}

/**
 * 기분별 문구.
 *
 * `idle` 은 적지 않는다 — 승인된 디자인의 문구(`SIGNAL READY` /
 * `MIXTAPE READY`)를 테마 메타데이터에서 그대로 쓴다. 여기 있는 것은
 * M4 에서 **더한** 문구다.
 */
const MOOD_MESSAGES: Record<ThemeKey, Partial<Record<MascotMood, string>>> = {
  'mono-vinyl': {
    playing: 'NOW SPINNING',
    paused: 'NEEDLE RESTING',
    error: 'SIGNAL LOST',
  },
  'kawaii-synth-cassette': {
    playing: 'TAPE ROLLING',
    paused: 'TAPE PAUSED',
    error: 'TAPE JAMMED',
  },
}

/** 기분에 맞는 문구. 없으면 테마의 기본 문구(`fallback`)를 쓴다. */
export function mascotMessage(theme: ThemeKey, mood: MascotMood, fallback: string): string {
  return MOOD_MESSAGES[theme][mood] ?? fallback
}
