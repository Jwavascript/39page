/**
 * 탭 간 쓰기 잠금 + 영수증 (M10-3 안정화, ADR 0025) — `createWriteGate`.
 *
 * 실제 브라우저의 두 성질을 흉내 낸다 (`tests/support/fakeTabs.ts`).
 * - 잠금 관리자는 브라우저 전체에 하나다.
 * - `localStorage` 는 탭마다 사본이고 다른 탭의 쓰기는 늦게(`delayMs`) 도착한다.
 *
 * 그 위에 store 와 같은 규약의 작은 목록(`openTab`)을 세운다 — 기준 원문 비교
 * (`createBaseline`) → 바뀌었으면 다시 읽고 거절, 아니면 더하고 쓴다. 가짜 시계로
 * 순서를 고정하므로 "같은 순간 / 1ms / 5ms" 를 정확히 재현한다.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  LOCK_TIMEOUT_MS,
  RECEIPT_EXPIRY_MS,
  VISIBILITY_TIMEOUT_MS,
  createBaseline,
  createWriteGate,
  type WriteGate,
} from '@/shared/storage'

import { FakeLockWorld, StorageWorld } from '../support/fakeTabs'

const KEY = 'test.list'
const REV = 'test.list.rev'
/** 실측 전파 시간(6.5–23ms) 안쪽. */
const DELAY_MS = 10

let locks: FakeLockWorld
let storage: StorageWorld

beforeEach(() => {
  vi.useFakeTimers()
  locks = new FakeLockWorld()
  storage = new StorageWorld(DELAY_MS)
})

afterEach(() => {
  vi.useRealTimers()
})

type AddOutcome = 'saved' | 'conflict' | 'busy'

interface Tab {
  readonly id: string
  readonly gate: WriteGate
  readonly storage: Storage
  /** 메모리 사본 (store 의 `items`). */
  memory(): string[]
  add(item: string): Promise<AddOutcome>
  /** 사용자가 충돌·바쁨 안내를 보고 다시 누르는 것. */
  addUntilSaved(item: string, attempts?: number): Promise<AddOutcome[]>
  /** `work` 가 몇 번 실행됐는지. */
  workRuns(): number
}

function parse(raw: string | null): string[] {
  return raw === null ? [] : (JSON.parse(raw) as string[])
}

/**
 * store 와 같은 규약의 탭.
 *
 * @param useLocks `false` 면 잠금 없는 환경(구형 브라우저 · 규약 이전) — 기준 원문
 *   비교만 남는다.
 */
function openTab(id: string, useLocks = true): Tab {
  const tabStorage = storage.forTab(id)
  const handle = locks.forTab(id)
  const source = { raw: () => tabStorage.getItem(KEY), available: () => true }
  const baseline = createBaseline(source)
  let memory = parse(tabStorage.getItem(KEY))
  baseline.adopt()
  let runs = 0

  const gate = createWriteGate({
    name: KEY,
    revisionKey: REV,
    locks: () => (useLocks ? handle : null),
    storage: () => tabStorage,
  })

  function reload(): void {
    memory = parse(tabStorage.getItem(KEY))
    baseline.adopt()
  }

  function addNow(item: string): 'saved' | 'conflict' {
    runs += 1
    if (baseline.changedExternally()) {
      reload()
      return 'conflict'
    }
    memory = [...memory, item]
    tabStorage.setItem(KEY, JSON.stringify(memory))
    baseline.recordWrite()
    return 'saved'
  }

  async function add(item: string): Promise<AddOutcome> {
    const outcome = await gate.run(() => {
      const value = addNow(item)
      return { value, wrote: value === 'saved' }
    })
    if (outcome.kind === 'done') return outcome.value
    if (outcome.kind === 'stale-view') {
      reload()
      return 'conflict'
    }
    return 'busy'
  }

  async function addUntilSaved(item: string, attempts = 4): Promise<AddOutcome[]> {
    const seen: AddOutcome[] = []
    for (let index = 0; index < attempts; index += 1) {
      const outcome = await add(item)
      seen.push(outcome)
      if (outcome === 'saved') break
    }
    return seen
  }

  return {
    id,
    gate,
    storage: tabStorage,
    memory: () => memory,
    add,
    addUntilSaved,
    workRuns: () => runs,
  }
}

