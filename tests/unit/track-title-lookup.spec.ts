/**
 * 링크 추가 양식의 제목 미리 채우기 (D5 · ADR 0029).
 *
 * 지키는 것: 사용자가 쓴 제목을 덮지 않는다 · 저장된 제목을 바꾸지 않는다 · 조회 실패가 추가를 막지 않는다 ·
 * 사용자가 링크를 넣었을 때만 요청한다. 테스트는 네트워크에 나가지 않는다 — `fetch` 를 이 파일에서 흉내 낸다.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { nextTick } from 'vue'

import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import App from '@/app/App.vue'
import { TITLE_LOOKUP_DEBOUNCE_MS } from '@/features/library/useTitleLookup'
import {
  fetchYouTubeTitle,
  oembedUrl,
  TITLE_LOOKUP_TIMEOUT_MS,
  titleFromPayload,
} from '@/features/library/youtubeTitle'
import { FakePlayerAdapter } from '@/features/playback/FakePlayerAdapter'
import { PLAYER_ADAPTER_FACTORY } from '@/features/playback/PlayerAdapter'
import { STORAGE_KEYS } from '@/shared/storage'
import { useLibraryStore } from '@/stores/library'

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

/** oEmbed 요청만 센다 — 앱을 띄우면 날씨 위젯도 `fetch` 를 부른다. */
const oembedCalls = (mock: { mock: { calls: unknown[][] } }): string[] =>
  mock.mock.calls.map((call) => String(call[0])).filter((url) => url.includes('/oembed'))

/** 영상마다 다른 ID — 조회 결과를 탭 안에서 기억하므로 시험끼리 섞이지 않게. */
let seq = 0
const nextId = (): string => `t${String((seq += 1)).padStart(10, '0')}`

beforeEach(() => {
  globalThis.localStorage.clear()
  delete document.documentElement.dataset.theme
  setActivePinia(createPinia())
})

afterEach(() => {
  vi.useRealTimers()
  globalThis.localStorage.clear()
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

/* ================================================================== *
 * A. 조회 함수
 * ================================================================== */

describe('A. oEmbed 조회 — 던지지 않고 이유를 돌려준다', () => {
  it('주소 — 영상 ID 로 만든 표준 시청 주소만 보낸다', () => {
    expect(oembedUrl('M7lc1UVf-VE')).toBe(
      'https://www.youtube.com/oembed?format=json&url=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3DM7lc1UVf-VE',
    )
  })

  it('쿠키 · 리퍼러를 보내지 않는다', async () => {
    const fetchMock = vi.fn<FetchLike>(async () => json({ title: 'Song' }))
    vi.stubGlobal('fetch', fetchMock)
    await fetchYouTubeTitle('M7lc1UVf-VE')
    const init = fetchMock.mock.calls[0]?.[1] ?? {}
    expect(init.credentials).toBe('omit')
    expect(init.referrerPolicy).toBe('no-referrer')
  })

  it('상태별 결과 — 200 · 400 · 404 · 401 · 403 · 500 · 빈 제목 · JSON 아님 · 연결 실패', async () => {
    const cases: [() => Promise<Response>, unknown][] = [
      [async () => json({ title: '  Big Buck Bunny  ' }), { ok: true, title: 'Big Buck Bunny' }],
      [
        async () => new Response('Bad Request', { status: 400 }),
        { ok: false, reason: 'not-found' },
      ],
      [async () => new Response('', { status: 404 }), { ok: false, reason: 'not-found' }],
      [async () => new Response('', { status: 401 }), { ok: false, reason: 'unavailable' }],
      [async () => new Response('', { status: 403 }), { ok: false, reason: 'unavailable' }],
      [async () => new Response('', { status: 500 }), { ok: false, reason: 'network' }],
      [async () => json({ title: '   ' }), { ok: false, reason: 'invalid' }],
      [async () => new Response('<html>', { status: 200 }), { ok: false, reason: 'network' }],
      [
        async () => Promise.reject(new TypeError('Failed to fetch')),
        { ok: false, reason: 'network' },
      ],
    ]
    for (const [impl, expected] of cases) {
      vi.stubGlobal('fetch', vi.fn(impl))
      expect(await fetchYouTubeTitle('M7lc1UVf-VE')).toEqual(expected)
    }
  })

  it('시간 한도를 넘으면 그만두고 timeout', async () => {
    vi.useFakeTimers()
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init.signal?.addEventListener('abort', () =>
              reject(new DOMException('aborted', 'AbortError')),
            )
          }),
      ),
    )
    const pending = fetchYouTubeTitle('M7lc1UVf-VE')
    vi.advanceTimersByTime(TITLE_LOOKUP_TIMEOUT_MS)
    expect(await pending).toEqual({ ok: false, reason: 'timeout' })
  })

  it('응답 제목의 제어 문자는 공백으로, 문자열이 아니면 버린다', () => {
    expect(titleFromPayload({ title: 'A\nB\tC' })).toBe('A B C')
    expect(titleFromPayload({ title: 42 })).toBeNull()
    expect(titleFromPayload(null)).toBeNull()
  })
})

