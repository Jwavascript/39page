/**
 * M6-4 — 플레이리스트 위젯.
 *
 * 실기기 검증 보고 7번: "플레이리스트와 각 트랙별 노래가 한 요소 안에 있다
 * 보니까 플레이리스트가 길어지고 각 트랙 안의 노래 목록이 길어지면 쭉 아래로
 * 늘어난다." 두 표면으로 나눈 결과를 여기서 고정한다.
 *
 * 사용자 구상은 바탕화면의 폴더 아이콘이다 — 누르면 전체 재생, `⋯`(또는 길게
 * 누르기)로 그 목록의 레코드가 오버레이에 열린다.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { nextTick } from 'vue'

import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import App from '@/app/App.vue'
import { FakePlayerAdapter } from '@/features/playback/FakePlayerAdapter'
import { PLAYER_ADAPTER_FACTORY } from '@/features/playback/PlayerAdapter'
import { useLibraryStore } from '@/stores/library'
import { usePlaybackStore } from '@/stores/playback'

import { installPlayerRect, uninstallPlayerRect } from '../support/playerLayout'

const VIDEO_A = 'aaaaaaaaaaa'
const VIDEO_B = 'bbbbbbbbbbb'

function readSource(relative: string): string {
  return readFileSync(resolve(process.cwd(), relative), 'utf8')
}

function mountApp() {
  const fake = new FakePlayerAdapter()
  const wrapper = mount(App, {
    attachTo: document.body,
    global: { provide: { [PLAYER_ADAPTER_FACTORY as symbol]: () => fake } },
  })
  return { wrapper, fake, library: useLibraryStore(), playback: usePlaybackStore() }
}

type Context = ReturnType<typeof mountApp>

/** 트랙이 있는 목록 하나와 빈 목록 하나. */
function seed(library: ReturnType<typeof useLibraryStore>) {
  const filled = library.createPlaylist('NIGHT DRIVE')
  const filledId = filled.ok ? filled.playlistId : ''
  library.addTrack(filledId, { videoId: VIDEO_A, title: 'ONE' })
  library.addTrack(filledId, { videoId: VIDEO_B, title: 'TWO' })

  const empty = library.createPlaylist('EMPTY SHELF')
  const emptyId = empty.ok ? empty.playlistId : ''

  library.selectPlaylist(filledId)
  return { filledId, emptyId }
}

const tiles = (context: Context) => context.wrapper.findAll('.playlist-tile')
const drawerOpen = (context: Context) =>
  context.wrapper.get('#record-library-drawer').attributes('hidden') === undefined

beforeEach(() => {
  globalThis.localStorage.clear()
  delete document.documentElement.dataset.theme
  setActivePinia(createPinia())
  installPlayerRect()
})

afterEach(() => {
  uninstallPlayerRect()
  globalThis.localStorage.clear()
  delete document.documentElement.dataset.theme
  document.body.innerHTML = ''
})

describe('A. 타일 격자', () => {
  it('플레이리스트마다 타일이 하나씩 생긴다', async () => {
    const context = mountApp()
    seed(context.library)
    await nextTick()

    expect(tiles(context).map((tile) => tile.get('.pname').text())).toEqual([
      'NIGHT DRIVE',
      'EMPTY SHELF',
    ])
  })

  it('트랙 수를 타일에 적고, 비었으면 비었다고 적는다', async () => {
    const context = mountApp()
    seed(context.library)
    await nextTick()

    expect(tiles(context)[0]?.get('.pmeta').text()).toBe('2 TRACKS')
    expect(tiles(context)[1]?.get('.pmeta').text()).toBe('EMPTY')
  })

  it('선택된 타일을 색 말고도 알 수 있다', async () => {
    const context = mountApp()
    seed(context.library)
    await nextTick()

    expect(tiles(context)[0]?.classes()).toContain('is-selected')
    expect(tiles(context)[0]?.get('.playlist-play').attributes('aria-current')).toBe('true')
    expect(tiles(context)[1]?.get('.playlist-play').attributes('aria-current')).toBeUndefined()
  })

  it('비어 있으면 안내한다', () => {
    const context = mountApp()

    expect(context.wrapper.get('.playlist-widget').text()).toContain('아직 플레이리스트가 없습니다')
    expect(tiles(context)).toHaveLength(0)
  })

  it('무엇을 누르면 무슨 일이 일어나는지 화면에 적는다 (보고 6a)', () => {
    const context = mountApp()

    const sub = context.wrapper.get('.playlist-widget .widget-sub').text()
    expect(sub).toContain('전체 재생')
    expect(sub).toContain('편집')
  })
})