/** 전파가 모두 끝날 때까지. */
async function settle(ms = 200): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms)
}

function finalList(): string[] {
  return parse(storage.centralValue(KEY))
}

/* ================================================================== *
 * 0. 왜 잠금이 필요한가 — 기준 원문 비교만으로는 막지 못하는 경합
 * ================================================================== */

describe('0. 잠금 없이 (기준 원문 비교만, M10-3A)', () => {
  it('같은 순간 두 탭이 쓰면 둘 다 "저장" 이라고 하지만 하나가 조용히 사라진다', async () => {
    const tabA = openTab('A', false)
    const tabB = openTab('B', false)

    const [a, b] = await Promise.all([tabA.add('a'), tabB.add('b')])
    await settle()

    // 둘 다 성공으로 보고했다 — 그런데 남은 것은 하나다. 이것이 M10-3C 가 감지만 하던 경합이다.
    expect([a, b]).toEqual(['saved', 'saved'])
    expect(finalList()).toHaveLength(1)
  })

  it('전파보다 늦게(15ms) 쓰면 기준 원문 비교가 막는다', async () => {
    const tabA = openTab('A', false)
    const tabB = openTab('B', false)

    expect(await tabA.add('a')).toBe('saved')
    await vi.advanceTimersByTimeAsync(15)
    expect(await tabB.add('b')).toBe('conflict')
    expect(await tabB.add('b')).toBe('saved')
    await settle()

    expect(finalList()).toEqual(['a', 'b'])
  })
})

/* ================================================================== *
 * A. 잠금 + 영수증 — 같은 순간의 경합
 * ================================================================== */

