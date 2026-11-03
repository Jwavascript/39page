/**
 * M3-2 — Playback Coordinator.
 *
 * 컴포넌트 없이 코디네이터만 본다. `FakePlayerAdapter` 가 외부 플레이어
 * 역할을 하고, 테스트가 `emit*` 로 사건을 흘려보낸다. 실제 네트워크도
 * 실제 YouTube API 도 쓰지 않는다.
 *
 * 여기서 지키려는 경계:
 *   `library` 는 읽기만 · `playback` 에만 쓰기 · 두 store 는 서로를 모른다
 *   어댑터는 빌려 쓸 뿐 만들거나 없애지 않는다
 */
import { createPinia, setActivePinia, type Pinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createPlaybackCoordinator } from '@/features/playback/createPlaybackCoordinator'
import { FakePlayerAdapter } from '@/features/playback/FakePlayerAdapter'
import type { PlaybackCoordinator } from '@/features/playback/playbackCoordinator'
import { useLibraryStore } from '@/stores/library'
import { usePlaybackStore } from '@/stores/playback'

const VIDEO = ['aaaaaaaaaaa', 'bbbbbbbbbbb', 'ccccccccccc'] as const

let pinia: Pinia

beforeEach(() => {
  globalThis.localStorage.clear()
  pinia = createPinia()
  setActivePinia(pinia)
})

afterEach(() => {
  globalThis.localStorage.clear()
})

/** 트랙 n 개를 담은 플레이리스트 하나와, 어댑터가 붙은 코디네이터. */
function setup(trackCount = 3) {
  const library = useLibraryStore()
  const playback = usePlaybackStore()

  const created = library.createPlaylist('PLAYLIST A')
  const playlistId = created.ok ? created.playlistId : ''
  for (let index = 0; index < trackCount; index += 1) {
    library.addTrack(playlistId, {
      videoId: VIDEO[index % VIDEO.length] ?? VIDEO[0],
      title: `Track ${index + 1}`,
    })
  }

  const coordinator: PlaybackCoordinator = createPlaybackCoordinator()
  const fake = new FakePlayerAdapter()
  const attachment = coordinator.attachAdapter(fake)
  fake.mount(document.createElement('div'), attachment.events)

  return { library, playback, coordinator, fake, attachment, playlistId }
}

/** 플레이리스트의 트랙 id 목록. */
function trackIds(library: ReturnType<typeof useLibraryStore>, playlistId: string): string[] {
  return (library.getPlaylist(playlistId)?.tracks ?? []).map((track) => track.id)
}

