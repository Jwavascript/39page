/**
 * Moments ↔ Library 독립성 (M9-2).
 *
 * 지시서의 요구는 하나로 못 박혀 있다 — **트랙이 삭제돼도 Moment 는 남아야
 * 한다.** 이 파일은 그것을 동작으로 확인한다.
 *
 * ADR 0019 는 그 보장을 두 가지 구조로 만든다.
 *   1. Moment 는 `track.id` 가 아니라 `videoId` 를 가리킨다 (결정 1)
 *   2. Moment 는 `39page.moments` 라는 **자기 키**에 담긴다 (결정 3)
 *
 * 그래서 "지우는 코드가 Moment 를 모른다" 가 성립한다. 아래 테스트는 연쇄
 * 삭제가 **없다는 것**을 확인하는 테스트다.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { STORAGE_KEYS } from '@/shared/storage'
import type { LibraryData } from '@/shared/types'
import { useLibraryStore } from '@/stores/library'
import { useMomentsStore } from '@/stores/moments'
import { useThemeStore } from '@/stores/theme'

const VIDEO = 'jNQXAC9IVRw'
const OTHER_VIDEO = 'dQw4w9WgXcQ'

function readSource(relative: string): string {
  return readFileSync(resolve(process.cwd(), relative), 'utf8')
}

/** 주석에 적힌 이름이 정적 검사에 걸리지 않도록 지운다. */
function stripComments(code: string): string {
  return code
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '')
}

function rawLibrary(): string | null {
  return globalThis.localStorage.getItem(STORAGE_KEYS.library)
}

function rawMoments(): string | null {
  return globalThis.localStorage.getItem(STORAGE_KEYS.moments)
}

beforeEach(() => {
  globalThis.localStorage.clear()
  setActivePinia(createPinia())
})

afterEach(() => {
  globalThis.localStorage.clear()
})

/**
 * 한 영상이 플레이리스트에 담겨 있고, 그 영상의 Moment 가 둘 있는 상태.
 *
 * @returns 트랙과 Moment 의 id
 */
function setupTrackWithMoments(): {
  playlistId: string
  trackId: string
  momentIds: string[]
} {
  const library = useLibraryStore()
  const moments = useMomentsStore()

  const created = library.createPlaylist('MY RECORDS')
  if (!created.ok) throw new Error('setup: createPlaylist failed')
  const added = library.addTrack(created.playlistId, { videoId: VIDEO, title: 'Me at the zoo' })
  if (!added.ok || added.trackId === undefined) throw new Error('setup: addTrack failed')

  const first = moments.add({ videoId: VIDEO, atSeconds: 10, note: '간주', title: 'Me at the zoo' })
  const second = moments.add({
    videoId: VIDEO,
    atSeconds: 40,
    note: '드럼',
    title: 'Me at the zoo',
  })
  if (!first.ok || !second.ok) throw new Error('setup: add moment failed')

  return {
    playlistId: created.playlistId,
    trackId: added.trackId,
    momentIds: [first.momentId, second.momentId],
  }
}

