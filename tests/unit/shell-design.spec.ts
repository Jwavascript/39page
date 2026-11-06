/**
 * M5 — 디자인 마무리: 정보 열 구분선과 푸터.
 *
 * 승인된 디자인에는 있고 M1~M4 가 옮기지 않았던 두 요소다.
 *
 * 구분선은 **DOM 래퍼 없이** 그려야 한다. 래퍼를 끼우면 위젯 루트가 그리드의
 * 직계 자식이 아니게 되고, 플레이어 iframe 의 부모가 바뀐다 (ADR 0002).
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { nextTick } from 'vue'

import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import App from '@/app/App.vue'
import AppFooter from '@/components/layout/AppFooter.vue'
import WidgetHost from '@/components/layout/WidgetHost.vue'
import { FakePlayerAdapter } from '@/features/playback/FakePlayerAdapter'
import { PLAYER_ADAPTER_FACTORY } from '@/features/playback/PlayerAdapter'
import { THEMES } from '@/themes'
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

describe('A. 푸터', () => {
  it('승인된 두 문구를 보여준다', () => {
    const wrapper = mount(AppFooter)

    expect(wrapper.get('.footer-theme').text()).toBe('MONO VINYL · ANALOG × DIGITAL')
    expect(wrapper.get('.footer-tagline').text()).toBe('RECORD LIBRARY / PLAYLIST FIRST')
  })

  it('테마를 바꾸면 왼쪽 문구만 바뀐다', async () => {
    const wrapper = mount(AppFooter)
    const theme = useThemeStore()

    theme.setTheme('kawaii-synth-cassette')
    await nextTick()

    expect(wrapper.get('.footer-theme').text()).toBe('SYNTH CASSETTE · PIXEL × KAWAII')
    // 오른쪽은 테마와 무관한 제품 문구다.
    expect(wrapper.get('.footer-tagline').text()).toBe('RECORD LIBRARY / PLAYLIST FIRST')
  })

  it('두 테마의 문구가 메타데이터에 있다', () => {
    expect(THEMES['mono-vinyl'].footerLabel).toBe('MONO VINYL · ANALOG × DIGITAL')
    expect(THEMES['kawaii-synth-cassette'].footerLabel).toBe('SYNTH CASSETTE · PIXEL × KAWAII')
  })

  it('셸이 아니라 푸터가 테마를 안다', () => {
    // 두 테마가 같은 셸 인스턴스를 공유한다는 보장이 셸의 무지에서 나온다.
    expect(readSource('src/components/layout/DashboardShell.vue')).not.toContain('useThemeStore')
    expect(readSource('src/components/layout/AppFooter.vue')).toContain('useThemeStore')
  })

  it('앱에 한 번만 들어간다', () => {
    const { wrapper } = mountApp()

    expect(wrapper.findAll('.app-footer')).toHaveLength(1)
    expect(wrapper.findAllComponents(AppFooter)).toHaveLength(1)
  })

  it('워크스페이스 밖의 형제다', () => {
    const { wrapper } = mountApp()

    const footer = wrapper.get('.app-footer').element
    expect(wrapper.get('.workspace').element.contains(footer)).toBe(false)
    expect(footer.parentElement?.className).toContain('dashboard-shell')
  })

  it('색을 하드코딩하지 않는다', () => {
    const source = readSource('src/components/layout/AppFooter.vue')

    expect(source).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
    expect(source).toContain('var(--footer-border-color)')
    expect(source).toContain('var(--footer-text-color)')
  })

  it('좁은 화면에서 줄바꿈을 허용한다', () => {
    // 승인된 디자인의 650px 규칙이다.
    const source = readSource('src/components/layout/AppFooter.vue')

    expect(source).toMatch(/@media \(max-width: 650px\)[\s\S]*flex-wrap: wrap/)
  })
})

describe('B. 정보 열 구분선', () => {
  it('의사 요소로 그린다 — DOM 래퍼를 만들지 않는다', () => {
    const source = readSource('src/components/layout/WidgetHost.vue')

    expect(source).toContain('.widget-host::before')
    expect(source).toContain('border-left: 1px solid var(--info-border-color)')
  })

  it('위젯 루트가 그리드의 직계 자식으로 남는다', () => {
    const { wrapper } = mountApp()
    const host = wrapper.getComponent(WidgetHost).get('.widget-host').element

    // 구분선을 넣느라 래퍼가 끼면 iframe 의 부모가 바뀐다 (ADR 0002).
    for (const id of [
      'deck-main',
      'mascot-main',
      'clock-main',
      'weather-main',
      'player-main',
      'playlist-main',
    ]) {
      const widget = wrapper.get(`[data-instance-id="${id}"]`).element
      expect(widget.parentElement).toBe(host)
    }
  })

  it('구분선이 요소 노드를 늘리지 않는다', () => {
    const { wrapper } = mountApp()
    const host = wrapper.getComponent(WidgetHost).get('.widget-host').element

    // 위젯 6개뿐이다. 의사 요소는 요소 노드가 아니다.
    expect(host.children).toHaveLength(6)
  })

  it('간격의 절반만큼 왼쪽으로 나간다', () => {
    const source = readSource('src/components/layout/WidgetHost.vue')

    // 열 사이 간격의 가운데에 서야 한다. 위젯 안쪽이면 안 된다.
    expect(source).toContain('--host-gap:')
    expect(source).toContain('gap: var(--host-gap)')
    expect(source).toContain('margin-left: calc(-0.5 * var(--host-gap))')
  })

  /*
   * M6-1 에서 좁은 화면이 **1열에서 2열로** 바뀌었다.
   *
   * 1열이던 때는 세로선을 그을 자리가 없어 시계 위의 가로선으로 바꿨다
   * (레퍼런스의 `.info { border-left: 0; border-top: 1px }`). 이제는 열이
   * 둘이므로 세로선이 그 역할을 그대로 한다. 따라서 가로선 전환을 제거했고
   * `--info-border-compact-color` 도 함께 지웠다.
   */
  it('2열 레이아웃에서도 세로선을 유지한다', () => {
    const source = readSource('src/components/layout/WidgetHost.vue')
    const compact = source.slice(source.indexOf('@media (max-width: 1100px)'))

    // M7: 데크와 플레이리스트 사이, 첫 행에만 둔다.
    expect(compact).toContain('grid-row: 1 / 2')
    expect(compact).toContain('grid-column: 2')

    // 가로선으로 바꾸지 않는다.
    expect(compact).not.toContain('border-top:')
    expect(compact).not.toContain('--info-border-compact-color')
  })

  it('좁은 화면에서 플레이어가 두 열을 가로지른다 (200×200 요구)', () => {
    const source = readSource('src/components/layout/WidgetHost.vue')
    const compact = source.slice(source.indexOf('@media (max-width: 1100px)'))

    /*
     * 폰 세로에서 반 칸은 약 150px 다. `.video-holder` 의 최소값은 202px
     * 이므로 반 칸에 두면 넘치거나 `too-small` 로 재생이 거절된다.
     */
    expect(compact).toContain("'player player'")

    // 넓은 화면에서 커지는 것은 상한으로 막는다.
    expect(compact).toContain('max-width: var(--size-player-max-compact)')
  })

  it('넓은 화면에서 플레이어가 2열 1행에 선다', () => {
    const source = readSource('src/components/layout/WidgetHost.vue')
    const wide = source.slice(0, source.indexOf('@media (max-width: 1100px)'))

    expect(wide).toContain("'deck player clock'")
    expect(wide).toContain("'deck player weather'")
  })

  /*
   * M7 요청 3 — 플레이리스트는 **데크 아래(1열)**, 마스코트는 2열 아래다.
   *
   * 데크를 누르면 이 위젯이 펼쳐지므로 둘이 붙어 있어야 무엇이 열렸는지 눈으로
   * 따라갈 수 있다. 3열(정보)은 비워 둬서 우측 오버레이가 타일을 덮지 않는다.
   */
  it('플레이리스트가 데크 아래, 마스코트가 2열 아래에 선다', () => {
    const source = readSource('src/components/layout/WidgetHost.vue')
    const wide = source.slice(0, source.indexOf('@media (max-width: 1100px)'))
    const compact = source.slice(source.indexOf('@media (max-width: 1100px)'))

    expect(wide).toContain("'playlist mascot .'")
    // 세로에서는 데크 옆(이전의 시계·날씨 자리)이다 (요청 5).
    expect(compact).toContain("'deck playlist'")
    expect(compact).toContain("'clock weather'")
  })

  /*
   * M7 요청 4 — 정보 열의 빈자리를 **아래로** 모은다.
   *
   * 이전에는 행이 둘뿐이어서 행 높이를 데크·플레이어가 지배했다. 시계가 1 행
   * 위쪽에 붙고 그 아래로 빈 공간이 생긴 다음 날씨가 2 행 시작에 붙어, 둘
   * 사이가 벌어져 보였다. 1·2 행을 `auto` 로 두고 3 행이 `1fr` 로 남은 높이를
   * 먹으면 시계와 날씨가 붙고 빈자리가 아래에 모인다 — 다른 위젯을 더할 자리다.
   */
  it('시계와 날씨가 붙고 정보 열의 빈자리는 아래에 모인다', () => {
    const source = readSource('src/components/layout/WidgetHost.vue')
    const wide = source.slice(0, source.indexOf('@media (max-width: 1100px)'))

    expect(wide).toContain('grid-template-rows: auto auto 1fr auto')
    // 3 행의 정보 열은 비어 있다.
    expect(wide).toContain("'deck player .'")
  })

  it('플레이어 열의 최소 폭이 16:9 를 지킬 수 있는 값이다', () => {
    const source = readSource('src/components/layout/WidgetHost.vue')

    /*
     * `.video-holder` 는 min-height 202px 과 aspect-ratio 16/9 를 함께 갖는다.
     * 폭이 202 × 16/9 ≈ 359px 미만이면 16:9 를 지킬 수 없다.
     */
    expect(source).toContain('minmax(360px,')
  })

  it('드로어 폭이 정보 열의 최소 폭을 넘지 않는다 (오버레이가 플레이어를 가리지 않는 근거)', () => {
    const source = readSource('src/components/layout/WidgetHost.vue')

    /*
     * 가시성 측정은 **다른 요소에 덮인 것을 감지하지 못한다**
     * (`playerVisibility.ts`). 그래서 오버레이가 플레이어를 비켜간다는 것은
     * 레이아웃으로 보장해야 한다. 정보 열의 최소 폭을 드로어 폭 자체로
     * 묶어두면, 우측 오버레이가 정보 열 안에서 끝난다.
     */
    expect(source).toContain('minmax(var(--size-drawer-width),')
  })

  it('클릭을 가로채지 않는다', () => {
    // 플레이어 열 위에 겹치는 요소다. 포인터를 먹으면 컨트롤이 막힌다.
    expect(readSource('src/components/layout/WidgetHost.vue')).toContain('pointer-events: none')
  })

  it('두 테마가 각자의 선 색을 쓴다', () => {
    for (const file of [
      'src/themes/mono-vinyl/tokens.css',
      'src/themes/kawaii-synth-cassette/tokens.css',
    ]) {
      expect(readSource(file)).toContain('--info-border-color:')
    }
  })
})
