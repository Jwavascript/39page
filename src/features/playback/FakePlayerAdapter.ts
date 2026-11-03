/**
 * 테스트·개발용 `PlayerAdapter` 구현체.
 *
 * 실제 YouTube API 없이 **수명주기와 DOM 소유 구조**를 검증한다.
 * 호출을 기록하는 목(mock)이 아니라 계약을 실제로 구현한다. M3의 실제
 * 어댑터와 같은 계약을 쓰므로 인터페이스가 갈라지지 않는다.
 *
 * ⚠️ 영상을 재생하지 않는다. 사용자에게 실제 재생이 가능한 것처럼 보이는
 * 요소를 만들지 않는다. 생성하는 노드는 보이지 않는 빈 노드다.
 * 앱 코드에서 주입하지 않으며, 테스트에서만 주입한다.
 */
import type { PlayerState } from '@/shared/types'

import type { PlayerAdapter } from './PlayerAdapter'

/** 어댑터에 들어온 호출 기록. */
export interface FakePlayerAdapterCalls {
  /** `mount()` **호출 횟수**. no-op으로 무시된 호출도 센다. */
  mount: number
  /** `destroy()` 호출 횟수. */
  destroy: number
  /** `load()`에 들어온 videoId 목록. */
  load: string[]
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

  /** 어댑터가 만들어 소유하는 자식 노드. M3에서는 iframe으로 교체된다. */
  hostNode: HTMLElement | null = null

  private currentState: PlayerState = 'idle'

  mount(container: HTMLElement): void {
    this.calls.mount += 1

    // 중복 호출은 no-op. 두 번째 노드를 만들지 않는다.
    if (this.hostNode !== null) return

    const host = container.ownerDocument.createElement('div')
    host.dataset.fakePlayerHost = 'true'
    container.append(host)

    this.container = container
    this.hostNode = host
  }

  destroy(): void {
    this.calls.destroy += 1

    // 마운트되지 않았으면 no-op.
    if (this.hostNode === null) return

    this.hostNode.remove()
    this.hostNode = null
    this.container = null
    this.currentState = 'idle'
  }

  load(videoId: string): void {
    this.calls.load.push(videoId)
    this.currentState = 'loading'
  }

  play(): void {
    this.calls.play += 1
    this.currentState = 'playing'
  }

  pause(): void {
    this.calls.pause += 1
    this.currentState = 'paused'
  }

  state(): PlayerState {
    return this.currentState
  }

  /** 마운트되어 있는지. 테스트 가독성을 위한 편의 속성이다. */
  get isMounted(): boolean {
    return this.hostNode !== null
  }
}
