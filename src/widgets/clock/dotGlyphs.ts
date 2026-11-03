/**
 * 도트 매트릭스 시계의 글리프와 배치 계산.
 *
 * 숫자만 도트로 그린다. 라벨·날짜는 모노스페이스 텍스트다
 * (`MVP_SPEC.md` F6, 원본 주석: *"only numbers are dot-based"*).
 *
 * 글리프 비트맵과 기하 상수는 승인된 디자인
 * `design/references/two-themes-v09.html` 의 `glyphs` · `drawClock()` 값을
 * 그대로 옮겼다. 바꾸지 않는다 (`AGENTS.md` 규칙 6).
 *
 * 배치를 **순수 함수**로 둔 이유: 레이아웃 없는 환경에서도 좌표를 전수
 * 검증할 수 있다. 컴포넌트는 이 결과를 그리기만 한다.
 */

/** 숫자는 5×7, `:` 는 1×7 비트맵이다. `'1'` 이 켜진 도트다. */
export type DotGlyph = readonly string[]

export const DOT_GLYPHS: Readonly<Record<string, DotGlyph>> = {
  '0': ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
  '1': ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  '2': ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
  '3': ['11110', '00001', '00001', '01110', '00001', '00001', '11110'],
  '4': ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
  '5': ['11111', '10000', '10000', '11110', '00001', '00001', '11110'],
  '6': ['01111', '10000', '10000', '11110', '10001', '10001', '01110'],
  '7': ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  '8': ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
  '9': ['01110', '10001', '10001', '01111', '00001', '00001', '11110'],
  ':': ['0', '0', '1', '0', '1', '0', '0'],
}

/** 도트 반지름. */
export const DOT_RADIUS = 3.1
/** 도트 간격 (가로·세로 같다). */
export const DOT_SPACING = 9.3
/** 글자 사이 추가 간격. */
export const GLYPH_GAP = 13
/** 첫 글자의 왼쪽 여백. */
export const START_X = 5
/** 첫 행의 중심 y. */
export const START_Y = 6
/** 글리프 행 수. */
export const GLYPH_ROWS = 7
/** viewBox 높이. */
export const VIEWBOX_HEIGHT = 68

/** `:` 만 1열이고 나머지는 5열이다. 알 수 없는 글자도 5열 자리를 차지한다. */
function glyphColumns(character: string): number {
  return character === ':' ? 1 : 5
}

export interface DotCircle {
  /** SVG 속성으로 바로 쓰는 값. 레퍼런스와 같이 소수 2자리로 고정한다. */
  cx: string
  cy: string
  /** 켜진 도트인지. 꺼진 도트도 함께 그린다 — 전광판 질감이다. */
  on: boolean
}

export interface DotTextLayout {
  circles: readonly DotCircle[]
  /** viewBox 너비. */
  width: number
}

/**
 * 글자열을 도트 좌표로 펼친다.
 *
 * 알 수 없는 글자는 **도트를 그리지 않고 자리만 차지한다.** 레퍼런스의
 * `if (glyph)` 와 같은 동작이다 — 추측해서 그리면 엉뚱한 숫자가 보인다.
 */
export function layoutDotText(text: string): DotTextLayout {
  const circles: DotCircle[] = []
  let x = START_X

  for (const character of text) {
    const glyph = DOT_GLYPHS[character]
    const columns = glyphColumns(character)

    if (glyph !== undefined) {
      for (let row = 0; row < GLYPH_ROWS; row += 1) {
        const bits = glyph[row] ?? ''
        for (let column = 0; column < columns; column += 1) {
          circles.push({
            cx: (x + column * DOT_SPACING).toFixed(2),
            cy: (START_Y + row * DOT_SPACING).toFixed(2),
            on: bits[column] === '1',
          })
        }
      }
    }

    x += columns * DOT_SPACING + GLYPH_GAP
  }

  // 마지막 글자 뒤의 간격에서 2 를 덜어낸다 (레퍼런스의 `x - 2`).
  return { circles, width: x - 2 }
}
