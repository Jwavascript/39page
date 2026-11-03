import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { nextTick } from 'vue'

import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import App from '@/app/App.vue'
import DotMatrix from '@/features/mascot/DotMatrix.vue'
import MascotPanel from '@/features/mascot/MascotPanel.vue'
import { COMPANION_01, MASCOT_PATTERNS, patternSize } from '@/features/mascot/patterns'
import { FakePlayerAdapter } from '@/features/playback/FakePlayerAdapter'
import { PLAYER_ADAPTER_FACTORY } from '@/features/playback/PlayerAdapter'
import { THEME_KEYS } from '@/shared/types'
import { useThemeStore } from '@/stores/theme'

function readSource(relative: string): string {
  return readFileSync(resolve(process.cwd(), relative), 'utf8')
}

/** 레퍼런스 HTML 의 도트 패턴 배열을 꺼낸다. */
function referencePattern(): string[] {
  const html = readSource('design/references/two-themes-v09.html')
  const block = /const rows=\[([\s\S]*?)\];/.exec(html)?.[1] ?? ''
  return [...block.matchAll(/'([01]+)'/g)].map((m) => m[1] ?? '')
}

function mountAppWithFake() {
  const fake = new FakePlayerAdapter()
  const wrapper = mount(App, {
    attachTo: document.body,
    global: { provide: { [PLAYER_ADAPTER_FACTORY as symbol]: () => fake } },
  })
  return { wrapper, fake }
}

