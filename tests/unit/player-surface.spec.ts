import { nextTick } from 'vue'

import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import App from '@/app/App.vue'
import { MVP_DASHBOARD_LAYOUT } from '@/app/layout'
import { FakePlayerAdapter } from '@/features/playback/FakePlayerAdapter'
import { PLAYER_ADAPTER_FACTORY } from '@/features/playback/PlayerAdapter'
import PlayerSurface from '@/features/playback/PlayerSurface.vue'
import { useThemeStore } from '@/stores/theme'

const PLAYER_INSTANCE_ID = 'player-main'

/** 주입한 Fake 어댑터와 함께 전체 앱을 마운트한다. */
function mountAppWithFake() {
  const fake = new FakePlayerAdapter()
  const wrapper = mount(App, {
    attachTo: document.body,
    global: { provide: { [PLAYER_ADAPTER_FACTORY as symbol]: () => fake } },
  })
  return { wrapper, fake }
}

/** PlayerSurface 만 단독으로 마운트한다. */
function mountSurfaceWithFake() {
  const fake = new FakePlayerAdapter()
  const wrapper = mount(PlayerSurface, {
    attachTo: document.body,
    global: { provide: { [PLAYER_ADAPTER_FACTORY as symbol]: () => fake } },
  })
  return { wrapper, fake }
}

