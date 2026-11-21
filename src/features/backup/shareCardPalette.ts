/**
 * 공유 카드 색 (ADR 0045) — 커스텀 테마의 카드는 Kawaii 카드 틀(J카드 · 싱글 · 영수증)에 사용자 색을 입힌다.
 *
 * 순수 함수다. 카드 그리기(`shareCardCanvas.ts`)와 시험이 같은 계산을 쓴다. 종이 위 글자는 대비 4.5:1 을 넘지 못하면
 * 더 어두운 잉크로 바꾼다 — 사용자가 어떤 색을 골라도 카드 글자는 읽힌다.
 */
import type { CustomThemeColors } from '@/shared/types/customTheme'
import { contrastRatio, mixHex } from '@/shared/utils/color'

/** Kawaii 카드 틀이 쓰는 색 이름 — 이름은 원래 Kawaii 색에서 왔지만 뜻은 자리다. */
export interface KawaiiCardPalette {
  /** 카드 바탕. */
  readonly bg: string
  /** 바탕 위 밝은 글자. */
  readonly mint: string
  /** 강조 (바탕 위). */
  readonly pink: string
  /** 종이 위 글자. */
  readonly ink: string
  /** J카드 · 싱글 종이. */
  readonly paper: string
  /** 영수증 종이. */
  readonly receipt: string
  /** 종이 위 강조 글자. */
  readonly pinkDark: string
  readonly rowLine: string
  readonly dash: string
  /** 종이 위 작은 글자. */
  readonly meta: string
  /** 바탕 위 그림 상자. */
  readonly artBox: string
  readonly stamp: string
}

export const KAWAII_CARD_PALETTE: KawaiiCardPalette = Object.freeze({
  bg: '#10202c',
  mint: '#e2fff6',
  pink: '#ff9bc5',
  ink: '#2a1730',
  paper: '#fff4f9',
  receipt: '#dbfff4',
  pinkDark: '#b8326f',
  rowLine: '#f6cfe2',
  dash: '#e98ab6',
  meta: '#8a3a66',
  artBox: '#142c3a',
  stamp: '#d83f87',
})

/** `paper` 위에서 4.5:1 을 넘는 색 — 넘지 못하면 `fallback`. */
function onPaper(color: string, paper: string, fallback: string): string {
  return contrastRatio(color, paper) >= 4.5 ? color : fallback
}

/** 사용자 다섯 색 → 카드 색. */
export function customCardPalette(colors: CustomThemeColors): KawaiiCardPalette {
  const paper = mixHex(colors.accent, '#ffffff', 0.9)
  const receipt = mixHex(colors.line, '#ffffff', 0.85)
  const darkInk = mixHex(colors.background, '#000000', 0.3)
  const ink = onPaper(darkInk, paper, '#111111')
  return {
    bg: colors.background,
    mint: colors.text,
    pink: colors.accent,
    ink,
    paper,
    receipt,
    pinkDark: onPaper(mixHex(colors.accent, '#000000', 0.45), paper, ink),
    rowLine: mixHex(colors.accent, '#ffffff', 0.65),
    dash: mixHex(colors.accent, '#ffffff', 0.25),
    meta: onPaper(mixHex(colors.accent, '#000000', 0.5), paper, ink),
    artBox: colors.surface,
    stamp: mixHex(colors.accent, '#000000', 0.15),
  }
}