describe('A. 재생 요청', () => {
  it('목록 전체 재생은 목록을 큐로 만들고 처음부터 시작한다', () => {
    const { playback, coordinator, fake, library, playlistId } = setup()

    const result = coordinator.playPlaylist(playlistId)

    expect(result).toEqual({ ok: true })
    expect(playback.queue.map((track) => track.title)).toEqual(['Track 1', 'Track 2', 'Track 3'])
    expect(playback.queueIndex).toBe(0)
    expect(playback.currentTrack?.id).toBe(trackIds(library, playlistId)[0])
    expect(fake.calls.load).toEqual([{ videoId: VIDEO[0], autoplay: true }])
  })

  it('트랙 재생은 목록 전체를 큐로 만들고 그 트랙부터 시작한다', () => {
    const { playback, coordinator, fake, library, playlistId } = setup()
    const ids = trackIds(library, playlistId)

    const result = coordinator.playTrack(playlistId, ids[1] ?? '')

    expect(result).toEqual({ ok: true })
    // 고른 트랙 하나가 아니라 목록 전체가 큐다.
    expect(playback.queue).toHaveLength(3)
    expect(playback.queueIndex).toBe(1)
    expect(playback.currentTrack?.title).toBe('Track 2')
    expect(fake.calls.load).toEqual([{ videoId: VIDEO[1], autoplay: true }])
  })

  it('빈 목록은 재생할 수 없고 큐도 건드리지 않는다', () => {
    const { library, playback, coordinator, fake } = setup(0)
    const created = library.createPlaylist('EMPTY')
    const emptyId = created.ok ? created.playlistId : ''

    const result = coordinator.playPlaylist(emptyId)

    expect(result).toEqual({ ok: false, reason: 'empty-playlist' })
    expect(playback.queue).toEqual([])
    expect(playback.queueIndex).toBe(-1)
    expect(fake.calls.load).toEqual([])
  })

  it('없는 목록·없는 트랙을 거절한다', () => {
    const { coordinator, playback, fake, library, playlistId } = setup()
    const ids = trackIds(library, playlistId)

    expect(coordinator.playPlaylist('nope')).toEqual({
      ok: false,
      reason: 'playlist-not-found',
    })
    expect(coordinator.playTrack('nope', ids[0] ?? '')).toEqual({
      ok: false,
      reason: 'playlist-not-found',
    })
    expect(coordinator.playTrack(playlistId, 'nope')).toEqual({
      ok: false,
      reason: 'track-not-found',
    })
    expect(playback.queue).toEqual([])
    expect(fake.calls.load).toEqual([])
  })

  it('사용자 요청은 autoplay: true 로 간다', () => {
    const { coordinator, fake, library, playlistId } = setup()
    const ids = trackIds(library, playlistId)

    coordinator.playTrack(playlistId, ids[2] ?? '')

    expect(fake.calls.load.every((call) => call.autoplay)).toBe(true)
  })

  it('어댑터가 없어도 큐는 만들어지고 던지지 않는다', () => {
    const library = useLibraryStore()
    const playback = usePlaybackStore()
    const created = library.createPlaylist('A')
    const id = created.ok ? created.playlistId : ''
    library.addTrack(id, { videoId: VIDEO[0], title: 'One' })

    const coordinator = createPlaybackCoordinator()

    expect(coordinator.playPlaylist(id)).toEqual({ ok: true })
    expect(playback.queue).toHaveLength(1)
  })
})

describe('B. 큐 스냅샷 독립성', () => {
  it('큐의 트랙은 라이브러리와 다른 객체다', () => {
    const { library, playback, coordinator, playlistId } = setup()

    coordinator.playPlaylist(playlistId)

    const source = library.getPlaylist(playlistId)?.tracks ?? []
    expect(playback.queue[0]).toEqual(source[0])
    // 값은 같지만 객체는 다르다. 한쪽을 고쳐도 다른 쪽이 흔들리지 않는다.
    expect(playback.queue[0]).not.toBe(source[0])
  })

  it('재생 중 트랙을 추가·삭제·이동해도 큐가 그대로다', () => {
    const { library, playback, coordinator, playlistId } = setup()
    coordinator.playPlaylist(playlistId)
    const before = { queue: [...playback.queue], index: playback.queueIndex }
    const ids = trackIds(library, playlistId)

    library.addTrack(playlistId, { videoId: VIDEO[0], title: 'Track 4' })
    library.removeTrack(playlistId, ids[0] ?? '')
    library.moveTrack(playlistId, ids[2] ?? '', 'up')

    expect(playback.queue).toEqual(before.queue)
    expect(playback.queueIndex).toBe(before.index)
  })

  it('재생 중인 목록의 이름을 바꾸거나 지워도 큐가 그대로다', () => {
    const { library, playback, coordinator, playlistId } = setup()
    coordinator.playPlaylist(playlistId)
    const before = [...playback.queue]

    library.renamePlaylist(playlistId, 'RENAMED')
    library.deletePlaylist(playlistId)

    expect(library.getPlaylist(playlistId)).toBeUndefined()
    expect(playback.queue).toEqual(before)
    expect(playback.currentTrack).not.toBeNull()
  })

  it('다른 목록을 선택해도 큐가 그대로다', () => {
    const { library, playback, coordinator, playlistId } = setup()
    coordinator.playPlaylist(playlistId)
    const before = [...playback.queue]

    const other = library.createPlaylist('PLAYLIST B')
    library.selectPlaylist(other.ok ? other.playlistId : '')

    expect(playback.queue).toEqual(before)
    expect(playback.queueIndex).toBe(0)
  })

  it('큐를 바꿔도 라이브러리가 그대로다', () => {
    const { library, playback, coordinator, playlistId } = setup()
    coordinator.playPlaylist(playlistId)

    playback.setQueueIndex(2)

    expect(trackIds(library, playlistId)).toHaveLength(3)
    expect(library.getPlaylist(playlistId)?.name).toBe('PLAYLIST A')
  })
})

