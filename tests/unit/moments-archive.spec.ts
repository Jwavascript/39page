/**
 * M11-4 — Moments 보관함: 묶음 접기 · 검색 · 보기(전체 · 최근 · 이 곡 · 한 곡) · 점진 표시 · 라이브러리 연결.
 *
 * 순수 계층(`momentsSearch.ts`)은 고정값으로, 화면은 앱 전체를 띄워(`main.ts` 와 같은 순서) 확인한다.
 * 데이터 · 저장 키는 바뀌지 않는다 — 검색 · 접기 · 보기는 화면 상태이고 저장소에 쓰지 않는다.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { nextTick } from 'vue'

import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import App from '@/app/App.vue'
import {
  buildSearchIndex,
  defaultExpanded,
  highlight,
  noteLine,
  normalizeForSearch,
  playlistsByVideo,
  recentMoments,
  searchMoments,
  searchTerms,
} from '@/features/moments/momentsSearch'
import { groupMoments } from '@/features/moments/momentsView'
import { SEARCH_DEBOUNCE_MS } from '@/features/moments/useMomentsArchive'
import { FakePlayerAdapter } from '@/features/playback/FakePlayerAdapter'
import { PLAYER_ADAPTER_FACTORY } from '@/features/playback/PlayerAdapter'
import { STORAGE_KEYS } from '@/shared/storage'
import type { Moment } from '@/shared/types'
import { useLibraryStore } from '@/stores/library'
import { MOMENTS_STORAGE_VERSION, useMomentsStore } from '@/stores/moments'
import { usePlaybackStore } from '@/stores/playback'
import { useThemeStore } from '@/stores/theme'

import { installPlayerRect, uninstallPlayerRect } from '../support/playerLayout'

const A = 'aaaaaaaaaaa'
const B = 'bbbbbbbbbbb'
const C = 'ccccccccccc'
const GONE = 'zzzzzzzzzzz'

/** 11자 영상 ID. */
const vid = (i: number): string => `v${String(i).padStart(10, '0')}`

function moment(overrides: Partial<Moment> = {}): Moment {
  return {
    id: 'm-1',
    source: 'youtube',
    videoId: A,
    atSeconds: 10,
    note: '',
    title: 'Alpha',
    createdAt: '2026-11-10T01:00:00.000Z',
    updatedAt: '2026-11-10T01:00:00.000Z',
    ...overrides,
  }
}

/** 영상 `songs` 개에 Moment `perSong` 개씩. 뒤 영상일수록 최근에 저장했다. */
function bulk(songs: number, perSong: number, note = (i: number) => `note ${String(i)}`): Moment[] {
  const out: Moment[] = []
  for (let s = 0; s < songs; s += 1) {
    for (let k = 0; k < perSong; k += 1) {
      const n = s * perSong + k
      out.push(
        moment({
          id: `m${String(n)}`,
          videoId: vid(s),
          atSeconds: k * 7,
          note: note(n),
          title: `Song ${String(s)}`,
          createdAt: new Date(Date.UTC(2026, 0, 1) + n * 60_000).toISOString(),
        }),
      )
    }
  }
  return out
}

function seedMoments(data: Moment[]): void {
  globalThis.localStorage.setItem(
    STORAGE_KEYS.moments,
    JSON.stringify({ version: MOMENTS_STORAGE_VERSION, data }),
  )
}

function seedLibrary(): void {
  globalThis.localStorage.setItem(
    STORAGE_KEYS.library,
    JSON.stringify({
      version: 1,
      data: {
        playlists: [
          {
            id: 'list',
            name: 'LIST',
            tracks: [
              { id: 't-a', source: 'youtube', videoId: A, title: 'Alpha' },
              { id: 't-b', source: 'youtube', videoId: B, title: 'Bravo' },
            ],
          },
          {
            id: 'drive',
            name: '드라이브',
            tracks: [
              { id: 'd-c', source: 'youtube', videoId: C, title: 'Charlie' },
              { id: 'd-a', source: 'youtube', videoId: A, title: 'Alpha (live)' },
              { id: 'd-a2', source: 'youtube', videoId: A, title: 'Alpha again' },
            ],
          },
        ],
        selectedPlaylistId: 'list',
      },
    }),
  )
}

