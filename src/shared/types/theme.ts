/**
 * 테마 식별자.
 *
 * 값은 승인된 디자인 레퍼런스 `design/references/two-themes-v09.html`를 따른다.
 * 소스 디렉터리 `src/themes/<key>/`와 1:1로 대응한다.
 */
export type ThemeKey = 'mono-vinyl' | 'kawaii-synth-cassette' | 'custom'

/**
 * 런타임 검증과 UI 순회를 위한 테마 키 목록. **표시 순서**를 따른다.
 *
 * M11-7B 에서 순서를 바꿨다 — Theme 1 이 Kawaii Synth Cassette, Theme 2 가 Mono Vinyl 이다.
 * **키(id)는 바꾸지 않았다.** 저장된 테마 · 백업 파일의 값이 그대로 읽힌다.
 *
 * ADR 0045 — Theme 3 `custom`. 데크 그림과 색을 사용자가 정한다. 승인된 레퍼런스에서 온 테마가 아니다 —
 * 값(색 · 그림)은 `src/shared/types/customTheme.ts` 와 `stores/customTheme.ts` 가 가진다.
 */
export const THEME_KEYS = [
  'kawaii-synth-cassette',
  'mono-vinyl',
  'custom',
] as const satisfies readonly ThemeKey[]

/**
 * 기본 테마 — 저장된 테마가 **없는** 새 사용자, 그리고 저장된 값이 알려진 키가 아닐 때 쓰는 값이다.
 *
 * M11-7B 에서 Mono Vinyl 에서 Kawaii Synth Cassette 로 바꿨다. 저장된 값이 있는 사용자는 이 값과
 * 무관하게 자기 테마를 유지한다 (저장 형식 · 키 그대로, 마이그레이션 없음).
 */
export const DEFAULT_THEME_KEY: ThemeKey = 'kawaii-synth-cassette'

/** 저장소나 외부 입력에서 읽은 알 수 없는 값이 테마 키인지 확인한다. */
export function isThemeKey(value: unknown): value is ThemeKey {
  return typeof value === 'string' && (THEME_KEYS as readonly string[]).includes(value)
}
