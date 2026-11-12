/**
 * M11-3 — 지금 곡 표시 (U14) · 데크 안내와 실제 동작 (U2 · U3).
 *
 * 라이브러리 화면은 playback store 를 보지 않고 코디네이터 계약의 읽기 전용 보기(`nowPlaying`)로만
 * 지금 곡을 안다 (ADR 0009).
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { nextTick } from 'vue'

import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import App from '@/app/App.vue'
import { createPlaybackCoordinator } from '@/features/playback/createPlaybackCoordinator'
import { FakePlayerAdapter } from '@/features/playback/FakePlayerAdapter'
import { PLAYER_ADAPTER_FACTORY } from '@/features/playback/PlayerAdapter'
import { STORAGE_KEYS } from '@/shared/storage'
import { useLibraryStore } from '@/stores/library'
import { usePlaybackStore } from '@/stores/playback'
import { useThemeStore } from '@/stores/theme'
import { THEMES } from '@/themes'

import { installPlayerRect, uninstallPlayerRect } from '../support/playerLayout'

const A = 'aaaaaaaaaaa'
const B = 'bbbbbbbbbbb'

function seed(): void {
  globalThis.localStorage.setItem(
    STORAGE_KEYS.library,
    JSON.stringify({
      version: 1,
      data: {
        playlists: [
          {
            id: 'one',
            name: 'ONE',
            tracks: [
              { id: 't-a', source: 'youtube', videoId: A, title: 'Alpha' },
              { id: 't-b', source: 'youtube', videoId: B, title: 'Bravo' },
            ],
          },
          {
            id: 'two',
            name: 'TWO',
            tracks: [{ id: 't-x', source: 'youtube', videoId: A, title: 'Again' }],
          },
        ],
        selectedPlaylistId: 'one',
      },
    }),
  )
}

function boot() {
  seed()
  setActivePinia(createPinia())
  useLibraryStore().restore()
  const fake = new FakePlayerAdapter()
  const wrapper = mount(App, {
    attachTo: document.body,
    global: { provide: { [PLAYER_ADAPTER_FACTORY as symbol]: () => fake } },
  })
  return { wrapper, fake, playback: usePlaybackStore() }
}

async function playOne(s: ReturnType<typeof boot>): Promise<void> {
  await s.wrapper.findAll('.playlist-tile .playlist-play')[0]?.trigger('click')
  await flushPromises()
  s.fake.emitReady()
  s.fake.emitStateChange('playing')
  await nextTick()
}

beforeEach(() => {
  globalThis.localStorage.clear()
  delete document.documentElement.dataset.theme
  installPlayerRect()
})

afterEach(() => {
  uninstallPlayerRect()
  globalThis.localStorage.clear()
  document.documentElement.style.overflow = ''
  document.body.innerHTML = ''
})

describe('A. 지금 곡 — 코디네이터의 읽기 전용 보기', () => {
  it('nowPlaying 은 큐의 지금 곡과 소리가 나는지를 알려 준다', () => {
    setActivePinia(createPinia())
    const coordinator = createPlaybackCoordinator()
    expect(coordinator.nowPlaying.value).toBeNull()

    usePlaybackStore().setQueue([{ id: 't-a', source: 'youtube', videoId: A, title: 'Alpha' }], 0)
    expect(coordinator.nowPlaying.value).toEqual({ trackId: 't-a', videoId: A, playing: false })

    usePlaybackStore().setPlayerState('playing')
    expect(coordinator.nowPlaying.value?.playing).toBe(true)
  })

  it('라이브러리 UI 는 playback store 를 보지 않는다 — 계약만 본다', () => {
    for (const file of [
      'src/features/library/PlaylistEditor.vue',
      'src/features/library/PlaylistWidget.vue',
      'src/features/library/TrackList.vue',
      'src/features/library/PlaylistTile.vue',
    ]) {
      const code = readFileSync(resolve(process.cwd(), file), 'utf8')
      expect({ file, store: code.includes('usePlaybackStore') }).toEqual({ file, store: false })
    }
  })
})

describe('B. 지금 곡이 목록에서 보인다 (U14)', () => {
  it('보관함의 트랙 행 — 테두리와 함께 "재생 중" 글 · aria-current', async () => {
    const s = boot()
    await playOne(s)
    await s.wrapper.findAll('.playlist-tile .playlist-open')[0]?.trigger('click')
    await flushPromises()

    const rows = s.wrapper.findAll('.track')
    expect(rows[0]?.classes()).toContain('is-current')
    expect(rows[0]?.attributes('aria-current')).toBe('true')
    expect(rows[0]?.get('.track-badge').text()).toBe('♪ 재생 중')
    expect(rows[1]?.attributes('aria-current')).toBeUndefined()
  })

  it('일시정지면 "지금 곡" 으로 적는다 — 소리가 나지 않을 때 "재생 중" 이라 하지 않는다', async () => {
    const s = boot()
    await playOne(s)
    s.fake.emitStateChange('paused')
    await nextTick()
    await s.wrapper.findAll('.playlist-tile .playlist-open')[0]?.trigger('click')
    await flushPromises()

    expect(s.wrapper.get('.track.is-current .track-badge').text()).toBe('지금 곡')
  })

  it('다음 곡으로 넘어가면 표시가 따라간다', async () => {
    const s = boot()
    await playOne(s)
    await s.wrapper.findAll('.playlist-tile .playlist-open')[0]?.trigger('click')
    await flushPromises()
    await s.wrapper.get('button[aria-label="다음 곡"]').trigger('click')
    await nextTick()

    const rows = s.wrapper.findAll('.track')
    expect(rows[0]?.classes()).not.toContain('is-current')
    expect(rows[1]?.classes()).toContain('is-current')
  })

  it('지금 곡이 든 플레이리스트 타일에 "재생 중" — 같은 영상의 다른 목록에는 붙지 않는다', async () => {
    const s = boot()
    await playOne(s)

    const tiles = s.wrapper.findAll('.playlist-tile')
    expect(tiles[0]?.classes()).toContain('is-playing')
    expect(tiles[0]?.get('.pmeta').text()).toContain('재생 중')
    expect(tiles[0]?.get('.playlist-open').attributes('aria-label')).toContain('재생 중')
    // TWO 에도 같은 영상(A)이 있지만, 큐의 곡은 ONE 의 트랙(t-a)이다.
    expect(tiles[1]?.classes()).not.toContain('is-playing')
  })
})

describe('C. 데크 — 안내 문구가 실제 동작과 같다 (U2 · U3)', () => {
  it('두 테마의 안내가 "보관함이 열린다" 를 말하고, 누르면 실제로 열린다', async () => {
    for (const key of ['mono-vinyl', 'kawaii-synth-cassette'] as const) {
      const deck = THEMES[key].deck
      expect(`${deck.hintRest} ${deck.openLabel}`).toContain('보관함')
      expect(`${deck.hintRest} ${deck.openLabel}`).not.toContain('펼쳐')
    }

    const s = boot()
    useThemeStore().setTheme('kawaii-synth-cassette')
    await nextTick()
    expect(s.wrapper.get('.deck-hint').text()).toContain('믹스테이프 보관함이 열려요')
    await s.wrapper.get('.deck-open--kawaii-synth-cassette').trigger('click')
    await flushPromises()
    expect(s.wrapper.get('#archive-panel').attributes('hidden')).toBeUndefined()
  })

  it('누르는 순간의 눌림 표현이 있고, 툴팁은 키보드 포커스 · 마우스가 있는 기기에서만 뜬다', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/features/deck/DeckWidget.vue'), 'utf8')
    const style = css.slice(css.indexOf('<style'))
    expect(style).toMatch(/\.deck-open:active \{/)
    expect(style).toMatch(/\.deck-open:focus-visible \.deck-open-hint \{/)
    expect(style).toMatch(/@media \(hover: hover\) \{\s*\.deck-open:hover \.deck-open-hint/)
    // 움직임을 줄인 사용자에게는 크기를 바꾸지 않는다.
    expect(style).toMatch(
      /@media \(prefers-reduced-motion: no-preference\)[\s\S]*?transform: scale/,
    )
  })

  it('빈 플레이어 안내가 두 테마와 실제 입구에 맞다', async () => {
    const s = boot()
    expect(s.wrapper.get('.now-sub').text()).toBe(
      'LP · 카세트나 ♪ 음악에서 곡을 고르거나 링크를 추가할 수 있어요.',
    )
  })
})
