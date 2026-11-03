import { nextTick } from 'vue'

import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import App from '@/app/App.vue'
import { MVP_DASHBOARD_LAYOUT } from '@/app/layout'
import AppHeader from '@/components/layout/AppHeader.vue'
import DashboardShell from '@/components/layout/DashboardShell.vue'
import WidgetHost from '@/components/layout/WidgetHost.vue'
import ThemeSwitcher from '@/components/ui/ThemeSwitcher.vue'
import type { DashboardLayout } from '@/shared/types'
import { useThemeStore } from '@/stores/theme'

function mountApp() {
  return mount(App, { attachTo: document.body })
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

describe('1. DashboardShell 렌더링', () => {
  it('셸 · 워크스페이스 · 위젯 호스트를 렌더한다', () => {
    const wrapper = mountApp()

    expect(wrapper.find('.dashboard-shell').exists()).toBe(true)
    expect(wrapper.find('.workspace').exists()).toBe(true)
    expect(wrapper.findComponent(WidgetHost).exists()).toBe(true)
  })

  it('레이아웃을 WidgetHost 에 넘긴다', () => {
    const host = mountApp().findComponent(WidgetHost)
    expect(host.props('layout')).toEqual(MVP_DASHBOARD_LAYOUT)
  })

  it('임시 플레이스홀더 영역이 남아 있지 않다', () => {
    // M1-3의 .workspace-placeholder 는 제거되었다.
    expect(mountApp().find('.workspace-placeholder').exists()).toBe(false)
  })

  it('프로토타입 전용 UI 를 포함하지 않는다', () => {
    const wrapper = mountApp()
    const html = wrapper.html()

    for (const token of ['demo-top', 'view-btn', 'ux-notes']) {
      expect(html).not.toContain(token)
    }
    for (const text of ['가로 보기', '세로 보기', 'UX 검증']) {
      expect(wrapper.text()).not.toContain(text)
    }
  })

  it('헤더에 동작하지 않는 버튼을 만들지 않는다', () => {
    const wrapper = mountApp()
    const header = wrapper.findComponent(AppHeader)

    // 헤더의 버튼은 테마 전환 2개뿐이다. 라이브러리 열기는 M2-2에서
    // 데크 트리거로 구현했고, 링크 추가는 아직 없다.
    expect(header.findAll('button')).toHaveLength(2)
    expect(header.text()).not.toContain('링크 추가')
  })

  it('아직 없는 기능의 버튼을 만들지 않는다', () => {
    const wrapper = mountApp()
    const labels = wrapper
      .findAll('button')
      .map((button) => `${button.text()} ${button.attributes('aria-label') ?? ''}`)

    // M3-3 의 트랜스포트 3개 + M3-2 의 라이브러리 재생 버튼. 그게 전부다.
    // 목록별 ▶ 와 트랙별 ▶ 는 항목이 있을 때만 생기고, 여기는 빈 상태다.
    expect(labels.filter((label) => label.includes('재생'))).toEqual([
      '▶ 재생',
      '▶ 목록 전체 재생 ',
    ])

    // 반복·셔플·볼륨·탐색 바는 MVP 범위 밖이다 (M3-0.1 · 0.3 · 0.4).
    for (const text of ['반복', '셔플', '볼륨']) {
      expect(wrapper.text()).not.toContain(text)
    }
    expect(wrapper.findAll('input[type="range"]')).toEqual([])

    // 재생 실패 시 외부 링크는 M3-5 다.
    expect(wrapper.text()).not.toContain('YOUTUBE에서 열기')
  })
})

describe('2. 기존 AppHeader · ThemeSwitcher 유지', () => {
  it('헤더에 제품명 39page 를 표시한다', () => {
    const wrapper = mountApp()
    expect(wrapper.findComponent(AppHeader).exists()).toBe(true)
    expect(wrapper.find('.brand').text()).toBe('39page')
  })

  it('ThemeSwitcher 가 헤더 안에 있다', () => {
    const wrapper = mountApp()
    const header = wrapper.findComponent(AppHeader)

    expect(header.findComponent(ThemeSwitcher).exists()).toBe(true)
    expect(header.find('[role="group"]').attributes('aria-label')).toBe('테마 선택')
  })

  it('헤더에 M2 액션을 더할 슬롯이 남아 있다', () => {
    const wrapper = mount(DashboardShell, {
      props: { brand: '39page', layout: MVP_DASHBOARD_LAYOUT },
      slots: { 'header-actions': '<button type="button">◉ 라이브러리</button>' },
    })

    expect(wrapper.text()).toContain('◉ 라이브러리')
    expect(wrapper.findComponent(ThemeSwitcher).exists()).toBe(true)
  })
})

describe('6 · 7. WidgetHost 렌더링과 Grid 직계 자식', () => {
  it('레이아웃의 위젯을 순서대로 렌더한다', () => {
    const host = mountApp().findComponent(WidgetHost)
    const rendered = host.findAll('[data-widget]').map((node) => node.attributes('data-widget'))

    expect(rendered).toEqual(MVP_DASHBOARD_LAYOUT.items.map((item) => item.widgetType))
  })

  it('위젯 루트 요소가 Grid 컨테이너의 직계 자식이다', () => {
    const host = mountApp().findComponent(WidgetHost)
    const grid = host.element
    const children = [...grid.children]

    expect(children).toHaveLength(MVP_DASHBOARD_LAYOUT.items.length)
    // 래퍼 div 없이 위젯 자신이 자식이어야 한다.
    for (const [index, child] of children.entries()) {
      const item = MVP_DASHBOARD_LAYOUT.items[index]
      expect(child.getAttribute('data-instance-id')).toBe(item?.instanceId)
      expect(child.getAttribute('data-widget')).toBe(item?.widgetType)
    }
  })

  it('배치를 grid-area 로만 지정한다', () => {
    const host = mountApp().findComponent(WidgetHost)

    for (const item of MVP_DASHBOARD_LAYOUT.items) {
      const node = host.get(`[data-instance-id="${item.instanceId}"]`)
      // 인라인 스타일로 이름 영역만 지정한다. 좌표를 쓰지 않는다.
      expect(node.attributes('style')).toContain(item.area)
    }
  })

  it('알 수 없는 위젯 종류를 조용히 건너뛴다', () => {
    const layout: DashboardLayout = {
      version: 1,
      items: [
        { instanceId: 'clock-main', widgetType: 'clock', area: 'clock' },
        // 구버전 레이아웃이 가리키는 제거된 위젯
        { instanceId: 'ghost', widgetType: 'turntable' as never, area: 'deck' },
        { instanceId: 'player-main', widgetType: 'player', area: 'player' },
      ],
    }
    const wrapper = mount(WidgetHost, { props: { layout } })

    expect(wrapper.findAll('[data-widget]')).toHaveLength(2)
    expect(wrapper.find('[data-instance-id="ghost"]').exists()).toBe(false)
    expect(wrapper.element.children).toHaveLength(2)
  })

  it('빈 레이아웃에서도 깨지지 않는다', () => {
    const wrapper = mount(WidgetHost, { props: { layout: { version: 1, items: [] } } })
    expect(wrapper.find('.widget-host').exists()).toBe(true)
    expect(wrapper.element.children).toHaveLength(0)
  })
})

describe('8 · 9. 테마 전환 시 DOM 동일성', () => {
  /**
   * 반드시 `await nextTick()` 뒤에 검증한다.
   *
   * Vue 의 재렌더는 비동기다. `setTheme` 직후에 읽으면 아직 패치되지 않은
   * DOM 을 보게 되어, `:key` 에 테마를 섞는 잘못된 구현도 통과한다.
   */
  it('테마를 바꿔도 모든 위젯의 DOM 노드가 같은 인스턴스다', async () => {
    const wrapper = mountApp()
    const theme = useThemeStore()

    const before = new Map(
      MVP_DASHBOARD_LAYOUT.items.map((item) => [
        item.instanceId,
        wrapper.get(`[data-instance-id="${item.instanceId}"]`).element,
      ]),
    )

    theme.setTheme('kawaii-synth-cassette')
    await nextTick()

    // 같은 노드여야 한다. 새 노드면 iframe 이 재로드된다.
    const replaced = MVP_DASHBOARD_LAYOUT.items
      .filter(
        (item) =>
          wrapper.get(`[data-instance-id="${item.instanceId}"]`).element !==
          before.get(item.instanceId),
      )
      .map((item) => item.instanceId)

    expect(replaced).toEqual([])
  })

  it('플레이어 영역 DOM 이 테마 전환을 왕복해도 유지된다', async () => {
    const wrapper = mountApp()
    const theme = useThemeStore()
    const playerNode = wrapper.get('[data-instance-id="player-main"]').element

    for (const key of ['kawaii-synth-cassette', 'mono-vinyl', 'kawaii-synth-cassette'] as const) {
      theme.setTheme(key)
      await nextTick()
    }

    expect(wrapper.get('[data-instance-id="player-main"]').element).toBe(playerNode)
    // 문서에 계속 붙어 있어야 한다 (언마운트·분리 금지).
    expect(document.body.contains(playerNode)).toBe(true)
  })

  it('강제 재렌더에도 위젯 DOM 노드가 유지된다', async () => {
    // :key 가 instanceId 만 쓰는지 테마와 무관하게 검증한다.
    const wrapper = mountApp()
    const host = wrapper.findComponent(WidgetHost)
    const before = [...host.element.children]

    host.vm.$forceUpdate()
    await nextTick()

    expect([...host.element.children]).toEqual(before)
  })

  it('테마를 바꿔도 위젯 목록과 instanceId 가 변하지 않는다', async () => {
    const wrapper = mountApp()
    const theme = useThemeStore()
    const ids = () =>
      wrapper.findAll('[data-instance-id]').map((node) => node.attributes('data-instance-id'))

    const before = ids()
    theme.setTheme('kawaii-synth-cassette')
    await nextTick()

    expect(ids()).toEqual(before)
    expect(before).toEqual(MVP_DASHBOARD_LAYOUT.items.map((item) => item.instanceId))
  })

  it('테마를 바꿔도 위젯 컴포넌트가 다시 마운트되지 않는다', async () => {
    const wrapper = mountApp()
    const theme = useThemeStore()
    const host = wrapper.findComponent(WidgetHost)

    const hostElement = host.element
    const widgetElements = [...host.element.children]

    theme.setTheme('kawaii-synth-cassette')
    await nextTick()

    expect(host.element).toBe(hostElement)
    expect([...host.element.children]).toEqual(widgetElements)
  })

  it('테마 전환이 DashboardShell 자체를 교체하지 않는다', async () => {
    const wrapper = mountApp()
    const theme = useThemeStore()
    const shell = wrapper.get('.dashboard-shell').element

    theme.setTheme('kawaii-synth-cassette')
    await nextTick()

    expect(wrapper.get('.dashboard-shell').element).toBe(shell)
    expect(document.documentElement.dataset.theme).toBe('kawaii-synth-cassette')
  })
})

describe('7. 테마와 위젯의 책임 분리', () => {
  it('WidgetHost 와 DashboardShell 이 Theme Store 를 쓰지 않는다', async () => {
    const { readFileSync } = await import('node:fs')
    const files = [
      'src/components/layout/WidgetHost.vue',
      'src/components/layout/DashboardShell.vue',
      'src/app/layout.ts',
    ]

    const offenders = files.filter((file) => {
      const source = readFileSync(file, 'utf8')
      return source.includes('useThemeStore') || source.includes('ThemeKey')
    })

    expect(offenders).toEqual([])
  })

  it('레이아웃 배열이 테마와 무관한 단일 상수다', async () => {
    const wrapper = mountApp()
    const theme = useThemeStore()
    const host = wrapper.findComponent(WidgetHost)

    const before = host.props('layout')
    theme.setTheme('kawaii-synth-cassette')
    await nextTick()

    // 같은 객체 참조여야 한다. 테마별 레이아웃을 만들지 않는다.
    expect(host.props('layout')).toBe(before)
  })
})
