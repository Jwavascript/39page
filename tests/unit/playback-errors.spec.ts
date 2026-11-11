/**
 * M3-5 — 오류·예외 처리와 재생 안정화.
 *
 * 나누어 본다.
 *   A. 오류 코드별 안내 — 어댑터의 코드 → 종류 변환과 코디네이터의 문구
 *   B. 자동재생 차단 — 사용자가 다시 요청할 수 있는 상태로 되돌리는가
 *   C. 늦게 도착한 사건 — 현재 트랙의 상태를 덮어쓰지 않는가
 *   D. 재생 중 트랙 삭제 — 멈추고 안내하는가 (`MVP_SPEC.md` F4)
 *   E. 외부 링크와 로딩 전 안내 — 화면에 실제로 나타나는가
 *
 * 실제 네트워크도 실제 YouTube API 도 쓰지 않는다.
 */
import { nextTick } from 'vue'

import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import App from '@/app/App.vue'
import { createPlaybackCoordinator } from '@/features/playback/createPlaybackCoordinator'
import { FakePlayerAdapter } from '@/features/playback/FakePlayerAdapter'
import { PLAYER_ADAPTER_FACTORY, type PlayerErrorKind } from '@/features/playback/PlayerAdapter'
import type { PlaybackCoordinator } from '@/features/playback/playbackCoordinator'
import type { Track } from '@/shared/types'
import { useLibraryStore } from '@/stores/library'
import { usePlaybackStore } from '@/stores/playback'

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

/** 코디네이터 + 가짜 어댑터. 플레이어 영역은 항상 보인다고 본다. */
function setup(trackCount = 3) {
  const library = useLibraryStore()
  const playback = usePlaybackStore()

  const created = library.createPlaylist('PLAYLIST A')
  const playlistId = created.ok ? created.playlistId : ''
  for (let index = 0; index < trackCount; index += 1) {
    library.addTrack(playlistId, {
      videoId: VIDEOS[index % VIDEOS.length] ?? VIDEOS[0],
      title: `Track ${index + 1}`,
    })
  }

  const coordinator: PlaybackCoordinator = createPlaybackCoordinator()
  const fake = new FakePlayerAdapter()
  const attachment = coordinator.attachAdapter(fake, {
    measure: () => ({ ok: true }),
    reveal: () => {},
  })
  fake.mount(document.createElement('div'), attachment.events)

  return { library, playback, coordinator, fake, attachment, playlistId }
}

function trackIds(library: ReturnType<typeof useLibraryStore>, playlistId: string): string[] {
  return (library.getPlaylist(playlistId)?.tracks ?? []).map((track: Track) => track.id)
}

/* ---------- A. 오류 코드별 안내 ---------- */

/** 코드 → 안내에 반드시 들어가야 하는 조각. */
const CODE_EXPECTATIONS: readonly { code: number; kind: PlayerErrorKind; fragment: string }[] = [
  { code: 2, kind: 'invalid-parameter', fragment: '영상 주소가 올바르지 않아' },
  { code: 5, kind: 'not-playable', fragment: '이 브라우저의 플레이어에서' },
  { code: 100, kind: 'not-found', fragment: '영상을 찾을 수 없어요' },
  { code: 101, kind: 'embed-not-allowed', fragment: '다른 사이트에서 재생할 수 없도록' },
  { code: 150, kind: 'embed-not-allowed', fragment: '다른 사이트에서 재생할 수 없도록' },
  { code: 153, kind: 'referrer-missing', fragment: '참조 정보를 보내지 않아' },
]