function boot() {
  seedLibrary()
  setActivePinia(createPinia())
  useThemeStore().restore()
  const library = useLibraryStore()
  library.restore()
  const moments = useMomentsStore()
  moments.restore()
  const fake = new FakePlayerAdapter()
  const wrapper = mount(App, {
    attachTo: document.body,
    global: { provide: { [PLAYER_ADAPTER_FACTORY as symbol]: () => fake } },
  })
  return { wrapper, fake, library, moments, playback: usePlaybackStore() }
}

type Session = ReturnType<typeof boot>

async function settle(): Promise<void> {
  await flushPromises()
  await nextTick()
}

async function openMoments(s: Session) {
  await s.wrapper.findAll('.app-nav button')[1]?.trigger('click')
  await settle()
  return s.wrapper.get('#archive-panel-moments')
}

const panel = (s: Session) => s.wrapper.get('#archive-panel-moments')
const heads = (s: Session) => panel(s).findAll('.group-toggle')
const rows = (s: Session) => panel(s).findAll('.moment-item')
const searchBox = (s: Session) => panel(s).get<HTMLInputElement>('#archive-moments-search')
const summary = (s: Session) => panel(s).get('#archive-moments-summary')

async function search(s: Session, text: string): Promise<void> {
  await searchBox(s).setValue(text)
  vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS)
  await settle()
}

async function playFromStart(s: Session): Promise<void> {
  await s.wrapper.get('.playlist-tile .playlist-play').trigger('click')
  await flushPromises()
  s.fake.emitReady()
  s.fake.emitStateChange('playing')
  s.fake.emitPosition(5)
  await nextTick()
}

beforeEach(() => {
  globalThis.localStorage.clear()
  delete document.documentElement.dataset.theme
  document.documentElement.style.overflow = ''
  installPlayerRect()
})

