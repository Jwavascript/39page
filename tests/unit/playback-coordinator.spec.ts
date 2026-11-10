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
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { createPinia, setActivePinia, type Pinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createPlaybackCoordinator } from '@/features/playback/createPlaybackCoordinator'
import { FakePlayerAdapter } from '@/features/playback/FakePlayerAdapter'
import type { PlaybackCoordinator } from '@/features/playback/playbackCoordinator'
import type { PlayerAdapter } from '@/features/playback/PlayerAdapter'
import type { PlayerPresence } from '@/features/playback/playerVisibility'
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

  it('코디네이터의 next / previous 가 큐 경계를 넘지 않는다', () => {
    // 버튼도 비활성이지만 여기서 한 번 더 막는다. UI 가드가 사라져도
    // 큐가 처음으로 되감기면 안 된다 (M3-0.1).
    const { playback, coordinator, fake, playlistId } = setup()
    coordinator.playPlaylist(playlistId)

    expect(coordinator.previous()).toBe(false)
    expect(playback.queueIndex).toBe(0)
    expect(fake.calls.load).toHaveLength(1)

    expect(coordinator.next()).toBe(true)
    expect(coordinator.next()).toBe(true)
    expect(playback.queueIndex).toBe(2)

    expect(coordinator.next()).toBe(false)
    expect(playback.queueIndex).toBe(2)
    expect(playback.currentTrack?.title).toBe('Track 3')
    expect(fake.calls.load).toHaveLength(3)

    expect(coordinator.previous()).toBe(true)
    expect(playback.queueIndex).toBe(1)
  })

  it('빈 큐에서 코디네이터의 next / previous 가 아무 일도 하지 않는다', () => {
    const { playback, coordinator, fake } = setup()

    expect(coordinator.next()).toBe(false)
    expect(coordinator.previous()).toBe(false)
    expect(playback.queueIndex).toBe(-1)
    expect(fake.calls.load).toEqual([])
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

/* ================================================================== *
 * G. Music Moments (M9-3, ADR 0020)
 * ================================================================== */

describe('G. Music Moments — capturePosition() 과 playMoment()', () => {
  /** 라이브러리 어디에도 없는 영상. */
  const ORPHAN = 'zzzzzzzzzzz'

  function readSource(relative: string): string {
    return readFileSync(resolve(process.cwd(), relative), 'utf8')
  }

  function stripComments(code: string): string {
    return code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
  }

  /** 항상 가려져 있다고 재는 플레이어 영역. */
  function hiddenPresence(): PlayerPresence {
    return {
      measure: () => ({ ok: false, reason: 'covered' }),
      reveal: () => {},
    }
  }

  /** 재생 중 83.7초. 캡처가 성립하는 가장 평범한 상태다. */
  function playingAt(seconds: number) {
    const context = setup()
    context.coordinator.playPlaylist(context.playlistId)
    context.fake.emitReady()
    context.fake.emitStateChange('playing')
    context.fake.emitPosition(seconds)
    return context
  }

  describe('capturePosition()', () => {
    it('정상 재생 중 현재 영상·시점·제목을 찍는다', () => {
      const { coordinator } = playingAt(83.7)

      expect(coordinator.capturePosition()).toEqual({
        videoId: VIDEO[0],
        atSeconds: 83,
        title: 'Track 1',
      })
    })

    it('소수 초를 내림한다 — 0.9 는 0 이다', () => {
      const { coordinator, fake } = playingAt(0.9)

      expect(coordinator.capturePosition()?.atSeconds).toBe(0)

      fake.emitPosition(119.999)
      expect(coordinator.capturePosition()?.atSeconds).toBe(119)
    })

    it('0 초는 유효한 캡처다', () => {
      const { coordinator } = playingAt(0)

      expect(coordinator.capturePosition()).toMatchObject({ atSeconds: 0 })
    })

    it('현재 트랙이 없으면 null 이다', () => {
      const { coordinator, fake } = setup()
      fake.emitReady()
      fake.emitPosition(10)

      expect(coordinator.capturePosition()).toBeNull()
    })

    it('재생 준비 전에는 null 이다 — 0 으로 대체하지 않는다', () => {
      const { coordinator, playlistId } = setup()
      coordinator.playPlaylist(playlistId)

      expect(coordinator.capturePosition()).toBeNull()
    })

    it('플레이어가 아직 보고하지 않았으면 null 이다', () => {
      const { coordinator, fake, playlistId } = setup()
      coordinator.playPlaylist(playlistId)
      fake.emitReady()

      expect(coordinator.capturePosition()).toBeNull()
    })

    it.each([
      ['NaN', Number.NaN],
      ['Infinity', Number.POSITIVE_INFINITY],
      ['음수', -3],
    ])('플레이어가 %s 를 주면 null 이다', (_label, seconds) => {
      const { coordinator } = playingAt(seconds)

      expect(coordinator.capturePosition()).toBeNull()
    })

    it('플레이어가 등록돼 있지 않으면 null 이다', () => {
      const library = useLibraryStore()
      const created = library.createPlaylist('P')
      const playlistId = created.ok ? created.playlistId : ''
      library.addTrack(playlistId, { videoId: VIDEO[0] })
      const coordinator = createPlaybackCoordinator()
      coordinator.playPlaylist(playlistId)

      expect(coordinator.capturePosition()).toBeNull()
    })

    /*
     * 어댑터 계약은 유효하지 않은 값을 `null` 로 가리지만, 코디네이터는 다른
     * 구현체의 성실함에 기대지 않는다. 계약을 어기는 어댑터로 직접 확인한다.
     */
    it.each([
      ['NaN', Number.NaN],
      ['Infinity', Number.POSITIVE_INFINITY],
      ['음수', -7],
    ])(
      '계약을 어기고 %s 를 돌려주는 어댑터라도 0 으로 대체하지 않고 null 이다',
      (_label, value) => {
        const { coordinator, playlistId } = setup()
        const misbehaving: PlayerAdapter = {
          mount: () => {},
          destroy: () => {},
          load: () => {},
          play: () => {},
          pause: () => {},
          state: () => 'playing',
          position: () => value,
          seek: () => {},
        }
        const attachment = coordinator.attachAdapter(misbehaving)
        coordinator.playPlaylist(playlistId)
        /*
         * 재생이 실제로 시작된 상태로 만든다 (M9-4). 그래야 이 테스트가 보려는
         * **숫자 검증**까지 내려간다 — 재생 전이면 그 앞의 신뢰 판정이 먼저
         * `null` 을 돌려주므로, 숫자 검증을 지워도 이 테스트가 통과해 버린다.
         */
        attachment.events.stateChange?.('playing')

        expect(coordinator.capturePosition()).toBeNull()
      },
    )

    it('영상 전환 직후 이전 영상의 위치를 새 영상의 것으로 찍지 않는다', () => {
      const { coordinator, fake, library, playlistId } = playingAt(83)
      const ids = trackIds(library, playlistId)
      expect(coordinator.capturePosition()?.videoId).toBe(VIDEO[0])

      // 사용자가 Track 2 를 고른다. 플레이어는 아직 Track 1 의 83초를 들고 있다.
      coordinator.playTrack(playlistId, ids[1] ?? '')

      expect(coordinator.capturePosition()).toBeNull()

      /*
       * Track 2 가 `0` 을 보고하기 시작했다. **아직 믿지 않는다** (M9-4).
       *
       * 실제 플레이어는 새 영상을 적재한 뒤 지정 시점으로 가기 전 약 200ms
       * 동안 `0` 을 보고한다 (M9-3 실측). 영상은 맞고 시간만 틀린 값이라
       * 어댑터의 영상 식별로는 거를 수 없다. M9-3 까지 이 자리는 캡처를
       * 돌려줬다 — 0초짜리 Moment 가 생길 수 있는 창이었다.
       */
      fake.emitPosition(0)
      expect(coordinator.capturePosition()).toBeNull()

      // 실제로 재생이 시작된 뒤의 0 은 **정상적으로 확인된 0초**다. 유효하다.
      fake.emitStateChange('playing')
      expect(coordinator.capturePosition()).toEqual({
        videoId: VIDEO[1],
        atSeconds: 0,
        title: 'Track 2',
      })
    })

    it('시점을 실은 적재 직후의 가짜 0 을 찍지 않는다 — 지정 시점에서 재생된 뒤에 찍는다', () => {
      const { coordinator, fake } = playingAt(10)

      // 다른 영상의 Moment 로 간다. 플레이어는 60 으로 가기 전에 0 을 먼저 보고한다.
      coordinator.playMoment({ videoId: VIDEO[2], atSeconds: 60 })
      fake.emitStateChange('paused')
      fake.emitPosition(0)
      expect(coordinator.capturePosition()).toBeNull()
      fake.emitStateChange('idle')
      fake.emitStateChange('loading')
      expect(coordinator.capturePosition()).toBeNull()

      fake.emitPosition(60.06)
      fake.emitStateChange('playing')
      expect(coordinator.capturePosition()).toMatchObject({ videoId: VIDEO[2], atSeconds: 60 })
    })

    it('같은 영상 안에서 시점을 옮긴 직후에도 재생이 다시 시작된 뒤에 찍는다', () => {
      const { coordinator, fake } = playingAt(10)

      coordinator.playMoment({ videoId: VIDEO[0], atSeconds: 83 })
      fake.emitStateChange('loading')
      expect(coordinator.capturePosition()).toBeNull()

      fake.emitPosition(83.02)
      fake.emitStateChange('playing')
      expect(coordinator.capturePosition()?.atSeconds).toBe(83)
    })

    it('재생 중 오류가 나면 찍지 않는다 — 그 위치를 믿을 근거가 없다', () => {
      const { coordinator, fake } = playingAt(40)

      fake.emitError({ kind: 'not-playable', code: 5 })

      expect(coordinator.capturePosition()).toBeNull()
    })

    it('재생이 시작된 뒤의 버퍼링·끝 상태에서는 찍는다 — 플레이어가 실제로 있던 자리다', () => {
      // 한 곡짜리 큐다. 끝나도 다음 곡으로 넘어가지 않아 그 자리에 머문다.
      const { coordinator, fake, playlistId } = setup(1)
      coordinator.playPlaylist(playlistId)
      fake.emitReady()
      fake.emitStateChange('playing')
      fake.emitPosition(40)

      // 재생 중 네트워크 버퍼링. 명령한 것이 아니므로 재생 시작 표시는 그대로다.
      fake.emitStateChange('loading')
      expect(coordinator.capturePosition()?.atSeconds).toBe(40)

      fake.emitPosition(212.4)
      fake.emitStateChange('ended')
      expect(coordinator.capturePosition()?.atSeconds).toBe(212)
    })

    it('일시정지 중에도 찍을 수 있다 — 재생 상태가 조건이 아니다', () => {
      const { coordinator, fake } = playingAt(40)
      fake.emitStateChange('paused')

      expect(coordinator.capturePosition()?.atSeconds).toBe(40)
    })

    it('캡처는 저장하지 않는다 — Moments 저장소에 아무것도 쓰지 않는다', () => {
      const { coordinator } = playingAt(40)

      coordinator.capturePosition()

      expect(globalThis.localStorage.getItem('39page.moments')).toBeNull()
    })
  })

  describe('playMoment() — 같은 영상', () => {
    it('지금 영상이면 다시 적재하지 않고 seek 과 play 만 보낸다', () => {
      const { coordinator, fake, playback } = playingAt(10)
      const queueBefore = playback.queue.map((track) => track.id)

      const result = coordinator.playMoment({ videoId: VIDEO[0], atSeconds: 83 })

      expect(result).toEqual({ ok: true })
      expect(fake.calls.seek).toEqual([83])
      expect(fake.calls.play).toBe(1)
      // 적재는 처음 playPlaylist 의 한 번뿐이다.
      expect(fake.calls.load).toHaveLength(1)
      expect(playback.queue.map((track) => track.id)).toEqual(queueBefore)
      expect(playback.queueIndex).toBe(0)
    })

    it('0 초 Moment 로도 seek 한다', () => {
      const { coordinator, fake } = playingAt(50)

      expect(coordinator.playMoment({ videoId: VIDEO[0], atSeconds: 0 })).toEqual({ ok: true })

      expect(fake.calls.seek).toEqual([0])
    })

    it('일시정지 중이면 seek 뒤에 play 로 재생을 보장한다', () => {
      const { coordinator, fake } = playingAt(10)
      fake.emitStateChange('paused')

      coordinator.playMoment({ videoId: VIDEO[0], atSeconds: 30 })

      // YouTube 는 일시정지 중의 seekTo 에서 멈춘 채 남는다.
      expect(fake.calls.seek).toEqual([30])
      expect(fake.calls.play).toBe(1)
    })

    it('준비 전이면 seek 대신 시점을 실어 다시 적재한다', () => {
      const { coordinator, fake, playlistId } = setup()
      coordinator.playPlaylist(playlistId)

      const result = coordinator.playMoment({ videoId: VIDEO[0], atSeconds: 83 })

      expect(result).toEqual({ ok: true })
      // 준비 전 seek 은 버려지고 play 만 남아 처음부터 재생된다. 그 길로 가지 않는다.
      expect(fake.calls.seek).toEqual([])
      expect(fake.calls.load).toEqual([
        { videoId: VIDEO[0], autoplay: true },
        { videoId: VIDEO[0], autoplay: true, startSeconds: 83 },
      ])
    })

    it('오류 상태면 다시 적재한다 — 실패한 플레이어에 seek 을 보내지 않는다', () => {
      const { coordinator, fake, playback } = playingAt(10)
      fake.emitError({ kind: 'embed-not-allowed', code: 101 })
      expect(playback.statusMessage).toContain('오류 101')

      const result = coordinator.playMoment({ videoId: VIDEO[0], atSeconds: 83 })

      expect(result).toEqual({ ok: true })
      expect(fake.calls.seek).toEqual([])
      expect(fake.calls.load[1]).toEqual({ videoId: VIDEO[0], autoplay: true, startSeconds: 83 })
      // 사용자의 새 요청이 앞선 안내를 지운다 (다른 요청과 같다).
      expect(playback.statusMessage).toBe('')
    })

    it('seek 뒤 재생이 시작되기 전에 온 ENDED 는 오래된 신호로 보고 넘기지 않는다', () => {
      const { coordinator, fake, playback } = playingAt(170)

      coordinator.playMoment({ videoId: VIDEO[0], atSeconds: 10 })
      // 끝나 가던 영상의 ENDED 가 seek 뒤에 도착한다.
      fake.emitStateChange('ended')

      expect(playback.queueIndex).toBe(0)
      expect(fake.calls.load).toHaveLength(1)
    })

    it('seek 뒤 실제로 재생된 다음의 ENDED 는 평소처럼 다음 곡으로 간다', () => {
      const { coordinator, fake, playback } = playingAt(170)

      coordinator.playMoment({ videoId: VIDEO[0], atSeconds: 10 })
      fake.emitStateChange('loading')
      fake.emitStateChange('playing')
      fake.emitStateChange('ended')

      expect(playback.queueIndex).toBe(1)
      expect(fake.calls.load).toHaveLength(2)
      // 다음 곡은 처음부터다. Moment 의 시점이 묻어가지 않는다.
      expect(fake.calls.load[1]).toEqual({ videoId: VIDEO[1], autoplay: true })
    })

    it('같은 영상이 큐에 두 번 있어도 지금 자리를 지킨다', () => {
      const { library, playlistId, coordinator, fake, playback } = setup(0)
      // 같은 영상 둘.
      library.addTrack(playlistId, { videoId: VIDEO[0], title: 'first' })
      library.addTrack(playlistId, { videoId: VIDEO[0], title: 'second' })
      const ids = trackIds(library, playlistId)
      coordinator.playTrack(playlistId, ids[1] ?? '')
      fake.emitReady()
      fake.emitStateChange('playing')
      fake.emitPosition(5)

      coordinator.playMoment({ videoId: VIDEO[0], atSeconds: 40 })

      expect(playback.queueIndex).toBe(1)
      expect(fake.calls.seek).toEqual([40])
    })
  })

  describe('playMoment() — 다른 영상', () => {
    it('현재 큐 안의 영상이면 큐를 바꾸지 않고 자리만 옮긴다', () => {
      const { coordinator, fake, playback } = playingAt(10)
      const queueBefore = playback.queue.map((track) => track.id)

      const result = coordinator.playMoment({ videoId: VIDEO[1], atSeconds: 30 })

      expect(result).toEqual({ ok: true })
      expect(playback.queue.map((track) => track.id)).toEqual(queueBefore)
      expect(playback.queueIndex).toBe(1)
      expect(playback.currentTrack?.title).toBe('Track 2')
      expect(fake.calls.load[1]).toEqual({ videoId: VIDEO[1], autoplay: true, startSeconds: 30 })
      // 다른 영상으로는 seek 을 보내지 않는다 — 경쟁이 생긴다.
      expect(fake.calls.seek).toEqual([])
    })

    it('큐가 있어도 선택 목록이 바뀌었다는 이유로 큐를 갈아치우지 않는다', () => {
      const { coordinator, library, playback } = playingAt(10)
      // 사용자가 듣는 중에 다른 목록을 만들어 선택한다. 그 목록에도 같은 영상이 있다.
      const other = library.createPlaylist('OTHER')
      const otherId = other.ok ? other.playlistId : ''
      library.addTrack(otherId, { videoId: VIDEO[1], title: 'elsewhere' })
      expect(library.selectedPlaylistId).toBe(otherId)
      const queueBefore = playback.queue.map((track) => track.id)

      coordinator.playMoment({ videoId: VIDEO[1], atSeconds: 30 })

      expect(playback.queue.map((track) => track.id)).toEqual(queueBefore)
      expect(playback.currentTrack?.title).toBe('Track 2')
    })

    it('큐에 없으면 선택된 플레이리스트에서 찾아 그 목록을 큐로 만든다', () => {
      const { coordinator, library, playback, fake } = setup()
      const other = library.createPlaylist('OTHER')
      const otherId = other.ok ? other.playlistId : ''
      library.addTrack(otherId, { videoId: ORPHAN, title: 'Orphan in OTHER' })
      library.addTrack(otherId, { videoId: VIDEO[2], title: 'Tail' })
      expect(playback.queue).toEqual([])

      const result = coordinator.playMoment({ videoId: ORPHAN, atSeconds: 5 })

      expect(result).toEqual({ ok: true })
      expect(playback.queue.map((track) => track.title)).toEqual(['Orphan in OTHER', 'Tail'])
      expect(playback.queueIndex).toBe(0)
      expect(fake.calls.load).toEqual([{ videoId: ORPHAN, autoplay: true, startSeconds: 5 }])
    })

    it('선택 목록에 없으면 다른 목록 중 처음 발견한 것을 큐로 만든다', () => {
      const { coordinator, library, playback, playlistId } = setup()
      const selected = library.createPlaylist('SELECTED (없음)')
      expect(selected.ok && library.selectedPlaylistId).toBe(
        selected.ok ? selected.playlistId : null,
      )

      // PLAYLIST A 에만 VIDEO[1] 이 있다.
      coordinator.playMoment({ videoId: VIDEO[1], atSeconds: 7 })

      expect(playback.queue.map((track) => track.title)).toEqual(['Track 1', 'Track 2', 'Track 3'])
      expect(playback.queueIndex).toBe(1)
      expect(library.getPlaylist(playlistId)?.name).toBe('PLAYLIST A')
    })

    it('선택 목록과 다른 목록에 모두 있으면 선택 목록이 이긴다', () => {
      const { coordinator, library, playback } = setup()
      const other = library.createPlaylist('SELECTED B')
      const otherId = other.ok ? other.playlistId : ''
      library.addTrack(otherId, { videoId: VIDEO[1], title: 'B has it too' })

      coordinator.playMoment({ videoId: VIDEO[1], atSeconds: 7 })

      expect(playback.queue.map((track) => track.title)).toEqual(['B has it too'])
    })

    it('큐는 라이브러리의 스냅샷이다 — 이후 편집에 흔들리지 않는다', () => {
      const { coordinator, library, playback, playlistId } = setup()
      const ids = trackIds(library, playlistId)

      coordinator.playMoment({ videoId: VIDEO[1], atSeconds: 7 })
      library.removeTrack(playlistId, ids[2] ?? '')
      library.renameTrack(playlistId, ids[1] ?? '', 'RENAMED')

      expect(playback.queue).toHaveLength(3)
      expect(playback.currentTrack?.title).toBe('Track 2')
    })

    it('라이브러리에서 지운 영상의 Moment 는 그 한 곡만으로 재생한다', () => {
      const { coordinator, library, playback, fake, playlistId } = setup()
      const ids = trackIds(library, playlistId)
      // Track 2 를 지운다. Moment 는 videoId 를 가리키므로 남아 있다.
      library.removeTrack(playlistId, ids[1] ?? '')
      // 다른 트랙도 같은 영상을 쓰지 않게 한다 (VIDEO[1] 은 Track 2 만 썼다).
      expect(library.getPlaylist(playlistId)?.tracks.some((t) => t.videoId === VIDEO[1])).toBe(
        false,
      )

      const result = coordinator.playMoment({
        videoId: VIDEO[1],
        atSeconds: 42,
        title: '지운 곡의 스냅샷 제목',
      })

      expect(result).toEqual({ ok: true })
      expect(playback.queue).toHaveLength(1)
      expect(playback.currentTrack).toMatchObject({
        source: 'youtube',
        videoId: VIDEO[1],
        title: '지운 곡의 스냅샷 제목',
      })
      expect(fake.calls.load).toEqual([{ videoId: VIDEO[1], autoplay: true, startSeconds: 42 }])
    })

    it('단일 곡 큐에서 이전·다음은 움직이지 않는다', () => {
      const { coordinator, playback, fake } = setup(0)

      coordinator.playMoment({ videoId: ORPHAN, atSeconds: 1 })

      expect(coordinator.next()).toBe(false)
      expect(coordinator.previous()).toBe(false)
      expect(playback.queueIndex).toBe(0)
      expect(fake.calls.load).toHaveLength(1)
    })

    it('단일 곡의 ENDED 는 큐 끝 안내로 끝난다', () => {
      const { coordinator, playback, fake } = setup(0)
      coordinator.playMoment({ videoId: ORPHAN, atSeconds: 1 })

      fake.emitStateChange('playing')
      fake.emitStateChange('ended')

      expect(playback.statusMessage).toContain('마지막 곡')
      expect(fake.calls.load).toHaveLength(1)
    })

    it('제목이 없으면 트랙과 같은 대체 표기를 쓴다', () => {
      const { coordinator, playback } = setup(0)

      coordinator.playMoment({ videoId: ORPHAN, atSeconds: 1 })

      expect(playback.currentTrack?.title).toBe(`YouTube · ${ORPHAN}`)
    })

    it('단일 곡의 id 는 라이브러리 트랙 id 와 겹치지 않아 trackRemoved 에 걸리지 않는다', () => {
      const { coordinator, playback, fake, library, playlistId } = setup()
      const ids = trackIds(library, playlistId)
      coordinator.playMoment({ videoId: ORPHAN, atSeconds: 1 })
      const current = playback.currentTrack

      // 라이브러리의 어떤 트랙을 지워도 단일 곡 재생은 멈추지 않는다.
      for (const id of ids) coordinator.trackRemoved(id)

      expect(fake.calls.pause).toBe(0)
      expect(playback.currentTrack).toBe(current)
      expect(ids).not.toContain(current?.id)
    })

    it('0 초 Moment 는 startSeconds 0 으로 적재한다 — 생략과 다르다', () => {
      const { coordinator, fake } = setup()

      coordinator.playMoment({ videoId: VIDEO[2], atSeconds: 0 })

      expect(fake.calls.load).toEqual([{ videoId: VIDEO[2], autoplay: true, startSeconds: 0 }])
    })

    it('Moment 로 시작한 큐도 다음·이전이 평소처럼 처음부터 재생한다', () => {
      const { coordinator, playback, fake } = setup()
      coordinator.playMoment({ videoId: VIDEO[1], atSeconds: 30 })

      expect(coordinator.next()).toBe(true)
      expect(playback.queueIndex).toBe(2)
      expect(fake.calls.load[1]).toEqual({ videoId: VIDEO[2], autoplay: true })

      expect(coordinator.previous()).toBe(true)
      expect(fake.calls.load[2]).toEqual({ videoId: VIDEO[1], autoplay: true })
      expect(fake.calls.load[2]).not.toHaveProperty('startSeconds')
    })

    it('Moment 로 시작한 재생도 ENDED 에서 자동으로 다음 곡으로 간다', () => {
      const { coordinator, playback, fake } = setup()
      coordinator.playMoment({ videoId: VIDEO[0], atSeconds: 30 })

      fake.emitStateChange('playing')
      fake.emitStateChange('ended')

      expect(playback.queueIndex).toBe(1)
      expect(fake.calls.load[1]).toEqual({ videoId: VIDEO[1], autoplay: true })
    })
  })

  describe('playMoment() — 거절과 실패', () => {
    it.each([
      ['10자 videoId', { videoId: 'abcdefghij', atSeconds: 10 }],
      ['빈 videoId', { videoId: '', atSeconds: 10 }],
      ['음수 시점', { videoId: 'aaaaaaaaaaa', atSeconds: -1 }],
      ['소수 시점', { videoId: 'aaaaaaaaaaa', atSeconds: 1.5 }],
      ['NaN 시점', { videoId: 'aaaaaaaaaaa', atSeconds: Number.NaN }],
      ['Infinity 시점', { videoId: 'aaaaaaaaaaa', atSeconds: Number.POSITIVE_INFINITY }],
    ])('잘못된 Moment (%s) 를 거부하고 아무것도 바꾸지 않는다', (_label, target) => {
      const { coordinator, playback, fake } = playingAt(10)
      const queueBefore = playback.queue.map((track) => track.id)

      expect(coordinator.playMoment(target)).toEqual({ ok: false, reason: 'invalid-moment' })

      expect(playback.queue.map((track) => track.id)).toEqual(queueBefore)
      expect(playback.queueIndex).toBe(0)
      expect(fake.calls.load).toHaveLength(1)
      expect(fake.calls.seek).toEqual([])
    })

    it('플레이어가 등록돼 있지 않으면 성공으로 돌려주지 않는다', () => {
      useLibraryStore().createPlaylist('P')
      const coordinator = createPlaybackCoordinator()
      const playback = usePlaybackStore()

      expect(coordinator.playMoment({ videoId: VIDEO[0], atSeconds: 10 })).toEqual({
        ok: false,
        reason: 'player-unavailable',
      })
      expect(playback.queue).toEqual([])
    })

    it('연결이 끊긴 뒤에는 성공으로 돌려주지 않는다', () => {
      const { coordinator, attachment, fake } = setup()
      attachment.detach()

      expect(coordinator.playMoment({ videoId: VIDEO[0], atSeconds: 10 })).toEqual({
        ok: false,
        reason: 'player-unavailable',
      })
      expect(fake.calls.load).toEqual([])
    })

    it('플레이어가 가려져 있으면 다른 재생과 같은 이유로 거절하고 큐를 바꾸지 않는다', () => {
      const { coordinator, playback, fake } = setup()
      // 가려진 영역을 등록한다.
      const hidden = new FakePlayerAdapter()
      const attachment = coordinator.attachAdapter(hidden, hiddenPresence())
      hidden.mount(document.createElement('div'), attachment.events)

      const result = coordinator.playMoment({ videoId: VIDEO[1], atSeconds: 30 })

      expect(result).toEqual({ ok: false, reason: 'player-hidden' })
      expect(playback.queue).toEqual([])
      expect(hidden.calls.load).toEqual([])
      expect(hidden.calls.seek).toEqual([])
      expect(fake.calls.load).toEqual([])
      expect(playback.statusTone).toBe('warning')
      expect(playback.statusMessage).toContain('재생할 수 없어요')
    })

    it('가려진 플레이어에서는 같은 영상의 seek 도 거절한다', () => {
      const { coordinator, playback, fake, playlistId } = playingAt(10)
      // 같은 어댑터를 가려진 영역과 함께 다시 등록한다.
      const attachment = coordinator.attachAdapter(fake, hiddenPresence())
      void attachment
      void playlistId

      const result = coordinator.playMoment({ videoId: VIDEO[0], atSeconds: 83 })

      expect(result).toEqual({ ok: false, reason: 'player-hidden' })
      expect(fake.calls.seek).toEqual([])
      expect(playback.queueIndex).toBe(0)
    })

    it('자동재생 차단 안내는 다른 재생과 같고 자동 전환을 멈춘다', () => {
      const { coordinator, playback, fake } = setup()
      coordinator.playMoment({ videoId: VIDEO[0], atSeconds: 30 })

      fake.emitAutoplayBlocked()
      fake.emitStateChange('ended')

      expect(playback.statusMessage).toContain('자동재생')
      expect(playback.queueIndex).toBe(0)
      expect(fake.calls.load).toHaveLength(1)
    })

    it('임베드 불가 영상의 Moment 는 기존 오류 안내가 뜨고 다음 곡으로 넘기지 않는다', () => {
      const { coordinator, playback, fake } = setup(0)
      coordinator.playMoment({ videoId: ORPHAN, atSeconds: 30, title: '막힌 영상' })

      fake.emitError({ kind: 'embed-not-allowed', code: 150 })
      expect(playback.playerState).toBe('error')
      expect(playback.statusTone).toBe('warning')
      fake.emitStateChange('ended')

      // 오류 안내가 남고, 사용자의 다음 동작을 기다린다 (M3-0.7).
      expect(playback.statusMessage).toContain('오류 150')
      expect(playback.currentTrack?.title).toBe('막힌 영상')
      expect(fake.calls.load).toHaveLength(1)
    })

    it('재생할 수 없는 영상이라도 Moments 저장소를 건드리지 않는다', () => {
      globalThis.localStorage.setItem(
        '39page.moments',
        JSON.stringify({ version: 1, data: [{ id: 'm', videoId: ORPHAN, atSeconds: 30 }] }),
      )
      const raw = globalThis.localStorage.getItem('39page.moments')
      const { coordinator, fake } = setup(0)

      coordinator.playMoment({ videoId: ORPHAN, atSeconds: 30 })
      fake.emitError({ kind: 'not-found', code: 100 })

      // 삭제도 수정도 없다. 지우는 것은 사용자만 한다 (`MUSIC_MOMENTS.md` 3-5).
      expect(globalThis.localStorage.getItem('39page.moments')).toBe(raw)
    })
  })

  describe('빠른 연속 요청과 늦은 사건', () => {
    it('연달아 누르면 마지막 Moment 가 이긴다', () => {
      const { coordinator, playback, fake } = setup()

      coordinator.playMoment({ videoId: VIDEO[0], atSeconds: 10 })
      coordinator.playMoment({ videoId: VIDEO[2], atSeconds: 20 })
      coordinator.playMoment({ videoId: VIDEO[1], atSeconds: 30 })

      expect(playback.queueIndex).toBe(1)
      expect(fake.calls.load.map((call) => call.startSeconds)).toEqual([10, 20, 30])
      expect(fake.calls.load[2]?.videoId).toBe(VIDEO[1])
    })

    it('같은 영상에서 연달아 seek 하면 순서대로 간다', () => {
      const { coordinator, fake } = playingAt(5)

      coordinator.playMoment({ videoId: VIDEO[0], atSeconds: 10 })
      coordinator.playMoment({ videoId: VIDEO[0], atSeconds: 50 })
      coordinator.playMoment({ videoId: VIDEO[0], atSeconds: 20 })

      expect(fake.calls.seek).toEqual([10, 50, 20])
      expect(fake.calls.load).toHaveLength(1)
    })

    it('다른 영상으로 바꾼 직후 같은 영상의 Moment 를 누르면 재적재에 시점이 실린다', () => {
      const { coordinator, fake } = playingAt(5)

      // B 로 바꾼다 → 플레이어는 아직 B 의 위치를 모른다.
      coordinator.playMoment({ videoId: VIDEO[1], atSeconds: 10 })
      // 곧바로 B 의 다른 Moment. seek 은 버려질 것이므로 쓰지 않는다.
      coordinator.playMoment({ videoId: VIDEO[1], atSeconds: 50 })

      expect(fake.calls.seek).toEqual([])
      expect(fake.calls.load.slice(1)).toEqual([
        { videoId: VIDEO[1], autoplay: true, startSeconds: 10 },
        { videoId: VIDEO[1], autoplay: true, startSeconds: 50 },
      ])
    })

    it('바꾸기 직전 영상의 ENDED 가 Moment 로 고른 곡을 건너뛰지 않는다', () => {
      const { coordinator, playback, fake } = playingAt(170)

      coordinator.playMoment({ videoId: VIDEO[1], atSeconds: 10 })
      // Track 1 의 ENDED 가 뒤늦게 도착한다.
      fake.emitStateChange('ended')

      expect(playback.queueIndex).toBe(1)
      expect(fake.calls.load).toHaveLength(2)
    })

    it('새 Moment 요청은 앞선 오류 안내를 지운다', () => {
      const { coordinator, playback, fake, playlistId } = setup()
      coordinator.playPlaylist(playlistId)
      fake.emitError({ kind: 'not-found', code: 100 })
      expect(playback.statusMessage).not.toBe('')

      coordinator.playMoment({ videoId: VIDEO[1], atSeconds: 10 })

      expect(playback.statusMessage).toBe('')
    })
  })

  describe('경계', () => {
    it('playMoment 전후로 어댑터의 DOM 노드가 같다 — 재생성이 없다', () => {
      const { coordinator, fake } = playingAt(5)
      const host = fake.hostNode

      coordinator.playMoment({ videoId: VIDEO[0], atSeconds: 10 })
      coordinator.playMoment({ videoId: VIDEO[1], atSeconds: 10 })
      coordinator.playMoment({ videoId: ORPHAN, atSeconds: 10 })

      expect(fake.hostNode).toBe(host)
      expect(fake.calls.mount).toBe(1)
      expect(fake.calls.destroy).toBe(0)
    })

    it('코디네이터는 Moments store 를 만들지 않는다 — Pinia 에 moments 가 없다', () => {
      const { coordinator } = playingAt(5)
      coordinator.capturePosition()
      coordinator.playMoment({ videoId: VIDEO[1], atSeconds: 10 })

      expect(Object.keys(pinia.state.value).sort()).toEqual(['library', 'playback'])
    })

    it('코디네이터 소스가 Moments 저장에 손대지 않는다', () => {
      const code = stripComments(readSource('src/features/playback/createPlaybackCoordinator.ts'))

      expect(code).not.toContain('useMomentsStore')
      expect(code).not.toContain('momentsStorage')
      expect(code).not.toContain('localStorage')
      // 검증 함수 하나만 빌려 쓴다. 한 벌이어야 갈라지지 않는다.
      expect(code).toContain('isValidAtSeconds')
    })

    it('일반 트랙 재생에는 startSeconds 가 섞이지 않는다', () => {
      const { coordinator, fake, playlistId, library } = setup()
      const ids = trackIds(library, playlistId)

      coordinator.playPlaylist(playlistId)
      coordinator.playTrack(playlistId, ids[2] ?? '')
      coordinator.next()
      coordinator.previous()

      for (const call of fake.calls.load) expect(call).not.toHaveProperty('startSeconds')
    })
  })
})
