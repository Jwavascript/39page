/**
 * ADR 0046 — 가사 위젯: LRC 읽기 · LRCLIB 클라이언트(밝히기 · 한 줄 · 쉬기) · 제목 맞추기 · 위젯.
 *
 * 맞추기 시험의 레코드는 2026-11-22 LRCLIB 실제 응답의 이름 · 가수 · 길이를 옮긴 것이다(가사 글자는 합성).
 */
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { activeLineIndex, parseSyncedLyrics, plainLyricLines } from '@/features/lyrics/lrc'
import {
  LRCLIB_CLIENT,
  createLrclibClient,
  readLyricsRecord,
  retryAfterSeconds,
  type LrclibClient,
  type LyricsRecord,
} from '@/features/lyrics/lrclibClient'
import { lyricsChoicesStorage, readLyricsChoices, withPick } from '@/features/lyrics/lyricsChoices'
import LyricsWidget from '@/features/lyrics/LyricsWidget.vue'
import {
  cleanTitle,
  lyricsQueries,
  matchScore,
  pickLyrics,
  trackCore,
} from '@/features/lyrics/matchLyrics'
import { LYRICS_CLIENT, resetLyricsCache } from '@/features/lyrics/useLyrics'
import { PLAYBACK_COORDINATOR } from '@/features/playback/playbackCoordinator'
import { STORAGE_KEYS } from '@/shared/storage'
import { usePlaybackStore } from '@/stores/playback'

const rec = (over: Partial<LyricsRecord> & { id: number; trackName: string }): LyricsRecord => ({
  artistName: '',
  albumName: '',
  duration: 200,
  instrumental: false,
  plainLyrics: 'la la',
  syncedLyrics: '[00:01.00] la la',
  ...over,
})

describe('A. LRC 읽기', () => {
  it('시각 순 줄 · 한 줄의 여러 시각 · 소수 자리 · 머리 태그와 빈 시각 줄', () => {
    const lines = parseSyncedLyrics(
      '[ar:Someone]\n[00:12.50]둘째\n[00:01.2]첫째\n[00:30.00][01:05.123]후렴\n[01:10.00]\n그냥 글자',
    )
    expect(lines).toEqual([
      { time: 1.2, text: '첫째' },
      { time: 12.5, text: '둘째' },
      { time: 30, text: '후렴' },
      { time: 65.123, text: '후렴' },
      { time: 70, text: '' },
    ])
  })

  it('[offset:+500] 은 모든 시각을 0.5초 앞당긴다 (0 아래로는 가지 않는다)', () => {
    expect(parseSyncedLyrics('[offset:+500]\n[00:00.20]a\n[00:02.00]b')).toEqual([
      { time: 0, text: 'a' },
      { time: 1.5, text: 'b' },
    ])
  })

  it('지금 줄 — 첫 줄 전 -1, 같은 시각 이후는 그 줄', () => {
    const lines = parseSyncedLyrics('[00:05.00]a\n[00:10.00]b\n[00:20.00]c')
    expect(activeLineIndex(lines, 0)).toBe(-1)
    expect(activeLineIndex(lines, 5)).toBe(0)
    expect(activeLineIndex(lines, 19.9)).toBe(1)
    expect(activeLineIndex(lines, 999)).toBe(2)
    expect(activeLineIndex([], 3)).toBe(-1)
  })

  it('일반 가사 — 앞뒤 빈 줄만 버린다', () => {
    expect(plainLyricLines('\n\n하나\n\n둘\r\n\n')).toEqual(['하나', '', '둘'])
  })
})