afterEach(() => {
  vi.useRealTimers()
  globalThis.localStorage.clear()
  uninstallPlayerRect()
  delete document.documentElement.dataset.theme
  document.documentElement.style.overflow = ''
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

/* ================================================================== *
 * A. 순수 계층
 * ================================================================== */

describe('A. 검색 · 보기 계산 (순수)', () => {
  it('정규화 — NFC · 소문자. 분해된 한글(NFD)도 같은 글자로 찾는다', () => {
    const nfd = '후렴'.normalize('NFD')
    expect(nfd).not.toBe('후렴')
    expect(normalizeForSearch(nfd)).toBe('후렴')
    expect(normalizeForSearch('Never GONNA')).toBe('never gonna')
    expect(searchTerms('  Drive   drive 후렴 ')).toEqual(['drive', '후렴'])
    expect(searchTerms('   ')).toEqual([])
  })

  it('낱말은 모두 있어야 맞는다 — 제목의 낱말과 메모의 낱말을 섞어도 된다', () => {
    const groups = groupMoments(
      [
        moment({ id: '1', videoId: A, note: '후렴 직전' }),
        moment({ id: '2', videoId: A, note: '베이스' }),
        moment({ id: '3', videoId: B, title: 'Bravo', note: '후렴' }),
      ],
      new Map([[A, 'Drive Song']]),
    )
    const index = buildSearchIndex(groups)
    expect(searchMoments(index, [])).toBeNull()
    expect([...(searchMoments(index, searchTerms('drive')) ?? [])].sort()).toEqual(['1', '2'])
    expect([...(searchMoments(index, searchTerms('drive 후렴')) ?? [])]).toEqual(['1'])
    expect([...(searchMoments(index, searchTerms('후렴')) ?? [])].sort()).toEqual(['1', '3'])
    // 저장 당시 스냅샷 제목(Alpha)으로도 — 목록에서 이름을 바꿨어도 옛 이름으로 찾는다.
    expect([...(searchMoments(index, searchTerms('alpha')) ?? [])].sort()).toEqual(['1', '2'])
  })

  it('강조 조각 — 대소문자를 무시하고 원문 글자를 그대로 돌려준다', () => {
    expect(highlight('Never Gonna', ['gon'])).toEqual([
      { text: 'Never ', match: false },
      { text: 'Gon', match: true },
      { text: 'na', match: false },
    ])
    expect(highlight('abc', [])).toEqual([{ text: 'abc', match: false }])
    // 길이가 바뀌는 대소문자 변환 — 자리를 맞출 수 없으면 강조하지 않는다.
    expect(highlight('İstanbul', ['stan'])).toEqual([{ text: 'İstanbul', match: false }])
  })

  it('한 줄 메모 — 검색 낱말이 둘째 줄에만 있으면 그 줄을 보인다', () => {
    expect(noteLine('첫 줄\n둘째 줄 후렴', [])).toBe('첫 줄')
    expect(noteLine('첫 줄\n둘째 줄 후렴', ['후렴'])).toBe('… 둘째 줄 후렴')
    expect(noteLine('후렴 첫 줄\n둘째', ['후렴'])).toBe('후렴 첫 줄')
  })

  it('기본 펼침 — 6묶음까지 모두, 넘으면 최근 3묶음과 지금 곡. 좁힌 보기 · 검색은 모두 펼친다', () => {
    const at = (position: number, groupCount: number, isCurrent = false) =>
      defaultExpanded({ view: 'all', searching: false, groupCount, position, isCurrent })
    expect([0, 1, 2, 3, 4, 5].map((p) => at(p, 6))).toEqual(Array(6).fill(true))
    expect([0, 1, 2, 3].map((p) => at(p, 7))).toEqual([true, true, true, false])
    expect(at(40, 300, true)).toBe(true)
    for (const view of ['current', 'video', 'recent'] as const) {
      expect(
        defaultExpanded({ view, searching: false, groupCount: 99, position: 50, isCurrent: false }),
      ).toBe(true)
    }
    expect(
      defaultExpanded({
        view: 'all',
        searching: true,
        groupCount: 99,
        position: 50,
        isCurrent: false,
      }),
    ).toBe(true)
  })

  it('최근 — 저장 시각 역순, 같은 시각이면 나중에 추가된 것이 앞, 해석 못 하는 날짜는 맨 뒤', () => {
    const list = [
      moment({ id: 'old', createdAt: '2026-01-01T00:00:00Z' }),
      moment({ id: 'bad', createdAt: 'not-a-date' }),
      moment({ id: 'new', createdAt: '2026-03-01T00:00:00Z' }),
      moment({ id: 'new-later', createdAt: '2026-03-01T00:00:00Z' }),
    ]
    expect(recentMoments(list).map((m) => m.id)).toEqual(['new-later', 'new', 'old', 'bad'])
    expect(list.map((m) => m.id)).toEqual(['old', 'bad', 'new', 'new-later'])
  })

  it('영상이 든 목록 — 한 목록에 여러 번 있어도 한 번, 라이브러리 순서', () => {
    const index = playlistsByVideo([
      { id: 'x', name: 'X', tracks: [{ videoId: A }, { videoId: A }, { videoId: B }] },
      { id: 'y', name: 'Y', tracks: [{ videoId: A }] },
    ])
    expect(index.get(A)).toEqual([
      { id: 'x', name: 'X' },
      { id: 'y', name: 'Y' },
    ])
    expect(index.get(B)).toEqual([{ id: 'x', name: 'X' }])
    expect(index.get(GONE)).toBeUndefined()
  })
})

/* ================================================================== *
 * B. 묶음 접기 · 점진 표시
 * ================================================================== */

describe('B. 묶음 접기 · 점진 표시', () => {
  it('6묶음 이하는 모두 펼친다', async () => {
    seedMoments(bulk(6, 2))
    const s = boot()
    await openMoments(s)
    expect(heads(s)).toHaveLength(6)
    expect(heads(s).every((h) => h.attributes('aria-expanded') === 'true')).toBe(true)
    expect(rows(s)).toHaveLength(12)
  })

  it('넘으면 최근 3묶음만 펼친다 — 접힌 묶음은 줄을 그리지 않고, 머리를 누르면 펼친다', async () => {
    seedMoments(bulk(10, 3))
    const s = boot()
    await openMoments(s)

    // 최근에 저장한 영상(뒤 번호)이 위다.
    expect(heads(s)[0]?.text()).toContain('Song 9')
    expect(heads(s).map((h) => h.attributes('aria-expanded'))).toEqual([
      'true',
      'true',
      'true',
      'false',
      'false',
      'false',
      'false',
      'false',
      'false',
      'false',
    ])
    expect(rows(s)).toHaveLength(9)

    const fourth = heads(s)[3]
    expect(fourth?.attributes('aria-controls')).toBe(`archive-moment-rows-${vid(6)}`)
    expect(fourth?.text()).toContain('3개')
    expect(fourth?.text()).toContain('목록에 없음')
    await fourth?.trigger('click')
    await nextTick()
    expect(heads(s)[3]?.attributes('aria-expanded')).toBe('true')
    expect(
      panel(s)
        .find(`#archive-moment-rows-${vid(6)}`)
        .exists(),
    ).toBe(true)
    expect(rows(s)).toHaveLength(12)

    // 접기 — 펼쳐 있던 묶음도.
    await heads(s)[0]?.trigger('click')
    await nextTick()
    expect(heads(s)[0]?.attributes('aria-expanded')).toBe('false')
    expect(rows(s)).toHaveLength(9)
  })

  it('묶음을 30개씩 그린다 — "더 보기" 로 다음 30개, 새 첫 묶음으로 포커스', async () => {
    seedMoments(bulk(70, 1))
    const s = boot()
    await openMoments(s)

    expect(heads(s)).toHaveLength(30)
    const more = () => panel(s).get('.more button')
    expect(more().text()).toBe('곡 30개 더 보기 · 남은 40곡')

    await more().trigger('click')
    await nextTick()
    await nextTick()
    expect(heads(s)).toHaveLength(60)
    expect(document.activeElement).toBe(heads(s)[30]?.element)
    expect(more().text()).toBe('곡 10개 더 보기 · 남은 10곡')

    await more().trigger('click')
    await nextTick()
    expect(heads(s)).toHaveLength(70)
    expect(panel(s).find('.more').exists()).toBe(false)
  })

  it('한 곡에 순간이 많으면 묶음 안에서도 50줄씩', async () => {
    seedMoments(bulk(1, 120))
    const s = boot()
    await openMoments(s)
    expect(rows(s)).toHaveLength(50)
    const moreRows = panel(s).get('.more-rows')
    expect(moreRows.text()).toBe('이 곡의 순간 70개 더 보기')
    await moreRows.trigger('click')
    await nextTick()
    expect(rows(s)).toHaveLength(100)
    expect(panel(s).get('.more-rows').text()).toBe('이 곡의 순간 20개 더 보기')
  })

  it('1,000개 · 5,000개 — 그리는 줄이 데이터 크기를 따라 자라지 않는다', async () => {
    for (const [songs, per] of [
      [200, 5],
      [1000, 5],
    ] as const) {
      seedMoments(bulk(songs, per))
      const s = boot()
      await openMoments(s)
      expect(heads(s)).toHaveLength(30)
      // 최근 3묶음만 펼침 → 3 × 5 줄.
      expect(rows(s)).toHaveLength(15)
      expect(panel(s).element.querySelectorAll('*').length).toBeLessThan(900)
      s.wrapper.unmount()
      document.body.innerHTML = ''
      globalThis.localStorage.clear()
    }
  })
})

/* ================================================================== *
 * C. 검색
 * ================================================================== */

describe('C. 검색 — 제목 · 메모, 150ms 뒤', () => {
  it('입력이 멈춘 뒤 150ms 에 적용하고, 맞는 묶음을 펼쳐 일치 부분을 강조한다', async () => {
    vi.useFakeTimers()
    seedMoments([
      moment({ id: 'a1', videoId: A, atSeconds: 43, note: '후렴 직전 — 베이스' }),
      moment({ id: 'a2', videoId: A, atSeconds: 90, note: '브리지' }),
      moment({
        id: 'b1',
        videoId: B,
        title: 'Bravo',
        note: '조용한 후렴',
        createdAt: '2026-11-09T00:00:00Z',
      }),
      moment({
        id: 'c1',
        videoId: C,
        title: 'Charlie',
        note: '인트로',
        createdAt: '2026-11-08T00:00:00Z',
      }),
    ])
    const s = boot()
    await openMoments(s)

    await searchBox(s).setValue('후렴')
    vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS - 1)
    await settle()
    expect(rows(s)).toHaveLength(4) // 아직 적용 전
    vi.advanceTimersByTime(1)
    await settle()

    expect(rows(s).map((r) => r.get('[data-moment-play]').attributes('data-moment-play'))).toEqual([
      'a1',
      'b1',
    ])
    expect(summary(s).text()).toBe('순간 2개 · 곡 2개')
    expect(
      panel(s)
        .findAll('.moment-note mark')
        .map((m) => m.text()),
    ).toEqual(['후렴', '후렴'])
    // 묶음 머리는 일치 수 / 전체 수.
    expect(heads(s)[0]?.text()).toContain('1 / 2개')
  })

  it('제목으로 찾으면 그 곡의 순간이 모두 나온다 — 대소문자 · NFD 무시', async () => {
    vi.useFakeTimers()
    seedMoments([
      moment({ id: 'a1', videoId: A }),
      moment({ id: 'a2', videoId: A, atSeconds: 20 }),
      moment({ id: 'n1', videoId: GONE, title: '드라이브 노래' }),
    ])
    const s = boot()
    await openMoments(s)

    await search(s, 'ALPHA')
    expect(rows(s)).toHaveLength(2)
    expect(panel(s).get('.group-title mark').text()).toBe('Alpha')

    await search(s, '드라이브'.normalize('NFD'))
    expect(rows(s)).toHaveLength(1)
    expect(heads(s)[0]?.text()).toContain('목록에 없음')
  })

  it('맞는 것이 없으면 그렇게 말하고, Esc 는 검색어만 지운다 — 보관함은 열린 채', async () => {
    vi.useFakeTimers()
    seedMoments([moment({ id: 'a1' }), moment({ id: 'b1', videoId: B, title: 'Bravo' })])
    const s = boot()
    await openMoments(s)

    await search(s, '없는말')
    expect(rows(s)).toHaveLength(0)
    expect(summary(s).text()).toContain('맞는 순간이 없어요')

    await searchBox(s).trigger('keydown', { key: 'Escape' })
    await settle()
    expect(searchBox(s).element.value).toBe('')
    expect(rows(s)).toHaveLength(2)
    expect(s.wrapper.get('#archive-panel').attributes('hidden')).toBeUndefined()

    // 빈 검색란에서 Esc 는 보관함을 닫는다 (기존 동작).
    searchBox(s).element.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    )
    await settle()
    expect(s.wrapper.get('#archive-panel').attributes('hidden')).toBeDefined()
  })

  it('Enter 는 기다리지 않고 바로 검색한다', async () => {
    vi.useFakeTimers()
    seedMoments([
      moment({ id: 'a1', note: '후렴' }),
      moment({ id: 'b1', videoId: B, title: 'Bravo' }),
    ])
    const s = boot()
    await openMoments(s)
    await searchBox(s).setValue('후렴')
    await searchBox(s).trigger('keydown', { key: 'Enter' })
    await settle()
    expect(rows(s)).toHaveLength(1)
  })

  it('결과가 200줄을 넘으면 앞의 200줄만 그리고 검색어를 좁혀 달라고 한다', async () => {
    vi.useFakeTimers()
    seedMoments(bulk(60, 5, () => '공통 메모'))
    const s = boot()
    await openMoments(s)
    await search(s, '공통')
    expect(rows(s)).toHaveLength(200)
    expect(summary(s).text()).toBe(
      '순간 300개 · 곡 60개 — 앞의 200개만 보여요. 검색어를 좁혀 주세요.',
    )
    expect(panel(s).find('.more').exists()).toBe(false)
  })

  it('검색 · 접기 · 보기 바꾸기는 저장소에 쓰지 않는다', async () => {
    vi.useFakeTimers()
    seedMoments(bulk(10, 2))
    const s = boot()
    const before = {
      moments: globalThis.localStorage.getItem(STORAGE_KEYS.moments),
      library: globalThis.localStorage.getItem(STORAGE_KEYS.library),
    }
    await openMoments(s)
    await search(s, 'note 1')
    await heads(s)[0]?.trigger('click')
    await panel(s).findAll('.chip')[1]?.trigger('click')
    await searchBox(s).trigger('keydown', { key: 'Escape' })
    await settle()
    expect(globalThis.localStorage.getItem(STORAGE_KEYS.moments)).toBe(before.moments)
    expect(globalThis.localStorage.getItem(STORAGE_KEYS.library)).toBe(before.library)
  })
})

