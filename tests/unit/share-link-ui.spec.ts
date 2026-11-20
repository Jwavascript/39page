/**
 * ADR 0040 — 링크로 공유 화면: 만들기(공유 묶음 · Moment 관리) · 받기(공유 링크를 열면 뜨는 미리보기).
 *
 * 앱 전체를 올려 실제 조립(라이브러리 · Moments · 코디네이터 · 보관함 · 셸)으로 본다. 플레이어는 `FakePlayerAdapter`.
 *
 *   링크는 고른 대상 · 선택 그대로 — 곡 이름 · Moments · 메모는 고를 때만
 *   복사는 누를 때만. 막히면 링크를 골라 두고 직접 복사하라고 말한다
 *   받는 쪽은 미리보기 먼저 — 누르기 전에는 아무것도 저장 · 재생하지 않는다
 *   재생은 대화상자를 닫은 뒤에, 닫으면 주소의 조각도 지운다
 */
import { nextTick } from 'vue'

import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import App from '@/app/App.vue'
import { encodeShareLink, parseShareLink, type ShareLinkContent } from '@/features/backup/shareLink'
import { FakePlayerAdapter } from '@/features/playback/FakePlayerAdapter'
import { PLAYER_ADAPTER_FACTORY } from '@/features/playback/PlayerAdapter'
import { STORAGE_KEYS } from '@/shared/storage'
import type { Moment, Playlist } from '@/shared/types'
import { LIBRARY_STORAGE_VERSION, useLibraryStore } from '@/stores/library'
import { MOMENTS_STORAGE_VERSION, useMomentsStore } from '@/stores/moments'
import { usePlaybackStore } from '@/stores/playback'

import { installPlayerRect, uninstallPlayerRect } from '../support/playerLayout'
import { openTrackManage } from '../support/trackManage'

const A = 'aaaaaaaaaaa'
const B = 'bbbbbbbbbbb'
const C = 'ccccccccccc'

const LISTS: Playlist[] = [
  {
    id: 'one',
    name: 'ONE',
    tracks: [
      { id: 't1', source: 'youtube', videoId: A, title: 'Alpha' },
      { id: 't2', source: 'youtube', videoId: B, title: 'Bravo' },
    ],
  },
  {
    id: 'two',
    name: 'TWO',
    tracks: [{ id: 't3', source: 'youtube', videoId: C, title: 'Charlie' }],
  },
]

function moment(overrides: Partial<Moment> = {}): Moment {
  return {
    id: 'm1',
    source: 'youtube',
    videoId: A,
    atSeconds: 83,
    note: '후렴 최고',
    title: 'Alpha',
    createdAt: '2026-11-20T01:00:00.000Z',
    updatedAt: '2026-11-20T01:00:00.000Z',
    ...overrides,
  }
}

function boot(
  options: { hash?: string; lists?: Playlist[]; moments?: Moment[]; selected?: string } = {},
) {
  globalThis.localStorage.setItem(
    STORAGE_KEYS.library,
    JSON.stringify({
      version: LIBRARY_STORAGE_VERSION,
      data: { playlists: options.lists ?? LISTS, selectedPlaylistId: options.selected ?? 'one' },
    }),
  )
  if (options.moments !== undefined) {
    globalThis.localStorage.setItem(
      STORAGE_KEYS.moments,
      JSON.stringify({ version: MOMENTS_STORAGE_VERSION, data: options.moments }),
    )
  }
  globalThis.history.replaceState(null, '', `/${options.hash ?? ''}`)
  setActivePinia(createPinia())
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

function stubClipboard(
  writeText = vi.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined),
) {
  Object.defineProperty(globalThis.navigator, 'clipboard', {
    value: { writeText },
    configurable: true,
  })
  return writeText
}

