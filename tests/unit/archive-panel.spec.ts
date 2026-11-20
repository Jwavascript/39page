/**
 * M11-2 — 통합 보관함 · 전역 입구 · 데이터 대화상자 (ADR 0027).
 *
 * 앱 전체를 마운트하고 실제 단추를 누른다. 레이아웃(그리드 · 고정 시트)은 jsdom 이 계산하지 않으므로
 * 실제 크기 · 가림은 실제 Chromium 측정으로 따로 본다 (`IMPLEMENTATION_PLAN.md` M11-2).
 */
import { nextTick } from 'vue'

import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import App from '@/app/App.vue'
import { FakePlayerAdapter } from '@/features/playback/FakePlayerAdapter'
import { PLAYER_ADAPTER_FACTORY } from '@/features/playback/PlayerAdapter'
import { STORAGE_KEYS } from '@/shared/storage'
import { LIBRARY_STORAGE_VERSION, useLibraryStore } from '@/stores/library'
import { useMomentsStore } from '@/stores/moments'
import { useThemeStore } from '@/stores/theme'

import {
  installMatchMedia,
  installPlayerRect,
  uninstallMatchMedia,
  uninstallPlayerRect,
  VISIBLE_RECT,
} from '../support/playerLayout'

function mountApp() {
  const fake = new FakePlayerAdapter()
  const wrapper = mount(App, {
    attachTo: document.body,
    global: { provide: { [PLAYER_ADAPTER_FACTORY as symbol]: () => fake } },
  })
  return { wrapper, fake }
}

type Wrapper = ReturnType<typeof mountApp>['wrapper']

const nav = (wrapper: Wrapper, label: string) => {
  const button = wrapper.findAll('.app-nav button').find((b) => b.text().includes(label))
  if (button === undefined) throw new Error(`no nav button ${label}`)
  return button
}
const archive = (wrapper: Wrapper) => wrapper.get('#archive-panel')
const isArchiveOpen = (wrapper: Wrapper) => archive(wrapper).attributes('hidden') === undefined
/**
 * 보관함을 Moments 탭으로 연다 (M11-7B) — 헤더에는 "보관함" 하나뿐이고 탭은 보관함 안에서 고른다.
 * 이미 열려 있으면 탭만 바꾼다.
 */
async function openMoments(wrapper: Wrapper): Promise<void> {
  if (!isArchiveOpen(wrapper)) await nav(wrapper, '보관함').trigger('click')
  await settle()
  await wrapper.get('#archive-tab-moments').trigger('click')
  await settle()
}
const dialogBackdrop = (wrapper: Wrapper) => wrapper.get('.data-backdrop')
const isDataOpen = (wrapper: Wrapper) => dialogBackdrop(wrapper).attributes('hidden') === undefined

async function settle(): Promise<void> {
  await flushPromises()
  await nextTick()
  await nextTick()
}

function seed(playlists: { id: string; name: string; videoIds: string[] }[], selected: string) {
  globalThis.localStorage.setItem(
    STORAGE_KEYS.library,
    JSON.stringify({
      version: LIBRARY_STORAGE_VERSION,
      data: {
        playlists: playlists.map((p) => ({
          id: p.id,
          name: p.name,
          tracks: p.videoIds.map((videoId, index) => ({
            id: `${p.id}-t${String(index)}`,
            source: 'youtube',
            videoId,
            title: `${p.name} ${String(index + 1)}`,
          })),
        })),
        selectedPlaylistId: selected,
      },
    }),
  )
  useLibraryStore().restore()
}

beforeEach(() => {
  globalThis.localStorage.clear()
  delete document.documentElement.dataset.theme
  document.documentElement.style.overflow = ''
  setActivePinia(createPinia())
})

afterEach(() => {
  uninstallPlayerRect()
  uninstallMatchMedia()
  globalThis.localStorage.clear()
  document.documentElement.style.overflow = ''
  document.body.innerHTML = ''
})

