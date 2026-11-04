import { nextTick } from 'vue'

import { mount } from '@vue/test-utils'
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

const drawer = (wrapper: Wrapper) => wrapper.get('#record-library-drawer')
const isOpen = (wrapper: Wrapper) => drawer(wrapper).attributes('hidden') === undefined

/** 지금 보이는 데크의 열기 트리거. 비활성 테마의 것은 CSS 로 숨겨진다. */
function deckTrigger(wrapper: Wrapper, theme: 'mono-vinyl' | 'kawaii-synth-cassette') {
  return wrapper.get(`.deck-open--${theme}`)
}

async function openDrawer(wrapper: Wrapper) {
  await deckTrigger(wrapper, 'mono-vinyl').trigger('click')
  await nextTick()
}

/*
 * M6-4 에서 플레이리스트를 드로어에서 **위젯으로 꺼냈다.**
 *
 * `＋ 새 목록` 은 플레이리스트가 사는 위젯에, `＋ YouTube 링크 추가` 는 트랙이
 * 사는 드로어에 있다. 위계가 공간에 드러나야 한다는 보고 6a 의 답이다.
 */
const createButton = (wrapper: Wrapper) => wrapper.get('.playlist-widget .pill--strong')

/** 위젯의 생성 폼으로 플레이리스트를 만든다. */
async function createPlaylistViaUi(wrapper: Wrapper, name: string) {
  await createButton(wrapper).trigger('click')
  await wrapper.get('#new-playlist-name').setValue(name)
  await wrapper.get('form.create-form').trigger('submit')
  await nextTick()
}

/** 타일의 `⋯` — 그 목록을 선택하고 편집 오버레이를 연다. */
const tileOpenButtons = (wrapper: Wrapper) => wrapper.findAll('.playlist-tile .playlist-open')

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

  it('2. Mono Vinyl LP 트리거로 열린다', async () => {
    const { wrapper } = mountApp()

    await openDrawer(wrapper)

    expect(isOpen(wrapper)).toBe(true)
    expect(deckTrigger(wrapper, 'mono-vinyl').attributes('aria-expanded')).toBe('true')
  })

  it('3. Kawaii 카세트 트리거로 열린다', async () => {
    const { wrapper } = mountApp()
    await switchTheme('kawaii-synth-cassette')

    await deckTrigger(wrapper, 'kawaii-synth-cassette').trigger('click')
    await nextTick()

    expect(isOpen(wrapper)).toBe(true)
  })

  it('4. 닫기 버튼으로 닫힌다', async () => {
    const { wrapper } = mountApp()
    await openDrawer(wrapper)

    await wrapper.get('[aria-label="라이브러리 닫기"]').trigger('click')
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

  it('6. 열면 닫기 버튼으로, 닫으면 트리거로 포커스가 간다', async () => {
    const { wrapper } = mountApp()
    const trigger = deckTrigger(wrapper, 'mono-vinyl').element as HTMLElement
    trigger.focus()

    await trigger.click()
    await nextTick()
    await nextTick()
    expect(document.activeElement).toBe(wrapper.get('[aria-label="라이브러리 닫기"]').element)

    await wrapper.get('[aria-label="라이브러리 닫기"]').trigger('click')
    await nextTick()
    await nextTick()
    expect(document.activeElement).toBe(trigger)
  })

  it('7. 테마를 바꿔도 열린 상태와 선택이 유지된다', async () => {
    const { wrapper } = mountApp()
    const library = useLibraryStore()
    library.createPlaylist('A')
    const b = library.createPlaylist('B')
    await openDrawer(wrapper)

    await switchTheme('kawaii-synth-cassette')

    expect(isOpen(wrapper)).toBe(true)
    expect(library.selectedPlaylistId).toBe(b.ok ? b.playlistId : null)
  })

  it('8. 닫힌 드로어의 조작 요소가 Tab 순서에 남지 않는다', () => {
    const { wrapper } = mountApp()

    // hidden 속성이 있으면 안쪽 버튼이 포커스 대상이 아니다.
    expect(drawer(wrapper).attributes('hidden')).toBeDefined()
  })

  it('트리거가 aria-controls 로 드로어를 가리킨다', () => {
    const { wrapper } = mountApp()

    for (const theme of ['mono-vinyl', 'kawaii-synth-cassette'] as const) {
      expect(deckTrigger(wrapper, theme).attributes('aria-controls')).toBe('record-library-drawer')
    }
  })

  it('포커스 가둠이 없으므로 aria-modal 을 선언하지 않는다', () => {
    const { wrapper } = mountApp()
    expect(drawer(wrapper).attributes('aria-modal')).toBeUndefined()
  })

  it('데크 안내 문구가 테마에 따라 바뀐다', async () => {
    const { wrapper } = mountApp()
    expect(wrapper.get('.deck-hint').text()).toContain('LP를 누르면')

    await switchTheme('kawaii-synth-cassette')
    expect(wrapper.get('.deck-hint').text()).toContain('카세트를 누르면')
  })
})

