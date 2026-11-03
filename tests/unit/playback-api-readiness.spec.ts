/**
 * M3-2 — API 준비 **전**에 들어온 재생 요청.
 *
 * 왜 파일을 따로 두는가: API 스크립트 로더는 **모듈 싱글턴**이다. 한 파일
 * 안에서 한 번 해결되면 그 뒤의 테스트는 "아직 준비되지 않은" 상태를 다시
 * 만들 수 없다. Vitest 는 파일 단위로 모듈을 격리하므로, 준비 전 경로를
 * 보는 테스트는 자기 파일을 갖는 것이 테스트 순서에 기대지 않는 유일한
 * 방법이다.
 *
 * 실제 네트워크에 접속하지 않는다. jsdom 은 외부 `<script>` 를 실행하지
 * 않으므로, 스크립트 태그가 붙었는지만 확인하고 `window.YT` 를 손으로
 * 세운 뒤 전역 콜백을 직접 부른다.
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

const API_SRC = 'https://www.youtube.com/iframe_api'
const VIDEO_A = 'aaaaaaaaaaa'
const VIDEO_B = 'bbbbbbbbbbb'

class FakeYtPlayer implements YouTubePlayer {
  static instances: FakeYtPlayer[] = []

  readonly options: YouTubePlayerOptions
  readonly loadCalls: string[] = []
  readonly cueCalls: string[] = []
  playCalls = 0

  constructor(host: HTMLElement, options: YouTubePlayerOptions) {
    this.options = options
    FakeYtPlayer.instances.push(this)
    host.replaceWith(host.ownerDocument.createElement('iframe'))
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

  pauseVideo(): void {}

  destroy(): void {}

  fireReady(): void {
    this.options.events?.onReady?.({ target: this })
  }
}

function flush(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0)
  })
}

function apiScriptCount(): number {
  return document.head.querySelectorAll(`script[src="${API_SRC}"]`).length
}

beforeEach(() => {
  globalThis.localStorage.clear()
  delete document.documentElement.dataset.theme
  document.head.innerHTML = ''
  FakeYtPlayer.instances = []
  // API 가 **아직 오지 않은** 상태로 시작한다.
  delete window.YT
  delete window.onYouTubeIframeAPIReady
  setActivePinia(createPinia())
})

afterEach(() => {
  globalThis.localStorage.clear()
  document.body.innerHTML = ''
  document.head.innerHTML = ''
  delete window.YT
  delete window.onYouTubeIframeAPIReady
})

describe('API 준비 전 재생 요청', () => {
  /*
   * 한 테스트에 다 담는다. 로더 싱글턴이 한 번 해결되면 "아직 준비되지 않은"
   * 창은 이 파일에서 다시 열리지 않는다. 테스트를 쪼개면 두 번째부터는
   * 보려던 경로를 보지 못한 채 통과한다.
   */
  it('여러 번 눌러도 마지막 요청만 남고, 준비된 뒤 정확히 한 번 재생한다', async () => {
    const wrapper = mount(App, {
      attachTo: document.body,
      global: {
        provide: { [PLAYER_ADAPTER_FACTORY as symbol]: () => new YouTubeIFramePlayerAdapter() },
      },
    })
    const library = useLibraryStore()
    const playback = usePlaybackStore()

    const created = library.createPlaylist('MY RECORDS')
    const playlistId = created.ok ? created.playlistId : ''
    library.addTrack(playlistId, { videoId: VIDEO_A, title: 'Track 1' })
    library.addTrack(playlistId, { videoId: VIDEO_B, title: 'Track 2' })

    await wrapper.get('.deck-open--mono-vinyl').trigger('click')
    await nextTick()

    // 마운트만으로는 네트워크를 건드리지 않는다 (지연 로드, ADR 0008).
    expect(apiScriptCount()).toBe(0)

    // API 가 없는 동안 두 번째 트랙의 ▶ 를 누른다.
    await wrapper.findAll('.track-play')[1]?.trigger('click')
    await flush()

    // 큐는 즉시 만들어진다. 플레이어는 아직 없다.
    expect(playback.queueIndex).toBe(1)
    expect(playback.currentTrack?.videoId).toBe(VIDEO_B)
    expect(apiScriptCount()).toBe(1)
    expect(FakeYtPlayer.instances).toHaveLength(0)

    // 아직 준비되지 않은 채로 빠르게 두 번 더 누른다.
    await wrapper.findAll('.track-play')[0]?.trigger('click')
    await wrapper.findAll('.track-play')[1]?.trigger('click')
    await wrapper.findAll('.track-play')[0]?.trigger('click')
    await flush()

    // 스크립트를 다시 붙이지 않는다.
    expect(apiScriptCount()).toBe(1)
    expect(FakeYtPlayer.instances).toHaveLength(0)

    // 이제 API 가 도착한다.
    window.YT = { Player: FakeYtPlayer }
    window.onYouTubeIframeAPIReady?.()
    await flush()

    // 플레이어는 하나, 영상은 **마지막으로 고른 것**. 요청은 유실되지 않았다.
    expect(FakeYtPlayer.instances).toHaveLength(1)
    const player = FakeYtPlayer.instances[0]
    expect(player?.options.videoId).toBe(VIDEO_A)
    expect(playback.queueIndex).toBe(0)
    expect(player?.playCalls).toBe(0)

    player?.fireReady()

    // 보류분을 정확히 한 번만 실행한다.
    expect(player?.playCalls).toBe(1)
    expect(player?.loadCalls).toEqual([])

    player?.fireReady()
    expect(player?.playCalls).toBe(1)
  })
})
