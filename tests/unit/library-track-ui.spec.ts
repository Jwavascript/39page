import { nextTick } from 'vue'

import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import App from '@/app/App.vue'
import { FakePlayerAdapter } from '@/features/playback/FakePlayerAdapter'
import { PLAYER_ADAPTER_FACTORY } from '@/features/playback/PlayerAdapter'
import type { Track } from '@/shared/types'
import { useLibraryStore } from '@/stores/library'
import { usePlaybackStore } from '@/stores/playback'
import { useThemeStore } from '@/stores/theme'

const VIDEO_A = 'dQw4w9WgXcQ'
const URL_A = `https://www.youtube.com/watch?v=${VIDEO_A}`

function mountApp() {
  const fake = new FakePlayerAdapter()
  const wrapper = mount(App, {
    attachTo: document.body,
    global: { provide: { [PLAYER_ADAPTER_FACTORY as symbol]: () => fake } },
  })
  return { wrapper, fake }
}

type Wrapper = ReturnType<typeof mountApp>['wrapper']

const byText = (wrapper: Wrapper, selector: string, text: string) =>
  wrapper.findAll(selector).filter((node) => node.text() === text)[0]

async function openDrawer(wrapper: Wrapper) {
  await wrapper.get('.deck-open--mono-vinyl').trigger('click')
  await nextTick()
}

async function openLinkForm(wrapper: Wrapper) {
  await byText(wrapper, '.pill', '＋ YouTube 링크 추가')?.trigger('click')
  await nextTick()
}

async function submitLink(wrapper: Wrapper, url: string, title = '') {
  await wrapper.get('#track-url').setValue(url)
  if (title !== '') await wrapper.get('#track-title').setValue(title)
  await wrapper.get('form.link-form').trigger('submit')
  await nextTick()
}

function track(id: string): Track {
  return { id, source: 'youtube', videoId: VIDEO_A, title: `Track ${id}` }
}

/** 플레이리스트 하나를 만들고 드로어를 연다. */
async function setup() {
  const { wrapper, fake } = mountApp()
  const library = useLibraryStore()
  const created = library.createPlaylist('MY RECORDS')
  await openDrawer(wrapper)
  return { wrapper, fake, library, id: created.ok ? created.playlistId : '' }
}

beforeEach(() => {
  globalThis.localStorage.clear()
  delete document.documentElement.dataset.theme
  setActivePinia(createPinia())
})

afterEach(() => {
  globalThis.localStorage.clear()
  delete document.documentElement.dataset.theme
  document.body.innerHTML = ''
})