describe('C. 큐 진행', () => {
  it('재생이 끝나면 다음 트랙으로 넘어간다', () => {
    const { playback, coordinator, fake, playlistId } = setup()
    coordinator.playPlaylist(playlistId)

    fake.emitStateChange('playing')
    fake.emitStateChange('ended')

    expect(playback.queueIndex).toBe(1)
    expect(playback.currentTrack?.title).toBe('Track 2')
    expect(fake.calls.load).toEqual([
      { videoId: VIDEO[0], autoplay: true },
      { videoId: VIDEO[1], autoplay: true },
    ])
  })

  it('끝까지 가면 마지막에서 멈춘다', () => {
    const { playback, coordinator, fake, playlistId } = setup()
    coordinator.playPlaylist(playlistId)

    for (let round = 0; round < 3; round += 1) {
      fake.emitStateChange('playing')
      fake.emitStateChange('ended')
    }

    // 3곡이므로 전환은 두 번뿐이다. 처음으로 돌아가지 않는다 (M3-0.1).
    expect(playback.queueIndex).toBe(2)
    expect(playback.currentTrack?.title).toBe('Track 3')
    expect(fake.calls.load).toHaveLength(3)
    expect(playback.statusMessage).toBe('마지막 곡까지 재생했습니다.')
    expect(playback.statusTone).toBe('info')
  })

  it('마지막 곡이 끝나도 큐를 비우거나 되감지 않는다', () => {
    const { playback, coordinator, fake, library, playlistId } = setup(1)
    coordinator.playPlaylist(playlistId)

    fake.emitStateChange('playing')
    fake.emitStateChange('ended')

    expect(playback.queue).toHaveLength(1)
    expect(playback.queueIndex).toBe(0)
    expect(playback.currentTrack?.id).toBe(trackIds(library, playlistId)[0])
    expect(fake.calls.load).toHaveLength(1)
  })

  it('재생된 적 없는 트랙의 ENDED 는 무시한다', () => {
    const { playback, coordinator, fake, playlistId } = setup()
    coordinator.playPlaylist(playlistId)

    // playing 없이 바로 ended. 이전 트랙의 늦은 신호로 본다.
    fake.emitStateChange('ended')

    expect(playback.queueIndex).toBe(0)
    expect(fake.calls.load).toHaveLength(1)
  })

  it('자동 전환 직후 도착한 ENDED 가 한 곡을 더 건너뛰지 않는다', () => {
    const { playback, coordinator, fake, playlistId } = setup()
    coordinator.playPlaylist(playlistId)

    fake.emitStateChange('playing')
    fake.emitStateChange('ended') // Track 1 끝 → Track 2 적재
    fake.emitStateChange('ended') // 늦게 도착한 Track 1 의 신호

    expect(playback.queueIndex).toBe(1)
    expect(fake.calls.load).toHaveLength(2)
  })

  it('어댑터 상태가 playback store 에 그대로 반영된다', () => {
    const { playback, fake } = setup()

    for (const state of ['loading', 'playing', 'paused', 'ended'] as const) {
      fake.emitStateChange(state)
      expect(playback.playerState).toBe(state)
    }
  })

  it('store 의 advance / back 이 큐 경계를 지킨다', () => {
    const { playback, coordinator, playlistId } = setup()
    coordinator.playPlaylist(playlistId)

    expect(playback.back()).toBe(false)
    expect(playback.queueIndex).toBe(0)
    expect(playback.advance()).toBe(true)
    expect(playback.advance()).toBe(true)
    expect(playback.advance()).toBe(false)
    expect(playback.queueIndex).toBe(2)
    expect(playback.back()).toBe(true)
    expect(playback.currentTrack?.title).toBe('Track 2')
  })

  it('빈 큐에서 advance / back 이 움직이지 않는다', () => {
    const { playback } = setup()

    expect(playback.advance()).toBe(false)
    expect(playback.back()).toBe(false)
    expect(playback.queueIndex).toBe(-1)
    expect(playback.currentTrack).toBeNull()
  })
})