/* ================================================================== *
 * D. 보기 — 최근 · 이 곡 · 한 곡
 * ================================================================== */

describe('D. 보기 — 최근 · 이 곡 · 한 곡', () => {
  it('최근 — 묶지 않고 저장 시각 역순, 줄마다 곡 제목, 50줄씩', async () => {
    seedMoments(bulk(30, 3))
    const s = boot()
    await openMoments(s)
    await panel(s).findAll('.chip')[1]?.trigger('click')
    await nextTick()

    expect(panel(s).findAll('.chip')[1]?.attributes('aria-pressed')).toBe('true')
    expect(heads(s)).toHaveLength(0)
    expect(rows(s)).toHaveLength(50)
    expect(rows(s)[0]?.get('[data-moment-play]').attributes('data-moment-play')).toBe('m89')
    expect(rows(s)[0]?.get('.moment-song').text()).toBe('Song 29')
    expect(panel(s).get('.more button').text()).toBe('순간 40개 더 보기 · 남은 40개')
  })

  it('이 곡 — 지금 곡의 묶음만, 펼친 채', async () => {
    seedMoments([...bulk(10, 2), moment({ id: 'cur', videoId: A, atSeconds: 3 })])
    const s = boot()
    await playFromStart(s)
    await openMoments(s)
    await panel(s).findAll('.chip')[2]?.trigger('click')
    await nextTick()
    expect(heads(s)).toHaveLength(1)
    expect(heads(s)[0]?.attributes('aria-expanded')).toBe('true')
    expect(heads(s)[0]?.text()).toContain('재생 중')
  })

  it('음악 탭 곡 줄의 ◆ 배지 → Moments 탭이 그 곡으로 걸러져 열린다 · "전체 보기" 로 돌아간다', async () => {
    seedMoments([
      moment({ id: 'a1', videoId: A }),
      moment({ id: 'a2', videoId: A, atSeconds: 50 }),
      moment({ id: 'b1', videoId: B, title: 'Bravo' }),
    ])
    const s = boot()
    await s.wrapper.findAll('.app-nav button')[0]?.trigger('click')
    await settle()

    const badge = s.wrapper.get(`#archive-panel-music [data-track-moments="${A}"]`)
    expect(badge.text()).toBe('◆ 2')
    expect(badge.attributes('aria-label')).toBe('Alpha 의 Moments 2개 보기')
    // Moment 가 없는 곡에는 배지가 없다.
    expect(s.wrapper.find(`#archive-panel-music [data-track-moments="${C}"]`).exists()).toBe(false)

    await badge.trigger('click')
    await settle()
    expect(s.wrapper.get('#archive-tab-moments').attributes('aria-selected')).toBe('true')
    expect(panel(s).get('.focus-line').text()).toContain('‘Alpha’ 의 순간만 보는 중')
    expect(heads(s)).toHaveLength(1)
    expect(rows(s)).toHaveLength(2)

    await panel(s).get('.focus-line .link').trigger('click')
    await nextTick()
    expect(heads(s)).toHaveLength(2)
    expect(panel(s).find('.focus-line').exists()).toBe(false)
  })

  it('대시보드 "이 곡의 Moments N개 더 — 모두 보기" 는 그 곡으로 걸러 연다', async () => {
    seedMoments(
      [0, 1, 2, 3].map((i) => moment({ id: `a${String(i)}`, videoId: A, atSeconds: i * 10 })),
    )
    const s = boot()
    await playFromStart(s)
    await s.wrapper.get('.moments-widget .more .link').trigger('click')
    await settle()
    expect(panel(s).get('.focus-line').text()).toContain('Alpha')
    expect(rows(s)).toHaveLength(4)
  })
})

