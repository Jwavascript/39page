/**
 * jsdom 의 Web Storage 를 쓴다 — Node 25+ 환경 보정 (M11-6).
 *
 * Node 25 부터 전역에 자체 `localStorage` · `sessionStorage` 가 있다(`--localstorage-file` 없이는 쓰기가
 * 막히거나 경고를 낸다). Vitest 의 jsdom 환경은 이미 있는 전역 키를 덮지 않아 **jsdom 의 저장소가 가려지고**,
 * 저장소를 쓰는 시험 대부분이 실패한다 (Node 26.13 에서 재현: 54 파일 중 45 · 1,927 중 1,502 실패).
 * 지금까지는 `NODE_OPTIONS=--no-webstorage` 로 돌렸다.
 *
 * 여기서 jsdom 창의 저장소를 전역에 다시 건다. Node 22 · 24(전역 저장소 없음)에서는 이미 같은 객체라
 * 아무것도 바꾸지 않는다. 시험 코드 · 앱 코드는 바꾸지 않는다.
 */
// Vitest 의 jsdom 환경은 JSDOM 인스턴스를 `globalThis.jsdom` 에 둔다. `window` 는 전역 자신이라 쓸 수 없다.
const jsdomWindow = (globalThis as { jsdom?: { window: Window } }).jsdom?.window

if (jsdomWindow !== undefined) {
  for (const key of ['localStorage', 'sessionStorage'] as const) {
    let storage: Storage | undefined
    try {
      storage = jsdomWindow[key]
    } catch {
      storage = undefined
    }
    if (storage !== undefined && (globalThis as Record<string, unknown>)[key] !== storage) {
      Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: storage })
    }
  }
}
