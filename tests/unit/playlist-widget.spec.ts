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

import { flushPromises, mount } from '@vue/test-utils'
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
async function seed(library: ReturnType<typeof useLibraryStore>) {
  const filled = await library.createPlaylist('NIGHT DRIVE')
  const filledId = filled.ok ? filled.playlistId : ''
  library.addTrack(filledId, { videoId: VIDEO_A, title: 'ONE' })
  library.addTrack(filledId, { videoId: VIDEO_B, title: 'TWO' })

  const empty = await library.createPlaylist('EMPTY SHELF')
  const emptyId = empty.ok ? empty.playlistId : ''

  library.selectPlaylist(filledId)
  return { filledId, emptyId }
}

const tiles = (context: Context) => context.wrapper.findAll('.playlist-tile')
const drawerOpen = (context: Context) =>
  context.wrapper.get('#archive-panel').attributes('hidden') === undefined

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
    await seed(context.library)
    await nextTick()

    expect(tiles(context).map((tile) => tile.get('.pname').text())).toEqual([
      'NIGHT DRIVE',
      'EMPTY SHELF',
    ])
  })

  it('트랙 수를 타일에 적고, 비었으면 비었다고 적는다', async () => {
    const context = mountApp()
    await seed(context.library)
    await nextTick()

    expect(tiles(context)[0]?.get('.pmeta').text()).toBe('2 TRACKS')
    expect(tiles(context)[1]?.get('.pmeta').text()).toBe('EMPTY')
  })

  it('선택된 타일을 색 말고도 알 수 있다', async () => {
    const context = mountApp()
    await seed(context.library)
    await nextTick()

    expect(tiles(context)[0]?.classes()).toContain('is-selected')
    expect(tiles(context)[0]?.get('.playlist-open').attributes('aria-current')).toBe('true')
    expect(tiles(context)[1]?.get('.playlist-open').attributes('aria-current')).toBeUndefined()
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

  /*
   * M7 요청 1 — 데크를 누르면 펼쳐진다. 기본은 접힘이다.
   *
   * 접혀 있어도 타일은 보인다. `display: none` 으로 숨기면 플레이리스트가
   * 있는지조차 알 수 없고, 드로어로 가는 길도 막힌다.
   */
  it('목록이 많으면 6개까지만 보이고 나머지는 "모든 목록 보기" 로 보관함에서 본다 (M11-3)', async () => {
    const { wrapper } = mountApp()
    const library = useLibraryStore()
    for (let index = 1; index <= 8; index += 1) await library.createPlaylist(`L${String(index)}`)
    await library.selectPlaylist(library.playlists[0]?.id ?? '')
    await flushPromises()

    expect(wrapper.findAll('.playlist-tile')).toHaveLength(6)
    const showAll = wrapper.get('.playlist-widget .show-all')
    expect(showAll.text()).toBe('모든 목록 보기 (8) · 2개 더')

    await showAll.trigger('click')
    await flushPromises()
    expect(wrapper.get('#archive-panel').attributes('hidden')).toBeUndefined()
    expect(wrapper.findAll('.archive-lists .list-select')).toHaveLength(8)
  })

  it('고른 목록이 6개 밖에 있어도 대시보드에서 사라지지 않는다 (M11-3)', async () => {
    const { wrapper } = mountApp()
    const library = useLibraryStore()
    for (let index = 1; index <= 8; index += 1) await library.createPlaylist(`L${String(index)}`)
    // 마지막(8번째) 목록이 골라져 있다 — 만들면 선택된다.
    await flushPromises()

    const names = wrapper.findAll('.playlist-tile .pname').map((node) => node.text())
    expect(names).toHaveLength(6)
    expect(names[names.length - 1]).toBe('L8')
    expect(wrapper.findAll('.playlist-tile.is-selected')).toHaveLength(1)
  })

  it('새 목록을 만들면 보관함이 그 목록의 링크 입력으로 열린다 (M11-3 U15)', async () => {
    const { wrapper } = mountApp()
    await wrapper.get('.playlist-widget .pill--strong').trigger('click')
    await nextTick()
    await wrapper.get('#new-playlist-name').setValue('새 믹스')
    await wrapper.get('.playlist-widget form.create-form').trigger('submit')
    await flushPromises()
    await nextTick()
    await nextTick()

    expect(wrapper.get('#archive-panel').attributes('hidden')).toBeUndefined()
    expect(wrapper.get('#playlist-editor-title').text()).toBe('새 믹스')
    expect(wrapper.find('form.link-form').exists()).toBe(true)
    expect(document.activeElement).toBe(wrapper.get('#track-url').element)
  })

  it('선반(접기 · 펼치기)이 없다 — 위젯이 재생 화면을 밀지 않는다 (M11-3 U19)', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'src/features/library/PlaylistWidget.vue'),
      'utf8',
    )
    expect(source).not.toContain('is-collapsed')
    expect(source).not.toContain('PLAYLIST_SHELF')
    expect(source).not.toContain('tile-scroll')
  })
})

