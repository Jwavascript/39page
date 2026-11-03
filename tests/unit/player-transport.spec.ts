/**
 * M3-3 — 트랜스포트 UI 와 재생 상태 표시.
 *
 * 앱 전체를 마운트하고 `FakePlayerAdapter` 를 주입한다. 큐는 드로어의
 * 재생 버튼으로 만든다 — 실제 사용자가 거치는 경로 그대로다.
 *
 * 버튼은 **store 를 비춘다.** 눌렀다고 모양을 먼저 바꾸지 않는다. 그래야
 * 빠른 연속 클릭이나 늦게 도착한 상태 이벤트에서 화면과 실제 재생이
 * 어긋나지 않는다.
 */
import { nextTick } from 'vue'

import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import App from '@/app/App.vue'
import { FakePlayerAdapter } from '@/features/playback/FakePlayerAdapter'
import { PLAYER_ADAPTER_FACTORY } from '@/features/playback/PlayerAdapter'
import { useLibraryStore } from '@/stores/library'
import { usePlaybackStore } from '@/stores/playback'
import { useThemeStore } from '@/stores/theme'

import { installPlayerRect, uninstallPlayerRect } from '../support/playerLayout'

const VIDEOS = ['aaaaaaaaaaa', 'bbbbbbbbbbb', 'ccccccccccc'] as const

beforeEach(() => {
  globalThis.localStorage.clear()
  delete document.documentElement.dataset.theme
  setActivePinia(createPinia())
  // jsdom 은 레이아웃이 없다. 가시성 가드가 막지 않도록 영역을 세운다 (M3-4).
  installPlayerRect()
})