describe('A. 잠금 + 영수증 — 협력하는 탭 사이에 조용한 손실이 없다', () => {
  it('같은 순간 두 탭이 서로 다른 항목을 더하면 — 하나는 저장, 하나는 충돌, 다시 누르면 둘 다 남는다', async () => {
    const tabA = openTab('A')
    const tabB = openTab('B')

    const pending = Promise.all([tabA.addUntilSaved('a'), tabB.addUntilSaved('b')])
    await settle(500)
    const [a, b] = await pending
    await settle()

    // 먼저 잠금을 얻은 쪽은 바로 저장한다. 다른 쪽은 앞 쓰기가 보일 때까지 기다린 뒤
    // 낡은 기준을 알아채고 거절한다 — 덮어쓰지 않는다.
    expect(a).toEqual(['saved'])
    expect(b).toEqual(['conflict', 'saved'])
    expect(finalList()).toEqual(['a', 'b'])
    // 모든 탭의 사본이 같은 곳으로 모인다.
    expect(parse(tabA.storage.getItem(KEY))).toEqual(['a', 'b'])
    expect(parse(tabB.storage.getItem(KEY))).toEqual(['a', 'b'])
  })

  it.each([0, 1, 5, 9, 15, 30])(
    '%ims 간격으로 같은 목록에 더해도 저장했다고 한 것은 모두 남는다',
    async (gap) => {
      const tabA = openTab('A')
      const tabB = openTab('B')

      const first = tabA.addUntilSaved('a')
      await vi.advanceTimersByTimeAsync(gap)
      const second = tabB.addUntilSaved('b')
      await settle(500)
      const outcomes = [await first, await second]
      await settle()

      expect(outcomes.every((seen) => seen[seen.length - 1] === 'saved')).toBe(true)
      expect(finalList().sort()).toEqual(['a', 'b'])
    },
  )

  it('세 탭이 여러 차례 섞여 써도 저장했다고 한 것은 모두 남는다', async () => {
    const tabs = [openTab('A'), openTab('B'), openTab('C')]
    const saved: string[] = []
    const jobs: Promise<void>[] = []

    for (let round = 0; round < 6; round += 1) {
      tabs.forEach((tab, index) => {
        const item = `${tab.id}${String(round)}`
        jobs.push(
          (async () => {
            await vi.advanceTimersByTimeAsync((round * 7 + index * 3) % 11)
            const seen = await tab.addUntilSaved(item, 10)
            if (seen[seen.length - 1] === 'saved') saved.push(item)
          })(),
        )
      })
    }
    await settle(5_000)
    await Promise.all(jobs)
    await settle()

    expect(saved).toHaveLength(18)
    expect(finalList().sort()).toEqual([...saved].sort())
  })

  it('앞 탭의 쓰기가 이 탭에 보이기 전에는 명령 본문을 실행하지 않는다', async () => {
    const tabA = openTab('A')
    const tabB = openTab('B')

    await tabA.add('a')
    const pending = tabB.add('b')
    // 전파 전 — B 는 잠금을 얻었지만 영수증 번호가 아직 보이지 않아 기다린다.
    await vi.advanceTimersByTimeAsync(DELAY_MS - 2)
    expect(tabB.workRuns()).toBe(0)

    await settle()
    expect(await pending).toBe('conflict')
    expect(tabB.workRuns()).toBe(1)
    // 거절하면서 최신을 다시 읽었다.
    expect(tabB.memory()).toEqual(['a'])
  })

  it('수정 번호는 오르기만 하고, 탭마다 영수증은 마지막 하나만 잡는다', async () => {
    const tabA = openTab('A')

    await tabA.add('1')
    await tabA.add('2')
    await tabA.add('3')

    expect(tabA.storage.getItem(REV)).toBe('3')
    const receipts = locks.heldNames().filter((name) => name.startsWith(`${KEY}:rev:`))
    expect(receipts).toHaveLength(1)
    expect(receipts[0]).toMatch(new RegExp(`^${KEY}:rev:3:\\d+$`))
  })

  it('쓰지 않은 명령(거절)은 번호를 올리지 않고 영수증도 내지 않는다', async () => {
    const tabA = openTab('A')
    const tabB = openTab('B')
    await tabA.add('a')
    await settle()

    expect(await tabB.add('b')).toBe('conflict')
    expect(tabB.storage.getItem(REV)).toBe('1')
    expect(locks.heldNames().filter((name) => name.startsWith(`${KEY}:rev:`))).toHaveLength(1)
  })
})

/* ================================================================== *
 * B. 기다림 · 실패 · 중단
 * ================================================================== */

