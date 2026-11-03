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

import type { PlayerAdapterEvents, PlayerErrorInfo } from '@/features/playback/PlayerAdapter'
import type { YouTubeIFramePlayerAdapter } from '@/features/playback/YouTubeIFramePlayerAdapter'
import type { YouTubePlayer, YouTubePlayerOptions } from '@/features/playback/youtubeIframeApi'
import type { PlayerState } from '@/shared/types'

const API_SRC = 'https://www.youtube.com/iframe_api'

/** 가짜 `YT.Player`. 실제 API 처럼 넘겨받은 요소를 iframe 으로 교체한다. */
class FakeYtPlayer implements YouTubePlayer {
  static instances: FakeYtPlayer[] = []

  readonly options: YouTubePlayerOptions
  readonly iframe: HTMLElement
  readonly loadCalls: string[] = []
  readonly cueCalls: string[] = []
  playCalls = 0
  pauseCalls = 0
  destroyCalls = 0

  constructor(host: HTMLElement, options: YouTubePlayerOptions) {
    this.options = options
    FakeYtPlayer.instances.push(this)

    const iframe = host.ownerDocument.createElement('iframe')
    host.replaceWith(iframe)
    this.iframe = iframe
  }

  loadVideoById(videoId: string): void {
    this.loadCalls.push(videoId)
  }

  cueVideoById(videoId: string): void {
    this.cueCalls.push(videoId)
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

  it('로드가 한 번 실패하면 다음 요청도 즉시 실패로 끝난다', async () => {
    const first = recorder()
    const adapter = new AdapterClass()
    adapter.mount(makeContainer(), first.events)
    adapter.load('aaaaaaaaaaa')

    await failApi()
    expect(first.log.errors).toHaveLength(1)

    // 두 번째 요청. 실패한 <script> 는 error 를 다시 쏘지 않는다. 로더가
    // 결과(실패까지)를 담아두지 않으면 이 요청은 조용히 영원히 매달린다 —
    // 사용자에게는 "준비 중" 이 끝나지 않는 화면으로 보인다.
    const second = recorder()
    const later = new AdapterClass()
    later.mount(makeContainer(), second.events)
    later.load('bbbbbbbbbbb')
    await flush()

    expect(second.log.errors).toEqual([{ kind: 'api-unavailable', code: null }])
    expect(apiScripts()).toHaveLength(1)
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