describe('B. 링크 등록 UI', () => {
  it('15. 폼을 열고 닫는다', async () => {
    const { wrapper } = await setup()
    expect(wrapper.find('form.link-form').exists()).toBe(false)

    await openLinkForm(wrapper)
    expect(wrapper.find('form.link-form').exists()).toBe(true)

    await byText(wrapper, '.pill', '취소')?.trigger('click')
    await nextTick()
    expect(wrapper.find('form.link-form').exists()).toBe(false)
  })

  it('16. 정상 URL 을 등록한다', async () => {
    const { wrapper, library, id } = await setup()

    await openLinkForm(wrapper)
    await submitLink(wrapper, URL_A, 'Never Gonna')

    expect(library.getPlaylist(id)?.tracks).toHaveLength(1)
    expect(library.getPlaylist(id)?.tracks[0]).toMatchObject({
      videoId: VIDEO_A,
      title: 'Never Gonna',
      source: 'youtube',
    })
    // 성공하면 폼이 닫히고 안내가 뜬다.
    expect(wrapper.find('form.link-form').exists()).toBe(false)
    expect(wrapper.get('.added').text()).toContain('Never Gonna')
  })

  it.each([
    ['youtu.be 단축', `https://youtu.be/${VIDEO_A}`],
    ['Shorts', `https://www.youtube.com/shorts/${VIDEO_A}`],
    ['YouTube Music', `https://music.youtube.com/watch?v=${VIDEO_A}`],
    ['embed', `https://www.youtube-nocookie.com/embed/${VIDEO_A}`],
    ['추가 파라미터', `${URL_A}&t=42s`],
  ])('16. %s URL 을 받아들인다', async (_label, url) => {
    const { wrapper, library, id } = await setup()

    await openLinkForm(wrapper)
    await submitLink(wrapper, url)

    expect(library.getPlaylist(id)?.tracks[0]?.videoId).toBe(VIDEO_A)
  })

  it.each([
    ['빈 입력', ''],
    ['공백', '   '],
    ['다른 사이트', 'https://vimeo.com/12345'],
    ['URL 이 아님', 'not a url'],
    ['재생목록 경로', 'https://www.youtube.com/playlist?list=PLabc'],
  ])('17. %s 은 오류를 표시하고 폼을 닫지 않는다', async (_label, url) => {
    const { wrapper, library, id } = await setup()

    await openLinkForm(wrapper)
    await submitLink(wrapper, url)

    expect(library.getPlaylist(id)?.tracks).toEqual([])
    expect(wrapper.get('#track-url-error').text()).toBe('올바른 YouTube 영상 링크를 입력해주세요.')
    expect(wrapper.find('form.link-form').exists()).toBe(true)
  })

  it('17. 실패해도 입력값을 지우지 않는다', async () => {
    // `input type="url"` 은 앞뒤 공백을 스스로 지우므로 공백만 있는 입력은
    // 값 보존을 확인할 수 없다. 일반 문자열로 검증한다.
    const { wrapper } = await setup()
    const typed = 'https://vimeo.com/12345'

    await openLinkForm(wrapper)
    await submitLink(wrapper, typed, '제목 유지')

    expect((wrapper.get('#track-url').element as HTMLInputElement).value).toBe(typed)
    expect((wrapper.get('#track-title').element as HTMLInputElement).value).toBe('제목 유지')
  })

  it('18. 제목을 비우면 기본 제목을 쓴다', async () => {
    const { wrapper, library, id } = await setup()

    await openLinkForm(wrapper)
    await submitLink(wrapper, URL_A)

    expect(library.getPlaylist(id)?.tracks[0]?.title).toBe(`YouTube · ${VIDEO_A}`)
  })

  it('19. 선택된 플레이리스트에만 추가한다', async () => {
    const { wrapper, library } = await setup()
    const b = library.createPlaylist('OTHER')
    const idB = b.ok ? b.playlistId : ''
    await nextTick()

    await openLinkForm(wrapper)
    await submitLink(wrapper, URL_A)

    expect(library.getPlaylist(idB)?.tracks).toHaveLength(1)
    expect(library.playlists.find((p) => p.name === 'MY RECORDS')?.tracks).toEqual([])
  })

  it('20. 폼이 열린 채 선택이 바뀌면 폼을 닫는다', async () => {
    const { wrapper, library } = await setup()
    library.createPlaylist('OTHER')
    await nextTick()

    await openLinkForm(wrapper)
    expect(wrapper.find('form.link-form').exists()).toBe(true)

    await wrapper.findAll('.playlist-select')[0]?.trigger('click')
    await nextTick()

    // 등록 대상이 모호해지지 않도록 닫는다.
    expect(wrapper.find('form.link-form').exists()).toBe(false)
  })

  it('20. 선택이 UI 밖에서 바뀌어도 열릴 때 정한 대상에 등록한다', async () => {
    // 드로어의 클릭 핸들러는 폼을 닫지만, 다른 경로로 선택이 바뀔 수도 있다.
    // 그때도 등록 대상이 흔들리지 않아야 한다.
    const { wrapper, library, id } = await setup()
    const other = library.createPlaylist('OTHER')
    const otherId = other.ok ? other.playlistId : ''
    library.selectPlaylist(id)
    await nextTick()

    await openLinkForm(wrapper)
    // store 를 직접 건드려 선택만 바꾼다 (폼은 열린 채로 남는다).
    library.selectPlaylist(otherId)
    await nextTick()
    await submitLink(wrapper, URL_A, 'Pinned')

    expect(library.getPlaylist(id)?.tracks.map((t) => t.title)).toEqual(['Pinned'])
    expect(library.getPlaylist(otherId)?.tracks).toEqual([])
  })

  it('20. 폼이 대상 플레이리스트를 명시한다', async () => {
    const { wrapper } = await setup()

    await openLinkForm(wrapper)

    expect(wrapper.get('.form-target').text()).toContain('MY RECORDS')
  })

  it('선택된 플레이리스트가 없으면 버튼이 비활성화된다', async () => {
    const { wrapper } = mountApp()
    await openDrawer(wrapper)

    const button = byText(wrapper, '.pill', '＋ YouTube 링크 추가')
    expect(button?.attributes('disabled')).toBeDefined()
    expect(wrapper.text()).toContain('플레이리스트를 먼저 만들거나 선택하면')
  })

  it('21. 등록 후 트랙 목록이 갱신된다', async () => {
    const { wrapper } = await setup()

    await openLinkForm(wrapper)
    await submitLink(wrapper, URL_A, 'Added Song')

    expect(wrapper.findAll('.track .track-name').map((n) => n.text())).toEqual(['Added Song'])
  })

  it('25. 입력에 label 과 오류가 연결된다', async () => {
    const { wrapper } = await setup()
    await openLinkForm(wrapper)

    expect(wrapper.find('label[for="track-url"]').exists()).toBe(true)
    expect(wrapper.find('label[for="track-title"]').exists()).toBe(true)
    expect(wrapper.get('#track-url').attributes('aria-describedby')).toBe('track-url-error')
    expect(wrapper.get('#track-title').attributes('maxlength')).toBe('100')
  })

  it('25. 네이티브 form 이라 Enter 로 제출된다', async () => {
    const { wrapper, library, id } = await setup()
    await openLinkForm(wrapper)

    // 네이티브 form 이면 입력 중 Enter 가 submit 을 일으킨다.
    expect(wrapper.get('form.link-form').element.tagName).toBe('FORM')
    expect(wrapper.get('form.link-form').find('button[type="submit"]').exists()).toBe(true)

    await wrapper.get('#track-url').setValue(URL_A)
    await wrapper.get('form.link-form').trigger('submit')
    await nextTick()

    expect(library.getPlaylist(id)?.tracks).toHaveLength(1)
  })
})

