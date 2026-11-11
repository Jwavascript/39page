/**
 * 탭 간 쓰기 정합성 (ADR 0024 · 0025).
 *
 * 두 겹이다.
 *
 * 1. **기준 원문 비교** (`createBaseline`, M10-3A) — 이 탭이 마지막으로 읽거나 쓴
 *    원문과 지금 원문이 다르면 쓰지 않는다. 낡은 메모리로 남의 변경을 덮지 않는다.
 * 2. **잠금 + 영수증** (`createWriteGate`, M10-3 안정화) — 같은 origin 의 모든 쓰기를
 *    Web Locks 배타 잠금으로 한 줄로 세운다. 그런데 잠금만으로는 부족하다:
 *    `localStorage` 는 탭마다 사본을 두고 다른 탭의 쓰기를 **비동기로** 받는다
 *    (실측 6.5–23ms). 잠금을 넘겨받은 탭이 앞 탭의 쓰기를 아직 못 받았을 수 있다.
 *    그래서 쓰는 탭은 **수정 번호**(`<키>.rev`)를 올리고, 그 번호를 이름에 넣은 공유
 *    잠금(영수증)을 잡아 둔다. 다음 탭은 배타 잠금 안에서 잠금 관리자의 영수증 중
 *    가장 큰 번호를 보고, **자기 저장소가 그 번호 이상을 보일 때까지** 기다린 뒤에야
 *    비교하고 쓴다. 잠금 관리자의 상태는 브라우저 전체에서 한 줄이므로 영수증은
 *    잠금을 넘겨주기 전에 보인다. 끝내 보이지 않으면(`VISIBILITY_TIMEOUT_MS`) 쓰지
 *    않는다 — `stale-view`.
 *
 * 보장하지 못하는 것 (ADR 0025 "한계"):
 * - Web Locks 가 없는 환경 — 1번만 남는다 (약 5ms 창, 감지로 알린다).
 * - 이 규약에 참여하지 않는 탭 (이 변경 전 버전이 열려 있는 탭) — 1번만 그 탭의
 *   쓰기를 본다.
 * - 마지막으로 쓴 탭이 쓰자마자(수 ms 안) 닫히면 그 영수증이 사라진다.
 * - 영수증은 3초(`RECEIPT_EXPIRY_MS`)가 지나면 기다리지 않는다 — 그보다 늦게
 *   전파되는 환경은 1번만 남는다.
 *
 * 반응형이 아니다. store 가 결과를 ref 로 옮긴다.
 */

/** 다른 탭의 저장이 이 탭이 방금 쓴 값을 덮었을 때 "동시 저장" 으로 볼 시간 (M10-3C). */
export const CONCURRENT_WRITE_WINDOW_MS = 1_000
/** 배타 잠금을 기다리는 한도. 넘으면 `busy` — 다른 탭이 오래 붙잡고 있다. */
export const LOCK_TIMEOUT_MS = 5_000
/** 영수증의 번호가 이 탭 저장소에 보이기를 기다리는 한도. 넘으면 쓰지 않는다. */
export const VISIBILITY_TIMEOUT_MS = 1_500
const VISIBILITY_POLL_MS = 4
/**
 * 이보다 오래된 영수증은 기다리지 않는다. 탭 간 전파(실측 6.5–23ms)보다 훨씬 길고,
 * 저장소가 비워진 뒤 모든 탭이 영영 저장을 거절하는 일을 막을 만큼 짧다.
 */
export const RECEIPT_EXPIRY_MS = 3_000

/* ------------------------------------------------------------------ *
 * 1. 기준 원문
 * ------------------------------------------------------------------ */

export interface RawSource {
  raw(): string | null
  available(): boolean
}

export interface Baseline {
  /** 복원·다시 읽기 직후 — 지금 원문을 기준으로 삼는다. 저장 못 한 변경은 없어진다. */
  adopt(): void
  /** 쓰기 성공 직후 — 쓴 원문을 기준과 "방금 쓴 값" 으로 기억한다. */
  recordWrite(): void
  /** 메모리에만 있고 저장되지 않은 변경이 생겼다 (쓰기 실패 · 보호 상태). */
  markUnsaved(): void
  /** 저장되지 않은 변경이 있는지. */
  hasUnsaved(): boolean
  /**
   * 다른 탭이 기준 이후에 바꿨는지. 저장소에 **접근할 수 없게 된 것**은 바뀐 것이
   * 아니다 — `raw()` 의 `null` 이 "비었다" 인지 "못 읽는다" 인지 먼저 가른다.
   */
  changedExternally(): boolean
  /**
   * `storage` 이벤트가 이 탭이 1초 안에 쓴 값을 덮었는지 (oldValue = 그 값).
   * 한 번 보면 잊는다.
   */
  overwroteRecentWrite(oldValue: string | null): boolean
}

