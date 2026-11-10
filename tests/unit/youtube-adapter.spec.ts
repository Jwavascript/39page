/**
 * M3-1 — `YouTubeIFramePlayerAdapter`.
 *
 * **실제 네트워크에 접속하지 않는다.** jsdom 은 외부 `<script>` 를 실행하지
 * 않으므로, 스크립트 태그가 붙었는지만 확인하고 `window.YT` 를 직접 세운 뒤
 * `window.onYouTubeIframeAPIReady` 를 손으로 불러 "API 가 왔다"를 재현한다.
 *
 * 가짜 `YT.Player` 는 **넘겨받은 요소를 iframe 으로 교체한다.** 실제 API 가
 * 그렇게 동작하기 때문이고, 어댑터가 자기 소유 노드를 잃지 않는지 확인하려면
 * 그 교체를 재현해야 한다.
 *
 * API 로더가 모듈 싱글턴이므로 테스트마다 `vi.resetModules()` 로 새 모듈
 * 그래프를 받는다. 프로덕션 코드에 테스트용 초기화 함수를 두지 않기 위해서다.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { FakePlayerAdapter } from '@/features/playback/FakePlayerAdapter'
import type { PlayerAdapterEvents, PlayerErrorInfo } from '@/features/playback/PlayerAdapter'
import type { YouTubeIFramePlayerAdapter } from '@/features/playback/YouTubeIFramePlayerAdapter'
import type {
  YouTubePlayer,
  YouTubePlayerOptions,
  YouTubeVideoRequest,
} from '@/features/playback/youtubeIframeApi'
import type { PlayerState } from '@/shared/types'

const API_SRC = 'https://www.youtube.com/iframe_api'

/**
 * 가짜 `YT.Player`. 실제 API 처럼 넘겨받은 요소를 iframe 으로 교체한다.
 *
 * M9-3 부터 **위치 질의**도 재현한다. 실제 부모 창의 `YT.Player` 는 iframe 이
 * 보내온 값을 캐시해 돌려주므로, `loadVideoById(B)` 를 받아도 `getVideoUrl()`
 * 과 `getCurrentTime()` 은 **다음 보고가 오기 전까지 A 의 값**이다. 그 틈을
 * 재현하려고 명령이 보고값을 바꾸지 않게 하고, 테스트가 `deliver()` 로
 * "iframe 이 보고했다" 를 흘려보낸다.
 */
class FakeYtPlayer implements YouTubePlayer {
  static instances: FakeYtPlayer[] = []

  readonly options: YouTubePlayerOptions
  readonly iframe: HTMLElement
  readonly loadCalls: Array<string | YouTubeVideoRequest> = []
  readonly cueCalls: Array<string | YouTubeVideoRequest> = []
  readonly seekCalls: Array<{ seconds: number; allowSeekAhead: boolean }> = []
  playCalls = 0
  pauseCalls = 0
  destroyCalls = 0

  /** iframe 이 마지막으로 보고한 영상과 시간. 명령으로는 바뀌지 않는다. */
  reportedVideoId: string | null = null
  reportedTime: number | undefined = undefined
  /** 질의에 던지는 플레이어를 재현한다 (파괴 중 등). */
  throwOnQuery = false

  constructor(host: HTMLElement, options: YouTubePlayerOptions) {
    this.options = options
    FakeYtPlayer.instances.push(this)

    const iframe = host.ownerDocument.createElement('iframe')
    host.replaceWith(iframe)
    this.iframe = iframe
  }

  loadVideoById(request: string | YouTubeVideoRequest): void {
    this.loadCalls.push(request)
  }

  cueVideoById(request: string | YouTubeVideoRequest): void {
    this.cueCalls.push(request)
  }

  seekTo(seconds: number, allowSeekAhead: boolean): void {
    this.seekCalls.push({ seconds, allowSeekAhead })
  }

  getCurrentTime(): number | undefined {
    if (this.throwOnQuery) throw new Error('player gone')
    return this.reportedTime
  }

  getVideoUrl(): string | undefined {
    if (this.throwOnQuery) throw new Error('player gone')
    // 아직 적재된 영상이 없으면 실제 API 도 `v=` 없는 주소를 준다.
    if (this.reportedVideoId === null) return 'https://www.youtube.com/watch'
    return `https://www.youtube.com/watch?t=${String(Math.floor(this.reportedTime ?? 0))}&v=${this.reportedVideoId}`
  }

  /** iframe 이 현재 영상과 시간을 보고했다 (infoDelivery). */
  deliver(videoId: string | null, time: number | undefined): void {
    this.reportedVideoId = videoId
    this.reportedTime = time
  }

  playVideo(): void {
    this.playCalls += 1
  }

  pauseVideo(): void {
    this.pauseCalls += 1
  }

  destroy(): void {
    this.destroyCalls += 1
    this.iframe.remove()
  }

  fireReady(): void {
    this.options.events?.onReady?.({ target: this })
  }

  fireStateChange(data: number): void {
    this.options.events?.onStateChange?.({ target: this, data })
  }

  fireError(data: number): void {
    this.options.events?.onError?.({ target: this, data })
  }

  fireAutoplayBlocked(): void {
    this.options.events?.onAutoplayBlocked?.({ target: this })
  }
}

interface EventLog {
  ready: number
  states: PlayerState[]
  errors: PlayerErrorInfo[]
  autoplayBlocked: number
}

/** 네 사건을 모두 기록하는 구독자. */
function recorder(): { log: EventLog; events: PlayerAdapterEvents } {
  const log: EventLog = { ready: 0, states: [], errors: [], autoplayBlocked: 0 }
  return {
    log,
    events: {
      ready: () => {
        log.ready += 1
      },
      stateChange: (state) => {
        log.states.push(state)
      },
      error: (info) => {
        log.errors.push(info)
      },
      autoplayBlocked: () => {
        log.autoplayBlocked += 1
      },
    },
  }
}

let AdapterClass: new () => YouTubeIFramePlayerAdapter

/** 매번 새 모듈 그래프를 받아 로더 싱글턴을 초기화한다. */
beforeEach(async () => {
  vi.resetModules()
  document.head.innerHTML = ''
  document.body.innerHTML = ''
  delete window.YT
  delete window.onYouTubeIframeAPIReady
  FakeYtPlayer.instances = []

  const module = await import('@/features/playback/YouTubeIFramePlayerAdapter')
  AdapterClass = module.YouTubeIFramePlayerAdapter
})

