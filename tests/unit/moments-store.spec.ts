/**
 * Music Moments — 도메인 · 검증 · CRUD · 영속 저장 (M9-2).
 *
 *   A  normalizeMoment / normalizeMomentsData — 순수 검증
 *   B  createMoment — 순수 생성
 *   C  CRUD 와 조회
 *   D  영속 저장과 복원
 *   E  데이터 보호 (ADR 0007)
 *   F  묶음 추가 (addMoments) 와 교체 (replaceAllMoments)
 *   G  소스 수준 보장
 *
 * 설계: `docs/architecture/MOMENTS_DESIGN.md` · **ADR 0019** · **ADR 0020**
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { STORAGE_KEYS } from '@/shared/storage'
import type { Moment, MomentsData } from '@/shared/types'
import { MAX_TRACK_TITLE_LENGTH } from '@/stores/library'
import {
  MAX_MOMENT_NOTE_LENGTH,
  MAX_MOMENT_TITLE_LENGTH,
  MOMENTS_STORAGE_VERSION,
  createMoment,
  isValidAtSeconds,
  normalizeMoment,
  normalizeMomentsData,
  useMomentsStore,
} from '@/stores/moments'

const KEY = STORAGE_KEYS.moments
const VIDEO = 'jNQXAC9IVRw'
const OTHER_VIDEO = 'dQw4w9WgXcQ'
const realLocalStorage = globalThis.localStorage

function readSource(relative: string): string {
  return readFileSync(resolve(process.cwd(), relative), 'utf8')
}

/**
 * 주석을 떼고 **실행되는 코드만** 남긴다.
 *
 * 소스 수준 보장을 주석 문구로 판정하면 설명이 늘어난 것만으로 테스트가
 * 깨진다. 이 store 의 주석에는 `localStorage` 가 설명으로 등장한다 —
 * 금지하려는 것은 그 **호출**이다.
 */
function readCode(relative: string): string {
  return readSource(relative)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[^\n]*?\/\/.*$/gm, '')
}

function stubLocalStorage(descriptor: PropertyDescriptor): void {
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, ...descriptor })
}

function seedRaw(raw: string): void {
  globalThis.localStorage.setItem(KEY, raw)
}

function readRaw(): string | null {
  return globalThis.localStorage.getItem(KEY)
}

function envelope(data: unknown, version = MOMENTS_STORAGE_VERSION): string {
  return JSON.stringify({ version, data })
}

/** 저장소에 들어 있는 MomentsData 를 꺼낸다. */
function storedData(): MomentsData {
  return JSON.parse(readRaw() as string).data
}

/** 유효한 Moment 하나. 필드를 덮어쓸 수 있다. */
function moment(overrides: Partial<Moment> = {}): Moment {
  return {
    id: 'm-1',
    source: 'youtube',
    videoId: VIDEO,
    atSeconds: 83,
    note: '여기부터 좋다',
    title: 'Me at the zoo',
    createdAt: '2026-11-07T01:00:00.000Z',
    updatedAt: '2026-11-07T01:00:00.000Z',
    ...overrides,
  }
}

/** 쓰기가 항상 실패하는 저장소로 바꾼다. 읽기는 된다. */
function stubWriteFailure(reason: 'quota' | 'unknown' = 'quota'): void {
  const map = new Map<string, string>()
  stubLocalStorage({
    value: {
      get length() {
        return map.size
      },
      key: (index: number) => [...map.keys()][index] ?? null,
      getItem: (key: string) => map.get(key) ?? null,
      setItem: () => {
        throw reason === 'quota'
          ? new DOMException('full', 'QuotaExceededError')
          : new Error('nope')
      },
      removeItem: (key: string) => void map.delete(key),
      clear: () => map.clear(),
    } satisfies Storage,
    writable: true,
  })
}

beforeEach(() => {
  globalThis.localStorage.clear()
  setActivePinia(createPinia())
})