describe('B. 타일 누름 — 전체 재생', () => {
  it('타일의 ▶ 를 누르면 그 목록이 처음부터 재생된다', async () => {
    const context = mountApp()
    await seed(context.library)
    await nextTick()

    await tiles(context)[0]?.get('.playlist-play').trigger('click')

    expect(context.playback.queue.map((track) => track.title)).toEqual(['ONE', 'TWO'])
    expect(context.playback.queueIndex).toBe(0)
    expect(context.fake.calls.load).toEqual([{ videoId: VIDEO_A, autoplay: true }])
  })

  it('재생한 목록이 선택 상태로 따라온다', async () => {
    const context = mountApp()
    const { filledId, emptyId } = await seed(context.library)
    context.library.selectPlaylist(emptyId)
    await nextTick()

    await tiles(context)[0]?.get('.playlist-play').trigger('click')

    // 편집 오버레이와 데크의 ▶ 가 지금 울리는 목록을 가리켜야 한다.
    expect(context.library.selectedPlaylistId).toBe(filledId)
  })

  it('▶ 는 편집 오버레이를 열지 않는다', async () => {
    const context = mountApp()
    await seed(context.library)
    await nextTick()

    await tiles(context)[0]?.get('.playlist-play').trigger('click')

    expect(drawerOpen(context)).toBe(false)
  })

  it('빈 목록은 ▶ 가 비활성이고, 그 사실을 이름이 말한다', async () => {
    const context = mountApp()
    await seed(context.library)
    await nextTick()

    const play = tiles(context)[1]?.get('.playlist-play')
    expect(play?.attributes('disabled')).toBeDefined()
    expect(play?.attributes('aria-label')).toBe('EMPTY SHELF 전체 재생 — 비어 있음')
  })

  it('▶ 의 이름이 곡 수를 말한다', async () => {
    const context = mountApp()
    await seed(context.library)
    await nextTick()

    expect(tiles(context)[0]?.get('.playlist-play').attributes('aria-label')).toBe(
      'NIGHT DRIVE 전체 재생 (2곡)',
    )
  })
})

