/**
 * ADR 0038 — 셔플 유틸 (`src/shared/utils/shuffle.ts`). 순수 함수 · 난수 주입.
 */
import { describe, expect, it } from 'vitest'

import { insertedRandomly, randomIndex, shuffled } from '@/shared/utils/shuffle'

/** 정해진 수를 차례로 주는 난수. */
const sequence = (...values: number[]) => {
  let at = 0
  return () => values[at++ % values.length] ?? 0
}

describe('randomIndex', () => {
  it('범위 안의 정수를 준다 — 난수가 범위를 벗어나도 자른다', () => {
    expect(randomIndex(5, () => 0)).toBe(0)
    expect(randomIndex(5, () => 0.999)).toBe(4)
    expect(randomIndex(5, () => 1)).toBe(4)
    expect(randomIndex(5, () => -0.5)).toBe(0)
    expect(randomIndex(1, () => 0.7)).toBe(0)
    expect(randomIndex(0, () => 0.7)).toBe(0)
  })
})

describe('shuffled', () => {
  it('새 배열을 주고 입력은 그대로다 — 모든 항목이 한 번씩', () => {
    const input = [1, 2, 3, 4, 5]
    const out = shuffled(input, sequence(0.3, 0.8, 0.1, 0.6))

    expect(out).not.toBe(input)
    expect(input).toEqual([1, 2, 3, 4, 5])
    expect([...out].sort()).toEqual([1, 2, 3, 4, 5])
  })

  it('난수를 정하면 순서도 정해진다 (Fisher–Yates)', () => {
    expect(shuffled(['a', 'b', 'c'], () => 0)).toEqual(['b', 'c', 'a'])
    expect(shuffled(['a', 'b', 'c'], () => 0.999)).toEqual(['a', 'b', 'c'])
  })

  it('빈 배열 · 한 항목은 그대로다', () => {
    expect(shuffled([])).toEqual([])
    expect(shuffled(['x'])).toEqual(['x'])
  })
})

describe('insertedRandomly', () => {
  it('from 뒤쪽에만 끼운다 — 이미 지나간 자리에 넣지 않는다', () => {
    for (const value of [0, 0.5, 0.999]) {
      const out = insertedRandomly(['a', 'b', 'c'], ['x'], 1, () => value)
      expect(out.slice(0, 2)).toEqual(['a', 'b'])
      expect(out).toHaveLength(4)
      expect(out.indexOf('x')).toBeGreaterThan(1)
    }
  })

  it('from 이 -1 이면 어디든, 끝 자리도 된다', () => {
    expect(insertedRandomly(['a'], ['x'], -1, () => 0)).toEqual(['x', 'a'])
    expect(insertedRandomly(['a'], ['x'], -1, () => 0.999)).toEqual(['a', 'x'])
    expect(insertedRandomly(['a', 'b'], ['x'], 1, () => 0.5)).toEqual(['a', 'b', 'x'])
  })

  it('입력은 바꾸지 않는다', () => {
    const base = ['a', 'b']
    insertedRandomly(base, ['x', 'y'], 0)
    expect(base).toEqual(['a', 'b'])
  })
})
