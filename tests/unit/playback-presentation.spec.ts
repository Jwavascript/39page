/**
 * M4-3 · M4-4 · M4-5 — 데크와 마스코트가 재생 상태에 반응한다.
 *
 *   A. 기분 매핑과 패턴 — 순수 함수
 *   B. 마스코트 컴포넌트
 *   C. 데크 컴포넌트
 *   D. 모션 감소
 *   E. 경계 — 테마 UI 는 플레이어를 직접 부르지 않는다
 *
 * 연출이 **실제 재생 상태**만 따라가는지 본다. 멈춘 데크가 도는 일,
 * 울리지 않는데 호흡하는 일이 없어야 한다 (`AGENTS.md` 규칙 9의 정신).
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { nextTick } from 'vue'

import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import App from '@/app/App.vue'
import DeckWidget from '@/features/deck/DeckWidget.vue'
import MascotPanel from '@/features/mascot/MascotPanel.vue'
import {
  mascotMessage,
  mascotPattern,
  moodFromPlayerState,
  type MascotMood,
} from '@/features/mascot/moods'
import { COMPANION_01, COMPANION_01_ALERT, COMPANION_01_RESTING } from '@/features/mascot/patterns'
import { FakePlayerAdapter } from '@/features/playback/FakePlayerAdapter'
import { PLAYER_ADAPTER_FACTORY } from '@/features/playback/PlayerAdapter'
import type { PlayerState, ThemeKey } from '@/shared/types'
import { usePlaybackStore } from '@/stores/playback'
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

/** 몇 행이 서로 다른지. 파생 관계를 수치로 증명한다. */
function changedRows(a: readonly string[], b: readonly string[]): number {
  expect(a).toHaveLength(b.length)
  return a.filter((row, index) => row !== b[index]).length
}

describe('A. 기분 매핑과 패턴', () => {
  it.each<[PlayerState, MascotMood]>([
    ['idle', 'idle'],
    ['loading', 'idle'],
    ['ended', 'idle'],
    ['playing', 'playing'],
    ['paused', 'paused'],
    ['error', 'error'],
  ])('%s → %s', (state, mood) => {
    expect(moodFromPlayerState(state)).toBe(mood)
  })

  it('loading 을 playing 으로 보지 않는다', () => {
    // 소리가 나지 않는데 호흡 애니메이션이 돌면 재생 중으로 보인다.
    expect(moodFromPlayerState('loading')).not.toBe('playing')
  })

  it('재생 중에는 승인된 패턴을 그대로 쓴다', () => {
    // 승인된 디자인은 같은 패턴에 호흡 애니메이션을 얹는 방식이다.
    for (const theme of ['mono-vinyl', 'kawaii-synth-cassette'] as ThemeKey[]) {
      expect(mascotPattern(theme, 'playing')).toEqual(COMPANION_01)
      expect(mascotPattern(theme, 'idle')).toEqual(COMPANION_01)
    }
  })

  it('멈춤과 오류에는 다른 표정을 쓴다', () => {
    expect(mascotPattern('mono-vinyl', 'paused')).toEqual(COMPANION_01_RESTING)
    expect(mascotPattern('mono-vinyl', 'error')).toEqual(COMPANION_01_ALERT)
  })

  it('표정 변형은 두 테마가 공유한다', () => {
    expect(mascotPattern('mono-vinyl', 'paused')).toEqual(
      mascotPattern('kawaii-synth-cassette', 'paused'),
    )
  })

  it('쉬는 표정은 승인된 패턴에서 두 행만 다르다', () => {
    // 같은 캐릭터의 다른 표정이어야 한다. 몸과 윤곽은 그대로다.
    expect(changedRows(COMPANION_01_RESTING, COMPANION_01)).toBe(2)
  })

  it('놀란 표정은 승인된 패턴에서 한 행만 다르다', () => {
    expect(changedRows(COMPANION_01_ALERT, COMPANION_01)).toBe(1)
  })

  it('변형도 16×12 이고 0 과 1 만 쓴다', () => {
    for (const pattern of [COMPANION_01_RESTING, COMPANION_01_ALERT]) {
      expect(pattern).toHaveLength(12)
      for (const row of pattern) {
        expect(row).toHaveLength(16)
        expect(row).toMatch(/^[01]+$/)
      }
    }
  })

  it('대기 문구는 승인된 값을 그대로 쓴다', () => {
    expect(mascotMessage('mono-vinyl', 'idle', 'SIGNAL READY')).toBe('SIGNAL READY')
    expect(mascotMessage('kawaii-synth-cassette', 'idle', 'MIXTAPE READY')).toBe('MIXTAPE READY')
  })

  it('기분별 문구가 테마마다 다르다', () => {
    for (const mood of ['playing', 'paused', 'error'] as MascotMood[]) {
      const mono = mascotMessage('mono-vinyl', mood, 'FALLBACK')
      const kawaii = mascotMessage('kawaii-synth-cassette', mood, 'FALLBACK')

      expect(mono).not.toBe('FALLBACK')
      expect(kawaii).not.toBe('FALLBACK')
      expect(mono).not.toBe(kawaii)
    }
  })
})

