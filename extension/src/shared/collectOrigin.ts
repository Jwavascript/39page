/**
 * 수집 화면을 여는 곳 (M10-3, Batch 2 지시 E).
 *
 * - 운영 빌드는 **`https://39page.com` 고정**이다.
 * - 개발 빌드만 명시적으로 허용한 localhost 주소를 쓸 수 있다.
 * - 그 밖의 origin 은 빌드가 멈추고, 실행 중에도 Background 가 다시 거절한다 —
 *   임의의 외부 사이트를 수집 목적지로 만들 수 없다.
 *
 * `vite.config.ts` 가 빌드 때 `resolveCollectOrigin` 으로 정해 `__COLLECT_ORIGIN__`
 * 으로 넣는다. 순수 모듈이다.
 */

export const PRODUCTION_COLLECT_ORIGIN = 'https://39page.com'

/** 개발 빌드에서만 허용하는 origin — Vite 개발 서버(5173)와 미리보기(4173). */
export const DEV_COLLECT_ORIGINS: readonly string[] = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:4173',
  'http://127.0.0.1:4173',
]

export function isAllowedCollectOrigin(origin: string): boolean {
  return origin === PRODUCTION_COLLECT_ORIGIN || DEV_COLLECT_ORIGINS.includes(origin)
}

/**
 * 빌드 모드와 환경 변수(`VITE_COLLECT_ORIGIN`)로 origin 을 정한다. 틀리면 던진다.
 *
 * - `production` (그리고 `test`): 항상 운영 origin. 변수를 주면 실수이므로 던진다.
 * - `development`: 변수가 없으면 `http://localhost:5173`, 있으면 허용 목록 안이어야 한다.
 */
export function resolveCollectOrigin(mode: string, override: string | undefined): string {
  const value = override?.trim() ?? ''
  if (mode !== 'development') {
    if (value !== '') {
      throw new Error(`운영 빌드에서는 수집 origin 을 바꿀 수 없다 (VITE_COLLECT_ORIGIN=${value})`)
    }
    return PRODUCTION_COLLECT_ORIGIN
  }
  if (value === '') return 'http://localhost:5173'
  if (!DEV_COLLECT_ORIGINS.includes(value)) {
    throw new Error(
      `허용하지 않은 개발용 수집 origin — ${value} (허용: ${DEV_COLLECT_ORIGINS.join(', ')})`,
    )
  }
  return value
}
