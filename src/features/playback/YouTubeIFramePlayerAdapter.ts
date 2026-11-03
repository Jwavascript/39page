/**
 * `PlayerAdapter` 의 YouTube IFrame API 구현체 (M3-1).
 *
 * **YouTube 의 비동기 준비와 숫자 상태값은 이 파일과 `youtubeIframeApi.ts`
 * 밖으로 나가지 않는다.** 밖에서 보이는 것은 `PlayerAdapter` 계약과
 * 도메인 `PlayerState` 뿐이다 (`AGENTS.md` 규칙 4, ADR 0008).
 *
 * 이 어댑터가 혼자 감당하는 네 가지 비동기 사정:
 *
 * 1. **API 스크립트가 늦게 온다.** `load()` 가 먼저 올 수 있다 → 보류한다.
 * 2. **플레이어가 늦게 준비된다.** 생성과 `onReady` 사이가 비어 있다 → 보류한다.
 * 3. **언마운트 뒤에도 콜백이 온다.** `generation` 으로 전부 무효화한다.
 * 4. **같은 스크립트를 두 번 받으면 안 된다.** 로더가 싱글턴으로 막는다.
 * 5. **스크립트 로드가 실패할 수 있다.** 실패를 전달하고 **재시도를 열어둔다**
 *    (M3-5). 로더가 실패한 시도를 버리므로 다음 `load()` 가 새 요청이 된다.
 *
 * store 를 import 하지 않는다. 사건은 `mount()` 에서 받은 핸들러로 올려보내고,
 * store 반영은 `PlayerSurface` 가 한다 (ADR 0006 의 단방향).
 */
import type { PlayerState } from '@/shared/types'

import type {
  PlayerAdapter,
  PlayerAdapterEvents,
  PlayerErrorInfo,
  PlayerErrorKind,
  PlayerLoadOptions,
} from './PlayerAdapter'
import { loadYouTubeIframeApi, type YouTubeApi, type YouTubePlayer } from './youtubeIframeApi'

/**
 * YouTube 숫자 상태값 → 도메인 상태.
 *
 * `CUED`(5)와 `UNSTARTED`(−1)는 둘 다 "아직 아무 일도 없다"라서 `idle` 이다.
 * `BUFFERING`(3)은 사용자에게 기다림으로 보이므로 `loading` 이다.
 */
const STATE_BY_CODE: Readonly<Record<number, PlayerState>> = {
  [-1]: 'idle', // UNSTARTED
  0: 'ended', // ENDED
  1: 'playing', // PLAYING
  2: 'paused', // PAUSED
  3: 'loading', // BUFFERING
  5: 'idle', // CUED
}

/** YouTube 오류 코드 → 도메인 오류 종류 (`SYSTEM_DESIGN.md` §8.1). */
const ERROR_KIND_BY_CODE: Readonly<Record<number, PlayerErrorKind>> = {
  2: 'invalid-parameter',
  5: 'not-playable',
  100: 'not-found',
  101: 'embed-not-allowed',
  150: 'embed-not-allowed',
  153: 'referrer-missing',
}

/**
 * `origin` 파라미터로 넣을 값 (M3-0.5).
 *
 * 상수로 박지 않는다. dev(`localhost:5173`)·LAN IP·배포 도메인이 전부 다르고,
 * 값이 실제 페이지 origin 과 다르면 API 가 메시지를 무시해 **플레이어가 조용히
 * 죽는다.** http(s) 가 아니면(`file://` 의 `"null"` 등) 아예 넣지 않는다.
 */
function pageOrigin(): string | undefined {
  const origin = window.location.origin
  if (origin.startsWith('http://') || origin.startsWith('https://')) return origin
  return undefined
}

export class YouTubeIFramePlayerAdapter implements PlayerAdapter {
  /** Vue 가 소유하는 래퍼. 우리가 바꾸지 않는다. */
  private container: HTMLElement | null = null

  /**
   * 어댑터가 만들어 소유하는 **안정적인** 노드.
   *
   * `YT.Player` 는 넘겨받은 요소를 **iframe 으로 교체한다.** 그래서 이 노드를
   * 직접 넘기지 않고, 이 안에 교체당할 자식을 하나 더 만들어 넘긴다. 덕분에
   * `hostNode` 는 플레이어가 생기든 사라지든 같은 노드로 남고, 정리는
   * 이 노드 하나를 지우면 끝난다.
   */
  private hostNode: HTMLElement | null = null