describe('B. 플레이리스트 UI', () => {
  it('9. 플레이리스트 목록을 표시한다', async () => {
    const { wrapper } = mountApp()
    const library = useLibraryStore()
    library.createPlaylist('MY RECORDS')
    library.createPlaylist('NIGHT DRIVE')
    await openDrawer(wrapper)

    // 목록은 이제 위젯의 타일 격자다 (M6-4).
    const names = wrapper.findAll('.playlist-tile .pname').map((node) => node.text())
    expect(names).toEqual(['MY RECORDS', 'NIGHT DRIVE'])
  })

  it('10. 생성하면 바로 선택된다', async () => {
    const { wrapper } = mountApp()
    const library = useLibraryStore()
    await openDrawer(wrapper)

    await createPlaylistViaUi(wrapper, 'NEW LIST')

    expect(library.playlists.map((playlist) => playlist.name)).toEqual(['NEW LIST'])
    expect(library.selectedPlaylist?.name).toBe('NEW LIST')
  })

  it('공백 이름은 거부하고 오류를 표시한다', async () => {
    const { wrapper } = mountApp()
    const library = useLibraryStore()
    await openDrawer(wrapper)

    await createPlaylistViaUi(wrapper, '   ')

    expect(library.playlists).toEqual([])
    expect(wrapper.get('.create-form .error-msg').text()).toContain('이름을 입력')
    // 실패했으므로 폼이 닫히지 않는다. 사용자가 고쳐 쓸 수 있어야 한다.
    expect(wrapper.find('form.create-form').exists()).toBe(true)
  })

  it('11. 이름을 바꾸고 취소할 수 있다', async () => {
    const { wrapper } = mountApp()
    const library = useLibraryStore()
    const created = library.createPlaylist('OLD')
    const id = created.ok ? created.playlistId : ''
    await openDrawer(wrapper)

    // 이름 수정 → 저장
    await wrapper
      .findAll('.pill')
      .filter((b) => b.text() === '이름 수정')[0]
      ?.trigger('click')
    await wrapper.get('#playlist-name').setValue('RENAMED')
    await wrapper.get('form.name-form').trigger('submit')
    await nextTick()
    expect(library.getPlaylist(id)?.name).toBe('RENAMED')

    // 다시 열고 취소
    await wrapper
      .findAll('.pill')
      .filter((b) => b.text() === '이름 수정')[0]
      ?.trigger('click')
    await wrapper.get('#playlist-name').setValue('IGNORED')
    await wrapper
      .findAll('.pill')
      .filter((b) => b.text() === '취소')[0]
      ?.trigger('click')
    await nextTick()

    expect(library.getPlaylist(id)?.name).toBe('RENAMED')
    expect(wrapper.find('form.name-form').exists()).toBe(false)
  })

  it('12. 삭제 전에 확인을 받는다', async () => {
    const { wrapper } = mountApp()
    const library = useLibraryStore()
    library.createPlaylist('A')
    library.createPlaylist('B')
    await openDrawer(wrapper)

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
    await openDrawer(wrapper)

    const tiles = wrapper.findAll('.playlist-tile')
    expect(tiles[0]?.find('.pmeta').text()).toBe('2 TRACKS')
    // 빈 목록은 트랙 수 대신 비었음을 말한다 (M6-4).
    expect(tiles[1]?.find('.pmeta').text()).toBe('EMPTY')
    expect(tiles[1]?.classes()).toContain('is-selected')
    expect(tiles[1]?.find('.playlist-play').attributes('aria-current')).toBe('true')
    expect(tiles[0]?.find('.playlist-play').attributes('aria-current')).toBeUndefined()

    // 드로어 머리말이 **무엇을 편집하는지** 말한다 (보고 6b).
    expect(wrapper.get('#record-library-title').text()).toBe('B')
  })

  it('선택을 바꿔도 재생 큐가 그대로다', async () => {
    const { wrapper } = mountApp()
    const library = useLibraryStore()
    const playback = usePlaybackStore()
    library.createPlaylist('A')
    const b = library.createPlaylist('B')
    playback.setQueue([track('q1'), track('q2')], 1)
    const before = { queue: [...playback.queue], index: playback.queueIndex }
    await openDrawer(wrapper)

    await tileOpenButtons(wrapper)[0]?.trigger('click')
    await nextTick()

    expect(library.selectedPlaylistId).not.toBe(b.ok ? b.playlistId : null)
    expect(playback.queue).toEqual(before.queue)
    expect(playback.queueIndex).toBe(before.index)
  })

  it('15. 빈 라이브러리를 안내한다', async () => {
    const { wrapper } = mountApp()
    await openDrawer(wrapper)

    expect(wrapper.get('.playlist-widget').text()).toContain('아직 플레이리스트가 없습니다')
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
    // M6-5 부터 각 행에 ✎ ↑ ↓ × 네 개가 있다. ▶ 는 `.track-play` 로 따로 있다.
    expect(wrapper.findAll('.track .track-controls button')).toHaveLength(8)
    expect(
      wrapper
        .findAll('.track')[0]
        ?.findAll('.track-controls button')
        .map((node) => node.attributes('aria-label')),
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
  it('17. 최초 실행에서만 MY RECORDS 를 만든다', () => {
    const library = useLibraryStore()

    expect(library.restore()).toBe('empty')
    const seeded = library.seedFirstRunPlaylist('MY RECORDS')

    expect(seeded?.ok).toBe(true)
    expect(library.playlists.map((playlist) => playlist.name)).toEqual(['MY RECORDS'])
  })

  it('17. 사용자가 전부 지운 빈 라이브러리는 최초 실행이 아니다', () => {
    seedRaw(envelope({ playlists: [], selectedPlaylistId: null }))
    const library = useLibraryStore()

    expect(library.restore()).toBe('stored')
    expect(library.seedFirstRunPlaylist('MY RECORDS')).toBeNull()
    expect(library.playlists).toEqual([])
  })

  it('17. 기존 데이터가 있으면 만들지 않는다', () => {
    seedRaw(
      envelope({ playlists: [{ id: 'p1', name: 'KEEP', tracks: [] }], selectedPlaylistId: 'p1' }),
    )
    const library = useLibraryStore()
    library.restore()

    expect(library.seedFirstRunPlaylist('MY RECORDS')).toBeNull()
    expect(library.playlists.map((playlist) => playlist.name)).toEqual(['KEEP'])
  })

  it.each([
    ['손상된 데이터', '{not json'],
    [
      '미래 버전',
      JSON.stringify({ version: 99, data: { playlists: [], selectedPlaylistId: null } }),
    ],
  ])('17. %s 에서는 자동 생성하지 않는다', (_label, raw) => {
    seedRaw(raw)
    const library = useLibraryStore()
    library.restore()

    expect(library.status).toBe('protected')
    expect(library.seedFirstRunPlaylist('MY RECORDS')).toBeNull()
    // 원본도 그대로다.
    expect(readRaw()).toBe(raw)
  })

  it('17. 저장소를 쓸 수 없으면 자동 생성하지 않는다', () => {
    stubLocalStorage({
      get() {
        throw new Error('blocked')
      },
    })
    const library = useLibraryStore()
    library.restore()

    expect(library.status).toBe('unavailable')
    expect(library.seedFirstRunPlaylist('MY RECORDS')).toBeNull()
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
    await openDrawer(wrapper)

    expect(second.playlists.map((playlist) => playlist.name)).toEqual(expectedNames)
    expect(second.selectedPlaylistId).toBe(expectedSelected)
    expect(wrapper.findAll('.playlist-tile .pname').map((n) => n.text())).toEqual(expectedNames)
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
    await openDrawer(wrapper)

    await createPlaylistViaUi(wrapper, 'IN MEMORY ONLY')

    expect(library.playlists).toHaveLength(1)
    // 만든 자리에서 알린다. 생성은 이제 위젯의 일이다 (M6-4).
    expect(wrapper.get('.widget-notice').text()).toContain('저장되지 않았습니다')
  })

  it('23. 보호 상태에서 원본이 보존된다', async () => {
    const raw = '{not json'
    seedRaw(raw)
    const { wrapper } = mountApp()
    const library = useLibraryStore()
    library.restore()
    await openDrawer(wrapper)

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

  it('24. 동작하지 않는 복구·초기화 버튼을 만들지 않는다', async () => {
    seedRaw('{not json')
    const { wrapper } = mountApp()
    useLibraryStore().restore()
    await openDrawer(wrapper)

    const labels = wrapper.findAll('button').map((button) => button.text())
    expect(labels.filter((label) => label.includes('복구'))).toEqual([])
    expect(labels.filter((label) => label.includes('초기화'))).toEqual([])
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

    await wrapper.get('[aria-label="라이브러리 닫기"]').trigger('click')
    await nextTick()

    expect(wrapper.get('[data-instance-id="player-main"]').element).toBe(surface)
    expect(wrapper.get('.player-mount').element).toBe(mount)
  })

  it('27 · 28. 드로어 열고 닫기가 mount / destroy 를 유발하지 않는다', async () => {
    const { wrapper, fake } = mountApp()
    expect(fake.calls.mount).toBe(1)

    for (let i = 0; i < 3; i += 1) {
      await openDrawer(wrapper)
      await wrapper.get('[aria-label="라이브러리 닫기"]').trigger('click')
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
    await switchTheme('kawaii-synth-cassette')
    await wrapper.get('[aria-label="라이브러리 닫기"]').trigger('click')
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
    const b = library.createPlaylist('B')
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