describe('B. 마스코트 컴포넌트', () => {
  it('재생 중에만 is-playing 이 붙는다', async () => {
    const playback = usePlaybackStore()
    const wrapper = mount(MascotPanel)

    expect(wrapper.get('.mascot-panel').classes()).not.toContain('is-playing')

    playback.setPlayerState('playing')
    await nextTick()
    expect(wrapper.get('.mascot-panel').classes()).toContain('is-playing')

    playback.setPlayerState('paused')
    await nextTick()
    expect(wrapper.get('.mascot-panel').classes()).not.toContain('is-playing')
  })

  it('불러오는 중에는 호흡하지 않는다', async () => {
    const playback = usePlaybackStore()
    const wrapper = mount(MascotPanel)

    playback.setPlayerState('loading')
    await nextTick()

    expect(wrapper.get('.mascot-panel').classes()).not.toContain('is-playing')
  })

  it('기분을 속성으로 드러낸다', async () => {
    const playback = usePlaybackStore()
    const wrapper = mount(MascotPanel)

    expect(wrapper.get('.mascot-panel').attributes('data-mood')).toBe('idle')

    playback.setPlayerState('error')
    await nextTick()

    expect(wrapper.get('.mascot-panel').attributes('data-mood')).toBe('error')
  })

  it('상태에 따라 문구가 바뀐다', async () => {
    const playback = usePlaybackStore()
    const wrapper = mount(MascotPanel)

    expect(wrapper.get('.mascot-message').text()).toBe('SIGNAL READY')

    playback.setPlayerState('playing')
    await nextTick()
    expect(wrapper.get('.mascot-message').text()).toBe('NOW SPINNING')

    playback.setPlayerState('error')
    await nextTick()
    expect(wrapper.get('.mascot-message').text()).toBe('SIGNAL LOST')
  })

  it('재생 중에 테마를 바꾸면 그 테마의 문구가 된다', async () => {
    const playback = usePlaybackStore()
    const theme = useThemeStore()
    const wrapper = mount(MascotPanel)

    playback.setPlayerState('playing')
    await nextTick()
    expect(wrapper.get('.mascot-message').text()).toBe('NOW SPINNING')

    theme.setTheme('kawaii-synth-cassette')
    await nextTick()

    expect(wrapper.get('.mascot-message').text()).toBe('TAPE ROLLING')
    // 테마 전환이 재생 상태를 건드리지 않는다 (규칙 5).
    expect(playback.playerState).toBe('playing')
  })

  it('표정이 바뀌어도 도트 개수는 그대로다', async () => {
    const playback = usePlaybackStore()
    const wrapper = mount(MascotPanel)
    const before = wrapper.findAll('.dot').length

    playback.setPlayerState('paused')
    await nextTick()

    expect(wrapper.findAll('.dot')).toHaveLength(before)
    expect(before).toBe(192)
  })

  it('보조 문구는 테마 값을 그대로 유지한다', async () => {
    const playback = usePlaybackStore()
    const wrapper = mount(MascotPanel)

    playback.setPlayerState('playing')
    await nextTick()

    // 상태마다 보조 문구까지 바꾸지 않는다. 승인된 값이다.
    expect(wrapper.get('.mascot-sub').text()).toBe('a little life inside your music')
  })
})