afterEach(() => {
  stubLocalStorage({ value: realLocalStorage, writable: true })
  globalThis.localStorage.clear()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

/* ================================================================== *
 * A. 순수 검증
 * ================================================================== */

describe('A. normalizeMoment / normalizeMomentsData', () => {
  it('유효한 Moment 를 그대로 통과시킨다', () => {
    const input = moment()

    expect(normalizeMoment(input)).toEqual(input)
  })

  it('알 수 없는 필드는 떨어뜨린다 — 저장 모양을 고정한다', () => {
    const result = normalizeMoment({ ...moment(), trackId: 'should-not-survive' })

    expect(result).not.toBeNull()
    expect(Object.keys(result as Moment).sort()).toEqual([
      'atSeconds',
      'createdAt',
      'id',
      'note',
      'source',
      'title',
      'updatedAt',
      'videoId',
    ])
  })

  it.each([
    ['객체가 아님', 'nope'],
    ['null', null],
    ['배열', []],
    ['id 없음', { ...moment(), id: undefined }],
    ['id 가 빈 문자열', { ...moment(), id: '' }],
    ['id 가 숫자', { ...moment(), id: 7 }],
    ['source 가 다름', { ...moment(), source: 'soundcloud' }],
    ['source 없음', { ...moment(), source: undefined }],
    ['videoId 가 10자', { ...moment(), videoId: 'abcdefghij' }],
    ['videoId 가 12자', { ...moment(), videoId: 'abcdefghijkl' }],
    ['videoId 에 금지 문자', { ...moment(), videoId: 'abcdefghij!' }],
    ['videoId 가 숫자', { ...moment(), videoId: 11111111111 }],
    ['note 가 문자열이 아님', { ...moment(), note: 42 }],
    ['note 없음', { ...moment(), note: undefined }],
    ['title 이 문자열이 아님', { ...moment(), title: { ko: 'x' } }],
    ['title 없음', { ...moment(), title: undefined }],
    ['createdAt 없음', { ...moment(), createdAt: undefined }],
    ['createdAt 이 숫자', { ...moment(), createdAt: 1762477200000 }],
    ['updatedAt 없음', { ...moment(), updatedAt: undefined }],
  ])('%s — 버린다', (_label, input) => {
    expect(normalizeMoment(input)).toBeNull()
  })

  it.each([
    ['0', 0],
    ['1', 1],
    ['큰 값', 86_399],
  ])('atSeconds %s 는 유효하다', (_label, atSeconds) => {
    expect(isValidAtSeconds(atSeconds)).toBe(true)
    expect(normalizeMoment(moment({ atSeconds }))?.atSeconds).toBe(atSeconds)
  })

  it.each([
    ['음수', -1],
    ['음수 소수', -0.5],
    ['소수', 1.5],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['-Infinity', Number.NEGATIVE_INFINITY],
  ])('atSeconds %s 는 거부한다', (_label, atSeconds) => {
    expect(isValidAtSeconds(atSeconds)).toBe(false)
    expect(normalizeMoment(moment({ atSeconds }))).toBeNull()
  })

  it.each([
    ['문자열', '83'],
    ['숫자 모양 문자열 0', '0'],
    ['null', null],
    ['undefined', undefined],
    ['boolean', true],
  ])('atSeconds 가 %s 면 거부한다', (_label, atSeconds) => {
    expect(isValidAtSeconds(atSeconds)).toBe(false)
    expect(normalizeMoment({ ...moment(), atSeconds })).toBeNull()
  })

  /*
   * ⚠ 고쳐서 받지 않는다 (`MOMENTS_DESIGN.md` §2).
   * 반올림·내림해서 살리면 출처를 모르는 값을 사용자 데이터로 승격시킨다.
   */
  it('소수 atSeconds 를 반올림해 살리지 않는다', () => {
    const result = normalizeMomentsData([moment({ atSeconds: 83.4 })])

    expect(result?.data).toEqual([])
    expect(result?.report.droppedMoments).toBe(1)
  })

  it('문자열 atSeconds 를 숫자로 바꿔 살리지 않는다', () => {
    const result = normalizeMomentsData([{ ...moment(), atSeconds: '83' }])

    expect(result?.data).toEqual([])
    expect(result?.report.droppedMoments).toBe(1)
  })

  it('비어 있는 note 와 title 은 유효하다', () => {
    const result = normalizeMoment(moment({ note: '', title: '' }))

    expect(result?.note).toBe('')
    expect(result?.title).toBe('')
  })

  /*
   * 길이 상한은 **입력 경로**의 규칙이다. 이미 저장된 긴 메모를 읽는
   * 자리에서 버리거나 자르면 사용자 데이터가 조용히 사라진다.
   */
  it('상한보다 긴 메모가 저장돼 있어도 버리거나 자르지 않는다', () => {
    const long = 'ㄱ'.repeat(MAX_MOMENT_NOTE_LENGTH + 200)
    const result = normalizeMoment(moment({ note: long }))

    expect(result?.note).toBe(long)
  })

  /*
   * 날짜는 **문자열인지만** 본다. 파싱해서 거부하면 해석하지 못하는
   * 타임스탬프 하나 때문에 메모와 시점까지 함께 잃는다.
   */
  it('해석할 수 없는 날짜 문자열이어도 Moment 를 버리지 않는다', () => {
    const result = normalizeMoment(moment({ createdAt: 'not-a-date', updatedAt: '' }))

    expect(result?.createdAt).toBe('not-a-date')
    expect(result?.updatedAt).toBe('')
  })

  it('배열이 아니면 복구 불가로 null 을 돌려준다', () => {
    expect(normalizeMomentsData({ moments: [] })).toBeNull()
    expect(normalizeMomentsData('nope')).toBeNull()
    expect(normalizeMomentsData(null)).toBeNull()
    expect(normalizeMomentsData(undefined)).toBeNull()
  })

  it('빈 배열은 유효하다 — 버린 것도 없다', () => {
    expect(normalizeMomentsData([])).toEqual({
      data: [],
      report: {
        droppedMoments: 0,
        // M9-5: 이유별 개수가 함께 온다 (가져오기 미리보기용). 모두 0 이다.
        droppedByReason: { shape: 0, 'video-id': 0, time: 0, 'duplicate-id': 0 },
      },
    })
  })

  it('불량 항목만 버리고 나머지를 살린다 — 개수를 센다', () => {
    const result = normalizeMomentsData([
      moment({ id: 'ok-1' }),
      { ...moment({ id: 'bad-1' }), videoId: 'short' },
      moment({ id: 'ok-2', atSeconds: 0 }),
      'nope',
      { ...moment({ id: 'bad-2' }), atSeconds: -3 },
    ])

    expect(result?.data.map((item) => item.id)).toEqual(['ok-1', 'ok-2'])
    expect(result?.report.droppedMoments).toBe(3)
  })

  it('중복 id 는 처음 것만 남긴다', () => {
    const result = normalizeMomentsData([
      moment({ id: 'dup', note: 'first' }),
      moment({ id: 'dup', note: 'second' }),
      moment({ id: 'other', note: 'third' }),
    ])

    expect(result?.data.map((item) => item.note)).toEqual(['first', 'third'])
    expect(result?.report.droppedMoments).toBe(1)
  })

  it('추가된 순서를 유지한다', () => {
    const result = normalizeMomentsData([
      moment({ id: 'c', atSeconds: 30 }),
      moment({ id: 'a', atSeconds: 10 }),
      moment({ id: 'b', atSeconds: 20 }),
    ])

    expect(result?.data.map((item) => item.id)).toEqual(['c', 'a', 'b'])
  })

  it('같은 영상의 여러 Moment 를 모두 살린다', () => {
    const result = normalizeMomentsData([
      moment({ id: 'm1', atSeconds: 10 }),
      moment({ id: 'm2', atSeconds: 20 }),
      moment({ id: 'm3', atSeconds: 10, note: '같은 시점 다른 메모' }),
    ])

    expect(result?.data).toHaveLength(3)
    expect(result?.report.droppedMoments).toBe(0)
  })

  it('라이브러리에 없는 영상의 Moment 도 버리지 않는다 — 참조 정합성을 묻지 않는다', () => {
    // ADR 0019 결정 4. 이 검증은 라이브러리를 아예 모른다.
    const result = normalizeMomentsData([moment({ videoId: 'zzzzzzzzzzz' })])

    expect(result?.data).toHaveLength(1)
  })

  it('입력 배열을 변형하지 않는다', () => {
    const input = [moment({ id: 'a' }), 'bad', moment({ id: 'b' })]
    const snapshot = JSON.stringify(input)

    normalizeMomentsData(input)

    expect(JSON.stringify(input)).toBe(snapshot)
  })
})

/* ================================================================== *
 * B. 순수 생성
 * ================================================================== */

describe('B. createMoment', () => {
  const base = {
    videoId: VIDEO,
    atSeconds: 83,
    note: '좋다',
    title: 'Me at the zoo',
    now: new Date('2026-11-07T02:03:04.000Z'),
    id: 'fixed-id',
  }

  it('주어진 id 와 시각을 그대로 쓴다 — 시계도 난수도 건드리지 않는다', () => {
    expect(createMoment(base)).toEqual({
      id: 'fixed-id',
      source: 'youtube',
      videoId: VIDEO,
      atSeconds: 83,
      note: '좋다',
      title: 'Me at the zoo',
      createdAt: '2026-11-07T02:03:04.000Z',
      updatedAt: '2026-11-07T02:03:04.000Z',
    })
  })

  it('만든 직후 createdAt 과 updatedAt 이 같다', () => {
    const created = createMoment(base)

    expect(created.createdAt).toBe(created.updatedAt)
  })

  it('같은 입력이면 같은 결과다 — 순수하다', () => {
    expect(createMoment(base)).toEqual(createMoment(base))
  })

  it('atSeconds 0 을 그대로 쓴다', () => {
    expect(createMoment({ ...base, atSeconds: 0 }).atSeconds).toBe(0)
  })

  it('메모 앞뒤 공백을 떼고 상한으로 자른다', () => {
    const created = createMoment({ ...base, note: `   ${'가'.repeat(600)}   ` })

    expect(created.note).toHaveLength(MAX_MOMENT_NOTE_LENGTH)
  })

  it('빈 메모를 허용한다', () => {
    expect(createMoment({ ...base, note: '   ' }).note).toBe('')
  })

  it('제목을 상한으로 자른다', () => {
    const created = createMoment({ ...base, title: 'T'.repeat(300) })

    expect(created.title).toHaveLength(MAX_MOMENT_TITLE_LENGTH)
  })

  /*
   * 라이브러리의 `normalizeTitle` 과 **다르다.** 빈 스냅샷은 "저장 당시
   * 제목을 몰랐다" 는 뜻이고, 표시 3단계가 그것을 구별해야 한다
   * (`MOMENTS_DESIGN.md` §1-1).
   */
  it('빈 제목을 대체 표기로 채우지 않는다', () => {
    const created = createMoment({ ...base, title: '' })

    expect(created.title).toBe('')
    expect(created.title).not.toContain('YouTube')
  })

  it('만든 Moment 는 검증을 통과한다 — 다음 복원에서 버려지지 않는다', () => {
    expect(normalizeMoment(createMoment(base))).toEqual(createMoment(base))
  })

  it('트랙 id 를 담지 않는다 — 플레이리스트에 종속되지 않는다', () => {
    expect(Object.keys(createMoment(base))).not.toContain('trackId')
    expect(Object.keys(createMoment(base))).not.toContain('playlistId')
  })

  it('제목 상한이 트랙 제목 상한과 같다', () => {
    // 두 store 를 독립적으로 두려고 상수를 import 하지 않았다. 갈라지지
    // 않게 하는 것은 이 테스트다 (`stores/moments.ts` 주석).
    expect(MAX_MOMENT_TITLE_LENGTH).toBe(MAX_TRACK_TITLE_LENGTH)
  })
})

/* ================================================================== *
 * C. CRUD 와 조회
 * ================================================================== */

describe('C. CRUD 와 조회', () => {
  it('최초 상태가 비어 있다', () => {
    const moments = useMomentsStore()

    expect(moments.moments).toEqual([])
    expect(moments.count).toBe(0)
  })

  it('Moment 를 만들고 고유 id 를 발급한다', () => {
    const moments = useMomentsStore()

    const first = moments.add({ videoId: VIDEO, atSeconds: 10 })
    const second = moments.add({ videoId: VIDEO, atSeconds: 20 })

    expect(first.ok).toBe(true)
    expect(second.ok).toBe(true)
    const ids = moments.moments.map((item) => item.id)
    expect(new Set(ids).size).toBe(2)
    expect(ids.every((id) => id.length > 0)).toBe(true)
  })

  it('만든 Moment 를 id 로 찾는다', () => {
    const moments = useMomentsStore()
    const result = moments.add({ videoId: VIDEO, atSeconds: 42, note: '간주', title: 'ZOO' })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    const found = moments.getMoment(result.momentId)
    expect(found).toMatchObject({
      source: 'youtube',
      videoId: VIDEO,
      atSeconds: 42,
      note: '간주',
      title: 'ZOO',
    })
  })

  it('없는 id 를 찾으면 undefined 다', () => {
    const moments = useMomentsStore()

    expect(moments.getMoment('ghost')).toBeUndefined()
  })

  it('note 와 title 을 생략하면 빈 문자열이다', () => {
    const moments = useMomentsStore()
    moments.add({ videoId: VIDEO, atSeconds: 1 })

    expect(moments.moments[0]).toMatchObject({ note: '', title: '' })
  })

  it('atSeconds 0 을 저장한다 — 영상의 맨 앞이다', () => {
    const moments = useMomentsStore()

    expect(moments.add({ videoId: VIDEO, atSeconds: 0 }).ok).toBe(true)
    expect(moments.moments[0]?.atSeconds).toBe(0)
  })

  it('한 영상에 여러 Moment 를 허용한다', () => {
    const moments = useMomentsStore()
    moments.add({ videoId: VIDEO, atSeconds: 30 })
    moments.add({ videoId: VIDEO, atSeconds: 10 })
    moments.add({ videoId: OTHER_VIDEO, atSeconds: 20 })

    expect(moments.count).toBe(3)
    expect(moments.momentsForVideo(VIDEO)).toHaveLength(2)
  })

  it('같은 영상의 같은 시점도 두 번 저장할 수 있다 — 메모가 다를 수 있다', () => {
    const moments = useMomentsStore()
    moments.add({ videoId: VIDEO, atSeconds: 60, note: '드럼' })
    moments.add({ videoId: VIDEO, atSeconds: 60, note: '베이스' })

    expect(moments.momentsForVideo(VIDEO).map((item) => item.note)).toEqual(['드럼', '베이스'])
  })

  it('목록 조회는 시점 오름차순이고 저장 순서는 추가 순서다', () => {
    const moments = useMomentsStore()
    moments.add({ videoId: VIDEO, atSeconds: 90 })
    moments.add({ videoId: VIDEO, atSeconds: 5 })
    moments.add({ videoId: VIDEO, atSeconds: 45 })

    expect(moments.momentsForVideo(VIDEO).map((item) => item.atSeconds)).toEqual([5, 45, 90])
    // 저장은 추가 순서다 (ADR 0019 결정 5).
    expect(storedData().map((item) => item.atSeconds)).toEqual([90, 5, 45])
  })

  it('momentsForVideo 가 저장 배열의 순서를 바꾸지 않는다', () => {
    const moments = useMomentsStore()
    moments.add({ videoId: VIDEO, atSeconds: 90 })
    moments.add({ videoId: VIDEO, atSeconds: 5 })

    moments.momentsForVideo(VIDEO)

    expect(moments.moments.map((item) => item.atSeconds)).toEqual([90, 5])
  })

  it('없는 영상의 목록은 빈 배열이다', () => {
    const moments = useMomentsStore()
    moments.add({ videoId: VIDEO, atSeconds: 1 })

    expect(moments.momentsForVideo(OTHER_VIDEO)).toEqual([])
  })

  it.each([
    ['10자', 'abcdefghij'],
    ['12자', 'abcdefghijkl'],
    ['빈 문자열', ''],
    ['금지 문자', 'abcdefghij!'],
    ['공백 포함', 'abcdefghi j'],
    ['전체 URL', 'https://www.youtube.com/watch?v=jNQXAC9IVRw'],
  ])('무효한 videoId (%s) 를 거부한다', (_label, videoId) => {
    const moments = useMomentsStore()

    expect(moments.add({ videoId, atSeconds: 10 })).toEqual({
      ok: false,
      reason: 'invalid-video-id',
    })
    expect(moments.moments).toEqual([])
  })

  it.each([
    ['음수', -1],
    ['소수', 1.5],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
  ])('무효한 시간값 (%s) 을 거부한다', (_label, atSeconds) => {
    const moments = useMomentsStore()

    expect(moments.add({ videoId: VIDEO, atSeconds })).toEqual({
      ok: false,
      reason: 'invalid-time',
    })
    expect(moments.moments).toEqual([])
  })

  it('거부된 입력은 기존 데이터를 건드리지 않는다', () => {
    const moments = useMomentsStore()
    moments.add({ videoId: VIDEO, atSeconds: 10, note: '남아야 한다' })
    const before = JSON.stringify(moments.moments)
    const rawBefore = readRaw()

    moments.add({ videoId: 'bad', atSeconds: 10 })
    moments.add({ videoId: VIDEO, atSeconds: -5 })
    moments.add({ videoId: VIDEO, atSeconds: Number.NaN })

    expect(JSON.stringify(moments.moments)).toBe(before)
    expect(readRaw()).toBe(rawBefore)
  })

  it('메모를 고치고 updatedAt 만 갱신한다', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-07T01:00:00.000Z'))
    const moments = useMomentsStore()
    const added = moments.add({ videoId: VIDEO, atSeconds: 42, note: '처음' })
    expect(added.ok).toBe(true)
    if (!added.ok) return
    const before = moments.getMoment(added.momentId) as Moment

    vi.setSystemTime(new Date('2026-11-07T02:00:00.000Z'))
    const result = moments.updateNote(added.momentId, '고친 메모')

    expect(result.ok).toBe(true)
    const after = moments.getMoment(added.momentId) as Moment
    expect(after.note).toBe('고친 메모')
    expect(after.createdAt).toBe(before.createdAt)
    expect(after.updatedAt).toBe('2026-11-07T02:00:00.000Z')
    expect(after.updatedAt).not.toBe(before.updatedAt)
  })

  it('메모를 고쳐도 시점·영상·id 는 그대로다 — 시점은 고치지 못한다', () => {
    const moments = useMomentsStore()
    const added = moments.add({ videoId: VIDEO, atSeconds: 42, title: 'ZOO' })
    if (!added.ok) return

    moments.updateNote(added.momentId, '다른 메모')

    expect(moments.getMoment(added.momentId)).toMatchObject({
      id: added.momentId,
      videoId: VIDEO,
      atSeconds: 42,
      title: 'ZOO',
    })
  })

  it('메모를 비울 수 있다', () => {
    const moments = useMomentsStore()
    const added = moments.add({ videoId: VIDEO, atSeconds: 1, note: '있었다' })
    if (!added.ok) return

    moments.updateNote(added.momentId, '   ')

    expect(moments.getMoment(added.momentId)?.note).toBe('')
  })

  it('고친 메모도 상한으로 자른다', () => {
    const moments = useMomentsStore()
    const added = moments.add({ videoId: VIDEO, atSeconds: 1 })
    if (!added.ok) return

    moments.updateNote(added.momentId, '나'.repeat(900))

    expect(moments.getMoment(added.momentId)?.note).toHaveLength(MAX_MOMENT_NOTE_LENGTH)
  })

  it('없는 Moment 의 메모 수정을 거절한다', () => {
    const moments = useMomentsStore()
    moments.add({ videoId: VIDEO, atSeconds: 1 })
    const before = JSON.stringify(moments.moments)

    expect(moments.updateNote('ghost', 'x')).toEqual({ ok: false, reason: 'not-found' })
    expect(JSON.stringify(moments.moments)).toBe(before)
  })

  it('Moment 하나만 지운다', () => {
    const moments = useMomentsStore()
    const first = moments.add({ videoId: VIDEO, atSeconds: 10 })
    const second = moments.add({ videoId: VIDEO, atSeconds: 20 })
    const third = moments.add({ videoId: OTHER_VIDEO, atSeconds: 30 })
    if (!first.ok || !second.ok || !third.ok) return

    expect(moments.remove(second.momentId).ok).toBe(true)

    expect(moments.moments.map((item) => item.id)).toEqual([first.momentId, third.momentId])
  })

  it('같은 영상의 다른 Moment 는 남는다', () => {
    const moments = useMomentsStore()
    const first = moments.add({ videoId: VIDEO, atSeconds: 10 })
    moments.add({ videoId: VIDEO, atSeconds: 20 })
    if (!first.ok) return

    moments.remove(first.momentId)

    expect(moments.momentsForVideo(VIDEO).map((item) => item.atSeconds)).toEqual([20])
  })

  it('없는 Moment 삭제를 거절하고 상태를 바꾸지 않는다', () => {
    const moments = useMomentsStore()
    moments.add({ videoId: VIDEO, atSeconds: 1 })
    const before = JSON.stringify(moments.moments)

    expect(moments.remove('ghost')).toEqual({ ok: false, reason: 'not-found' })
    expect(JSON.stringify(moments.moments)).toBe(before)
  })

  it('전부 지우는 액션을 제공하지 않는다', () => {
    const moments = useMomentsStore()

    expect('clear' in moments).toBe(false)
    expect('removeAll' in moments).toBe(false)
    expect('reset' in moments).toBe(false)
  })

  it('여러 번 수정한 뒤에도 모든 Moment 가 검증을 통과한다', () => {
    const moments = useMomentsStore()
    const a = moments.add({ videoId: VIDEO, atSeconds: 0, note: 'A' })
    moments.add({ videoId: OTHER_VIDEO, atSeconds: 7, title: 'T'.repeat(300) })
    const c = moments.add({ videoId: VIDEO, atSeconds: 7 })
    if (!a.ok || !c.ok) return
    moments.updateNote(a.momentId, '고침'.repeat(400))
    moments.remove(c.momentId)

    const normalized = normalizeMomentsData(JSON.parse(JSON.stringify(moments.moments)))

    expect(normalized?.report.droppedMoments).toBe(0)
    expect(normalized?.data).toHaveLength(2)
  })
})

/* ================================================================== *
 * D. 영속 저장과 복원
 * ================================================================== */

describe('D. 영속 저장과 복원', () => {
  it('추가하면 저장소에 쓴다 — 봉투에 version 과 data 를 담는다', () => {
    const moments = useMomentsStore()
    const result = moments.add({ videoId: VIDEO, atSeconds: 42, note: '좋다' })

    expect(result.ok && result.persisted).toBe(true)
    const parsed = JSON.parse(readRaw() as string)
    expect(parsed.version).toBe(MOMENTS_STORAGE_VERSION)
    expect(parsed.data).toHaveLength(1)
  })

  it('저장 키는 39page.moments 다', () => {
    const moments = useMomentsStore()
    moments.add({ videoId: VIDEO, atSeconds: 1 })

    expect(STORAGE_KEYS.moments).toBe('39page.moments')
    expect(globalThis.localStorage.getItem('39page.moments')).not.toBeNull()
  })

  it('새로고침에 해당하는 복원에서 그대로 돌아온다', () => {
    const first = useMomentsStore()
    first.add({ videoId: VIDEO, atSeconds: 42, note: '간주', title: 'ZOO' })
    first.add({ videoId: OTHER_VIDEO, atSeconds: 0 })
    const saved = JSON.parse(JSON.stringify(first.moments))

    // 새 Pinia = 새로고침.
    setActivePinia(createPinia())
    const second = useMomentsStore()

    expect(second.restore()).toBe('stored')
    expect(second.moments).toEqual(saved)
    expect(second.status).toBe('ready')
  })

  it('메모 수정과 삭제도 저장된다', () => {
    const first = useMomentsStore()
    const a = first.add({ videoId: VIDEO, atSeconds: 10, note: '처음' })
    const b = first.add({ videoId: VIDEO, atSeconds: 20 })
    if (!a.ok || !b.ok) return
    first.updateNote(a.momentId, '고침')
    first.remove(b.momentId)

    setActivePinia(createPinia())
    const second = useMomentsStore()
    second.restore()

    expect(second.moments).toHaveLength(1)
    expect(second.moments[0]?.note).toBe('고침')
  })

  it('키가 없으면 빈 목록이고 오류가 아니다', () => {
    const moments = useMomentsStore()

    expect(moments.restore()).toBe('empty')
    expect(moments.moments).toEqual([])
    expect(moments.status).toBe('ready')
    expect(moments.protectedReason).toBeNull()
    expect(moments.canPersist).toBe(true)
  })

  it('저장된 빈 배열도 정상이다', () => {
    seedRaw(envelope([]))
    const moments = useMomentsStore()

    expect(moments.restore()).toBe('stored')
    expect(moments.status).toBe('ready')
  })

  it('복원만으로 저장소에 쓰지 않는다', () => {
    const raw = envelope([moment()])
    seedRaw(raw)
    const moments = useMomentsStore()

    moments.restore()

    expect(readRaw()).toBe(raw)
  })

  it('복원 후 다시 저장할 수 있다', () => {
    seedRaw(envelope([moment({ id: 'kept' })]))
    const moments = useMomentsStore()
    moments.restore()

    const result = moments.add({ videoId: OTHER_VIDEO, atSeconds: 5 })

    expect(result.ok && result.persisted).toBe(true)
    expect(storedData()).toHaveLength(2)
    expect(storedData()[0]?.id).toBe('kept')
  })
})

/* ================================================================== *
 * E. 데이터 보호 (ADR 0007)
 * ================================================================== */

describe('E. 데이터 보호', () => {
  it.each([
    ['손상된 JSON', '{not json', 'malformed'],
    ['봉투가 아님', JSON.stringify(['bare', 'array']), 'malformed'],
    ['배열이 아닌 data', envelope({ moments: [] }), 'invalid'],
    ['문자열 data', envelope('nope'), 'invalid'],
  ])('%s — 보호 상태가 되고 원본을 남긴다', (_label, raw, reason) => {
    seedRaw(raw)
    const moments = useMomentsStore()

    moments.restore()

    expect(moments.status).toBe('protected')
    expect(moments.protectedReason).toBe(reason)
    expect(moments.canPersist).toBe(false)
    expect(readRaw()).toBe(raw)
  })

  it('미래 Storage 버전을 보존하고 보호 상태가 된다', () => {
    const future = envelope([moment()], MOMENTS_STORAGE_VERSION + 1)
    seedRaw(future)
    const moments = useMomentsStore()

    expect(moments.restore()).toBe('version-mismatch')
    expect(moments.status).toBe('protected')
    expect(moments.protectedReason).toBe('version-mismatch')
    expect(moments.moments).toEqual([])
    expect(readRaw()).toBe(future)
  })

  it('미래 버전 데이터를 추측해 변환하지 않는다', () => {
    seedRaw(envelope([{ id: 'x', futureShape: true }], 99))
    const moments = useMomentsStore()

    moments.restore()

    expect(moments.moments).toEqual([])
  })

  it('일부만 복구하면 보호 상태가 된다 — 버린 항목을 덮어쓰지 않는다', () => {
    const raw = envelope([moment({ id: 'good' }), { ...moment({ id: 'bad' }), atSeconds: 1.5 }])
    seedRaw(raw)
    const moments = useMomentsStore()

    moments.restore()

    expect(moments.moments.map((item) => item.id)).toEqual(['good'])
    expect(moments.status).toBe('protected')
    expect(moments.protectedReason).toBe('partial-recovery')
    expect(readRaw()).toBe(raw)
  })

  it('중복 id 를 버린 것도 일부 복구로 본다', () => {
    const raw = envelope([moment({ id: 'dup' }), moment({ id: 'dup', note: '둘째' })])
    seedRaw(raw)
    const moments = useMomentsStore()

    moments.restore()

    expect(moments.moments).toHaveLength(1)
    expect(moments.protectedReason).toBe('partial-recovery')
  })

  it.each([
    ['손상된 JSON', '{not json'],
    ['복구 불가 data', JSON.stringify({ version: MOMENTS_STORAGE_VERSION, data: {} })],
    ['미래 버전', JSON.stringify({ version: 99, data: [] })],
    [
      '일부 복구',
      JSON.stringify({
        version: MOMENTS_STORAGE_VERSION,
        data: [
          {
            id: 'good',
            source: 'youtube',
            videoId: 'jNQXAC9IVRw',
            atSeconds: 1,
            note: '',
            title: '',
            createdAt: 'x',
            updatedAt: 'x',
          },
          { id: 'bad' },
        ],
      }),
    ],
  ])('%s — 이후 추가가 원본을 덮어쓰지 않는다', (_label, raw) => {
    seedRaw(raw)
    const moments = useMomentsStore()
    moments.restore()

    const result = moments.add({ videoId: OTHER_VIDEO, atSeconds: 7 })

    // 메모리에는 반영되지만 저장소는 그대로다.
    expect(result.ok).toBe(true)
    expect(result.ok && result.persisted).toBe(false)
    expect(moments.moments.some((item) => item.videoId === OTHER_VIDEO)).toBe(true)
    expect(readRaw()).toBe(raw)
  })

  it('보호 상태에서 메모 수정과 삭제도 저장되지 않는다', () => {
    const raw = envelope([moment({ id: 'good' }), { id: 'bad' }])
    seedRaw(raw)
    const moments = useMomentsStore()
    moments.restore()

    const edited = moments.updateNote('good', '고침')
    const removed = moments.remove('good')

    expect(edited.ok && edited.persisted).toBe(false)
    expect(removed.ok && removed.persisted).toBe(false)
    expect(readRaw()).toBe(raw)
  })

  it('잘못된 데이터를 조용히 삭제하거나 빈 목록으로 초기화하지 않는다', () => {
    const raw = '{완전히 깨진 값'
    seedRaw(raw)
    const moments = useMomentsStore()

    moments.restore()
    moments.add({ videoId: VIDEO, atSeconds: 1 })
    moments.remove(moments.moments[0]?.id ?? '')

    expect(readRaw()).toBe(raw)
  })

  it('localStorage 접근 실패를 unavailable 로 처리한다', () => {
    stubLocalStorage({
      get() {
        throw new Error('blocked')
      },
    })
    const moments = useMomentsStore()

    expect(moments.restore()).toBe('unavailable')
    expect(moments.status).toBe('unavailable')
    expect(moments.canPersist).toBe(false)
    expect(moments.protectedReason).toBeNull()
  })

  it('저장소를 쓸 수 없어도 메모리에서는 동작한다', () => {
    stubLocalStorage({
      get() {
        throw new Error('blocked')
      },
    })
    const moments = useMomentsStore()
    moments.restore()

    const result = moments.add({ videoId: VIDEO, atSeconds: 9 })

    expect(result.ok).toBe(true)
    expect(result.ok && result.persisted).toBe(false)
    expect(moments.moments).toHaveLength(1)
  })

  it('쓰기 실패해도 메모리 수정은 유지되고 이유를 알린다', () => {
    stubWriteFailure('quota')
    const moments = useMomentsStore()

    const result = moments.add({ videoId: VIDEO, atSeconds: 11, note: '남는다' })

    expect(result.ok).toBe(true)
    expect(result.ok && result.persisted).toBe(false)
    expect(moments.moments[0]?.note).toBe('남는다')
    expect(moments.lastWriteFailure).toBe('quota-exceeded')
  })

  it('그 외 쓰기 오류도 삼키지 않는다', () => {
    stubWriteFailure('unknown')
    const moments = useMomentsStore()

    moments.add({ videoId: VIDEO, atSeconds: 11 })

    expect(moments.lastWriteFailure).toBe('unknown')
  })

  it('쓰기가 다시 성공하면 실패 기록을 지운다', () => {
    const moments = useMomentsStore()
    moments.add({ videoId: VIDEO, atSeconds: 1 })

    expect(moments.lastWriteFailure).toBeNull()
  })
})

/* ================================================================== *
 * F. 묶음 추가와 교체
 * ================================================================== */

describe('F. addMoments 와 replaceAllMoments', () => {
  it('묶음으로 더하고 기존 Moment 를 남긴다', () => {
    const moments = useMomentsStore()
    moments.add({ videoId: VIDEO, atSeconds: 1, note: '먼저' })

    const result = moments.addMoments([moment({ id: 'in-1' }), moment({ id: 'in-2' })])

    expect(result).toMatchObject({ ok: true, added: 2, dropped: 0, persisted: true })
    expect(moments.count).toBe(3)
    expect(moments.moments[0]?.note).toBe('먼저')
  })

  it('불량 항목만 버리고 개수를 알린다', () => {
    const moments = useMomentsStore()

    const result = moments.addMoments([
      moment({ id: 'ok' }),
      { ...moment({ id: 'bad-time' }), atSeconds: -1 },
      'nope',
    ])

    expect(result).toMatchObject({ added: 1, dropped: 2 })
    expect(moments.moments.map((item) => item.id)).toEqual(['ok'])
  })

  it('이미 있는 id 는 버린다 — 기존 값을 덮어쓰지 않는다', () => {
    const moments = useMomentsStore()
    moments.addMoments([moment({ id: 'dup', note: '원본' })])

    const result = moments.addMoments([moment({ id: 'dup', note: '나중' })])

    expect(result).toMatchObject({ added: 0, dropped: 1 })
    expect(moments.moments).toHaveLength(1)
    expect(moments.moments[0]?.note).toBe('원본')
  })

  it('한 묶음 안의 중복 id 도 처음 것만 받는다', () => {
    const moments = useMomentsStore()

    const result = moments.addMoments([
      moment({ id: 'x', note: '첫째' }),
      moment({ id: 'x', note: '둘째' }),
    ])

    expect(result).toMatchObject({ added: 1, dropped: 1 })
    expect(moments.moments[0]?.note).toBe('첫째')
  })

  it('배열이 아니면 아무것도 하지 않는다', () => {
    const moments = useMomentsStore()
    moments.add({ videoId: VIDEO, atSeconds: 1 })
    const before = JSON.stringify(moments.moments)

    expect(moments.addMoments({ moments: [] })).toMatchObject({ added: 0, dropped: 0 })
    expect(JSON.stringify(moments.moments)).toBe(before)
  })

  it('받을 것이 없으면 저장하지 않는다', () => {
    seedRaw(envelope([moment({ id: 'bad' }), { id: 'x' }]))
    const moments = useMomentsStore()
    moments.restore()
    const raw = readRaw()

    expect(moments.addMoments(['nope']).persisted).toBe(false)
    expect(readRaw()).toBe(raw)
  })

  it('보호 상태에서는 묶음 추가도 저장되지 않는다', () => {
    const raw = envelope([moment({ id: 'good' }), { id: 'bad' }])
    seedRaw(raw)
    const moments = useMomentsStore()
    moments.restore()

    const result = moments.addMoments([moment({ id: 'new' })])

    expect(result).toMatchObject({ added: 1, persisted: false })
    expect(readRaw()).toBe(raw)
  })

  it('replaceAllMoments 는 보호를 우회해 저장하고 보호를 푼다', () => {
    const raw = envelope([moment({ id: 'unreadable' }), { id: 'bad' }])
    seedRaw(raw)
    const moments = useMomentsStore()
    moments.restore()
    expect(moments.status).toBe('protected')

    const result = moments.replaceAllMoments([moment({ id: 'from-backup' })])

    expect(result).toEqual({ ok: true, persisted: true, writeFailure: null, verified: true })
    expect(moments.status).toBe('ready')
    expect(moments.protectedReason).toBeNull()
    expect(storedData().map((item) => item.id)).toEqual(['from-backup'])
  })

  it('빈 목록으로도 교체한다 — 사용자가 승인한 결과다', () => {
    const moments = useMomentsStore()
    moments.add({ videoId: VIDEO, atSeconds: 1 })

    expect(moments.replaceAllMoments([]).persisted).toBe(true)
    expect(moments.moments).toEqual([])
    expect(storedData()).toEqual([])
  })

  it('교체는 넘긴 객체와 참조를 공유하지 않는다', () => {
    const moments = useMomentsStore()
    const input = [moment({ id: 'a', note: '원본' })]

    moments.replaceAllMoments(input)
    const first = input[0]
    if (first !== undefined) first.note = '밖에서 고침'

    expect(moments.moments[0]?.note).toBe('원본')
  })

  it('교체 저장이 실패하면 보호를 풀지 않고 이유를 알린다', () => {
    stubWriteFailure('quota')
    const moments = useMomentsStore()
    moments.restore()
    // 쓰기만 실패하는 저장소다. 읽기는 비어 있으므로 상태는 ready 다.
    const result = moments.replaceAllMoments([moment({ id: 'x' })])

    expect(result).toEqual({
      ok: true,
      persisted: false,
      writeFailure: 'quota-exceeded',
      verified: false,
    })
    expect(moments.moments).toHaveLength(1)
  })

  it('교체 저장이 실패해도 보호 상태가 유지된다', () => {
    const raw = envelope([moment({ id: 'good' }), { id: 'bad' }])
    seedRaw(raw)
    const moments = useMomentsStore()
    moments.restore()
    expect(moments.status).toBe('protected')

    // 복원 후에 쓰기만 막는다.
    const original = globalThis.localStorage
    stubLocalStorage({
      value: {
        get length() {
          return original.length
        },
        key: (index: number) => original.key(index),
        getItem: (key: string) => original.getItem(key),
        setItem: () => {
          throw new DOMException('full', 'QuotaExceededError')
        },
        removeItem: (key: string) => original.removeItem(key),
        clear: () => original.clear(),
      } satisfies Storage,
      writable: true,
    })

    const result = moments.replaceAllMoments([moment({ id: 'x' })])

    expect(result.persisted).toBe(false)
    expect(moments.status).toBe('protected')
    expect(moments.protectedReason).toBe('partial-recovery')
  })
})

/* ================================================================== *
 * G. 소스 수준 보장
 * ================================================================== */

describe('G. 소스 수준 보장', () => {
  const source = () => readSource('src/stores/moments.ts')

  const code = () => readCode('src/stores/moments.ts')

  it('Moments store 가 라이브러리 store 를 import 하지 않는다', () => {
    expect(source()).not.toContain("from '@/stores/library'")
    expect(code()).not.toContain('useLibraryStore')
  })

  it('Moments store 가 재생을 모른다', () => {
    expect(code()).not.toContain('usePlaybackStore')
    expect(code()).not.toContain('PlayerAdapter')
    expect(code()).not.toContain('YT.')
  })

  it('Moments store 가 localStorage 를 직접 만지지 않는다 — 저장 계층만 쓴다', () => {
    expect(code()).not.toContain('localStorage')
    expect(code()).not.toContain('setItem')
    expect(code()).not.toContain('getItem')
    expect(code()).toContain('defineStorage')
  })

  it('videoId 검증을 따로 만들지 않고 기존 것을 쓴다', () => {
    expect(code()).toContain('isYouTubeVideoId')
    // 11자 패턴을 다시 적지 않는다.
    expect(code()).not.toContain('{11}')
  })

  it('기존 저장 키를 건드리지 않는다', () => {
    const keys = readSource('src/shared/storage/keys.ts')

    expect(keys).toContain("library: '39page.library'")
    expect(keys).toContain("theme: '39page.theme'")
    expect(keys).toContain("moments: '39page.moments'")
  })

  /*
   * ⚠ ADR 0007 의 보호가 무의미해지지 않게 호출 지점을 고정한다.
   * M9-2 에는 호출부가 **없다.** 가져오기 통합은 M9-5 다.
   */
  /*
   * M9-5 부터 가져오기가 부른다. `library.replaceAll` 과 같은 방식으로, 그
   * **한 곳뿐**임을 고정한다 — 다른 곳에서 부르면 ADR 0007 이 무의미해진다.
   */
  it('replaceAllMoments 는 가져오기 경로에서만 불린다', () => {
    const callers: string[] = []
    for (const file of [
      'src/features/backup/useBackupImport.ts',
      'src/features/backup/useBackupExport.ts',
      'src/features/backup/createBackup.ts',
      'src/features/backup/readBackup.ts',
      'src/features/backup/BackupPanel.vue',
      'src/features/library/RecordLibraryDrawer.vue',
      'src/features/library/PlaylistWidget.vue',
      'src/features/library/TrackList.vue',
      'src/features/playback/createPlaybackCoordinator.ts',
      'src/components/layout/DashboardShell.vue',
      'src/main.ts',
    ]) {
      if (readCode(file).includes('replaceAllMoments')) callers.push(file)
    }

    expect(callers).toEqual(['src/features/backup/useBackupImport.ts'])
  })

  /*
   * M9-2 ~ M9-4 동안 이 자리는 "백업에 Moments 가 **아직 없다**" 를 고정했다.
   * M9-5 에서 백업에 들어갔으므로 반대를 고정한다 — 두 내보내기 경로(DATA 패널,
   * 가져오기 전 "지금 데이터 먼저 내보내기")가 모두 Moments 를 넘긴다.
   * 동작은 `backup-moments.spec.ts` 가 본다.
   */
  it('두 내보내기 경로가 모두 Moments 를 담는다 (M9-5)', () => {
    expect(readCode('src/features/backup/backupSchema.ts')).toContain(
      'moments: MOMENTS_STORAGE_VERSION',
    )
    expect(readCode('src/features/backup/useBackupExport.ts')).toContain('moments: moments.moments')
    expect(readCode('src/features/backup/useBackupImport.ts')).toContain('moments: moments.moments')
  })
})
