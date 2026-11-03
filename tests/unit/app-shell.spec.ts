import { mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { afterEach, describe, expect, it } from 'vitest'

import App from '@/app/App.vue'

afterEach(() => {
  globalThis.localStorage.clear()
  delete document.documentElement.dataset.theme
})

describe('App shell', () => {
  // App.vue 는 M1-3부터 theme store 를 사용하므로 pinia 가 필요하다.
  const mountApp = () => mount(App, { global: { plugins: [createPinia()] } })

  it('mounts and renders the app name', () => {
    expect(mountApp().text()).toContain('39page')
  })

  it('renders the theme switcher in the header', () => {
    const wrapper = mountApp()
    const group = wrapper.get('[role="group"]')

    expect(group.attributes('aria-label')).toBe('테마 선택')
    // 헤더 안의 버튼은 테마 전환 2개뿐이다.
    // (M2-2에서 데크·드로어 버튼이 생겼으므로 헤더로 범위를 좁힌다.)
    expect(group.findAll('button')).toHaveLength(2)
  })

  it('applies the default theme to the document root', () => {
    mountApp()
    expect(document.documentElement.dataset.theme).toBe('mono-vinyl')
  })
})
