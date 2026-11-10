/**
 * M9-4 — Moments 화면의 순수 계층 (`features/moments/momentsView.ts`).
 *
 * store 도 DOM 도 없이 본다. 시간 표기 · 제목 3단 · 영상별 묶기와 정렬.
 */
import { describe, expect, it } from 'vitest'

import {
  firstLine,
  formatMomentTime,
  groupMoments,
  libraryTitleIndex,
  resolveMomentTitle,
} from '@/features/moments/momentsView'
import type { Moment } from '@/shared/types'

function moment(overrides: Partial<Moment> = {}): Moment {
  return {
    id: 'm',
    source: 'youtube',
    videoId: 'aaaaaaaaaaa',
    atSeconds: 0,
    note: '',
    title: 'Alpha',
    createdAt: '2026-11-10T01:00:00.000Z',
    updatedAt: '2026-11-10T01:00:00.000Z',
    ...overrides,
  }
}

describe('A. 시간 표기 — YouTube 와 같은 모양', () => {
  it.each([
    [0, '0:00'],
    [5, '0:05'],
    [42, '0:42'],
    [83, '1:23'],
    [599, '9:59'],
    [600, '10:00'],
    [3599, '59:59'],
    [3600, '1:00:00'],
    [3723, '1:02:03'],
    [36_000, '10:00:00'],
  ])('%i 초 → %s', (seconds, expected) => {
    expect(formatMomentTime(seconds)).toBe(expected)
  })

  it('소수는 내림해 보인다 — 저장되는 정수 초와 같은 숫자다', () => {
    expect(formatMomentTime(83.9)).toBe('1:23')
  })

  it.each([
    ['음수', -1],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
  ])('%s 는 숫자를 지어내지 않는다', (_label, seconds) => {
    expect(formatMomentTime(seconds)).toBe('--:--')
  })
})

describe('B. 표시 제목 3단 (MOMENTS_DESIGN §1-1)', () => {
  it('1단 — 라이브러리에 있으면 현재 제목', () => {
    expect(resolveMomentTitle('aaaaaaaaaaa', 'Renamed', 'Old snapshot')).toEqual({
      title: 'Renamed',
      source: 'library',
    })
  })

  it('2단 — 라이브러리에 없으면 저장 당시 스냅샷', () => {
    expect(resolveMomentTitle('aaaaaaaaaaa', undefined, 'Old snapshot')).toEqual({
      title: 'Old snapshot',
      source: 'snapshot',
    })
  })

  it('3단 — 스냅샷도 비어 있으면 트랙과 같은 대체 표기', () => {
    expect(resolveMomentTitle('aaaaaaaaaaa', undefined, '   ')).toEqual({
      title: 'YouTube · aaaaaaaaaaa',
      source: 'fallback',
    })
  })

  it('라이브러리 제목이 공백뿐이면 다음 단으로 간다', () => {
    expect(resolveMomentTitle('aaaaaaaaaaa', ' ', 'Snap').source).toBe('snapshot')
  })
})

describe('C. 라이브러리 제목 표', () => {
  const playlists = [
    { id: 'p1', tracks: [{ videoId: 'aaaaaaaaaaa', title: 'In P1' }] },
    {
      id: 'p2',
      tracks: [
        { videoId: 'aaaaaaaaaaa', title: 'In P2' },
        { videoId: 'bbbbbbbbbbb', title: 'Bravo' },
      ],
    },
  ]

  it('선택된 목록의 이름이 먼저다 — 눌러서 재생되는 트랙과 같은 이름', () => {
    expect(libraryTitleIndex(playlists, 'p2').get('aaaaaaaaaaa')).toBe('In P2')
  })

  it('선택이 없으면 라이브러리 순서에서 처음 만난 이름', () => {
    expect(libraryTitleIndex(playlists, null).get('aaaaaaaaaaa')).toBe('In P1')
  })

  it('없는 영상은 표에 없다', () => {
    expect(libraryTitleIndex(playlists, null).has('zzzzzzzzzzz')).toBe(false)
  })
})