describe('B. LRCLIB 클라이언트', () => {
  function fakeFetch(responses: (() => Response)[]) {
    const calls: { url: string; init: RequestInit | undefined }[] = []
    const fn = vi.fn<(url: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
      async (url, init) => {
        calls.push({ url: String(url), init })
        const next = responses.shift()
        if (next === undefined) throw new Error('no response')
        return next()
      },
    )
    return { fn: fn as unknown as typeof fetch, calls }
  }
  const json =
    (body: unknown, init: ResponseInit = {}) =>
    () =>
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        ...init,
      })

  it('이 앱을 Lrclib-Client 머리로 밝히고, 주소를 보내지 않고, 쿠키를 싣지 않는다', async () => {
    const { fn, calls } = fakeFetch([json([{ id: 1, trackName: 'DUNE', duration: 239 }])])
    let now = 0
    const client = createLrclibClient({
      fetch: fn,
      now: () => now,
      wait: async (ms) => void (now += ms),
    })
    const result = await client.search({ q: 'hachi dune', artist_name: '' })
    expect(result.ok && result.value.map((r) => r.trackName)).toEqual(['DUNE'])
    expect(calls[0]?.url).toBe('https://lrclib.net/api/search?q=hachi+dune')
    const init = calls[0]?.init
    expect(new Headers(init?.headers).get('Lrclib-Client')).toBe(LRCLIB_CLIENT)
    expect(LRCLIB_CLIENT).toBe('39page (https://39page.com)')
    expect(init?.referrerPolicy).toBe('no-referrer')
    expect(init?.credentials).toBe('omit')
  })

  it('한 번에 하나씩, 요청 사이 300ms 를 둔다', async () => {
    const { fn } = fakeFetch([json([]), json([])])
    let now = 1000
    const waits: number[] = []
    const client = createLrclibClient({
      fetch: fn,
      now: () => now,
      wait: async (ms) => {
        waits.push(ms)
        now += ms
      },
    })
    await Promise.all([client.search({ q: 'a' }), client.search({ q: 'b' })])
    expect(waits).toEqual([300])
  })

  it('429 면 Retry-After(+흔들기) 동안 요청하지 않는다', async () => {
    const { fn, calls } = fakeFetch([
      () => new Response('{}', { status: 429, headers: { 'Retry-After': '10' } }),
      json([]),
    ])
    let now = 0
    const client = createLrclibClient({
      fetch: fn,
      now: () => now,
      random: () => 0.5,
      wait: async (ms) => void (now += ms),
    })
    expect(await client.search({ q: 'a' })).toEqual({ ok: false, reason: 'rate-limited' })
    expect(client.blockedUntil()).toBe(11_500)
    now = 11_000
    expect(await client.search({ q: 'b' })).toEqual({ ok: false, reason: 'rate-limited' })
    expect(calls).toHaveLength(1)
    now = 12_000
    expect((await client.search({ q: 'c' })).ok).toBe(true)
  })

  it('404 · 네트워크 오류 · JSON 아님 · 모양 다름', async () => {
    const { fn } = fakeFetch([
      () => new Response('{}', { status: 404 }),
      () => {
        throw new TypeError('offline')
      },
      () => new Response('<html>', { status: 200, headers: { 'Content-Type': 'text/html' } }),
      json({ not: 'array' }),
    ])
    let now = 0
    const client = createLrclibClient({
      fetch: fn,
      now: () => now,
      wait: async (ms) => void (now += ms),
    })
    expect(await client.get(5)).toEqual({ ok: false, reason: 'not-found' })
    expect(await client.search({ q: 'a' })).toEqual({ ok: false, reason: 'network' })
    expect(await client.search({ q: 'a' })).toEqual({ ok: false, reason: 'bad-response' })
    expect(await client.search({ q: 'a' })).toEqual({ ok: false, reason: 'bad-response' })
  })

  it('레코드 검증 · Retry-After 읽기', () => {
    expect(readLyricsRecord({ id: 0 })).toBeNull()
    expect(readLyricsRecord({ id: 3, trackName: 5, plainLyrics: '  ' })).toEqual({
      id: 3,
      trackName: '',
      artistName: '',
      albumName: '',
      duration: 0,
      instrumental: false,
      plainLyrics: null,
      syncedLyrics: null,
    })
    expect(retryAfterSeconds('7', 0)).toBe(7)
    expect(retryAfterSeconds(new Date(30_000).toUTCString(), 0)).toBe(30)
    expect(retryAfterSeconds(null, 0)).toBe(60)
  })
})

