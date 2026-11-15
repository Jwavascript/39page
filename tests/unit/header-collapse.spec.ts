import { nextTick } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import App from '@/app/App.vue'
import { FakePlayerAdapter } from '@/features/playback/FakePlayerAdapter'
import { PLAYER_ADAPTER_FACTORY } from '@/features/playback/PlayerAdapter'
import { useLibraryStore } from '@/stores/library'
import { usePlaybackStore } from '@/stores/playback'
import { useThemeStore } from '@/stores/theme'
import { installPlayerRect, uninstallPlayerRect } from '../support/playerLayout'

beforeEach(() => {
  localStorage.clear()
  setActivePinia(createPinia())
  installPlayerRect()
})
afterEach(() => {
  uninstallPlayerRect()
  vi.restoreAllMocks()
  localStorage.clear()
  document.body.innerHTML = ''
  delete document.documentElement.dataset.theme
})

async function setup() {
  const library = useLibraryStore()
  const created = await library.createPlaylist('Header test')
  if (!created.ok) throw new Error('playlist')
  await library.addTrack(created.playlistId, { videoId: 'aaaaaaaaaaa', title: 'Track' })
  const fake = new FakePlayerAdapter()
  const wrapper = mount(App, {
    attachTo: document.body,
    global: { provide: { [PLAYER_ADAPTER_FACTORY as symbol]: () => fake } },
  })
  await nextTick()
  return { wrapper, fake }
}

describe('헤더 접기', () => {
  it('접힌 선택은 테마를 바꾸어도 유지되고 펼치면 현재 테마 메뉴가 복원된다', async () => {
    const { wrapper } = await setup()
    await wrapper.get('.header-toggle').trigger('click')
    await flushPromises()
    useThemeStore().setTheme('mono-vinyl')
    await nextTick()
    expect(wrapper.get('.header-toggle').attributes('aria-expanded')).toBe('false')
    await wrapper.get('.header-toggle').trigger('click')
    await flushPromises()
    expect(wrapper.get('.theme-button:last-child').attributes('aria-pressed')).toBe('true')
    wrapper.unmount()
  })
  it('기본 펼침·접힘 aria 상태와 포커스, 메뉴 DOM을 유지하고 새 앱은 다시 펼침이다', async () => {
    const { wrapper } = await setup()
    const button = wrapper.get('.header-toggle')
    const content = wrapper.get('#dashboard-header-content')
    const themeNode = wrapper.get('.theme-switch').element
    expect(button.attributes('aria-expanded')).toBe('true')
    expect(button.attributes('aria-controls')).toBe(content.attributes('id'))
    for (let i = 0; i < 3; i++) {
      await button.trigger('click')
      await flushPromises()
      expect(button.attributes('aria-label')).toBe('헤더 펼치기')
      expect(button.attributes('aria-expanded')).toBe('false')
      expect(content.attributes('hidden')).toBeDefined()
      expect(document.activeElement).toBe(button.element)
      expect(wrapper.get('.theme-switch').element).toBe(themeNode)
      await button.trigger('click')
      await flushPromises()
      expect(button.attributes('aria-expanded')).toBe('true')
      expect(content.attributes('hidden')).toBeUndefined()
    }
    await button.trigger('click')
    await flushPromises()
    wrapper.unmount()
    const next = await setup()
    expect(next.wrapper.get('.header-toggle').attributes('aria-expanded')).toBe('true')
    next.wrapper.unmount()
  })

  it('접고 펼쳐도 재생·큐·저장소가 그대로이며 복원한 메뉴가 동작한다', async () => {
    const { wrapper, fake } = await setup()
    await wrapper.get('.now-playlist .track-row').trigger('click')
    fake.emitReady()
    fake.emitStateChange('playing')
    fake.emitPosition(37)
    await flushPromises()
    const playback = usePlaybackStore()
    const queue = JSON.stringify(playback.queue)
    const calls = JSON.stringify(fake.calls)
    const host = wrapper.get('.player-mount').element
    const before = JSON.stringify({ ...localStorage })
    for (let i = 0; i < 4; i++) {
      await wrapper.get('.header-toggle').trigger('click')
      await flushPromises()
    }
    expect(wrapper.get('.player-mount').element).toBe(host)
    expect(JSON.stringify(playback.queue)).toBe(queue)
    expect(playback.playerState).toBe('playing')
    expect(JSON.stringify(fake.calls)).toBe(calls)
    expect(JSON.stringify({ ...localStorage })).toBe(before)
    await wrapper.get('.theme-button:last-child').trigger('click')
    expect(useThemeStore().current).toBe('mono-vinyl')
    await wrapper.get('.app-nav button:first-child').trigger('click')
    await flushPromises()
    expect(wrapper.get('#archive-panel').attributes('hidden')).toBeUndefined()
    await wrapper.get('.app-nav button:last-child').trigger('click')
    expect(wrapper.get('.data-backdrop').attributes('hidden')).toBeUndefined()
    wrapper.unmount()
  })
})