afterEach(() => {
  document.head.innerHTML = ''
  document.body.innerHTML = ''
  delete window.YT
  delete window.onYouTubeIframeAPIReady
})

function makeContainer(): HTMLElement {
  const container = document.createElement('div')
  document.body.append(container)
  return container
}

function apiScripts(): HTMLScriptElement[] {
  return [...document.head.querySelectorAll<HTMLScriptElement>(`script[src="${API_SRC}"]`)]
}

function installApi(): void {
  window.YT = { Player: FakeYtPlayer }
}

/** API 스크립트가 로드를 끝낸 것처럼 만든다. */
async function arriveApi(): Promise<void> {
  installApi()
  window.onYouTubeIframeAPIReady?.()
  await flush()
}

/** 스크립트 로드 실패를 재현한다. */
async function failApi(): Promise<void> {
  const script = apiScripts()[0]
  script?.dispatchEvent(new Event('error'))
  await flush()
}

function flush(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0)
  })
}

/** `Array.prototype.at` 은 이 tsconfig 의 lib 에 없다. */
function last<T>(items: readonly T[]): T | undefined {
  return items[items.length - 1]
}

/** 마지막으로 만들어진 가짜 플레이어. */
function lastPlayer(): FakeYtPlayer {
  const player = last(FakeYtPlayer.instances)
  if (player === undefined) throw new Error('플레이어가 만들어지지 않았다')
  return player
}

describe('A. API 스크립트 싱글턴 로드', () => {
  it('mount() 만으로는 스크립트를 붙이지 않는다', () => {
    const adapter = new AdapterClass()

    adapter.mount(makeContainer())

    // 지연 로드 (ADR 0008). 음악을 틀지 않는 방문에 외부 요청을 만들지 않는다.
    expect(apiScripts()).toHaveLength(0)
  })

  it('첫 load() 에서 스크립트를 한 번 붙인다', () => {
    const adapter = new AdapterClass()
    adapter.mount(makeContainer())

    adapter.load('aaaaaaaaaaa')

    expect(apiScripts()).toHaveLength(1)
    expect(apiScripts()[0]?.async).toBe(true)
  })

  it('같은 어댑터가 load() 를 여러 번 불러도 스크립트는 하나다', () => {
    const adapter = new AdapterClass()
    adapter.mount(makeContainer())

    adapter.load('aaaaaaaaaaa')
    adapter.load('bbbbbbbbbbb')
    adapter.play()

    expect(apiScripts()).toHaveLength(1)
  })

  it('어댑터를 둘 만들어 각각 load() 해도 스크립트는 하나다', () => {
    const first = new AdapterClass()
    const second = new AdapterClass()
    first.mount(makeContainer())
    second.mount(makeContainer())

    first.load('aaaaaaaaaaa')
    second.load('bbbbbbbbbbb')

    expect(apiScripts()).toHaveLength(1)
  })

  it('이미 등록된 onYouTubeIframeAPIReady 를 덮지 않고 이어서 부른다', async () => {
    let previousCalls = 0
    window.onYouTubeIframeAPIReady = () => {
      previousCalls += 1
    }

    const adapter = new AdapterClass()
    adapter.mount(makeContainer())
    adapter.load('aaaaaaaaaaa')

    await arriveApi()

    // 덮어쓰면 먼저 등록한 쪽이 신호를 영구히 놓친다.
    expect(previousCalls).toBe(1)
    expect(FakeYtPlayer.instances).toHaveLength(1)
  })

  it('window.YT 가 이미 있으면 스크립트를 붙이지 않는다', async () => {
    installApi()

    const adapter = new AdapterClass()
    adapter.mount(makeContainer())
    adapter.load('aaaaaaaaaaa')
    await flush()

    expect(apiScripts()).toHaveLength(0)
    expect(FakeYtPlayer.instances).toHaveLength(1)
  })

  it('로드가 실패하면 매달리지 않고 실패한 스크립트를 치운다 (M3-5)', async () => {
    const first = recorder()
    const adapter = new AdapterClass()
    adapter.mount(makeContainer(), first.events)
    adapter.load('aaaaaaaaaaa')
    expect(apiScripts()).toHaveLength(1)

    await failApi()

    expect(first.log.errors).toEqual([{ kind: 'api-unavailable', code: null }])
    /*
     * 실패한 <script> 는 다시 `error` 를 쏘지 않는다. 그대로 두면 다음 요청이
     * 그 죽은 요소를 보고 조용히 영원히 매달린다 — 사용자에게는 끝나지 않는
     * "준비 중" 화면이다. 치워야 재시도가 **새 요청**이 된다.
     */
    expect(apiScripts()).toHaveLength(0)
  })

  it('실패 뒤 같은 어댑터가 다시 요청하면 스크립트를 새로 붙인다 (M3-5)', async () => {
    const { log, events } = recorder()
    const adapter = new AdapterClass()
    adapter.mount(makeContainer(), events)
    adapter.load('aaaaaaaaaaa', { autoplay: true })
    await failApi()

    // 사용자가 ▶ 를 다시 누른 것과 같은 경로다.
    adapter.load('aaaaaaaaaaa', { autoplay: true })

    // 한 번에 하나다. 두 개가 되면 같은 스크립트를 두 번 받는다.
    expect(apiScripts()).toHaveLength(1)
    expect(log.errors).toHaveLength(1)
  })

  it('재시도가 성공하면 플레이어가 만들어진다 (M3-5)', async () => {
    const { log, events } = recorder()
    const adapter = new AdapterClass()
    adapter.mount(makeContainer(), events)
    adapter.load('aaaaaaaaaaa', { autoplay: true })
    await failApi()

    adapter.load('aaaaaaaaaaa', { autoplay: true })
    await arriveApi()

    expect(FakeYtPlayer.instances).toHaveLength(1)
    expect(lastPlayer().options.videoId).toBe('aaaaaaaaaaa')
    expect(log.errors).toHaveLength(1)
  })

  it('재시도도 실패하면 다시 알린다 (M3-5)', async () => {
    const { log, events } = recorder()
    const adapter = new AdapterClass()
    adapter.mount(makeContainer(), events)
    adapter.load('aaaaaaaaaaa')
    await failApi()

    adapter.load('aaaaaaaaaaa')
    await failApi()

    expect(log.errors).toEqual([
      { kind: 'api-unavailable', code: null },
      { kind: 'api-unavailable', code: null },
    ])
    expect(apiScripts()).toHaveLength(0)
  })

  it('실패 뒤 다른 어댑터가 요청해도 스크립트는 하나다 (M3-5)', async () => {
    const first = recorder()
    const adapter = new AdapterClass()
    adapter.mount(makeContainer(), first.events)
    adapter.load('aaaaaaaaaaa')
    await failApi()

    const second = recorder()
    const later = new AdapterClass()
    later.mount(makeContainer(), second.events)
    later.load('bbbbbbbbbbb')
    await flush()

    expect(apiScripts()).toHaveLength(1)
    // 아직 실패하지도 성공하지도 않았다. 매달린 것이 아니라 **진행 중**이다.
    expect(second.log.errors).toEqual([])

    await arriveApi()
    expect(FakeYtPlayer.instances.map((player) => player.options.videoId)).toEqual(['bbbbbbbbbbb'])
  })

  it('두 어댑터 모두 같은 API 도착 신호로 플레이어를 만든다', async () => {
    const first = new AdapterClass()
    const second = new AdapterClass()
    first.mount(makeContainer())
    second.mount(makeContainer())
    first.load('aaaaaaaaaaa')
    second.load('bbbbbbbbbbb')

    await arriveApi()

    expect(FakeYtPlayer.instances.map((player) => player.options.videoId)).toEqual([
      'aaaaaaaaaaa',
      'bbbbbbbbbbb',
    ])
  })
})