describe('C. 편집 오버레이 열기', () => {
  it('타일 본문이 그 목록을 선택하고 오버레이를 연다', async () => {
    const context = mountApp()
    const { emptyId } = await seed(context.library)
    await nextTick()

    await tiles(context)[1]?.get('.playlist-open').trigger('click')
    await flushPromises()
    await nextTick()

    expect(context.library.selectedPlaylistId).toBe(emptyId)
    expect(drawerOpen(context)).toBe(true)
    // 머리말이 무엇을 편집하는지 말한다 (보고 6b).
    expect(context.wrapper.get('#playlist-editor-title').text()).toBe('EMPTY SHELF')
  })

  it('타일 본문은 재생을 시작하지 않는다', async () => {
    const context = mountApp()
    await seed(context.library)
    await nextTick()

    await tiles(context)[0]?.get('.playlist-open').trigger('click')

    expect(context.playback.queue).toEqual([])
    expect(context.fake.calls.load).toEqual([])
  })

  it('타일 본문에 접근성 이름이 있다', async () => {
    const context = mountApp()
    await seed(context.library)
    await nextTick()

    expect(tiles(context)[0]?.get('.playlist-open').attributes('aria-label')).toBe(
      'NIGHT DRIVE 보관함에서 편집 (2곡)',
    )
  })

  it('타일의 보이는 조작은 둘뿐이다 — 재생과 편집', async () => {
    const context = mountApp()
    await seed(context.library)
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
    await flushPromises()
    const input = context.wrapper.get<HTMLInputElement>('#new-playlist-name')
    await input.setValue('   ')
    await context.wrapper.get('form.create-form').trigger('submit')
    await flushPromises()
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
  it('위젯 안 스크롤이 없다 — 중첩 스크롤을 만들지 않는다 (M11-3)', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'src/features/library/PlaylistWidget.vue'),
      'utf8',
    )
    const style = source.slice(source.indexOf('<style'))
    expect(style).not.toMatch(/overflow-y:\s*(auto|scroll)/)
    expect(style).not.toContain('--size-playlist-max-height')
  })

  it('플레이리스트와 트랙이 서로 다른 컴포넌트에 산다', () => {
    const drawer = readSource('src/features/library/PlaylistEditor.vue')

    // 드로어에는 플레이리스트 목록이 없다. 트랙만 있다.
    expect(drawer).not.toContain('PlaylistList')
    expect(drawer).not.toContain('PlaylistTile')
    expect(drawer).toContain('TrackList')
  })

  /*
   * M9-6 — 360·390px 에서 데크 옆 반 칸(144·159px)이 `PLAYLISTS` + `＋ 새 목록`
   * 보다 좁아 버튼이 위젯 밖으로 나갔다. 실제 브라우저에서 잰 넘침이고, jsdom 은
   * 레이아웃을 하지 않으므로 여기서는 그 해법의 두 조건을 고정한다:
   * 줄을 나눌 수 있어야 하고, 글 상자의 기준 폭이 0 이어야 정말 좁을 때만 나뉜다.
   */
  it('좁은 칸에서 머리말의 버튼이 위젯 밖으로 나가지 않고 아래로 내려간다', () => {
    const source = readSource('src/features/library/PlaylistWidget.vue')

    expect(source).toMatch(/\.widget-head \{[^}]*flex-wrap: wrap/)
    expect(source).toMatch(/\.head-text \{[^}]*flex: 1 1 0/)
    expect(source).toContain('<div class="head-text">')
  })

  it('타일 격자가 폭에 따라 칸 수를 바꾼다', () => {
    const source = readSource('src/features/library/PlaylistWidget.vue')

    expect(source).toContain(
      'grid-template-columns: repeat(auto-fill, minmax(var(--size-playlist-tile-min), 1fr))',
    )
  })

  /*
   * 위젯은 **데크 바로 아래(1열)** 다 (M7 요청 3). 우측 오버레이 드로어는
   * 3열(정보) 안에서 끝나므로 편집 오버레이가 열려 있어도 타일이 가려지지
   * 않는다. 가시성 측정은 덮인 것을 감지하지 못하므로 이 보장은 레이아웃이
   * 진다.
   */
  it('넓은 화면에서 데크 아래에 서고, 오버레이가 타일을 덮지 않는다', () => {
    const source = readSource('src/components/layout/WidgetHost.vue')
    const wide = source.slice(0, source.indexOf('@media (max-width: 1100px)'))

    // 4 행 3 열은 M9-4 부터 Moments 다. 플레이리스트는 그대로 1 열이다.
    expect(wide).toContain("'playlist mascot moments'")
    expect(wide).toContain('minmax(var(--size-drawer-width), 0.55fr)')
  })

  /*
   * M7 요청 5 — 세로에서는 데크 옆(이전의 시계·날씨 자리)이고, 펼쳐도
   * **데크 높이를 넘지 않는다.** 높이를 숫자로 정하지 않고 행에 늘려 붙인다.
   */
  it('좁은 화면(700px 이하)에서는 한 열 — 데크 · 영상 · Moments · 플레이리스트 순 (M11-3)', () => {
    const host = readFileSync(
      resolve(process.cwd(), 'src/components/layout/WidgetHost.vue'),
      'utf8',
    )
    const narrow = host.slice(host.indexOf('@media (max-width: 700px)'))

    expect(narrow).toMatch(
      /grid-template-areas:\s*'deck'\s*'player'\s*'moments'\s*'playlist'\s*'clock'\s*'weather'\s*'mascot';/,
    )
    // 펼친 선반이 데크 높이만큼 늘던 규칙은 없어졌다.
    expect(host).not.toContain(':not(.is-collapsed)')
  })
})

describe('F. 경계 — 위젯은 재생 구현을 모른다', () => {
  it('플레이어 DOM 을 건드리지 않는다', async () => {
    const context = mountApp()
    await seed(context.library)
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
