/**
 * M6-6 — 데크에 그려진 ▶ / ■ 가 실제로 동작한다.
 *
 * 실기기 검증에서 사용자가 **두 번** 지적한 문제다: "카세트나 LP의 play,
 * stop 버튼이 존재만 하고 동작하지 않는다" (`M6_PLAN.md` §5-a).
 *
 * 앱을 통째로 마운트해 데크 키 → `useDeckTransport` → Playback Coordinator →
 * 어댑터까지 실제로 이어지는지 본다. 가짜 어댑터가 외부 플레이어 역할을 한다.
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

import {
  HIDDEN_RECT,
  TOO_SMALL_RECT,
  installPlayerRect,
  setPlayerRect,
  uninstallPlayerRect,
} from '../support/playerLayout'

const VIDEO_A = 'aaaaaaaaaaa'
const VIDEO_B = 'bbbbbbbbbbb'

function mountApp() {
  const fake = new FakePlayerAdapter()
  const wrapper = mount(App, {
    attachTo: document.body,
    global: { provide: { [PLAYER_ADAPTER_FACTORY as symbol]: () => fake } },
  })
  return { wrapper, fake, library: useLibraryStore(), playback: usePlaybackStore() }
}

type Context = ReturnType<typeof mountApp>

/** 트랙 둘을 가진 플레이리스트를 선택 상태로 둔다. */
function seed(library: ReturnType<typeof useLibraryStore>): string {
  const created = library.createPlaylist('MY RECORDS')
  const id = created.ok ? created.playlistId : ''
  library.addTrack(id, { videoId: VIDEO_A, title: 'ONE' })
  library.addTrack(id, { videoId: VIDEO_B, title: 'TWO' })
  return id
}

/** 지금 테마에서 보이는 키가 아니어도 jsdom 에서는 찾을 수 있다. */
const monoKey = (context: Context) => context.wrapper.get('.deck-key--mono-vinyl')
const cassettePlay = (context: Context) => context.wrapper.get('.deck-key--kawaii-play')
const cassetteStop = (context: Context) => context.wrapper.get('.deck-key--kawaii-stop')
const notice = (context: Context) => context.wrapper.find('.deck-notice')

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

describe('A. 큐가 없을 때 — 선택된 목록을 처음부터 재생한다', () => {
  it('카세트의 ▶ 가 선택된 목록을 큐로 만든다', async () => {
    const context = mountApp()
    seed(context.library)
    await nextTick()

    await cassettePlay(context).trigger('click')

    expect(context.playback.queue.map((item) => item.videoId)).toEqual([VIDEO_A, VIDEO_B])
    expect(context.playback.queueIndex).toBe(0)
    expect(context.fake.calls.load).toEqual([{ videoId: VIDEO_A, autoplay: true }])
  })

  it('Mono Vinyl 의 START / STOP 키도 같은 일을 한다', async () => {
    const context = mountApp()
    seed(context.library)
    await nextTick()

    await monoKey(context).trigger('click')

    expect(context.playback.currentTrack?.videoId).toBe(VIDEO_A)
    expect(context.fake.calls.load).toHaveLength(1)
  })

  it('큐가 없을 때의 ▶ 이름이 무엇을 할지 말한다', () => {
    const context = mountApp()
    seed(context.library)

    expect(cassettePlay(context).attributes('aria-label')).toBe('선택한 목록을 처음부터 재생')
  })

  it('■ 는 멈춰 있을 때 재생을 시작하지 않는다', async () => {
    const context = mountApp()
    seed(context.library)
    await nextTick()

    await cassetteStop(context).trigger('click')

    // 그림이 ■ 인데 재생이 시작되면 그림과 동작이 어긋난다.
    expect(context.fake.calls.load).toEqual([])
    expect(context.fake.calls.play).toBe(0)
    expect(context.playback.queue).toEqual([])
  })
})

describe('B. 큐가 있을 때 — 그 자리에서 이어서', () => {
  async function playing(): Promise<Context> {
    const context = mountApp()
    seed(context.library)
    await nextTick()

    await cassettePlay(context).trigger('click')
    context.fake.emitReady()
    context.fake.emitStateChange('playing')
    await nextTick()
    return context
  }

  it('재생 중에 ■ 를 누르면 일시정지한다', async () => {
    const context = await playing()

    await cassetteStop(context).trigger('click')

    expect(context.fake.calls.pause).toBe(1)
    // 큐와 위치는 그대로다. 정지가 아니라 일시정지다.
    expect(context.playback.queueIndex).toBe(0)
    expect(context.playback.queue).toHaveLength(2)
  })

  it('■ 의 이름은 그림의 STOP 이 아니라 실제 동작을 말한다', async () => {
    const context = await playing()

    // 레퍼런스의 글자는 `■ STOP` 이지만 재생 위치를 버리지 않는다.
    expect(cassetteStop(context).attributes('aria-label')).toBe('일시정지')
  })

  it('일시정지한 뒤 ▶ 를 누르면 같은 트랙을 이어서 재생한다', async () => {
    const context = await playing()
    await cassetteStop(context).trigger('click')
    context.fake.emitStateChange('paused')
    await nextTick()

    await cassettePlay(context).trigger('click')

    // 다시 적재하지 않는다. 적재는 처음 한 번뿐이다.
    expect(context.fake.calls.load).toHaveLength(1)
    expect(context.fake.calls.play).toBe(1)
  })

  it('Mono 의 한 키는 재생 중이면 멈추고 멈춰 있으면 재생한다', async () => {
    const context = await playing()

    await monoKey(context).trigger('click')
    expect(context.fake.calls.pause).toBe(1)

    context.fake.emitStateChange('paused')
    await nextTick()
    await monoKey(context).trigger('click')
    expect(context.fake.calls.play).toBe(1)
  })

  it('큐가 있으면 ▶ 이름이 그냥 재생이다', async () => {
    const context = await playing()
    context.fake.emitStateChange('paused')
    await nextTick()

    expect(cassettePlay(context).attributes('aria-label')).toBe('재생')
  })
})