describe('B. 준비 전 요청의 보류와 1회 실행', () => {
  it('준비 전 load(autoplay) 는 준비 후 정확히 한 번 재생된다', async () => {
    const adapter = new AdapterClass()
    adapter.mount(makeContainer())

    adapter.load('aaaaaaaaaaa', { autoplay: true })
    await arriveApi()

    const player = lastPlayer()
    expect(player.options.videoId).toBe('aaaaaaaaaaa')
    expect(player.playCalls).toBe(0) // onReady 전에는 부르지 않는다

    player.fireReady()

    expect(player.playCalls).toBe(1)

    // 두 번째 onReady 가 와도 다시 재생하지 않는다 (보류는 비워졌다).
    player.fireReady()
    expect(player.playCalls).toBe(1)
  })

  it('준비 전 load() 를 여러 번 부르면 마지막 것만 남는다', async () => {
    const adapter = new AdapterClass()
    adapter.mount(makeContainer())

    adapter.load('aaaaaaaaaaa')
    adapter.load('bbbbbbbbbbb')
    adapter.load('ccccccccccc')
    await arriveApi()

    expect(FakeYtPlayer.instances).toHaveLength(1)
    expect(lastPlayer().options.videoId).toBe('ccccccccccc')
  })

  it('플레이어 생성 후 onReady 전에 들어온 load 는 onReady 에서 한 번 보낸다', async () => {
    const adapter = new AdapterClass()
    adapter.mount(makeContainer())
    adapter.load('aaaaaaaaaaa')
    await arriveApi()

    const player = lastPlayer()
    adapter.load('bbbbbbbbbbb', { autoplay: true })

    // 준비 전이므로 아직 아무 명령도 가지 않는다.
    expect(player.loadCalls).toEqual([])

    player.fireReady()

    expect(player.loadCalls).toEqual(['bbbbbbbbbbb'])
    expect(player.playCalls).toBe(0) // loadVideoById 가 재생까지 한다
    expect(FakeYtPlayer.instances).toHaveLength(1)
  })

  it('준비 전 play() 는 준비 후 한 번 재생한다', async () => {
    const adapter = new AdapterClass()
    adapter.mount(makeContainer())
    adapter.load('aaaaaaaaaaa')
    adapter.play()
    await arriveApi()

    const player = lastPlayer()
    player.fireReady()

    expect(player.playCalls).toBe(1)
  })

  it('준비 전 play() 뒤에 pause() 가 오면 준비 후 재생하지 않는다', async () => {
    const adapter = new AdapterClass()
    adapter.mount(makeContainer())
    adapter.load('aaaaaaaaaaa', { autoplay: true })
    adapter.play()
    adapter.pause()
    await arriveApi()

    const player = lastPlayer()
    player.fireReady()

    // 사용자가 멈춘 뒤 준비되는 순간 제멋대로 재생되면 안 된다.
    expect(player.playCalls).toBe(0)
    expect(player.cueCalls).toEqual([])
  })

  it('적재된 영상이 없으면 play() 가 아무 일도 하지 않는다', () => {
    const adapter = new AdapterClass()
    adapter.mount(makeContainer())

    adapter.play()

    expect(apiScripts()).toHaveLength(0)
    expect(adapter.state()).toBe('idle')
  })

  it('마운트되지 않은 어댑터는 load/play/pause 를 무시한다', () => {
    const adapter = new AdapterClass()

    expect(() => {
      adapter.load('aaaaaaaaaaa', { autoplay: true })
      adapter.play()
      adapter.pause()
    }).not.toThrow()
    expect(apiScripts()).toHaveLength(0)
    expect(adapter.state()).toBe('idle')
  })

  it('준비된 뒤의 명령은 플레이어에 바로 간다', async () => {
    const adapter = new AdapterClass()
    adapter.mount(makeContainer())
    adapter.load('aaaaaaaaaaa')
    await arriveApi()
    const player = lastPlayer()
    player.fireReady()

    adapter.play()
    adapter.pause()

    expect(player.playCalls).toBe(1)
    expect(player.pauseCalls).toBe(1)
  })
})

