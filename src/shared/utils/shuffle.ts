/**
 * 셔플 — 순서 섞기 (ADR 0038).
 *
 * 순수 함수다. 난수 함수를 받으므로 테스트가 순서를 정할 수 있다. 기본값은 `Math.random` — 재생 순서를
 * 섞는 데 암호학적 난수가 필요하지 않다.
 */

/** `[0, 1)` 의 수를 돌려주는 난수 함수. `Math.random` 과 같은 모양이다. */
export type RandomSource = () => number

/** `[0, size)` 의 정수 하나. 난수가 범위를 벗어나도 범위 안으로 자른다. */
export function randomIndex(size: number, random: RandomSource = Math.random): number {
  if (size <= 1) return 0
  const pick = Math.floor(random() * size)
  return Math.min(Math.max(pick, 0), size - 1)
}

/** 섞은 **새 배열** (Fisher–Yates). 입력은 바꾸지 않는다. */
export function shuffled<T>(items: readonly T[], random: RandomSource = Math.random): T[] {
  const out = [...items]
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = randomIndex(i + 1, random)
    const a = out[i] as T
    out[i] = out[j] as T
    out[j] = a
  }
  return out
}

/**
 * `base` 의 `from` 자리 **뒤쪽**(from 은 포함하지 않는다)에 `items` 를 하나씩 무작위 자리에 끼운 새 배열.
 *
 * 셔플 중에 목록에 곡이 더해지면 "아직 듣지 않은 곡들" 사이 어딘가에 넣는다 — 이미 지나간 자리에 넣으면
 * 반복이 꺼져 있을 때 영영 들리지 않는다. `from` 이 `-1` 이면 처음부터 어디든 된다.
 */
export function insertedRandomly<T>(
  base: readonly T[],
  items: readonly T[],
  from: number,
  random: RandomSource = Math.random,
): T[] {
  const out = [...base]
  const start = Math.min(Math.max(from + 1, 0), out.length)
  for (const item of items) {
    const at = start + randomIndex(out.length - start + 1, random)
    out.splice(at, 0, item)
  }
  return out
}