export function createBaseline(source: RawSource, now: () => number = Date.now): Baseline {
  let baselineRaw: string | null = null
  let unsaved = false
  let lastOwnWrite: { readonly raw: string | null; readonly at: number } | null = null

  return {
    adopt() {
      baselineRaw = source.raw()
      unsaved = false
    },
    recordWrite() {
      baselineRaw = source.raw()
      unsaved = false
      lastOwnWrite = { raw: baselineRaw, at: now() }
    },
    markUnsaved() {
      unsaved = true
    },
    hasUnsaved() {
      return unsaved
    },
    changedExternally() {
      return source.available() && source.raw() !== baselineRaw
    },
    overwroteRecentWrite(oldValue) {
      const recent = lastOwnWrite
      lastOwnWrite = null
      return (
        recent !== null &&
        oldValue === recent.raw &&
        now() - recent.at <= CONCURRENT_WRITE_WINDOW_MS
      )
    },
  }
}

/** 다른 탭의 `storage` 이벤트를 받을 대상. 테스트가 바꿔 낄 수 있게 좁힌다. */
export interface StorageEventTarget {
  addEventListener(type: 'storage', listener: (event: StorageEvent) => void): void
  removeEventListener(type: 'storage', listener: (event: StorageEvent) => void): void
}

/* ------------------------------------------------------------------ *
 * 2. 잠금 + 영수증
 * ------------------------------------------------------------------ */

/** `navigator.locks` 중 쓰는 부분. 테스트가 같은 모양의 가짜를 넣는다. */
export interface LockManagerLike {
  request(
    name: string,
    options: { mode: 'exclusive' | 'shared'; signal?: AbortSignal },
    callback: (lock: unknown) => unknown,
  ): Promise<unknown>
  query(): Promise<{ held?: readonly { name?: string }[] }>
}

/** 지금 환경의 잠금 관리자. 없거나(구형 브라우저 · 안전하지 않은 origin) 모양이 다르면 `null`. */
export function currentLockManager(): LockManagerLike | null {
  try {
    const locks = (globalThis.navigator as { locks?: Partial<LockManagerLike> } | undefined)?.locks
    if (locks && typeof locks.request === 'function' && typeof locks.query === 'function') {
      return locks as LockManagerLike
    }
  } catch {
    /* 접근 자체가 던지는 환경 */
  }
  return null
}

export type GateOutcome<T> =
  /** 일을 마쳤다. */
  | { readonly kind: 'done'; readonly value: T }
  /** 앞 탭의 쓰기가 이 탭에 보이는지 확인하지 못했다 — 쓰지 않았다. */
  | { readonly kind: 'stale-view' }
  /** 잠금을 제때 얻지 못했거나 잠금 요청이 실패했다 — 쓰지 않았다. */
  | { readonly kind: 'busy' }

export interface WriteGate {
  /**
   * `work` 를 배타적으로 실행한다. `work` 는 **동기 함수**이고 쓰기를 했는지 돌려준다.
   *
   * 잠금이 없는 환경에서는 `work` 를 **지금 바로** 실행하고 이미 이행된 promise 를
   * 돌려준다 — 호출이 끝났을 때 상태가 이미 바뀌어 있다.
   */
  run<T>(work: () => { readonly value: T; readonly wrote: boolean }): Promise<GateOutcome<T>>
  /** 이 탭이 지금 잠금 규약에 참여하는지 (`locks` · `fallback`). */
  mode(): 'locks' | 'fallback'
}

export interface WriteGateOptions {
  /** 잠금 이름의 머리 — 저장 키를 쓴다 (`39page.library`). */
  readonly name: string
  /** 수정 번호를 두는 키 (`39page.library.rev`). */
  readonly revisionKey: string
  readonly locks?: () => LockManagerLike | null
  readonly storage?: () => Storage | null
  readonly lockTimeoutMs?: number
  readonly visibilityTimeoutMs?: number
  /** 시계 — 영수증 시각과 기다림 한도에 쓴다. 테스트가 바꿔 낀다. */
  readonly now?: () => number
}

function defaultStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null
  }
}

const sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms))