describe('B. 타일 누름 — 전체 재생', () => {
  it('타일을 누르면 그 목록이 처음부터 재생된다', async () => {
    const context = mountApp()
    seed(context.library)
    await nextTick()

    await tiles(context)[0]?.get('.playlist-play').trigger('click')

    expect(context.playback.queue.map((track) => track.title)).toEqual(['ONE', 'TWO'])
    expect(context.playback.queueIndex).toBe(0)
    expect(context.fake.calls.load).toEqual([{ videoId: VIDEO_A, autoplay: true }])
  })

  it('재생한 목록이 선택 상태로 따라온다', async () => {
    const context = mountApp()
    const { filledId, emptyId } = seed(context.library)
    context.library.selectPlaylist(emptyId)
    await nextTick()

    await tiles(context)[0]?.get('.playlist-play').trigger('click')

    // 편집 오버레이와 데크의 ▶ 가 지금 울리는 목록을 가리켜야 한다.
    expect(context.library.selectedPlaylistId).toBe(filledId)
  })

  it('누름이 편집 오버레이를 열지는 않는다', async () => {
    const context = mountApp()
    seed(context.library)
    await nextTick()

    await tiles(context)[0]?.get('.playlist-play').trigger('click')

    expect(drawerOpen(context)).toBe(false)
  })

  it('빈 타일은 재생이 아니라 편집 오버레이를 연다', async () => {
    const context = mountApp()
    const { emptyId } = seed(context.library)
    await nextTick()

    await tiles(context)[1]?.get('.playlist-play').trigger('click')
    await nextTick()

    // 비활성 타일은 막다른 길이다. 레코드를 넣을 곳으로 데려간다.
    expect(context.playback.queue).toEqual([])
    expect(drawerOpen(context)).toBe(true)
    expect(context.library.selectedPlaylistId).toBe(emptyId)
  })

  it('빈 타일의 이름이 재생이 아니라 열기라고 말한다', async () => {
    const context = mountApp()
    seed(context.library)
    await nextTick()

    expect(tiles(context)[0]?.get('.playlist-play').attributes('aria-label')).toBe(
      'NIGHT DRIVE 전체 재생 (2곡)',
    )
    expect(tiles(context)[1]?.get('.playlist-play').attributes('aria-label')).toBe(
      'EMPTY SHELF 열기 — 비어 있음',
    )
  })
})