describe('C. 숫자 상태값 → 도메인 PlayerState 매핑', () => {
  /** 준비까지 끝낸 어댑터와 그 플레이어. */
  async function readyAdapter() {
    const { log, events } = recorder()
    const adapter = new AdapterClass()
    adapter.mount(makeContainer(), events)
    adapter.load('aaaaaaaaaaa')
    await arriveApi()
    const player = lastPlayer()
    player.fireReady()
    // 생성 시점의 'loading' 을 기록에서 비운다.
    log.states.length = 0
    return { adapter, player, log }
  }

  it('문서에 있는 여섯 값을 전수 매핑한다', async () => {
    const { adapter, player, log } = await readyAdapter()

    const cases: ReadonlyArray<readonly [number, PlayerState]> = [
      [1, 'playing'], // PLAYING
      [2, 'paused'], // PAUSED
      [3, 'loading'], // BUFFERING
      [0, 'ended'], // ENDED
      [-1, 'idle'], // UNSTARTED
      [1, 'playing'],
      [5, 'idle'], // CUED
    ]

    const seen: PlayerState[] = []
    for (const [code, expected] of cases) {
      player.fireStateChange(code)
      seen.push(adapter.state())
      expect(adapter.state()).toBe(expected)
    }

    expect(log.states).toEqual(seen)
  })

  it('문서에 없는 코드는 무시하고 마지막 상태를 유지한다', async () => {
    const { adapter, player, log } = await readyAdapter()
    player.fireStateChange(1)
    log.states.length = 0

    player.fireStateChange(42)
    player.fireStateChange(-99)

    // 추측해서 바꾸면 마지막으로 알던 상태까지 잃는다.
    expect(adapter.state()).toBe('playing')
    expect(log.states).toEqual([])
  })

  it('같은 상태를 두 번 알리지 않는다', async () => {
    const { player, log } = await readyAdapter()

    player.fireStateChange(1)
    player.fireStateChange(1)
    // CUED(5)와 UNSTARTED(-1)는 둘 다 idle 이라 한 번만 알린다.
    player.fireStateChange(5)
    player.fireStateChange(-1)

    expect(log.states).toEqual(['playing', 'idle'])
  })

  it('state() 는 YouTube 숫자값을 노출하지 않는다', async () => {
    const { adapter, player } = await readyAdapter()
    const domain: readonly PlayerState[] = [
      'idle',
      'loading',
      'playing',
      'paused',
      'ended',
      'error',
    ]

    const leaked: unknown[] = []
    for (const code of [-1, 0, 1, 2, 3, 5, 7]) {
      player.fireStateChange(code)
      const state: unknown = adapter.state()
      if (!domain.includes(state as PlayerState)) leaked.push(state)
    }

    expect(leaked).toEqual([])
  })

  it('플레이어를 만드는 동안은 loading 이다', async () => {
    const { log, events } = recorder()
    const adapter = new AdapterClass()
    adapter.mount(makeContainer(), events)

    adapter.load('aaaaaaaaaaa')
    await arriveApi()

    expect(adapter.state()).toBe('loading')
    expect(log.states).toEqual(['loading'])
  })
})

describe('D. 이벤트 전달', () => {
  async function subscribedAdapter() {
    const { log, events } = recorder()
    const adapter = new AdapterClass()
    adapter.mount(makeContainer(), events)
    adapter.load('aaaaaaaaaaa')
    await arriveApi()
    return { adapter, player: lastPlayer(), log }
  }

  it('onReady 를 ready 로 전달한다', async () => {
    const { player, log } = await subscribedAdapter()

    expect(log.ready).toBe(0)
    player.fireReady()

    expect(log.ready).toBe(1)
  })

  it('onStateChange 를 stateChange 로 전달한다', async () => {
    const { player, log } = await subscribedAdapter()
    player.fireReady()

    player.fireStateChange(1)

    expect(last(log.states)).toBe('playing')
  })

  it('onError 코드를 도메인 종류로 전수 변환한다', async () => {
    const cases: ReadonlyArray<readonly [number, string]> = [
      [2, 'invalid-parameter'],
      [5, 'not-playable'],
      [100, 'not-found'],
      [101, 'embed-not-allowed'],
      [150, 'embed-not-allowed'],
      [153, 'referrer-missing'],
      [999, 'unknown'],
    ]

    const seen: Array<readonly [number, string]> = []
    for (const [code] of cases) {
      const { player, log } = await subscribedAdapter()
      player.fireReady()
      player.fireError(code)
      seen.push([code, last(log.errors)?.kind ?? 'none'])
      expect(last(log.errors)?.code).toBe(code)
    }

    expect(seen).toEqual(cases)
  })

  it('오류는 stateChange("error") 뒤에 온다', async () => {
    const order: string[] = []
    const adapter = new AdapterClass()
    adapter.mount(makeContainer(), {
      stateChange: (state) => {
        order.push(`state:${state}`)
      },
      error: (info) => {
        order.push(`error:${info.kind}`)
      },
    })
    adapter.load('aaaaaaaaaaa')
    await arriveApi()
    const player = lastPlayer()
    player.fireReady()

    player.fireError(101)

    // 상태만 보는 구독자와 이유까지 보는 구독자가 같은 순서를 본다 (ADR 0008).
    expect(order).toEqual(['state:loading', 'state:error', 'error:embed-not-allowed'])
    expect(adapter.state()).toBe('error')
  })

  it('onAutoplayBlocked 를 전달하고 오류로 취급하지 않는다', async () => {
    const { adapter, player, log } = await subscribedAdapter()
    player.fireReady()
    player.fireStateChange(2)

    player.fireAutoplayBlocked()

    expect(log.autoplayBlocked).toBe(1)
    expect(log.errors).toEqual([])
    expect(adapter.state()).toBe('paused')
  })

  it('자동재생이 차단되면 낙관적 loading 을 idle 로 되돌린다 (M3-5)', async () => {
    const { log, events } = recorder()
    const adapter = new AdapterClass()
    adapter.mount(makeContainer(), events)
    adapter.load('aaaaaaaaaaa', { autoplay: true })
    await arriveApi()
    // 플레이어를 만들며 우리가 세운 상태다. 아직 YouTube 는 아무 말도 안 했다.
    expect(adapter.state()).toBe('loading')

    lastPlayer().fireAutoplayBlocked()

    /*
     * 그대로 두면 토글이 ⏸ 를 보여주고 누르면 "멈춤" 이 되어, 사용자가
     * 재생을 다시 요청할 수 없다. CUED(5) 와 같은 idle 로 되돌린다.
     */
    expect(adapter.state()).toBe('idle')
    expect(log.states).toEqual(['loading', 'idle'])
    expect(log.errors).toEqual([])
  })

  it('YouTube 가 이미 알려준 상태는 자동재생 차단이 건드리지 않는다 (M3-5)', async () => {
    const { adapter, player } = await subscribedAdapter()
    player.fireReady()
    player.fireStateChange(1)

    player.fireAutoplayBlocked()

    expect(adapter.state()).toBe('playing')
  })

  it('자동재생이 차단되면 보류한 재생 의도를 버린다', async () => {
    const adapter = new AdapterClass()
    adapter.mount(makeContainer())
    adapter.load('aaaaaaaaaaa', { autoplay: true })
    await arriveApi()
    const player = lastPlayer()

    player.fireAutoplayBlocked()
    player.fireReady()

    expect(player.playCalls).toBe(0)
  })

  it('API 스크립트 로드 실패를 api-unavailable 로 전달한다', async () => {
    const { log, events } = recorder()
    const adapter = new AdapterClass()
    adapter.mount(makeContainer(), events)
    adapter.load('aaaaaaaaaaa', { autoplay: true })

    await failApi()

    expect(log.errors).toEqual([{ kind: 'api-unavailable', code: null }])
    expect(log.states).toEqual(['error'])
    expect(adapter.state()).toBe('error')
    expect(FakeYtPlayer.instances).toHaveLength(0)
  })

  it('핸들러를 주지 않아도 사건 처리가 던지지 않는다', async () => {
    const adapter = new AdapterClass()
    adapter.mount(makeContainer())
    adapter.load('aaaaaaaaaaa')
    await arriveApi()
    const player = lastPlayer()

    expect(() => {
      player.fireReady()
      player.fireStateChange(1)
      player.fireError(100)
      player.fireAutoplayBlocked()
    }).not.toThrow()
  })
})