describe('A. 트랙·플레이리스트 삭제가 Moment 를 지우지 않는다', () => {
  it('트랙을 지워도 그 영상의 Moment 가 남는다', () => {
    const library = useLibraryStore()
    const moments = useMomentsStore()
    const { playlistId, trackId, momentIds } = setupTrackWithMoments()

    expect(library.removeTrack(playlistId, trackId).ok).toBe(true)

    expect(library.getPlaylist(playlistId)?.tracks).toEqual([])
    expect(moments.moments.map((item) => item.id)).toEqual(momentIds)
    expect(moments.momentsForVideo(VIDEO)).toHaveLength(2)
  })

  it('플레이리스트를 통째로 지워도 Moment 가 남는다', () => {
    const library = useLibraryStore()
    const moments = useMomentsStore()
    const { playlistId } = setupTrackWithMoments()

    expect(library.deletePlaylist(playlistId).ok).toBe(true)

    expect(library.playlists).toEqual([])
    expect(moments.count).toBe(2)
  })

  it('트랙을 지운 뒤 새로고침해도 Moment 가 돌아온다', () => {
    const { playlistId, trackId } = setupTrackWithMoments()
    useLibraryStore().removeTrack(playlistId, trackId)

    // 새 Pinia = 새로고침.
    setActivePinia(createPinia())
    const moments = useMomentsStore()
    const library = useLibraryStore()
    moments.restore()
    library.restore()

    expect(moments.count).toBe(2)
    expect(library.getPlaylist(playlistId)?.tracks).toEqual([])
  })

  it('Moment 를 지워도 트랙은 남는다 — 반대 방향도 연쇄가 없다', () => {
    const library = useLibraryStore()
    const moments = useMomentsStore()
    const { playlistId, momentIds } = setupTrackWithMoments()

    for (const id of momentIds) moments.remove(id)

    expect(moments.moments).toEqual([])
    expect(library.getPlaylist(playlistId)?.tracks).toHaveLength(1)
  })

  it('트랙 이름을 바꿔도 Moment 의 스냅샷 제목은 그대로다', () => {
    const library = useLibraryStore()
    const moments = useMomentsStore()
    const { playlistId, trackId } = setupTrackWithMoments()

    library.renameTrack(playlistId, trackId, '다른 이름')

    // 스냅샷은 저장 당시의 값이다. 표시 단계가 라이브러리의 현재 제목을
    // 우선하는 것은 M9-4 의 일이다 (`MOMENTS_DESIGN.md` §1-1).
    expect(moments.moments.every((item) => item.title === 'Me at the zoo')).toBe(true)
  })

  it('라이브러리에 아예 없는 영상의 Moment 도 저장되고 복원된다', () => {
    const moments = useMomentsStore()
    useLibraryStore().createPlaylist('EMPTY')

    expect(moments.add({ videoId: OTHER_VIDEO, atSeconds: 3 }).ok).toBe(true)

    setActivePinia(createPinia())
    const reloaded = useMomentsStore()
    reloaded.restore()

    expect(reloaded.momentsForVideo(OTHER_VIDEO)).toHaveLength(1)
  })
})

describe('B. 저장 키가 서로를 건드리지 않는다', () => {
  it('라이브러리 수정이 39page.moments 를 건드리지 않는다', () => {
    const library = useLibraryStore()
    const moments = useMomentsStore()
    moments.add({ videoId: VIDEO, atSeconds: 10 })
    const before = rawMoments()
    expect(before).not.toBeNull()

    const created = library.createPlaylist('NEW')
    if (created.ok) {
      library.addTrack(created.playlistId, { videoId: VIDEO })
      library.renamePlaylist(created.playlistId, 'RENAMED')
      library.deletePlaylist(created.playlistId)
    }

    expect(rawMoments()).toBe(before)
  })

  it('Moment 수정이 39page.library 를 건드리지 않는다', () => {
    const library = useLibraryStore()
    const moments = useMomentsStore()
    const created = library.createPlaylist('KEEP')
    const before = rawLibrary()
    expect(before).not.toBeNull()

    const added = moments.add({ videoId: VIDEO, atSeconds: 10 })
    if (added.ok) {
      moments.updateNote(added.momentId, '고침')
      moments.remove(added.momentId)
    }
    moments.addMoments([])
    moments.replaceAllMoments([])

    expect(rawLibrary()).toBe(before)
    expect(created.ok).toBe(true)
  })

  it('테마 전환이 39page.moments 를 건드리지 않는다', () => {
    const moments = useMomentsStore()
    moments.add({ videoId: VIDEO, atSeconds: 10 })
    const before = rawMoments()

    useThemeStore().setTheme('kawaii-synth-cassette')

    expect(rawMoments()).toBe(before)
  })

  it('두 키가 각자의 봉투를 쓴다', () => {
    const library = useLibraryStore()
    const moments = useMomentsStore()
    library.createPlaylist('A')
    moments.add({ videoId: VIDEO, atSeconds: 1 })

    const libraryEnvelope = JSON.parse(rawLibrary() as string)
    const momentsEnvelope = JSON.parse(rawMoments() as string)

    // 라이브러리는 객체, Moments 는 배열이다. 한쪽을 다른 쪽으로 읽을 수 없다.
    expect(Array.isArray(libraryEnvelope.data)).toBe(false)
    expect(Array.isArray(momentsEnvelope.data)).toBe(true)
    expect(libraryEnvelope.data.moments).toBeUndefined()
  })
})

