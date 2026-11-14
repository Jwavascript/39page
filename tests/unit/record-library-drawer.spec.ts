import { readFileSync } from 'node:fs'

import { nextTick } from 'vue'

import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import App from '@/app/App.vue'
import { FakePlayerAdapter } from '@/features/playback/FakePlayerAdapter'
import { PLAYER_ADAPTER_FACTORY } from '@/features/playback/PlayerAdapter'
import { STORAGE_KEYS } from '@/shared/storage'
import type { Track } from '@/shared/types'
import { LIBRARY_STORAGE_VERSION, useLibraryStore } from '@/stores/library'
import { usePlaybackStore } from '@/stores/playback'
import { useThemeStore } from '@/stores/theme'
import { openTrackManage } from '../support/trackManage'

const KEY = STORAGE_KEYS.library
const realLocalStorage = globalThis.localStorage

function stubLocalStorage(descriptor: PropertyDescriptor): void {
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, ...descriptor })
}

function track(id: string, videoId = 'dQw4w9WgXcQ'): Track {
  return { id, source: 'youtube', videoId, title: `Track ${id}` }
}

function seedRaw(raw: string): void {
  globalThis.localStorage.setItem(KEY, raw)
}

function readRaw(): string | null {
  return globalThis.localStorage.getItem(KEY)
}

function envelope(data: unknown, version = LIBRARY_STORAGE_VERSION): string {
  return JSON.stringify({ version, data })
}

function mountApp() {
  const fake = new FakePlayerAdapter()
  const wrapper = mount(App, {
    attachTo: document.body,
    global: { provide: { [PLAYER_ADAPTER_FACTORY as symbol]: () => fake } },
  })
  return { wrapper, fake }
}

type Wrapper = ReturnType<typeof mountApp>['wrapper']

const drawer = (wrapper: Wrapper) => wrapper.get('#archive-panel')
const isOpen = (wrapper: Wrapper) => drawer(wrapper).attributes('hidden') === undefined

/** 지금 보이는 데크의 열기 트리거. 비활성 테마의 것은 CSS 로 숨겨진다. */
function deckTrigger(wrapper: Wrapper, theme: 'mono-vinyl' | 'kawaii-synth-cassette') {
  return wrapper.get(`.deck-open--${theme}`)
}

/**
 * 드로어를 연다.
 *
 * M7 에서 여는 경로가 바뀌었다 — 데크는 **플레이리스트 위젯을 펼치고**,
 * 트랙 드로어는 **타일 본문**을 눌러서 연다. 여는 타일이 곧 편집 대상이므로
 * 어느 타일을 열지 고를 수 있어야 한다.
 *
 * 목록을 여기서 만들지 않는다. 드로어는 편집할 목록이 있을 때만 열린다.
 */
async function openDrawer(wrapper: Wrapper, index = 0) {
  await nextTick()
  // M11-7B: 목록은 보관함의 목록 칸에서 고른다. 그 목록을 고르고(있으면) 보관함을 연다.
  await wrapper.findAll('.archive-lists .list-select')[index]?.trigger('click')
  await flushPromises()
  if (wrapper.get('#archive-panel').attributes('hidden') !== undefined) {
    await wrapper
      .get('.now-playlist .open-archive, .now-playlist .widget-foot .pill')
      .trigger('click')
  }
  await flushPromises()
  await nextTick()
}

/*
 * M6-4 에서 플레이리스트를 드로어에서 **위젯으로 꺼냈다.**
 *
 * `＋ 새 목록` 은 플레이리스트가 사는 위젯에, `＋ YouTube 링크 추가` 는 트랙이
 * 사는 드로어에 있다. 위계가 공간에 드러나야 한다는 보고 6a 의 답이다.
 */
const createButton = (wrapper: Wrapper) => wrapper.get('.archive-lists .pill--strong')

/** 보관함 목록 칸의 생성 폼으로 플레이리스트를 만든다 (M11-7B — 만드는 곳은 보관함 하나다). */
async function createPlaylistViaUi(wrapper: Wrapper, name: string) {
  await createButton(wrapper).trigger('click')
  await wrapper.get('#archive-new-playlist-name').setValue(name)
  await wrapper.get('.archive-lists form.create-form').trigger('submit')
  await flushPromises()
  await nextTick()
}

/**
 * 고른 목록의 "관리" 를 편다 (M11-7B) — 이름 수정 · 목록 삭제는 목록 칸의 그 행 아래에 있다.
 * 이미 펴져 있으면 그대로 둔다.
 */
async function openListManage(wrapper: Wrapper) {
  const toggle = wrapper.get('.archive-lists .list-row.is-selected .list-manage')
  if (toggle.attributes('aria-expanded') !== 'true') await toggle.trigger('click')
  await nextTick()
}