const linkField = (s: Session) => s.wrapper.get<HTMLInputElement>('.link-share .link-field')
const linkOf = (s: Session) => linkField(s).element.value
const parsedLink = (s: Session) => {
  const url = linkOf(s)
  return parseShareLink(url.slice(url.indexOf('#')))
}
/** 공유 대화상자 (ADR 0043) — 데이터 · 백업과 따로 뜬다. */
const shareDialog = (s: Session) => s.wrapper.get('.share-dialog')

async function openArchive(s: Session): Promise<void> {
  await s.wrapper.get('.app-nav button').trigger('click')
  await settle()
}

async function shareTrack(s: Session, title: string): Promise<void> {
  await openArchive(s)
  await openTrackManage(s.wrapper, title)
  await s.wrapper.get(`[aria-label="${title} 공유"]`).trigger('click')
  await settle()
}

async function shareList(s: Session, index: number): Promise<void> {
  await openArchive(s)
  await s.wrapper.findAll('.archive-lists .list-manage')[index]?.trigger('click')
  await s.wrapper
    .findAll('.archive-lists .manage-panel button')
    .find((button) => button.text() === '이 목록 공유')
    ?.trigger('click')
  await settle()
}

const dialog = (s: Session) => s.wrapper.find('.share-link-dialog')

/** 받기 미리보기는 따로 내려받는 묶음이다 (`defineAsyncComponent`) — 뜰 때까지 기다린다. */
async function waitDialog(s: Session): Promise<void> {
  await vi.waitFor(
    async () => {
      await settle()
      if (!dialog(s).exists()) throw new Error('share link dialog not shown yet')
    },
    { timeout: 5000, interval: 20 },
  )
}
const dialogButton = (s: Session, text: string) =>
  dialog(s)
    .findAll('button')
    .find((button) => button.text() === text)

beforeEach(() => {
  globalThis.localStorage.clear()
  installPlayerRect()
})

afterEach(() => {
  uninstallPlayerRect()
  vi.unstubAllGlobals()
  Reflect.deleteProperty(globalThis.navigator, 'clipboard')
  globalThis.localStorage.clear()
  globalThis.history.replaceState(null, '', '/')
  document.body.innerHTML = ''
})

/* ================================================================== *
 * A. 만들기
 * ================================================================== */

