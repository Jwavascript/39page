import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { createPinia, setActivePinia, type Pinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { Track } from '@/shared/types'
import { useLibraryStore } from '@/stores/library'
import { usePlaybackStore } from '@/stores/playback'

function readSource(relative: string): string {
  return readFileSync(resolve(process.cwd(), relative), 'utf8')
}

/** 주석에 적힌 이름이 정적 검사에 걸리지 않도록 지운다. HTML 주석도 포함한다. */
function stripComments(code: string): string {
  return code
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '')
}

function track(id: string, videoId = 'dQw4w9WgXcQ'): Track {
  return { id, source: 'youtube', videoId, title: `Track ${id}` }
}

const QUEUE_A = [track('a1'), track('a2'), track('a3')]

let pinia: Pinia

beforeEach(() => {
  globalThis.localStorage.clear()
  pinia = createPinia()
  setActivePinia(pinia)
})

afterEach(() => {
  globalThis.localStorage.clear()
})

/**
 * 시나리오: Playlist A 를 재생 중이고, Library 에서 Playlist B 를 만지작거린다.
 * A 의 큐·인덱스·현재 트랙은 전혀 흔들리지 않아야 한다.
 */
async function setupPlayingA() {
  const library = useLibraryStore()
  const playback = usePlaybackStore()

  const a = await library.createPlaylist('PLAYLIST A')
  const b = await library.createPlaylist('PLAYLIST B')
  const idA = a.ok ? a.playlistId : ''
  const idB = b.ok ? b.playlistId : ''

  // 상위 계층이 하듯 큐를 스냅샷으로 만든다. Library 는 관여하지 않는다.
  playback.setQueue(QUEUE_A, 1)
  playback.setPlayerState('playing')

  return { library, playback, idA, idB }
}

function snapshotPlayback(playback: ReturnType<typeof usePlaybackStore>) {
  return {
    currentTrack: playback.currentTrack,
    queue: [...playback.queue],
    queueIndex: playback.queueIndex,
    playerState: playback.playerState,
    statusMessage: playback.statusMessage,
  }
}

describe('C. Library 와 Playback 의 독립성', () => {
  it('Library 선택을 바꿔도 Playback 상태가 그대로다', async () => {
    const { library, playback, idB } = await setupPlayingA()
    const before = snapshotPlayback(playback)

    library.selectPlaylist(idB)

    expect(snapshotPlayback(playback)).toEqual(before)
    expect(playback.currentTrack).toEqual(QUEUE_A[1])
    expect(playback.queueIndex).toBe(1)
  })

  it('재생 중이 아닌 플레이리스트의 이름을 바꿔도 큐가 그대로다', async () => {
    const { library, playback, idB } = await setupPlayingA()
    const before = snapshotPlayback(playback)

    library.selectPlaylist(idB)
    library.renamePlaylist(idB, 'RENAMED B')

    expect(snapshotPlayback(playback)).toEqual(before)
  })

  it('재생 중이 아닌 플레이리스트를 삭제해도 큐가 그대로다', async () => {
    const { library, playback, idB } = await setupPlayingA()
    const before = snapshotPlayback(playback)

    library.selectPlaylist(idB)
    library.deletePlaylist(idB)

    expect(snapshotPlayback(playback)).toEqual(before)
    expect(playback.queue).toEqual(QUEUE_A)
  })

  it('재생 중인 트랙이 담긴 플레이리스트를 지워도 큐가 그대로다', async () => {
    // 큐는 스냅샷이므로 원본 목록이 사라져도 재생은 계속된다.
    const { library, playback, idA } = await setupPlayingA()
    const before = snapshotPlayback(playback)

    library.deletePlaylist(idA)

    expect(library.getPlaylist(idA)).toBeUndefined()
    expect(snapshotPlayback(playback)).toEqual(before)
  })

  it('모든 플레이리스트를 지워도 큐가 그대로다', async () => {
    const { library, playback, idA, idB } = await setupPlayingA()
    const before = snapshotPlayback(playback)

    library.deletePlaylist(idA)
    library.deletePlaylist(idB)

    expect(library.playlists).toEqual([])
    expect(library.selectedPlaylistId).toBeNull()
    expect(snapshotPlayback(playback)).toEqual(before)
  })

  it('Library 복원이 Playback 상태를 건드리지 않는다', async () => {
    const { library, playback } = await setupPlayingA()
    const before = snapshotPlayback(playback)

    library.restore()

    expect(snapshotPlayback(playback)).toEqual(before)
  })

  it('Playback 을 바꿔도 Library 선택이 그대로다', async () => {
    const { library, playback, idB } = await setupPlayingA()
    library.selectPlaylist(idB)

    playback.setQueue([track('z1')], 0)
    playback.setPlayerState('paused')

    expect(library.selectedPlaylistId).toBe(idB)
    expect(library.playlists).toHaveLength(2)
  })

  it('Library 작업만으로는 playback store 가 등록되지 않는다', () => {
    const library = useLibraryStore()
    library.createPlaylist('A')
    library.restore()

    // playback 을 끌어들였다면 pinia 에 등록되어 드러난다.
    expect(Object.keys(pinia.state.value)).toEqual(['library'])
  })

  it('두 store 사이에 직접 import 가 없다', () => {
    const libraryCode = readSource('src/stores/library.ts')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '')
    const playbackCode = readSource('src/stores/playback.ts')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '')

    expect(libraryCode).not.toContain('usePlaybackStore')
    expect(libraryCode).not.toContain('playback')
    expect(playbackCode).not.toContain('useLibraryStore')
    expect(playbackCode).not.toContain('library')
  })

  it('드로어가 재생 구현이나 playback store 를 보지 않는다', () => {
    // M3-2 에서 드로어에 재생 버튼이 생겼다. 그래도 드로어가 아는 것은
    // 코디네이터 **계약**뿐이다 (`AGENTS.md` 규칙 2, ADR 0009).
    const code = stripComments(readSource('src/features/library/RecordLibraryDrawer.vue'))

    expect(code).not.toContain('usePlaybackStore')
    expect(code).not.toContain('@/stores/playback')
    expect(code).not.toContain('createPlaybackCoordinator')
    expect(code).not.toContain('PlayerAdapter')
    // 계약 파일 하나만 가져온다.
    expect(code).toContain('@/features/playback/playbackCoordinator')
  })

  it('코디네이터 계약 파일이 store 를 끌어오지 않는다', () => {
    const code = stripComments(readSource('src/features/playback/playbackCoordinator.ts'))

    expect(code).not.toContain('@/stores/')
    expect(code).not.toContain('defineStore')
  })

  it('코디네이터만 두 store 를 함께 본다', () => {
    const code = readSource('src/features/playback/createPlaybackCoordinator.ts')

    expect(code).toContain('@/stores/library')
    expect(code).toContain('@/stores/playback')
  })

  it('Library 가 테마 store 도 참조하지 않는다', () => {
    const code = readSource('src/stores/library.ts')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '')

    expect(code).not.toContain('useThemeStore')
    expect(code).not.toContain('ThemeKey')
  })
})
