/**
 * M3-2 — Record Library 에서 실제 어댑터까지의 재생 흐름.
 *
 * 앱 전체를 마운트하고 **실제 `YouTubeIFramePlayerAdapter`** 를 주입한다.
 * `window.YT` 만 가짜로 세운다. 실제 네트워크에 접속하지 않는다.
 *
 * 코디네이터 단위 테스트(`playback-coordinator.spec.ts`)가 덮지 못하는 것을
 * 본다: 드로어 버튼 → 코디네이터 → 어댑터 → `YT.Player` 까지 실제로 이어지는지,
 * 그리고 그 사이에 DOM 안정성이 깨지지 않는지.
 */
import { nextTick } from 'vue'

import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import App from '@/app/App.vue'
import { PLAYER_ADAPTER_FACTORY } from '@/features/playback/PlayerAdapter'
import { YouTubeIFramePlayerAdapter } from '@/features/playback/YouTubeIFramePlayerAdapter'
import type { YouTubePlayer, YouTubePlayerOptions } from '@/features/playback/youtubeIframeApi'
import { useLibraryStore } from '@/stores/library'
import { usePlaybackStore } from '@/stores/playback'
import { useThemeStore } from '@/stores/theme'

import { installPlayerRect, uninstallPlayerRect } from '../support/playerLayout'

const VIDEOS = ['aaaaaaaaaaa', 'bbbbbbbbbbb', 'ccccccccccc'] as const

/** 가짜 `YT.Player`. 실제 API 처럼 넘겨받은 요소를 iframe 으로 교체한다. */
class FakeYtPlayer implements YouTubePlayer {
  static instances: FakeYtPlayer[] = []

  readonly options: YouTubePlayerOptions
  readonly iframe: HTMLElement
  readonly loadCalls: string[] = []
  readonly cueCalls: string[] = []
  playCalls = 0
  pauseCalls = 0
  destroyCalls = 0

  constructor(host: HTMLElement, options: YouTubePlayerOptions) {
    this.options = options
    FakeYtPlayer.instances.push(this)

    const iframe = host.ownerDocument.createElement('iframe')
    host.replaceWith(iframe)
    this.iframe = iframe
  }

  loadVideoById(videoId: string): void {
    this.loadCalls.push(videoId)
  }

  cueVideoById(videoId: string): void {
    this.cueCalls.push(videoId)
  }

  playVideo(): void {
    this.playCalls += 1
  }

  pauseVideo(): void {
    this.pauseCalls += 1
  }

  destroy(): void {
    this.destroyCalls += 1
    this.iframe.remove()
  }

  fireReady(): void {
    this.options.events?.onReady?.({ target: this })
  }

  fireStateChange(data: number): void {
    this.options.events?.onStateChange?.({ target: this, data })
  }

  fireError(data: number): void {
    this.options.events?.onError?.({ target: this, data })
  }
}

/** YouTube 숫자 상태값. */
const ENDED = 0
const PLAYING = 1

function flush(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0)
  })
}

beforeEach(() => {
  globalThis.localStorage.clear()
  delete document.documentElement.dataset.theme
  document.head.innerHTML = ''
  FakeYtPlayer.instances = []
  // API 가 이미 와 있는 상태에서 시작한다. 준비 전 요청은 별도 spec 에서 본다.
  window.YT = { Player: FakeYtPlayer }
  setActivePinia(createPinia())
  // jsdom 은 레이아웃이 없다. 가시성 가드가 막지 않도록 영역을 세운다 (M3-4).
  installPlayerRect()
})

afterEach(() => {
  uninstallPlayerRect()
  globalThis.localStorage.clear()
  delete document.documentElement.dataset.theme
  document.body.innerHTML = ''
  document.head.innerHTML = ''
  delete window.YT
  delete window.onYouTubeIframeAPIReady
})

function mountApp() {
  return mount(App, {
    attachTo: document.body,
    global: {
      provide: { [PLAYER_ADAPTER_FACTORY as symbol]: () => new YouTubeIFramePlayerAdapter() },
    },
  })
}

type Wrapper = ReturnType<typeof mountApp>

const byText = (wrapper: Wrapper, selector: string, text: string) =>
  wrapper.findAll(selector).filter((node) => node.text() === text)[0]

/** 트랙 3개짜리 목록 하나와, 열린 드로어. */
async function setup(trackCount = 3) {
  const wrapper = mountApp()
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

  return { wrapper, library, playback, playlistId }
}

