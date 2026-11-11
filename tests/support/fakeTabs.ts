/**
 * 여러 탭을 흉내 내는 테스트 지원 — M10-3 안정화 (ADR 0025).
 *
 * jsdom 에는 Web Locks 가 없고, `localStorage` 는 즉시 공유된다. 실제 브라우저는
 * 다르다.
 *
 * - **잠금 관리자는 브라우저 전체에 하나다** (`FakeLockWorld`). 탭마다 손잡이
 *   (`forTab`)를 주고, 탭을 닫으면 그 탭이 잡은 잠금이 풀리고 기다리던 요청이
 *   사라진다 — 브라우저가 문서를 내릴 때와 같다.
 * - **저장소는 탭마다 사본이다** (`StorageWorld`). 한 탭의 쓰기는 `delayMs` 뒤에
 *   다른 탭 사본에 도착한다 (실측 6.5–23ms). 그 사이 다른 탭은 옛 값을 본다.
 *
 * 둘 다 `setTimeout` 으로 움직이므로 `vi.useFakeTimers()` 로 순서를 정확히 고정한다.
 */

type Mode = 'exclusive' | 'shared'

interface Request {
  readonly id: number
  readonly tab: string
  readonly name: string
  readonly mode: Mode
  readonly callback: (lock: unknown) => unknown
  readonly resolve: (value: unknown) => void
  readonly reject: (reason: unknown) => void
  readonly signal?: AbortSignal
}

interface Held {
  readonly id: number
  readonly tab: string
  readonly name: string
  readonly mode: Mode
}

export interface FakeLockHandle {
  request(
    name: string,
    options: { mode: Mode; signal?: AbortSignal },
    callback: (lock: unknown) => unknown,
  ): Promise<unknown>
  query(): Promise<{ held: { name: string; mode: Mode }[]; pending: { name: string }[] }>
}

export class FakeLockWorld {
  private nextId = 1
  private readonly queue: Request[] = []
  private readonly held: Held[] = []
  private readonly closed = new Set<string>()
  /** 다음 `request` 를 거절하게 할 탭 (잠금 요청 실패 흉내). */
  readonly failRequestsFor = new Set<string>()

  forTab(tab: string): FakeLockHandle {
    return {
      request: (name, options, callback) => this.request(tab, name, options, callback),
      query: () =>
        Promise.resolve({
          held: this.held.map((lock) => ({ name: lock.name, mode: lock.mode })),
          pending: this.queue.map((request) => ({ name: request.name })),
        }),
    }
  }

  /** 지금 잡혀 있는 잠금 이름 (검사용). */
  heldNames(): string[] {
    return this.held.map((lock) => lock.name)
  }

  pendingCount(): number {
    return this.queue.length
  }

  /** 탭을 닫는다 — 잡은 잠금을 모두 풀고 기다리던 요청을 버린다. */
  closeTab(tab: string): void {
    this.closed.add(tab)
    for (let index = this.queue.length - 1; index >= 0; index -= 1) {
      if (this.queue[index]?.tab === tab) this.queue.splice(index, 1)
    }
    for (let index = this.held.length - 1; index >= 0; index -= 1) {
      if (this.held[index]?.tab === tab) this.held.splice(index, 1)
    }
    this.grant()
  }

  private request(
    tab: string,
    name: string,
    options: { mode: Mode; signal?: AbortSignal },
    callback: (lock: unknown) => unknown,
  ): Promise<unknown> {
    if (this.closed.has(tab)) return new Promise(() => undefined)
    if (this.failRequestsFor.has(tab)) {
      return Promise.reject(new DOMException('lock request failed', 'InvalidStateError'))
    }
    if (options.signal?.aborted) {
      return Promise.reject(new DOMException('aborted', 'AbortError'))
    }
    return new Promise((resolve, reject) => {
      const request: Request = {
        id: this.nextId++,
        tab,
        name,
        mode: options.mode,
        callback,
        resolve,
        reject,
        signal: options.signal,
      }
      options.signal?.addEventListener('abort', () => {
        const index = this.queue.indexOf(request)
        if (index === -1) return // 이미 잡았다 — 잡은 뒤의 abort 는 아무 일도 하지 않는다.
        this.queue.splice(index, 1)
        reject(new DOMException('aborted', 'AbortError'))
      })
      this.queue.push(request)
      this.grant()
    })
  }