describe('D. 오류와 자동재생 차단', () => {
  it('재생 불가 영상에서 자동으로 다음 곡으로 넘기지 않는다', () => {
    const { playback, coordinator, fake, playlistId } = setup()
    coordinator.playPlaylist(playlistId)

    fake.emitError({ kind: 'embed-not-allowed', code: 101 })

    expect(playback.queueIndex).toBe(0)
    expect(fake.calls.load).toHaveLength(1)
    expect(playback.playerState).toBe('error')
    expect(playback.statusTone).toBe('warning')
    expect(playback.statusMessage).toContain('오류 101')
  })

  it('오류 뒤에 ENDED 가 와도 넘기지 않는다', () => {
    const { playback, coordinator, fake, playlistId } = setup()
    coordinator.playPlaylist(playlistId)

    fake.emitStateChange('playing')
    fake.emitError({ kind: 'not-playable', code: 5 })
    fake.emitStateChange('ended')

    // 사용자의 명시적인 다음 동작을 기다린다 (M3-0.7).
    expect(playback.queueIndex).toBe(0)
    expect(fake.calls.load).toHaveLength(1)
  })

  it('사용자가 다시 요청하면 자동 전환이 되살아난다', () => {
    const { playback, coordinator, fake, library, playlistId } = setup()
    coordinator.playPlaylist(playlistId)
    fake.emitError({ kind: 'embed-not-allowed', code: 150 })

    const ids = trackIds(library, playlistId)
    coordinator.playTrack(playlistId, ids[1] ?? '')
    fake.emitStateChange('playing')
    fake.emitStateChange('ended')

    expect(playback.queueIndex).toBe(2)
    expect(playback.statusMessage).toBe('')
  })

  it('API 를 못 불러온 경우를 따로 안내한다', () => {
    const { playback, coordinator, fake, playlistId } = setup()
    coordinator.playPlaylist(playlistId)

    fake.emitError({ kind: 'api-unavailable', code: null })

    expect(playback.statusMessage).toContain('네트워크')
    expect(playback.statusMessage).not.toContain('null')
  })

  it('자동재생 차단은 오류가 아니지만 자동 전환을 멈춘다', () => {
    const { playback, coordinator, fake, playlistId } = setup()
    coordinator.playPlaylist(playlistId)

    fake.emitAutoplayBlocked()
    fake.emitStateChange('ended')

    expect(playback.queueIndex).toBe(0)
    expect(playback.playerState).not.toBe('error')
    expect(playback.statusMessage).toContain('자동재생')
  })

  it('재생된 적 있는 트랙이라도 차단 안내 뒤에는 자동 전환하지 않는다', () => {
    const { playback, coordinator, fake, playlistId } = setup()
    coordinator.playPlaylist(playlistId)

    // "직접 ▶ 를 눌러주세요" 라고 해놓고 큐를 혼자 넘기면 안 된다.
    // 재생 이력 가드만으로는 이 경우를 막지 못한다.
    fake.emitStateChange('playing')
    fake.emitAutoplayBlocked()
    fake.emitStateChange('ended')

    expect(playback.queueIndex).toBe(0)
    expect(fake.calls.load).toHaveLength(1)
  })

  it('실제로 재생이 시작되면 안내가 사라진다', () => {
    const { playback, coordinator, fake, playlistId } = setup()
    coordinator.playPlaylist(playlistId)
    fake.emitAutoplayBlocked()

    fake.emitStateChange('playing')

    expect(playback.statusMessage).toBe('')
    expect(playback.statusTone).toBe('info')
  })
})