describe('A. 오류 코드별 안내', () => {
  it.each(CODE_EXPECTATIONS)(
    '코드 $code 는 $kind 로 분류되고 그 사정을 설명한다',
    ({ code, kind, fragment }) => {
      const { coordinator, playback, fake, playlistId } = setup()
      coordinator.playPlaylist(playlistId)

      fake.emitError({ kind, code })

      expect(playback.statusMessage).toContain(fragment)
      // 승인된 디자인처럼 번호를 함께 보여준다. 사용자가 알려줄 수 있는 단서다.
      expect(playback.statusMessage).toContain(`오류 ${String(code)}`)
      expect(playback.statusTone).toBe('warning')
    },
  )

  it('101 과 150 은 같은 사정이라 같은 문장을 쓰고 번호만 다르다', () => {
    const first = setup()
    first.coordinator.playPlaylist(first.playlistId)
    first.fake.emitError({ kind: 'embed-not-allowed', code: 101 })
    const message101 = first.playback.statusMessage

    // 두 설정을 서로 독립시킨다 (beforeEach 와 같은 격리). M10-3 부터 복원하지 않은
    // store 가 남이 쓴 저장소에 덮어쓰지 않으므로, 같은 저장소를 두면 둘째 설정의
    // 목록 생성이 충돌로 거절된다 (ADR 0024).
    globalThis.localStorage.clear()
    setActivePinia(createPinia())
    const second = setup()
    second.coordinator.playPlaylist(second.playlistId)
    second.fake.emitError({ kind: 'embed-not-allowed', code: 150 })

    expect(message101.replace('101', '150')).toBe(second.playback.statusMessage)
  })

  it('알 수 없는 코드는 일반 안내로 떨어진다', () => {
    const { coordinator, playback, fake, playlistId } = setup()
    coordinator.playPlaylist(playlistId)

    fake.emitError({ kind: 'unknown', code: 777 })

    expect(playback.statusMessage).toContain('재생되지 않아요')
    expect(playback.statusMessage).toContain('오류 777')
  })

  it('API 를 못 받은 경우는 번호가 없고 다시 눌러보라고 알린다', () => {
    const { coordinator, playback, fake, playlistId } = setup()
    coordinator.playPlaylist(playlistId)

    fake.emitError({ kind: 'api-unavailable', code: null })

    expect(playback.statusMessage).toContain('네트워크를 확인하고')
    expect(playback.statusMessage).not.toContain('오류')
  })

  it('오류가 나도 다음 곡으로 자동 전환하지 않는다 (M3-0.7)', () => {
    const { coordinator, playback, fake, playlistId } = setup()
    coordinator.playPlaylist(playlistId)

    fake.emitError({ kind: 'embed-not-allowed', code: 150 })

    expect(playback.queueIndex).toBe(0)
    expect(fake.calls.load.map((call) => call.videoId)).toEqual([VIDEOS[0]])
  })

  it('오류 뒤 토글을 누르면 같은 트랙을 다시 적재한다', () => {
    const { coordinator, fake, playlistId } = setup()
    coordinator.playPlaylist(playlistId)
    fake.emitError({ kind: 'not-found', code: 100 })

    coordinator.togglePlay()

    expect(fake.calls.load.map((call) => call.videoId)).toEqual([VIDEOS[0], VIDEOS[0]])
    expect(fake.calls.play).toBe(0)
  })
})

/* ---------- B. 자동재생 차단 ---------- */

describe('B. 자동재생 차단', () => {
  it('차단 안내는 경고이고 다시 누르라고 말한다', () => {
    const { coordinator, playback, fake, playlistId } = setup()
    coordinator.playPlaylist(playlistId)

    fake.emitAutoplayBlocked()

    expect(playback.statusMessage).toContain('자동재생을 막았어요')
    expect(playback.statusMessage).toContain('▶')
    expect(playback.statusTone).toBe('warning')
  })

  it('차단은 오류가 아니다 — 재생 상태를 error 로 만들지 않는다', () => {
    const { coordinator, playback, fake, playlistId } = setup()
    coordinator.playPlaylist(playlistId)

    fake.emitAutoplayBlocked()

    expect(playback.playerState).not.toBe('error')
  })

  it('차단 뒤 사용자가 다시 누르면 재생 명령이 나간다', () => {
    const { coordinator, fake, playlistId } = setup()
    coordinator.playPlaylist(playlistId)
    // 실제 어댑터는 차단 시 낙관적 `loading` 을 `idle` 로 되돌린다.
    fake.emitAutoplayBlocked()
    fake.emitStateChange('idle')

    coordinator.togglePlay()

    expect(fake.calls.play).toBe(1)
  })

  it('차단 뒤에는 ENDED 가 와도 다음 곡으로 넘기지 않는다', () => {
    const { coordinator, playback, fake, playlistId } = setup()
    coordinator.playPlaylist(playlistId)
    fake.emitStateChange('playing')
    fake.emitAutoplayBlocked()

    fake.emitStateChange('ended')

    expect(playback.queueIndex).toBe(0)
  })

  it('큐가 비어 있으면 차단 안내를 띄우지 않는다', () => {
    const { playback, fake } = setup()

    fake.emitAutoplayBlocked()

    expect(playback.statusMessage).toBe('')
  })
})

