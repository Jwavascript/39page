/**
 * YouTube IFrame API 스크립트 로더.
 *
 * **어댑터 밖에서 이 파일을 쓰지 않는다.** `YT` 전역과 그 숫자 상태값은
 * 여기와 `YouTubeIFramePlayerAdapter` 안에만 머문다
 * (`SYSTEM_DESIGN.md` §4.6, ADR 0008).
 *
 * 왜 별도 파일인가: 상태가 **모듈 수준 싱글턴**이다. 어댑터가 여러 번
 * 생겼다 사라져도 스크립트는 한 번만 받고, `window.onYouTubeIframeAPIReady`
 * 는 한 번만 등록한다. 그 수명이 어댑터 인스턴스보다 길어서 클래스 안에
 * 둘 수 없다.
 *
 * 타입은 직접 선언한다. `@types/youtube` 를 받지 않는다 — 쓰는 멤버가
 * 아래 몇 개뿐이고, 받으면 전역 타입이 프로젝트 전체에 퍼진다
 * (`AGENTS.md` 규칙 8).
 */

/**
 * `loadVideoById` · `cueVideoById` 의 객체 인자 (M9-3).
 *
 * 공식 문서의 객체 문법이다. `startSeconds` 를 실어 보내는 유일한 방법이고,
 * 적재와 시점 지정이 **한 명령**이라 둘 사이에 경쟁이 없다 (ADR 0020).
 */
export interface YouTubeVideoRequest {
  videoId: string
  startSeconds?: number
}

/** 우리가 호출하는 `YT.Player` 메서드만 선언한다. */
export interface YouTubePlayer {
  /** 즉시 재생하며 교체한다. 객체 인자는 시작 시점을 함께 싣는다 (M9-3). */
  loadVideoById(request: string | YouTubeVideoRequest): void
  /** 적재만 하고 기다린다. */
  cueVideoById(request: string | YouTubeVideoRequest): void
  playVideo(): void
  pauseVideo(): void
  destroy(): void

  /**
   * 지정한 초로 이동한다 (M9-3).
   *
   * `allowSeekAhead` 가 `true` 면 아직 받지 않은 구간으로도 간다 — 사용자가
   * 명시적으로 고른 시점이므로 항상 `true` 로 보낸다.
   */
  seekTo(seconds: number, allowSeekAhead: boolean): void

  /**
   * 현재 재생 위치(초). 소수다 (M9-3).
   *
   * 부모 창의 `YT.Player` 는 iframe 이 보내온 값을 **캐시**해 돌려준다.
   * 준비 전에는 `0` 이나 `undefined` 를 줄 수 있어, 어댑터가 `null` 로
   * 바꿔 전한다.
   */
  getCurrentTime(): number | undefined

  /**
   * 지금 적재된 영상의 youtube.com 주소 (M9-3).
   *
   * `getCurrentTime()` 과 **같은 캐시**에서 나온다. 그래서 둘을 같은 순간에
   * 읽으면 서로 같은 영상의 값이고, 어댑터는 이것으로 "그 위치가 어느 영상의
   * 것인가" 를 가린다. 아직 아무것도 적재되지 않았으면 `v=` 가 없다.
   */
  getVideoUrl(): string | undefined
}

export interface YouTubePlayerEvent {
  target: YouTubePlayer
}

/** `data` 는 YouTube 의 숫자 상태값(−1 · 0 · 1 · 2 · 3 · 5)이다. */
export interface YouTubeStateChangeEvent extends YouTubePlayerEvent {
  data: number
}

/** `data` 는 YouTube 오류 코드(2 · 5 · 100 · 101 · 150 · 153)다. */
export interface YouTubeErrorEvent extends YouTubePlayerEvent {
  data: number
}

export interface YouTubePlayerOptions {
  width?: string
  height?: string
  videoId?: string
  playerVars?: Record<string, string | number>
  events?: {
    onReady?(event: YouTubePlayerEvent): void
    onStateChange?(event: YouTubeStateChangeEvent): void
    onError?(event: YouTubeErrorEvent): void
    onAutoplayBlocked?(event: YouTubePlayerEvent): void
  }
}

export interface YouTubeApi {
  Player: new (host: HTMLElement, options: YouTubePlayerOptions) => YouTubePlayer
}

declare global {
  interface Window {
    YT?: YouTubeApi
    /** API 스크립트가 로드를 끝내면 **한 번** 부른다. */
    onYouTubeIframeAPIReady?: () => void
  }
}