/* ================================================================== *
 * E. 라이브러리로 가기 · 목록에 없는 영상
 * ================================================================== */

describe('E. 라이브러리 연결', () => {
  it('묶음 머리에 그 영상이 든 목록 — 누르면 음악 탭의 그 목록 · 그 곡으로 포커스', async () => {
    seedMoments([moment({ id: 'a1', videoId: A })])
    const s = boot()
    await openMoments(s)

    const links = panel(s).findAll('.list-link')
    expect(links.map((l) => l.text())).toEqual(['LIST', '드라이브'])

    await links[1]?.trigger('click')
    await settle()
    await nextTick()
    expect(s.library.selectedPlaylistId).toBe('drive')
    expect(s.wrapper.get('#archive-tab-music').attributes('aria-selected')).toBe('true')
    const row = s.wrapper.get('#archive-panel-music [data-track-id="d-a"]')
    expect(row.classes()).toContain('is-revealed')
    expect(document.activeElement).toBe(row.get('.track-play').element)
  })

  it('라이브러리에 없는 영상의 Moment — 남아 있고, "목록에 없음", 그 시점부터 재생된다', async () => {
    seedMoments([moment({ id: 'g1', videoId: GONE, title: 'Deleted Song', atSeconds: 42 })])
    const s = boot()
    await openMoments(s)
    expect(heads(s)[0]?.text()).toContain('Deleted Song')
    expect(heads(s)[0]?.text()).toContain('목록에 없음')
    expect(panel(s).find('.list-link').exists()).toBe(false)

    s.fake.emitReady()
    await panel(s).get('[data-moment-play="g1"]').trigger('click')
    await settle()
    expect(s.playback.currentTrack?.videoId).toBe(GONE)
    expect(s.fake.calls.load[s.fake.calls.load.length - 1]).toMatchObject({
      videoId: GONE,
      startSeconds: 42,
    })
  })
})

