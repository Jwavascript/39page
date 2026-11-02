import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'

import App from '@/app/App.vue'

describe('App shell', () => {
  it('mounts and renders the app name', () => {
    const wrapper = mount(App)
    expect(wrapper.text()).toContain('39page')
  })
})