/** 보관함 목록 칸의 행 — 누르면 그 목록을 고른다. */
const tileOpenButtons = (wrapper: Wrapper) => wrapper.findAll('.archive-lists .list-select')

async function switchTheme(key: 'mono-vinyl' | 'kawaii-synth-cassette') {
  useThemeStore().setTheme(key)
  await nextTick()
}

beforeEach(() => {
  globalThis.localStorage.clear()
  delete document.documentElement.dataset.theme
  setActivePinia(createPinia())
})

afterEach(() => {
  stubLocalStorage({ value: realLocalStorage, writable: true })
  globalThis.localStorage.clear()
  delete document.documentElement.dataset.theme
  document.body.innerHTML = ''
})

describe('A. 드로어 동작', () => {
  it('1. 최초에 닫혀 있다', () => {
    const { wrapper } = mountApp()

    expect(isOpen(wrapper)).toBe(false)
    expect(deckTrigger(wrapper, 'mono-vinyl').attributes('aria-expanded')).toBe('false')
  })

  /*
   * M7 에서 뒤집힌 테스트들이다.
   *
   * M2-2 부터 데크 트리거는 **트랙 드로어**를 열었다. 실기기 검증에서
   * "lp판을 누르면 최소화 되었던 playlist 위젯이 펼쳐지게" 로 바뀌었다.
   * 트랙 드로어는 플레이리스트 타일을 눌러서 연다.
   */
  it('2. Mono Vinyl LP 트리거가 음악 보관함을 연다 (M11-3)', async () => {
    const { wrapper } = mountApp()
    await deckTrigger(wrapper, 'mono-vinyl').trigger('click')
    await flushPromises()

    expect(isOpen(wrapper)).toBe(true)
    expect(wrapper.get('#archive-tab-music').attributes('aria-selected')).toBe('true')
    expect(deckTrigger(wrapper, 'mono-vinyl').attributes('aria-expanded')).toBe('true')
  })

  it('2. 보관함이 열린 동안 데크는 CSS 로만 접히고, 닫으면 같은 노드가 돌아온다 (M11-3)', async () => {
    const { wrapper } = mountApp()
    const deck = wrapper.get('.deck-widget').element
    await deckTrigger(wrapper, 'mono-vinyl').trigger('click')
    await flushPromises()
    expect(wrapper.get('.workspace').classes()).toContain('is-archive-open')

    await wrapper.get('[aria-label="보관함 닫기"]').trigger('click')
    await flushPromises()
    expect(isOpen(wrapper)).toBe(false)
    expect(wrapper.get('.deck-widget').element).toBe(deck)
  })

  it('3. Kawaii 카세트 트리거도 같은 선반을 펼친다', async () => {
    const { wrapper } = mountApp()
    await switchTheme('mono-vinyl')

    await switchTheme('kawaii-synth-cassette')
    await deckTrigger(wrapper, 'kawaii-synth-cassette').trigger('click')
    await nextTick()

    // 데크는 음악 보관함을 연다 (M11-3) — 두 테마가 같다.
    expect(isOpen(wrapper)).toBe(true)
    expect(wrapper.get('#archive-tab-music').attributes('aria-selected')).toBe('true')
  })

  it('3. 타일 본문이 트랙 드로어를 연다', async () => {
    const { wrapper } = mountApp()
    useLibraryStore().createPlaylist('A')
    await nextTick()

    await wrapper.get('.now-playlist .open-archive').trigger('click')
    await flushPromises()
    await nextTick()

    expect(isOpen(wrapper)).toBe(true)
  })

  it('3. 타일 본문도 같은 보관함을 그 목록으로 연다 — 데크와 같은 곳 (M11-3)', async () => {
    const { wrapper } = mountApp()
    useLibraryStore().createPlaylist('A')
    await flushPromises()

    await openDrawer(wrapper)
    await flushPromises()
    expect(isOpen(wrapper)).toBe(true)
    expect(wrapper.get('#playlist-editor-title').text()).toBe('A')
  })

  it('4. 닫기 버튼으로 닫힌다', async () => {
    const { wrapper } = mountApp()
    await openDrawer(wrapper)

    await wrapper.get('[aria-label="보관함 닫기"]').trigger('click')
    await nextTick()

    expect(isOpen(wrapper)).toBe(false)
  })

  it('5. Escape 로 닫힌다', async () => {
    const { wrapper } = mountApp()
    await openDrawer(wrapper)

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await nextTick()
    await nextTick()

    expect(isOpen(wrapper)).toBe(false)
  })

  it('6. 열면 고른 탭(음악)으로, 닫으면 트리거로 포커스가 간다 (M11-2 보관함)', async () => {
    const { wrapper } = mountApp()
    useLibraryStore().createPlaylist('A')
    await nextTick()

    // 트리거는 이제 타일 본문이다 (M7).
    const trigger = wrapper.get('.now-playlist .open-archive').element as HTMLElement
    trigger.focus()

    trigger.click()
    // 선택 저장이 끝난 뒤 드로어가 열린다 (ADR 0025).
    await flushPromises()
    await nextTick()
    await nextTick()
    expect(document.activeElement).toBe(wrapper.get('#archive-tab-music').element)

    await wrapper.get('[aria-label="보관함 닫기"]').trigger('click')
    await flushPromises()
    await nextTick()
    await nextTick()
    expect(document.activeElement).toBe(trigger)
  })

  it('7. 테마를 바꿔도 열린 상태와 선택이 유지된다', async () => {
    const { wrapper } = mountApp()
    const library = useLibraryStore()
    library.createPlaylist('A')
    const b = await library.createPlaylist('B')
    await nextTick()
    // 두 번째 목록(=B)을 골라 보관함을 연다.
    await openDrawer(wrapper, 1)

    await switchTheme('mono-vinyl')

    expect(isOpen(wrapper)).toBe(true)
    expect(library.selectedPlaylistId).toBe(b.ok ? b.playlistId : null)
  })

  it('8. 닫힌 드로어의 조작 요소가 Tab 순서에 남지 않는다', () => {
    const { wrapper } = mountApp()

    // hidden 속성이 있으면 안쪽 버튼이 포커스 대상이 아니다.
    expect(drawer(wrapper).attributes('hidden')).toBeDefined()
  })

  it('데크 트리거가 aria-controls 로 보관함을 가리킨다 (M11-3)', () => {
    const { wrapper } = mountApp()
    for (const theme of ['mono-vinyl', 'kawaii-synth-cassette'] as const) {
      expect(deckTrigger(wrapper, theme).attributes('aria-controls')).toBe('archive-panel')
      expect(deckTrigger(wrapper, theme).attributes('aria-expanded')).toBe('false')
    }
  })

  it('포커스 가둠이 없으므로 aria-modal 을 선언하지 않는다', () => {
    const { wrapper } = mountApp()
    expect(drawer(wrapper).attributes('aria-modal')).toBeUndefined()
  })

  it('데크 안내 문구가 테마에 따라 바뀐다', async () => {
    const { wrapper } = mountApp()
    // 기본 테마는 Kawaii Synth Cassette 다 (M11-7B).
    expect(wrapper.get('.deck-hint').text()).toContain('카세트를 누르면')

    await switchTheme('mono-vinyl')
    expect(wrapper.get('.deck-hint').text()).toContain('LP를 누르면')
  })
})