/* ================================================================== *
 * F. 편집 · 삭제 — 안내와 포커스
 * ================================================================== */

describe('F. 편집 · 삭제', () => {
  async function openEdit(s: Session, id: string) {
    await panel(s).get(`[data-moment-manage="${id}"]`).trigger('click')
    await nextTick()
    await panel(s).get(`[data-moment-edit="${id}"]`).trigger('click')
    await nextTick()
    await nextTick()
  }

  it('저장하면 그 줄이 바뀌고 위의 안내 자리에 "메모를 고쳤어요" — 다른 줄은 그대로', async () => {
    seedMoments([
      moment({ id: 'x', note: '처음' }),
      moment({ id: 'y', atSeconds: 30, note: '다른 줄' }),
    ])
    const s = boot()
    await openMoments(s)
    await openEdit(s, 'x')
    expect(document.activeElement?.id).toBe('archive-moment-note-x')

    await panel(s).get('#archive-moment-note-x').setValue('고친 메모')
    await panel(s).get('.edit-form').trigger('submit')
    await settle()

    expect(panel(s).find('.edit-form').exists()).toBe(false)
    expect(panel(s).get('.tools .feedback').text()).toBe('메모를 고쳤어요.')
    expect(
      panel(s)
        .findAll('.moment-note')
        .map((n) => n.text()),
    ).toEqual(['고친 메모', '다른 줄'])
    expect(document.activeElement).toBe(panel(s).get('[data-moment-manage="x"]').element)
  })

  it('다른 탭과 겹쳐 거절되면 폼과 쓴 메모가 남고, 줄 안과 위에 이유를 말한다', async () => {
    seedMoments([moment({ id: 'x', note: '처음' })])
    const s = boot()
    vi.spyOn(s.moments, 'updateNote').mockResolvedValue({ ok: false, reason: 'conflict' })
    await openMoments(s)
    await openEdit(s, 'x')
    await panel(s).get('#archive-moment-note-x').setValue('잃으면 안 되는 메모')
    await panel(s).get('.edit-form').trigger('submit')
    await settle()

    expect(panel(s).get<HTMLTextAreaElement>('#archive-moment-note-x').element.value).toBe(
      '잃으면 안 되는 메모',
    )
    expect(panel(s).get('.edit-form .error-msg').text()).toContain('저장하지 못했어요')
    expect(panel(s).get('.tools .feedback').text()).toContain('다른 탭에서 Moments 가 바뀌어')
    expect(panel(s).get('.tools .feedback').classes()).toContain('is-warning')
  })

  it('지우면 포커스가 같은 묶음의 이웃 줄로, 묶음이 비면 다음 묶음 머리로 간다', async () => {
    seedMoments([
      moment({ id: 'a1', videoId: A, atSeconds: 1, createdAt: '2026-11-10T03:00:00Z' }),
      moment({ id: 'a2', videoId: A, atSeconds: 2, createdAt: '2026-11-10T03:00:00Z' }),
      moment({ id: 'b1', videoId: B, title: 'Bravo', createdAt: '2026-11-10T01:00:00Z' }),
    ])
    const s = boot()
    await openMoments(s)

    async function remove(id: string): Promise<void> {
      await panel(s).get(`[data-moment-manage="${id}"]`).trigger('click')
      await nextTick()
      await panel(s).get(`[data-moment-remove="${id}"]`).trigger('click')
      await nextTick()
      const confirm = panel(s).get('[role="alertdialog"]')
      await confirm
        .findAll('button')
        .find((b) => b.text() === '삭제')
        ?.trigger('click')
      await settle()
      await nextTick()
    }

    await remove('a1')
    expect(document.activeElement).toBe(panel(s).get('[data-moment-play="a2"]').element)
    expect(panel(s).get('.tools .feedback').text()).toBe('순간을 지웠어요.')

    await remove('a2')
    expect(document.activeElement).toBe(panel(s).get(`[data-group-toggle="${B}"]`).element)
  })
})