describe('B. 잠금 기다림 · 실패 · 중단 — 쓰지 않고 알린다', () => {
  it(`다른 탭이 잠금을 ${String(LOCK_TIMEOUT_MS)}ms 넘게 붙잡으면 busy — 본문을 실행하지 않고 대기열에서 빠진다`, async () => {
    const tabA = openTab('A')
    const stuck = locks.forTab('X')
    void stuck.request(`${KEY}:write`, { mode: 'exclusive' }, () => new Promise(() => undefined))
    await vi.advanceTimersByTimeAsync(0)

    const pending = tabA.add('a')
    await vi.advanceTimersByTimeAsync(LOCK_TIMEOUT_MS - 1)
    expect(tabA.workRuns()).toBe(0)
    await vi.advanceTimersByTimeAsync(2)

    expect(await pending).toBe('busy')
    expect(tabA.workRuns()).toBe(0)
    expect(locks.pendingCount()).toBe(0)
    expect(tabA.storage.getItem(KEY)).toBeNull()
  })

  it('잠시 기다리면 얻는다 — 한도 안의 기다림은 실패가 아니다', async () => {
    const tabA = openTab('A')
    const holder = locks.forTab('X')
    let release: () => void = () => undefined
    void holder.request(
      `${KEY}:write`,
      { mode: 'exclusive' },
      () =>
        new Promise<void>((done) => {
          release = done
        }),
    )
    await vi.advanceTimersByTimeAsync(0)

    const pending = tabA.add('a')
    await vi.advanceTimersByTimeAsync(1_000)
    release()
    await settle()

    expect(await pending).toBe('saved')
  })

  it('잠금 요청 자체가 실패하면 busy — 쓰지 않는다', async () => {
    const tabA = openTab('A')
    locks.failRequestsFor.add('A')

    expect(await tabA.add('a')).toBe('busy')
    expect(tabA.workRuns()).toBe(0)
    expect(tabA.storage.getItem(KEY)).toBeNull()
  })

  it('잠금을 붙잡은 탭을 닫으면 풀린다 — 기다리던 탭이 한도 전에 쓴다', async () => {
    const tabA = openTab('A')
    const closing = locks.forTab('X')
    void closing.request(`${KEY}:write`, { mode: 'exclusive' }, () => new Promise(() => undefined))
    await vi.advanceTimersByTimeAsync(0)

    const pending = tabA.add('a')
    await vi.advanceTimersByTimeAsync(100)
    locks.closeTab('X')
    await settle()

    expect(await pending).toBe('saved')
  })

  it('명령 본문이 던지면 그 오류가 그대로 올라온다 — busy 로 숨기지 않고, 잠금은 풀린다', async () => {
    const tabA = openTab('A')
    const failure = new Error('boom')

    await expect(
      tabA.gate.run(() => {
        throw failure
      }),
    ).rejects.toBe(failure)

    expect(await tabA.add('a')).toBe('saved')
  })

  it(`영수증 번호가 ${String(VISIBILITY_TIMEOUT_MS)}ms 안에 보이지 않으면 stale-view — 쓰지 않는다`, async () => {
    storage.delayMs = 2_000 // 한도보다 늦게 도착한다 (영수증 만료 3초보다는 이르다)
    const tabA = openTab('A')
    const tabB = openTab('B')

    await tabA.add('a')
    const outcome = tabB.gate.run(() => ({ value: 'ran', wrote: false }))
    await vi.advanceTimersByTimeAsync(VISIBILITY_TIMEOUT_MS + 10)

    expect(await outcome).toEqual({ kind: 'stale-view' })
  })

  it('수정 번호를 쓰지 못하면 영수증을 내지 않는다 — 다른 탭이 헛되이 기다리지 않는다', async () => {
    const tabA = openTab('A')
    const original = tabA.storage.setItem.bind(tabA.storage)
    tabA.storage.setItem = (key: string, value: string) => {
      if (key === REV) throw new DOMException('full', 'QuotaExceededError')
      original(key, value)
    }

    expect(await tabA.add('a')).toBe('saved')
    expect(locks.heldNames().some((name) => name.startsWith(`${KEY}:rev:`))).toBe(false)
  })
})

/* ================================================================== *
 * C. 탭을 닫거나 새로고침 · 사이트 데이터 삭제
 * ================================================================== */

