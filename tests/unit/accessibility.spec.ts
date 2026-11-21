/**
 * M5 — 접근성 감사.
 *
 * 브라우저에서 실제 키보드로 확인한 것(Tab 순서, ESC, 포커스 복귀, 포커스 링
 * 계산값)을 **회귀로 고정**한다. 여기서 보는 것은 구조와 이름이다.
 *
 * 실제 입력 경로 검증은 CDP 로 따로 돌렸고 결과는 M5 보고에 적는다.
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
import { useThemeStore } from '@/stores/theme'

import { installPlayerRect, uninstallPlayerRect } from '../support/playerLayout'

function readSource(relative: string): string {
  return readFileSync(resolve(process.cwd(), relative), 'utf8')
}

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

function mountApp() {
  const fake = new FakePlayerAdapter()
  const wrapper = mount(App, {
    attachTo: document.body,
    global: { provide: { [PLAYER_ADAPTER_FACTORY as symbol]: () => fake } },
  })
  return { wrapper, fake }
}

/** 트랙 두 개를 담은 목록을 세운다. */
async function seedLibrary() {
  const library = useLibraryStore()
  const created = await library.createPlaylist('LIST')
  const playlistId = created.ok ? created.playlistId : ''
  library.addTrack(playlistId, { videoId: 'aaaaaaaaaaa', title: 'ONE' })
  library.addTrack(playlistId, { videoId: 'bbbbbbbbbbb', title: 'TWO' })
  library.selectPlaylist(playlistId)
  return library
}

