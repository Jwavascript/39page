/**
 * 플레이어 가시성 측정 (M3-4).
 *
 * 둘로 나뉜 근거를 코드에서도 나눠둔다 (`SYSTEM_DESIGN.md` §8.1).
 *
 * - **200×200 은 공식 요구사항이다.** "Embedded players must have a viewport
 *   that is at least 200px by 200px." 바꿀 수 없다.
 * - **"완전히 보이지 않으면 정지" 는 III.I.9 의 직접적인 귀결이다.** 금지된
 *   것은 "사용자가 보고 있지 않은 곳에서의 재생" 이다.
 *
 * **M6 에서 노출 비율 임계값(0.5)을 폐지했다.** 그 숫자는 공식 기준이 아니라
 * 우리 휴리스틱이었고, 영상이 조금만 가려져도 음악이 끊기는 원인이었다
 * (실제 브라우저 검증에서 보고됨). 부분적으로 가려진 플레이어는 사용자가
 * 여전히 볼 수 있으므로 III.I.9 가 금지하는 상태가 아니다. 판정선은
 * **"조금이라도 보이는가"** 하나로 남긴다.
 *
 * 측정은 **순수 함수**다. 레이아웃 없는 환경(jsdom)에서도 전수 검증할 수 있게
 * 하기 위해서다. DOM 과 관찰자는 `watchPlayerVisibility()` 에만 있다.
 *
 * 이 모듈은 테마·라이브러리·드로어를 모르고, store 도 모른다.
 */

/** 공식 요구사항. 이 값을 낮추면 정책 위반이다. */
export const MIN_PLAYER_SIZE_PX = 200

/** 측정에 필요한 만큼의 사각형. `DOMRect` 를 그대로 넘겨도 맞는다. */
export interface PlayerRect {
  readonly width: number
  readonly height: number
  readonly top: number
  readonly left: number
  readonly right: number
  readonly bottom: number
}

export interface ViewportSize {
  readonly width: number
  readonly height: number
}

/** 재생할 수 없는 이유. 사용자 안내 문구가 이것으로 갈린다. */
export type PlayerHiddenReason =
  /** 화면에서 가려졌거나 밀려났다. `display: none` 도 여기다 */
  | 'covered'
  /** 영역이 공식 최소 크기(200×200)보다 작다 */
  | 'too-small'

export type PlayerVisibility = { ok: true } | { ok: false; reason: PlayerHiddenReason }

const VISIBLE: PlayerVisibility = { ok: true }

/**
 * 영상 영역이 재생할 만큼 보이는지 판정한다.
 *
 * 뷰포트와 겹치는 면적이 0 인지만 본다. 다른 요소에 덮인 경우까지 알아내지는 못한다 —
 * 그 경우는 드로어를 **형제 열**로 둔 구조(III.I.6)와 `playerWillHide()`
 * 통지로 다룬다.
 */
export function measurePlayerVisibility(
  rect: PlayerRect,
  viewport: ViewportSize,
): PlayerVisibility {
  const area = rect.width * rect.height

  // `display: none` 이면 사각형이 전부 0 이다. "작다" 가 아니라 "안 보인다".
  if (area <= 0) return { ok: false, reason: 'covered' }

  if (rect.width < MIN_PLAYER_SIZE_PX || rect.height < MIN_PLAYER_SIZE_PX) {
    return { ok: false, reason: 'too-small' }
  }

  const visibleWidth = Math.max(0, Math.min(rect.right, viewport.width) - Math.max(rect.left, 0))
  const visibleHeight = Math.max(0, Math.min(rect.bottom, viewport.height) - Math.max(rect.top, 0))

  // 뷰포트와 전혀 겹치지 않으면 정지한다. 비율은 보지 않는다 (M6).
  if (visibleWidth * visibleHeight <= 0) {
    return { ok: false, reason: 'covered' }
  }

  return VISIBLE
}