describe('B. 트랙 목록 UI', () => {
  async function withThreeTracks() {
    const ctx = await setup()
    for (const title of ['One', 'Two', 'Three']) {
      ctx.library.addTrack(ctx.id, { videoId: VIDEO_A, title })
    }
    await nextTick()
    return ctx
  }

  const titles = (wrapper: Wrapper) =>
    wrapper.findAll('.track .track-name').map((node) => node.text())

  it('22. 트랙을 삭제한다 (인라인 확인)', async () => {
    const { wrapper, library, id } = await withThreeTracks()

    await wrapper.findAll('.track-controls button')[2]?.trigger('click')
    await nextTick()
    // 확인 전에는 지워지지 않는다.
    expect(library.getPlaylist(id)?.tracks).toHaveLength(3)
    expect(wrapper.find('[aria-label="트랙 삭제 확인"]').exists()).toBe(true)

    await wrapper.get('[aria-label="트랙 삭제 확인"] .pill--strong').trigger('click')
    await nextTick()

    expect(titles(wrapper)).toEqual(['Two', 'Three'])
  })

  it('22. 삭제를 취소할 수 있다', async () => {
    const { wrapper, library, id } = await withThreeTracks()

    await wrapper.findAll('.track-controls button')[2]?.trigger('click')
    await nextTick()
    await byText(wrapper, '[aria-label="트랙 삭제 확인"] .pill', '취소')?.trigger('click')
    await nextTick()

    expect(library.getPlaylist(id)?.tracks).toHaveLength(3)
    expect(wrapper.find('[aria-label="트랙 삭제 확인"]').exists()).toBe(false)
  })

  it('23. 순서를 올리고 내린다', async () => {
    const { wrapper } = await withThreeTracks()

    // 두 번째 행의 ↑
    await wrapper.findAll('.track')[1]?.findAll('.track-controls button')[0]?.trigger('click')
    await nextTick()
    expect(titles(wrapper)).toEqual(['Two', 'One', 'Three'])

    // 첫 번째 행의 ↓
    await wrapper.findAll('.track')[0]?.findAll('.track-controls button')[1]?.trigger('click')
    await nextTick()
    expect(titles(wrapper)).toEqual(['One', 'Two', 'Three'])
  })

  it('24. 맨 위 ↑ 와 맨 아래 ↓ 가 비활성화된다', async () => {
    const { wrapper } = await withThreeTracks()
    const rows = wrapper.findAll('.track')

    expect(rows[0]?.findAll('.track-controls button')[0]?.attributes('disabled')).toBeDefined()
    expect(rows[0]?.findAll('.track-controls button')[1]?.attributes('disabled')).toBeUndefined()
    expect(rows[2]?.findAll('.track-controls button')[0]?.attributes('disabled')).toBeUndefined()
    expect(rows[2]?.findAll('.track-controls button')[1]?.attributes('disabled')).toBeDefined()
  })

  it('25. 트랙 버튼에 접근성 이름이 있다', async () => {
    const { wrapper } = await withThreeTracks()
    const labels = wrapper
      .findAll('.track-controls button')
      .map((node) => node.attributes('aria-label'))

    expect(labels.slice(0, 3)).toEqual(['One 위로', 'One 아래로', 'One 삭제'])
  })

  it('긴 제목이 잘려도 전체를 확인할 수 있다', async () => {
    const { wrapper, library, id } = await setup()
    const long = '아주 긴 제목'.repeat(10)
    library.addTrack(id, { videoId: VIDEO_A, title: long })
    await nextTick()

    expect(wrapper.get('.track-name').attributes('title')).toBe(long.slice(0, 100))
  })

  it('26. 빈 플레이리스트를 안내한다', async () => {
    const { wrapper } = await setup()
    expect(wrapper.get('.track-list').text()).toContain('아직 등록된 영상이 없어요')
    expect(wrapper.get('.track-list').text()).toContain('YouTube 링크 추가')
  })

  it('목록 key 가 배열 인덱스가 아니라 트랙 ID 다', async () => {
    const { wrapper, library, id } = await withThreeTracks()
    const rowsBefore = wrapper.findAll('.track').map((row) => row.element)
    const ids = library.getPlaylist(id)?.tracks.map((t) => t.id) ?? []

    library.moveTrack(id, ids[0] ?? '', 'down')
    await nextTick()

    // 같은 DOM 노드가 자리만 바뀐다. 인덱스 key 였다면 내용만 갈아끼워진다.
    const rowsAfter = wrapper.findAll('.track').map((row) => row.element)
    expect(rowsAfter[0]).toBe(rowsBefore[1])
    expect(rowsAfter[1]).toBe(rowsBefore[0])
  })
})