describe('A. 전역 입구 — 헤더', () => {
  it('보관함 · 데이터 · 백업 두 입구가 글자 이름과 함께 있다 (M11-7B · H1)', () => {
    const { wrapper } = mountApp()
    const buttons = wrapper.findAll('.app-nav button')
    // 음악 · Moments 를 따로 두지 않는다 — 같은 보관함의 두 탭이다 (UAT U8).
    expect(buttons.map((b) => b.text())).toEqual(['▤ 보관함', '⇩ 데이터 · 백업'])
    // 기호는 장식이다 — 이름은 글자가 말한다.
    for (const button of buttons) {
      expect(button.find('[aria-hidden="true"]').exists()).toBe(true)
    }
    expect(wrapper.get('.app-nav').attributes('aria-label')).toBe('39page 메뉴')
  })

  it('입구가 연 것을 aria-expanded · aria-controls 로 알린다', async () => {
    const { wrapper } = mountApp()
    const entry = nav(wrapper, '보관함')
    expect(entry.attributes('aria-controls')).toBe('archive-panel')
    expect(entry.attributes('aria-expanded')).toBe('false')

    await entry.trigger('click')
    await settle()
    expect(entry.attributes('aria-expanded')).toBe('true')
    // 탭을 바꿔도 "보관함이 열려 있다" 는 그대로다.
    await wrapper.get('#archive-tab-moments').trigger('click')
    await settle()
    expect(entry.attributes('aria-expanded')).toBe('true')

    const data = nav(wrapper, '데이터')
    expect(data.attributes('aria-haspopup')).toBe('dialog')
    expect(data.attributes('aria-controls')).toBe('data-dialog')
  })

  it('입구를 다시 누르면 닫고, 다시 열면 마지막으로 쓰던 탭이다', async () => {
    const { wrapper } = mountApp()
    await nav(wrapper, '보관함').trigger('click')
    await settle()
    expect(isArchiveOpen(wrapper)).toBe(true)
    // 처음에는 음악 탭이다.
    expect(wrapper.get('#archive-tab-music').attributes('aria-selected')).toBe('true')

    await wrapper.get('#archive-tab-moments').trigger('click')
    await settle()
    expect(isArchiveOpen(wrapper)).toBe(true)
    expect(wrapper.get('#archive-tab-moments').attributes('aria-selected')).toBe('true')

    await nav(wrapper, '보관함').trigger('click')
    await settle()
    expect(isArchiveOpen(wrapper)).toBe(false)

    // 마지막 탭(Moments)으로 다시 열린다 — 저장하지 않고 메모리에만 기억한다.
    await nav(wrapper, '보관함').trigger('click')
    await settle()
    expect(wrapper.get('#archive-tab-moments').attributes('aria-selected')).toBe('true')
    expect(Object.keys(globalThis.localStorage).filter((key) => /tab|archive/i.test(key))).toEqual(
      [],
    )
  })

  it('문맥이 있는 입구는 그 탭으로 연다 — 데크는 음악, Moments 위젯의 "모두 보기" 는 Moments', async () => {
    const { wrapper } = mountApp()
    await openMoments(wrapper)
    await nav(wrapper, '보관함').trigger('click')
    await settle()
    expect(isArchiveOpen(wrapper)).toBe(false)

    // 마지막 탭이 Moments 여도 데크는 음악 탭으로 연다.
    await wrapper.get('.deck-open--kawaii-synth-cassette').trigger('click')
    await settle()
    expect(wrapper.get('#archive-tab-music').attributes('aria-selected')).toBe('true')

    await wrapper.get('[aria-label="보관함 닫기"]').trigger('click')
    await settle()
    await wrapper.get('.moments-widget .widget-head .pill').trigger('click')
    await settle()
    expect(wrapper.get('#archive-tab-moments').attributes('aria-selected')).toBe('true')
  })
})