async function switchTheme(key: 'mono-vinyl' | 'kawaii-synth-cassette') {
  useThemeStore().setTheme(key)
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

describe('C. 마스코트 패턴 데이터', () => {
  it('13. 패턴이 16×12 다', () => {
    expect(patternSize(COMPANION_01)).toEqual({ columns: 16, rows: 12 })
    expect(COMPANION_01).toHaveLength(12)
    for (const row of COMPANION_01) {
      expect(row).toHaveLength(16)
    }
  })

  it('14. 패턴이 레퍼런스와 일치한다', () => {
    const reference = referencePattern()

    expect(reference).toHaveLength(12)
    expect([...COMPANION_01]).toEqual(reference)
  })

  it('패턴에 0 과 1 만 쓴다', () => {
    for (const row of COMPANION_01) {
      expect(row).toMatch(/^[01]+$/)
    }
    // 빈 패턴이 아니어야 한다.
    expect(COMPANION_01.join('')).toContain('1')
  })

  it('모든 테마에 패턴이 있고 MVP 에서는 같은 패턴을 공유한다', () => {
    for (const key of THEME_KEYS) {
      expect(MASCOT_PATTERNS[key]).toBeDefined()
    }
    expect(MASCOT_PATTERNS['mono-vinyl']).toBe(MASCOT_PATTERNS['kawaii-synth-cassette'])
  })

  it('패턴 데이터와 렌더러가 분리되어 있다', () => {
    // 렌더러는 어떤 캐릭터인지 모른다. M4 에서 패턴만 늘리면 된다.
    const renderer = readSource('src/features/mascot/DotMatrix.vue')
    expect(renderer).not.toContain('COMPANION_01')
    expect(renderer).not.toContain('MASCOT_PATTERNS')
    expect(renderer).not.toContain('0011000000001100')
  })
})

describe('C. 마스코트 렌더링', () => {
  it('도트 매트릭스가 192개 도트를 그린다', () => {
    const wrapper = mount(DotMatrix, { props: { pattern: COMPANION_01 } })

    expect(wrapper.findAll('.dot')).toHaveLength(16 * 12)
    expect(wrapper.get('.dot-matrix').attributes('data-columns')).toBe('16')
    expect(wrapper.get('.dot-matrix').attributes('data-rows')).toBe('12')
  })

  it('켜진 도트 개수가 패턴과 일치한다', () => {
    const wrapper = mount(DotMatrix, { props: { pattern: COMPANION_01 } })
    const expectedOn = COMPANION_01.join('')
      .split('')
      .filter((c) => c === '1').length

    expect(wrapper.findAll('.dot.is-on')).toHaveLength(expectedOn)
    expect(wrapper.findAll('[data-on="true"]')).toHaveLength(expectedOn)
  })

  it('도트는 장식이므로 접근성 트리에서 제외된다', () => {
    const wrapper = mount(DotMatrix, { props: { pattern: COMPANION_01 } })
    expect(wrapper.get('.dot-matrix').attributes('aria-hidden')).toBe('true')
  })

  it('다른 크기의 패턴도 렌더링한다', () => {
    // M4 에서 테마별 캐릭터를 다른 크기로 정의할 수 있어야 한다.
    const wrapper = mount(DotMatrix, { props: { pattern: ['101', '010'] } })

    expect(wrapper.findAll('.dot')).toHaveLength(6)
    expect(wrapper.findAll('.dot.is-on')).toHaveLength(3)
    expect(wrapper.get('.dot-matrix').attributes('data-columns')).toBe('3')
  })

  it('패널에 레퍼런스의 라벨과 문구를 표시한다', () => {
    const wrapper = mount(MascotPanel)

    expect(wrapper.text()).toContain('COMPANION / 01')
    expect(wrapper.get('.mascot-message').text()).toBe('SIGNAL READY')
    expect(wrapper.get('.mascot-sub').text()).toBe('a little life inside your music')
  })

  it('15 · 16. 도트 색을 테마 토큰으로만 결정한다', () => {
    const renderer = readSource('src/features/mascot/DotMatrix.vue')

    // mono 는 단색, kawaii 는 민트. 색 리터럴이나 그라데이션을 쓰지 않는다.
    expect(renderer).toContain('background: var(--mascot-dot-color)')
    expect(renderer).not.toMatch(/gradient/)
    expect(renderer).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
  })

  it('15 · 16. 테마 토큰이 mono 단색·kawaii 민트로 정의되어 있다', () => {
    const mono = readSource('src/themes/mono-vinyl/tokens.css')
    const kawaii = readSource('src/themes/kawaii-synth-cassette/tokens.css')

    // jsdom 은 외부 CSS 계산을 하지 않는다. 값 존재만 확인하고
    // 실제 적용은 브라우저에서 검증한다.
    expect(mono).toContain('--mascot-dot-color: #ffffff')
    expect(kawaii).toContain('--mascot-dot-color: #a8ffe7')
    expect(mono).toContain('--mascot-screen-surface-color: #060707')
    expect(kawaii).toContain('--mascot-screen-surface-color: #092738')
  })

  it('패널 스타일도 테마 토큰으로만 결정한다', () => {
    const panel = readSource('src/features/mascot/MascotPanel.vue')
    const style = panel.slice(panel.indexOf('<style'))

    expect(style).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
    expect(style).toContain('var(--mascot-panel-background)')
    expect(style).toContain('var(--mascot-panel-border-color)')
  })

  it('정적 표시다 — 애니메이션을 구현하지 않았다 (M4)', () => {
    for (const file of [
      'src/features/mascot/MascotPanel.vue',
      'src/features/mascot/DotMatrix.vue',
    ]) {
      const style = readSource(file)
      expect(style).not.toContain('@keyframes')
      expect(style).not.toMatch(/^\s*animation:/m)
      expect(style).not.toContain('transition:')
    }
  })
})

describe('C. 마스코트와 테마 전환', () => {
  it('테마별 문구가 바뀐다', async () => {
    const wrapper = mount(MascotPanel)

    expect(wrapper.get('.mascot-message').text()).toBe('SIGNAL READY')

    await switchTheme('kawaii-synth-cassette')

    expect(wrapper.get('.mascot-message').text()).toBe('MIXTAPE READY')
    expect(wrapper.get('.mascot-sub').text()).toBe('a tiny melody from tomorrow')
  })

  it('17. 테마 변경 시 패턴 데이터가 변하지 않는다', async () => {
    const wrapper = mount(MascotPanel)
    const before = wrapper.findAll('[data-on="true"]').length
    const patternBefore = MASCOT_PATTERNS['mono-vinyl']

    await switchTheme('kawaii-synth-cassette')

    expect(wrapper.findAll('[data-on="true"]')).toHaveLength(before)
    expect(MASCOT_PATTERNS['kawaii-synth-cassette']).toBe(patternBefore)
    expect([...COMPANION_01]).toEqual(referencePattern())
  })

  it('18. 마스코트가 PlayerSurface DOM 에 영향을 주지 않는다', async () => {
    const { wrapper, fake } = mountAppWithFake()
    const surface = wrapper.get('[data-instance-id="player-main"]').element
    const mountHost = wrapper.get('.player-mount').element
    const adapterNode = fake.hostNode

    // 마스코트가 테마 전환으로 다시 렌더되어도 플레이어는 무관해야 한다.
    await switchTheme('kawaii-synth-cassette')
    await switchTheme('mono-vinyl')

    expect(wrapper.get('[data-instance-id="player-main"]').element).toBe(surface)
    expect(wrapper.get('.player-mount').element).toBe(mountHost)
    expect(fake.hostNode).toBe(adapterNode)
    expect(fake.calls.mount).toBe(1)
    expect(fake.calls.destroy).toBe(0)
  })

  it('마스코트 위젯이 테마 전환으로 재마운트되지 않는다', async () => {
    const { wrapper } = mountAppWithFake()
    const root = wrapper.get('[data-instance-id="mascot-main"]').element

    await switchTheme('kawaii-synth-cassette')

    expect(wrapper.get('[data-instance-id="mascot-main"]').element).toBe(root)
  })
})
