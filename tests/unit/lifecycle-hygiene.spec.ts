/**
 * M5 — 수명주기 위생.
 *
 * 앱을 언마운트했을 때 **아무것도 남지 않는지** 본다. 타이머·리스너·요청·
 * 외부 플레이어가 남으면 긴 세션에서 누수가 되고, 테스트 사이에도 새어나간다.
 *
 * 메모리 사용량을 직접 재지는 못한다. 대신 누수의 **원인**이 되는 것들을
 * 센다 — 그쪽이 재현 가능하다.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import App from '@/app/App.vue'
import { FakePlayerAdapter } from '@/features/playback/FakePlayerAdapter'
import { PLAYER_ADAPTER_FACTORY } from '@/features/playback/PlayerAdapter'
import { useLibraryStore } from '@/stores/library'
import { clearWeatherCache } from '@/widgets/weather/useWeather'

import { installPlayerRect, uninstallPlayerRect } from '../support/playerLayout'

function readSource(relative: string): string {
  return readFileSync(resolve(process.cwd(), relative), 'utf8')
}

beforeEach(() => {
  globalThis.localStorage.clear()
  delete document.documentElement.dataset.theme
  setActivePinia(createPinia())
  installPlayerRect()
  clearWeatherCache()
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  uninstallPlayerRect()
  clearWeatherCache()
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

describe('A. 타이머', () => {
  it('언마운트하면 타이머가 하나도 남지 않는다', () => {
    vi.useFakeTimers()
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(() => new Promise<Response>(() => {})),
    )

    const { wrapper } = mountApp()
    expect(vi.getTimerCount()).toBeGreaterThan(0)

    wrapper.unmount()

    // 시계의 15초 간격과 날씨의 갱신 예약이 모두 걷혀야 한다.
    expect(vi.getTimerCount()).toBe(0)
  })

  it('마운트·언마운트를 되풀이해도 타이머가 쌓이지 않는다', () => {
    vi.useFakeTimers()
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(() => new Promise<Response>(() => {})),
    )

    for (let round = 0; round < 3; round += 1) {
      const { wrapper } = mountApp()
      wrapper.unmount()
      document.body.innerHTML = ''
    }

    expect(vi.getTimerCount()).toBe(0)
  })

  it('setInterval 을 쓰는 곳이 모두 정리 코드를 갖는다', () => {
    for (const file of ['src/widgets/clock/ClockWidget.vue']) {
      const source = readSource(file)
      expect(source).toContain('setInterval')
      expect(source).toContain('clearInterval')
      expect(source).toContain('onUnmounted')
    }
  })
})

describe('B. 이벤트 리스너', () => {
  it('언마운트하면 document·window 리스너를 모두 거둔다', () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(() => new Promise<Response>(() => {})),
    )
    const added: string[] = []
    const removed: string[] = []
    const addDocument = vi.spyOn(document, 'addEventListener')
    const removeDocument = vi.spyOn(document, 'removeEventListener')
    const addWindow = vi.spyOn(window, 'addEventListener')
    const removeWindow = vi.spyOn(window, 'removeEventListener')

    const { wrapper } = mountApp()
    addDocument.mock.calls.forEach(([type]) => added.push(`document:${String(type)}`))
    addWindow.mock.calls.forEach(([type]) => added.push(`window:${String(type)}`))

    wrapper.unmount()
    removeDocument.mock.calls.forEach(([type]) => removed.push(`document:${String(type)}`))
    removeWindow.mock.calls.forEach(([type]) => removed.push(`window:${String(type)}`))

    // 붙인 종류가 전부 떨어졌는지. 횟수가 아니라 종류로 본다.
    for (const type of new Set(added)) {
      expect(removed).toContain(type)
    }
    expect(new Set(added).size).toBeGreaterThan(0)
  })

  it('언마운트 뒤 전역 이벤트가 터져도 아무 일도 없다', () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(() => new Promise<Response>(() => {})),
    )
    const { wrapper } = mountApp()
    wrapper.unmount()

    expect(() => {
      window.dispatchEvent(new Event('resize'))
      window.dispatchEvent(new Event('scroll'))
      document.dispatchEvent(new Event('visibilitychange'))
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    }).not.toThrow()
  })
})

describe('C. 플레이어 수명주기', () => {
  it('세션당 mount 1회, 언마운트에서 destroy 1회', async () => {
    const { wrapper, fake } = mountApp()
    const library = useLibraryStore()
    const created = library.createPlaylist('LIST')
    const playlistId = created.ok ? created.playlistId : ''
    library.addTrack(playlistId, { videoId: 'aaaaaaaaaaa', title: 'ONE' })
    library.selectPlaylist(playlistId)
    await flushPromises()

    await wrapper.get('.deck-open--mono-vinyl').trigger('click')
    await wrapper.get('.drawer .track-play').trigger('click')
    fake.emitReady()
    fake.emitStateChange('playing')
    await flushPromises()

    expect(fake.calls.mount).toBe(1)
    expect(fake.calls.destroy).toBe(0)

    wrapper.unmount()

    expect(fake.calls.destroy).toBe(1)
    expect(fake.isMounted).toBe(false)
    // 어댑터가 만든 노드가 문서에 남지 않는다.
    expect(document.querySelector('[data-fake-player-host]')).toBeNull()
  })

  it('어댑터와 DOM 노드가 Pinia state 에 들어가지 않는다', async () => {
    const { wrapper } = mountApp()
    await flushPromises()

    const serialized = JSON.stringify(
      Object.fromEntries(
        Object.entries(
          (wrapper.vm.$ as unknown as { appContext: { config: { globalProperties: object } } })
            .appContext.config.globalProperties,
        ).filter(([key]) => key !== '$pinia'),
      ),
    )

    // state 를 직렬화할 수 있어야 한다 — DOM 노드가 들어 있으면 순환 참조다.
    expect(() => JSON.stringify(useLibraryStore().$state)).not.toThrow()
    expect(serialized).not.toContain('player-mount')
  })

  it('YouTube API 로더가 모듈 싱글턴이다', () => {
    const source = readSource('src/features/playback/youtubeIframeApi.ts')

    // 어댑터가 여러 번 생겨도 스크립트는 한 번만 받는다.
    expect(source).toContain('let loading: Promise<YouTubeApi> | null = null')
    expect(source).toContain('if (loading !== null) return loading')
    expect(source).toContain('readyHookInstalled')
  })
})

describe('D. 네트워크 요청', () => {
  it('언마운트하면 진행 중인 날씨 요청을 취소한다', () => {
    const abort = vi.fn<() => void>()
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>((_input, init) => {
        init?.signal?.addEventListener('abort', abort)
        return new Promise<Response>(() => {})
      }),
    )

    const { wrapper } = mountApp()
    wrapper.unmount()

    expect(abort).toHaveBeenCalledTimes(1)
  })

  it('마운트 시 YouTube 요청을 내보내지 않는다', () => {
    const fetchStub = vi.fn<typeof fetch>(() => new Promise<Response>(() => {}))
    vi.stubGlobal('fetch', fetchStub)

    mountApp()

    // 날씨 한 번뿐이다. 플레이어는 첫 재생에서야 스크립트를 받는다 (ADR 0008).
    expect(fetchStub).toHaveBeenCalledTimes(1)
    expect(document.querySelectorAll('script[src*="iframe_api"]')).toHaveLength(0)
  })
})

describe('E. 번들', () => {
  it('두 테마의 토큰과 데크 CSS 를 모두 정적으로 불러온다', () => {
    const source = readSource('src/main.ts')

    // 동적 CSS 로더를 두지 않는다. `data-theme` 교체만으로 전환되어야 한다.
    expect(source).toContain("import './themes/mono-vinyl/tokens.css'")
    expect(source).toContain("import './themes/kawaii-synth-cassette/tokens.css'")
    expect(source).not.toContain('import(')
  })

  it('테스트용 가짜 어댑터가 앱 코드에 들어가지 않는다', () => {
    const appFiles = [
      'src/main.ts',
      'src/app/App.vue',
      'src/features/playback/PlayerSurface.vue',
      'src/widgets/registry.ts',
    ]

    for (const file of appFiles) {
      // 주석에서 언급하는 것은 괜찮다. **import 하지 않는 것**이 중요하다.
      expect(readSource(file)).not.toMatch(/from\s+['"][^'"]*FakePlayerAdapter/)
    }
  })

  it('외부 UI 라이브러리를 쓰지 않는다', () => {
    const packageJson = JSON.parse(readSource('package.json')) as {
      dependencies: Record<string, string>
    }

    // MVP 의 런타임 의존성은 vue 와 pinia 뿐이다.
    expect(Object.keys(packageJson.dependencies).sort()).toEqual(['pinia', 'vue'])
  })
})
