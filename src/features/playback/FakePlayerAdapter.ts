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
 *
 * **위치도 명령의 결과가 아니다** (M9-3). `seek()` 은 호출만 기록하고
 * `position()` 을 바꾸지 않는다. 실제 플레이어도 `seekTo` 뒤에 iframe 이
 * 새 값을 보내오기 전까지는 옛 값을 돌려준다. 위치는 테스트가
 * `emitPosition()` 으로 "플레이어가 보고했다" 를 재현할 때만 생긴다.
 * 실제 어댑터의 세 규칙을 그대로 따른다 — 준비 전엔 `null`, 적재 명령 뒤
 * 새 보고가 오기 전엔 `null`, 유효하지 않은 보고는 `null`.
 */
import type { PlayerState } from '@/shared/types'

import {
  isValidPlayerSeconds,
  type PlayerAdapter,
  type PlayerAdapterEvents,
  type PlayerErrorInfo,
  type PlayerLoadOptions,
} from './PlayerAdapter'

/** `load()` 에 들어온 한 번의 요청. */
export interface FakeLoadCall {
  videoId: string
  /** `load()` 가 받은 자동재생 의도. 생략됐으면 `false` 다. */
  autoplay: boolean
  /**
   * `load()` 가 받은 **유효한** 시작 시점 (M9-3). 없거나 유효하지 않으면
   * 이 키 자체가 없다 — 실제 어댑터가 그 요청을 시점 없는 적재로 보내는 것과
   * 같다.
   */
  startSeconds?: number
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
  /** 플레이어에 **실제로 전달된** `seek()` 의 초 (M9-3). */
  seek: number[]
  /**
   * 버린 `seek()` 의 초 (M9-3). 유효하지 않은 값이거나 준비 전이었다 —
   * 실제 어댑터가 `seekTo` 를 부르지 않는 바로 그 경우다.
   */
  seekDropped: number[]
}

export class FakePlayerAdapter implements PlayerAdapter {
  readonly calls: FakePlayerAdapterCalls = {
    mount: 0,
    destroy: 0,
    load: [],
    play: 0,
    pause: 0,
    seek: [],
    seekDropped: [],
  }

  /** `mount()`에 들어온 컨테이너. 같은 호스트를 쓰는지 검증한다. */
  container: HTMLElement | null = null

  /** 어댑터가 만들어 소유하는 자식 노드. */
  hostNode: HTMLElement | null = null

  /** `mount()` 로 받은 핸들러. 주지 않았으면 `null` 이다. */
  events: PlayerAdapterEvents | null = null

  private currentState: PlayerState = 'idle'

  /**
   * 외부 플레이어가 준비됐다고 알린 뒤인지 (M9-3). `emitReady()` 가 세운다.
   * 실제 어댑터의 `playerReady` 와 같은 뜻이다 — 준비 전 `seek()` 은 버리고
   * `position()` 은 `null` 이다.
   */
  private ready = false

  /**
   * 외부 플레이어가 **마지막으로 보고한** 위치 (M9-3). `emitPosition()` 이
   * 세우고, `load()` 가 비운다 — 새 영상을 명령한 뒤 그 영상의 보고가 오기
   * 전까지는 모른다 (실제 어댑터의 영상 식별 판정과 같은 결과).
   */
  private reportedPosition: number | null = null

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
    this.ready = false
    this.reportedPosition = null
  }

  load(videoId: string, options?: PlayerLoadOptions): void {
    const call: FakeLoadCall = { videoId, autoplay: options?.autoplay === true }
    if (isValidPlayerSeconds(options?.startSeconds)) call.startSeconds = options.startSeconds
    this.calls.load.push(call)

    // 새 영상을 명령했다. 그 영상의 보고가 오기 전까지 위치는 모른다.
    this.reportedPosition = null
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

  position(): number | null {
    if (this.hostNode === null || !this.ready) return null
    return isValidPlayerSeconds(this.reportedPosition) ? this.reportedPosition : null
  }

  seek(seconds: number): void {
    if (this.hostNode === null) return

    // 실제 어댑터와 같은 두 조건에서 버린다. 보류하지 않는다.
    if (!isValidPlayerSeconds(seconds) || !this.ready) {
      this.calls.seekDropped.push(seconds)
      return
    }

    this.calls.seek.push(seconds)
    // 위치를 바꾸지 않는다. 실제 플레이어도 보고가 와야 바뀐다.
  }

  /** 마운트되어 있는지. 테스트 가독성을 위한 편의 속성이다. */
  get isMounted(): boolean {
    return this.hostNode !== null
  }

  // ── 테스트가 외부 플레이어 역할을 하도록 하는 함수들 ──────────────────

  emitReady(): void {
    this.ready = true
    this.events?.ready?.()
  }

  /**
   * 외부 플레이어가 **지금 적재된 영상의** 위치를 보고했다 (M9-3).
   *
   * `null` 은 "보고를 거뒀다" 다. 실제 플레이어의 `getCurrentTime()` 처럼
   * 소수를 그대로 받는다. 유효하지 않은 값은 `position()` 이 `null` 로 가린다.
   */
  emitPosition(seconds: number | null): void {
    this.reportedPosition = seconds
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
