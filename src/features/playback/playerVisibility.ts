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
 * 여전히 볼 수 있으므로 III.I.9 가 금지하는 상태가 아니다. 뷰포트에 대한
 * 판정선은 **"조금이라도 보이는가"** 하나로 남긴다.
 *
 * **M7-1 에서 "우리 UI 가 덮은 높이" 를 받게 했다** (`obstructedBottom`).
 * 세로 화면의 하단 시트가 플레이어를 덮을 수 있게 되었기 때문이다. 두 가지를
 * 서로 다른 기준으로 보는 것은 사정이 다르기 때문이다.
 *
 * | 가리는 것      | 기준                   | 왜                                          |
 * | -------------- | ---------------------- | ------------------------------------------- |
 * | 뷰포트(스크롤) | 조금이라도 보이면 허용 | 사용자가 스크롤 위치를 고른 것이다 (M6)      |
 * | **우리 오버레이** | **남은 영역이 200×200** | 앱이 영상을 덮어 놓고 소리를 내는 상태다 |
 *
 * 오버레이에 200×200 을 쓰는 것은 **새 숫자를 만들지 않기 위해서다.** 공식
 * 요구사항이 "임베드 플레이어는 200×200 이상의 뷰포트를 가져야 한다" 이므로,
 * 우리가 그 아래로 덮어 버리면 요구사항을 어긴 것과 같다. 비율 임계값을 다시
 * 만들면 M6 에서 폐지한 그 휴리스틱이 되살아난다.
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
  /**
   * 뷰포트 **하단**에서 우리 UI 가 덮고 있는 높이 (px). 기본 0.
   *
   * 세로 화면의 레코드 시트가 이 값을 만든다. 가리는 쪽이 알려주고
   * (`PlaybackVisibility.setBottomObstruction`), 이 모듈은 **무엇이 가리는지
   * 모른다.** 숫자만 받는다.
   */
  readonly obstructedBottom?: number
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
 * 세 가지를 본다. 순서가 의미를 갖는다 — 먼저 걸린 사유가 안내 문구를 정한다.
 *
 * 1. 영역 자체가 0 이면 `covered` (`display: none`)
 * 2. 영역이 200×200 미만이면 `too-small` (공식 요구사항)
 * 3. 뷰포트와 전혀 겹치지 않으면 `covered`
 * 4. **우리 오버레이가 덮어 남은 높이가 200px 미만이면 `covered`** (M7-1)
 *
 * 4 번에서 `covered` 를 쓰는 것은 의도다. 영역이 작은 것이 아니라 **덮인**
 * 것이므로 사용자가 할 일이 다르다 — 창을 키우는 것이 아니라 시트를 닫거나
 * 영상이 보이는 곳으로 스크롤하는 것이다.
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

  /*
   * 우리 UI 가 하단을 덮는다 (M7-1).
   *
   * 뷰포트 하단을 시트 위쪽으로 끌어올려 다시 잰다. 남은 띠가 200px 보다
   * 얇으면 공식 요구사항을 우리 손으로 깬 것이므로 재생하지 않는다.
   *
   * 뷰포트 클리핑과 달리 **비율이 아니라 절대 높이**를 본다 (위 표).
   */
  const obstruction = Math.max(0, viewport.obstructedBottom ?? 0)
  if (obstruction > 0) {
    const unobstructedBottom = viewport.height - obstruction
    const unobstructedHeight = Math.max(
      0,
      Math.min(rect.bottom, unobstructedBottom) - Math.max(rect.top, 0),
    )

    if (unobstructedHeight < MIN_PLAYER_SIZE_PX) {
      return { ok: false, reason: 'covered' }
    }
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
  /**
   * 지금 상태를 잰다. 호출 시점의 실제 레이아웃을 읽는다.
   *
   * `obstructedBottom` 은 **우리 UI 가 뷰포트 하단을 덮은 높이**다. 영역을
   * 소유한 쪽은 그것을 알 수 없으므로 코디네이터가 넘긴다 (M7-1).
   */
  measure(obstructedBottom?: number): PlayerVisibility

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

  function measure(obstructedBottom = 0): PlayerVisibility {
    // 뷰를 못 얻으면(분리된 문서) 보이지 않는 것으로 본다. 재생을 막는 쪽이 안전하다.
    if (view === null) return { ok: false, reason: 'covered' }

    return measurePlayerVisibility(element.getBoundingClientRect(), {
      width: view.innerWidth,
      height: view.innerHeight,
      obstructedBottom,
    })
  }

  function reveal(): void {
    // jsdom 등 구현이 없는 환경에서는 조용히 넘어간다.
    if (typeof element.scrollIntoView !== 'function') return

    /*
     * 즉시 스크롤이어야 한다. 부드러운 스크롤이면 바로 뒤의 재측정이 아직
     * 움직이지 않은 위치를 읽는다.
     *
     * `block: 'start'` 다 (M7-1 에서 `'center'` 에서 바꿨다). 하단 시트가
     * 열려 있으면 화면 가운데는 **시트 아래**다 — 끌어온 결과가 다시 덮인
     * 자리가 된다. 위쪽에 붙이면 덮이지 않은 띠를 최대로 쓴다.
     */
    element.scrollIntoView({ behavior: 'instant', block: 'start', inline: 'nearest' })
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