export const YOUTUBE_IFRAME_API_SRC = 'https://www.youtube.com/iframe_api'

/**
 * 진행 중인 로드. 모듈 싱글턴이다.
 *
 * **실패하면 비운다** (M3-5). 실패한 `<script>` 는 다시 `error` 를 쏘지
 * 않으므로, 실패를 담아두면 영구히 재시도할 수 없다. 대신 비울 때 실패한
 * 요소를 함께 치워, 다음 요청이 **새 요청**이 되게 한다.
 *
 * 요청 폭풍이 되지 않는 이유: 재생을 시작하는 경로는 전부 사용자의 명시적
 * 동작이거나 `ENDED` 자동 전환이고, API 를 못 받으면 아무것도 재생된 적이
 * 없어 `ENDED` 가 오지 않는다.
 */
let loading: Promise<YouTubeApi> | null = null

/** 이번 시도가 지켜보는 `<script>`. 실패하면 치운다. */
let watchedScript: HTMLScriptElement | null = null

/**
 * 이번 시도의 해결자.
 *
 * `window.onYouTubeIframeAPIReady` 는 **모듈 수명 동안 한 번만** 감싼다.
 * 재시도마다 다시 감싸면 래퍼가 중첩된다.
 */
let pending: { resolve: (api: YouTubeApi) => void; reject: (error: Error) => void } | null = null

let readyHookInstalled = false

function hasPlayer(api: YouTubeApi | undefined): api is YouTubeApi {
  return typeof api?.Player === 'function'
}

/**
 * 준비 콜백을 **한 번만** 등록한다.
 *
 * 이미 등록된 핸들러가 있으면 덮지 않고 이어서 부른다. API 는 이 전역을
 * 한 번만 호출하므로, 덮어쓰면 먼저 등록한 쪽이 영구히 신호를 놓친다.
 */
function installReadyHook(): void {
  if (readyHookInstalled) return
  readyHookInstalled = true

  const previous = window.onYouTubeIframeAPIReady
  window.onYouTubeIframeAPIReady = () => {
    previous?.()
    if (hasPlayer(window.YT)) pending?.resolve(window.YT)
    else pending?.reject(new Error('YouTube IFrame API 가 준비됐다고 알렸지만 YT.Player 가 없다'))
  }
}

/**
 * API 를 한 번만 받는다. 진행 중이면 **같은 Promise** 를 돌려준다.
 *
 * 성공하면 `YT` 전역을 준다. 실패(스크립트 로드 오류)하면 reject 하고
 * 그 시도를 버려 **다음 호출이 다시 시도**하게 한다.
 * reject 는 어댑터가 `api-unavailable` 오류로 바꿔 전달한다.
 */
export function loadYouTubeIframeApi(): Promise<YouTubeApi> {
  if (loading !== null) return loading

  const attempt = new Promise<YouTubeApi>((resolve, reject) => {
    // 이미 다른 경로로 로드돼 있으면 스크립트를 붙이지 않는다.
    if (hasPlayer(window.YT)) {
      resolve(window.YT)
      return
    }

    pending = { resolve, reject }
    installReadyHook()

    const failed = (): void => {
      reject(new Error('YouTube IFrame API 스크립트를 불러오지 못했다'))
    }

    // 같은 스크립트가 이미 문서에 있으면 또 붙이지 않는다. 로드 중일 수 있어
    // 오류만 지켜본다 (성공은 위의 전역 콜백이 알려준다).
    const existing = document.querySelector<HTMLScriptElement>(
      `script[src="${YOUTUBE_IFRAME_API_SRC}"]`,
    )
    if (existing !== null) {
      watchedScript = existing
      existing.addEventListener('error', failed, { once: true })
      return
    }

    const script = document.createElement('script')
    script.src = YOUTUBE_IFRAME_API_SRC
    script.async = true
    script.addEventListener('error', failed, { once: true })
    watchedScript = script
    document.head.append(script)
  })

  loading = attempt

  /*
   * 실패한 시도를 버린다. 호출부는 돌려받은 Promise 로 거절을 그대로 보므로
   * 여기서는 뒷정리만 한다.
   */
  void attempt.catch(() => {
    if (loading !== attempt) return

    loading = null
    pending = null
    // 실패한 요소는 다시 `error` 를 쏘지 않는다. 치워야 재시도가 새 요청이 된다.
    watchedScript?.remove()
    watchedScript = null
  })

  return attempt
}