describe('E. 수명주기와 DOM 소유권', () => {
  it('중복 mount() 는 두 번째 노드를 만들지 않는다', () => {
    const adapter = new AdapterClass()
    const container = makeContainer()

    adapter.mount(container)
    const first = container.firstElementChild
    adapter.mount(container)

    expect(container.children).toHaveLength(1)
    expect(container.firstElementChild).toBe(first)
  })

  it('중복 destroy() 는 던지지 않는다', () => {
    const adapter = new AdapterClass()

    expect(() => {
      adapter.destroy()
    }).not.toThrow()

    adapter.mount(makeContainer())
    adapter.destroy()

    expect(() => {
      adapter.destroy()
    }).not.toThrow()
  })

  it('destroy() 후 다시 mount() 할 수 있다', async () => {
    const adapter = new AdapterClass()
    const container = makeContainer()

    adapter.mount(container)
    adapter.load('aaaaaaaaaaa')
    await arriveApi()
    adapter.destroy()
    expect(container.children).toHaveLength(0)

    adapter.mount(container)
    adapter.load('bbbbbbbbbbb')
    await flush()

    expect(container.children).toHaveLength(1)
    expect(FakeYtPlayer.instances).toHaveLength(2)
  })

  it('YT.Player 가 자식을 iframe 으로 바꿔도 어댑터의 안정 노드는 남는다', async () => {
    const adapter = new AdapterClass()
    const container = makeContainer()
    adapter.mount(container)
    const host = container.firstElementChild

    adapter.load('aaaaaaaaaaa')
    await arriveApi()

    // container(Vue 소유)의 자식은 여전히 하나이고 같은 노드다.
    expect(container.children).toHaveLength(1)
    expect(container.firstElementChild).toBe(host)
    // iframe 은 그 안에 들어간다.
    expect(host?.firstElementChild?.tagName).toBe('IFRAME')
  })

  it('destroy() 가 player.destroy() 를 부르고 자기 노드를 지운다', async () => {
    const adapter = new AdapterClass()
    const container = makeContainer()
    adapter.mount(container)
    adapter.load('aaaaaaaaaaa')
    await arriveApi()
    const player = lastPlayer()

    adapter.destroy()

    expect(player.destroyCalls).toBe(1)
    expect(container.children).toHaveLength(0)
    expect(adapter.state()).toBe('idle')
  })

  it('player.destroy() 가 던져도 정리를 끝낸다', async () => {
    const adapter = new AdapterClass()
    const container = makeContainer()
    adapter.mount(container)
    adapter.load('aaaaaaaaaaa')
    await arriveApi()
    const player = lastPlayer()
    player.destroy = () => {
      throw new Error('iframe 이 이미 사라졌다')
    }

    expect(() => {
      adapter.destroy()
    }).not.toThrow()
    expect(container.children).toHaveLength(0)
  })

  it('곡을 바꿔도 플레이어를 재생성하지 않는다', async () => {
    const adapter = new AdapterClass()
    adapter.mount(makeContainer())
    adapter.load('aaaaaaaaaaa')
    await arriveApi()
    const player = lastPlayer()
    player.fireReady()

    adapter.load('bbbbbbbbbbb', { autoplay: true })
    adapter.load('ccccccccccc')

    expect(FakeYtPlayer.instances).toHaveLength(1)
    expect(player.loadCalls).toEqual(['bbbbbbbbbbb'])
    expect(player.cueCalls).toEqual(['ccccccccccc'])
  })

  it('autoplay 생략은 cueVideoById 다', async () => {
    const adapter = new AdapterClass()
    adapter.mount(makeContainer())
    adapter.load('aaaaaaaaaaa')
    await arriveApi()
    const player = lastPlayer()
    player.fireReady()

    adapter.load('bbbbbbbbbbb')
    adapter.load('ccccccccccc', { autoplay: false })

    expect(player.cueCalls).toEqual(['bbbbbbbbbbb', 'ccccccccccc'])
    expect(player.loadCalls).toEqual([])
  })
})

describe('F. 언마운트 후 도착한 비동기 콜백', () => {
  it('destroy() 후 API 가 와도 플레이어를 만들지 않는다', async () => {
    const { log, events } = recorder()
    const adapter = new AdapterClass()
    adapter.mount(makeContainer(), events)
    adapter.load('aaaaaaaaaaa', { autoplay: true })

    adapter.destroy()
    await arriveApi()

    expect(FakeYtPlayer.instances).toHaveLength(0)
    expect(log.states).toEqual([])
  })

  it('destroy() 후 API 로드 실패가 와도 오류를 올리지 않는다', async () => {
    const { log, events } = recorder()
    const adapter = new AdapterClass()
    adapter.mount(makeContainer(), events)
    adapter.load('aaaaaaaaaaa')

    adapter.destroy()
    await failApi()

    expect(log.errors).toEqual([])
  })

  it('destroy() 후 도착한 플레이어 콜백은 사건을 올리지 않는다', async () => {
    const { log, events } = recorder()
    const adapter = new AdapterClass()
    adapter.mount(makeContainer(), events)
    adapter.load('aaaaaaaaaaa')
    await arriveApi()
    const player = lastPlayer()
    player.fireReady()
    log.states.length = 0
    log.ready = 0

    adapter.destroy()
    player.fireReady()
    player.fireStateChange(1)
    player.fireError(100)
    player.fireAutoplayBlocked()

    expect(log).toEqual({ ready: 0, states: [], errors: [], autoplayBlocked: 0 })
  })

  it('다시 마운트한 뒤에는 이전 세대의 콜백이 새 구독자에 닿지 않는다', async () => {
    const adapter = new AdapterClass()
    const container = makeContainer()
    adapter.mount(container)
    adapter.load('aaaaaaaaaaa')
    await arriveApi()
    const stale = lastPlayer()
    adapter.destroy()

    const { log, events } = recorder()
    adapter.mount(container, events)

    stale.fireStateChange(1)

    expect(log.states).toEqual([])
  })
})

