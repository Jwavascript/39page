import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import AppHeader from '@/components/layout/AppHeader.vue'
import ThemeSwitcher from '@/components/ui/ThemeSwitcher.vue'
import { STORAGE_KEYS } from '@/shared/storage'
import { THEME_LIST } from '@/themes'
import { useThemeStore } from '@/stores/theme'

beforeEach(() => {
  globalThis.localStorage.clear()
  delete document.documentElement.dataset.theme
  setActivePinia(createPinia())
})

afterEach(() => {
  globalThis.localStorage.clear()
  delete document.documentElement.dataset.theme
})

describe('ThemeSwitcher — 구조와 접근성', () => {
  it('role="group" 과 aria-label 을 갖는다', () => {
    const wrapper = mount(ThemeSwitcher)
    const group = wrapper.get('[role="group"]')
    expect(group.attributes('aria-label')).toBe('테마 선택')
  })

  it('테마마다 네이티브 button 하나씩 렌더한다', () => {
    const wrapper = mount(ThemeSwitcher)
    const buttons = wrapper.findAll('button')

    expect(buttons).toHaveLength(THEME_LIST.length)
    for (const button of buttons) {
      // 네이티브 button 이어야 Tab / Enter / Space 가 기본 동작한다.
      expect(button.element.tagName).toBe('BUTTON')
      expect(button.attributes('type')).toBe('button')
    }
  })

  it('레이블을 레지스트리에서 가져온다', () => {
    const wrapper = mount(ThemeSwitcher)
    const labels = wrapper.findAll('button').map((button) => button.text())

    expect(labels).toEqual(['01 / MONO VINYL', '02 / SYNTH CASSETTE'])
    expect(labels).toEqual(THEME_LIST.map((option) => option.label))
  })

  it('라디오 역할이나 커스텀 키보드 내비게이션을 쓰지 않는다', () => {
    const wrapper = mount(ThemeSwitcher)
    expect(wrapper.find('[role="radio"]').exists()).toBe(false)
    expect(wrapper.find('[role="radiogroup"]').exists()).toBe(false)
    expect(wrapper.find('input[type="radio"]').exists()).toBe(false)
    for (const button of wrapper.findAll('button')) {
      // tabindex 를 건드리지 않아야 기본 Tab 순서를 따른다.
      expect(button.attributes('tabindex')).toBeUndefined()
    }
  })
})

describe('9. aria-pressed 가 현재 선택과 일치한다', () => {
  it('처음에는 mono-vinyl 만 pressed 다', () => {
    const wrapper = mount(ThemeSwitcher)
    const [mono, kawaii] = wrapper.findAll('button')

    expect(mono?.attributes('aria-pressed')).toBe('true')
    expect(kawaii?.attributes('aria-pressed')).toBe('false')
  })

  it('클릭하면 pressed 상태가 옮겨간다', async () => {
    const wrapper = mount(ThemeSwitcher)
    const [mono, kawaii] = wrapper.findAll('button')

    await kawaii?.trigger('click')

    expect(mono?.attributes('aria-pressed')).toBe('false')
    expect(kawaii?.attributes('aria-pressed')).toBe('true')
  })

  it('항상 정확히 하나만 pressed 다', async () => {
    const wrapper = mount(ThemeSwitcher)
    const pressedCount = () =>
      wrapper.findAll('button').filter((button) => button.attributes('aria-pressed') === 'true')
        .length

    expect(pressedCount()).toBe(1)
    await wrapper.findAll('button')[1]?.trigger('click')
    expect(pressedCount()).toBe(1)
    await wrapper.findAll('button')[0]?.trigger('click')
    expect(pressedCount()).toBe(1)
  })

  it('선택된 버튼에 시각적 구별 클래스가 붙는다', async () => {
    const wrapper = mount(ThemeSwitcher)
    const [mono, kawaii] = wrapper.findAll('button')

    expect(mono?.classes()).toContain('is-active')
    expect(kawaii?.classes()).not.toContain('is-active')

    await kawaii?.trigger('click')

    expect(mono?.classes()).not.toContain('is-active')
    expect(kawaii?.classes()).toContain('is-active')
  })

  it('store 에서 테마를 바꿔도 버튼 상태가 따라온다', async () => {
    const wrapper = mount(ThemeSwitcher)
    const theme = useThemeStore()

    theme.setTheme('kawaii-synth-cassette')
    await wrapper.vm.$nextTick()

    expect(wrapper.findAll('button')[1]?.attributes('aria-pressed')).toBe('true')
  })
})

describe('ThemeSwitcher — 동작', () => {
  it('클릭이 store 와 DOM 과 저장소를 모두 갱신한다', async () => {
    const wrapper = mount(ThemeSwitcher)
    const theme = useThemeStore()

    await wrapper.findAll('button')[1]?.trigger('click')

    expect(theme.current).toBe('kawaii-synth-cassette')
    expect(document.documentElement.dataset.theme).toBe('kawaii-synth-cassette')
    expect(JSON.parse(globalThis.localStorage.getItem(STORAGE_KEYS.theme) as string)).toEqual({
      version: 1,
      data: 'kawaii-synth-cassette',
    })
  })

  it('이미 선택된 테마를 다시 눌러도 깨지지 않는다', async () => {
    const wrapper = mount(ThemeSwitcher)
    const theme = useThemeStore()

    await wrapper.findAll('button')[0]?.trigger('click')

    expect(theme.current).toBe('mono-vinyl')
    expect(wrapper.findAll('button')[0]?.attributes('aria-pressed')).toBe('true')
  })
})

describe('AppHeader', () => {
  it('브랜드 이름과 ThemeSwitcher 를 렌더한다', () => {
    const wrapper = mount(AppHeader, { props: { brand: '39page' } })

    expect(wrapper.text()).toContain('39page')
    expect(wrapper.findComponent(ThemeSwitcher).exists()).toBe(true)
  })

  it('actions 슬롯으로 M1-4 버튼을 더할 수 있다', () => {
    const wrapper = mount(AppHeader, {
      props: { brand: '39page' },
      slots: { actions: '<button type="button">◉ 라이브러리</button>' },
    })

    expect(wrapper.text()).toContain('◉ 라이브러리')
    // 슬롯 내용이 ThemeSwitcher 와 공존해야 한다.
    expect(wrapper.findComponent(ThemeSwitcher).exists()).toBe(true)
  })

  it('프로토타입 전용 UI 를 복제하지 않는다', () => {
    const wrapper = mount(AppHeader, { props: { brand: '39page' } })
    const html = wrapper.html()

    // .demo-top / 가로·세로 보기 버튼은 제품 UI 가 아니다.
    expect(html).not.toContain('demo-top')
    expect(html).not.toContain('view-btn')
    expect(wrapper.text()).not.toContain('가로 보기')
    expect(wrapper.text()).not.toContain('세로 보기')
  })
})