describe('B. 플레이리스트 UI', () => {
  it('9. 플레이리스트 목록을 표시한다', async () => {
    const { wrapper } = mountApp()
    const library = useLibraryStore()
    library.createPlaylist('MY RECORDS')
    library.createPlaylist('NIGHT DRIVE')
    await openDrawer(wrapper)

    // 목록은 보관함의 목록 칸에 있다 (M11-7B).
    const names = wrapper.findAll('.archive-lists .list-name').map((node) => node.text())
    expect(names).toEqual(['MY RECORDS', 'NIGHT DRIVE'])
  })

  it('10. 생성하면 바로 선택된다', async () => {
    const { wrapper } = mountApp()
    const library = useLibraryStore()

    // 생성은 위젯의 일이다. 드로어를 열 필요가 없다 (M6-4).
    await createPlaylistViaUi(wrapper, 'NEW LIST')

    expect(library.playlists.map((playlist) => playlist.name)).toEqual(['NEW LIST'])
    expect(library.selectedPlaylist?.name).toBe('NEW LIST')
  })

  it('공백 이름은 거부하고 오류를 표시한다', async () => {
    const { wrapper } = mountApp()
    const library = useLibraryStore()

    await createPlaylistViaUi(wrapper, '   ')

    expect(library.playlists).toEqual([])
    expect(wrapper.get('.create-form .error-msg').text()).toContain('이름을 입력')
    // 실패했으므로 폼이 닫히지 않는다. 사용자가 고쳐 쓸 수 있어야 한다.
    expect(wrapper.find('form.create-form').exists()).toBe(true)
  })

  it('11. 이름을 바꾸고 취소할 수 있다', async () => {
    const { wrapper } = mountApp()
    const library = useLibraryStore()
    const created = await library.createPlaylist('OLD')
    const id = created.ok ? created.playlistId : ''
    await openDrawer(wrapper)

    // 이름 수정 → 저장
    await openListManage(wrapper)
    await wrapper
      .findAll('.pill')
      .filter((b) => b.text() === '이름 수정')[0]
      ?.trigger('click')
    await flushPromises()
    await wrapper.get('#playlist-name').setValue('RENAMED')
    await wrapper.get('form.name-form').trigger('submit')
    await flushPromises()
    await nextTick()
    expect(library.getPlaylist(id)?.name).toBe('RENAMED')

    // 다시 열고 취소
    await openListManage(wrapper)
    await wrapper
      .findAll('.pill')
      .filter((b) => b.text() === '이름 수정')[0]
      ?.trigger('click')
    await flushPromises()
    await wrapper.get('#playlist-name').setValue('IGNORED')
    await wrapper
      .findAll('.pill')
      .filter((b) => b.text() === '취소')[0]
      ?.trigger('click')
    await flushPromises()
    await nextTick()

    expect(library.getPlaylist(id)?.name).toBe('RENAMED')
    expect(wrapper.find('form.name-form').exists()).toBe(false)
  })

  it('12. 삭제 전에 확인을 받는다', async () => {
    const { wrapper } = mountApp()
    const library = useLibraryStore()
    library.createPlaylist('A')
    library.createPlaylist('B')
    // 두 번째 목록(=B)을 골라 그 행의 관리를 편다.
    await openDrawer(wrapper, 1)
    await openListManage(wrapper)

    await wrapper
      .findAll('.pill')
      .filter((b) => b.text() === '목록 삭제')[0]
      ?.trigger('click')
    await nextTick()

    // 확인 단계에서는 아직 지워지지 않는다.
    expect(library.playlists).toHaveLength(2)
    expect(wrapper.find('[role="alertdialog"]').exists()).toBe(true)

    await wrapper.get('[role="alertdialog"] .pill--strong').trigger('click')
    await nextTick()

    expect(library.playlists.map((playlist) => playlist.name)).toEqual(['A'])
  })

  it('13. 마지막 목록은 삭제 버튼이 비활성화된다', async () => {
    const { wrapper } = mountApp()
    const library = useLibraryStore()
    library.createPlaylist('ONLY')
    await openDrawer(wrapper)
    await openListManage(wrapper)

    const deleteButton = wrapper.findAll('.pill').filter((b) => b.text() === '목록 삭제')[0]
    expect(deleteButton?.attributes('disabled')).toBeDefined()
    expect(library.playlists).toHaveLength(1)
  })

  it('14. 선택 상태와 트랙 수를 표시한다', async () => {
    const { wrapper } = mountApp()
    const library = useLibraryStore()
    seedRaw(
      envelope({
        playlists: [
          { id: 'p1', name: 'A', tracks: [track('t1'), track('t2')] },
          { id: 'p2', name: 'B', tracks: [] },
        ],
        selectedPlaylistId: 'p2',
      }),
    )
    library.restore()
    // 저장된 선택은 p2(=B) 다. 그 타일을 열어 선택을 유지한다.
    await openDrawer(wrapper, 1)

    const tiles = wrapper.findAll('.archive-lists .list-row')
    expect(tiles[0]?.find('.list-meta').text()).toBe('2곡')
    // 빈 목록은 트랙 수 대신 비었음을 말한다 (M6-4).
    expect(tiles[1]?.find('.list-meta').text()).toBe('비어 있음')
    expect(tiles[1]?.classes()).toContain('is-selected')
    expect(tiles[1]?.find('.list-select').attributes('aria-current')).toBe('true')
    expect(tiles[0]?.find('.list-select').attributes('aria-current')).toBeUndefined()
    // 목록 칸에는 재생 단추가 없다 (M11-7B) — 상세 칸의 전체 재생이 빈 목록에서 꺼져 있다.
    expect(tiles[1]?.find('.list-play').exists()).toBe(false)
    expect(
      wrapper.get('.playlist-editor .head-actions .pill--strong').attributes('disabled'),
    ).toBeDefined()
    // 대시보드의 NOW PLAYLIST 는 고른 목록(B)을 "재생 대기" 로 보인다 — 재생 중이라고 하지 않는다.
    expect(wrapper.get('.now-playlist').attributes('data-view')).toBe('standby')
    expect(wrapper.get('.now-playlist .state-chip').text()).toBe('재생 대기')

    // 드로어 머리말이 **무엇을 편집하는지** 말한다 (보고 6b).
    expect(wrapper.get('#playlist-editor-title').text()).toBe('B')
  })

  it('선택을 바꿔도 재생 큐가 그대로다', async () => {
    const { wrapper } = mountApp()
    const library = useLibraryStore()
    const playback = usePlaybackStore()
    library.createPlaylist('A')
    const b = await library.createPlaylist('B')
    playback.setQueue([track('q1'), track('q2')], 1)
    const before = { queue: [...playback.queue], index: playback.queueIndex }
    await openDrawer(wrapper)

    await tileOpenButtons(wrapper)[0]?.trigger('click')
    await nextTick()

    expect(library.selectedPlaylistId).not.toBe(b.ok ? b.playlistId : null)
    expect(playback.queue).toEqual(before.queue)
    expect(playback.queueIndex).toBe(before.index)
  })

  it('15. 빈 라이브러리를 안내한다', () => {
    const { wrapper } = mountApp()

    /*
     * 목록이 없으면 NOW PLAYLIST 가 시작점을 안내한다 — 보관함에서 목록을 만든다 (M11-7B).
     */
    expect(wrapper.findAll('.now-playlist .track-row')).toHaveLength(0)
    expect(wrapper.get('.now-playlist').attributes('data-view')).toBe('none')
    expect(wrapper.get('.now-playlist').text()).toContain('아직 플레이리스트가 없어요')
    expect(wrapper.get('.now-playlist').text()).toContain('보관함에서 목록 만들기')
    // 드로어 자체의 빈 상태 문구는 그대로 둔다 (선택이 없을 때의 방어선).
    expect(wrapper.get('.track-list').text()).toContain('플레이리스트를 선택하면')
  })

  it('16. 트랙 목록을 순서·제목·영상 ID 와 함께 표시한다', async () => {
    const { wrapper } = mountApp()
    const library = useLibraryStore()
    seedRaw(
      envelope({
        playlists: [{ id: 'p1', name: 'A', tracks: [track('t1'), track('t2')] }],
        selectedPlaylistId: 'p1',
      }),
    )
    library.restore()
    await openDrawer(wrapper)

    expect(wrapper.findAll('.track .track-order').map((n) => n.text())).toEqual(['1', '2'])
    expect(wrapper.findAll('.track .track-name').map((n) => n.text())).toEqual([
      'Track t1',
      'Track t2',
    ])
    expect(wrapper.findAll('.track .track-id').map((n) => n.text())).toEqual([
      'dQw4w9WgXcQ',
      'dQw4w9WgXcQ',
    ])
    // M11-3: 행에는 ▶ 재생과 "관리" 만 드러나 있다. 관리를 펼치면 글자 이름이 있는 단추 넷.
    expect(wrapper.findAll('.track .track-manage').map((n) => n.text())).toEqual(['관리', '관리'])
    expect(wrapper.find('.track-controls').exists()).toBe(false)
    await openTrackManage(wrapper, 'Track t1')
    expect(
      wrapper.findAll('.track-controls button').map((node) => node.attributes('aria-label')),
    ).toEqual(['Track t1 이름 변경', 'Track t1 위로', 'Track t1 아래로', 'Track t1 삭제'])
  })

  it('빈 플레이리스트를 안내한다', async () => {
    const { wrapper } = mountApp()
    const library = useLibraryStore()
    library.createPlaylist('EMPTY')
    await openDrawer(wrapper)

    expect(wrapper.get('.track-list').text()).toContain('아직 등록된 영상이 없어요')
  })
})