/* ================================================================== *
 * G. 플레이어 · 접근성
 * ================================================================== */

describe('G. 플레이어 iframe · 접근성', () => {
  it('검색 · 접기 · 보기 바꾸기 · 더 보기에도 플레이어 자리가 그대로다', async () => {
    vi.useFakeTimers()
    seedMoments(bulk(40, 2))
    const s = boot()
    const mountNode = s.wrapper.get('.player-mount').element
    await openMoments(s)
    await search(s, 'song 3')
    await heads(s)[0]?.trigger('click')
    await searchBox(s).trigger('keydown', { key: 'Escape' })
    await panel(s).findAll('.chip')[1]?.trigger('click')
    await panel(s).findAll('.chip')[0]?.trigger('click')
    await panel(s).get('.more button').trigger('click')
    await settle()
    expect(s.wrapper.get('.player-mount').element).toBe(mountNode)
    expect(s.fake.calls.destroy).toBe(0)
    expect(s.fake.calls.mount).toBe(1)
  })

  it('도구 줄은 넉넉한 데스크톱에서만 위에 붙고, 붙으면 스크롤 여백으로 포커스가 그 아래 숨지 않는다', () => {
    // 실측: 도구 줄 150px = 1440×900 보관함의 20%, 390×844 의 30%, 360×740 의 38%.
    const code = readFileSync(
      resolve(process.cwd(), 'src/features/moments/MomentsBrowserPanel.vue'),
      'utf8',
    )
    const style = code.slice(code.indexOf('<style'))
    const roomy =
      /@media \(min-width: 901px\) and \(min-height: 760px\) \{\s*\.tools \{\s*position: sticky;/
    expect(style).toMatch(roomy)
    expect(style.replace(/@media \(min-width: 901px\)[\s\S]*?\n\}/, '')).not.toContain('sticky')
    expect(code).toContain('scroller.style.scrollPaddingTop')
  })

  it('검색란 · 보기 단추 · 머리 · 목록 이름에 이름이 있고, 결과 수는 화면 낭독기에 알린다', async () => {
    seedMoments(bulk(8, 1))
    const s = boot()
    await openMoments(s)
    expect(searchBox(s).attributes('aria-label')).toBe('Moments 검색 — 제목 · 메모')
    expect(searchBox(s).attributes('type')).toBe('search')
    expect(summary(s).attributes('role')).toBe('status')
    expect(panel(s).get('.filter').attributes('role')).toBe('group')
    expect(
      panel(s)
        .findAll('.chip')
        .every((c) => c.attributes('aria-pressed') !== undefined),
    ).toBe(true)
    // 묶음 머리는 제목(h4) 안의 단추다.
    expect(panel(s).findAll('h4 .group-toggle')).toHaveLength(8)
  })
})