describe('D. 영상별 묶기와 정렬', () => {
  it('영상별로 묶고, 영상은 가장 최근에 만든 순, 안에서는 시점 오름차순', () => {
    const groups = groupMoments(
      [
        moment({
          id: 'a-90',
          videoId: 'aaaaaaaaaaa',
          atSeconds: 90,
          createdAt: '2026-11-10T01:00:00Z',
        }),
        moment({
          id: 'b-10',
          videoId: 'bbbbbbbbbbb',
          atSeconds: 10,
          createdAt: '2026-11-10T02:00:00Z',
        }),
        moment({
          id: 'a-05',
          videoId: 'aaaaaaaaaaa',
          atSeconds: 5,
          createdAt: '2026-11-10T03:00:00Z',
        }),
      ],
      new Map(),
    )

    // A 의 가장 최근(03:00)이 B(02:00)보다 최근이다.
    expect(groups.map((group) => group.videoId)).toEqual(['aaaaaaaaaaa', 'bbbbbbbbbbb'])
    expect(groups[0]?.moments.map((m) => m.id)).toEqual(['a-05', 'a-90'])
  })

  it('같은 시점의 순간을 합치지 않는다 — 먼저 만든 것이 앞', () => {
    const groups = groupMoments(
      [
        moment({ id: 'second', atSeconds: 30, createdAt: '2026-11-10T02:00:00Z' }),
        moment({ id: 'first', atSeconds: 30, createdAt: '2026-11-10T01:00:00Z' }),
      ],
      new Map(),
    )

    expect(groups).toHaveLength(1)
    expect(groups[0]?.moments.map((m) => m.id)).toEqual(['first', 'second'])
  })

  it('메모를 고쳐도(updatedAt) 묶음 순서가 바뀌지 않는다', () => {
    const groups = groupMoments(
      [
        moment({
          id: 'a',
          videoId: 'aaaaaaaaaaa',
          createdAt: '2026-11-10T01:00:00Z',
          updatedAt: '2026-11-10T09:00:00Z',
        }),
        moment({ id: 'b', videoId: 'bbbbbbbbbbb', createdAt: '2026-11-10T02:00:00Z' }),
      ],
      new Map(),
    )

    expect(groups.map((group) => group.videoId)).toEqual(['bbbbbbbbbbb', 'aaaaaaaaaaa'])
  })

  it('해석할 수 없는 날짜는 가장 오래된 것으로 보고 버리지 않는다', () => {
    const groups = groupMoments(
      [
        moment({ id: 'bad', videoId: 'aaaaaaaaaaa', createdAt: 'not-a-date' }),
        moment({ id: 'ok', videoId: 'bbbbbbbbbbb', createdAt: '2026-11-10T01:00:00Z' }),
      ],
      new Map(),
    )

    expect(groups.map((group) => group.videoId)).toEqual(['bbbbbbbbbbb', 'aaaaaaaaaaa'])
    expect(groups.flatMap((group) => group.moments)).toHaveLength(2)
  })

  it('만든 시각이 같으면 나중에 추가된 쪽이 최근이다', () => {
    const groups = groupMoments(
      [
        moment({ id: 'first-added', videoId: 'aaaaaaaaaaa' }),
        moment({ id: 'later-added', videoId: 'bbbbbbbbbbb' }),
      ],
      new Map(),
    )

    expect(groups.map((group) => group.videoId)).toEqual(['bbbbbbbbbbb', 'aaaaaaaaaaa'])
  })

  it('묶음 제목은 라이브러리 → 가장 최근 스냅샷 → 대체 표기', () => {
    const titles = new Map([['aaaaaaaaaaa', 'Library Alpha']])
    const groups = groupMoments(
      [
        moment({ id: 'a', videoId: 'aaaaaaaaaaa', title: 'Snap A' }),
        moment({
          id: 'b-old',
          videoId: 'bbbbbbbbbbb',
          title: 'Bravo (old)',
          createdAt: '2026-11-10T01:00:00Z',
        }),
        moment({
          id: 'b-new',
          videoId: 'bbbbbbbbbbb',
          title: 'Bravo (new)',
          createdAt: '2026-11-10T02:00:00Z',
        }),
        moment({ id: 'c', videoId: 'ccccccccccc', title: '' }),
      ],
      titles,
    )
    const byVideo = Object.fromEntries(groups.map((group) => [group.videoId, group]))

    expect(byVideo.aaaaaaaaaaa).toMatchObject({ title: 'Library Alpha', titleSource: 'library' })
    expect(byVideo.bbbbbbbbbbb).toMatchObject({ title: 'Bravo (new)', titleSource: 'snapshot' })
    expect(byVideo.ccccccccccc).toMatchObject({
      title: 'YouTube · ccccccccccc',
      titleSource: 'fallback',
    })
  })

  it('최근 스냅샷이 비어 있으면 그 전 스냅샷을 쓴다', () => {
    const groups = groupMoments(
      [
        moment({ id: 'old', title: 'Known', createdAt: '2026-11-10T01:00:00Z' }),
        moment({ id: 'new', title: '', createdAt: '2026-11-10T02:00:00Z' }),
      ],
      new Map(),
    )

    expect(groups[0]?.title).toBe('Known')
  })

  it('입력 배열을 바꾸지 않는다 — 저장 순서는 추가 순서 그대로', () => {
    const input = [moment({ id: 'x', atSeconds: 50 }), moment({ id: 'y', atSeconds: 10 })]

    groupMoments(input, new Map())

    expect(input.map((m) => m.id)).toEqual(['x', 'y'])
  })

  it('빈 목록은 빈 묶음이다', () => {
    expect(groupMoments([], new Map())).toEqual([])
  })
})

describe('E. 메모 첫 줄', () => {
  it('첫 줄만 돌려준다', () => {
    expect(firstLine('첫 줄\n둘째 줄')).toBe('첫 줄')
    expect(firstLine('첫 줄\r\n둘째 줄')).toBe('첫 줄')
  })

  it('빈 메모는 빈 문자열이다', () => {
    expect(firstLine('')).toBe('')
    expect(firstLine('   \n뒤')).toBe('')
  })
})
