/**
 * 커스텀 테마 (ADR 0045) — 사용자가 고르는 색 다섯 가지.
 *
 * 나머지 테마 토큰(100개 남짓)은 이 다섯 가지에서 CSS `color-mix()` 로 만든다
 * (`src/themes/custom/tokens.css`). 데크 그림은 크기가 커서 여기에 두지 않는다 — IndexedDB `39page-theme`
 * (`features/custom-theme/deckImageRepository.ts`).
 */
import type { InjectionKey } from 'vue'

import { normalizeHexColor, readableOn } from '@/shared/utils/color'

/** 커스텀 테마 설정 창을 여는 입구 — 셸이 준다. 헤더의 설정 단추와 빈 데크의 "이미지 넣기" 가 쓴다. */
export const CUSTOM_THEME_DIALOG: InjectionKey<{ open(): void }> = Symbol('39page.custom-theme')

export interface CustomThemeColors {
  /** 페이지 · 작업 공간 바탕. */
  readonly background: string
  /** 카드 · 위젯 · 보관함 바탕. */
  readonly surface: string
  /** 글자. */
  readonly text: string
  /** 강조 — 재생 단추 · 선택 · 포커스. */
  readonly accent: string
  /** 선 · 테두리. */
  readonly line: string
}

export type CustomColorKey = keyof CustomThemeColors

/** 고르는 순서 · 화면 이름. */
export const CUSTOM_COLOR_FIELDS: readonly { key: CustomColorKey; label: string }[] = [
  { key: 'background', label: '배경' },
  { key: 'surface', label: '카드' },
  { key: 'text', label: '글자' },
  { key: 'accent', label: '강조' },
  { key: 'line', label: '선' },
]

/** 처음 고른 사람에게 보이는 색 — 어두운 바탕에 주황 강조. 두 승인 테마와 겹치지 않는다. */
export const DEFAULT_CUSTOM_COLORS: Readonly<CustomThemeColors> = Object.freeze({
  background: '#16161d',
  surface: '#23232e',
  text: '#ecebf4',
  accent: '#ffb347',
  line: '#4b4b5e',
})

/** 저장 형식 (`39page.customTheme` 의 `data`). 나중에 필드를 더할 수 있게 객체로 둔다. */
export interface CustomThemeSettings {
  readonly colors: CustomThemeColors
}

export function defaultCustomThemeSettings(): CustomThemeSettings {
  return { colors: { ...DEFAULT_CUSTOM_COLORS } }
}

/** 저장소 · 백업에서 읽은 값을 검증한다. 다섯 색이 모두 `#rrggbb` 여야 한다. 모르는 필드는 버린다. */
export function readCustomThemeSettings(value: unknown): CustomThemeSettings | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const colors = (value as Record<string, unknown>).colors
  if (typeof colors !== 'object' || colors === null || Array.isArray(colors)) return null
  const raw = colors as Record<string, unknown>
  const read: Partial<Record<CustomColorKey, string>> = {}
  for (const { key } of CUSTOM_COLOR_FIELDS) {
    const hex = normalizeHexColor(raw[key])
    if (hex === null) return null
    read[key] = hex
  }
  return { colors: read as CustomThemeColors }
}

/**
 * 문서 루트에 거는 CSS 변수. 다섯 색과, 강조색 위의 글자색(계산). 테마 전환과 무관하게 늘 걸어 둔다 —
 * `custom` 토큰만 이 변수를 읽으므로 다른 테마에는 영향이 없고, 전환은 `data-theme` 교체 하나로 남는다 (ADR 0001).
 */
export function customThemeVariables(colors: CustomThemeColors): Record<string, string> {
  return {
    '--custom-background': colors.background,
    '--custom-surface': colors.surface,
    '--custom-text': colors.text,
    '--custom-accent': colors.accent,
    '--custom-line': colors.line,
    '--custom-on-accent': readableOn(colors.accent),
  }
}
