/**
 * 마스코트 도트 패턴 데이터.
 *
 * 렌더링과 분리해 둔다. M4에서 테마별 캐릭터나 애니메이션 프레임을
 * 추가할 때 이 파일만 늘리면 된다 (`DotMatrix.vue`는 그대로).
 *
 * 패턴은 `design/references/two-themes-v09.html`의 도트 배열을 그대로
 * 이식했다. 오리지널 도형이며 외부 캐릭터 IP·이미지·이모지를 쓰지 않는다
 * (원본 주석: `No character IP.`).
 */
import type { ThemeKey } from '@/shared/types'

/**
 * 행 문자열의 배열. `'1'`이 켜진 도트, `'0'`이 꺼진 도트다.
 *
 * 문자열로 두는 이유: 소스에서 패턴 모양이 눈으로 보인다.
 */
export type DotPattern = readonly string[]

/**
 * COMPANION / 01 — 16×12.
 *
 * ```
 * ................
 * ..##........##..
 * ..###......###..
 * ..#.#######.##..
 * ..############..
 * ..############..
 * ..##..####..##..
 * ..###.####.###..
 * ..############..
 * ...####..####...
 * .....######.....
 * ................
 * ```
 */
export const COMPANION_01: DotPattern = [
  '0000000000000000',
  '0011000000001100',
  '0011100000011100',
  '0010111111101100',
  '0011111111111100',
  '0011111111111100',
  '0011001111001100',
  '0011101111011100',
  '0011111111111100',
  '0001111001111000',
  '0000011111100000',
  '0000000000000000',
]

/**
 * 테마별 패턴.
 *
 * **MVP에서는 두 테마가 같은 패턴을 공유한다.** v09도 그렇게 하며, 색과
 * 디스플레이 스타일만 테마 토큰으로 달라진다. 테마별 캐릭터를 따로 정의할
 * 여지를 남기기 위해 맵으로 둔다 (`THEME_SYSTEM.md` §6).
 */
export const MASCOT_PATTERNS: Record<ThemeKey, DotPattern> = {
  'mono-vinyl': COMPANION_01,
  'kawaii-synth-cassette': COMPANION_01,
}

export interface DotPatternSize {
  columns: number
  rows: number
}

/** 패턴의 크기. 모든 행의 길이가 같다고 가정하지 않고 최대값을 쓴다. */
export function patternSize(pattern: DotPattern): DotPatternSize {
  return {
    columns: pattern.reduce((max, row) => Math.max(max, row.length), 0),
    rows: pattern.length,
  }
}