/* ---------- C. 늦게 도착한 사건 ---------- */

describe('C. 늦게 도착한 사건', () => {
  it('재생 중에 온 오류도 버리지 않는다 — 조용한 실패를 만들지 않는다', () => {
    const { coordinator, playback, fake, playlistId } = setup()
    coordinator.playPlaylist(playlistId)
    fake.emitStateChange('playing')

    fake.emitError({ kind: 'embed-not-allowed', code: 150 })

    /*
     * "이미 재생된 트랙의 오류는 늦은 신호" 로 버리면, 재생 중에 생긴 진짜
     * 오류가 조용히 사라진다 — 화면은 `재생 중` 인데 소리는 나지 않는다.
     * 틀린 안내는 사용자가 보고 판단할 수 있지만 없는 안내는 그럴 수 없다.
     */
    expect(playback.playerState).toBe('error')
    expect(playback.statusMessage).toContain('오류 150')
  })

  it('연결이 끊긴 어댑터의 사건은 버린다 — destroy 하지 않아도', () => {
    const { coordinator, playback, fake, playlistId, attachment } = setup()
    coordinator.playPlaylist(playlistId)
    fake.emitStateChange('playing')

    // 어댑터를 없애지 않는다. 코디네이터가 제 쪽에서 막아야 한다.
    attachment.detach()
    fake.emitError({ kind: 'not-found', code: 100 })
    fake.emitStateChange('paused')
    fake.emitAutoplayBlocked()

    expect(playback.playerState).toBe('playing')
    expect(playback.statusMessage).toBe('')
  })

  it('큐가 비어 있으면 오류 안내를 띄우지 않는다', () => {
    const { playback, fake } = setup()

    fake.emitError({ kind: 'not-found', code: 100 })

    expect(playback.statusMessage).toBe('')
  })

  it('재생된 적 없는 트랙의 늦은 ENDED 는 큐를 움직이지 않는다', () => {
    const { coordinator, playback, fake, playlistId } = setup()
    coordinator.playPlaylist(playlistId)
    fake.emitStateChange('playing')

    // 사용자가 다른 곡을 골랐다. 이전 곡의 ENDED 가 그 뒤에 도착한다.
    coordinator.next()
    fake.emitStateChange('ended')

    expect(playback.queueIndex).toBe(1)
  })

  it('새 트랙이 실제로 재생되면 앞선 경고가 지워진다', () => {
    const { coordinator, playback, fake, playlistId } = setup()
    coordinator.playPlaylist(playlistId)
    fake.emitError({ kind: 'not-found', code: 100 })
    expect(playback.statusMessage).not.toBe('')

    coordinator.next()
    fake.emitStateChange('playing')

    expect(playback.statusMessage).toBe('')
    expect(playback.playerState).toBe('playing')
  })

  it('언마운트한 어댑터는 더 이상 사건을 올리지 않는다', () => {
    const { coordinator, playback, fake, playlistId, attachment } = setup()
    coordinator.playPlaylist(playlistId)
    fake.emitStateChange('playing')

    attachment.detach()
    fake.destroy()
    fake.emitError({ kind: 'not-found', code: 100 })

    expect(playback.statusMessage).toBe('')
  })
})

/* ---------- D. 재생 중 트랙 삭제 ---------- */