describe('E. 빠른 연속 요청', () => {
  it('연달아 고르면 마지막 요청이 이긴다', () => {
    const { playback, coordinator, fake, library, playlistId } = setup()
    const ids = trackIds(library, playlistId)

    coordinator.playTrack(playlistId, ids[0] ?? '')
    coordinator.playTrack(playlistId, ids[2] ?? '')
    coordinator.playTrack(playlistId, ids[1] ?? '')

    expect(playback.queueIndex).toBe(1)
    expect(playback.currentTrack?.title).toBe('Track 2')
    expect(fake.calls.load.map((call) => call.videoId)).toEqual([VIDEO[0], VIDEO[2], VIDEO[1]])
  })

  it('바꾸기 직전 트랙의 ENDED 가 고른 곡을 건너뛰지 않는다', () => {
    const { playback, coordinator, fake, library, playlistId } = setup()
    const ids = trackIds(library, playlistId)

    coordinator.playTrack(playlistId, ids[0] ?? '')
    fake.emitStateChange('playing')
    // 사용자가 Track 2 를 고른다.
    coordinator.playTrack(playlistId, ids[1] ?? '')
    // Track 1 의 ENDED 가 뒤늦게 도착한다.
    fake.emitStateChange('ended')

    // 고른 곡이 Track 2 그대로여야 한다. Track 3 로 넘어가면 안 된다.
    expect(playback.queueIndex).toBe(1)
    expect(fake.calls.load).toHaveLength(2)
  })

  it('새 요청은 앞선 오류 안내를 지운다', () => {
    const { playback, coordinator, fake, playlistId } = setup()
    coordinator.playPlaylist(playlistId)
    fake.emitError({ kind: 'not-found', code: 100 })
    expect(playback.statusMessage).not.toBe('')

    coordinator.playPlaylist(playlistId)

    expect(playback.statusMessage).toBe('')
  })
})

describe('F. 어댑터 등록과 소유권', () => {
  it('detach 후에는 명령이 어댑터에 가지 않는다', () => {
    const { coordinator, fake, attachment, playlistId } = setup()

    attachment.detach()
    coordinator.playPlaylist(playlistId)

    expect(fake.calls.load).toEqual([])
  })

  it('detach 가 어댑터를 없애지 않는다', () => {
    const { fake, attachment } = setup()

    attachment.detach()

    // 만들고 없애는 책임은 PlayerSurface 에 있다 (ADR 0006).
    expect(fake.calls.destroy).toBe(0)
    expect(fake.isMounted).toBe(true)
  })

  it('두 번째 어댑터가 등록되면 마지막 것이 이긴다', () => {
    const { coordinator, fake, playlistId } = setup()
    const second = new FakePlayerAdapter()
    const attachment = coordinator.attachAdapter(second)
    second.mount(document.createElement('div'), attachment.events)

    coordinator.playPlaylist(playlistId)

    expect(fake.calls.load).toEqual([])
    expect(second.calls.load).toHaveLength(1)
  })

  it('늦게 온 detach 가 새 어댑터의 연결을 끊지 않는다', () => {
    const { coordinator, fake, attachment, playlistId } = setup()
    const second = new FakePlayerAdapter()
    const secondAttachment = coordinator.attachAdapter(second)
    second.mount(document.createElement('div'), secondAttachment.events)

    attachment.detach()
    coordinator.playPlaylist(playlistId)

    expect(second.calls.load).toHaveLength(1)
    expect(fake.calls.load).toEqual([])
  })

  it('어댑터와 DOM 노드가 Pinia state 에 들어가지 않는다', () => {
    const { coordinator, playlistId } = setup()
    coordinator.playPlaylist(playlistId)

    const serialized = JSON.stringify(pinia.state.value)

    expect(serialized).not.toContain('fakePlayerHost')
    expect(serialized).not.toContain('hostNode')
    expect(Object.keys(pinia.state.value).sort()).toEqual(['library', 'playback'])
  })
})
