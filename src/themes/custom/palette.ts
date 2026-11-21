/**
 * 커스텀 테마 색 점검 (ADR 0045) — 고른 색이 읽히는지 미리보기에서 알린다. 막지는 않는다.
 *
 * 기준은 WCAG 2.x: 본문 글자 4.5:1, 단추 · 테두리 같은 UI 요소 3:1.
 */
import type { CustomThemeColors } from '@/shared/types/customTheme'
import { contrastRatio } from '@/shared/utils/color'

export interface ColorWarning {
  readonly id: 'text-background' | 'text-surface' | 'accent-background' | 'accent-surface'
  readonly message: string
  readonly ratio: number
}

const fmt = (ratio: number) => `${ratio.toFixed(1)}:1`

export function customThemeWarnings(colors: CustomThemeColors): ColorWarning[] {
  const warnings: ColorWarning[] = []
  const check = (id: ColorWarning['id'], a: string, b: string, min: number, what: string): void => {
    const ratio = contrastRatio(a, b)
    if (ratio < min) {
      warnings.push({
        id,
        ratio,
        message: `${what} 대비가 ${fmt(ratio)} 이라 잘 안 보일 수 있어요.`,
      })
    }
  }
  check('text-background', colors.text, colors.background, 4.5, '글자와 배경')
  check('text-surface', colors.text, colors.surface, 4.5, '글자와 카드')
  check('accent-background', colors.accent, colors.background, 3, '강조와 배경')
  check('accent-surface', colors.accent, colors.surface, 3, '강조와 카드')
  return warnings
}