describe('C. 영속화와 보호', () => {
  it('17. 최초 실행에서만 MY RECORDS 를 만든다', async () => {
    const library = useLibraryStore()

    expect(library.restore()).toBe('empty')
    const seeded = await library.seedFirstRunPlaylist('MY RECORDS')

    expect(seeded?.ok).toBe(true)
    expect(library.playlists.map((playlist) => playlist.name)).toEqual(['MY RECORDS'])
  })

  it('17. 사용자가 전부 지운 빈 라이브러리는 최초 실행이 아니다', async () => {
    seedRaw(envelope({ playlists: [], selectedPlaylistId: null }))
    const library = useLibraryStore()

    expect(library.restore()).toBe('stored')
    expect(await library.seedFirstRunPlaylist('MY RECORDS')).toBeNull()
    expect(library.playlists).toEqual([])
  })

  it('17. 기존 데이터가 있으면 만들지 않는다', async () => {
    seedRaw(
      envelope({ playlists: [{ id: 'p1', name: 'KEEP', tracks: [] }], selectedPlaylistId: 'p1' }),
    )
    const library = useLibraryStore()
    library.restore()

    expect(await library.seedFirstRunPlaylist('MY RECORDS')).toBeNull()
    expect(library.playlists.map((playlist) => playlist.name)).toEqual(['KEEP'])
  })

  it.each([
    ['손상된 데이터', '{not json'],
    [
      '미래 버전',
      JSON.stringify({ version: 99, data: { playlists: [], selectedPlaylistId: null } }),
    ],
  ])('17. %s 에서는 자동 생성하지 않는다', async (_label, raw) => {
    seedRaw(raw)
    const library = useLibraryStore()
    library.restore()

    expect(library.status).toBe('protected')
    expect(await library.seedFirstRunPlaylist('MY RECORDS')).toBeNull()
    // 원본도 그대로다.
    expect(readRaw()).toBe(raw)
  })

  it('17. 저장소를 쓸 수 없으면 자동 생성하지 않는다', async () => {
    stubLocalStorage({
      get() {
        throw new Error('blocked')
      },
    })
    const library = useLibraryStore()
    library.restore()

    expect(library.status).toBe('unavailable')
    expect(await library.seedFirstRunPlaylist('MY RECORDS')).toBeNull()
  })

  it('18. 복원만으로 저장소에 쓰지 않는다', () => {
    const raw = envelope({
      playlists: [{ id: 'p1', name: 'A', tracks: [] }],
      selectedPlaylistId: 'p1',
    })
    seedRaw(raw)
    const library = useLibraryStore()

    library.restore()

    expect(readRaw()).toBe(raw)
  })

  it('19. 새로고침 후 목록과 선택이 복원된다', async () => {
    const first = useLibraryStore()
    first.restore()
    first.seedFirstRunPlaylist('MY RECORDS')
    first.createPlaylist('NIGHT DRIVE')
    const expectedNames = first.playlists.map((playlist) => playlist.name)
    const expectedSelected = first.selectedPlaylistId

    // 새로고침을 모사한다.
    setActivePinia(createPinia())
    const { wrapper } = mountApp()
    const second = useLibraryStore()
    second.restore()
    await nextTick()

    expect(second.playlists.map((playlist) => playlist.name)).toEqual(expectedNames)
    expect(second.selectedPlaylistId).toBe(expectedSelected)
    expect(wrapper.findAll('.archive-lists .list-name').map((n) => n.text())).toEqual(expectedNames)
  })

  it('20. protected 상태를 경고로 알린다', async () => {
    seedRaw('{not json')
    const { wrapper } = mountApp()
    useLibraryStore().restore()
    await openDrawer(wrapper)

    const banner = wrapper.get('.status-region')
    expect(banner.text()).toContain('자동 저장이 중단')
    expect(banner.text()).toContain('원본 데이터는 보존')
  })

  it('21. unavailable 상태를 경고로 알린다', async () => {
    stubLocalStorage({
      get() {
        throw new Error('blocked')
      },
    })
    const { wrapper } = mountApp()
    useLibraryStore().restore()
    await openDrawer(wrapper)

    expect(wrapper.get('.status-region').text()).toContain('저장소를 쓸 수 없습니다')
  })

  it('22. persisted: false 를 알린다', async () => {
    seedRaw('{not json')
    const { wrapper } = mountApp()
    const library = useLibraryStore()
    library.restore()

    await createPlaylistViaUi(wrapper, 'IN MEMORY ONLY')

    expect(library.playlists).toHaveLength(1)
    // 만든 자리에서 알린다 — 보관함의 목록 칸 (M11-7B).
    expect(wrapper.get('.archive-lists .notice').text()).toContain('저장되지 않았습니다')
  })

  it('23. 보호 상태에서 원본이 보존된다', async () => {
    const raw = '{not json'
    seedRaw(raw)
    const { wrapper } = mountApp()
    const library = useLibraryStore()
    library.restore()

    await createPlaylistViaUi(wrapper, 'NEW')

    expect(readRaw()).toBe(raw)
  })

  it('ready 상태에서는 경고를 띄우지 않는다', async () => {
    const { wrapper } = mountApp()
    const library = useLibraryStore()
    library.restore()
    library.createPlaylist('A')
    await openDrawer(wrapper)

    expect(wrapper.get('.status-region').text()).toBe('')
    expect(wrapper.find('.unsaved').exists()).toBe(false)
  })

  /*
   * M8-2 에서 전제가 바뀐 테스트다.
   *
   * 이전에는 보호 상태에 "복구" 라는 말이 붙은 버튼이 **하나도 없어야** 했다.
   * ADR 0007 이 복구 UI 를 범위에서 뺐고, 없는 기능의 버튼을 만들지 않는다는
   * 원칙 때문이다.
   *
   * 이제 `복구본 내보내기` 가 있고 **실제로 동작한다** — 읽지 못한 원본 대신
   * 이번 세션의 내용을 파일로 꺼낸다. 그래서 "복구라는 말이 없다" 가 아니라
   * **"있는 것은 동작한다"** 를 고정한다.
   *
   * 저장된 원본을 되살리거나 버리는 조작은 **아직 없다** (M8-3).
   */
  it('24. 보호 상태의 복구본 내보내기는 동작하고, 없는 기능의 버튼은 없다', async () => {
    seedRaw('{not json')
    const { wrapper } = mountApp()
    useLibraryStore().restore()
    await openDrawer(wrapper)

    const labels = wrapper.findAll('button').map((button) => button.text())

    expect(labels.filter((label) => label.includes('복구'))).toEqual(['복구본 내보내기'])
    expect(wrapper.find('.backup').exists()).toBe(true)

    /*
     * M8-3 에서 가져오기가 생겼다. 이것도 **동작하는** 경로다 — 보호 상태의
     * 원본을 백업으로 교체할 수 있고, 그 전에 원문을 내려받을 수 있다.
     */
    expect(labels.filter((label) => label.includes('가져오기'))).toEqual(['JSON 백업 가져오기'])

    // 아직 없는 기능의 버튼은 두지 않는다.
    for (const absent of ['초기화', '되살리', '병합', '동기화']) {
      expect(labels.filter((label) => label.includes(absent))).toEqual([])
    }
  })
})