describe('G. playerVars 와 origin', () => {
  async function createdOptions(): Promise<YouTubePlayerOptions> {
    const adapter = new AdapterClass()
    adapter.mount(makeContainer())
    adapter.load('aaaaaaaaaaa')
    await arriveApi()
    return lastPlayer().options
  }

  it('MVP_SPEC F3 의 playerVars 를 그대로 넘긴다', async () => {
    const options = await createdOptions()

    expect(options.playerVars).toMatchObject({
      controls: 1,
      playsinline: 1,
      rel: 0,
      autoplay: 0,
    })
  })

  it('origin 에 현재 페이지의 origin 을 넣는다', async () => {
    const options = await createdOptions()

    // 상수로 박으면 dev · LAN IP · 배포 도메인에서 전부 틀린다 (M3-0.5).
    expect(options.playerVars?.origin).toBe(window.location.origin)
  })

  it('영역을 꽉 채우는 크기로 만든다', async () => {
    const options = await createdOptions()

    expect(options.width).toBe('100%')
    expect(options.height).toBe('100%')
  })
})

/* ================================================================== *
 * H. 시점 조회와 이동 (M9-3, ADR 0020)
 * ================================================================== */

describe('H. position() · seek() · load({ startSeconds })', () => {
  /** 마운트 → load → API 도착 → onReady 까지 한 번에. */
  async function readyAdapter(videoId = 'aaaaaaaaaaa') {
    const adapter = new AdapterClass()
    adapter.mount(makeContainer())
    adapter.load(videoId)
    await arriveApi()
    const player = lastPlayer()
    player.fireReady()
    return { adapter, player }
  }

  describe('position()', () => {
    it('마운트만 한 어댑터는 null 이다 — 0 이 아니다', () => {
      const adapter = new AdapterClass()
      adapter.mount(makeContainer())

      expect(adapter.position()).toBeNull()
    })

    it('API 가 오기 전에는 null 이다', () => {
      const adapter = new AdapterClass()
      adapter.mount(makeContainer())
      adapter.load('aaaaaaaaaaa')

      expect(adapter.position()).toBeNull()
    })

    it('플레이어가 생겼지만 onReady 전이면 null 이다', async () => {
      const adapter = new AdapterClass()
      adapter.mount(makeContainer())
      adapter.load('aaaaaaaaaaa')
      await arriveApi()
      // 플레이어가 이미 값을 보고하고 있어도 준비 전에는 믿지 않는다.
      lastPlayer().deliver('aaaaaaaaaaa', 12)

      expect(adapter.position()).toBeNull()
    })

    it('준비된 뒤 플레이어가 0 을 보고하면 0 이다 — null 과 구분된다', async () => {
      const { adapter, player } = await readyAdapter()
      player.deliver('aaaaaaaaaaa', 0)

      expect(adapter.position()).toBe(0)
    })

    it('소수 초를 그대로 전한다 — 내림은 도메인의 일이다', async () => {
      const { adapter, player } = await readyAdapter()
      player.deliver('aaaaaaaaaaa', 83.4)

      expect(adapter.position()).toBe(83.4)
    })

    it.each([
      ['undefined', undefined],
      ['NaN', Number.NaN],
      ['Infinity', Number.POSITIVE_INFINITY],
      ['음수', -1],
    ])('플레이어가 %s 를 주면 null 이다', async (_label, time) => {
      const { adapter, player } = await readyAdapter()
      player.deliver('aaaaaaaaaaa', time)

      expect(adapter.position()).toBeNull()
    })

    it('플레이어가 아직 이전 영상을 보고하면 null 이다 — 전환 직후의 창', async () => {
      const { adapter, player } = await readyAdapter('aaaaaaaaaaa')
      player.deliver('aaaaaaaaaaa', 83)
      expect(adapter.position()).toBe(83)

      adapter.load('bbbbbbbbbbb', { autoplay: true })

      // 캐시는 아직 A 의 83초다. 그것을 B 의 위치로 내보내지 않는다.
      expect(adapter.position()).toBeNull()

      player.deliver('bbbbbbbbbbb', 0)
      expect(adapter.position()).toBe(0)
    })

    it('cue 로 바꾼 영상도 같은 규칙이다', async () => {
      const { adapter, player } = await readyAdapter('aaaaaaaaaaa')
      player.deliver('aaaaaaaaaaa', 40)

      adapter.load('bbbbbbbbbbb')

      expect(adapter.position()).toBeNull()
      player.deliver('bbbbbbbbbbb', 5)
      expect(adapter.position()).toBe(5)
    })

    it('적재된 영상이 없다고 보고하면 null 이다', async () => {
      const { adapter, player } = await readyAdapter()
      player.deliver(null, 0)

      expect(adapter.position()).toBeNull()
    })

    it('플레이어가 질의에 던지면 null 이다', async () => {
      const { adapter, player } = await readyAdapter()
      player.deliver('aaaaaaaaaaa', 10)
      player.throwOnQuery = true

      expect(adapter.position()).toBeNull()
    })

    it('destroy 뒤에는 null 이다', async () => {
      const { adapter, player } = await readyAdapter()
      player.deliver('aaaaaaaaaaa', 10)

      adapter.destroy()

      expect(adapter.position()).toBeNull()
    })
  })

  describe('seek()', () => {
    it('준비된 플레이어에 seekTo(초, true) 를 보낸다', async () => {
      const { adapter, player } = await readyAdapter()

      adapter.seek(83)

      expect(player.seekCalls).toEqual([{ seconds: 83, allowSeekAhead: true }])
    })

    it('0 초로도 간다', async () => {
      const { adapter, player } = await readyAdapter()

      adapter.seek(0)

      expect(player.seekCalls).toEqual([{ seconds: 0, allowSeekAhead: true }])
    })

    it('소수 초를 그대로 보낸다', async () => {
      const { adapter, player } = await readyAdapter()

      adapter.seek(12.5)

      expect(player.seekCalls[0]?.seconds).toBe(12.5)
    })

    it.each([
      ['음수', -1],
      ['NaN', Number.NaN],
      ['Infinity', Number.POSITIVE_INFINITY],
    ])('%s 는 조용히 적용하지 않는다', async (_label, seconds) => {
      const { adapter, player } = await readyAdapter()

      adapter.seek(seconds)

      expect(player.seekCalls).toEqual([])
    })

    it('준비 전 seek 은 버린다 — 보류하지 않는다', async () => {
      const adapter = new AdapterClass()
      adapter.mount(makeContainer())
      adapter.load('aaaaaaaaaaa')
      await arriveApi()
      const player = lastPlayer()

      adapter.seek(30)
      player.fireReady()

      // 준비된 뒤에도 보류했던 seek 이 튀어나오지 않는다.
      expect(player.seekCalls).toEqual([])
    })

    it('마운트되지 않은 어댑터의 seek 은 던지지 않고 무시한다', () => {
      const adapter = new AdapterClass()

      expect(() => adapter.seek(10)).not.toThrow()
    })

    it('seek 은 플레이어도 iframe 도 다시 만들지 않는다 (ADR 0002)', async () => {
      const { adapter, player } = await readyAdapter()
      const iframe = player.iframe

      adapter.seek(10)
      adapter.seek(20)
      adapter.seek(30)

      expect(FakeYtPlayer.instances).toHaveLength(1)
      expect(player.iframe).toBe(iframe)
      expect(iframe.isConnected).toBe(true)
      expect(player.destroyCalls).toBe(0)
    })

    it('seek 뒤의 재생 상태는 플레이어가 정한다 — 어댑터가 꾸미지 않는다', async () => {
      const { adapter, player } = await readyAdapter()
      player.fireStateChange(2) // PAUSED

      adapter.seek(10)

      // seekTo 만 보낸다. 상태는 YouTube 가 알려줄 때까지 그대로다.
      expect(adapter.state()).toBe('paused')
      expect(player.playCalls).toBe(0)
    })

    it('destroy 뒤의 seek 은 무시한다', async () => {
      const { adapter, player } = await readyAdapter()

      adapter.destroy()
      adapter.seek(10)

      expect(player.seekCalls).toEqual([])
    })
  })

  describe('load({ startSeconds })', () => {
    it('준비된 플레이어에는 객체 인자로 시점을 싣는다 — 별도 seek 이 없다', async () => {
      const { adapter, player } = await readyAdapter()

      adapter.load('bbbbbbbbbbb', { autoplay: true, startSeconds: 83 })

      expect(player.loadCalls).toEqual([{ videoId: 'bbbbbbbbbbb', startSeconds: 83 }])
      expect(player.seekCalls).toEqual([])
    })

    it('cue 에도 시점을 싣는다', async () => {
      const { adapter, player } = await readyAdapter()

      adapter.load('bbbbbbbbbbb', { startSeconds: 45 })

      expect(player.cueCalls).toEqual([{ videoId: 'bbbbbbbbbbb', startSeconds: 45 }])
    })

    it('0 초도 싣는다 — 없는 것과 다르다', async () => {
      const { adapter, player } = await readyAdapter()

      adapter.load('bbbbbbbbbbb', { autoplay: true, startSeconds: 0 })

      expect(player.loadCalls).toEqual([{ videoId: 'bbbbbbbbbbb', startSeconds: 0 }])
    })

    it('시점이 없으면 M3-1 과 같은 문자열 인자다', async () => {
      const { adapter, player } = await readyAdapter()

      adapter.load('bbbbbbbbbbb', { autoplay: true })

      expect(player.loadCalls).toEqual(['bbbbbbbbbbb'])
    })

    it.each([
      ['음수', -5],
      ['NaN', Number.NaN],
      ['Infinity', Number.POSITIVE_INFINITY],
    ])('유효하지 않은 시점(%s)은 없는 것으로 보고 처음부터 적재한다', async (_label, start) => {
      const { adapter, player } = await readyAdapter()

      adapter.load('bbbbbbbbbbb', { autoplay: true, startSeconds: start })

      expect(player.loadCalls).toEqual(['bbbbbbbbbbb'])
    })

    it('API 도착 전 요청의 시점은 첫 플레이어의 start 파라미터로 보존된다', async () => {
      const adapter = new AdapterClass()
      adapter.mount(makeContainer())

      adapter.load('aaaaaaaaaaa', { autoplay: true, startSeconds: 83.9 })
      await arriveApi()

      const player = lastPlayer()
      expect(player.options.videoId).toBe('aaaaaaaaaaa')
      // 공식 파라미터는 정수다.
      expect(player.options.playerVars?.start).toBe(83)

      player.fireReady()
      // 첫 영상은 생성자가 이미 적재했다. 재생만 보내고 다시 적재하지 않는다.
      expect(player.playCalls).toBe(1)
      expect(player.loadCalls).toEqual([])
      expect(player.seekCalls).toEqual([])
    })

    it('시점 없는 첫 요청에는 start 파라미터가 없다', async () => {
      const adapter = new AdapterClass()
      adapter.mount(makeContainer())
      adapter.load('aaaaaaaaaaa')
      await arriveApi()

      expect(lastPlayer().options.playerVars).not.toHaveProperty('start')
    })

    it('플레이어 생성 후 onReady 전 요청의 시점은 onReady 에서 함께 간다', async () => {
      const adapter = new AdapterClass()
      adapter.mount(makeContainer())
      adapter.load('aaaaaaaaaaa')
      await arriveApi()
      const player = lastPlayer()

      adapter.load('bbbbbbbbbbb', { autoplay: true, startSeconds: 30 })
      expect(player.loadCalls).toEqual([])

      player.fireReady()

      expect(player.loadCalls).toEqual([{ videoId: 'bbbbbbbbbbb', startSeconds: 30 }])
      expect(player.seekCalls).toEqual([])
    })

    it('준비 전 연속 요청은 마지막 요청의 시점만 남긴다', async () => {
      const adapter = new AdapterClass()
      adapter.mount(makeContainer())
      adapter.load('aaaaaaaaaaa')
      await arriveApi()
      const player = lastPlayer()

      adapter.load('bbbbbbbbbbb', { autoplay: true, startSeconds: 30 })
      adapter.load('ccccccccccc', { autoplay: true })

      player.fireReady()

      // B 의 30초가 C 에 묻어가지 않는다.
      expect(player.loadCalls).toEqual(['ccccccccccc'])
    })

    it('준비 전 요청을 pause 로 취소해도 시점은 cue 에 남는다', async () => {
      const adapter = new AdapterClass()
      adapter.mount(makeContainer())
      adapter.load('aaaaaaaaaaa')
      await arriveApi()
      const player = lastPlayer()

      adapter.load('bbbbbbbbbbb', { autoplay: true, startSeconds: 30 })
      adapter.pause()
      player.fireReady()

      // 재생 의도만 취소된다. 어느 영상의 어느 시점인지는 그대로다.
      expect(player.cueCalls).toEqual([{ videoId: 'bbbbbbbbbbb', startSeconds: 30 }])
      expect(player.playCalls).toBe(0)
    })

    it('빠른 연속 load 와 seek 은 순서대로 플레이어에 간다', async () => {
      const { adapter, player } = await readyAdapter()

      adapter.load('bbbbbbbbbbb', { autoplay: true, startSeconds: 10 })
      adapter.seek(20)
      adapter.load('ccccccccccc', { autoplay: true, startSeconds: 30 })

      expect(player.loadCalls).toEqual([
        { videoId: 'bbbbbbbbbbb', startSeconds: 10 },
        { videoId: 'ccccccccccc', startSeconds: 30 },
      ])
      expect(player.seekCalls).toEqual([{ seconds: 20, allowSeekAhead: true }])
      expect(FakeYtPlayer.instances).toHaveLength(1)
    })

    it('destroy 뒤에 도착한 onReady 는 보류한 시점을 흘려보내지 않는다', async () => {
      const adapter = new AdapterClass()
      adapter.mount(makeContainer())
      adapter.load('aaaaaaaaaaa')
      await arriveApi()
      const player = lastPlayer()
      adapter.load('bbbbbbbbbbb', { autoplay: true, startSeconds: 30 })

      adapter.destroy()
      player.fireReady()

      expect(player.loadCalls).toEqual([])
      expect(player.playCalls).toBe(0)
    })
  })
})