describe('A. 문서 구조', () => {
  it('페이지에 h1 이 하나 있고 제품 이름이다', () => {
    const { wrapper } = mountApp()
    const headings = wrapper.findAll('h1')

    // h1 이 없으면 보조기기 사용자가 문서의 시작을 찾을 수 없다.
    expect(headings).toHaveLength(1)
    expect(headings[0]?.text()).toBe('39page')
  })

  it('제목 단계가 끊기지 않는다', () => {
    const { wrapper } = mountApp()
    const levels = wrapper
      .findAll('h1, h2, h3, h4, h5, h6')
      .map((heading) => Number(heading.element.tagName.slice(1)))

    expect(levels[0]).toBe(1)
    for (let index = 1; index < levels.length; index += 1) {
      const step = (levels[index] ?? 0) - (levels[index - 1] ?? 0)
      expect(step).toBeLessThanOrEqual(1)
    }
  })

  it('h1 을 올려도 승인된 모양이 유지된다', () => {
    const source = readSource('src/components/layout/AppHeader.vue')

    // `font` 단축 속성이 크기·굵기를 다시 정하고 margin 0 이 여백을 지운다.
    expect(source).toMatch(/\.brand \{[\s\S]*?margin: 0/)
    expect(source).toContain('font: 12px var(--font-mono)')
  })

  it('랜드마크가 있다', () => {
    const { wrapper } = mountApp()

    expect(wrapper.find('header').exists()).toBe(true)
    expect(wrapper.find('footer').exists()).toBe(true)
    expect(wrapper.find('aside').exists()).toBe(true)
  })
})

describe('B. 키보드 경로', () => {
  it('보관함을 열면 고른 탭으로 포커스가 옮겨간다 (M11-2)', async () => {
    const { wrapper } = mountApp()
    await seedLibrary()
    await nextTick()
    // M7: 트랙 드로어는 플레이리스트 타일 본문으로 연다.
    const trigger = wrapper.get('.deck-open')

    await trigger.trigger('click')
    await flushPromises()

    expect(document.activeElement).toBe(wrapper.get('#archive-tab-music').element)
  })

  it('ESC 로 닫고 포커스가 트리거로 돌아온다', async () => {
    const { wrapper } = mountApp()
    const trigger = wrapper.get('.deck-open--mono-vinyl')
    ;(trigger.element as HTMLElement).focus()
    await trigger.trigger('click')
    await flushPromises()

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await flushPromises()

    expect(wrapper.get('.drawer').attributes('hidden')).toBeDefined()
    expect(document.activeElement).toBe(trigger.element)
  })

  it('닫힌 드로어의 컨트롤은 Tab 순서에서 빠진다', () => {
    const { wrapper } = mountApp()

    // `hidden` 이므로 안쪽 전체가 포커스 대상이 아니다.
    expect(wrapper.get('.drawer').attributes('hidden')).toBeDefined()
    expect(wrapper.findAll('.drawer button').length).toBeGreaterThan(0)
  })

  it('포커스를 가두지 않으므로 aria-modal 을 선언하지 않는다', () => {
    const { wrapper } = mountApp()
    const drawer = wrapper.get('.drawer')

    // 넓은 화면에서는 나란히 놓이는 비모달 영역이다. 가두지 않는 것을
    // 선언하지 않는 것으로 정직하게 표시한다.
    expect(drawer.attributes('aria-modal')).toBeUndefined()
    expect(drawer.attributes('aria-labelledby')).toBe('archive-title')
  })

  it('비활성 테마의 데크 트리거는 숨어 Tab 순서에서 빠진다', () => {
    const { wrapper } = mountApp()
    const css = readSource('src/features/deck/DeckWidget.vue')

    // 카세트 · LP · 커스텀 그림 (ADR 0045) — 셋 다 마운트돼 있고 활성 테마의 것만 보인다.
    expect(wrapper.findAll('.deck-open')).toHaveLength(3)
    // `display: none` 이므로 포커스 대상이 아니다.
    expect(css).toMatch(/\.deck-open \{[\s\S]*?display: none/)
  })
})

describe('C. 컨트롤 이름과 크기', () => {
  it('트랜스포트는 네이티브 button 이고 이름이 동작을 말한다', () => {
    const { wrapper } = mountApp()
    const buttons = wrapper.findAll('.action-row .controls-left button')

    expect(buttons).toHaveLength(3)
    expect(buttons.map((button) => button.attributes('aria-label'))).toEqual([
      '이전 곡',
      '재생',
      '다음 곡',
    ])
    // 셔플 · 반복 (ADR 0038) — 따로 묶인 네이티브 button 이고, 켜짐을 aria-pressed 로 말한다.
    const modes = wrapper.findAll('.action-row button.mode')
    expect(modes.map((button) => button.attributes('aria-label'))).toEqual([
      '셔플',
      '반복: 반복 끔 (누르면 전체 반복)',
    ])
    expect(modes.map((button) => button.attributes('aria-pressed'))).toEqual(['false', 'false'])
    for (const button of [...buttons, ...modes]) {
      expect(button.element.tagName).toBe('BUTTON')
      expect(button.attributes('type')).toBe('button')
      expect(button.attributes('role')).toBeUndefined()
    }
  })

  it('토글 이름이 상태를 따라간다', async () => {
    const { wrapper } = mountApp()
    const library = await seedLibrary()
    await nextTick()
    await wrapper.get('.now-playlist .play-all').trigger('click')
    await nextTick()

    expect(library.selectedPlaylist?.tracks).toHaveLength(2)
    expect(wrapper.get('.round--main').attributes('aria-label')).toBe('일시정지')
  })

  it('작은 컨트롤이 44px 터치 목표를 갖는다 (M11-3 U16)', () => {
    // M5 에서 24px → 29px, M11-3 에서 44px 로 올렸다 (실측: 실제 Chromium 390px).
    const list = readSource('src/features/library/TrackList.vue')
    expect(list).toMatch(/\.track-play \{[\s\S]*?width: 44px;[\s\S]*?min-height: 44px/)
    // ADR 0044: 행 아이콘(연필 · 공유 · 휴지통)은 40×40 — 행 높이 안에서 WCAG 2.5.8(24px)을 넉넉히 넘는다.
    expect(list).toContain('class="icon-button track-rename"')
    expect(readSource('src/styles/base.css')).toMatch(
      /\.icon-button \{[\s\S]*?width: 40px;[\s\S]*?height: 40px;/,
    )
    expect(list).toMatch(/\.pill \{[\s\S]*?min-height: 44px/)

    // M11-7B: NOW PLAYLIST 의 곡 줄 · 목록 줄 · 단추.
    const nowPlaylist = readSource('src/features/library/NowPlaylistWidget.vue')
    expect(nowPlaylist).toMatch(/\.track-row,\s*\.picker-row \{[\s\S]*?min-height: 44px/)
    expect(nowPlaylist).toMatch(/\.pill \{[\s\S]*?min-height: 44px/)

    expect(readSource('src/components/ui/ThemeSwitcher.vue')).toMatch(
      /\.theme-button \{[\s\S]*?min-height: 44px/,
    )
    expect(readSource('src/features/playback/PlayerTransport.vue')).toMatch(
      /\.round \{[\s\S]*?min-width: 44px;[\s\S]*?height: 44px/,
    )
    // 데크의 그려진 키는 작아도, 누를 수 있는 자리는 44px 이상이다.
    expect(readSource('src/features/deck/DeckWidget.vue')).toMatch(
      /\.deck-key::after \{[\s\S]*?width: max\(100%, 44px\);[\s\S]*?height: max\(100%, 44px\)/,
    )
  })

  it('터치 뒤 hover 표현이 남지 않는다 — 대시보드의 :hover 는 (hover: hover) 안에만 (M11-3 U18)', () => {
    for (const file of [
      'src/components/layout/AppNav.vue',
      'src/components/ui/ThemeSwitcher.vue',
      'src/features/archive/ArchivePanel.vue',
      'src/features/backup/BackupPanel.vue',
      'src/features/deck/DeckWidget.vue',
      'src/features/library/ArchivePlaylistNav.vue',
      'src/features/library/PlaylistEditor.vue',
      'src/features/library/useNowPlaylist.ts',
      'src/features/library/NowPlaylistWidget.vue',
      'src/features/library/TrackList.vue',
      'src/features/moments/MomentList.vue',
      'src/features/moments/MomentRow.vue',
      'src/features/moments/MomentsBrowserPanel.vue',
      'src/features/moments/MomentsWidget.vue',
      'src/features/playback/PlayerTransport.vue',
    ]) {
      const style = readSource(file).slice(readSource(file).indexOf('<style'))
      // :hover 가 나오는 모든 규칙이 (hover: hover) 블록 안에 있다.
      const outside = style.replace(/@media \(hover: hover\) \{[\s\S]*?\n\}/g, '')
      expect({ file, hover: outside.includes(':hover') }).toEqual({ file, hover: false })
    }
  })

  it('외부 링크(재생 오류 때의 YouTube 링크)가 새 창을 안전하게 연다', async () => {
    const { wrapper, fake } = mountApp()
    await seedLibrary()
    await nextTick()
    await wrapper.get('.now-playlist .play-all').trigger('click')
    fake.emitError({ kind: 'not-playable', code: 5 })
    await nextTick()

    const link = wrapper.get('.youtube-fallback')
    expect(link.attributes('target')).toBe('_blank')
    expect(link.attributes('rel')).toBe('noopener noreferrer')
    expect(link.text()).toContain('YouTube에서 열기')
  })

  it('아이콘뿐인 공유 단추에 이름이 있다 (ADR 0042)', async () => {
    const { wrapper } = mountApp()
    await seedLibrary()
    await nextTick()
    await wrapper.get('.now-playlist .play-all').trigger('click')
    await nextTick()

    for (const selector of ['.action-row .share', '.deck-share']) {
      const button = wrapper.get(selector)
      expect(button.element.tagName).toBe('BUTTON')
      expect(button.attributes('aria-label')).not.toBe('')
      expect(button.attributes('title')).toBe(button.attributes('aria-label'))
      expect(button.get('svg').attributes('aria-hidden')).toBe('true')
    }
  })
})

describe('D. 포커스 링', () => {
  it('공통 기본값이 토큰으로 선언돼 있다', () => {
    const base = readSource('src/styles/base.css')

    expect(base).toContain(':focus-visible')
    expect(base).toContain('var(--focus-ring-width)')
    expect(base).toContain('var(--focus-ring-color)')
    expect(base).toContain('var(--focus-ring-offset)')
  })

  it('포커스 표시를 지우는 코드가 없다', () => {
    for (const file of [
      'src/styles/base.css',
      'src/components/layout/AppHeader.vue',
      'src/components/ui/ThemeSwitcher.vue',
      'src/features/playback/PlayerTransport.vue',
      'src/features/library/PlaylistEditor.vue',
      'src/features/library/ArchivePlaylistNav.vue',
      'src/features/archive/ArchivePanel.vue',
      'src/features/moments/MomentsBrowserPanel.vue',
      'src/features/backup/DataDialog.vue',
      'src/components/layout/AppNav.vue',
      'src/features/library/NowPlaylistWidget.vue',
      'src/features/library/useNowPlaylist.ts',
      'src/features/library/TrackList.vue',
      'src/features/deck/DeckWidget.vue',
    ]) {
      const source = readSource(file)
      expect(source).not.toMatch(/outline:\s*(none|0)/)
    }
  })
})

describe('E. 장식과 상태', () => {
  it('장식 요소는 보조기기에서 숨는다', () => {
    const { wrapper } = mountApp()

    expect(wrapper.get('.dot-matrix').attributes('aria-hidden')).toBe('true')
    // M12-2: 마스코트 코너 장식 대신 기본 앨범아트 — 곡 제목이 옆에 있다.
    expect(wrapper.get('.default-artwork').attributes('aria-hidden')).toBe('true')
    expect(wrapper.get('.wxicon').attributes('aria-hidden')).toBe('true')
    const headerArrow = wrapper.get('.header-toggle svg')
    expect(headerArrow.attributes('aria-hidden')).toBe('true')
    expect(headerArrow.attributes('focusable')).toBe('false')
  })

  it('정보를 전달하는 SVG는 역할과 이름을 갖는다', () => {
    const { wrapper } = mountApp()

    for (const svg of wrapper.findAll('svg:not([aria-hidden="true"])')) {
      expect(svg.attributes('role')).toBe('img')
      expect(svg.attributes('aria-label')).toBeTruthy()
    }
  })

  it('비활성 테마의 데크 아트는 접근성 트리에서 빠진다', async () => {
    const { wrapper } = mountApp()
    const theme = useThemeStore()

    // DOM 순서는 [mono, kawaii] 그대로다. 기본 테마는 Kawaii Synth Cassette (M11-7B).
    const arts = wrapper.findAll('.deck-art')
    expect(arts[0]?.attributes('aria-hidden')).toBe('true')
    expect(arts[1]?.attributes('aria-hidden')).toBeUndefined()

    theme.setTheme('mono-vinyl')
    await nextTick()

    expect(wrapper.findAll('.deck-art')[0]?.attributes('aria-hidden')).toBeUndefined()
    expect(wrapper.findAll('.deck-art')[1]?.attributes('aria-hidden')).toBe('true')
  })

  it('상태 영역이 정중한 라이브 리전이다', () => {
    const { wrapper } = mountApp()
    const regions = wrapper.findAll('[role="status"]')

    expect(regions.length).toBeGreaterThanOrEqual(2)
    for (const region of regions) {
      expect(region.attributes('aria-live')).toBe('polite')
    }
    // 끼어드는 `assertive` 를 쓰지 않는다.
    expect(wrapper.find('[aria-live="assertive"]').exists()).toBe(false)
  })

  it('시계가 현재 시각을 이름으로 알린다', () => {
    const { wrapper } = mountApp()
    const label = wrapper.get('.clock-svg').attributes('aria-label') ?? ''

    expect(label).toMatch(/^현재 시각 (AM|PM) \d{2}:\d{2}$/)
  })
})