describe('B. 보관함 탭', () => {
  it('탭은 WAI-ARIA 탭 패턴이다 — 선택된 탭만 Tab 순서에 있고 패널을 가리킨다', async () => {
    const { wrapper } = mountApp()
    await nav(wrapper, '보관함').trigger('click')
    await settle()

    const music = wrapper.get('#archive-tab-music')
    const moments = wrapper.get('#archive-tab-moments')
    expect(wrapper.find('[role="tablist"]').exists()).toBe(true)
    expect(music.attributes('role')).toBe('tab')
    expect(music.attributes('aria-selected')).toBe('true')
    expect(music.attributes('tabindex')).toBe('0')
    expect(moments.attributes('tabindex')).toBe('-1')
    expect(music.attributes('aria-controls')).toBe('archive-panel-music')
    expect(wrapper.get('#archive-panel-music').attributes('role')).toBe('tabpanel')
    expect(wrapper.get('#archive-panel-moments').attributes('hidden')).toBeDefined()
  })

  it('화살표 · Home · End 로 탭을 옮기면 바로 바뀌고 포커스가 따라간다', async () => {
    const { wrapper } = mountApp()
    await nav(wrapper, '보관함').trigger('click')
    await settle()

    await wrapper.get('#archive-tab-music').trigger('keydown', { key: 'ArrowRight' })
    await settle()
    expect(wrapper.get('#archive-tab-moments').attributes('aria-selected')).toBe('true')
    expect(document.activeElement).toBe(wrapper.get('#archive-tab-moments').element)
    expect(wrapper.get('#archive-panel-music').attributes('hidden')).toBeDefined()

    await wrapper.get('#archive-tab-moments').trigger('keydown', { key: 'Home' })
    await settle()
    expect(wrapper.get('#archive-tab-music').attributes('aria-selected')).toBe('true')

    await wrapper.get('#archive-tab-music').trigger('keydown', { key: 'ArrowLeft' })
    await settle()
    expect(wrapper.get('#archive-tab-moments').attributes('aria-selected')).toBe('true')
  })

  it('탭을 오가도 쓰던 양식이 남는다 — 두 패널은 마운트된 채 숨기기만 한다', async () => {
    seed([{ id: 'p1', name: 'ONE', videoIds: [] }], 'p1')
    const { wrapper } = mountApp()
    await nav(wrapper, '보관함').trigger('click')
    await settle()

    const addLink = wrapper
      .findAll('#archive-panel-music .drawer-actions button')
      .find((b) => b.text().includes('YouTube 링크 추가'))
    await addLink?.trigger('click')
    await settle()
    await wrapper.get('#track-url').setValue('https://youtu.be/dQw4w9WgXcQ')

    await wrapper.get('#archive-tab-moments').trigger('click')
    await settle()
    await wrapper.get('#archive-tab-music').trigger('click')
    await settle()

    expect((wrapper.get('#track-url').element as HTMLInputElement).value).toBe(
      'https://youtu.be/dQw4w9WgXcQ',
    )
  })

  it('Moments 탭은 처음 열 때 그린다 — 열어 보지 않은 목록을 미리 그리지 않는다', async () => {
    const { wrapper } = mountApp()
    expect(wrapper.find('#archive-panel-moments .moments-browser').exists()).toBe(false)

    await openMoments(wrapper)
    expect(wrapper.find('#archive-panel-moments .moments-browser').exists()).toBe(true)

    // 닫았다 열어도 다시 만들지 않는다.
    const node = wrapper.get('#archive-panel-moments .moments-browser').element
    await nav(wrapper, '보관함').trigger('click')
    await settle()
    await nav(wrapper, '보관함').trigger('click')
    await settle()
    expect(wrapper.get('#archive-panel-moments .moments-browser').element).toBe(node)
  })

  it('Moments 탭에서 메모를 고치고 지울 수 있다 — 전체 관리 기능에 닿는다', async () => {
    const { wrapper } = mountApp()
    const moments = useMomentsStore()
    await moments.add({ videoId: 'dQw4w9WgXcQ', atSeconds: 83, note: '처음', title: 'Song' })
    await openMoments(wrapper)

    const panel = wrapper.get('#archive-panel-moments')
    expect(panel.text()).toContain('처음')
    expect(panel.text()).toContain('1:23')
    // 같은 목록이 대시보드 위젯에도 있지만 id 가 겹치지 않는다.
    const ids = [...document.querySelectorAll('[id]')].map((element) => element.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('C. 보관함 음악 탭 — 데드엔드가 없다', () => {
  it('보관함 안에서 목록을 고르면 편집 표면이 그 목록으로 바뀐다 (선택이 저장된다)', async () => {
    seed(
      [
        { id: 'p1', name: 'ONE', videoIds: ['aaaaaaaaaaa'] },
        { id: 'p2', name: 'TWO', videoIds: [] },
      ],
      'p1',
    )
    const { wrapper } = mountApp()
    await nav(wrapper, '보관함').trigger('click')
    await settle()
    expect(wrapper.get('#playlist-editor-title').text()).toBe('ONE')

    const rows = wrapper.findAll('.archive-lists .list-select')
    expect(rows.map((r) => r.text())).toEqual(['ONE1곡', 'TWO비어 있음'])
    expect(rows[0]?.attributes('aria-current')).toBe('true')

    await rows[1]?.trigger('click')
    await settle()
    expect(wrapper.get('#playlist-editor-title').text()).toBe('TWO')
    expect(useLibraryStore().selectedPlaylistId).toBe('p2')
  })

  it('보관함에서 새 목록을 만들면 바로 그 목록의 링크 입력으로 이어진다', async () => {
    seed([{ id: 'p1', name: 'ONE', videoIds: [] }], 'p1')
    const { wrapper } = mountApp()
    await nav(wrapper, '보관함').trigger('click')
    await settle()

    await wrapper.get('.archive-lists .pill--strong').trigger('click')
    await settle()
    await wrapper.get('#archive-new-playlist-name').setValue('새 목록')
    await wrapper.get('.archive-lists form.create-form').trigger('submit')
    await settle()

    expect(wrapper.get('#playlist-editor-title').text()).toBe('새 목록')
    expect(document.activeElement).toBe(wrapper.get('#track-url').element)
  })

  it('목록 칸에는 재생 단추가 없다 — 재생은 상세 칸의 일이고, 빈 목록의 전체 재생은 꺼져 있다 (M11-7B)', async () => {
    seed([{ id: 'p1', name: 'ONE', videoIds: [] }], 'p1')
    const { wrapper } = mountApp()
    await nav(wrapper, '보관함').trigger('click')
    await settle()

    // 목록 칸: 고르기와 관리(이름 수정 · 삭제)만.
    const row = wrapper.get('.archive-lists .list-row')
    expect(row.findAll('button').map((button) => button.text())).toEqual(['ONE비어 있음', '관리'])
    expect(wrapper.find('.archive-lists .list-play').exists()).toBe(false)
    // 상세 칸: 전체 재생 · 링크 추가. 이름 수정 · 삭제는 없다.
    const actions = wrapper.findAll('.playlist-editor .head-actions button')
    expect(actions.map((button) => button.text())).toEqual([
      '▶ 목록 전체 재생',
      '＋ YouTube 링크 추가',
    ])
    expect(actions[0]?.attributes('disabled')).toBeDefined()
  })

  it('편집 표면에 백업이 없다 — 데이터 대화상자로 옮겼다는 안내가 있다', async () => {
    const { wrapper } = mountApp()
    await nav(wrapper, '보관함').trigger('click')
    await settle()

    expect(archive(wrapper).find('.backup').exists()).toBe(false)
    expect(archive(wrapper).get('.archive-foot').text()).toContain('⇩ 데이터')
  })
})

describe('D. 닫기 · Escape · 포커스', () => {
  it('Escape 는 바깥 것부터 — 데이터 대화상자, 그다음 보관함', async () => {
    const { wrapper } = mountApp()
    await nav(wrapper, '보관함').trigger('click')
    await settle()
    await nav(wrapper, '데이터').trigger('click')
    await settle()
    expect(isDataOpen(wrapper)).toBe(true)

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await settle()
    expect(isDataOpen(wrapper)).toBe(false)
    expect(isArchiveOpen(wrapper)).toBe(true)

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await settle()
    expect(isArchiveOpen(wrapper)).toBe(false)
  })

  it('보관함을 닫으면 연 입구로 포커스가 돌아온다', async () => {
    const { wrapper } = mountApp()
    const trigger = nav(wrapper, '보관함').element as HTMLElement
    trigger.focus()
    await nav(wrapper, '보관함').trigger('click')
    await settle()
    expect(document.activeElement).toBe(wrapper.get('#archive-tab-music').element)

    await wrapper.get('[aria-label="보관함 닫기"]').trigger('click')
    await settle()
    expect(document.activeElement).toBe(trigger)
  })
})

describe('E. 데이터 대화상자', () => {
  it('메인 화면에서 2번 — 데이터 → 전체 백업 내보내기', async () => {
    const { wrapper } = mountApp()
    await nav(wrapper, '데이터').trigger('click') // 1
    await settle()

    const exportButton = wrapper
      .findAll('#data-dialog .backup-actions button')
      .find((b) => b.text() === '전체 백업 내보내기')
    expect(exportButton).toBeDefined() // 2 번째 조작의 대상이 바로 보인다
    expect(exportButton?.element.closest('[hidden]')).toBeNull()
  })

  it('모달이다 — role · aria-modal · 이름 · 설명, 열리면 대화상자로 포커스', async () => {
    const { wrapper } = mountApp()
    await nav(wrapper, '데이터').trigger('click')
    await settle()

    const dialog = wrapper.get('#data-dialog')
    expect(dialog.attributes('role')).toBe('dialog')
    expect(dialog.attributes('aria-modal')).toBe('true')
    expect(dialog.attributes('aria-labelledby')).toBe('data-dialog-title')
    expect(wrapper.get('#data-dialog-title').text()).toBe('데이터 · 백업')
    expect(document.activeElement).toBe(dialog.element)
  })

  it('열린 동안 뒤쪽(헤더 · 워크스페이스 · 푸터)은 inert 이고, 닫으면 풀린다', async () => {
    const { wrapper } = mountApp()
    await nav(wrapper, '데이터').trigger('click')
    await settle()

    expect(wrapper.get('.app-header').attributes('inert')).toBeDefined()
    expect(wrapper.get('.workspace').attributes('inert')).toBeDefined()

    await wrapper.get('[aria-label="데이터 닫기"]').trigger('click')
    await settle()
    expect(wrapper.get('.app-header').attributes('inert')).toBeUndefined()
    expect(wrapper.get('.workspace').attributes('inert')).toBeUndefined()
  })

  it('Tab 이 대화상자 안에서 돈다 — 끝에서 처음으로, 처음에서 끝으로', async () => {
    const { wrapper } = mountApp()
    await nav(wrapper, '데이터').trigger('click')
    await settle()

    const dialog = wrapper.get('#data-dialog')
    const focusables = dialog
      .findAll('button, input')
      .filter((node) => node.element.closest('[hidden]') === null)
      .filter((node) => !(node.element as HTMLButtonElement).disabled)
    const first = focusables[0]?.element as HTMLElement
    const last = focusables[focusables.length - 1]?.element as HTMLElement

    last.focus()
    await dialog.trigger('keydown', { key: 'Tab' })
    expect(document.activeElement).toBe(first)

    first.focus()
    await dialog.trigger('keydown', { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(last)
  })

  it('닫으면 데이터 입구로 포커스가 돌아온다 · 배경을 눌러도 닫힌다', async () => {
    const { wrapper } = mountApp()
    const trigger = nav(wrapper, '데이터').element as HTMLElement
    trigger.focus()
    await nav(wrapper, '데이터').trigger('click')
    await settle()

    await dialogBackdrop(wrapper).trigger('click')
    await settle()
    expect(isDataOpen(wrapper)).toBe(false)
    expect(document.activeElement).toBe(trigger)
  })

  it('저장된 데이터를 읽지 못했을 때만 경고와 복구본 내보내기가 보인다 (ADR 0043)', async () => {
    const normal = mountApp()
    await nav(normal.wrapper, '데이터').trigger('click')
    await settle()
    expect(normal.wrapper.find('#data-dialog .backup-warning').exists()).toBe(false)
    normal.wrapper.unmount()

    globalThis.localStorage.setItem(STORAGE_KEYS.moments, '{"version":1,"data":[{"broken":')
    useMomentsStore().restore()
    const { wrapper } = mountApp()
    await nav(wrapper, '데이터').trigger('click')
    await settle()

    expect(wrapper.get('#data-dialog .backup-warning').text()).toContain('Moments')
    expect(wrapper.findAll('#data-dialog .backup .pill').map((node) => node.text())).toContain(
      '복구본 내보내기',
    )
  })
})

describe('F. 플레이어 영속성 — 보관함 · 테마', () => {
  it('보관함을 열고 닫고 탭을 바꾸고 테마를 바꿔도 플레이어 DOM 과 어댑터가 그대로다', async () => {
    seed([{ id: 'p1', name: 'ONE', videoIds: ['aaaaaaaaaaa'] }], 'p1')
    const { wrapper, fake } = mountApp()
    await wrapper.get('.now-playlist .play-all').trigger('click')
    await settle()
    fake.emitReady()
    fake.emitStateChange('playing')
    await nextTick()

    const mountNode = wrapper.get('.player-mount').element
    const host = fake.hostNode

    for (let round = 0; round < 3; round += 1) {
      await nav(wrapper, '보관함').trigger('click')
      await settle()
      await wrapper.get('#archive-tab-moments').trigger('click')
      useThemeStore().setTheme(round % 2 === 0 ? 'kawaii-synth-cassette' : 'mono-vinyl')
      await settle()
      await wrapper.get('[aria-label="보관함 닫기"]').trigger('click')
      await settle()
    }

    expect(wrapper.get('.player-mount').element).toBe(mountNode)
    expect(fake.hostNode).toBe(host)
    expect(fake.calls.mount).toBe(1)
    expect(fake.calls.destroy).toBe(0)
    expect(fake.calls.pause).toBe(0)
  })

  it('보관함이 열리면 플레이어 외 위젯을 접는 클래스가 붙고, 위젯은 마운트된 채다', async () => {
    const { wrapper } = mountApp()
    const widgetsBefore = wrapper.findAll('.widget-host > [data-widget]').map((w) => w.element)

    await nav(wrapper, '보관함').trigger('click')
    await settle()
    expect(wrapper.get('.workspace').classes()).toContain('is-archive-open')

    const widgetsAfter = wrapper.findAll('.widget-host > [data-widget]').map((w) => w.element)
    expect(widgetsAfter).toEqual(widgetsBefore)
  })

  it('세로(쌓기)에서는 페이지 스크롤을 잠그고 시트를 영상 아래에 둔다', async () => {
    installPlayerRect(VISIBLE_RECT)
    installMatchMedia(true)
    const { wrapper } = mountApp()

    await nav(wrapper, '보관함').trigger('click')
    await settle()

    expect(document.documentElement.style.overflow).toBe('hidden')
    expect(wrapper.get('.workspace').classes()).toContain('is-stacked')
    // 영상 상자 아래 끝(425) + 여백(8)
    expect(
      (wrapper.get('.workspace').element as HTMLElement).style.getPropertyValue(
        '--archive-sheet-top',
      ),
    ).toBe('433px')
  })

  it('낮은 가로 화면(옆)에서는 보관함이 영상의 실제 오른쪽 끝에서 시작한다 (M11-2 실측 뒤 추가)', async () => {
    installPlayerRect(VISIBLE_RECT)
    // 가로 · 높이가 낮은 화면만 맞는다 — 세로 쌓기 조건은 맞지 않는다.
    const original = window.matchMedia
    window.matchMedia = ((query: string) => ({
      matches: query.includes('orientation: landscape'),
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia
    try {
      const { wrapper } = mountApp()
      await nav(wrapper, '보관함').trigger('click')
      await settle()

      const workspace = wrapper.get('.workspace')
      expect(workspace.classes()).toContain('is-side')
      expect(workspace.classes()).not.toContain('is-stacked')
      // 영상 상자 오른쪽 끝(622) + 여백(8)
      expect(
        (workspace.element as HTMLElement).style.getPropertyValue('--archive-sheet-left'),
      ).toBe('630px')
      expect(document.documentElement.style.overflow).toBe('hidden')
    } finally {
      window.matchMedia = original
    }
  })

  it('넓은 화면(나란히)에서는 스크롤을 잠그지 않는다', async () => {
    installMatchMedia(false)
    const { wrapper } = mountApp()

    await nav(wrapper, '보관함').trigger('click')
    await settle()

    expect(document.documentElement.style.overflow).toBe('')
    expect(wrapper.get('.workspace').classes()).not.toContain('is-stacked')
  })
})