  private player: YouTubePlayer | null = null
  private events: PlayerAdapterEvents | null = null
  private api: YouTubeApi | null = null

  private currentState: PlayerState = 'idle'

  /** `onReady` 전에 들어온 적재 요청. 마지막 것만 남는다. */
  private pendingVideoId: string | null = null

  /** `onReady` 전에 들어온 재생 요청. */
  private wantsPlay = false

  private playerReady = false

  /** 로더에 이미 요청했는지. 같은 Promise 에 핸들러를 여러 번 달지 않는다. */
  private apiRequested = false

  /**
   * 세대 번호. `destroy()` 마다 올린다.
   *
   * 비동기 콜백은 자신이 등록될 때의 세대를 기억하고, 돌아왔을 때 세대가
   * 다르면 아무것도 하지 않는다. 언마운트된 어댑터가 사라진 DOM 을 건드리거나
   * 죽은 store 에 사건을 올리는 것을 막는다.
   */
  private generation = 0

  mount(container: HTMLElement, events?: PlayerAdapterEvents): void {
    // 중복 호출은 no-op. 두 번째 노드를 만들지 않는다.
    if (this.hostNode !== null) return

    const host = container.ownerDocument.createElement('div')
    host.dataset.youtubePlayerHost = 'true'
    container.append(host)

    this.container = container
    this.hostNode = host
    this.events = events ?? null
  }

  destroy(): void {
    // 마운트되지 않았으면 no-op.
    if (this.hostNode === null) return

    // 먼저 올린다. 이 뒤에 도착하는 콜백은 전부 무효다.
    this.generation += 1

    if (this.player !== null) {
      try {
        this.player.destroy()
      } catch {
        // iframe 이 이미 사라진 경우. 정리 중이라 더 할 일이 없다.
      }
      this.player = null
    }

    // 플레이어가 iframe 으로 교체한 자식까지 이 노드와 함께 사라진다.
    this.hostNode.remove()

    this.hostNode = null
    this.container = null
    this.events = null
    this.api = null
    this.pendingVideoId = null
    this.wantsPlay = false
    this.playerReady = false
    this.apiRequested = false
    this.currentState = 'idle'
  }

  load(videoId: string, options?: PlayerLoadOptions): void {
    if (this.hostNode === null) return

    const autoplay = options?.autoplay === true
    const player = this.player

    if (player !== null && this.playerReady) {
      this.pendingVideoId = null
      this.wantsPlay = false
      if (autoplay) player.loadVideoById(videoId)
      else player.cueVideoById(videoId)
      return
    }

    // 아직 준비되지 않았다. 보류했다가 `onReady` 에서 한 번만 흘려보낸다.
    this.pendingVideoId = videoId
    this.wantsPlay = autoplay
    this.ensureApi()
  }

  play(): void {
    if (this.hostNode === null) return

    const player = this.player
    if (player !== null && this.playerReady) {
      player.playVideo()
      return
    }

    // 적재된 영상이 없으면 재생할 것이 없다. 의도를 남기지 않는다.
    if (player === null && this.pendingVideoId === null) return

    this.wantsPlay = true
    this.ensureApi()
  }

  pause(): void {
    if (this.hostNode === null) return

    // 준비되면 재생하려던 의도를 취소한다. 이것이 없으면 사용자가 멈춘 뒤
    // 플레이어가 준비되는 순간 제멋대로 재생된다.
    this.wantsPlay = false

    if (this.player !== null && this.playerReady) this.player.pauseVideo()
  }

  state(): PlayerState {
    return this.currentState
  }

  /** API 를 확보한다. 이미 있으면 바로 플레이어를 만든다. */
  private ensureApi(): void {
    if (this.api !== null) {
      this.createPlayer()
      return
    }
    if (this.apiRequested) return
    this.apiRequested = true

    const generation = this.generation
    loadYouTubeIframeApi().then(
      (api) => {
        if (!this.isCurrent(generation)) return
        this.api = api
        this.createPlayer()
      },
      () => {
        if (!this.isCurrent(generation)) return
        /*
         * 다시 시도할 수 있게 표시를 지운다 (M3-5). 로더도 실패한 시도를
         * 버리므로, 사용자가 ▶ 를 다시 누르면 새 요청이 나간다.
         */
        this.apiRequested = false
        this.fail({ kind: 'api-unavailable', code: null })
      },
    )
  }