describe('C. 라이브러리 교체(백업 복원)가 Moment 를 날리지 않는다', () => {
  /**
   * M8-3 의 가져오기는 라이브러리를 **통째로 교체**한다. ADR 0019 결정 3 이
   * 키를 나눈 첫 번째 이유가 바로 이것이다.
   */
  it('library.replaceAll 이 Moment 를 건드리지 않는다', () => {
    const library = useLibraryStore()
    const moments = useMomentsStore()
    setupTrackWithMoments()
    const before = rawMoments()

    const replacement: LibraryData = {
      playlists: [{ id: 'from-backup', name: 'FROM BACKUP', tracks: [] }],
      selectedPlaylistId: 'from-backup',
    }
    const result = library.replaceAll(replacement)

    expect(result.persisted).toBe(true)
    expect(library.playlists.map((playlist) => playlist.id)).toEqual(['from-backup'])
    // Moment 는 메모리에도 저장소에도 그대로다.
    expect(moments.count).toBe(2)
    expect(rawMoments()).toBe(before)
  })

  it('교체 후 새로고침해도 Moment 가 남는다', () => {
    setupTrackWithMoments()
    useLibraryStore().replaceAll({ playlists: [], selectedPlaylistId: null })

    setActivePinia(createPinia())
    const moments = useMomentsStore()
    moments.restore()

    expect(moments.count).toBe(2)
    expect(moments.status).toBe('ready')
  })

  /**
   * 캐시된 옛 빌드가 백업을 복원하는 상황. 옛 빌드는 `39page.moments` 의
   * 존재를 모르므로 그 키에 손대지 못한다 (ADR 0019 결정 3 이유 2).
   */
  it('Moments 를 모르는 코드가 라이브러리 키만 덮어써도 Moment 가 산다', () => {
    const moments = useMomentsStore()
    moments.add({ videoId: VIDEO, atSeconds: 10, note: '살아야 한다' })
    const before = rawMoments()

    // 옛 빌드가 하는 일 = 라이브러리 키 하나만 쓴다.
    globalThis.localStorage.setItem(
      STORAGE_KEYS.library,
      JSON.stringify({ version: 1, data: { playlists: [], selectedPlaylistId: null } }),
    )

    setActivePinia(createPinia())
    const reloaded = useMomentsStore()
    reloaded.restore()

    expect(rawMoments()).toBe(before)
    expect(reloaded.moments[0]?.note).toBe('살아야 한다')
  })
})

describe('D. 보호 상태가 서로 번지지 않는다', () => {
  it('라이브러리가 보호 상태여도 Moment 는 저장된다', () => {
    globalThis.localStorage.setItem(STORAGE_KEYS.library, '{깨진 값')
    const library = useLibraryStore()
    const moments = useMomentsStore()
    library.restore()
    moments.restore()

    expect(library.status).toBe('protected')
    expect(moments.status).toBe('ready')
    expect(moments.add({ videoId: VIDEO, atSeconds: 1 }).ok).toBe(true)
    expect(rawMoments()).not.toBeNull()
  })

  it('Moments 가 보호 상태여도 라이브러리는 저장된다', () => {
    globalThis.localStorage.setItem(STORAGE_KEYS.moments, '{깨진 값')
    const library = useLibraryStore()
    const moments = useMomentsStore()
    library.restore()
    moments.restore()

    expect(moments.status).toBe('protected')
    expect(library.status).toBe('ready')
    const created = library.createPlaylist('OK')
    expect(created.ok && created.persisted).toBe(true)
    // 보호된 Moments 원본은 그대로다.
    expect(rawMoments()).toBe('{깨진 값')
  })
})

describe('E. 소스 수준 독립성', () => {
  it('라이브러리 store 가 Moments 를 모른다', () => {
    const code = stripComments(readSource('src/stores/library.ts'))

    expect(code).not.toContain('moments')
    expect(code).not.toContain('Moment')
  })

  it('Moments store 가 라이브러리를 모른다', () => {
    const code = stripComments(readSource('src/stores/moments.ts'))

    expect(code).not.toContain('library')
    expect(code).not.toContain('Playlist')
    expect(code).not.toContain('Track')
  })

  it('두 키의 이름이 다르다', () => {
    expect(STORAGE_KEYS.moments).not.toBe(STORAGE_KEYS.library)
    expect(STORAGE_KEYS.moments).not.toBe(STORAGE_KEYS.theme)
  })
})