describe('C. 탭 닫기 · 새로고침 · 저장소 비우기', () => {
  it('영수증을 가진 탭이 닫혀도 전파가 끝난 뒤라면 다음 탭은 그대로 이어 쓴다', async () => {
    const tabA = openTab('A')
    await tabA.add('a')
    await settle()
    locks.closeTab('A')

    const tabB = openTab('B')
    expect(await tabB.add('b')).toBe('saved')
    await settle()
    expect(finalList()).toEqual(['a', 'b'])
  })

  it('[한계] 쓰자마자(전파 전) 닫힌 탭의 영수증은 사라진다 — 그 순간의 다른 탭 쓰기는 기준 비교만 남는다', async () => {
    const tabA = openTab('A')
    const tabB = openTab('B')

    await tabA.add('a')
    locks.closeTab('A') // 전파 전에 닫힌다 — 쓰기 자체는 브라우저로 이미 보냈다
    expect(await tabB.add('b')).toBe('saved')
    await settle()

    // ADR 0025 "한계" 그대로다. 막지 못한 경우를 막았다고 주장하지 않는다.
    expect(finalList()).toEqual(['b'])
  })

  it('새로고침한 탭은 최신을 읽고 시작한다 — 잠금·영수증을 이어받지 않아도 된다', async () => {
    const tabA = openTab('A')
    await tabA.add('a')
    await settle()
    locks.closeTab('A')

    const reloaded = openTab('A2')
    expect(reloaded.memory()).toEqual(['a'])
    expect(await reloaded.add('b')).toBe('saved')
  })

  it(`저장소가 비워져도(${String(RECEIPT_EXPIRY_MS)}ms 지난 영수증) 모든 탭이 저장을 영영 거절하지 않는다`, async () => {
    const tabA = openTab('A')
    const tabB = openTab('B')
    await tabA.add('a')
    await settle()
    // B 가 A 의 쓰기를 읽어 둔다 (충돌로 다시 읽기).
    expect(await tabB.add('x')).toBe('conflict')
    expect(tabB.memory()).toEqual(['a'])

    storage.wipeAll() // 사이트 데이터 삭제 — A 의 영수증(번호 1)은 남아 있다
    const runsBefore = tabB.workRuns()

    // 만료 전 — 번호 1 이 보이지 않으므로 쓰지 않는다 (stale-view → 다시 읽고 거절).
    const early = tabB.add('b')
    await vi.advanceTimersByTimeAsync(VISIBILITY_TIMEOUT_MS + 10)
    expect(await early).toBe('conflict')
    expect(tabB.workRuns()).toBe(runsBefore)

    await vi.advanceTimersByTimeAsync(RECEIPT_EXPIRY_MS)
    // 만료 뒤 — 오래된 영수증을 기다리지 않는다. 다시 읽은 빈 저장소를 기준으로 쓴다.
    expect(await tabB.add('b')).toBe('saved')
    await settle()
    expect(finalList()).toEqual(['b'])
    // 번호는 줄지 않는다 — 영수증의 번호 위로 이어간다.
    expect(Number(tabB.storage.getItem(REV))).toBeGreaterThanOrEqual(2)
  })
})

/* ================================================================== *
 * D. 잠금이 없는 환경
 * ================================================================== */

describe('D. Web Locks 가 없는 환경 — 기준 원문 비교로 돌아간다', () => {
  it('fallback 을 알리고, 본문을 지금 바로 실행한다 (돌아왔을 때 이미 반영돼 있다)', () => {
    const tab = openTab('A', false)
    expect(tab.gate.mode()).toBe('fallback')

    void tab.add('a')

    expect(tab.memory()).toEqual(['a'])
    expect(tab.storage.getItem(KEY)).toBe('["a"]')
    expect(tab.storage.getItem(REV)).toBeNull()
  })

  it('잠금이 있으면 locks 를 알린다', () => {
    expect(openTab('A').gate.mode()).toBe('locks')
  })

  it('본문이 던지면 거절된 promise 로 돌려준다 (동기 예외가 아니다)', async () => {
    const tab = openTab('A', false)
    const failure = new Error('boom')
    const result = tab.gate.run(() => {
      throw failure
    })
    await expect(result).rejects.toBe(failure)
  })

  it('[한계] 규약에 참여하지 않는 탭(이전 버전)의 쓰기는 기준 비교만 본다 — 전파 전 경합은 막지 못한다', async () => {
    const modern = openTab('A')
    const legacy = openTab('OLD', false)

    const [a, b] = await Promise.all([modern.add('a'), legacy.add('b')])
    await settle()

    expect([a, b]).toEqual(['saved', 'saved'])
    expect(finalList()).toHaveLength(1)
  })
})