export function createWriteGate(options: WriteGateOptions): WriteGate {
  const getLocks = options.locks ?? currentLockManager
  const getStorage = options.storage ?? defaultStorage
  const now = options.now ?? Date.now
  const lockTimeoutMs = options.lockTimeoutMs ?? LOCK_TIMEOUT_MS
  const visibilityTimeoutMs = options.visibilityTimeoutMs ?? VISIBILITY_TIMEOUT_MS
  const writeLock = `${options.name}:write`
  const receiptPrefix = `${options.name}:rev:`

  /** 이 탭이 잡고 있는 영수증을 놓는 함수. 새 영수증을 잡으면 앞의 것을 놓는다. */
  let releaseReceipt: (() => void) | null = null

  /** 이 탭 저장소에 보이는 수정 번호. 없거나 망가졌으면 0. */
  function visibleRevision(): number {
    try {
      const value = Number(getStorage()?.getItem(options.revisionKey) ?? '0')
      return Number.isSafeInteger(value) && value >= 0 ? value : 0
    } catch {
      return 0
    }
  }

  function writeRevision(value: number): boolean {
    try {
      const storage = getStorage()
      if (storage === null) return false
      storage.setItem(options.revisionKey, String(value))
      return true
    } catch {
      return false
    }
  }

  /**
   * 잠금 관리자에 걸린 영수증 중 **기다려야 할** 가장 큰 번호.
   *
   * 영수증 이름은 `<이름>:rev:<번호>:<쓴 시각 ms>` 다. 쓴 지 `RECEIPT_EXPIRY_MS` 가
   * 지난 영수증은 기다리지 않는다 — 전파는 수십 ms 안에 끝나므로, 그때까지 번호가
   * 보이지 않는다면 저장소가 비워졌거나(사이트 데이터 삭제) 쓰기가 사라진 것이다.
   * 그런 영수증 때문에 모든 탭이 저장을 영영 거절하지 않게 한다.
   */
  async function latestReceipt(
    locks: LockManagerLike,
  ): Promise<{ readonly wait: number; readonly highest: number }> {
    const state = await locks.query()
    const current = now()
    let wait = 0
    let highest = 0
    for (const lock of state.held ?? []) {
      const receipt = parseReceipt(lock.name, receiptPrefix)
      if (receipt === null) continue
      // 번호는 만료된 영수증까지 보고 매긴다 — 저장소가 비워져도 번호가 되돌아가지 않는다.
      if (receipt.revision > highest) highest = receipt.revision
      if (current - receipt.at <= RECEIPT_EXPIRY_MS && receipt.revision > wait) {
        wait = receipt.revision
      }
    }
    return { wait, highest }
  }

  async function waitUntilVisible(revision: number): Promise<boolean> {
    const started = now()
    while (visibleRevision() < revision) {
      if (now() - started >= visibilityTimeoutMs) return false
      await sleep(VISIBILITY_POLL_MS)
    }
    return true
  }

  /** 영수증을 잡는다 — 잡힐 때까지 기다리고, 앞의 영수증은 놓는다. */
  function holdReceipt(locks: LockManagerLike, revision: number): Promise<void> {
    return new Promise<void>((granted) => {
      locks
        .request(`${receiptPrefix}${String(revision)}:${String(now())}`, { mode: 'shared' }, () => {
          const previous = releaseReceipt
          const held = new Promise<void>((release) => {
            releaseReceipt = release
          })
          previous?.()
          granted()
          return held
        })
        .catch(() => granted())
    })
  }

  function runWithoutLocks<T>(
    work: () => { readonly value: T; readonly wrote: boolean },
  ): Promise<GateOutcome<T>> {
    try {
      return Promise.resolve({ kind: 'done', value: work().value })
    } catch (error) {
      return Promise.reject(error)
    }
  }

  function run<T>(
    work: () => { readonly value: T; readonly wrote: boolean },
  ): Promise<GateOutcome<T>> {
    const locks = getLocks()
    if (locks === null) return runWithoutLocks(work)

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), lockTimeoutMs)
    /** `work` 가 던진 오류 — 잠금 실패(`busy`)와 가른다. */
    let thrown: { readonly error: unknown } | null = null

    return locks
      .request(
        writeLock,
        { mode: 'exclusive', signal: controller.signal },
        async (): Promise<GateOutcome<T>> => {
          clearTimeout(timer)
          const latest = await latestReceipt(locks)
          if (!(await waitUntilVisible(latest.wait))) return { kind: 'stale-view' }

          // 여기부터 영수증까지 await 없이 — 이 탭 안에서 끊기지 않는다.
          let result: { readonly value: T; readonly wrote: boolean }
          try {
            result = work()
          } catch (error) {
            thrown = { error }
            throw error
          }
          if (result.wrote) {
            const next = Math.max(latest.highest, visibleRevision()) + 1
            // 번호를 못 쓰면 영수증도 내지 않는다 — 다른 탭이 헛되이 기다리지 않게.
            if (writeRevision(next)) await holdReceipt(locks, next)
          }
          return { kind: 'done', value: result.value }
        },
      )
      .then(
        (outcome) => outcome as GateOutcome<T>,
        () => {
          clearTimeout(timer)
          if (thrown !== null) throw thrown.error
          // 기다리다 시간이 다 됐거나(AbortError) 잠금 요청 자체가 실패했다.
          return { kind: 'busy' } as const
        },
      )
  }

  return {
    mode() {
      return getLocks() === null ? 'fallback' : 'locks'
    },
    run,
  }
}

/** 영수증 이름을 읽는다. 이 규약의 이름이 아니면 `null`. */
function parseReceipt(
  name: string | undefined,
  prefix: string,
): { readonly revision: number; readonly at: number } | null {
  if (typeof name !== 'string' || !name.startsWith(prefix)) return null
  const [revisionText, atText] = name.slice(prefix.length).split(':')
  const revision = Number(revisionText)
  const at = Number(atText)
  if (!Number.isSafeInteger(revision) || revision < 0) return null
  if (!Number.isSafeInteger(at) || at < 0) return null
  return { revision, at }
}