describe('C. 편집 오버레이 열기', () => {
  it('⋯ 가 그 목록을 선택하고 오버레이를 연다', async () => {
    const context = mountApp()
    const { emptyId } = seed(context.library)
    await nextTick()

    await tiles(context)[1]?.get('.playlist-open').trigger('click')
    await nextTick()

    expect(context.library.selectedPlaylistId).toBe(emptyId)
    expect(drawerOpen(context)).toBe(true)
    // 머리말이 무엇을 편집하는지 말한다 (보고 6b).
    expect(context.wrapper.get('#record-library-title').text()).toBe('EMPTY SHELF')
  })

  it('⋯ 는 재생을 시작하지 않는다', async () => {
    const context = mountApp()
    seed(context.library)
    await nextTick()

    await tiles(context)[0]?.get('.playlist-open').trigger('click')

    expect(context.playback.queue).toEqual([])
    expect(context.fake.calls.load).toEqual([])
  })

  it('⋯ 에 접근성 이름이 있다', async () => {
    const context = mountApp()
    seed(context.library)
    await nextTick()

    expect(tiles(context)[0]?.get('.playlist-open').attributes('aria-label')).toBe(
      'NIGHT DRIVE 편집',
    )
  })

  /*
   * 길게 누르기는 **추가 경로**일 뿐이다. 보이는 `⋯` 가 본체다 — 롱프레스만
   * 두면 키보드·스크린리더에 대응되는 동작이 없다 (`M6_PLAN.md` §3).
   * 안드로이드 Chrome 은 길게 누르면 `contextmenu` 를 보낸다.
   */
  it('타일을 길게 누르거나 우클릭해도 열린다', async () => {
    const context = mountApp()
    seed(context.library)
    await nextTick()

    await tiles(context)[0]?.trigger('contextmenu')
    await nextTick()

    expect(drawerOpen(context)).toBe(true)
  })

  it('타일의 보이는 조작은 둘뿐이다 — 재생과 편집', async () => {
    const context = mountApp()
    seed(context.library)
    await nextTick()

    for (const tile of tiles(context)) {
      const buttons = tile.findAll('button')
      expect(buttons).toHaveLength(2)
      for (const button of buttons) {
        expect(button.attributes('type')).toBe('button')
        expect(button.attributes('aria-label')).toBeTruthy()
      }
    }
  })
})

describe('D. 생성', () => {
  it('＋ 새 목록이 위젯에 있다 (보고 6a)', () => {
    const context = mountApp()

    const create = context.wrapper.get('.playlist-widget .pill--strong')
    expect(create.text()).toContain('새 목록')

    // 트랙을 추가하는 버튼은 드로어에 있다. 둘이 나란히 서지 않는다.
    const widgetText = context.wrapper.get('.playlist-widget').text()
    expect(widgetText).not.toContain('YouTube 링크 추가')
  })

  it('만들면 목록에 생기고 바로 선택된다', async () => {
    const context = mountApp()

    await context.wrapper.get('.playlist-widget .pill--strong').trigger('click')
    await context.wrapper.get('#new-playlist-name').setValue('MORNING')
    await context.wrapper.get('form.create-form').trigger('submit')
    await nextTick()

    expect(context.library.playlists.map((playlist) => playlist.name)).toEqual(['MORNING'])
    expect(context.library.selectedPlaylist?.name).toBe('MORNING')
    expect(tiles(context)).toHaveLength(1)
  })

  it('공백 이름은 거부하고 입력을 지우지 않는다', async () => {
    const context = mountApp()

    await context.wrapper.get('.playlist-widget .pill--strong').trigger('click')
    const input = context.wrapper.get<HTMLInputElement>('#new-playlist-name')
    await input.setValue('   ')
    await context.wrapper.get('form.create-form').trigger('submit')
    await nextTick()

    expect(context.library.playlists).toEqual([])
    expect(context.wrapper.get('.create-form .error-msg').text()).toContain('이름을 입력')
    expect(input.element.value).toBe('   ')
  })

  it('취소하면 폼이 닫히고 아무것도 만들지 않는다', async () => {
    const context = mountApp()

    await context.wrapper.get('.playlist-widget .pill--strong').trigger('click')
    await context.wrapper.get('#new-playlist-name').setValue('DISCARD')
    const cancel = context.wrapper
      .findAll('.create-form .pill')
      .find((button) => button.text() === '취소')
    await cancel?.trigger('click')
    await nextTick()

    expect(context.wrapper.find('form.create-form').exists()).toBe(false)
    expect(context.library.playlists).toEqual([])
  })

  it('저장되지 않으면 만든 자리에서 알린다', async () => {
    globalThis.localStorage.setItem('39page.library', '{not json')
    const context = mountApp()
    context.library.restore()
    await nextTick()

    await context.wrapper.get('.playlist-widget .pill--strong').trigger('click')
    await context.wrapper.get('#new-playlist-name').setValue('IN MEMORY')
    await context.wrapper.get('form.create-form').trigger('submit')
    await nextTick()

    expect(context.wrapper.get('.widget-notice').text()).toContain('저장되지 않았습니다')
    // 원본은 보존한다.
    expect(globalThis.localStorage.getItem('39page.library')).toBe('{not json')
  })
})