  private canGrant(request: Request): boolean {
    const holders = this.held.filter((lock) => lock.name === request.name)
    if (request.mode === 'exclusive') return holders.length === 0
    return holders.every((lock) => lock.mode === 'shared')
  }

  /** 같은 이름에서는 들어온 순서대로 준다 (Web Locks 규약). */
  private grant(): void {
    const blockedNames = new Set<string>()
    // 반복 중에 대기열에서 빼므로 사본을 돈다.
    for (const request of this.queue.slice()) {
      if (blockedNames.has(request.name)) continue
      if (!this.canGrant(request)) {
        blockedNames.add(request.name)
        continue
      }
      this.queue.splice(this.queue.indexOf(request), 1)
      const lock: Held = {
        id: request.id,
        tab: request.tab,
        name: request.name,
        mode: request.mode,
      }
      this.held.push(lock)
      // 콜백은 비동기로 부른다 (실제 구현과 같다).
      void Promise.resolve()
        .then(() => request.callback({ name: request.name, mode: request.mode }))
        .then(
          (value) => {
            this.release(lock)
            request.resolve(value)
          },
          (error: unknown) => {
            this.release(lock)
            request.reject(error)
          },
        )
    }
  }

  private release(lock: Held): void {
    const index = this.held.indexOf(lock)
    if (index !== -1) this.held.splice(index, 1)
    this.grant()
  }
}

/**
 * 탭마다 사본을 두고 `delayMs` 뒤에 전파하는 저장소.
 *
 * Chromium 의 모양을 따른다. 쓰기는 자기 사본에 바로 들어가고, `delayMs` 뒤에
 * 브라우저 쪽 원본(`central`)에 도착해 **다른 탭 사본**으로 퍼진다. 자기 쓰기가 아직
 * 도착하지 않은 키는 다른 탭의 값을 받지 않는다 — 그래서 거의 같은 순간의 두 쓰기는
 * 나중에 도착한 쪽으로 모든 탭이 모인다 (먼저 쓴 쪽은 조용히 사라진다).
 */
export class StorageWorld {
  private readonly central = new Map<string, string>()
  private readonly tabs = new Map<
    string,
    { readonly copy: Map<string, string>; readonly pending: Map<string, number> }
  >()

  constructor(public delayMs: number) {}

  /** 원본에 도착한 값 (검사용). */
  centralValue(key: string): string | null {
    return this.central.get(key) ?? null
  }

  /** 탭의 저장소 — `Storage` 의 필요한 부분. 새 탭은 원본의 지금 값으로 시작한다. */
  forTab(tab: string): Storage {
    const copy = new Map(this.central)
    const pending = new Map<string, number>()
    this.tabs.set(tab, { copy, pending })

    const send = (key: string, value: string | null): void => {
      if (value === null) copy.delete(key)
      else copy.set(key, value)
      pending.set(key, (pending.get(key) ?? 0) + 1)
      setTimeout(() => {
        pending.set(key, (pending.get(key) ?? 1) - 1)
        if (value === null) this.central.delete(key)
        else this.central.set(key, value)
        for (const [other, state] of this.tabs) {
          if (other === tab || (state.pending.get(key) ?? 0) > 0) continue
          if (value === null) state.copy.delete(key)
          else state.copy.set(key, value)
        }
      }, this.delayMs)
    }

    return {
      getItem: (key: string) => copy.get(key) ?? null,
      setItem: (key: string, value: string) => send(key, String(value)),
      removeItem: (key: string) => send(key, null),
      clear: () => {
        for (const key of Array.from(copy.keys())) send(key, null)
      },
      key: (index: number) => [...copy.keys()][index] ?? null,
      get length() {
        return copy.size
      },
    }
  }

  /** 원본과 모든 탭 사본을 한 번에 비운다 — 사이트 데이터 삭제 흉내. */
  wipeAll(): void {
    this.central.clear()
    for (const state of this.tabs.values()) state.copy.clear()
  }
}