describe('D. 플레이어 안정성', () => {
  it('25 · 26. 드로어를 열고 닫아도 PlayerSurface DOM 이 동일하다', async () => {
    const { wrapper } = mountApp()
    const surface = wrapper.get('[data-instance-id="player-main"]').element
    const mount = wrapper.get('.player-mount').element

    await openDrawer(wrapper)
    expect(wrapper.get('[data-instance-id="player-main"]').element).toBe(surface)
    expect(wrapper.get('.player-mount').element).toBe(mount)

    await wrapper.get('[aria-label="보관함 닫기"]').trigger('click')
    await nextTick()

    expect(wrapper.get('[data-instance-id="player-main"]').element).toBe(surface)
    expect(wrapper.get('.player-mount').element).toBe(mount)
  })

  it('27 · 28. 드로어 열고 닫기가 mount / destroy 를 유발하지 않는다', async () => {
    const { wrapper, fake } = mountApp()
    expect(fake.calls.mount).toBe(1)

    for (let i = 0; i < 3; i += 1) {
      await openDrawer(wrapper)
      await wrapper.get('[aria-label="보관함 닫기"]').trigger('click')
      await nextTick()
    }

    expect(fake.calls.mount).toBe(1)
    expect(fake.calls.destroy).toBe(0)
    expect(fake.isMounted).toBe(true)
  })

  it('29. 드로어와 테마 전환을 번갈아 해도 DOM 이 동일하다', async () => {
    const { wrapper, fake } = mountApp()
    const surface = wrapper.get('[data-instance-id="player-main"]').element
    const host = fake.hostNode
    const parent = (host as HTMLElement).parentElement

    await openDrawer(wrapper)
    await switchTheme('mono-vinyl')
    await wrapper.get('[aria-label="보관함 닫기"]').trigger('click')
    await nextTick()
    await switchTheme('mono-vinyl')
    await openDrawer(wrapper)

    expect(wrapper.get('[data-instance-id="player-main"]').element).toBe(surface)
    expect(fake.hostNode).toBe(host)
    expect((fake.hostNode as HTMLElement).parentElement).toBe(parent)
    expect(fake.calls.mount).toBe(1)
    expect(fake.calls.destroy).toBe(0)
  })

  it('WidgetHost 가 드로어와 형제이며 제거되지 않는다', async () => {
    const { wrapper } = mountApp()
    const host = wrapper.get('.widget-host').element
    const workspace = wrapper.get('.workspace').element

    expect(host.parentElement).toBe(workspace)
    expect(drawer(wrapper).element.parentElement).toBe(workspace)

    await openDrawer(wrapper)

    expect(wrapper.get('.widget-host').element).toBe(host)
    expect(host.parentElement).toBe(workspace)
  })

  it('30. Library 조작 후 Playback 상태가 불변이다', async () => {
    const { wrapper } = mountApp()
    const library = useLibraryStore()
    const playback = usePlaybackStore()
    library.createPlaylist('A')
    const b = await library.createPlaylist('B')
    playback.setQueue([track('q1'), track('q2')], 1)
    playback.setPlayerState('playing')
    const before = {
      currentTrack: playback.currentTrack,
      queue: [...playback.queue],
      queueIndex: playback.queueIndex,
      playerState: playback.playerState,
    }

    await openDrawer(wrapper)
    await tileOpenButtons(wrapper)[0]?.trigger('click')
    await flushPromises()
    await openListManage(wrapper)
    await wrapper
      .findAll('.pill')
      .filter((p) => p.text() === '목록 삭제')[0]
      ?.trigger('click')
    await wrapper.get('[role="alertdialog"] .pill--strong').trigger('click')
    await nextTick()

    expect(library.getPlaylist(b.ok ? b.playlistId : '')).toBeDefined()
    expect({
      currentTrack: playback.currentTrack,
      queue: [...playback.queue],
      queueIndex: playback.queueIndex,
      playerState: playback.playerState,
    }).toEqual(before)
  })
})