function player(): FakeYtPlayer {
  const instance = FakeYtPlayer.instances[FakeYtPlayer.instances.length - 1]
  if (instance === undefined) throw new Error('YT.Player 가 만들어지지 않았다')
  return instance
}

/** 목록 전체 재생 → 플레이어 생성 → onReady 까지. */
async function startPlaylist(wrapper: Wrapper) {
  await byText(wrapper, '.pill', '▶ 목록 전체 재생')?.trigger('click')
  await flush()
  player().fireReady()
  await nextTick()
}

describe('A. 드로어에서 재생 시작', () => {
  it('목록 전체 재생이 큐를 만들고 첫 곡을 적재한다', async () => {
    const { wrapper, playback } = await setup()

    await startPlaylist(wrapper)

    expect(playback.queue.map((track) => track.title)).toEqual(['Track 1', 'Track 2', 'Track 3'])
    expect(playback.queueIndex).toBe(0)
    expect(FakeYtPlayer.instances).toHaveLength(1)
    expect(player().options.videoId).toBe(VIDEOS[0])
    expect(player().playCalls).toBe(1)
  })

  it('트랙 ▶ 가 목록 전체를 큐로 만들고 그 곡부터 시작한다', async () => {
    const { wrapper, playback } = await setup()

    await wrapper.findAll('.track-play')[1]?.trigger('click')
    await flush()

    expect(playback.queue).toHaveLength(3)
    expect(playback.queueIndex).toBe(1)
    expect(player().options.videoId).toBe(VIDEOS[1])
  })

  it('목록 행의 ▶ 가 그 목록을 선택하고 재생한다', async () => {
    const { wrapper, library, playback } = await setup()
    const other = library.createPlaylist('OTHER')
    const otherId = other.ok ? other.playlistId : ''
    library.addTrack(otherId, { videoId: VIDEOS[2], title: 'Only' })
    await nextTick()

    // 두 번째 목록 행의 ▶.
    await wrapper.findAll('.playlist-play')[1]?.trigger('click')
    await flush()

    expect(library.selectedPlaylistId).toBe(otherId)
    expect(playback.queue.map((track) => track.title)).toEqual(['Only'])
    expect(player().options.videoId).toBe(VIDEOS[2])
  })

  it('선택된 목록이 첫 번째가 아니어도 그 목록에서 트랙을 찾는다', async () => {
    const { wrapper, library, playback } = await setup()
    const second = library.createPlaylist('SECOND')
    const secondId = second.ok ? second.playlistId : ''
    library.addTrack(secondId, { videoId: VIDEOS[2], title: 'Only in second' })
    library.selectPlaylist(secondId)
    await nextTick()

    await wrapper.get('.track-play').trigger('click')
    await flush()

    expect(playback.queue.map((track) => track.title)).toEqual(['Only in second'])
    expect(player().options.videoId).toBe(VIDEOS[2])
  })

  it('빈 목록은 재생 버튼이 비활성화된다', async () => {
    const { wrapper } = await setup(0)

    expect(byText(wrapper, '.pill', '▶ 목록 전체 재생')?.attributes('disabled')).toBeDefined()
    /*
     * M6-4 — 빈 타일은 **비활성이 아니라 열기**다.
     *
     * 비활성 타일은 막다른 길이다. 작은 `⋯` 말고는 들어갈 길이 없다.
     * 그래서 빈 목록의 타일은 재생 대신 편집 오버레이를 연다. 이름도 그렇게
     * 말한다. 어느 쪽이든 **재생은 시작되지 않는다.**
     */
    expect(wrapper.get('.playlist-play').attributes('aria-label')).toContain('열기')
    await wrapper.get('.playlist-play').trigger('click')
    expect(FakeYtPlayer.instances).toHaveLength(0)
  })

  it('재생 버튼에 접근성 이름이 있다', async () => {
    const { wrapper } = await setup()

    expect(wrapper.get('.playlist-play').attributes('aria-label')).toBe(
      'MY RECORDS 전체 재생 (3곡)',
    )
    expect(wrapper.findAll('.track-play').map((node) => node.attributes('aria-label'))).toEqual([
      'Track 1 재생',
      'Track 2 재생',
      'Track 3 재생',
    ])
  })
})