/**
 * 코디네이터가 플레이어 영역에 대해 할 수 있는 일.
 *
 * 영역을 **소유한 쪽**이 구현해 등록한다. 코디네이터는 이것만 들고 있으면
 * DOM 을 모른 채 판정하고 끌어올 수 있다.
 */
export interface PlayerPresence {
  /** 지금 상태를 잰다. 호출 시점의 실제 레이아웃을 읽는다. */
  measure(): PlayerVisibility

  /**
   * 영상 영역을 화면 안으로 끌어온다.
   *
   * **사용자가 재생을 요청했을 때만** 부른다. 좁은 화면에서는 단일 열
   * 배치 때문에 플레이어가 화면 한참 아래에 있다 (1000px 기준 약 1247px
   * 아래 — 승인된 레퍼런스의 배치도 같다). 그대로 거절하면 사용자는 왜
   * 재생이 안 되는지 모른 채 막힌다. 가려진 채로 재생하는 것보다
   * **보이게 하는 것**이 정책에 맞다 (III.I.9).
   *
   * `display: none` 은 끌어와도 보이지 않는다. 그 경우는 재측정이 다시
   * 거절한다.
   */
  reveal(): void
}

export interface PlayerVisibilityWatcher extends PlayerPresence {
  /** 관찰을 끝낸다. `PlayerSurface` 가 언마운트에서 부른다. */
  stop(): void
}

/**
 * 가시성 변화를 지켜본다. **측정값을 캐시하지 않는다.**
 *
 * `IntersectionObserver` 를 쓰는 이유: 스크롤·뷰포트 변화·`display: none` 을
 * 메인 스레드 폴링 없이 알려준다. 다만 임계값을 넘었을 때만 부르므로
 * "얼마나 보이는가" 는 `measure()` 가 그때 다시 읽는다. 판정 경로가 하나로
 * 유지되어야 테스트가 전수 검증한 것과 실제 동작이 같아진다.
 *
 * `resize` 를 함께 듣는 이유: 관찰자가 없는 환경(jsdom 등)에서도 최소한의
 * 재평가가 돌아야 한다. 관찰자가 없을 때만 `scroll` 까지 듣는다 —
 * 관찰자가 있으면 중복이다.
 */
export function watchPlayerVisibility(
  element: HTMLElement,
  onChange: () => void,
): PlayerVisibilityWatcher {
  const view = element.ownerDocument.defaultView

  function measure(): PlayerVisibility {
    // 뷰를 못 얻으면(분리된 문서) 보이지 않는 것으로 본다. 재생을 막는 쪽이 안전하다.
    if (view === null) return { ok: false, reason: 'covered' }

    return measurePlayerVisibility(element.getBoundingClientRect(), {
      width: view.innerWidth,
      height: view.innerHeight,
    })
  }

  function reveal(): void {
    // jsdom 등 구현이 없는 환경에서는 조용히 넘어간다.
    if (typeof element.scrollIntoView !== 'function') return

    // 즉시 스크롤이어야 한다. 부드러운 스크롤이면 바로 뒤의 재측정이
    // 아직 움직이지 않은 위치를 읽는다.
    element.scrollIntoView({ behavior: 'instant', block: 'center', inline: 'nearest' })
  }

  if (view === null) return { measure, reveal, stop: () => {} }

  const handler = (): void => onChange()

  let observer: IntersectionObserver | null = null
  if (typeof view.IntersectionObserver === 'function') {
    observer = new view.IntersectionObserver(handler, {
      // 판정선이 "조금이라도 보이는가" 하나이므로 경계도 0 하나다 (M6).
      threshold: [0],
    })
    observer.observe(element)
  }

  view.addEventListener('resize', handler, { passive: true })
  if (observer === null) {
    view.addEventListener('scroll', handler, { passive: true, capture: true })
  }

  return {
    measure,
    reveal,
    stop: () => {
      observer?.disconnect()
      observer = null
      view.removeEventListener('resize', handler)
      view.removeEventListener('scroll', handler, { capture: true })
    },
  }
}