describe('A. 링크 만들기 — 공유 대화상자 (ADR 0043)', () => {
  it('"이 곡 공유" → 공유 대화상자가 따로 뜨고 그 곡의 링크가 바로 보인다 · 누르면 복사', async () => {
    const writeText = stubClipboard()
    const s = boot()
    await shareTrack(s, 'Alpha')

    // 데이터 · 백업이 아니라 공유만 뜬다 — 백업 단추가 먼저 보이지 않는다.
    expect(s.wrapper.get('.data-backdrop').attributes('hidden')).toBeDefined()
    expect(shareDialog(s).text()).toContain('곡')
    expect(shareDialog(s).get('.target-name').text()).toBe('Alpha')
    // 고르는 칸이 없다.
    expect(shareDialog(s).findAll('input[type="checkbox"], select')).toHaveLength(0)

    const url = linkOf(s)
    expect(url.startsWith(`${location.origin}${location.pathname}#share?v=1&d=`)).toBe(true)
    expect(parsedLink(s)).toEqual({
      ok: true,
      content: { kind: 'track', name: '', tracks: [{ videoId: A, title: 'Alpha' }], moments: [] },
    })

    await s.wrapper.get('.link-share .copy').trigger('click')
    await settle()
    expect(writeText).toHaveBeenCalledWith(url)
    expect(s.wrapper.get('.link-share .copy-status').text()).toBe('링크를 복사했어요.')
    // 링크는 저장하지 않는다.
    expect(Object.keys(globalThis.localStorage).some((key) => key.includes('share'))).toBe(false)
  })

  it('곡 공유 — 그 곡의 Moments 와 메모가 기본으로 들어간다', async () => {
    stubClipboard()
    const s = boot({ moments: [moment(), moment({ id: 'm2', atSeconds: 12, note: '' })] })
    await shareTrack(s, 'Alpha')

    expect(shareDialog(s).get('.target-detail').text()).toBe('Moment 2개')
    const parsed = parsedLink(s)
    expect(parsed.ok && parsed.content.moments).toEqual([
      { videoId: A, atSeconds: 12, note: '' },
      { videoId: A, atSeconds: 83, note: '후렴 최고' },
    ])
  })

  it('목록 공유 — 고르는 칸 없이 곡 이름을 넣고, Moments 는 넣지 않는다', async () => {
    stubClipboard()
    const s = boot({ moments: [moment()] })
    await shareList(s, 0)

    expect(shareDialog(s).get('.target-name').text()).toBe('ONE')
    expect(shareDialog(s).findAll('input[type="checkbox"], select')).toHaveLength(0)
    const parsed = parsedLink(s)
    expect(parsed).toMatchObject({
      ok: true,
      content: { kind: 'playlist', name: 'ONE', moments: [] },
    })
    expect(parsed.ok && parsed.content.tracks.map((t) => t.title)).toEqual(['Alpha', 'Bravo'])
  })

  it('복사가 막히면 링크를 골라 두고 직접 복사하라고 말한다', async () => {
    stubClipboard(vi.fn<(text: string) => Promise<void>>().mockRejectedValue(new Error('denied')))
    const s = boot()
    await shareTrack(s, 'Bravo')

    await s.wrapper.get('.link-share .copy').trigger('click')
    await settle()
    expect(s.wrapper.get('.link-share .copy-status').text()).toContain('Ctrl+C')
    expect(document.activeElement).toBe(linkField(s).element)
  })

  /** 겹치지 않는 한글 — 압축으로 줄지 않는 실제 제목들처럼. */
  const longList = (count: number): Playlist => ({
    id: 'many',
    name: 'MANY',
    tracks: Array.from({ length: count }, (_, i) => ({
      id: `m${String(i)}`,
      source: 'youtube' as const,
      videoId: `v${String(i).padStart(10, '0')}`,
      title: Array.from({ length: 24 }, (_, k) =>
        String.fromCharCode(0xac00 + ((i * 7919 + k * 104_729) % 11_172)),
      ).join(''),
    })),
  })

  it('긴 목록은 "잘릴 수 있어요" 라고 알리고 그래도 링크는 만든다', async () => {
    stubClipboard()
    const s = boot({ lists: [longList(60)], selected: 'many' })
    await shareList(s, 0)

    expect(s.wrapper.get('.link-share .warn').text()).toContain('잘릴 수 있어요')
    // 어디까지 받아 주는지는 게시판마다 다르다.
    expect(s.wrapper.get('.link-share .copy').attributes('disabled')).toBeUndefined()
  })

  it('곡 이름까지는 담을 수 없을 만큼 길면 링크에서만 곡 이름을 뺀다 — 카드에는 남는다', async () => {
    stubClipboard()
    const s = boot({ lists: [longList(400)], selected: 'many' })
    await shareList(s, 0)

    expect(shareDialog(s).text()).toContain('링크에는 곡 이름을 뺐어요')
    const parsed = parsedLink(s)
    expect(parsed.ok && parsed.content.tracks).toHaveLength(400)
    expect(parsed.ok && parsed.content.tracks.every((t) => t.title === '')).toBe(true)
  })
})

describe('B. 링크 만들기 — Moment 하나', () => {
  it('Moments 관리의 "링크로 공유" → 그 순간과 메모의 링크', async () => {
    stubClipboard()
    const s = boot({ moments: [moment()] })
    await openArchive(s)
    await s.wrapper.get('#archive-tab-moments').trigger('click')
    await settle()
    await s.wrapper.get('[data-moment-manage="m1"]').trigger('click')
    await nextTick()
    await s.wrapper.get('[data-moment-share="m1"]').trigger('click')
    await settle()

    expect(shareDialog(s).get('.target-name').text()).toBe('Alpha')
    expect(shareDialog(s).get('.target-detail').text()).toBe('1:23')
    expect(parsedLink(s)).toEqual({
      ok: true,
      content: {
        kind: 'moment',
        name: '',
        tracks: [{ videoId: A, title: 'Alpha' }],
        moments: [{ videoId: A, atSeconds: 83, note: '후렴 최고' }],
      },
    })
  })
})