/* ================================================================== *
 * I. Fake 와 실제 어댑터의 계약 일치 (M9-3)
 * ================================================================== */

describe('I. FakePlayerAdapter 와 같은 관찰 결과를 낸다', () => {
  it('둘 다 준비 전 position() 은 null 이다', async () => {
    const real = new AdapterClass()
    real.mount(makeContainer())
    real.load('aaaaaaaaaaa')
    await arriveApi()

    const fake = new FakePlayerAdapter()
    fake.mount(makeContainer())
    fake.load('aaaaaaaaaaa')

    expect(real.position()).toBeNull()
    expect(fake.position()).toBeNull()
  })

  it('둘 다 준비된 뒤 보고가 와야 숫자를 준다', async () => {
    const real = new AdapterClass()
    real.mount(makeContainer())
    real.load('aaaaaaaaaaa')
    await arriveApi()
    const player = lastPlayer()
    player.fireReady()

    const fake = new FakePlayerAdapter()
    fake.mount(makeContainer())
    fake.load('aaaaaaaaaaa')
    fake.emitReady()

    // 준비됐지만 아직 보고가 없다.
    expect(real.position()).toBeNull()
    expect(fake.position()).toBeNull()

    player.deliver('aaaaaaaaaaa', 42.5)
    fake.emitPosition(42.5)

    expect(real.position()).toBe(42.5)
    expect(fake.position()).toBe(42.5)
  })

  it('둘 다 새 영상을 적재하면 보고가 올 때까지 위치를 모른다', async () => {
    const real = new AdapterClass()
    real.mount(makeContainer())
    real.load('aaaaaaaaaaa')
    await arriveApi()
    const player = lastPlayer()
    player.fireReady()
    player.deliver('aaaaaaaaaaa', 42)

    const fake = new FakePlayerAdapter()
    fake.mount(makeContainer())
    fake.load('aaaaaaaaaaa')
    fake.emitReady()
    fake.emitPosition(42)

    real.load('bbbbbbbbbbb', { autoplay: true })
    fake.load('bbbbbbbbbbb', { autoplay: true })

    expect(real.position()).toBeNull()
    expect(fake.position()).toBeNull()
  })

  it.each([
    ['음수', -1],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
  ])('둘 다 %s seek 을 적용하지 않는다', async (_label, seconds) => {
    const real = new AdapterClass()
    real.mount(makeContainer())
    real.load('aaaaaaaaaaa')
    await arriveApi()
    const player = lastPlayer()
    player.fireReady()

    const fake = new FakePlayerAdapter()
    fake.mount(makeContainer())
    fake.load('aaaaaaaaaaa')
    fake.emitReady()

    real.seek(seconds)
    fake.seek(seconds)

    expect(player.seekCalls).toEqual([])
    expect(fake.calls.seek).toEqual([])
    expect(fake.calls.seekDropped).toEqual([seconds])
  })

  it('둘 다 준비 전 seek 을 버린다', async () => {
    const real = new AdapterClass()
    real.mount(makeContainer())
    real.load('aaaaaaaaaaa')
    await arriveApi()
    const player = lastPlayer()

    const fake = new FakePlayerAdapter()
    fake.mount(makeContainer())
    fake.load('aaaaaaaaaaa')

    real.seek(10)
    fake.seek(10)
    player.fireReady()
    fake.emitReady()

    expect(player.seekCalls).toEqual([])
    expect(fake.calls.seek).toEqual([])
  })

  it('둘 다 유효하지 않은 startSeconds 를 시점 없는 적재로 보낸다', async () => {
    const real = new AdapterClass()
    real.mount(makeContainer())
    real.load('aaaaaaaaaaa')
    await arriveApi()
    const player = lastPlayer()
    player.fireReady()

    const fake = new FakePlayerAdapter()
    fake.mount(makeContainer())

    real.load('bbbbbbbbbbb', { autoplay: true, startSeconds: -3 })
    fake.load('bbbbbbbbbbb', { autoplay: true, startSeconds: -3 })

    expect(player.loadCalls).toEqual(['bbbbbbbbbbb'])
    expect(fake.calls.load).toEqual([{ videoId: 'bbbbbbbbbbb', autoplay: true }])
    expect(fake.calls.load[0]).not.toHaveProperty('startSeconds')
  })

  it('둘 다 seek 만으로 재생 상태를 꾸미지 않는다', async () => {
    const real = new AdapterClass()
    real.mount(makeContainer())
    real.load('aaaaaaaaaaa')
    await arriveApi()
    const player = lastPlayer()
    player.fireReady()
    player.fireStateChange(2)

    const fake = new FakePlayerAdapter()
    fake.mount(makeContainer())
    fake.load('aaaaaaaaaaa')
    fake.emitReady()
    fake.emitStateChange('paused')

    real.seek(10)
    fake.seek(10)

    expect(real.state()).toBe('paused')
    expect(fake.state()).toBe('paused')
  })
})