/* ================================================================== *
 * B. 링크 추가 양식
 * ================================================================== */

async function openForm() {
  const library = useLibraryStore()
  library.restore()
  await library.createPlaylist('MY RECORDS')
  const wrapper = mount(App, {
    attachTo: document.body,
    global: { provide: { [PLAYER_ADAPTER_FACTORY as symbol]: () => new FakePlayerAdapter() } },
  })
  await wrapper.findAll('.app-nav button')[0]?.trigger('click')
  await flushPromises()
  await wrapper
    .findAll('#archive-panel-music .pill')
    .find((b) => b.text() === '＋ YouTube 링크 추가')
    ?.trigger('click')
  await nextTick()
  return { wrapper, library }
}

const titleInput = (w: ReturnType<typeof mount>) => w.get<HTMLInputElement>('#track-title')
const statusLine = (w: ReturnType<typeof mount>) => w.get('#track-title-status')

function lastTrack(library: ReturnType<typeof useLibraryStore>) {
  const tracks = library.selectedPlaylist?.tracks ?? []
  return tracks[tracks.length - 1]
}

async function settle(ms = TITLE_LOOKUP_DEBOUNCE_MS): Promise<void> {
  vi.advanceTimersByTime(ms)
  await flushPromises()
  await nextTick()
}

async function submit(w: ReturnType<typeof mount>): Promise<void> {
  await w.get('form.link-form').trigger('submit')
  await flushPromises()
  await nextTick()
}

