/**
 * 테마 레지스트리.
 *
 * 테마의 **메타데이터만** 제공한다. 키 목록·기본 테마·검증은
 * `src/shared/types/theme.ts`에 이미 있으므로 여기서 다시 정의하지 않는다.
 *
 * 테마 CSS는 `src/main.ts`에서 정적으로 import한다. 동적 CSS 로더나
 * 플러그인 시스템을 두지 않는다 — 두 테마의 토큰이 항상 함께 로드되어야
 * `data-theme` 교체만으로 즉시 전환되고, 플레이어 DOM이 유지된다
 * (`docs/decisions/0001-theme-switching-mechanism.md`).
 */
import { THEME_KEYS, type ThemeKey } from '@/shared/types'

/** 테마별 마스코트 문구. 승인된 디자인의 문구를 따른다. */
export interface MascotCopy {
  /** 전광판 옆의 상태 문구. */
  message: string
  /** 그 아래의 보조 문구. */
  sub: string
}

/** 테마별 데크 문구. 승인된 디자인의 문구를 따른다. */
export interface DeckCopy {
  /** 열기 버튼의 접근성 이름. */
  openLabel: string
  /** 버튼 위에 뜨는 툴팁. */
  openHint: string
  /** 데크 아래 안내 문구. `hintStrong` 만 강조한다. */
  hintMark: string
  hintStrong: string
  hintRest: string
}

export interface ThemeMetadata {
  key: ThemeKey
  /** 사람이 읽는 테마 이름. */
  name: string
  /** 테마 전환 버튼에 표시하는 레이블. 승인된 디자인의 문구를 따른다. */
  label: string
  /** 테마의 성격을 한 줄로 설명한다. */
  description: string
  /**
   * 마스코트 문구.
   *
   * 테마별로 다른 **외형 문구**이므로 메타데이터에 둔다. 재생 상태에 따른
   * 문구 전환은 M4 이며 이 값과 별개다.
   */
  mascot: MascotCopy
  /** 데크 문구. 데크를 눌러 Record Library 를 여는 흐름에 쓴다. */
  deck: DeckCopy
  /**
   * 푸터 왼쪽의 테마 설명 (M5).
   *
   * 승인된 디자인의 `footerThemeLabel` 값이다. 오른쪽 문구는 테마와
   * 무관하므로 컴포넌트가 들고 있다.
   */
  footerLabel: string
}

export const THEMES: Record<ThemeKey, ThemeMetadata> = {
  'mono-vinyl': {
    key: 'mono-vinyl',
    name: 'Mono Vinyl',
    label: '01 / MONO VINYL',
    description: '따뜻한 회갈색 금속 턴테이블. 검은 LP와 아이보리 도트.',
    mascot: { message: 'SIGNAL READY', sub: 'a little life inside your music' },
    footerLabel: 'MONO VINYL · ANALOG × DIGITAL',
    deck: {
      openLabel: 'LP를 눌러 Record Library 열기',
      openHint: 'OPEN LIBRARY ↗',
      hintMark: '◉',
      hintStrong: 'LP를 누르면',
      hintRest: '음악 보관함이 열립니다',
    },
  },
  'kawaii-synth-cassette': {
    key: 'kawaii-synth-cassette',
    name: 'Kawaii Synth Cassette',
    label: '02 / SYNTH CASSETTE',
    description: '민트 카세트 데크에 분홍 포인트. 90s 신스 레트로 디지털.',
    mascot: { message: 'MIXTAPE READY', sub: 'a tiny melody from tomorrow' },
    footerLabel: 'SYNTH CASSETTE · PIXEL × KAWAII',
    deck: {
      openLabel: '카세트를 눌러 믹스테이프 보관함 열기',
      openHint: '▶ OPEN MIXTAPES',
      hintMark: '✧',
      hintStrong: '카세트를 누르면',
      hintRest: '믹스테이프 보관함이 열립니다',
    },
  },
}

/** 표시 순서대로 나열한 테마 메타데이터. 전환 UI 순회에 쓴다. */
export const THEME_LIST: readonly ThemeMetadata[] = THEME_KEYS.map((key) => THEMES[key])

/** 테마 키에 해당하는 메타데이터를 돌려준다. */
export function getThemeMetadata(key: ThemeKey): ThemeMetadata {
  return THEMES[key]
}
