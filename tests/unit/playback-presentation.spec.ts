/**
 * M4-3 · M4-4 · M4-5 — 데크가 재생 상태에 반응한다. M12-2 에서 마스코트가 빠지고 그 자리를 앨범아트가 쓴다.
 *
 *   A. 기본 앨범아트 (마스코트 도트 화면을 이었다)
 *   B. 앨범아트 표시 — 썸네일 → 기본
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
import ArtworkImage from '@/features/artwork/ArtworkImage.vue'
import DefaultArtwork from '@/features/artwork/DefaultArtwork.vue'
import { CASSETTE_DOTS, patternSize } from '@/features/artwork/dotPatterns'
import { youtubeThumbnailUrl } from '@/features/artwork/youtubeThumbnail'
import { FakePlayerAdapter } from '@/features/playback/FakePlayerAdapter'
import { PLAYER_ADAPTER_FACTORY } from '@/features/playback/PlayerAdapter'
import type { PlayerState } from '@/shared/types'
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

describe('A. 기본 앨범아트 (M12-2 — 마스코트 자리)', () => {
  it('카세트 도트 패턴은 16×12 이고 0 과 1 만 쓴다', () => {
    expect(patternSize(CASSETTE_DOTS)).toEqual({ columns: 16, rows: 12 })
    for (const row of CASSETTE_DOTS) expect(row).toMatch(/^[01]{16}$/)
  })

  it('두 테마의 기본 그림이 함께 마운트되고, 글자는 마스코트의 승인된 문구를 잇는다', () => {
    const wrapper = mount(DefaultArtwork)

    expect(wrapper.find('.default-artwork__face--cassette .dot-matrix').exists()).toBe(true)
    expect(wrapper.find('.default-artwork__face--vinyl svg').exists()).toBe(true)
    expect(wrapper.get('.default-artwork__face--cassette .default-artwork__label').text()).toBe(
      'MIXTAPE READY',
    )
    expect(wrapper.get('.default-artwork__face--vinyl .default-artwork__label').text()).toBe(
      'SIGNAL READY',
    )
    // 장식이다 — 옆의 곡 제목이 뜻을 전한다.
    expect(wrapper.get('.default-artwork').attributes('aria-hidden')).toBe('true')
  })

  it('테마 전환은 CSS 로 고른다 — 컴포넌트에 테마 분기가 없다 (ADR 0001)', () => {
    const source = readSource('src/features/artwork/DefaultArtwork.vue')

    expect(source).toContain(":root[data-theme='mono-vinyl'] .default-artwork__face--cassette")
    expect(source).not.toContain('useThemeStore')
    expect(source).not.toMatch(/v-if=/)
  })
})

describe('B. 앨범아트 표시 — 썸네일 → 기본 (M12-2)', () => {
  it('곡이 없으면 기본 그림만 — 썸네일을 요청하지 않는다', () => {
    const wrapper = mount(ArtworkImage, { props: { videoId: null } })

    expect(wrapper.find('img').exists()).toBe(false)
    expect(wrapper.get('.artwork-image').attributes('data-artwork-source')).toBe('default')
  })

  it('곡이 있으면 hqdefault 썸네일을 이 페이지 주소 없이 요청한다', () => {
    const wrapper = mount(ArtworkImage, { props: { videoId: 'aqz-KE-bpKQ' } })
    const img = wrapper.get('img')

    expect(img.attributes('src')).toBe('https://i.ytimg.com/vi/aqz-KE-bpKQ/hqdefault.jpg')
    expect(img.attributes('referrerpolicy')).toBe('no-referrer')
    expect(img.attributes('alt')).toBe('')
    // 받기 전에는 기본 그림이 아래에 보인다.
    expect(wrapper.get('.artwork-image').attributes('data-artwork-source')).toBe('loading')
    expect(wrapper.find('.default-artwork').exists()).toBe(true)
  })

  it('다 받으면 썸네일이 보인다', async () => {
    const wrapper = mount(ArtworkImage, { props: { videoId: 'aqz-KE-bpKQ' } })
    const img = wrapper.get('img')
    Object.defineProperty(img.element, 'naturalWidth', { value: 480 })
    Object.defineProperty(img.element, 'naturalHeight', { value: 360 })
    await img.trigger('load')

    expect(wrapper.get('.artwork-image').attributes('data-artwork-source')).toBe('thumbnail')
    expect(wrapper.get('img').classes()).toContain('is-loaded')
  })

  it('받지 못하면(오프라인 · 차단) 기본 그림으로 남고 다시 요청하지 않는다', async () => {
    const wrapper = mount(ArtworkImage, { props: { videoId: 'aqz-KE-bpKQ' } })
    await wrapper.get('img').trigger('error')

    expect(wrapper.find('img').exists()).toBe(false)
    expect(wrapper.get('.artwork-image').attributes('data-artwork-source')).toBe('default')
  })

  it('YouTube 의 "없음" 그림(120×90 — 삭제 · 비공개 영상)은 기본 그림으로 바꾼다', async () => {
    const wrapper = mount(ArtworkImage, { props: { videoId: 'aqz-KE-bpKQ' } })
    const img = wrapper.get('img')
    Object.defineProperty(img.element, 'naturalWidth', { value: 120 })
    Object.defineProperty(img.element, 'naturalHeight', { value: 90 })
    await img.trigger('load')

    expect(wrapper.get('.artwork-image').attributes('data-artwork-source')).toBe('default')
  })

  it('곡이 바뀌면 새 썸네일을 다시 판단한다 — 이전 곡의 실패가 남지 않는다', async () => {
    const wrapper = mount(ArtworkImage, { props: { videoId: 'aqz-KE-bpKQ' } })
    await wrapper.get('img').trigger('error')
    await wrapper.setProps({ videoId: 'eRsGyueVLvQ' })

    expect(wrapper.get('img').attributes('src')).toContain('/eRsGyueVLvQ/')
    expect(wrapper.get('.artwork-image').attributes('data-artwork-source')).toBe('loading')
  })

  it('"기본 그림" 을 고르면 썸네일을 요청하지 않는다', () => {
    const wrapper = mount(ArtworkImage, { props: { videoId: 'aqz-KE-bpKQ', mode: 'default' } })

    expect(wrapper.find('img').exists()).toBe(false)
    expect(wrapper.get('.artwork-image').attributes('data-artwork-source')).toBe('default')
  })

  it('형식에 맞지 않는 영상 id 로는 주소를 만들지 않는다', () => {
    expect(youtubeThumbnailUrl('not a video id')).toBeNull()
    expect(youtubeThumbnailUrl('../../evil')).toBeNull()
    expect(youtubeThumbnailUrl(undefined)).toBeNull()
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
    theme.setTheme('mono-vinyl')
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
  it('데크가 플레이어를 직접 부르지 않는다', () => {
    for (const file of ['src/features/deck/DeckWidget.vue']) {
      const source = readSource(file)

      // 테마 UI 는 store 로만 재생과 통신한다 (규칙 4).
      expect(source).not.toContain('PlayerAdapter')
      expect(source).not.toContain('playbackCoordinator')
      expect(source).not.toContain('YouTube')
      expect(source).toContain('usePlaybackStore')
    }
  })

  it('데크 · 앨범아트가 재생 상태를 쓰지 않는다 — 읽기만 한다', () => {
    for (const file of [
      'src/features/deck/DeckWidget.vue',
      'src/features/artwork/ArtworkImage.vue',
      'src/features/artwork/DefaultArtwork.vue',
    ]) {
      const source = readSource(file)

      expect(source).not.toContain('setPlayerState')
      expect(source).not.toContain('setQueue')
      expect(source).not.toContain('setStatus')
    }
  })

  it('앨범아트는 플레이어 · YouTube API 를 부르지 않는다 — 썸네일 주소만 만든다', () => {
    for (const file of [
      'src/features/artwork/ArtworkImage.vue',
      'src/features/artwork/DefaultArtwork.vue',
      'src/features/artwork/youtubeThumbnail.ts',
    ]) {
      const source = readSource(file)
      expect(source).not.toContain('PlayerAdapter')
      expect(source).not.toContain('playbackCoordinator')
      expect(source).not.toContain('YT.')
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