describe('E. 좁은 드로어에서의 트랙 행 폭 (2026-11-06 운영 검증에서 발견)', () => {
  /**
   * 가로 화면 드로어는 1440px 뷰포트 안의 339px 짜리 좁은 열이다. 그래서
   * 영상 ID 를 접는 기준이 **뷰포트가 아니라 목록 자신의 폭**이어야 한다.
   *
   * jsdom 은 레이아웃을 계산하지 않으므로 실제 폭으로는 확인할 수 없다.
   * 그래서 보장을 이루는 **두 조각을 모두** 본다 — 컨테이너를 선언하는 쪽과
   * 그 컨테이너에 질의하는 쪽. 한쪽만 보면 나머지 한쪽이 사라져도 통과한다.
   */
  const source = () => readFileSync('src/features/library/TrackList.vue', 'utf8')

  it('.track-list 가 인라인 크기 컨테이너를 선언한다', () => {
    const block = /\.track-list\s*\{[^}]*\}/.exec(source())?.[0] ?? ''

    expect(block).toContain('container-type: inline-size')
  })

  it('영상 ID 를 접는 질의가 컨테이너 폭을 본다', () => {
    expect(source()).toMatch(
      /@container\s*\(max-width:\s*420px\)\s*\{\s*\.track-id\s*\{\s*display:\s*none/,
    )
  })

  it('컨테이너 질의를 모르는 브라우저를 위한 뷰포트 질의도 남아 있다', () => {
    expect(source()).toMatch(
      /@media\s*\(max-width:\s*420px\)\s*\{\s*\.track-id\s*\{\s*display:\s*none/,
    )
  })
})

describe('F. 긴 이름·긴 제목이 드로어를 넓히지 않는다 (M9-6 실측에서 발견)', () => {
  /**
   * 플레이리스트 이름과 트랙 제목은 `nowrap` + 말줄임이다. 말줄임은 상자가
   * **줄어들 수 있을 때만** 일어난다. 390px 에서 60자 이름을 열면 머리말이
   * 드로어 밖으로 늘어나 닫기(×)가 화면 밖 638px 에 섰고, 100자 제목 하나가
   * `.drawer-body` 에 +441px 가로 스크롤을 만들었다. 공백이 있는 이름도 같다.
   *
   * jsdom 은 레이아웃을 하지 않으므로 보장을 이루는 조각을 모두 고정한다.
   */
  // M11-2: 드로어의 틀은 보관함(ArchivePanel), 목록 머리말은 편집 표면(PlaylistEditor)이 맡는다.
  const archive = () => readFileSync('src/features/archive/ArchivePanel.vue', 'utf8')
  const editor = () => readFileSync('src/features/library/PlaylistEditor.vue', 'utf8')
  const list = () => readFileSync('src/features/library/TrackList.vue', 'utf8')

  it('머리말의 글 상자가 줄어들 수 있고, 닫기 버튼은 줄지 않는다', () => {
    expect(editor()).toContain('<div class="editor-head">')
    expect(editor()).toMatch(/\.editor-head \{[^}]*min-width: 0/)
    expect(archive()).toMatch(/\.close \{[^}]*flex: none/)
    // 탭 줄은 줄어들 수 있다 — 닫기(×)를 밀어내지 않는다.
    expect(archive()).toMatch(/\.tabs \{[^}]*min-width: 0/)
    // M11-3: 긴 이름은 잘리지 않고 줄을 바꾼다 (U12) — 목록 머리말이 보관함 폭을 넘지 않는다.
    expect(editor()).toMatch(/\.drawer-title \{[^}]*overflow-wrap: anywhere/)
  })

  it('트랙 목록의 열이 목록 폭에 묶여 있다', () => {
    const block = /\.track-list\s*\{[^}]*\}/.exec(list())?.[0] ?? ''

    expect(block).toContain('grid-template-columns: minmax(0, 1fr)')
    expect(list()).toMatch(/\.track-name \{[^}]*min-width: 0/)
  })
})
