import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { nextTick } from 'vue'

import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import App from '@/app/App.vue'
import { FakePlayerAdapter } from '@/features/playback/FakePlayerAdapter'
import { PLAYER_ADAPTER_FACTORY } from '@/features/playback/PlayerAdapter'
import type { Track } from '@/shared/types'
import { NO_QUEUE_INDEX, usePlaybackStore } from '@/stores/playback'
import { useThemeStore } from '@/stores/theme'

function readSource(relative: string): string {
  return readFileSync(resolve(process.cwd(), relative), 'utf8')
}

function track(id: string, videoId: string): Track {
  return { id, source: 'youtube', videoId, title: `Track ${id}` }
}

const TRACKS = [track('t1', 'dQw4w9WgXcQ'), track('t2', 'a_b-c1D2E3F'), track('t3', '___________')]

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

describe('Playback Store — 안전한 빈 기본값', () => {
  it('빈 상태로 시작한다', () => {
    const playback = usePlaybackStore()

    expect(playback.currentTrack).toBeNull()
    expect(playback.queue).toEqual([])
    expect(playback.queueIndex).toBe(NO_QUEUE_INDEX)
    expect(playback.playerState).toBe('idle')
    expect(playback.statusMessage).toBe('')
    expect(playback.statusTone).toBe('info')
    expect(playback.isEmpty).toBe(true)
  })
})

describe('Playback Store — 기본 불변조건', () => {
  it('currentTrack 은 항상 queue[queueIndex] 와 일치한다', () => {
    const playback = usePlaybackStore()

    playback.setQueue(TRACKS, 1)

    expect(playback.queueIndex).toBe(1)
    expect(playback.currentTrack).toEqual(TRACKS[1])
    expect(playback.queue[playback.queueIndex]).toEqual(playback.currentTrack)
  })

  it('범위를 벗어난 시작 인덱스를 큐 안으로 맞춘다', () => {
    const playback = usePlaybackStore()

    playback.setQueue(TRACKS, 99)
    expect(playback.queueIndex).toBe(TRACKS.length - 1)

    playback.setQueue(TRACKS, -5)
    expect(playback.queueIndex).toBe(0)
  })

  it('빈 큐에서는 인덱스가 NO_QUEUE_INDEX 이고 현재 트랙이 없다', () => {
    const playback = usePlaybackStore()

    playback.setQueue(TRACKS, 1)
    playback.setQueue([])

    expect(playback.queueIndex).toBe(NO_QUEUE_INDEX)
    expect(playback.currentTrack).toBeNull()
    expect(playback.isEmpty).toBe(true)
  })

  it('setQueueIndex 는 범위를 벗어난 값을 거부한다', () => {
    const playback = usePlaybackStore()
    playback.setQueue(TRACKS, 0)

    expect(playback.setQueueIndex(2)).toBe(true)
    expect(playback.currentTrack).toEqual(TRACKS[2])

    expect(playback.setQueueIndex(3)).toBe(false)
    expect(playback.setQueueIndex(-1)).toBe(false)
    // 거부된 호출은 상태를 바꾸지 않는다.
    expect(playback.queueIndex).toBe(2)
  })

  it('큐를 스냅샷으로 복사한다', () => {
    const playback = usePlaybackStore()
    const source = [...TRACKS]

    playback.setQueue(source, 0)
    source.push(track('t4', 'xxxxxxxxxxx'))

    // 원본을 바꿔도 큐가 흔들리지 않아야 한다.
    expect(playback.queue).toHaveLength(TRACKS.length)
  })

  it('reset 이 안전한 빈 상태로 되돌린다', () => {
    const playback = usePlaybackStore()
    playback.setQueue(TRACKS, 2)
    playback.setPlayerState('playing')
    playback.setStatus('재생 중', 'info')

    playback.reset()

    expect(playback.currentTrack).toBeNull()
    expect(playback.queue).toEqual([])
    expect(playback.queueIndex).toBe(NO_QUEUE_INDEX)
    expect(playback.playerState).toBe('idle')
    expect(playback.statusMessage).toBe('')
  })

  it('reset 이 재생 시작 표시도 되돌린다 (M9-4)', () => {
    const playback = usePlaybackStore()
    playback.setQueue(TRACKS, 0)
    playback.setHasStartedPlaying(true)

    playback.reset()

    // 이전 큐의 늦은 ENDED 와 이전 영상의 위치를 함께 막는다.
    expect(playback.hasStartedPlaying).toBe(false)
    expect(playback.isPositionReliable).toBe(false)
  })

  describe('위치 신뢰 판정 (M9-4)', () => {
    it('현재 트랙과 재생 시작이 모두 있어야 믿는다', () => {
      const playback = usePlaybackStore()

      expect(playback.isPositionReliable).toBe(false)

      playback.setQueue(TRACKS, 0)
      playback.setPlayerState('playing')
      // 명령 뒤 아직 playing 을 받지 않았다.
      expect(playback.isPositionReliable).toBe(false)

      playback.setHasStartedPlaying(true)
      expect(playback.isPositionReliable).toBe(true)
    })

    it.each(['playing', 'paused', 'loading', 'ended'] as const)(
      '재생이 시작된 뒤의 %s 는 믿는다',
      (state) => {
        const playback = usePlaybackStore()
        playback.setQueue(TRACKS, 0)
        playback.setHasStartedPlaying(true)
        playback.setPlayerState(state)

        expect(playback.isPositionReliable).toBe(true)
      },
    )

    it.each(['idle', 'error'] as const)('재생이 시작됐어도 %s 는 믿지 않는다', (state) => {
      const playback = usePlaybackStore()
      playback.setQueue(TRACKS, 0)
      playback.setHasStartedPlaying(true)
      playback.setPlayerState(state)

      expect(playback.isPositionReliable).toBe(false)
    })

    it('큐가 비면 믿지 않는다', () => {
      const playback = usePlaybackStore()
      playback.setQueue(TRACKS, 0)
      playback.setHasStartedPlaying(true)
      playback.setPlayerState('playing')

      playback.setQueue([], 0)

      expect(playback.isPositionReliable).toBe(false)
    })
  })

  it('상태 메시지의 어조를 구분한다', () => {
    const playback = usePlaybackStore()

    playback.setStatus('이 영상은 재생되지 않아요', 'warning')

    expect(playback.statusMessage).toBe('이 영상은 재생되지 않아요')
    expect(playback.statusTone).toBe('warning')
  })
})