describe('E. 두 표면이 서로를 밀지 않는다 (보고 7번)', () => {
  it('위젯이 자기 안에서 스크롤하고 높이에 상한이 있다', () => {
    const source = readSource('src/features/library/PlaylistWidget.vue')

    expect(source).toMatch(/\.tile-scroll \{[\s\S]*?overflow-y: auto/)
    expect(source).toMatch(/\.tile-scroll \{[\s\S]*?max-height: var\(--size-playlist-max-height\)/)
  })

  it('플레이리스트와 트랙이 서로 다른 컴포넌트에 산다', () => {
    const drawer = readSource('src/features/library/RecordLibraryDrawer.vue')

    // 드로어에는 플레이리스트 목록이 없다. 트랙만 있다.
    expect(drawer).not.toContain('PlaylistList')
    expect(drawer).not.toContain('PlaylistTile')
    expect(drawer).toContain('TrackList')
  })

  it('타일 격자가 폭에 따라 칸 수를 바꾼다', () => {
    const source = readSource('src/features/library/PlaylistWidget.vue')

    expect(source).toContain(
      'grid-template-columns: repeat(auto-fill, minmax(var(--size-playlist-tile-min), 1fr))',
    )
  })

  /*
   * 위젯은 플레이어와 **같은 2열**에 있다. 우측 오버레이 드로어는 3열(정보)
   * 안에서 끝나므로, 편집 오버레이가 열려 있어도 타일이 가려지지 않는다.
   * 가시성 측정은 덮인 것을 감지하지 못하므로 이 보장은 레이아웃이 진다.
   */
  it('넓은 화면에서 오버레이가 타일을 덮지 않는 배치다', () => {
    const source = readSource('src/components/layout/WidgetHost.vue')
    const wide = source.slice(0, source.indexOf('@media (max-width: 1100px)'))

    expect(wide).toContain("'mascot playlist .'")
    expect(wide).toContain('minmax(var(--size-drawer-width), 0.55fr)')
  })
})

describe('F. 경계 — 위젯은 재생 구현을 모른다', () => {
  it('플레이어 DOM 을 건드리지 않는다', async () => {
    const context = mountApp()
    seed(context.library)
    await nextTick()

    const surface = context.wrapper.get('[data-instance-id="player-main"]').element
    const mountHost = context.wrapper.get('.player-mount').element

    await context.wrapper.get('.playlist-widget .pill--strong').trigger('click')
    await context.wrapper.get('#new-playlist-name').setValue('ANOTHER')
    await context.wrapper.get('form.create-form').trigger('submit')
    await tiles(context)[1]?.get('.playlist-open').trigger('click')
    await nextTick()

    expect(context.wrapper.get('[data-instance-id="player-main"]').element).toBe(surface)
    expect(context.wrapper.get('.player-mount').element).toBe(mountHost)
    expect(context.fake.calls.mount).toBe(1)
    expect(context.fake.calls.destroy).toBe(0)
  })

  it('store 가 아니라 코디네이터에 요청한다', () => {
    const source = readSource('src/features/library/PlaylistWidget.vue')

    // 재생 구현을 직접 가져오지 않는다 (`AGENTS.md` 규칙 4).
    expect(source).not.toContain('usePlaybackStore')
    expect(source).not.toContain('PlayerAdapter')
    expect(source).toContain('PLAYBACK_COORDINATOR')
  })

  it('타일은 상태를 모르고 누름만 올린다', () => {
    const source = readSource('src/features/library/PlaylistTile.vue')

    expect(source).not.toContain('useLibraryStore')
    expect(source).not.toContain('PLAYBACK_COORDINATOR')
    expect(source).toContain('defineEmits<{ play: []; open: [] }>')
  })
})