/* ================================================================== *
 * C. 받기
 * ================================================================== */

const PLAYLIST_LINK: ShareLinkContent = {
  kind: 'playlist',
  name: '여름 밤',
  tracks: [
    { videoId: A, title: '밤편지' },
    { videoId: C, title: '라일락' },
  ],
  moments: [{ videoId: C, atSeconds: 30, note: '여기' }],
}

describe('C. 받기 — 목록', () => {
  it('링크를 열면 미리보기부터 — 뒤쪽은 막히고, 아무것도 저장하지 않았다', async () => {
    const s = boot({ hash: encodeShareLink(PLAYLIST_LINK) })
    await waitDialog(s)

    expect(dialog(s).exists()).toBe(true)
    expect(dialog(s).get('.kicker').text()).toBe('공유받은 목록')
    expect(dialog(s).get('.headline').text()).toBe('여름 밤')
    expect(
      dialog(s)
        .findAll('.tracks li')
        .map((li) => li.text()),
    ).toEqual(['01밤편지', '02라일락'])
    expect(dialog(s).get('.meta').text()).toContain('Moment 1개')
    expect(s.wrapper.get('.workspace').attributes('inert')).toBeDefined()
    expect(s.library.playlists.map((p) => p.name)).toEqual(['ONE', 'TWO'])
    expect(s.fake.calls.load).toHaveLength(0)
  })

  it('"보관함에 추가하고 듣기" — 새 목록을 만들고, 닫은 뒤 첫 곡부터 재생한다 · 조각을 지운다', async () => {
    const s = boot({ hash: encodeShareLink(PLAYLIST_LINK) })
    await waitDialog(s)

    await dialogButton(s, '보관함에 추가하고 듣기')?.trigger('click')
    await settle()

    const created = s.library.playlists.find((p) => p.name === '여름 밤')
    expect(created?.tracks.map((t) => [t.videoId, t.title])).toEqual([
      [A, '밤편지'],
      [C, '라일락'],
    ])
    expect(dialog(s).exists()).toBe(false)
    expect(globalThis.location.hash).toBe('')
    expect(s.wrapper.get('.workspace').attributes('inert')).toBeUndefined()
    expect(s.fake.calls.load[s.fake.calls.load.length - 1]).toEqual({ videoId: A, autoplay: true })
    expect(s.playback.queueSource).toEqual({ playlistId: created?.id, name: '여름 밤' })
    // Moments 는 고르지 않았다.
    expect(s.moments.moments).toEqual([])
  })

  it('이름이 겹치면 "(2)" · "추가만 하기" 뒤 듣기 · Moments 도 저장', async () => {
    const s = boot({
      hash: encodeShareLink(PLAYLIST_LINK),
      lists: [...LISTS, { id: 'x', name: '여름 밤', tracks: [] }],
    })
    await waitDialog(s)

    await dialog(s)
      .findAll('label.check')
      .find((l) => l.text().includes('Moments 1개도 저장'))
      ?.get('input')
      .setValue(true)
    await dialogButton(s, '추가만 하기')?.trigger('click')
    await settle()

    const results = dialog(s).get('.results').text()
    expect(results).toContain('새 목록 “여름 밤 (2)” 을 만들었어요.')
    expect(results).toContain('곡 2개를 추가했어요.')
    expect(results).toContain('Moment 1개를 저장했어요.')
    expect(s.moments.moments.map((m) => [m.videoId, m.atSeconds, m.note, m.title])).toEqual([
      [C, 30, '여기', '라일락'],
    ])
    expect(s.fake.calls.load).toHaveLength(0)

    await dialogButton(s, '듣기')?.trigger('click')
    await settle()
    expect(dialog(s).exists()).toBe(false)
    expect(s.playback.queueSource?.name).toBe('여름 밤 (2)')
  })

  it('기존 목록에 넣으면 같은 영상은 건너뛴다 · "보관함에서 보기" 는 그 목록을 연다', async () => {
    const s = boot({ hash: encodeShareLink(PLAYLIST_LINK) })
    await waitDialog(s)

    await dialog(s).get('select').setValue('one')
    expect(dialog(s).get('.dupes legend').text()).toContain('같은 영상 1곡')
    await dialogButton(s, '추가만 하기')?.trigger('click')
    await settle()

    expect(dialog(s).get('.results').text()).toContain('이미 있는 같은 영상 1곡은 건너뜀')
    expect(s.library.getPlaylist('one')?.tracks.map((t) => t.videoId)).toEqual([A, B, C])

    await dialogButton(s, '보관함에서 보기')?.trigger('click')
    await settle()
    expect(s.wrapper.get('#archive-panel').attributes('hidden')).toBeUndefined()
    expect(s.library.selectedPlaylistId).toBe('one')
  })

  it('보관함에 곡 구성이 같은 목록이 있으면 알린다', async () => {
    const s = boot({
      hash: encodeShareLink({
        ...PLAYLIST_LINK,
        tracks: [
          { videoId: A, title: '' },
          { videoId: B, title: '' },
        ],
      }),
    })
    await waitDialog(s)
    expect(dialog(s).get('.hint').text()).toContain('“ONE”')
  })

  it('Esc · 닫기는 아무것도 저장하지 않고 조각을 지운다', async () => {
    const s = boot({ hash: encodeShareLink(PLAYLIST_LINK) })
    await waitDialog(s)

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await settle()

    expect(dialog(s).exists()).toBe(false)
    expect(globalThis.location.hash).toBe('')
    expect(s.library.playlists).toHaveLength(2)
  })
})

