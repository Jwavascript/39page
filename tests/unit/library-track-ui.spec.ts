import { readFileSync } from 'node:fs'

import { nextTick } from 'vue'

import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import App from '@/app/App.vue'
import { FakePlayerAdapter } from '@/features/playback/FakePlayerAdapter'
import { PLAYER_ADAPTER_FACTORY } from '@/features/playback/PlayerAdapter'
import { STORAGE_KEYS } from '@/shared/storage'
import type { Track } from '@/shared/types'
import { useLibraryStore } from '@/stores/library'
import { usePlaybackStore } from '@/stores/playback'
import { useThemeStore } from '@/stores/theme'
import { openTrackManage, setReorderMode } from '../support/trackManage'

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
  // 저장은 탭 간 잠금을 지나 끝난다 (ADR 0025) — 끝난 뒤의 화면을 본다.
  await flushPromises()
}

function track(id: string): Track {
  return { id, source: 'youtube', videoId: VIDEO_A, title: `Track ${id}` }
}

/** 플레이리스트 하나를 만들고 드로어를 연다. */
async function setup() {
  const { wrapper, fake } = mountApp()
  const library = useLibraryStore()
  const created = await library.createPlaylist('MY RECORDS')
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

    // M11-3: 여러 개를 넣은 뒤에도 뜻이 맞게 "닫기" 다.
    await byText(wrapper, '.pill', '닫기')?.trigger('click')
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
    // M11-3: 성공해도 양식은 열린 채 입력만 비운다 — 링크를 이어서 넣을 수 있다. 안내가 뜬다.
    expect(wrapper.find('form.link-form').exists()).toBe(true)
    expect((wrapper.get('#track-url').element as HTMLInputElement).value).toBe('')
    expect((wrapper.get('#track-title').element as HTMLInputElement).value).toBe('')
    expect(document.activeElement).toBe(wrapper.get('#track-url').element)
    expect(wrapper.get('.added').text()).toContain('Never Gonna')
  })

  it('여러 링크를 이어서 넣는다 — 양식을 다시 열지 않는다 (M11-3)', async () => {
    const { wrapper, library, id } = await setup()

    await openLinkForm(wrapper)
    await submitLink(wrapper, URL_A, 'First')
    await submitLink(wrapper, `https://youtu.be/${VIDEO_A}`, 'Second')

    expect(library.getPlaylist(id)?.tracks.map((t) => t.title)).toEqual(['First', 'Second'])
    expect(wrapper.find('form.link-form').exists()).toBe(true)
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
    ['scheme 없는 YouTube 주소', 'youtube.com/watch?v=dQw4w9WgXcQ'],
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

  it('17. 주소가 아닌 글(곡 이름)은 오류 대신 "YouTube에서 찾기" 검색어로 옮긴다', async () => {
    const { wrapper, library, id } = await setup()

    await openLinkForm(wrapper)
    await submitLink(wrapper, '아이유 밤편지')

    expect(library.getPlaylist(id)?.tracks).toEqual([])
    expect(wrapper.get('#track-url-error').text()).toBe(
      '링크가 아니에요. 아래 "YouTube에서 검색" 으로 찾아보세요.',
    )
    expect((wrapper.get('#yt-search-query').element as HTMLInputElement).value).toBe(
      '아이유 밤편지',
    )
    // 링크 칸의 글은 그대로다.
    expect((wrapper.get('#track-url').element as HTMLInputElement).value).toBe('아이유 밤편지')
    // 브라우저 기본 검사(type="url")가 제출을 막지 않아야 이 안내가 나온다 — 실제 Chrome 에서 확인한 차이.
    expect(wrapper.get('form.link-form').attributes('novalidate')).toBeDefined()
  })

  it('YouTube에서 검색 — 검색 결과 페이지를 새 탭으로 연다 (API 키 없음 · 링크 추가는 제출되지 않는다)', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    const { wrapper, library, id } = await setup()
    await openLinkForm(wrapper)

    // 링크 양식과 따로 된 검색 양식이다.
    expect(wrapper.find('form.link-form #yt-search-query').exists()).toBe(false)
    await wrapper.get('#yt-search-query').setValue('  아이유   밤편지 ')
    await wrapper.get('form.yt-search').trigger('submit')
    await flushPromises()

    expect(open).toHaveBeenCalledTimes(1)
    expect(open).toHaveBeenCalledWith(
      'https://www.youtube.com/results?search_query=%EC%95%84%EC%9D%B4%EC%9C%A0%20%EB%B0%A4%ED%8E%B8%EC%A7%80',
      '_blank',
      'noopener,noreferrer',
    )
    expect(library.getPlaylist(id)?.tracks).toEqual([])
    expect(wrapper.get('#track-url-error').text()).toBe('')
    // 검색어를 저장하지 않는다.
    expect(Object.keys(globalThis.localStorage).filter((key) => /search/i.test(key))).toEqual([])
    open.mockRestore()
  })

  it('검색 칸은 링크 양식과 함께 열리고 닫히며, 다시 열면 비어 있다', async () => {
    const { wrapper } = await setup()
    expect(wrapper.find('form.yt-search').exists()).toBe(false)

    await openLinkForm(wrapper)
    await wrapper.get('#yt-search-query').setValue('검색어')
    await byText(wrapper, '.link-form .pill', '닫기')?.trigger('click')
    await nextTick()
    expect(wrapper.find('form.yt-search').exists()).toBe(false)

    await openLinkForm(wrapper)
    expect((wrapper.get('#yt-search-query').element as HTMLInputElement).value).toBe('')
    // 링크 칸으로 바로 가는 것은 그대로다 (M11 U15).
    expect(document.activeElement).toBe(wrapper.get('#track-url').element)
  })

  it('18. 제목을 비우면 기본 제목을 쓴다', async () => {
    const { wrapper, library, id } = await setup()

    await openLinkForm(wrapper)
    await submitLink(wrapper, URL_A)

    expect(library.getPlaylist(id)?.tracks[0]?.title).toBe(`YouTube · ${VIDEO_A}`)
  })

  it('19. 선택된 플레이리스트에만 추가한다', async () => {
    const { wrapper, library } = await setup()
    const b = await library.createPlaylist('OTHER')
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

    // 선택은 보관함의 목록 칸에서 바뀐다 (M11-7B). 새로 만든 OTHER 가 골라져 있으므로 첫 목록을 고른다.
    await wrapper.findAll('.archive-lists .list-select')[0]?.trigger('click')
    await flushPromises()
    await nextTick()

    // 등록 대상이 모호해지지 않도록 닫는다.
    expect(wrapper.find('form.link-form').exists()).toBe(false)
  })

  /*
   * M6-5 에서 뒤집힌 테스트다.
   *
   * 이전에는 "선택이 드로어 밖에서 바뀌어도 폼은 열린 채 원래 대상에
   * 등록한다" 였다. 그때는 선택을 바꾸는 유일한 UI 가 드로어 안에 있어서
   * '밖에서 바뀌는 경로' 가 비정상 경로였다.
   *
   * 지금은 선택을 바꾸는 곳이 **드로어 밖**(`PlaylistWidget`)이 정상이다.
   * 머리말은 새 목록을 가리키는데 폼이 옛 목록을 겨냥한 채 열려 있으면
   * 사용자가 어디에 쓰는지 알 수 없다. 그래서 **어떤 경로로 바뀌어도** 닫고,
   * 다시 열면 새 선택을 대상으로 한다.
   *
   * `linkTargetId` 가 열릴 때 대상을 붙잡는 것은 그대로다 — 폼이 살아남는
   * 경로가 생겨도 잘못된 목록에 들어가지 않게 하는 방어선이다.
   */
  it('20. 선택이 바뀌면 폼을 닫고, 다시 열면 새 대상을 겨냥한다', async () => {
    const { wrapper, library, id } = await setup()
    const other = await library.createPlaylist('OTHER')
    const otherId = other.ok ? other.playlistId : ''
    library.selectPlaylist(id)
    await nextTick()

    await openLinkForm(wrapper)
    expect(wrapper.get('.form-target').text()).toContain('MY RECORDS')

    // store 를 직접 건드려 선택만 바꾼다.
    library.selectPlaylist(otherId)
    await nextTick()
    expect(wrapper.find('form.link-form').exists()).toBe(false)

    await openLinkForm(wrapper)
    expect(wrapper.get('.form-target').text()).toContain('OTHER')
    await submitLink(wrapper, URL_A, 'Pinned')

    expect(library.getPlaylist(otherId)?.tracks.map((t) => t.title)).toEqual(['Pinned'])
    expect(library.getPlaylist(id)?.tracks).toEqual([])
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

    await openTrackManage(wrapper, 'One')
    await wrapper.get('[aria-label="One 삭제"]').trigger('click')
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

    await openTrackManage(wrapper, 'One')
    await wrapper.get('[aria-label="One 삭제"]').trigger('click')
    await nextTick()
    await byText(wrapper, '[aria-label="트랙 삭제 확인"] .pill', '취소')?.trigger('click')
    await nextTick()

    expect(library.getPlaylist(id)?.tracks).toHaveLength(3)
    expect(wrapper.find('[aria-label="트랙 삭제 확인"]').exists()).toBe(false)
  })

  it('23. 순서를 올리고 내린다', async () => {
    const { wrapper } = await withThreeTracks()

    // 두 번째 행의 ↑ — 한 칸 옮기기는 순서 모드(⇅)에 있다 (ADR 0044).
    await setReorderMode(wrapper, true)
    await wrapper.get('[aria-label="Two 위로"]').trigger('click')
    await nextTick()
    expect(titles(wrapper)).toEqual(['Two', 'One', 'Three'])

    // 맨 위가 된 Two 의 ↓
    await wrapper.get('[aria-label="Two 아래로"]').trigger('click')
    await nextTick()
    expect(titles(wrapper)).toEqual(['One', 'Two', 'Three'])
  })

  it('24. 맨 위 ↑ 와 맨 아래 ↓ 가 비활성화된다', async () => {
    const { wrapper } = await withThreeTracks()

    // 이름 변경과 삭제는 행 아이콘이고 어느 자리에서도 막지 않는다 (ADR 0044).
    expect(wrapper.get('[aria-label="One 이름 변경"]').attributes('disabled')).toBeUndefined()
    expect(wrapper.get('[aria-label="One 삭제"]').attributes('disabled')).toBeUndefined()

    // 위 · 아래는 순서 모드에.
    await setReorderMode(wrapper, true)
    expect(wrapper.get('[aria-label="One 위로"]').attributes('disabled')).toBeDefined()
    expect(wrapper.get('[aria-label="One 아래로"]').attributes('disabled')).toBeUndefined()
    expect(wrapper.get('[aria-label="Three 위로"]').attributes('disabled')).toBeUndefined()
    expect(wrapper.get('[aria-label="Three 아래로"]').attributes('disabled')).toBeDefined()
  })

  it('25. 행 오른쪽의 아이콘 — 이름 · 앨범아트 · 공유 · 삭제, 글자 없이 접근성 이름과 툴팁 (ADR 0044)', async () => {
    const { wrapper } = await withThreeTracks()

    // "관리" 메뉴는 없다.
    expect(wrapper.find('.track-manage').exists()).toBe(false)
    expect(wrapper.find('.track-controls').exists()).toBe(false)

    const group = wrapper.findAll('.track')[0]?.get('.track-icons')
    expect(group?.attributes('role')).toBe('group')
    expect(group?.attributes('aria-label')).toBe('One 동작')
    const buttons = group?.findAll('button') ?? []
    expect(buttons.map((node) => node.attributes('aria-label'))).toEqual([
      'One 이름 변경',
      // M12-3: 곡별 앨범아트 설정
      'One 앨범아트 설정',
      'One 공유',
      'One 삭제',
    ])
    expect(buttons.map((node) => node.attributes('title'))).toEqual([
      '이름 바꾸기',
      '앨범아트',
      '공유',
      '삭제',
    ])
    // 보이는 것은 아이콘뿐이다.
    for (const node of buttons) {
      expect(node.text()).toBe('')
      expect(node.find('.ui-icon').attributes('aria-hidden')).toBe('true')
    }
  })

  it('연필은 이름 폼을 열고 닫는 토글이다 — 한 번에 한 행만 고친다 (ADR 0044)', async () => {
    const { wrapper } = await withThreeTracks()

    await wrapper.get('[aria-label="One 이름 변경"]').trigger('click')
    await nextTick()
    expect(wrapper.findAll('.rename-form')).toHaveLength(1)
    expect(wrapper.get('[aria-label="One 이름 변경"]').attributes('aria-expanded')).toBe('true')

    await wrapper.get('[aria-label="Two 이름 변경"]').trigger('click')
    await nextTick()
    expect(wrapper.findAll('.rename-form')).toHaveLength(1)
    expect(wrapper.get('[aria-label="One 이름 변경"]').attributes('aria-expanded')).toBe('false')

    await wrapper.get('[aria-label="Two 이름 변경"]').trigger('click')
    await nextTick()
    expect(wrapper.find('.rename-form').exists()).toBe(false)
    expect(document.activeElement).toBe(wrapper.get('[aria-label="Two 이름 변경"]').element)
  })

  it('삭제 확인은 지울 행 바로 아래에 뜬다 (M11-3)', async () => {
    const { wrapper } = await withThreeTracks()

    await openTrackManage(wrapper, 'Two')
    await wrapper.get('[aria-label="Two 삭제"]').trigger('click')
    await nextTick()

    const confirm = wrapper.get('[aria-label="트랙 삭제 확인"]')
    const rows = wrapper.findAll('.track')
    expect(confirm.text()).toContain('Two')
    // Two 행 뒤 · Three 행 앞
    expect(
      (rows[1]?.element.compareDocumentPosition(confirm.element) ?? 0) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    expect(
      (rows[2]?.element.compareDocumentPosition(confirm.element) ?? 0) &
        Node.DOCUMENT_POSITION_PRECEDING,
    ).toBeTruthy()
  })

  it('긴 제목이 잘리지 않고 줄을 바꿔 전체가 보인다 (M11-3 U12)', async () => {
    const { wrapper, library, id } = await setup()
    const long = '아주 긴 제목'.repeat(10)
    library.addTrack(id, { videoId: VIDEO_A, title: long })
    await nextTick()

    expect(wrapper.get('.track-name').text()).toBe(long.slice(0, 100))
    const css = readFileSync('src/features/library/TrackList.vue', 'utf8')
    const block = /\.track-name \{[^}]*\}/.exec(css)?.[0] ?? ''
    expect(block).toContain('overflow-wrap: anywhere')
    expect(block).not.toContain('white-space: nowrap')
  })

  it('26. 빈 플레이리스트를 안내한다', async () => {
    const { wrapper } = await setup()
    // 설명 없이 한 줄 (ADR 0044) — 링크 추가는 바로 위 머리의 단추다.
    expect(wrapper.get('.track-list > .muted').text()).toBe('아직 곡이 없어요.')
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

describe('B2. 순서 편집 — 끌기 · 키보드 · 맨 위/아래 · 편집 모드 (M11-7C)', () => {
  async function withTracks(names = ['One', 'Two', 'Three', 'Four']) {
    const ctx = await setup()
    for (const title of names) await ctx.library.addTrack(ctx.id, { videoId: VIDEO_A, title })
    await flushPromises()
    return ctx
  }

  const titles = (wrapper: Wrapper) =>
    wrapper.findAll('.track .track-name').map((node) => node.text())
  const row = (wrapper: Wrapper, title: string) =>
    wrapper.findAll('.track').find((node) => node.get('.track-name').text() === title)
  const handle = (wrapper: Wrapper, title: string) => {
    const found = row(wrapper, title)
    if (found === undefined) throw new Error(`no row ${title}`)
    return found.get('.track-handle')
  }
  const status = (wrapper: Wrapper) => wrapper.get('.move-status')
  const storedTitles = () =>
    (
      JSON.parse(globalThis.localStorage.getItem(STORAGE_KEYS.library) as string).data.playlists[0]
        .tracks as Track[]
    ).map((t) => t.title)

  /** 행마다 높이 44, 간격 6 — 위에서부터 차례로 놓인 것처럼. */
  function layoutRows(wrapper: Wrapper): void {
    wrapper.findAll('.track').forEach((node, index) => {
      const top = index * 50
      ;(node.element as HTMLElement).getBoundingClientRect = () =>
        ({
          top,
          bottom: top + 44,
          height: 44,
          left: 0,
          right: 300,
          width: 300,
          x: 0,
          y: top,
        }) as DOMRect
    })
  }

  /** jsdom 에는 PointerEvent 가 없다 — 같은 모양의 MouseEvent 에 pointerId 를 붙인다. */
  async function pointer(target: ReturnType<Wrapper['get']>, type: string, clientY: number) {
    const event = new MouseEvent(type, { button: 0, clientY, bubbles: true, cancelable: true })
    Object.defineProperty(event, 'pointerId', { value: 7 })
    target.element.dispatchEvent(event)
    await nextTick()
  }

  it('손잡이를 끌면 놓일 자리에 선이 보이고, 놓으면 그 자리로 저장된다 — 결과를 알린다', async () => {
    const { wrapper } = await withTracks()
    layoutRows(wrapper)
    const grip = handle(wrapper, 'One')

    await pointer(grip, 'pointerdown', 20)
    await pointer(grip, 'pointermove', 140)
    // Two(25) · Three(125) 의 가운데를 지났다 → 옮긴 뒤 2번째 자리(index 2) — Three 아래에 선.
    expect(row(wrapper, 'One')?.classes()).toContain('is-dragging')
    expect(row(wrapper, 'Three')?.classes()).toContain('drop-after')
    expect(titles(wrapper)).toEqual(['One', 'Two', 'Three', 'Four'])

    await pointer(grip, 'pointerup', 140)
    await flushPromises()

    expect(titles(wrapper)).toEqual(['Two', 'Three', 'One', 'Four'])
    expect(storedTitles()).toEqual(['Two', 'Three', 'One', 'Four'])
    expect(status(wrapper).text()).toBe('“One” 을(를) 3번째로 옮겼어요 (4곡 중).')
    expect(status(wrapper).attributes('role')).toBe('status')
    expect(row(wrapper, 'One')?.classes()).toContain('is-moved')
    expect(wrapper.find('.drop-after, .drop-before, .is-dragging').exists()).toBe(false)
  })

  it('위로 끌면 그 자리 행의 위에 선이 보인다', async () => {
    const { wrapper } = await withTracks()
    layoutRows(wrapper)
    const grip = handle(wrapper, 'Four')

    await pointer(grip, 'pointerdown', 170)
    await pointer(grip, 'pointermove', 10)
    expect(row(wrapper, 'One')?.classes()).toContain('drop-before')
    await pointer(grip, 'pointerup', 10)
    await flushPromises()
    expect(titles(wrapper)).toEqual(['Four', 'One', 'Two', 'Three'])
  })

  it('조금만 움직이면(누르기) 옮기지 않는다 · Esc 로 끌기를 그만둔다', async () => {
    const { wrapper, library, id } = await withTracks()
    layoutRows(wrapper)
    const move = vi.spyOn(library, 'moveTrackTo')
    const grip = handle(wrapper, 'One')

    await pointer(grip, 'pointerdown', 20)
    await pointer(grip, 'pointermove', 22)
    await pointer(grip, 'pointerup', 22)

    await pointer(grip, 'pointerdown', 20)
    await pointer(grip, 'pointermove', 160)
    expect(row(wrapper, 'One')?.classes()).toContain('is-dragging')
    await grip.trigger('keydown', { key: 'Escape' })
    expect(row(wrapper, 'One')?.classes()).not.toContain('is-dragging')
    await pointer(grip, 'pointerup', 160)
    await flushPromises()

    expect(move).not.toHaveBeenCalled()
    expect(library.getPlaylist(id)?.tracks.map((t) => t.title)).toEqual([
      'One',
      'Two',
      'Three',
      'Four',
    ])
  })

  it('키보드 — 손잡이에서 ↑ ↓ 한 칸, Home End 맨 위 · 맨 아래, 옮긴 뒤에도 그 곡에 포커스', async () => {
    const { wrapper } = await withTracks()

    ;(handle(wrapper, 'Three').element as HTMLElement).focus()
    await handle(wrapper, 'Three').trigger('keydown', { key: 'ArrowUp' })
    await flushPromises()
    expect(titles(wrapper)).toEqual(['One', 'Three', 'Two', 'Four'])
    expect(document.activeElement).toBe(handle(wrapper, 'Three').element)
    expect(status(wrapper).text()).toBe('“Three” 을(를) 2번째로 옮겼어요 (4곡 중).')

    await handle(wrapper, 'Three').trigger('keydown', { key: 'End' })
    await flushPromises()
    expect(titles(wrapper)).toEqual(['One', 'Two', 'Four', 'Three'])
    expect(document.activeElement).toBe(handle(wrapper, 'Three').element)

    await handle(wrapper, 'Three').trigger('keydown', { key: 'Home' })
    await flushPromises()
    expect(titles(wrapper)).toEqual(['Three', 'One', 'Two', 'Four'])

    await handle(wrapper, 'Three').trigger('keydown', { key: 'ArrowDown' })
    await flushPromises()
    expect(titles(wrapper)).toEqual(['One', 'Three', 'Two', 'Four'])
    expect(handle(wrapper, 'Three').attributes('aria-label')).toBe('Three 순서 옮기기 (2번째)')
    expect(handle(wrapper, 'Three').attributes('aria-describedby')).toBe('track-handle-help')
  })

  it('경계의 화살표는 아무것도 하지 않는다 — 페이지도 굴리지 않는다', async () => {
    const { wrapper, library } = await withTracks()
    const move = vi.spyOn(library, 'moveTrackTo')
    const event = new KeyboardEvent('keydown', { key: 'ArrowUp', cancelable: true })
    handle(wrapper, 'One').element.dispatchEvent(event)
    await flushPromises()

    expect(event.defaultPrevented).toBe(true)
    expect(move).not.toHaveBeenCalled()
  })

  it('순서 모드의 ↑ · ↓ — 같은 단추에 포커스가 남고, 꺼지면 손잡이로', async () => {
    const { wrapper } = await withTracks()
    await setReorderMode(wrapper, true)

    await wrapper.get('[aria-label="Three 아래로"]').trigger('click')
    await flushPromises()
    await wrapper.get('[aria-label="Three 아래로"]').trigger('click')
    await flushPromises()
    expect(titles(wrapper)).toEqual(['One', 'Two', 'Four', 'Three'])
    // 맨 아래가 되어 단추가 꺼졌다 — 그 곡의 손잡이로.
    expect(document.activeElement).toBe(handle(wrapper, 'Three').element)

    await wrapper.get('[aria-label="Three 위로"]').trigger('click')
    await flushPromises()
    expect(titles(wrapper)).toEqual(['One', 'Two', 'Three', 'Four'])
    expect(document.activeElement).toBe(wrapper.get('[aria-label="Three 위로"]').element)
  })

  it('순서 모드(⇅) — 손잡이 · ↑ · ↓ 가 행마다 드러나고 ▶ · 행 아이콘은 숨는다. 다시 누르면 돌아온다', async () => {
    const { wrapper } = await withTracks(['One', 'Two', 'Three'])
    const toggle = wrapper.get('.edit-toggle')
    // 아이콘만 — 이름은 aria-label · title (ADR 0044).
    expect(toggle.text()).toBe('')
    expect(toggle.attributes('aria-label')).toBe('순서 바꾸기')
    expect(toggle.attributes('aria-pressed')).toBe('false')

    await toggle.trigger('click')
    expect(toggle.attributes('aria-pressed')).toBe('true')
    expect(wrapper.get('.track-list').classes()).toContain('is-editing')
    expect(wrapper.find('.track .track-play').exists()).toBe(false)
    expect(wrapper.find('.track .track-icons').exists()).toBe(false)
    const actions = row(wrapper, 'Two')?.get('.edit-actions')
    expect(actions?.attributes('role')).toBe('group')
    expect(actions?.findAll('button').map((b) => b.attributes('aria-label'))).toEqual([
      'Two 위로',
      'Two 아래로',
    ])
    expect(row(wrapper, 'One')?.get('.edit-up').attributes('disabled')).toBeDefined()

    await row(wrapper, 'Three')?.get('.edit-up').trigger('click')
    await flushPromises()
    expect(titles(wrapper)).toEqual(['One', 'Three', 'Two'])
    expect(document.activeElement).toBe(row(wrapper, 'Three')?.get('.edit-up').element)

    await toggle.trigger('click')
    expect(wrapper.get('.track-list').classes()).not.toContain('is-editing')
    expect(wrapper.findAll('.track .track-play')).toHaveLength(3)
  })

  it('손잡이는 손잡이에서만 터치 스크롤을 끄고, 터치 화면에서는 편집 모드에서만 보인다', () => {
    const css = readFileSync('src/features/library/TrackList.vue', 'utf8')
    const handleBlock = /\.track-handle \{[^}]*\}/.exec(css)?.[0] ?? ''
    expect(handleBlock).toContain('touch-action: none')
    expect(css).toMatch(
      /@media \(hover: none\), \(pointer: coarse\) \{\s*\.track-list:not\(\.is-editing\) \.track-handle \{\s*display: none;/,
    )
    // 행 전체 · 목록은 터치 스크롤을 막지 않는다.
    expect(/\.track \{[^}]*\}/.exec(css)?.[0] ?? '').not.toContain('touch-action')
  })

  it('저장소를 쓸 수 없으면 순서를 바꾸지 않고 경고한다 — 메모리만의 성공이 없다', async () => {
    const { wrapper } = await withTracks(['One', 'Two'])
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError')
    })

    await handle(wrapper, 'Two').trigger('keydown', { key: 'ArrowUp' })
    await flushPromises()

    expect(titles(wrapper)).toEqual(['One', 'Two'])
    expect(status(wrapper).classes()).toContain('is-warning')
    expect(status(wrapper).text()).toContain('순서를 바꾸지 않았어요')
    vi.restoreAllMocks()
  })

  it('다른 탭이 먼저 바꿨으면 최신을 보이고 다시 하라고 알린다', async () => {
    const { wrapper } = await withTracks(['One', 'Two', 'Three'])
    const raw = JSON.parse(globalThis.localStorage.getItem(STORAGE_KEYS.library) as string)
    raw.data.playlists[0].tracks.pop()
    globalThis.localStorage.setItem(STORAGE_KEYS.library, JSON.stringify(raw))

    await handle(wrapper, 'Two').trigger('keydown', { key: 'ArrowUp' })
    await flushPromises()

    expect(titles(wrapper)).toEqual(['One', 'Two'])
    expect(status(wrapper).classes()).toContain('is-warning')
  })

  it('삭제 — 확인을 받고, 지우면 다음 곡으로 · 취소하면 삭제 단추로 포커스가 돌아온다', async () => {
    const { wrapper } = await withTracks(['One', 'Two', 'Three'])

    await openTrackManage(wrapper, 'Two')
    await wrapper.get('[aria-label="Two 삭제"]').trigger('click')
    await nextTick()
    expect(document.activeElement).toBe(
      wrapper.get('[aria-label="트랙 삭제 확인"] .pill--strong').element,
    )
    await byText(wrapper, '[aria-label="트랙 삭제 확인"] .pill', '취소')?.trigger('click')
    await nextTick()
    expect(document.activeElement).toBe(wrapper.get('[aria-label="Two 삭제"]').element)

    await wrapper.get('[aria-label="Two 삭제"]').trigger('click')
    await nextTick()
    await wrapper.get('[aria-label="트랙 삭제 확인"] .pill--strong').trigger('click')
    await flushPromises()
    expect(titles(wrapper)).toEqual(['One', 'Three'])
    expect(document.activeElement).toBe(row(wrapper, 'Three')?.get('.track-play').element)
  })
})

/** 큐가 울리는 상태의 앱. C · D 가 함께 쓴다. */
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

describe('C. 트랙 이름 변경 (M6-5)', () => {
  /*
   * 보고 6c 의 답이다. 그때까지 이미 저장한 레코드의 이름을 바꿀 방법이 없었다.
   *
   * 폼은 고치는 **행 바로 아래**에 선다. 무엇의 이름인지 자리가 말해준다 —
   * 보고 6b 에서 위치가 뜻을 바꾼다는 것을 배웠다.
   */
  async function withTrack(title = 'Before') {
    const ctx = await setup()
    ctx.library.addTrack(ctx.id, { videoId: VIDEO_A, title })
    await nextTick()
    return ctx
  }

  it('✎ 를 누르면 그 행 아래에 폼이 열린다', async () => {
    const { wrapper } = await withTrack()

    expect(wrapper.find('form.rename-form').exists()).toBe(false)
    await openTrackManage(wrapper, 'Before')
    await wrapper.get('[aria-label="Before 이름 변경"]').trigger('click')
    await nextTick()

    const form = wrapper.get('form.rename-form')
    expect(form.get<HTMLInputElement>('input').element.value).toBe('Before')
    // 폼은 그 행 바로 다음 형제다.
    expect(wrapper.get('.track').element.nextElementSibling).toBe(form.element)
  })

  it('저장하면 이름이 바뀌고 폼이 닫힌다', async () => {
    const { wrapper, library, id } = await withTrack()

    await openTrackManage(wrapper, 'Before')
    await wrapper.get('[aria-label="Before 이름 변경"]').trigger('click')
    await wrapper.get('form.rename-form input').setValue('After')
    await wrapper.get('form.rename-form').trigger('submit')
    await nextTick()

    expect(library.getPlaylist(id)?.tracks.map((t) => t.title)).toEqual(['After'])
    expect(wrapper.find('form.rename-form').exists()).toBe(false)
    expect(wrapper.get('.track-name').text()).toBe('After')
  })

  it('취소하면 이름이 그대로다', async () => {
    const { wrapper, library, id } = await withTrack()

    await openTrackManage(wrapper, 'Before')
    await wrapper.get('[aria-label="Before 이름 변경"]').trigger('click')
    await wrapper.get('form.rename-form input').setValue('Discarded')
    await byText(wrapper, '.rename-form .pill', '취소')?.trigger('click')
    await nextTick()

    expect(library.getPlaylist(id)?.tracks.map((t) => t.title)).toEqual(['Before'])
    expect(wrapper.find('form.rename-form').exists()).toBe(false)
  })

  it('비우면 YouTube 영상 ID 표기로 되돌아간다', async () => {
    const { wrapper, library, id } = await withTrack()

    await openTrackManage(wrapper, 'Before')
    await wrapper.get('[aria-label="Before 이름 변경"]').trigger('click')
    await wrapper.get('form.rename-form input').setValue('')
    await wrapper.get('form.rename-form').trigger('submit')
    await nextTick()

    expect(library.getPlaylist(id)?.tracks[0]?.title).toBe(`YouTube · ${VIDEO_A}`)
  })

  it('한 번에 한 행만 고친다', async () => {
    const { wrapper, library, id } = await setup()
    for (const title of ['One', 'Two']) library.addTrack(id, { videoId: VIDEO_A, title })
    await nextTick()

    await openTrackManage(wrapper, 'One')
    await wrapper.get('[aria-label="One 이름 변경"]').trigger('click')
    await nextTick()
    await openTrackManage(wrapper, 'Two')
    await wrapper.get('[aria-label="Two 이름 변경"]').trigger('click')
    await nextTick()

    expect(wrapper.findAll('form.rename-form')).toHaveLength(1)
    expect(wrapper.get<HTMLInputElement>('form.rename-form input').element.value).toBe('Two')
  })

  it('삭제를 누르면 이름 변경 폼이 닫힌다 — 두 폼이 겹치지 않는다', async () => {
    const { wrapper } = await withTrack()

    await openTrackManage(wrapper, 'Before')
    await wrapper.get('[aria-label="Before 이름 변경"]').trigger('click')
    await nextTick()
    await openTrackManage(wrapper, 'Before')
    await wrapper.get('[aria-label="Before 삭제"]').trigger('click')
    await nextTick()

    expect(wrapper.find('form.rename-form').exists()).toBe(false)
    expect(wrapper.find('[aria-label="트랙 삭제 확인"]').exists()).toBe(true)
  })

  it('이름을 바꿔도 재생 큐가 흔들리지 않는다', async () => {
    const { wrapper, library, id, playback } = await playing()
    library.addTrack(id, { videoId: VIDEO_A, title: 'Before' })
    await nextTick()
    const before = snapshot(playback)

    await openTrackManage(wrapper, 'Before')
    await wrapper.get('[aria-label="Before 이름 변경"]').trigger('click')
    await wrapper.get('form.rename-form input').setValue('After')
    await wrapper.get('form.rename-form').trigger('submit')
    await nextTick()

    // 큐는 재생 시작 시점의 스냅샷이다 (`MVP_SPEC.md` F4).
    expect(snapshot(playback)).toEqual(before)
  })

  it('입력에 label 이 연결된다', async () => {
    const { wrapper } = await withTrack()

    await openTrackManage(wrapper, 'Before')
    await wrapper.get('[aria-label="Before 이름 변경"]').trigger('click')
    await nextTick()

    const input = wrapper.get('form.rename-form input')
    const label = wrapper.get('form.rename-form label')
    expect(label.attributes('for')).toBe(input.attributes('id'))
  })
})

describe('D. Playback 독립성과 플레이어 DOM', () => {
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

    await openTrackManage(wrapper, 'One')
    await wrapper.get('[aria-label="One 삭제"]').trigger('click')
    await nextTick()
    await wrapper.get('[aria-label="트랙 삭제 확인"] .pill--strong').trigger('click')
    await nextTick()

    expect(snapshot(playback)).toEqual(before)
  })

  it('37. 순서 변경 후 재생 큐가 동일하다', async () => {
    const { wrapper, library, id, playback } = await playing()
    for (const title of ['One', 'Two']) library.addTrack(id, { videoId: VIDEO_A, title })
    await nextTick()
    const before = snapshot(playback)

    // M11-3 전에는 이 줄이 없는 단추를 찾아 아무것도 누르지 않고 지나갔다 — 실제로 옮긴다.
    await setReorderMode(wrapper, true)
    await wrapper.get('[aria-label="Two 위로"]').trigger('click')
    await flushPromises()
    expect(
      library
        .getPlaylist(id)
        ?.tracks.map((t) => t.title)
        .slice(-2),
    ).toEqual(['Two', 'One'])

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
    await setReorderMode(wrapper, true)
    await wrapper.get('[aria-label="Two 위로"]').trigger('click')
    await flushPromises()
    await setReorderMode(wrapper, false)
    await wrapper.get('[aria-label="Two 삭제"]').trigger('click')
    await nextTick()
    await wrapper.get('[aria-label="트랙 삭제 확인"] .pill--strong').trigger('click')
    await flushPromises()
    expect(library.getPlaylist(id)?.tracks.map((t) => t.title)).toEqual(['One'])

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
