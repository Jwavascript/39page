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

/** 우리가 호출하는 `YT.Player` 메서드만 선언한다. */
export interface YouTubePlayer {
  /** 즉시 재생하며 교체한다. */
  loadVideoById(videoId: string): void
  /** 적재만 하고 기다린다. */
  cueVideoById(videoId: string): void
  playVideo(): void
  pauseVideo(): void
  destroy(): void
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
 * 진행 중이거나 끝난 로드. 모듈 싱글턴이다.
 *
 * 실패도 담아둔다. 실패할 때마다 `<script>` 를 다시 붙이면, 네트워크가
 * 끊긴 동안 곡을 여러 번 누른 사용자가 요청 폭풍을 만든다.
 */
let loading: Promise<YouTubeApi> | null = null

function hasPlayer(api: YouTubeApi | undefined): api is YouTubeApi {
  return typeof api?.Player === 'function'
}

/**
 * API 를 한 번만 받는다. 여러 번 불러도 **같은 Promise** 를 돌려준다.
 *
 * 성공하면 `YT` 전역을 준다. 실패(스크립트 로드 오류)하면 reject 한다.
 * reject 는 어댑터가 `api-unavailable` 오류로 바꿔 전달한다.
 */
export function loadYouTubeIframeApi(): Promise<YouTubeApi> {
  if (loading !== null) return loading

  loading = new Promise<YouTubeApi>((resolve, reject) => {
    // 이미 다른 경로로 로드돼 있으면 스크립트를 붙이지 않는다.
    if (hasPlayer(window.YT)) {
      resolve(window.YT)
      return
    }

    // 단일 등록. 이미 등록된 핸들러가 있으면 **덮지 않고 이어서** 부른다.
    // API 는 이 전역을 한 번만 호출하므로, 덮어쓰면 먼저 등록한 쪽이 영구히
    // 신호를 놓친다.
    const previous = window.onYouTubeIframeAPIReady
    window.onYouTubeIframeAPIReady = () => {
      previous?.()
      if (hasPlayer(window.YT)) resolve(window.YT)
      else reject(new Error('YouTube IFrame API 가 준비됐다고 알렸지만 YT.Player 가 없다'))
    }

    const failed = () => {
      reject(new Error('YouTube IFrame API 스크립트를 불러오지 못했다'))
    }

    // 같은 스크립트가 이미 문서에 있으면 또 붙이지 않는다. 로드 중일 수 있어
    // 오류만 지켜본다 (성공은 위의 전역 콜백이 알려준다).
    const existing = document.querySelector<HTMLScriptElement>(
      `script[src="${YOUTUBE_IFRAME_API_SRC}"]`,
    )
    if (existing !== null) {
      existing.addEventListener('error', failed, { once: true })
      return
    }

    const script = document.createElement('script')
    script.src = YOUTUBE_IFRAME_API_SRC
    script.async = true
    script.addEventListener('error', failed, { once: true })
    document.head.append(script)
  })

  return loading
}

// TODO(M3-5): 로드 실패 후 사용자가 다시 시도할 수 있게 하려면 이 싱글턴을
// 비우는 경로가 필요하다. 재시도 UX 와 함께 정한다.