describe('D. 재생 중 트랙 삭제', () => {
  it('재생 중이던 곡이 지워지면 멈추고 안내한다', () => {
    const { coordinator, playback, fake, library, playlistId } = setup()
    coordinator.playPlaylist(playlistId)
    fake.emitStateChange('playing')
    const [first] = trackIds(library, playlistId)

    library.removeTrack(playlistId, first ?? '')
    coordinator.trackRemoved(first ?? '')

    expect(fake.calls.pause).toBe(1)
    expect(playback.statusMessage).toContain('삭제돼 재생을 멈췄습니다')
    expect(playback.statusTone).toBe('warning')
  })

  it('큐는 스냅샷이라 그대로 남는다', () => {
    const { coordinator, playback, library, playlistId, fake } = setup()
    coordinator.playPlaylist(playlistId)
    fake.emitStateChange('playing')
    const [first] = trackIds(library, playlistId)

    library.removeTrack(playlistId, first ?? '')
    coordinator.trackRemoved(first ?? '')

    expect(playback.queue).toHaveLength(3)
    expect(playback.queueIndex).toBe(0)
    expect(playback.currentTrack?.id).toBe(first)
  })

  it('다음 곡으로 자동 전환하지 않는다', () => {
    const { coordinator, playback, library, playlistId, fake } = setup()
    coordinator.playPlaylist(playlistId)
    fake.emitStateChange('playing')
    const [first] = trackIds(library, playlistId)

    coordinator.trackRemoved(first ?? '')

    expect(playback.queueIndex).toBe(0)
    expect(fake.calls.load).toHaveLength(1)
  })

  it('멈춘 뒤 ENDED 가 와도 큐가 흐르지 않는다', () => {
    const { coordinator, playback, library, playlistId, fake } = setup()
    coordinator.playPlaylist(playlistId)
    fake.emitStateChange('playing')
    const [first] = trackIds(library, playlistId)

    coordinator.trackRemoved(first ?? '')
    fake.emitStateChange('ended')

    expect(playback.queueIndex).toBe(0)
  })

  it('지금 재생 중이 아닌 곡을 지우면 아무 일도 없다', () => {
    const { coordinator, playback, library, playlistId, fake } = setup()
    coordinator.playPlaylist(playlistId)
    fake.emitStateChange('playing')
    const ids = trackIds(library, playlistId)

    coordinator.trackRemoved(ids[2] ?? '')

    expect(fake.calls.pause).toBe(0)
    expect(playback.statusMessage).toBe('')
  })

  it('재생 중인 것이 없으면 아무 일도 없다', () => {
    const { coordinator, playback, library, playlistId, fake } = setup()
    const ids = trackIds(library, playlistId)

    coordinator.trackRemoved(ids[0] ?? '')

    expect(fake.calls.pause).toBe(0)
    expect(playback.statusMessage).toBe('')
  })

  it('사용자가 다시 고르면 재생이 이어진다', () => {
    const { coordinator, playback, library, playlistId, fake } = setup()
    coordinator.playPlaylist(playlistId)
    fake.emitStateChange('playing')
    const ids = trackIds(library, playlistId)
    coordinator.trackRemoved(ids[0] ?? '')

    library.removeTrack(playlistId, ids[0] ?? '')
    const remaining = trackIds(library, playlistId)
    coordinator.playTrack(playlistId, remaining[0] ?? '')

    expect(playback.statusMessage).toBe('')
    expect(playback.queue).toHaveLength(2)
  })
})

/* ---------- E. 화면 ---------- */

function mountApp() {
  const fake = new FakePlayerAdapter()
  const wrapper = mount(App, {
    attachTo: document.body,
    global: { provide: { [PLAYER_ADAPTER_FACTORY as symbol]: () => fake } },
  })
  return { wrapper, fake }
}

type Wrapper = ReturnType<typeof mountApp>['wrapper']

/**
 * 트랙 드로어를 여는 트리거 (M7).
 *
 * 데크는 이제 플레이리스트 위젯을 펼친다. 드로어는 **타일 본문**으로 연다.
 */
function editorTrigger(wrapper: Wrapper) {
  return wrapper.get('.playlist-tile .playlist-open')
}

async function seeded(trackCount = 2) {
  const { wrapper, fake } = mountApp()
  const library = useLibraryStore()
  const playback = usePlaybackStore()

  const created = library.createPlaylist('LIST')
  const playlistId = created.ok ? created.playlistId : ''
  for (let index = 0; index < trackCount; index += 1) {
    library.addTrack(playlistId, {
      videoId: VIDEOS[index % VIDEOS.length] ?? VIDEOS[0],
      title: `Track ${index + 1}`,
    })
  }
  library.selectPlaylist(playlistId)
  await nextTick()

  return { wrapper, fake, library, playback, playlistId }
}