afterEach(() => {
  uninstallPlayerRect()
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

type Wrapper = ReturnType<typeof mountApp>['wrapper']

const byText = (wrapper: Wrapper, selector: string, text: string) =>
  wrapper.findAll(selector).filter((node) => node.text() === text)[0]

/** 트랙 n 개짜리 목록 하나. 드로어는 열어둔다. */
async function setup(trackCount = 3) {
  const { wrapper, fake } = mountApp()
  const library = useLibraryStore()
  const playback = usePlaybackStore()

  const created = library.createPlaylist('MY RECORDS')
  const playlistId = created.ok ? created.playlistId : ''
  for (let index = 0; index < trackCount; index += 1) {
    library.addTrack(playlistId, {
      videoId: VIDEOS[index] ?? VIDEOS[0],
      title: `Track ${index + 1}`,
    })
  }

  await wrapper.get('.deck-open--mono-vinyl').trigger('click')
  await nextTick()

  return { wrapper, fake, library, playback, playlistId }
}

/** 드로어의 '목록 전체 재생' 으로 큐를 만든다. */
async function startPlaylist(wrapper: Wrapper) {
  await byText(wrapper, '.pill', '▶ 목록 전체 재생')?.trigger('click')
  await nextTick()
}

const controls = (wrapper: Wrapper) => wrapper.findAll('.round')
const previousButton = (wrapper: Wrapper) => controls(wrapper)[0]
const toggleButton = (wrapper: Wrapper) => controls(wrapper)[1]
const nextButton = (wrapper: Wrapper) => controls(wrapper)[2]

const isDisabled = (wrapper: Wrapper, index: number) =>
  controls(wrapper)[index]?.attributes('disabled') !== undefined

/** 세 버튼의 비활성 여부 — [이전, 토글, 다음]. */
const disabledFlags = (wrapper: Wrapper) => [0, 1, 2].map((index) => isDisabled(wrapper, index))

describe('A. 버튼 활성/비활성', () => {
  it('큐가 비어 있으면 셋 다 비활성이다', async () => {
    const { wrapper } = await setup()

    expect(controls(wrapper)).toHaveLength(3)
    expect(disabledFlags(wrapper)).toEqual([true, true, true])
  })

  it('첫 곡에서는 이전만 비활성이다', async () => {
    const { wrapper } = await setup()
    await startPlaylist(wrapper)

    expect(disabledFlags(wrapper)).toEqual([true, false, false])
  })

  it('가운데 곡에서는 셋 다 활성이다', async () => {
    const { wrapper } = await setup()
    await startPlaylist(wrapper)

    await nextButton(wrapper)?.trigger('click')
    await nextTick()

    expect(disabledFlags(wrapper)).toEqual([false, false, false])
  })

  it('마지막 곡에서는 다음만 비활성이다', async () => {
    const { wrapper, playback } = await setup()
    await startPlaylist(wrapper)

    for (let round = 0; round < 2; round += 1) {
      await nextButton(wrapper)?.trigger('click')
      await nextTick()
    }

    expect(playback.queueIndex).toBe(2)
    // 마지막 다음에 처음으로 돌아가지 않는다 (M3-0.1).
    expect(disabledFlags(wrapper)).toEqual([false, false, true])
  })

  it('트랙이 하나뿐이면 이전·다음이 모두 비활성이다', async () => {
    const { wrapper } = await setup(1)
    await startPlaylist(wrapper)

    expect(disabledFlags(wrapper)).toEqual([true, false, true])
  })
})

describe('B. 재생 / 일시정지 토글', () => {
  it('재생 중에는 ⏸ 를 보여주고 누르면 멈춘다', async () => {
    const { wrapper, fake } = await setup()
    await startPlaylist(wrapper)
    fake.emitStateChange('playing')
    await nextTick()

    expect(toggleButton(wrapper)?.text()).toBe('Ⅱ')
    expect(toggleButton(wrapper)?.attributes('aria-label')).toBe('일시정지')

    await toggleButton(wrapper)?.trigger('click')

    expect(fake.calls.pause).toBe(1)
    expect(fake.calls.play).toBe(0)
  })

  it('일시정지 중에는 ▶ 를 보여주고 누르면 재생한다', async () => {
    const { wrapper, fake } = await setup()
    await startPlaylist(wrapper)
    fake.emitStateChange('paused')
    await nextTick()

    expect(toggleButton(wrapper)?.text()).toBe('▶')
    expect(toggleButton(wrapper)?.attributes('aria-label')).toBe('재생')

    await toggleButton(wrapper)?.trigger('click')

    expect(fake.calls.play).toBe(1)
  })

  it('불러오는 중에도 ⏸ 를 보여주고 누르면 시작을 취소한다', async () => {
    const { wrapper, fake } = await setup()
    await startPlaylist(wrapper)
    fake.emitStateChange('loading')
    await nextTick()

    // ▶ 를 보여주면 또 누르게 되고 그 누름은 아무 일도 하지 않는다.
    expect(toggleButton(wrapper)?.text()).toBe('Ⅱ')

    await toggleButton(wrapper)?.trigger('click')

    expect(fake.calls.pause).toBe(1)
  })

  it('재생이 끝난 뒤 누르면 같은 트랙을 다시 재생한다', async () => {
    const { wrapper, fake, playback } = await setup(1)
    await startPlaylist(wrapper)
    fake.emitStateChange('playing')
    fake.emitStateChange('ended')
    await nextTick()

    expect(toggleButton(wrapper)?.text()).toBe('▶')
    await toggleButton(wrapper)?.trigger('click')

    expect(fake.calls.play).toBe(1)
    expect(playback.queueIndex).toBe(0)
    // 큐 끝 안내는 지워진다.
    expect(playback.statusMessage).toBe('')
  })

  it('오류 뒤에 누르면 같은 트랙을 다시 적재한다', async () => {
    const { wrapper, fake, playback } = await setup()
    await startPlaylist(wrapper)
    fake.emitError({ kind: 'not-playable', code: 5 })
    await nextTick()

    expect(toggleButton(wrapper)?.text()).toBe('▶')
    await toggleButton(wrapper)?.trigger('click')

    // 실패한 플레이어에 play() 를 보내면 아무 일도 일어나지 않는다.
    expect(fake.calls.play).toBe(0)
    expect(fake.calls.load).toEqual([
      { videoId: VIDEOS[0], autoplay: true },
      { videoId: VIDEOS[0], autoplay: true },
    ])
    expect(playback.statusMessage).toBe('')
    expect(playback.queueIndex).toBe(0)
  })

  it('대기 상태에서 누르면 재생한다', async () => {
    const { wrapper, fake } = await setup()
    await startPlaylist(wrapper)
    fake.emitStateChange('idle')
    await nextTick()

    await toggleButton(wrapper)?.trigger('click')

    expect(fake.calls.play).toBe(1)
  })

  it('큐가 없으면 눌러도 아무 명령이 가지 않는다', async () => {
    const { wrapper, fake } = await setup()

    await toggleButton(wrapper)?.trigger('click')
    await previousButton(wrapper)?.trigger('click')
    await nextButton(wrapper)?.trigger('click')

    expect(fake.calls).toMatchObject({ play: 0, pause: 0, load: [] })
  })
})

describe('C. 이전 / 다음', () => {
  it('다음은 인덱스를 올리고 새 트랙을 즉시 재생한다', async () => {
    const { wrapper, fake, playback } = await setup()
    await startPlaylist(wrapper)

    await nextButton(wrapper)?.trigger('click')
    await nextTick()

    expect(playback.queueIndex).toBe(1)
    expect(playback.currentTrack?.title).toBe('Track 2')
    expect(fake.calls.load).toEqual([
      { videoId: VIDEOS[0], autoplay: true },
      { videoId: VIDEOS[1], autoplay: true },
    ])
  })

  it('이전은 인덱스를 내린다', async () => {
    const { wrapper, fake, playback } = await setup()
    await startPlaylist(wrapper)
    await nextButton(wrapper)?.trigger('click')
    await nextTick()

    await previousButton(wrapper)?.trigger('click')
    await nextTick()

    expect(playback.queueIndex).toBe(0)
    expect(fake.calls.load).toHaveLength(3)
  })

  it('마지막 곡에서 다음을 눌러도 큐가 움직이지 않는다', async () => {
    const { wrapper, fake, playback } = await setup(2)
    await startPlaylist(wrapper)
    await nextButton(wrapper)?.trigger('click')
    await nextTick()
    const loadsBefore = fake.calls.load.length

    await nextButton(wrapper)?.trigger('click')
    await nextTick()

    expect(playback.queueIndex).toBe(1)
    expect(fake.calls.load).toHaveLength(loadsBefore)
  })

  it('첫 곡에서 이전을 눌러도 큐가 움직이지 않는다', async () => {
    const { wrapper, fake, playback } = await setup()
    await startPlaylist(wrapper)

    await previousButton(wrapper)?.trigger('click')
    await nextTick()

    expect(playback.queueIndex).toBe(0)
    expect(fake.calls.load).toHaveLength(1)
  })
})

describe('D. 현재 트랙과 상태 표시', () => {
  it('큐가 없으면 승인된 기본 문구를 보여준다', async () => {
    const { wrapper } = await setup()

    expect(wrapper.get('.eyebrow').text()).toBe('NOW PLAYING · YOUTUBE')
    expect(wrapper.get('.now-title').text()).toBe('재생할 음악을 선택하세요')
    expect(wrapper.get('.now-sub').text()).toBe('LP를 클릭하거나 링크를 추가할 수 있어요.')
    expect(wrapper.get('.status').text()).toBe('재생 목록을 만들고 YouTube 링크를 추가해 보세요.')
  })

  it('제목과 큐 위치와 상태를 보여준다', async () => {
    const { wrapper, fake } = await setup()
    await startPlaylist(wrapper)
    fake.emitStateChange('playing')
    await nextTick()

    expect(wrapper.get('.now-title').text()).toBe('Track 1')
    expect(wrapper.get('.now-sub').text()).toBe('1 / 3 · YOUTUBE · 재생 중')

    await nextButton(wrapper)?.trigger('click')
    fake.emitStateChange('paused')
    await nextTick()

    expect(wrapper.get('.now-title').text()).toBe('Track 2')
    expect(wrapper.get('.now-sub').text()).toBe('2 / 3 · YOUTUBE · 일시정지')
  })

  it('상태 영역이 라이브 리전이다', async () => {
    const { wrapper } = await setup()
    const status = wrapper.get('.status')

    expect(status.attributes('role')).toBe('status')
    expect(status.attributes('aria-live')).toBe('polite')
  })

  it('재생 중에는 라이브 리전을 비워 반복 알림을 막는다', async () => {
    const { wrapper, fake } = await setup()
    await startPlaylist(wrapper)

    // 상태가 네 번 바뀌어도 라이브 리전은 내내 비어 있다.
    const seen: string[] = []
    for (const state of ['loading', 'playing', 'paused', 'playing'] as const) {
      fake.emitStateChange(state)
      await nextTick()
      seen.push(wrapper.get('.status').text())
    }

    expect(seen).toEqual(['', '', '', ''])
  })

  it('오류는 경고 어조로 라이브 리전에 적는다', async () => {
    const { wrapper, fake } = await setup()
    await startPlaylist(wrapper)

    fake.emitError({ kind: 'embed-not-allowed', code: 101 })
    await nextTick()

    const status = wrapper.get('.status')
    expect(status.text()).toContain('오류 101')
    expect(status.classes()).toContain('is-warning')
    expect(wrapper.get('.now-sub').text()).toContain('재생 실패')
  })

  it('큐 끝 안내를 라이브 리전에 적는다', async () => {
    const { wrapper, fake } = await setup(1)
    await startPlaylist(wrapper)

    fake.emitStateChange('playing')
    fake.emitStateChange('ended')
    await nextTick()

    expect(wrapper.get('.status').text()).toBe('마지막 곡까지 재생했습니다.')
    expect(wrapper.get('.status').classes()).not.toContain('is-warning')
  })

  it('YouTube 컨트롤 안내를 유지한다', async () => {
    const { wrapper } = await setup()

    expect(wrapper.get('.mute-note').text()).toBe('YouTube 공식 영상·컨트롤은 그대로 표시됩니다.')
  })
})

describe('E. 빠른 연속 클릭과 늦은 이벤트', () => {
  it('다음을 연달아 눌러도 큐 끝을 넘지 않는다', async () => {
    const { wrapper, fake, playback } = await setup()
    await startPlaylist(wrapper)

    for (let round = 0; round < 5; round += 1) {
      await nextButton(wrapper)?.trigger('click')
      await nextTick()
    }

    expect(playback.queueIndex).toBe(2)
    // 처음 적재 1 + 전환 2 = 3. 경계에서 더 보내지 않는다.
    expect(fake.calls.load).toHaveLength(3)
  })

  it('토글을 연달아 눌러도 버튼이 store 를 그대로 비춘다', async () => {
    const { wrapper, fake } = await setup()
    await startPlaylist(wrapper)
    fake.emitStateChange('playing')
    await nextTick()

    // 상태 이벤트가 오기 전에 세 번 누른다.
    for (let round = 0; round < 3; round += 1) await toggleButton(wrapper)?.trigger('click')
    await nextTick()

    // 낙관적으로 모양을 바꾸지 않는다. 아직 playing 이므로 ⏸ 그대로다.
    expect(toggleButton(wrapper)?.text()).toBe('Ⅱ')
    expect(fake.calls.pause).toBe(3)

    // 실제 이벤트가 오면 그때 바뀐다.
    fake.emitStateChange('paused')
    await nextTick()
    expect(toggleButton(wrapper)?.text()).toBe('▶')
  })

  it('이전 트랙의 늦은 ENDED 가 표시를 흔들지 않는다', async () => {
    const { wrapper, fake, playback } = await setup()
    await startPlaylist(wrapper)
    fake.emitStateChange('playing')

    // 사용자가 다음을 누른다.
    await nextButton(wrapper)?.trigger('click')
    // 바꾸기 직전 트랙의 ENDED 가 뒤늦게 도착한다.
    fake.emitStateChange('ended')
    await nextTick()

    expect(playback.queueIndex).toBe(1)
    expect(wrapper.get('.now-title').text()).toBe('Track 2')
    expect(wrapper.get('.now-sub').text()).toContain('2 / 3')
    expect(fake.calls.load).toHaveLength(2)
  })
})

describe('F. 안정성 (ADR 0002)', () => {
  it('테마를 바꿔도 컨트롤과 재생 상태가 그대로다', async () => {
    const { wrapper, fake, playback } = await setup()
    await startPlaylist(wrapper)
    await nextButton(wrapper)?.trigger('click')
    fake.emitStateChange('playing')
    await nextTick()
    const before = disabledFlags(wrapper)
    const host = fake.hostNode

    for (const key of ['kawaii-synth-cassette', 'mono-vinyl'] as const) {
      useThemeStore().setTheme(key)
      await nextTick()
    }

    expect(disabledFlags(wrapper)).toEqual(before)
    expect(toggleButton(wrapper)?.text()).toBe('Ⅱ')
    expect(playback.queueIndex).toBe(1)
    expect(playback.playerState).toBe('playing')
    expect(fake.calls.mount).toBe(1)
    expect(fake.calls.destroy).toBe(0)
    expect(fake.hostNode).toBe(host)
  })

  it('드로어를 여닫아도 어댑터와 그 DOM 이 그대로다', async () => {
    const { wrapper, fake } = await setup()
    await startPlaylist(wrapper)
    const host = fake.hostNode
    const mountHost = wrapper.get('.player-mount').element

    for (let round = 0; round < 2; round += 1) {
      await wrapper.get('.drawer .close').trigger('click')
      await nextTick()
      await wrapper.get('.deck-open--mono-vinyl').trigger('click')
      await nextTick()
    }

    expect(fake.calls.mount).toBe(1)
    expect(fake.calls.destroy).toBe(0)
    expect(fake.hostNode).toBe(host)
    expect(wrapper.get('.player-mount').element).toBe(mountHost)
  })

  it('트랜스포트를 눌러도 어댑터를 다시 만들지 않는다', async () => {
    const { wrapper, fake } = await setup()
    await startPlaylist(wrapper)

    await nextButton(wrapper)?.trigger('click')
    await toggleButton(wrapper)?.trigger('click')
    await previousButton(wrapper)?.trigger('click')
    await nextTick()

    expect(fake.calls.mount).toBe(1)
    expect(fake.calls.destroy).toBe(0)
  })
})