describe('C. 테마 전환과 재생 상태의 독립성', () => {
  async function mountWithState() {
    const fake = new FakePlayerAdapter()
    const wrapper = mount(App, {
      attachTo: document.body,
      global: { provide: { [PLAYER_ADAPTER_FACTORY as symbol]: () => fake } },
    })
    const playback = usePlaybackStore()
    playback.setQueue(TRACKS, 1)
    playback.setPlayerState('playing')
    playback.setStatus('재생 중', 'info')
    await nextTick()
    return { wrapper, fake, playback }
  }

  it('11. 테마 변경 전후 현재 트랙이 동일하다', async () => {
    const { playback } = await mountWithState()
    const before = playback.currentTrack

    useThemeStore().setTheme('kawaii-synth-cassette')
    await nextTick()

    expect(playback.currentTrack).toEqual(before)
    expect(playback.currentTrack).toEqual(TRACKS[1])
  })

  it('12. 테마 변경 전후 큐와 인덱스가 동일하다', async () => {
    const { playback } = await mountWithState()
    const queueBefore = [...playback.queue]
    const indexBefore = playback.queueIndex

    for (const key of ['kawaii-synth-cassette', 'mono-vinyl', 'kawaii-synth-cassette'] as const) {
      useThemeStore().setTheme(key)
      await nextTick()
    }

    expect(playback.queue).toEqual(queueBefore)
    expect(playback.queueIndex).toBe(indexBefore)
  })

  it('13. 테마 변경 전후 PlayerState 가 동일하다', async () => {
    const { playback } = await mountWithState()

    useThemeStore().setTheme('kawaii-synth-cassette')
    await nextTick()

    expect(playback.playerState).toBe('playing')
    expect(playback.statusMessage).toBe('재생 중')
  })

  it('테마 전환이 어댑터 호출을 유발하지 않는다', async () => {
    const { fake } = await mountWithState()
    const before = { ...fake.calls, load: [...fake.calls.load] }

    useThemeStore().setTheme('kawaii-synth-cassette')
    await nextTick()

    expect(fake.calls.mount).toBe(before.mount)
    expect(fake.calls.destroy).toBe(before.destroy)
    expect(fake.calls.play).toBe(before.play)
    expect(fake.calls.pause).toBe(before.pause)
    expect(fake.calls.load).toEqual(before.load)
  })
})

describe('14. Store 분리', () => {
  it('theme store 가 playback store 를 import 하지 않는다', () => {
    const source = readSource('src/stores/theme.ts')

    expect(source).not.toContain('playback')
    expect(source).not.toContain('usePlaybackStore')
  })

  it('playback store 가 theme store 를 import 하지 않는다', () => {
    const source = readSource('src/stores/playback.ts')

    expect(source).not.toContain('useThemeStore')
    expect(source).not.toContain('ThemeKey')
    expect(source).not.toContain("from '@/themes'")
  })

  it('playback store 가 어댑터나 DOM 노드를 state 에 두지 않는다', () => {
    const code = readSource('src/stores/playback.ts')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '')

    // 어댑터 인스턴스·DOM 을 반응형 state 에 넣으면 플레이어가 끌려들어간다.
    expect(code).not.toContain('PlayerAdapter')
    expect(code).not.toContain('HTMLElement')
    expect(code).not.toContain('document')
  })

  it('PlayerSurface 가 어댑터를 반응형 state 에 두지 않는다', () => {
    const code = readSource('src/features/playback/PlayerSurface.vue')
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '')

    // ref/reactive 가 아니라 평범한 지역 변수여야 한다.
    expect(code).toMatch(/let adapter: PlayerAdapter \| null = null/)
    expect(code).not.toMatch(/ref<PlayerAdapter/)
    expect(code).not.toMatch(/reactive\(/)
  })

  it('PlayerSurface 가 금지 패턴을 쓰지 않는다', () => {
    const source = readSource('src/features/playback/PlayerSurface.vue')
    const template = source.slice(source.indexOf('<template>'), source.indexOf('</template>'))
    const code = template.replace(/<!--[\s\S]*?-->/g, '')

    expect(code).not.toContain('Teleport')
    expect(code).not.toContain('v-if')
    expect(code).not.toContain(':key')
    expect(code).not.toContain('useThemeStore')
  })
})