async function switchTheme(key: 'mono-vinyl' | 'kawaii-synth-cassette') {
  useThemeStore().setTheme(key)
  // Vue 의 재렌더는 비동기다. 패치 이후를 봐야 한다.
  await nextTick()
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

describe('A. 어댑터 수명주기', () => {
  it('1. 최초 마운트 시 mount() 를 한 번 호출한다', () => {
    const { fake } = mountAppWithFake()

    expect(fake.calls.mount).toBe(1)
    expect(fake.isMounted).toBe(true)
  })

  it('2. 테마를 바꿔도 mount() 호출 횟수가 유지된다', async () => {
    const { fake } = mountAppWithFake()

    await switchTheme('kawaii-synth-cassette')

    expect(fake.calls.mount).toBe(1)
  })

  it('3. 테마를 여러 번 왕복해도 mount() 는 한 번이다', async () => {
    const { fake } = mountAppWithFake()

    for (const key of ['kawaii-synth-cassette', 'mono-vinyl', 'kawaii-synth-cassette'] as const) {
      await switchTheme(key)
    }

    expect(fake.calls.mount).toBe(1)
    expect(fake.calls.destroy).toBe(0)
  })

  it('4. Vue 재렌더 후에도 추가 mount() 가 없다', async () => {
    const { wrapper, fake } = mountAppWithFake()
    const surface = wrapper.findComponent(PlayerSurface)

    surface.vm.$forceUpdate()
    await nextTick()
    await nextTick()

    expect(fake.calls.mount).toBe(1)
  })

  it('5. 실제 언마운트 시 destroy() 를 한 번 호출한다', () => {
    const { wrapper, fake } = mountAppWithFake()

    wrapper.unmount()

    expect(fake.calls.destroy).toBe(1)
    expect(fake.isMounted).toBe(false)
  })

  it('6. 테마 변경만으로 destroy() 가 호출되지 않는다', async () => {
    const { fake } = mountAppWithFake()

    await switchTheme('kawaii-synth-cassette')
    await switchTheme('mono-vinyl')

    expect(fake.calls.destroy).toBe(0)
  })

  it('어댑터 팩토리가 주입되지 않으면 어댑터를 만들지 않는다', () => {
    // M1-5 의 기본 상태. 실제 어댑터는 M3 에서 주입한다.
    const wrapper = mount(PlayerSurface, { attachTo: document.body })

    expect(wrapper.find('.player-mount').element.children).toHaveLength(0)
    expect(wrapper.text()).toContain('NOT CONNECTED')
  })
})

describe('어댑터 계약 — 중복 호출', () => {
  it('중복 mount() 는 두 번째 노드를 만들지 않는다', () => {
    const fake = new FakePlayerAdapter()
    const container = document.createElement('div')

    fake.mount(container)
    const first = fake.hostNode
    fake.mount(container)

    // 호출은 2회로 기록되지만 노드는 하나다.
    expect(fake.calls.mount).toBe(2)
    expect(container.children).toHaveLength(1)
    expect(fake.hostNode).toBe(first)
  })

  it('중복 destroy() 는 던지지 않는다', () => {
    const fake = new FakePlayerAdapter()

    expect(() => fake.destroy()).not.toThrow()
    fake.mount(document.createElement('div'))
    fake.destroy()

    expect(() => fake.destroy()).not.toThrow()
    expect(fake.isMounted).toBe(false)
  })

  it('destroy() 후 다시 mount() 할 수 있다', () => {
    const fake = new FakePlayerAdapter()
    const container = document.createElement('div')

    fake.mount(container)
    fake.destroy()
    expect(container.children).toHaveLength(0)

    fake.mount(container)
    expect(container.children).toHaveLength(1)
  })

  it('도메인 PlayerState 만 노출한다', () => {
    const fake = new FakePlayerAdapter()

    expect(fake.state()).toBe('idle')
    fake.load('dQw4w9WgXcQ')
    expect(fake.state()).toBe('loading')
    fake.play()
    expect(fake.state()).toBe('playing')
    fake.pause()
    expect(fake.state()).toBe('paused')
    expect(fake.calls.load).toEqual(['dQw4w9WgXcQ'])
  })
})

describe('B. DOM 인스턴스 동일성', () => {
  it('7. 테마 전환 후 PlayerSurface 루트 DOM 노드가 동일하다', async () => {
    const { wrapper } = mountAppWithFake()
    const root = wrapper.get(`[data-instance-id="${PLAYER_INSTANCE_ID}"]`).element

    await switchTheme('kawaii-synth-cassette')

    expect(wrapper.get(`[data-instance-id="${PLAYER_INSTANCE_ID}"]`).element).toBe(root)
  })

  it('8. 어댑터가 만든 내부 DOM 노드가 동일하다', async () => {
    const { fake } = mountAppWithFake()
    const host = fake.hostNode

    expect(host).not.toBeNull()

    for (const key of ['kawaii-synth-cassette', 'mono-vinyl'] as const) {
      await switchTheme(key)
    }

    expect(fake.hostNode).toBe(host)
  })

  it('9. 플레이어 호스트가 제거되거나 부모가 바뀌지 않는다', async () => {
    const { fake } = mountAppWithFake()
    const host = fake.hostNode as HTMLElement
    const parentBefore = host.parentElement
    const containerBefore = fake.container

    await switchTheme('kawaii-synth-cassette')

    // 부모가 바뀌기만 해도 iframe 은 재로드된다.
    expect(host.parentElement).toBe(parentBefore)
    expect(fake.container).toBe(containerBefore)
    expect(document.body.contains(host)).toBe(true)
  })

  it('Vue 가 어댑터 소유 영역 안을 렌더하지 않는다', () => {
    const { wrapper, fake } = mountSurfaceWithFake()
    const host = wrapper.get('.player-mount').element

    // 어댑터가 만든 노드 하나뿐이어야 한다.
    expect([...host.children]).toEqual([fake.hostNode])
  })

  it('PlayerSurface 가 단일 루트 요소다', () => {
    const { wrapper } = mountSurfaceWithFake()

    // 단일 루트여야 grid-area 가 루트에 적용된다.
    expect(wrapper.element.nodeType).toBe(Node.ELEMENT_NODE)
    expect(wrapper.element.classList.contains('player-surface')).toBe(true)
  })

  it('10. player 인스턴스 ID 와 Grid 영역이 유지된다', async () => {
    const { wrapper } = mountAppWithFake()
    const node = () => wrapper.get(`[data-instance-id="${PLAYER_INSTANCE_ID}"]`)

    const styleBefore = node().attributes('style')
    const widgetBefore = node().attributes('data-widget')

    await switchTheme('kawaii-synth-cassette')

    expect(node().attributes('data-widget')).toBe(widgetBefore)
    expect(node().attributes('style')).toBe(styleBefore)
    expect(node().attributes('style')).toContain('player')
  })

  it('다섯 위젯의 instanceId 와 영역이 M1-4 와 같다', () => {
    const { wrapper } = mountAppWithFake()
    const host = wrapper.get('.widget-host').element

    expect([...host.children].map((el) => (el as HTMLElement).dataset.instanceId)).toEqual(
      MVP_DASHBOARD_LAYOUT.items.map((item) => item.instanceId),
    )
  })

  it('안내 문구가 어댑터 소유 영역 밖에 있다', () => {
    const { wrapper, fake } = mountSurfaceWithFake()
    const notice = wrapper.get('.player-notice').element
    const host = wrapper.get('.player-mount').element

    expect(host.contains(notice)).toBe(false)
    expect(fake.hostNode?.contains(notice)).toBe(false)
  })

  it('동작하는 것처럼 보이는 재생 컨트롤을 만들지 않는다', () => {
    const { wrapper } = mountSurfaceWithFake()

    expect(wrapper.findAll('button')).toHaveLength(0)
    expect(wrapper.findAll('input')).toHaveLength(0)
    expect(wrapper.find('iframe').exists()).toBe(false)
  })
})
