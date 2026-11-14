/**
 * M11-7B — 재생 큐 보기 · 큐의 출처 · 큐 안의 자리로 재생 · 출처 목록으로 다시 뜨기.
 *
 * NOW PLAYLIST 위젯이 기대는 계약이다 (`playbackCoordinator.ts` 의 `PlaybackQueue`).
 *
 *   큐가 있으면 큐(스냅샷)와 그 출처, 없으면 `null` — 고른 목록과 섞지 않는다
 *   출처는 큐를 만드는 쪽이 적는다. 모르면 추정하지 않는다
 *   출처 목록을 고쳐도 큐는 그대로다. 사용자가 고를 때만 새 순서를 따른다
 *   지금 곡은 트랙 id 로 찾는다 — 같은 영상이 여러 번 있어도 헷갈리지 않는다
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createPlaybackCoordinator } from '@/features/playback/createPlaybackCoordinator'
import { FakePlayerAdapter } from '@/features/playback/FakePlayerAdapter'
import type { PlayerPresence } from '@/features/playback/playerVisibility'
import { STORAGE_KEYS } from '@/shared/storage'
import { useLibraryStore } from '@/stores/library'
import { usePlaybackStore } from '@/stores/playback'

const VIDEO = ['aaaaaaaaaaa', 'bbbbbbbbbbb', 'ccccccccccc', 'ddddddddddd'] as const

beforeEach(() => {
  globalThis.localStorage.clear()
  setActivePinia(createPinia())
})

afterEach(() => {
  globalThis.localStorage.clear()
})

async function makePlaylist(name: string, videos: readonly string[]): Promise<string> {
  const library = useLibraryStore()
  const created = await library.createPlaylist(name)
  const id = created.ok ? created.playlistId : ''
  for (const [index, videoId] of videos.entries()) {
    await library.addTrack(id, { videoId, title: `${name} ${index + 1}` })
  }
  return id
}

async function setup(presence?: PlayerPresence) {
  const library = useLibraryStore()
  const playback = usePlaybackStore()
  const listA = await makePlaylist('A', [VIDEO[0], VIDEO[1], VIDEO[2]])
  const listB = await makePlaylist('B', [VIDEO[3], VIDEO[0]])

  const coordinator = createPlaybackCoordinator()
  const fake = new FakePlayerAdapter()
  const attachment = coordinator.attachAdapter(fake, presence)
  fake.mount(document.createElement('div'), attachment.events)

  const ids = (playlistId: string): string[] =>
    (library.getPlaylist(playlistId)?.tracks ?? []).map((track) => track.id)
  const titles = (): string[] => (coordinator.queue.value?.tracks ?? []).map((t) => t.title)

  return { library, playback, coordinator, fake, listA, listB, ids, titles }
}

describe('A. 큐 보기 — 큐가 있을 때만, 고른 목록과 따로', () => {
  it('큐가 없으면 null 이다 — 고른 목록이 있어도 재생 중인 것처럼 보이지 않는다', async () => {
    const { coordinator, library, listA } = await setup()
    await library.selectPlaylist(listA)

    expect(coordinator.queue.value).toBeNull()
    expect(coordinator.nowPlaying.value).toBeNull()
  })

  it('목록을 재생하면 실제 재생 순서 · 지금 위치 · 출처 목록을 보인다', async () => {
    const { coordinator, listA, ids } = await setup()

    coordinator.playTrack(listA, ids(listA)[1] ?? '')

    const view = coordinator.queue.value
    expect(view?.tracks.map((track) => track.title)).toEqual(['A 1', 'A 2', 'A 3'])
    expect(view?.index).toBe(1)
    expect(view?.source).toEqual({ playlistId: listA, name: 'A' })
    expect(view?.sourceState).toBe('in-sync')
    expect(view?.canResync).toBe(false)
  })

  it('다른 목록을 **고르기만** 해서는 큐도 출처도 바뀌지 않는다', async () => {
    const { coordinator, library, listA, listB, fake } = await setup()
    coordinator.playPlaylist(listA)
    const loads = fake.calls.load.length

    await library.selectPlaylist(listB)

    expect(library.selectedPlaylistId).toBe(listB)
    expect(coordinator.queue.value?.source?.playlistId).toBe(listA)
    expect(coordinator.queue.value?.tracks.map((track) => track.title)).toEqual([
      'A 1',
      'A 2',
      'A 3',
    ])
    expect(fake.calls.load).toHaveLength(loads)
  })

  it('같은 곡이 두 목록에 있어도 출처는 재생을 시작한 목록 하나다 (추정하지 않는다)', async () => {
    const { coordinator, listB } = await setup()

    // VIDEO[0] 은 A 에도 B 에도 있다. B 에서 틀었다.
    coordinator.playPlaylist(listB)

    expect(coordinator.queue.value?.source).toEqual({ playlistId: listB, name: 'B' })
  })

  it('목록 이름을 바꾸면 보기의 이름이 따라오고, 큐는 그대로다', async () => {
    const { coordinator, library, listA } = await setup()
    coordinator.playPlaylist(listA)

    await library.renamePlaylist(listA, 'A (새 이름)')

    expect(coordinator.queue.value?.source?.name).toBe('A (새 이름)')
    expect(coordinator.queue.value?.sourceState).toBe('in-sync')
  })
})

describe('B. 출처를 모를 때 — 이름을 지어내지 않는다', () => {
  it('목록 밖 영상의 Moment 재생은 출처가 없다', async () => {
    const { coordinator } = await setup()

    const result = coordinator.playMoment({ videoId: 'zzzzzzzzzzz', atSeconds: 12, title: '밖' })

    expect(result).toEqual({ ok: true })
    expect(coordinator.queue.value?.source).toBeNull()
    expect(coordinator.queue.value?.sourceState).toBe('unknown')
    expect(coordinator.queue.value?.tracks).toHaveLength(1)
  })

  it('목록에서 찾은 영상의 Moment 재생은 그 목록이 출처다', async () => {
    const { coordinator, library, listB } = await setup()
    await library.selectPlaylist(listB)

    coordinator.playMoment({ videoId: VIDEO[3], atSeconds: 5 })

    expect(coordinator.queue.value?.source).toEqual({ playlistId: listB, name: 'B' })
  })

  it('큐 안의 다른 자리로 가는 Moment 재생은 출처를 바꾸지 않는다', async () => {
    const { coordinator, library, listA, listB } = await setup()
    coordinator.playPlaylist(listA)
    await library.selectPlaylist(listB)

    // VIDEO[2] 는 A 의 큐 안에 있다 — B 를 고른 상태여도 큐는 A 다.
    coordinator.playMoment({ videoId: VIDEO[2], atSeconds: 3 })

    expect(coordinator.queue.value?.source?.playlistId).toBe(listA)
    expect(coordinator.queue.value?.index).toBe(2)
  })

  it('store 에 출처 없이 큐를 넣으면 이전 출처가 남지 않는다', async () => {
    const { coordinator, playback, listA } = await setup()
    coordinator.playPlaylist(listA)

    playback.setQueue([{ id: 'x', source: 'youtube', videoId: VIDEO[0], title: 'X' }], 0)

    expect(playback.queueSource).toBeNull()
    expect(coordinator.queue.value?.sourceState).toBe('unknown')
  })

  it('라이브러리가 통째로 교체되면 큐와 출처가 함께 비워진다', async () => {
    const { coordinator, playback, listA } = await setup()
    coordinator.playPlaylist(listA)

    coordinator.libraryReplaced()

    expect(coordinator.queue.value).toBeNull()
    expect(playback.queueSource).toBeNull()
  })
})

describe('C. 큐 안의 자리로 재생', () => {
  it('그 자리의 곡을 처음부터 재생하고 큐를 다시 뜨지 않는다', async () => {
    const { coordinator, playback, fake, listA } = await setup()
    coordinator.playPlaylist(listA)
    const queueBefore = playback.queue

    expect(coordinator.playQueueIndex(2)).toEqual({ ok: true })

    expect(playback.queue).toBe(queueBefore)
    expect(coordinator.queue.value?.index).toBe(2)
    expect(coordinator.nowPlaying.value?.videoId).toBe(VIDEO[2])
    expect(fake.calls.load[fake.calls.load.length - 1]).toEqual({
      videoId: VIDEO[2],
      autoplay: true,
    })
  })

  it('다음 · 이전 곡이 옮긴 자리에서 이어진다', async () => {
    const { coordinator, listA } = await setup()
    coordinator.playPlaylist(listA)
    coordinator.playQueueIndex(1)

    expect(coordinator.next()).toBe(true)
    expect(coordinator.queue.value?.index).toBe(2)
    expect(coordinator.next()).toBe(false)
    expect(coordinator.previous()).toBe(true)
    expect(coordinator.queue.value?.index).toBe(1)
  })

  it('같은 영상이 큐에 두 번 있어도 누른 그 항목이 지금 곡이 된다', async () => {
    const { coordinator, library } = await setup()
    const twice = await makePlaylist('TWICE', [VIDEO[0], VIDEO[1], VIDEO[0]])
    const trackIds = (library.getPlaylist(twice)?.tracks ?? []).map((track) => track.id)
    coordinator.playPlaylist(twice)

    coordinator.playQueueIndex(2)

    expect(coordinator.queue.value?.index).toBe(2)
    expect(coordinator.nowPlaying.value?.trackId).toBe(trackIds[2])
    expect(coordinator.nowPlaying.value?.trackId).not.toBe(trackIds[0])
  })

  it('범위를 벗어나거나 큐가 없으면 거절하고 아무것도 바꾸지 않는다', async () => {
    const { coordinator, fake, listA } = await setup()

    expect(coordinator.playQueueIndex(0)).toEqual({ ok: false, reason: 'track-not-found' })

    coordinator.playPlaylist(listA)
    const loads = fake.calls.load.length
    for (const index of [-1, 3, 1.5, Number.NaN]) {
      expect(coordinator.playQueueIndex(index)).toEqual({ ok: false, reason: 'track-not-found' })
    }
    expect(coordinator.queue.value?.index).toBe(0)
    expect(fake.calls.load).toHaveLength(loads)
  })

  it('영상이 가려져 있으면 거절하고 "지금 곡" 표시도 옮기지 않는다', async () => {
    let visible = true
    const presence: PlayerPresence = {
      measure: () => (visible ? { ok: true } : { ok: false, reason: 'too-small' }),
      reveal: () => {},
    }
    const { coordinator, fake, listA } = await setup(presence)
    coordinator.playPlaylist(listA)
    const loads = fake.calls.load.length
    visible = false

    expect(coordinator.playQueueIndex(2)).toEqual({ ok: false, reason: 'player-hidden' })

    expect(coordinator.queue.value?.index).toBe(0)
    expect(fake.calls.load).toHaveLength(loads)
  })
})

describe('D. 큐는 스냅샷 — 출처 목록을 고쳐도 그대로, 고를 때만 새 순서', () => {
  it('출처 목록의 순서를 바꾸면 큐는 그대로이고 상태가 changed 가 된다', async () => {
    const { coordinator, library, listA, ids, titles, fake } = await setup()
    coordinator.playTrack(listA, ids(listA)[1] ?? '')
    const loads = fake.calls.load.length

    // A 2 를 맨 위로: [A 2, A 1, A 3]
    await library.moveTrack(listA, ids(listA)[1] ?? '', 'up')

    expect(titles()).toEqual(['A 1', 'A 2', 'A 3'])
    expect(coordinator.queue.value?.index).toBe(1)
    expect(coordinator.queue.value?.sourceState).toBe('changed')
    expect(coordinator.queue.value?.canResync).toBe(true)
    // 다음 곡은 **옛 순서**를 따른다 — 사용자가 고르기 전에는.
    expect(fake.calls.load).toHaveLength(loads)
  })

  it('다시 뜨면 지금 곡은 그대로이고 큐 · 위치만 새 순서가 된다 — 플레이어에 명령하지 않는다', async () => {
    const { coordinator, library, playback, listA, ids, titles, fake } = await setup()
    const playingId = ids(listA)[1] ?? ''
    coordinator.playTrack(listA, playingId)
    fake.emitStateChange('playing')
    await library.moveTrack(listA, playingId, 'up')
    const calls = JSON.stringify(fake.calls)

    expect(coordinator.resyncQueueFromSource()).toEqual({ ok: true })

    expect(titles()).toEqual(['A 2', 'A 1', 'A 3'])
    expect(coordinator.queue.value?.index).toBe(0)
    expect(coordinator.nowPlaying.value?.trackId).toBe(playingId)
    expect(coordinator.queue.value?.sourceState).toBe('in-sync')
    // 적재 · 재생 · 일시정지 · 시점 이동 — 아무 명령도 가지 않았다. 소리가 끊기지 않는다.
    expect(JSON.stringify(fake.calls)).toBe(calls)
    expect(playback.hasStartedPlaying).toBe(true)
    expect(playback.playerState).toBe('playing')
    // 이제 다음 곡은 새 순서의 다음이다.
    coordinator.next()
    expect(coordinator.nowPlaying.value?.videoId).toBe(VIDEO[0])
  })

  it('곡을 추가 · 삭제 · 이름 바꾸기 해도 큐는 그대로이고 changed 로 알린다', async () => {
    const { coordinator, library, listA, ids, titles } = await setup()
    coordinator.playPlaylist(listA)

    await library.addTrack(listA, { videoId: VIDEO[3], title: 'A 4' })
    expect(titles()).toEqual(['A 1', 'A 2', 'A 3'])
    expect(coordinator.queue.value?.sourceState).toBe('changed')

    coordinator.resyncQueueFromSource()
    expect(titles()).toEqual(['A 1', 'A 2', 'A 3', 'A 4'])

    await library.renameTrack(listA, ids(listA)[2] ?? '', 'A 3 (새 이름)')
    expect(titles()[2]).toBe('A 3')
    expect(coordinator.queue.value?.sourceState).toBe('changed')

    await library.removeTrack(listA, ids(listA)[3] ?? '')
    expect(titles()).toHaveLength(4)
    coordinator.resyncQueueFromSource()
    expect(titles()).toEqual(['A 1', 'A 2', 'A 3 (새 이름)'])
  })

  it('같은 영상이 두 번 있는 목록에서 순서가 바뀌어도 지금 곡을 트랙 id 로 찾는다', async () => {
    const { coordinator, library } = await setup()
    const twice = await makePlaylist('TWICE', [VIDEO[0], VIDEO[1], VIDEO[0]])
    const before = (library.getPlaylist(twice)?.tracks ?? []).map((track) => track.id)
    // 셋째(둘째 VIDEO[0])를 듣는 중.
    coordinator.playTrack(twice, before[2] ?? '')

    // 셋째를 한 칸 위로: [0a, 0b, 1]
    await library.moveTrack(twice, before[2] ?? '', 'up')
    coordinator.resyncQueueFromSource()

    // videoId 로 찾았다면 0 번(첫 VIDEO[0])에 섰을 것이다.
    expect(coordinator.queue.value?.index).toBe(1)
    expect(coordinator.nowPlaying.value?.trackId).toBe(before[2])
  })

  it('지금 곡이 바뀐 목록에 없으면 다시 뜨기를 거절하고 큐를 그대로 둔다', async () => {
    const { coordinator, library, listA, ids, titles } = await setup()
    const playingId = ids(listA)[0] ?? ''
    coordinator.playPlaylist(listA)

    // 다른 탭이 지운 것처럼 — 재생 쪽에 알리지 않고 라이브러리에서만 지운다.
    await library.removeTrack(listA, playingId)

    expect(coordinator.queue.value?.sourceState).toBe('changed')
    expect(coordinator.queue.value?.canResync).toBe(false)
    expect(coordinator.resyncQueueFromSource()).toEqual({ ok: false, reason: 'track-not-found' })
    expect(titles()).toEqual(['A 1', 'A 2', 'A 3'])
  })

  it('출처 목록이 지워지면 deleted — 큐는 남고, 이름은 큐를 뜬 때의 것이다', async () => {
    const { coordinator, library, listA, titles } = await setup()
    coordinator.playPlaylist(listA)

    await library.deletePlaylist(listA)

    expect(titles()).toEqual(['A 1', 'A 2', 'A 3'])
    expect(coordinator.queue.value?.sourceState).toBe('deleted')
    expect(coordinator.queue.value?.source).toEqual({ playlistId: listA, name: 'A' })
    expect(coordinator.resyncQueueFromSource()).toEqual({
      ok: false,
      reason: 'playlist-not-found',
    })
  })

  it('큐가 없거나 출처를 모르면 다시 뜨기를 거절한다', async () => {
    const { coordinator } = await setup()
    expect(coordinator.resyncQueueFromSource()).toEqual({ ok: false, reason: 'no-source' })

    coordinator.playMoment({ videoId: 'zzzzzzzzzzz', atSeconds: 1 })
    expect(coordinator.resyncQueueFromSource()).toEqual({ ok: false, reason: 'no-source' })
  })
})

describe('E. 저장 · 경계', () => {
  it('큐의 출처는 저장하지 않는다 — 저장소 키와 라이브러리 형식이 그대로다', async () => {
    const { coordinator, listA } = await setup()
    const before = globalThis.localStorage.getItem(STORAGE_KEYS.library)

    coordinator.playPlaylist(listA)
    coordinator.playQueueIndex(1)
    coordinator.resyncQueueFromSource()

    expect(globalThis.localStorage.getItem(STORAGE_KEYS.library)).toBe(before)
    // 새 키가 생기지 않았다 (테마 · Moments 는 이 시험에서 쓰지 않았다).
    const keys = Object.keys(globalThis.localStorage).filter((key) => key.startsWith('39page'))
    expect(keys.filter((key) => !key.startsWith('39page.library'))).toEqual([])
  })

  it('playback store 는 여전히 library 를 모르고, 계약 파일은 store 를 끌어오지 않는다', () => {
    const read = (path: string): string =>
      readFileSync(resolve(process.cwd(), path), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')

    expect(read('src/stores/playback.ts')).not.toMatch(/from '@\/stores\/library'/)
    expect(read('src/features/playback/playbackCoordinator.ts')).not.toMatch(/from '@\/stores\//)
  })
})