describe('E. 외부 링크와 로딩 전 안내', () => {
  it('트랙이 없으면 외부 링크를 띄우지 않는다', async () => {
    const context = await seeded()

    expect(context.wrapper.find('.action-row a').exists()).toBe(false)
  })

  it('트랙을 고르면 그 영상의 YouTube 주소를 띄운다', async () => {
    const context = await seeded()

    await context.wrapper.get('.playlist-play').trigger('click')

    const link = context.wrapper.get('.action-row a')
    expect(link.attributes('href')).toBe(`https://www.youtube.com/watch?v=${VIDEOS[0]}`)
    expect(link.text()).toContain('YOUTUBE에서 열기')
  })

  it('새 창으로 열고 opener 를 넘기지 않는다', async () => {
    const context = await seeded()

    await context.wrapper.get('.playlist-play').trigger('click')

    const link = context.wrapper.get('.action-row a')
    expect(link.attributes('target')).toBe('_blank')
    expect(link.attributes('rel')).toBe('noopener noreferrer')
  })

  it('오류가 나도 링크는 그대로 있다', async () => {
    const context = await seeded()
    await context.wrapper.get('.playlist-play').trigger('click')

    context.fake.emitError({ kind: 'embed-not-allowed', code: 150 })
    await nextTick()

    expect(context.wrapper.get('.action-row a').attributes('href')).toContain(VIDEOS[0])
    expect(context.wrapper.get('.status').text()).toContain('오류 150')
    expect(context.wrapper.get('.status').classes()).toContain('is-warning')
  })

  it('다음 곡으로 넘기면 링크도 그 곡을 가리킨다', async () => {
    const context = await seeded()
    await context.wrapper.get('.playlist-play').trigger('click')

    await context.wrapper.get('[aria-label="다음 곡"]').trigger('click')

    expect(context.wrapper.get('.action-row a').attributes('href')).toContain(VIDEOS[1])
  })

  it('영상 전 안내는 어댑터 소유 영역 밖의 형제다', async () => {
    const context = await seeded()

    const holder = context.wrapper.get('.video-holder')
    const placeholder = holder.get('.video-placeholder')
    const mount = holder.get('.player-mount')

    // 둘 다 홀더의 직계 자식이다. 안내가 `.player-mount` 안에 있으면
    // YT.Player 가 교체하는 영역을 Vue 가 패치하게 된다 (ADR 0002).
    expect(placeholder.element.parentElement).toBe(holder.element)
    expect(mount.element.parentElement).toBe(holder.element)
    expect(mount.element.contains(placeholder.element)).toBe(false)
  })

  it('트랙이 없을 때 승인된 안내 문구를 보여준다', async () => {
    const context = await seeded()

    const placeholder = context.wrapper.get('.video-placeholder')
    expect(placeholder.classes()).not.toContain('is-hidden')
    expect(placeholder.text()).toContain('YOUTUBE / VIDEO')
    expect(placeholder.text()).toContain('16:9로 표시됩니다')
  })

  it('트랙을 고르면 안내를 숨긴다 — DOM 에서 지우지는 않는다', async () => {
    const context = await seeded()

    await context.wrapper.get('.playlist-play').trigger('click')

    const placeholder = context.wrapper.get('.video-placeholder')
    expect(placeholder.classes()).toContain('is-hidden')
  })

  it('드로어에서 재생 중인 트랙을 지우면 멈추고 안내한다', async () => {
    const context = await seeded()
    await context.wrapper.get('.playlist-play').trigger('click')
    context.fake.emitReady()
    context.fake.emitStateChange('playing')
    await nextTick()

    await editorTrigger(context.wrapper).trigger('click')
    await context.wrapper.get('[aria-label="Track 1 삭제"]').trigger('click')
    await context.wrapper.get('.confirm .pill--strong').trigger('click')

    expect(context.fake.calls.pause).toBe(1)
    expect(context.wrapper.get('.status').text()).toContain('삭제돼 재생을 멈췄습니다')
    expect(context.playback.queue).toHaveLength(2)
  })

  it('드로어에서 다른 트랙을 지우면 재생이 계속된다', async () => {
    const context = await seeded()
    await context.wrapper.get('.playlist-play').trigger('click')
    context.fake.emitReady()
    context.fake.emitStateChange('playing')
    await nextTick()

    await editorTrigger(context.wrapper).trigger('click')
    await context.wrapper.get('[aria-label="Track 2 삭제"]').trigger('click')
    await context.wrapper.get('.confirm .pill--strong').trigger('click')

    expect(context.fake.calls.pause).toBe(0)
    expect(context.playback.playerState).toBe('playing')
  })
})