describe('D. Playback 독립성과 플레이어 DOM', () => {
  async function playing() {
    const ctx = await setup()
    const playback = usePlaybackStore()
    playback.setQueue([track('q1'), track('q2')], 1)
    playback.setPlayerState('playing')
    return { ...ctx, playback }
  }

  const snapshot = (playback: ReturnType<typeof usePlaybackStore>) => ({
    currentTrack: playback.currentTrack,
    queue: [...playback.queue],
    queueIndex: playback.queueIndex,
    playerState: playback.playerState,
  })

  it('35. 트랙 추가 후 재생 큐가 동일하다', async () => {
    const { wrapper, playback } = await playing()
    const before = snapshot(playback)

    await openLinkForm(wrapper)
    await submitLink(wrapper, URL_A, 'New')

    expect(snapshot(playback)).toEqual(before)
  })

  it('36. 트랙 삭제 후 재생 큐가 동일하다', async () => {
    const { wrapper, library, id, playback } = await playing()
    library.addTrack(id, { videoId: VIDEO_A, title: 'One' })
    await nextTick()
    const before = snapshot(playback)

    await wrapper.findAll('.track-controls button')[2]?.trigger('click')
    await wrapper.get('[aria-label="트랙 삭제 확인"] .pill--strong').trigger('click')
    await nextTick()

    expect(snapshot(playback)).toEqual(before)
  })

  it('37. 순서 변경 후 재생 큐가 동일하다', async () => {
    const { wrapper, library, id, playback } = await playing()
    for (const title of ['One', 'Two']) library.addTrack(id, { videoId: VIDEO_A, title })
    await nextTick()
    const before = snapshot(playback)

    await wrapper.findAll('.track')[1]?.findAll('.track-controls button')[0]?.trigger('click')
    await nextTick()

    expect(snapshot(playback)).toEqual(before)
  })

  it('38 · 39 · 40 · 41. 트랙 편집이 플레이어를 건드리지 않는다', async () => {
    const { wrapper, library, id, fake } = await setup()
    const surface = wrapper.get('[data-instance-id="player-main"]').element
    const mountHost = wrapper.get('.player-mount').element
    const adapterNode = fake.hostNode

    await openLinkForm(wrapper)
    await submitLink(wrapper, URL_A, 'One')
    library.addTrack(id, { videoId: VIDEO_A, title: 'Two' })
    await nextTick()
    await wrapper.findAll('.track')[1]?.findAll('.track-controls button')[0]?.trigger('click')
    await nextTick()
    await wrapper.findAll('.track-controls button')[2]?.trigger('click')
    await wrapper.get('[aria-label="트랙 삭제 확인"] .pill--strong').trigger('click')
    await nextTick()

    expect(wrapper.get('[data-instance-id="player-main"]').element).toBe(surface)
    expect(wrapper.get('.player-mount').element).toBe(mountHost)
    expect(fake.hostNode).toBe(adapterNode)
    expect(fake.calls.mount).toBe(1)
    expect(fake.calls.destroy).toBe(0)
  })

  it('42. 테마 전환과 트랙 편집을 반복해도 플레이어가 유지된다', async () => {
    const { wrapper, library, id, fake } = await setup()
    const surface = wrapper.get('[data-instance-id="player-main"]').element

    for (const theme of ['kawaii-synth-cassette', 'mono-vinyl'] as const) {
      library.addTrack(id, { videoId: VIDEO_A, title: theme })
      useThemeStore().setTheme(theme)
      await nextTick()
    }

    expect(wrapper.get('[data-instance-id="player-main"]').element).toBe(surface)
    expect(fake.calls.mount).toBe(1)
    expect(fake.calls.destroy).toBe(0)
    expect(library.getPlaylist(id)?.tracks).toHaveLength(2)
  })
})