describe('B. 양식 — 제목 칸만 채우고, 사용자 · 저장을 앞서지 않는다', () => {
  it('링크를 넣고 400ms 뒤 한 번 묻고, 제목 칸을 채운다 → 추가하면 그 제목으로 저장', async () => {
    vi.useFakeTimers()
    const id = nextId()
    const fetchMock = vi.fn<FetchLike>(async () => json({ title: 'Never Gonna Give You Up' }))
    vi.stubGlobal('fetch', fetchMock)
    const { wrapper, library } = await openForm()

    await wrapper.get('#track-url').setValue(`https://youtu.be/${id}`)
    await settle(TITLE_LOOKUP_DEBOUNCE_MS - 1)
    expect(oembedCalls(fetchMock)).toHaveLength(0)
    await settle(1)
    expect(oembedCalls(fetchMock)).toHaveLength(1)
    expect(oembedCalls(fetchMock)[0]).toContain(id)
    expect(titleInput(wrapper).element.value).toBe('Never Gonna Give You Up')
    expect(statusLine(wrapper).text()).toBe('YouTube 에서 가져온 제목이에요. 고쳐도 돼요.')

    await submit(wrapper)
    expect(lastTrack(library)).toMatchObject({
      videoId: id,
      title: 'Never Gonna Give You Up',
    })
  })

  it('제목을 먼저 썼으면 묻지 않는다', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn<FetchLike>(async () => json({ title: 'From YouTube' }))
    vi.stubGlobal('fetch', fetchMock)
    const { wrapper } = await openForm()
    await titleInput(wrapper).setValue('내가 정한 이름')
    await wrapper.get('#track-url').setValue(`https://youtu.be/${nextId()}`)
    await settle()
    expect(oembedCalls(fetchMock)).toHaveLength(0)
    expect(titleInput(wrapper).element.value).toBe('내가 정한 이름')
  })

  it('묻는 중에 제목을 쓰면 늦게 온 결과를 버린다 — 사용자가 쓴 제목을 덮지 않는다', async () => {
    vi.useFakeTimers()
    let answer: (r: Response) => void = () => {}
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise<Response>((r) => (answer = r))),
    )
    const { wrapper } = await openForm()
    await wrapper.get('#track-url').setValue(`https://youtu.be/${nextId()}`)
    await settle()
    expect(statusLine(wrapper).text()).toBe('YouTube 에서 제목을 찾는 중…')

    await titleInput(wrapper).setValue('직접')
    answer(json({ title: 'From YouTube' }))
    await flushPromises()
    await nextTick()
    expect(titleInput(wrapper).element.value).toBe('직접')
    expect(statusLine(wrapper).text()).toBe('')
  })

  it('조회가 실패해도 추가된다 — 칸은 비고 이유를 말하며, 저장은 영상 ID 대체 표기', async () => {
    vi.useFakeTimers()
    const id = nextId()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('Bad Request', { status: 400 })),
    )
    const { wrapper, library } = await openForm()
    await wrapper.get('#track-url').setValue(`https://www.youtube.com/watch?v=${id}`)
    await settle()
    expect(titleInput(wrapper).element.value).toBe('')
    expect(statusLine(wrapper).text()).toBe(
      'YouTube 에서 이 영상의 제목을 찾지 못했어요. 직접 쓰거나, 비워 두면 영상 ID 로 저장돼요.',
    )
    expect(statusLine(wrapper).classes()).toContain('is-failed')

    await submit(wrapper)
    expect(lastTrack(library)).toMatchObject({
      videoId: id,
      title: `YouTube · ${id}`,
    })
  })

  it('조회를 기다리지 않고 추가한다 — 늦게 온 제목이 다음 링크의 칸을 채우지 않는다', async () => {
    vi.useFakeTimers()
    const id = nextId()
    let answer: (r: Response) => void = () => {}
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise<Response>((r) => (answer = r))),
    )
    const { wrapper, library } = await openForm()
    await wrapper.get('#track-url').setValue(`https://youtu.be/${id}`)
    await settle()
    await submit(wrapper) // 조회 중
    expect(lastTrack(library)).toMatchObject({
      videoId: id,
      title: `YouTube · ${id}`,
    })

    answer(json({ title: 'Late Title' }))
    await flushPromises()
    await nextTick()
    expect(titleInput(wrapper).element.value).toBe('')
    expect(statusLine(wrapper).text()).toBe('')
  })

  it('링크를 바꾸면 앞 영상의 (우리가 채운) 제목을 거두고 새로 묻는다', async () => {
    vi.useFakeTimers()
    const [first, second] = [nextId(), nextId()]
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => json({ title: url.includes(first) ? 'First' : 'Second' })),
    )
    const { wrapper } = await openForm()
    await wrapper.get('#track-url').setValue(`https://youtu.be/${first}`)
    await settle()
    expect(titleInput(wrapper).element.value).toBe('First')
    await wrapper.get('#track-url').setValue(`https://youtu.be/${second}`)
    expect(titleInput(wrapper).element.value).toBe('')
    await settle()
    expect(titleInput(wrapper).element.value).toBe('Second')
  })

  it('잘못된 링크 · 화면을 열기만 해서는 요청하지 않는다. 같은 영상은 한 번만 묻는다', async () => {
    vi.useFakeTimers()
    const id = nextId()
    const fetchMock = vi.fn<FetchLike>(async () => json({ title: 'Once' }))
    vi.stubGlobal('fetch', fetchMock)
    const { wrapper } = await openForm()
    await settle(5_000)
    await wrapper.get('#track-url').setValue('https://example.com/not-youtube')
    await settle()
    expect(oembedCalls(fetchMock)).toHaveLength(0)

    await wrapper.get('#track-url').setValue(`https://youtu.be/${id}`)
    await settle()
    await submit(wrapper)
    await wrapper.get('#track-url').setValue(`https://www.youtube.com/watch?v=${id}`)
    await settle()
    expect(oembedCalls(fetchMock)).toHaveLength(1)
    expect(titleInput(wrapper).element.value).toBe('Once')
  })

  it('저장된 제목은 건드리지 않는다 — 영상 ID 로 저장된 곡이 있어도 요청 0 · 저장소 그대로', async () => {
    vi.useFakeTimers()
    globalThis.localStorage.setItem(
      STORAGE_KEYS.library,
      JSON.stringify({
        version: 1,
        data: {
          playlists: [
            {
              id: 'p',
              name: 'P',
              tracks: [
                {
                  id: 't',
                  source: 'youtube',
                  videoId: 'M7lc1UVf-VE',
                  title: 'YouTube · M7lc1UVf-VE',
                },
              ],
            },
          ],
          selectedPlaylistId: 'p',
        },
      }),
    )
    const before = globalThis.localStorage.getItem(STORAGE_KEYS.library)
    const fetchMock = vi.fn<FetchLike>(async () => json({ title: 'Real Title' }))
    vi.stubGlobal('fetch', fetchMock)
    const library = useLibraryStore()
    library.restore()
    const wrapper = mount(App, {
      attachTo: document.body,
      global: { provide: { [PLAYER_ADAPTER_FACTORY as symbol]: () => new FakePlayerAdapter() } },
    })
    await wrapper.findAll('.app-nav button')[0]?.trigger('click')
    await settle(10_000)
    expect(oembedCalls(fetchMock)).toHaveLength(0)
    expect(globalThis.localStorage.getItem(STORAGE_KEYS.library)).toBe(before)
  })

  it('네트워크 요청은 조회 모듈 한 곳에서만 — 라이브러리 store 는 네트워크를 모른다', () => {
    const read = (file: string) => readFileSync(resolve(process.cwd(), file), 'utf8')
    expect(read('src/stores/library.ts')).not.toContain('fetch(')
    expect(read('src/features/library/PlaylistEditor.vue')).not.toContain('fetch(')
    expect(read('src/features/library/useTitleLookup.ts')).not.toContain('fetch(')
    expect(read('src/features/library/youtubeTitle.ts')).toContain("credentials: 'omit'")
  })
})