describe('D. 받기 — 곡 · Moment · 제목 찾기 · 열린 탭', () => {
  it('곡 — "바로 듣기" 는 저장하지 않고 재생한다', async () => {
    const s = boot({
      hash: encodeShareLink({
        kind: 'track',
        name: '',
        tracks: [{ videoId: 'dQw4w9WgXcQ', title: '공유곡' }],
        moments: [],
      }),
    })
    await waitDialog(s)
    expect(dialog(s).get('.headline').text()).toBe('공유곡')

    await dialogButton(s, '바로 듣기')?.trigger('click')
    await settle()

    expect(dialog(s).exists()).toBe(false)
    expect(s.library.playlists.flatMap((p) => p.tracks)).toHaveLength(3)
    expect(s.playback.currentTrack?.title).toBe('공유곡')
    expect(s.fake.calls.load[s.fake.calls.load.length - 1]).toEqual({
      videoId: 'dQw4w9WgXcQ',
      autoplay: true,
      startSeconds: 0,
    })
  })

  it('곡 — "목록에 추가" 는 고른 목록(기본: 보관함에서 고른 목록)에 넣는다', async () => {
    const s = boot({
      hash: encodeShareLink({
        kind: 'track',
        name: '',
        tracks: [{ videoId: 'dQw4w9WgXcQ', title: '공유곡' }],
        moments: [],
      }),
      selected: 'two',
    })
    await waitDialog(s)
    expect((dialog(s).get('select').element as HTMLSelectElement).value).toBe('two')

    await dialogButton(s, '목록에 추가')?.trigger('click')
    await settle()
    expect(s.library.getPlaylist('two')?.tracks.map((t) => t.title)).toEqual(['Charlie', '공유곡'])
  })

  it('Moment — "Moment 저장" 은 Moment 만 저장하고, "그 순간부터 듣기" 는 그 초부터 재생한다', async () => {
    const s = boot({
      hash: encodeShareLink({
        kind: 'moment',
        name: '',
        tracks: [{ videoId: B, title: '브라보' }],
        moments: [{ videoId: B, atSeconds: 125, note: '여기\n두 줄' }],
      }),
    })
    await waitDialog(s)
    expect(dialog(s).get('.meta').text()).toContain('2:05 부터')
    expect(dialog(s).get('.moments').text()).toContain('여기')

    await dialogButton(s, 'Moment 저장')?.trigger('click')
    await settle()
    expect(s.moments.moments.map((m) => [m.videoId, m.atSeconds, m.note, m.title])).toEqual([
      [B, 125, '여기\n두 줄', '브라보'],
    ])
    expect(dialogButton(s, 'Moment 저장')?.attributes('disabled')).toBeDefined()
    expect(s.library.playlists.flatMap((p) => p.tracks)).toHaveLength(3)

    await dialogButton(s, '그 순간부터 듣기')?.trigger('click')
    await settle()
    expect(s.fake.calls.load[s.fake.calls.load.length - 1]).toEqual({
      videoId: B,
      autoplay: true,
      startSeconds: 125,
    })
  })

  it('곡 이름이 없는 링크는 YouTube(oEmbed)에서 제목을 찾아 보이고, 그 이름으로 넣는다', async () => {
    const fetchMock = vi.fn<(input: RequestInfo | URL) => Promise<Response>>(async (input) => {
      const url = String(input)
      const title = url.includes(A) ? '찾은 제목 A' : '찾은 제목 C'
      return new Response(JSON.stringify({ title }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    })
    vi.stubGlobal('fetch', fetchMock)
    const s = boot({
      hash: encodeShareLink({
        ...PLAYLIST_LINK,
        tracks: [
          { videoId: A, title: '' },
          { videoId: C, title: '' },
        ],
      }),
    })
    await waitDialog(s)
    await settle()

    // 날씨 위젯도 fetch 를 쓴다 — 제목 조회(oEmbed)만 센다.
    const oembed = fetchMock.mock.calls.filter(([input]) => String(input).includes('/oembed'))
    expect(oembed).toHaveLength(2)
    expect(
      dialog(s)
        .findAll('.tracks .title')
        .map((n) => n.text()),
    ).toEqual(['찾은 제목 A', '찾은 제목 C'])

    await dialogButton(s, '추가만 하기')?.trigger('click')
    await settle()
    expect(
      s.library.playlists.find((p) => p.name === '여름 밤')?.tracks.map((t) => t.title),
    ).toEqual(['찾은 제목 A', '찾은 제목 C'])
  })

  it('읽을 수 없는 링크는 이유와 할 일을 말하고, 닫으면 조각을 지운다', async () => {
    const good = encodeShareLink(PLAYLIST_LINK)
    const s = boot({ hash: good.slice(0, good.length - 10) })
    await waitDialog(s)

    expect(dialog(s).get('.error-title').text()).toBe('공유 링크를 열 수 없어요')
    expect(dialog(s).get('.error-text').text()).toContain('다시 받아 주세요')
    await dialogButton(s, '닫기')?.trigger('click')
    await settle()
    expect(dialog(s).exists()).toBe(false)
    expect(globalThis.location.hash).toBe('')
  })

  it('이미 열린 39page 탭에 공유 링크를 붙여 넣어도(hashchange) 미리보기가 뜬다', async () => {
    const s = boot()
    await settle()
    expect(dialog(s).exists()).toBe(false)

    globalThis.history.replaceState(null, '', `/${encodeShareLink(PLAYLIST_LINK)}`)
    globalThis.dispatchEvent(new Event('hashchange'))
    await waitDialog(s)

    expect(dialog(s).exists()).toBe(true)
    expect(dialog(s).get('.headline').text()).toBe('여름 밤')
  })
})