describe('C. 제목 맞추기', () => {
  it('검색어 — 꼬리표를 떼고 라틴 낱말 먼저, 한자/가나/한글이 있으면 정리한 제목도', () => {
    expect(cleanTitle('椎名もた「Q」 feat.鏡音リン ( Official MV )')).toBe(
      '椎名もた「Q」 feat.鏡音リン',
    )
    expect(lyricsQueries('아이유 - 밤편지 (Through the Night) MV')).toEqual([
      'through night',
      '아이유 - 밤편지 (Through the Night) MV',
    ])
    expect(lyricsQueries('ハチ - 砂の惑星 feat.初音ミク , HACHI - DUNE ft Miku Hatsune')[0]).toBe(
      'hachi dune miku hatsune',
    )
    expect(lyricsQueries('アストロノーツ')).toEqual(['アストロノーツ'])
    expect(lyricsQueries('Q')).toEqual([])
  })

  const DUNE = rec({
    id: 1876612,
    trackName: 'DUNE (feat. Hatsune Miku)',
    artistName: 'Hachi feat. Hatsune Miku',
    duration: 239,
  })
  const ASTRO = rec({
    id: 13680964,
    trackName: 'アストロノーツ',
    artistName: '椎名もた',
    duration: 458,
  })
  const NORMAL = rec({
    id: 12144280,
    trackName: '普通に歳をとるコトすら (Can’t Even Age Normally)',
    artistName: '椎名もた (siinamota)',
    duration: 296,
  })
  const SHOJO = rec({
    id: 22475610,
    trackName: '椎名もた(siinamota) - Young Girl A / 少女A',
    artistName: 'siinamota',
    duration: 243,
  })
  const NOISE = rec({ id: 30586350, trackName: 'M.O.T.O', artistName: 'X.O', duration: 199 })

  it('곡 길이 ±4초 안 · 제목 낱말 또는 한자/가나 덩어리가 겹쳐야 고른다', () => {
    expect(
      pickLyrics([NOISE, DUNE], {
        title: 'ハチ - 砂の惑星 feat.初音ミク , HACHI - DUNE ft Miku Hatsune',
        duration: 239.4,
      }),
    ).toBe(DUNE)
    expect(pickLyrics([NOISE, ASTRO], { title: 'アストロノーツ', duration: 457.9 })).toBe(ASTRO)
    expect(pickLyrics([ASTRO], { title: 'アストロノーツ', duration: 300 })).toBeNull()
    expect(pickLyrics([NOISE], { title: 'アストロノーツ', duration: 199 })).toBeNull()
  })

  it('가수 이름이 겹치는 것을 곡이 맞는 것으로 보지 않는다 (실측: 少女A 가 붙던 일)', () => {
    const title = '椎名もた ( siinamota ) -「普通に歳をとるコトすら」(Official MV)'
    expect(trackCore(SHOJO)).toBe('Young Girl A 少女A')
    expect(trackCore(DUNE)).toBe('DUNE')
    expect(matchScore(SHOJO, { title, duration: null })).toBeNull()
    expect(pickLyrics([SHOJO, NORMAL], { title, duration: null })).toBe(NORMAL)
  })

  it('길이를 모르면 가수까지 겹쳐야 믿는다 · 가사 없는 레코드는 고르지 않는다', () => {
    const night = rec({
      id: 2218218,
      trackName: 'Through the Night',
      artistName: 'IU',
      duration: 253,
    })
    expect(pickLyrics([night], { title: 'Through the Night (cover)', duration: null })).toBeNull()
    expect(pickLyrics([night], { title: 'IU - Through the Night', duration: null })).toBe(night)
    expect(
      pickLyrics([{ ...night, plainLyrics: null, syncedLyrics: null }], {
        title: 'IU - Through the Night',
        duration: 253,
      }),
    ).toBeNull()
  })

  it('싱크 가사를 일반 가사보다 먼저 고른다', () => {
    const plainOnly = { ...DUNE, id: 9, syncedLyrics: null }
    expect(pickLyrics([plainOnly, DUNE], { title: 'HACHI - DUNE', duration: 239 })).toBe(DUNE)
  })

  it('직접 고른 것 — 영상 id 만, 500곡까지, 같은 영상은 바뀐다', () => {
    expect(
      readLyricsChoices({ picks: { bad: { id: 1 }, aaaaaaaaaaa: { id: 2, label: 'x' } } }),
    ).toEqual({
      picks: { aaaaaaaaaaa: { id: 2, label: 'x' } },
    })
    let choices = { picks: {} }
    for (let i = 0; i < 502; i += 1) {
      choices = withPick(choices, `v${String(i).padStart(10, '0')}`, { id: i + 1, label: '' })
    }
    expect(Object.keys(choices.picks)).toHaveLength(500)
    expect(Object.keys(choices.picks)[0]).toBe('v0000000002')
  })
})

