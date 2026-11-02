/**
 * 테마 식별자.
 *
 * 값은 승인된 디자인 레퍼런스 `design/references/two-themes-v09.html`를 따른다.
 * 소스 디렉터리 `src/themes/<key>/`와 1:1로 대응한다.
 */
export type ThemeKey = 'mono-vinyl' | 'kawaii-synth-cassette'

/** 런타임 검증과 UI 순회를 위한 테마 키 목록. 표시 순서를 따른다. */
export const THEME_KEYS = [
  'mono-vinyl',
  'kawaii-synth-cassette',
] as const satisfies readonly ThemeKey[]

/** 기본 테마. 저장된 값이 알려진 키가 아닐 때 되돌아갈 값이다. */
export const DEFAULT_THEME_KEY: ThemeKey = 'mono-vinyl'

/** 저장소나 외부 입력에서 읽은 알 수 없는 값이 테마 키인지 확인한다. */
export function isThemeKey(value: unknown): value is ThemeKey {
  return typeof value === 'string' && (THEME_KEYS as readonly string[]).includes(value)
}