describe('C. 데크 컴포넌트', () => {
  it('재생 중에 is-playing 이 붙는다', async () => {
    const playback = usePlaybackStore()
    const wrapper = mount(DeckWidget)

    expect(wrapper.get('.deck-widget').classes()).not.toContain('is-playing')

    playback.setPlayerState('playing')
    await nextTick()

    expect(wrapper.get('.deck-widget').classes()).toContain('is-playing')
    expect(wrapper.get('.deck-widget').classes()).not.toContain('is-paused')
  })

  it('멈추면 is-paused 만 남는다 — 톤암은 내려와 있다', async () => {
    const playback = usePlaybackStore()
    const wrapper = mount(DeckWidget)

    playback.setPlayerState('paused')
    await nextTick()

    expect(wrapper.get('.deck-widget').classes()).toContain('is-paused')
    expect(wrapper.get('.deck-widget').classes()).not.toContain('is-playing')
  })

  it.each<PlayerState>(['idle', 'loading', 'ended', 'error'])(
    '%s 에서는 둘 다 붙지 않는다',
    async (state) => {
      const playback = usePlaybackStore()
      const wrapper = mount(DeckWidget)

      playback.setPlayerState(state)
      await nextTick()

      const classes = wrapper.get('.deck-widget').classes()
      expect(classes).not.toContain('is-playing')
      expect(classes).not.toContain('is-paused')
    },
  )

  it('테마를 바꿔도 연출 클래스가 유지된다', async () => {
    const playback = usePlaybackStore()
    const theme = useThemeStore()
    const wrapper = mount(DeckWidget)

    playback.setPlayerState('playing')
    await nextTick()
    theme.setTheme('kawaii-synth-cassette')
    await nextTick()

    expect(wrapper.get('.deck-widget').classes()).toContain('is-playing')
  })

  it('연출이 PlayerSurface 를 재생성하지 않는다', async () => {
    const fake = new FakePlayerAdapter()
    const wrapper = mount(App, {
      attachTo: document.body,
      global: { provide: { [PLAYER_ADAPTER_FACTORY as symbol]: () => fake } },
    })
    const playback = usePlaybackStore()
    const host = fake.hostNode
    const mountNode = wrapper.get('.player-mount').element

    for (const state of ['playing', 'paused', 'playing', 'error', 'idle'] as PlayerState[]) {
      playback.setPlayerState(state)
      await nextTick()
    }

    expect(fake.calls.mount).toBe(1)
    expect(fake.calls.destroy).toBe(0)
    expect(fake.hostNode).toBe(host)
    expect(wrapper.get('.player-mount').element).toBe(mountNode)
  })
})

describe('D. 모션 감소', () => {
  it('모션 감소에서 토큰이 0s 가 된다', () => {
    const base = readSource('src/styles/base.css')

    expect(base).toContain('@media (prefers-reduced-motion: reduce)')
    for (const token of [
      '--duration-spin-33',
      '--duration-spool',
      '--duration-breath',
      '--duration-tonearm',
    ]) {
      expect(base).toMatch(new RegExp(`${token}:\\s*0s`))
    }
  })

  it('토큰을 거치지 않는 애니메이션까지 막는 안전망이 있다', () => {
    const base = readSource('src/styles/base.css')

    expect(base).toContain('animation-duration: 0.01ms !important')
    expect(base).toContain('animation-iteration-count: 1 !important')
    expect(base).toContain('transition-duration: 0.01ms !important')
  })

  it('연출 애니메이션이 전부 모션 토큰을 쓴다', () => {
    for (const file of [
      'src/themes/mono-vinyl/deck.css',
      'src/themes/kawaii-synth-cassette/deck.css',
      'src/features/mascot/MascotPanel.vue',
    ]) {
      const css = readSource(file)
      const declarations = [...css.matchAll(/animation:\s*([^;]+);/g)].map((match) => match[1])

      expect(declarations.length).toBeGreaterThan(0)
      for (const declaration of declarations) {
        expect(declaration).toContain('var(--duration-')
      }
    }
  })
})

describe('E. 경계', () => {
  it('데크와 마스코트가 플레이어를 직접 부르지 않는다', () => {
    for (const file of [
      'src/features/deck/DeckWidget.vue',
      'src/features/mascot/MascotPanel.vue',
    ]) {
      const source = readSource(file)

      // 테마 UI 는 store 로만 재생과 통신한다 (규칙 4).
      expect(source).not.toContain('PlayerAdapter')
      expect(source).not.toContain('playbackCoordinator')
      expect(source).not.toContain('YouTube')
      expect(source).toContain('usePlaybackStore')
    }
  })

  it('데크·마스코트가 재생 상태를 쓰지 않는다 — 읽기만 한다', () => {
    for (const file of [
      'src/features/deck/DeckWidget.vue',
      'src/features/mascot/MascotPanel.vue',
    ]) {
      const source = readSource(file)

      expect(source).not.toContain('setPlayerState')
      expect(source).not.toContain('setQueue')
      expect(source).not.toContain('setStatus')
    }
  })

  it('WidgetHost 와 DashboardShell 은 연출을 모른다', () => {
    for (const file of [
      'src/components/layout/WidgetHost.vue',
      'src/components/layout/DashboardShell.vue',
    ]) {
      const source = readSource(file)

      expect(source).not.toContain('is-playing')
      expect(source).not.toContain('isPlaying')
    }
  })
})