describe('D. 위젯', () => {
  const VIDEO = 'aaaaaaaaaaa'
  let clock: { videoId: string; seconds: number; duration: number | null } | null

  function fakeClient(over: Partial<LrclibClient> = {}): LrclibClient & {
    searches: string[]
    gets: number[]
  } {
    const searches: string[] = []
    const gets: number[] = []
    return {
      searches,
      gets,
      search: vi.fn<LrclibClient['search']>(async (params) => {
        searches.push(params.q ?? '')
        return { ok: true as const, value: [DUNE_SYNCED] }
      }),
      get: vi.fn<LrclibClient['get']>(async (id) => {
        gets.push(id)
        return { ok: true as const, value: { ...DUNE_SYNCED, id } }
      }),
      blockedUntil: () => 0,
      ...over,
    }
  }
  const DUNE_SYNCED = rec({
    id: 1876612,
    trackName: 'DUNE (feat. Hatsune Miku)',
    artistName: 'Hachi',
    duration: 239,
    syncedLyrics: '[00:01.00]첫 줄\n[00:05.00]둘째 줄\n[00:09.00]\n[00:12.00]넷째 줄',
  })

  function mountWidget(client: LrclibClient) {
    return mount(LyricsWidget, {
      attachTo: document.body,
      global: {
        provide: {
          [LYRICS_CLIENT as symbol]: client,
          [PLAYBACK_COORDINATOR as symbol]: { captureClock: () => clock },
        },
      },
    })
  }

  function play(title: string): void {
    usePlaybackStore().setQueue([{ id: 't', source: 'youtube', videoId: VIDEO, title }], 0)
  }

  beforeEach(() => {
    vi.useFakeTimers()
    localStorage.clear()
    resetLyricsCache()
    setActivePinia(createPinia())
    clock = null
  })

  afterEach(() => {
    vi.useRealTimers()
    localStorage.clear()
    document.body.innerHTML = ''
  })

  it('곡이 없으면 알린다 · 곡이 오면 잠시 기다렸다 한 번 찾고, 싱크 가사의 지금 줄을 밝힌다', async () => {
    const client = fakeClient()
    const wrapper = mountWidget(client)
    expect(wrapper.text()).toContain('재생 중인 곡이 없어요.')
    clock = { videoId: VIDEO, seconds: 5.2, duration: 239 }
    play('HACHI - DUNE ft Miku Hatsune')
    await flushPromises()
    expect(client.searches).toEqual([])
    await vi.advanceTimersByTimeAsync(700)
    await flushPromises()
    expect(client.searches).toEqual(['hachi dune miku hatsune'])
    const lines = wrapper.findAll('.line')
    expect(lines.map((line) => line.text())).toEqual(['첫 줄', '둘째 줄', '♪', '넷째 줄'])
    expect(wrapper.get('.line.is-active').text()).toBe('둘째 줄')
    expect(wrapper.get('.line.is-active').attributes('aria-current')).toBe('true')
    expect(wrapper.get('.widget-sub').text()).toBe('DUNE (feat. Hatsune Miku) · Hachi')

    usePlaybackStore().setPlayerState('playing')
    clock = { videoId: VIDEO, seconds: 12.1, duration: 239 }
    await vi.advanceTimersByTimeAsync(300)
    expect(wrapper.get('.line.is-active').text()).toBe('넷째 줄')
    wrapper.unmount()
  })

  it('빠르게 넘기는 곡은 찾지 않는다 · 한 번 찾은 곡은 이 탭에서 다시 묻지 않는다', async () => {
    const client = fakeClient()
    const wrapper = mountWidget(client)
    clock = { videoId: VIDEO, seconds: 0, duration: 239 }
    play('skip me')
    await vi.advanceTimersByTimeAsync(300)
    play('HACHI - DUNE')
    await vi.advanceTimersByTimeAsync(700)
    await flushPromises()
    expect(client.searches).toEqual(['hachi dune'])
    usePlaybackStore().setQueue([], 0)
    await flushPromises()
    play('HACHI - DUNE')
    await vi.advanceTimersByTimeAsync(700)
    await flushPromises()
    expect(client.searches).toEqual(['hachi dune'])
    expect(wrapper.findAll('.line')).toHaveLength(4)
    wrapper.unmount()
  })

  it('못 찾으면 알리고, 직접 찾아 고르면 그 곡에 기억해 다음에는 그 가사를 바로 받는다', async () => {
    const client = fakeClient({
      search: vi.fn<LrclibClient['search']>(async (params) =>
        params.q === 'Mesmerizer 32ki'
          ? {
              ok: true as const,
              value: [
                rec({ id: 17414640, trackName: 'Mesmerizer', artistName: '32ki', duration: 157 }),
              ],
            }
          : { ok: true as const, value: [] },
      ),
    })
    const wrapper = mountWidget(client)
    clock = { videoId: VIDEO, seconds: 1, duration: 156.4 }
    play('메스머라이저 / 하츠네 미쿠・카사네 테토')
    await vi.advanceTimersByTimeAsync(700)
    await flushPromises()
    expect(wrapper.text()).toContain('가사를 찾지 못했어요.')

    await wrapper.get('[data-lyrics-search]').trigger('click')
    const input = wrapper.get('input[type="search"]')
    expect((input.element as HTMLInputElement).value).toBe(
      '메스머라이저 / 하츠네 미쿠・카사네 테토',
    )
    await input.setValue('Mesmerizer 32ki')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    await wrapper.get('[data-lyrics-result="17414640"]').trigger('click')
    expect(wrapper.get('.widget-sub').text()).toBe('Mesmerizer · 32ki · 직접 고름')
    expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.lyrics) ?? '{}')).toEqual({
      version: 1,
      data: { picks: { [VIDEO]: { id: 17414640, label: 'Mesmerizer · 32ki' } } },
    })
    wrapper.unmount()

    // 새로 연 탭 — 고른 id 로 바로 받는다(검색하지 않는다).
    resetLyricsCache()
    setActivePinia(createPinia())
    const again = fakeClient()
    const next = mountWidget(again)
    play('메스머라이저 / 하츠네 미쿠・카사네 테토')
    await vi.advanceTimersByTimeAsync(700)
    await flushPromises()
    expect(again.gets).toEqual([17414640])
    expect(again.searches).toEqual([])
    next.unmount()
  })

  it('자동으로 되돌리면 고른 것을 지우고 다시 찾는다', async () => {
    lyricsChoicesStorage.write(withPick({ picks: {} }, VIDEO, { id: 5, label: 'x' }))
    const client = fakeClient()
    const wrapper = mountWidget(client)
    clock = { videoId: VIDEO, seconds: 1, duration: 239 }
    play('HACHI - DUNE')
    await vi.advanceTimersByTimeAsync(700)
    await flushPromises()
    expect(client.gets).toEqual([5])
    await wrapper.get('[data-lyrics-search]').trigger('click')
    await wrapper.get('[data-lyrics-auto]').trigger('click')
    await flushPromises()
    expect(lyricsChoicesStorage.read().value.picks).toEqual({})
    expect(client.searches).toEqual(['hachi dune'])
    wrapper.unmount()
  })

  it('LRCLIB 가 쉬라고 하면 알리고, 그 뒤 한 번 다시 찾는다', async () => {
    let blocked = true
    const client = fakeClient({
      search: vi.fn<LrclibClient['search']>(async () =>
        blocked
          ? { ok: false as const, reason: 'rate-limited' as const }
          : { ok: true as const, value: [DUNE_SYNCED] },
      ),
      blockedUntil: () => Date.now() + 5000,
    })
    const wrapper = mountWidget(client)
    clock = { videoId: VIDEO, seconds: 1, duration: 239 }
    play('HACHI - DUNE')
    await vi.advanceTimersByTimeAsync(700)
    await flushPromises()
    expect(wrapper.text()).toContain('잠시 뒤 다시 찾아볼게요.')
    blocked = false
    await vi.advanceTimersByTimeAsync(6000)
    await flushPromises()
    expect(wrapper.findAll('.line')).toHaveLength(4)
    wrapper.unmount()
  })

  it('가사 글자는 HTML 로 해석하지 않는다', async () => {
    const client = fakeClient({
      search: vi.fn<LrclibClient['search']>(async () => ({
        ok: true as const,
        value: [{ ...DUNE_SYNCED, syncedLyrics: '[00:01.00]<img src=x onerror=alert(1)>' }],
      })),
    })
    const wrapper = mountWidget(client)
    clock = { videoId: VIDEO, seconds: 2, duration: 239 }
    play('HACHI - DUNE')
    await vi.advanceTimersByTimeAsync(700)
    await flushPromises()
    expect(wrapper.find('.line img').exists()).toBe(false)
    expect(wrapper.get('.line').text()).toBe('<img src=x onerror=alert(1)>')
    wrapper.unmount()
  })
})
