/**
 * jsdom 레이아웃 보정 — M3-4 가시성 가드 테스트 지원.
 *
 * jsdom 은 레이아웃을 계산하지 않는다. 모든 `getBoundingClientRect()` 가
 * 0×0 이고 `matchMedia` 도 없다. 그대로 두면 가시성 가드가 **모든 재생을
 * 거절한다** — 제품의 결함이 아니라 테스트 환경의 한계다.
 *
 * 그래서 "플레이어가 이만큼 보인다" 를 명시적으로 세운다. 가려진 경우를
 * 보는 테스트는 `setPlayerRect(HIDDEN_RECT)` 로 바꿔 쓴다.
 *
 * jsdom 기본 뷰포트는 1024×768 이다. 아래 사각형은 그 안에 들어간다.
 */
export interface StubRect {
  readonly width: number
  readonly height: number
  readonly top: number
  readonly left: number
  readonly right: number
  readonly bottom: number
}

/** 드로어 닫힘 1440px 의 실측값(542×305)에 가깝게 둔다. 전부 뷰포트 안이다. */
export const VISIBLE_RECT: StubRect = {
  width: 542,
  height: 305,
  top: 120,
  left: 80,
  right: 622,
  bottom: 425,
}

/** `display: none` 상태. 사각형이 전부 0 이다. */
export const HIDDEN_RECT: StubRect = {
  width: 0,
  height: 0,
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
}

/** 공식 최소 크기(200×200) 미달. */
export const TOO_SMALL_RECT: StubRect = {
  width: 180,
  height: 101,
  top: 10,
  left: 10,
  right: 190,
  bottom: 111,
}

/** 절반만 보이는 상태 — 아래쪽이 뷰포트(768) 밖으로 나갔다. */
export const HALF_VISIBLE_RECT: StubRect = {
  width: 400,
  height: 400,
  top: 568,
  left: 100,
  right: 500,
  bottom: 968,
}

let active: StubRect = VISIBLE_RECT
let original: typeof Element.prototype.getBoundingClientRect | null = null

/**
 * 모든 요소가 같은 사각형을 돌려주게 한다.
 *
 * 측정 대상은 `.player-mount` 하나뿐이므로 요소를 가려 받을 필요가 없다.
 */
export function installPlayerRect(rect: StubRect = VISIBLE_RECT): void {
  active = rect

  if (original !== null) return
  original = Element.prototype.getBoundingClientRect

  Element.prototype.getBoundingClientRect = function stubbed(this: Element): DOMRect {
    const value = { ...active, x: active.left, y: active.top }
    return { ...value, toJSON: () => value } as DOMRect
  }
}

/** 설치된 사각형을 바꾼다. 테스트 중간에 가려지는 상황을 만든다. */
export function setPlayerRect(rect: StubRect): void {
  active = rect
}

export function uninstallPlayerRect(): void {
  if (original === null) return

  Element.prototype.getBoundingClientRect = original
  original = null
  active = VISIBLE_RECT
}

/* ---------- matchMedia ---------- */

interface StubMediaQueryList {
  matches: boolean
  media: string
  onchange: null
  addEventListener: () => void
  removeEventListener: () => void
  addListener: () => void
  removeListener: () => void
  dispatchEvent: () => boolean
}

let originalMatchMedia: typeof window.matchMedia | undefined
let matchMediaInstalled = false

/**
 * `window.matchMedia` 를 세운다. jsdom 에는 아예 없다.
 *
 * `matches` 를 그대로 돌려준다 — 질의를 해석하지 않는다. 좁은 화면 여부는
 * 테스트가 명시하는 것이 낫다. 실제 브레이크포인트 적용은 브라우저 검증에서
 * 확인한다.
 */
export function installMatchMedia(matches: boolean): void {
  if (!matchMediaInstalled) {
    originalMatchMedia = window.matchMedia
    matchMediaInstalled = true
  }

  window.matchMedia = ((query: string): StubMediaQueryList => ({
    matches,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia
}

export function uninstallMatchMedia(): void {
  if (!matchMediaInstalled) return

  if (originalMatchMedia === undefined) {
    // jsdom 은 원래 없다. 흔적을 남기지 않는다.
    delete (window as { matchMedia?: typeof window.matchMedia }).matchMedia
  } else {
    window.matchMedia = originalMatchMedia
  }

  matchMediaInstalled = false
  originalMatchMedia = undefined
}