describe('C. 거절 — 왜 안 되는지 알린다', () => {
  it('빈 목록이면 재생하지 않고 레코드를 먼저 추가하라고 말한다', async () => {
    const context = mountApp()
    context.library.createPlaylist('EMPTY')
    await nextTick()

    await cassettePlay(context).trigger('click')

    expect(context.playback.queue).toEqual([])
    expect(notice(context).text()).toContain('레코드를 먼저 추가')
  })

  it('목록이 하나도 없으면 목록을 먼저 선택하라고 말한다', async () => {
    const context = mountApp()
    await nextTick()

    await cassettePlay(context).trigger('click')

    expect(notice(context).text()).toContain('목록을 먼저 선택')
  })

  it('재생에 성공하면 안내가 남지 않는다', async () => {
    const context = mountApp()
    context.library.createPlaylist('EMPTY')
    await nextTick()
    await cassettePlay(context).trigger('click')
    expect(notice(context).exists()).toBe(true)

    const id = seed(context.library)
    context.library.selectPlaylist(id)
    await nextTick()
    await cassettePlay(context).trigger('click')

    expect(notice(context).exists()).toBe(false)
  })

  /*
   * M7-1 에서 뒤집힌 두 테스트다.
   *
   * M6-6 에는 가시성 사유를 데크가 말하지 않았다 — 플레이어의 `.status` 가
   * 혼자 말했고, 플레이어는 가려지지 않는다는 전제가 있었다. 세로 시트가
   * 플레이어를 덮을 수 있게 되면서 그 전제가 무너졌다. 덮이면 `.status` 도
   * 함께 덮이므로, 누른 자리에서도 말해야 읽힌다.
   */
  it('가려져서 거절되면 데크와 플레이어가 함께 알린다', async () => {
    const context = mountApp()
    seed(context.library)
    await nextTick()
    setPlayerRect(HIDDEN_RECT)

    await cassettePlay(context).trigger('click')

    expect(notice(context).text()).toContain('영상이 가려져')
    expect(context.playback.statusMessage).toContain('화면에 보이지 않아')
    expect(context.playback.queue).toEqual([])
  })

  it('영역이 작아서 거절된 경우도 같은 길로 알린다', async () => {
    const context = mountApp()
    seed(context.library)
    await nextTick()
    setPlayerRect(TOO_SMALL_RECT)

    await cassettePlay(context).trigger('click')

    // 요청 결과는 둘 다 `player-hidden` 이다. 크기 사유는 플레이어가 자세히 말한다.
    expect(notice(context).exists()).toBe(true)
    expect(context.playback.statusMessage).toContain('200×200')
  })
})

describe('D. 경계 — 데크는 테마와 플레이어 구현을 모른다', () => {
  it('두 테마의 키가 모두 마운트돼 있고 CSS 로만 가려진다', () => {
    const context = mountApp()

    // 테마 전환으로 재마운트하지 않는다 (ADR 0001).
    expect(context.wrapper.findAll('.deck-key')).toHaveLength(3)
  })

  it('테마를 바꿔도 재생 상태가 유지된다', async () => {
    const context = mountApp()
    seed(context.library)
    await nextTick()
    await cassettePlay(context).trigger('click')
    context.fake.emitReady()
    context.fake.emitStateChange('playing')
    await nextTick()

    useThemeStore().setTheme('kawaii-synth-cassette')
    await nextTick()

    expect(context.playback.playerState).toBe('playing')
    expect(context.fake.calls.destroy).toBe(0)
    expect(context.fake.calls.load).toHaveLength(1)
  })

  it('키가 라이브러리 트랙을 복사해 큐로 쓴다 — 편집해도 큐가 흔들리지 않는다', async () => {
    const context = mountApp()
    const id = seed(context.library)
    await nextTick()
    await cassettePlay(context).trigger('click')

    const before = context.playback.queue.map((item) => item.id)
    context.library.addTrack(id, { videoId: VIDEO_A, title: 'THREE' })
    await nextTick()

    expect(context.playback.queue.map((item) => item.id)).toEqual(before)
  })

  it('재생을 요청한 목록이 선택 상태로 남는다', async () => {
    const context = mountApp()
    const id = seed(context.library)
    await nextTick()

    await cassettePlay(context).trigger('click')

    expect(context.library.selectedPlaylistId).toBe(id)
    expect(context.playback.currentTrack?.id).toBe(
      context.library.getPlaylist(id)?.tracks[0]?.id ?? '',
    )
  })

  it('트랙 객체를 그대로 공유하지 않는다', async () => {
    const context = mountApp()
    const id = seed(context.library)
    await nextTick()

    await cassettePlay(context).trigger('click')

    const source = context.library.getPlaylist(id)?.tracks[0]
    expect(context.playback.queue[0]).not.toBe(source)
    expect(context.playback.queue[0]?.id).toBe(source?.id)
  })
})
