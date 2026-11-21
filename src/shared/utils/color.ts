/**
 * 색 계산 — `#rrggbb` 만 다룬다 (ADR 0045 커스텀 테마).
 *
 * 순수 함수다. 화면 · 공유 카드 · 시험이 같은 계산을 쓴다. 대비는 WCAG 2.x 의 상대 휘도 정의를 따른다.
 */

export interface Rgb {
  readonly r: number
  readonly g: number
  readonly b: number
}

const HEX = /^#[0-9a-f]{6}$/

/** `#rrggbb`(소문자) 인지. 저장 · 백업 · 입력 검증이 같은 규칙을 쓴다. */
export function isHexColor(value: unknown): value is string {
  return typeof value === 'string' && HEX.test(value)
}

/** `#RRGGBB` · `#rrggbb` 를 소문자로. 그 밖은 `null`. `<input type="color">` 는 소문자를 준다. */
export function normalizeHexColor(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const lower = value.trim().toLowerCase()
  return HEX.test(lower) ? lower : null
}

export function hexToRgb(hex: string): Rgb {
  const value = Number.parseInt(hex.slice(1), 16)
  return { r: (value >> 16) & 255, g: (value >> 8) & 255, b: value & 255 }
}

export function rgbToHex({ r, g, b }: Rgb): string {
  const part = (n: number) =>
    Math.round(Math.min(255, Math.max(0, n)))
      .toString(16)
      .padStart(2, '0')
  return `#${part(r)}${part(g)}${part(b)}`
}

/** `a` 와 `b` 를 섞는다. `amount` 는 `b` 의 비율(0 … 1). CSS `color-mix(in srgb, a, b amount)` 와 같다. */
export function mixHex(a: string, b: string, amount: number): string {
  const x = hexToRgb(a)
  const y = hexToRgb(b)
  const t = Math.min(1, Math.max(0, amount))
  return rgbToHex({ r: x.r + (y.r - x.r) * t, g: x.g + (y.g - x.g) * t, b: x.b + (y.b - x.b) * t })
}

/** 상대 휘도 (WCAG 2.x). */
export function relativeLuminance(hex: string): number {
  const channel = (value: number) => {
    const c = value / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  const { r, g, b } = hexToRgb(hex)
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

/** 대비 비 (1 … 21). */
export function contrastRatio(a: string, b: string): number {
  const x = relativeLuminance(a)
  const y = relativeLuminance(b)
  const [light, dark] = x > y ? [x, y] : [y, x]
  return (light + 0.05) / (dark + 0.05)
}

/** 이 바탕 위에서 더 잘 읽히는 글자색 — 거의 검정 또는 흰색. */
export function readableOn(background: string): string {
  return contrastRatio(background, '#111111') >= contrastRatio(background, '#ffffff')
    ? '#111111'
    : '#ffffff'
}
