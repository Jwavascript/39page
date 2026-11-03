/**
 * 테스트·개발용 `PlayerAdapter` 구현체.
 *
 * 실제 YouTube API 없이 **수명주기와 DOM 소유 구조**를 검증한다.
 * 호출을 기록하는 목(mock)이 아니라 계약을 실제로 구현한다. 실제 어댑터
 * (`YouTubeIFramePlayerAdapter`)와 같은 계약을 쓰므로 인터페이스가 갈라지지
 * 않는다.
 *
 * ⚠️ 영상을 재생하지 않는다. 사용자에게 실제 재생이 가능한 것처럼 보이는
 * 요소를 만들지 않는다. 생성하는 노드는 보이지 않는 빈 노드다.
 * 앱 코드에서 주입하지 않으며, 테스트에서만 주입한다.
 *
 * **명령은 상태를 바꾸지 않는다.** `play()` / `pause()` 는 호출만 기록한다.
 * 실제 어댑터도 그렇다 — 재생 상태는 외부 플레이어가 `onStateChange` 로
 * 알려주는 것이지 명령의 동기적 결과가 아니다. 테스트가 그 틈을 재현할 수
 * 있도록 `emit*` 함수를 따로 둔다.
 *
 * 예외는 `load()` 다. 실제 어댑터는 `YT.Player` 를 만들면서 `loading` 을
 * 알리므로, Fake 도 그 자리에서 알린다. 이 한 가지가 어긋나면 "재생을
 * 눌렀는데 버튼이 아직 ▶ 다" 같은 차이가 테스트에만 생긴다.
 */
import type { PlayerState } from '@/shared/types'

import type {
  PlayerAdapter,
  PlayerAdapterEvents,
  PlayerErrorInfo,
  PlayerLoadOptions,
} from './PlayerAdapter'

/** `load()` 에 들어온 한 번의 요청. */
export interface FakeLoadCall {
  videoId: string
  /** `load()` 가 받은 자동재생 의도. 생략됐으면 `false` 다. */
  autoplay: boolean
}

/** 어댑터에 들어온 호출 기록. */
export interface FakePlayerAdapterCalls {
  /** `mount()` **호출 횟수**. no-op으로 무시된 호출도 센다. */
  mount: number
  /** `destroy()` 호출 횟수. */
  destroy: number
  /** `load()`에 들어온 요청 목록. */
  load: FakeLoadCall[]
  play: number
  pause: number
}

export class FakePlayerAdapter implements PlayerAdapter {
  readonly calls: FakePlayerAdapterCalls = {
    mount: 0,
    destroy: 0,
    load: [],
    play: 0,
    pause: 0,
  }

  /** `mount()`에 들어온 컨테이너. 같은 호스트를 쓰는지 검증한다. */
  container: HTMLElement | null = null

  /** 어댑터가 만들어 소유하는 자식 노드. */
  hostNode: HTMLElement | null = null

  /** `mount()` 로 받은 핸들러. 주지 않았으면 `null` 이다. */
  events: PlayerAdapterEvents | null = null

  private currentState: PlayerState = 'idle'

  mount(container: HTMLElement, events?: PlayerAdapterEvents): void {
    this.calls.mount += 1

    // 중복 호출은 no-op. 두 번째 노드를 만들지 않고 핸들러도 바꾸지 않는다.
    if (this.hostNode !== null) return

    const host = container.ownerDocument.createElement('div')
    host.dataset.fakePlayerHost = 'true'
    container.append(host)

    this.container = container
    this.hostNode = host
    this.events = events ?? null
  }

  destroy(): void {
    this.calls.destroy += 1

    // 마운트되지 않았으면 no-op.
    if (this.hostNode === null) return

    this.hostNode.remove()
    this.hostNode = null
    this.container = null
    this.events = null
    this.currentState = 'idle'
  }

  load(videoId: string, options?: PlayerLoadOptions): void {
    this.calls.load.push({ videoId, autoplay: options?.autoplay === true })
    // 실제 어댑터가 플레이어를 만들며 알리는 것과 같다.
    this.emitStateChange('loading')
  }

  play(): void {
    this.calls.play += 1
  }

  pause(): void {
    this.calls.pause += 1
  }

  state(): PlayerState {
    return this.currentState
  }

  /** 마운트되어 있는지. 테스트 가독성을 위한 편의 속성이다. */
  get isMounted(): boolean {
    return this.hostNode !== null
  }

  // ── 테스트가 외부 플레이어 역할을 하도록 하는 함수들 ──────────────────

  emitReady(): void {
    this.events?.ready?.()
  }

  /** 상태를 바꾸고 알린다. 바뀌지 않으면 알리지 않는다 (실제 어댑터와 같다). */
  emitStateChange(state: PlayerState): void {
    if (state === this.currentState) return
    this.currentState = state
    this.events?.stateChange?.(state)
  }

  /** `stateChange('error')` 를 먼저, `error(info)` 를 나중에 (ADR 0008). */
  emitError(info: PlayerErrorInfo): void {
    this.emitStateChange('error')
    this.events?.error?.(info)
  }

  emitAutoplayBlocked(): void {
    this.events?.autoplayBlocked?.()
  }
}