  /**
   * `YT.Player` 를 만든다. 적재할 영상이 없으면 만들지 않는다.
   *
   * 한 번만 만든다. 곡 전환은 `loadVideoById` / `cueVideoById` 로 하고
   * 플레이어를 다시 만들지 않는다 (ADR 0002).
   */
  private createPlayer(): void {
    if (this.player !== null) return

    const api = this.api
    const host = this.hostNode
    const videoId = this.pendingVideoId
    if (api === null || host === null || videoId === null) return

    // 생성자에 넘기므로 보류 목록에서 뺀다. 재생 의도(`wantsPlay`)는
    // `onReady` 가 쓰므로 남겨둔다.
    this.pendingVideoId = null

    const playerVars: Record<string, string | number> = {
      controls: 1,
      playsinline: 1,
      rel: 0,
      autoplay: 0,
    }
    const origin = pageOrigin()
    if (origin !== undefined) playerVars.origin = origin

    // 교체당할 자식. `hostNode` 자체는 남는다.
    const target = host.ownerDocument.createElement('div')
    host.append(target)

    const generation = this.generation
    this.playerReady = false
    this.setState('loading')

    this.player = new api.Player(target, {
      width: '100%',
      height: '100%',
      videoId,
      playerVars,
      events: {
        onReady: () => {
          if (this.isCurrent(generation)) this.handleReady()
        },
        onStateChange: (event) => {
          if (this.isCurrent(generation)) this.handleStateChange(event.data)
        },
        onError: (event) => {
          if (this.isCurrent(generation)) this.handleError(event.data)
        },
        onAutoplayBlocked: () => {
          if (this.isCurrent(generation)) this.handleAutoplayBlocked()
        },
      },
    })
  }

  /** 보류한 요청을 **한 번** 흘려보낸다. */
  private handleReady(): void {
    const player = this.player
    if (player === null) return

    this.playerReady = true

    const videoId = this.pendingVideoId
    const autoplay = this.wantsPlay
    this.pendingVideoId = null
    this.wantsPlay = false

    if (videoId !== null) {
      // 생성자에 넘긴 영상과 다른 영상이 그 사이에 요청됐다.
      if (autoplay) player.loadVideoById(videoId)
      else player.cueVideoById(videoId)
    } else if (autoplay) {
      player.playVideo()
    }

    // 보류를 처리한 뒤에 알린다. 구독자가 이 콜백에서 다시 재생을 걸어
    // 두 번 재생되는 일이 없게 한다.
    this.events?.ready?.()
  }

  private handleStateChange(code: number): void {
    const next = STATE_BY_CODE[code]
    // 문서에 없는 값은 무시한다. 추측해서 바꾸면 마지막으로 알던 상태까지 잃는다.
    if (next === undefined) return
    this.setState(next)
  }

  private handleError(code: number): void {
    this.fail({ kind: ERROR_KIND_BY_CODE[code] ?? 'unknown', code })
  }

  private handleAutoplayBlocked(): void {
    // 오류가 아니다. YouTube 가 이미 알려준 상태는 그대로 둔다.
    this.wantsPlay = false

    /*
     * 다만 우리가 플레이어를 만들며 낙관적으로 세운 `loading` 은 거짓이 됐다
     * (M3-5). 그대로 두면 토글이 ⏸ 를 보여주고 누르면 "멈춤" 이 되어,
     * 사용자가 재생을 **다시 요청할 수 없다.** CUED(5) 와 같은 `idle` 로
     * 되돌린다. YouTube 가 보낸 상태(`paused` 등)는 건드리지 않는다.
     */
    if (this.currentState === 'loading') this.setState('idle')

    this.events?.autoplayBlocked?.()
  }

  /** `stateChange('error')` 를 먼저, `error(info)` 를 나중에 (ADR 0008). */
  private fail(info: PlayerErrorInfo): void {
    this.wantsPlay = false
    this.setState('error')
    this.events?.error?.(info)
  }

  /** 바뀔 때만 알린다. 같은 상태를 두 번 알리지 않는다. */
  private setState(next: PlayerState): void {
    if (next === this.currentState) return
    this.currentState = next
    this.events?.stateChange?.(next)
  }

  /** 등록 당시의 세대이고 아직 마운트돼 있는가. */
  private isCurrent(generation: number): boolean {
    return generation === this.generation && this.hostNode !== null
  }
}