describe('B. 큐 진행', () => {
  it('영상이 끝나면 다음 트랙을 적재한다', async () => {
    const { wrapper, playback } = await setup()
    await startPlaylist(wrapper)

    player().fireStateChange(PLAYING)
    player().fireStateChange(ENDED)
    await nextTick()

    expect(playback.queueIndex).toBe(1)
    expect(player().loadCalls).toEqual([VIDEOS[1]])
    // 곡이 바뀌어도 플레이어를 다시 만들지 않는다 (ADR 0002).
    expect(FakeYtPlayer.instances).toHaveLength(1)
    expect(player().destroyCalls).toBe(0)
  })

  it('마지막 트랙이 끝나면 멈추고 알린다', async () => {
    const { wrapper, playback } = await setup(2)
    await startPlaylist(wrapper)

    for (let round = 0; round < 2; round += 1) {
      player().fireStateChange(PLAYING)
      player().fireStateChange(ENDED)
    }
    await nextTick()

    expect(playback.queueIndex).toBe(1)
    expect(player().loadCalls).toEqual([VIDEOS[1]])
    expect(wrapper.get('.status').text()).toBe('마지막 곡까지 재생했습니다.')
  })
})

describe('C. 재생 불가 영상', () => {
  it('오류가 나도 다음 곡으로 넘어가지 않는다', async () => {
    const { wrapper, playback } = await setup()
    await startPlaylist(wrapper)

    // 101 = 임베드 재생 불가.
    player().fireError(101)
    await nextTick()

    expect(playback.queueIndex).toBe(0)
    expect(player().loadCalls).toEqual([])
    expect(playback.playerState).toBe('error')
  })

  it('오류 이유를 화면에 적는다', async () => {
    const { wrapper } = await setup()
    await startPlaylist(wrapper)

    player().fireError(150)
    await nextTick()

    const notice = wrapper.get('.status').text()
    // 코드별 안내 (M3-5). 150 은 "임베드 불허" 라서 YouTube 로 보낸다.
    expect(notice).toContain('오류 150')
    expect(notice).toContain('다른 사이트에서 재생할 수 없도록')
  })

  it('오류 뒤 사용자가 다른 곡을 고르면 다시 재생한다', async () => {
    const { wrapper, playback } = await setup()
    await startPlaylist(wrapper)
    player().fireError(101)
    await nextTick()

    await wrapper.findAll('.track-play')[2]?.trigger('click')
    await flush()

    expect(playback.queueIndex).toBe(2)
    expect(player().loadCalls).toEqual([VIDEOS[2]])
    expect(wrapper.get('.status').text()).not.toContain('오류')
  })
})

describe('D. DOM 안정성 (ADR 0002)', () => {
  it('테마를 바꿔도 플레이어와 iframe 이 그대로다', async () => {
    const { wrapper } = await setup()
    await startPlaylist(wrapper)
    const iframe = player().iframe
    const mountHost = wrapper.get('.player-mount').element

    for (const key of ['kawaii-synth-cassette', 'mono-vinyl'] as const) {
      useThemeStore().setTheme(key)
      await nextTick()
    }

    expect(FakeYtPlayer.instances).toHaveLength(1)
    expect(player().destroyCalls).toBe(0)
    expect(player().iframe).toBe(iframe)
    expect(wrapper.get('.player-mount').element).toBe(mountHost)
    expect(mountHost.contains(iframe)).toBe(true)
  })

  it('드로어를 여닫아도 플레이어와 iframe 이 그대로다', async () => {
    const { wrapper } = await setup()
    await startPlaylist(wrapper)
    const iframe = player().iframe

    for (let round = 0; round < 2; round += 1) {
      await wrapper.get('.drawer .close').trigger('click')
      await nextTick()
      await wrapper.get('.deck-open--mono-vinyl').trigger('click')
      await nextTick()
    }

    expect(FakeYtPlayer.instances).toHaveLength(1)
    expect(player().destroyCalls).toBe(0)
    expect(player().iframe).toBe(iframe)
  })

  it('재생 중 드로어에서 목록을 편집해도 큐가 그대로다', async () => {
    const { wrapper, playback } = await setup()
    await startPlaylist(wrapper)
    player().fireStateChange(PLAYING)
    const before = [...playback.queue]

    // 두 번째 트랙을 위로 올린다.
    await wrapper.get('[aria-label="Track 2 위로"]').trigger('click')
    await nextTick()
    // 세 번째 트랙을 지운다. 행의 버튼은 ✎ ↑ ↓ × 네 개다 (M6-5).
    await wrapper.get('[aria-label="Track 3 삭제"]').trigger('click')
    await wrapper.get('[aria-label="트랙 삭제 확인"] .pill--strong').trigger('click')
    await nextTick()

    expect(playback.queue).toEqual(before)
    expect(playback.queueIndex).toBe(0)
    expect(player().loadCalls).toEqual([])
    expect(FakeYtPlayer.instances).toHaveLength(1)
  })
})
