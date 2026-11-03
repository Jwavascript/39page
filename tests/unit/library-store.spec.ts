import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { STORAGE_KEYS } from '@/shared/storage'
import type { LibraryData, Track } from '@/shared/types'
import {
  LIBRARY_STORAGE_VERSION,
  MAX_PLAYLIST_NAME_LENGTH,
  normalizeLibraryData,
  useLibraryStore,
} from '@/stores/library'

const KEY = STORAGE_KEYS.library
const realLocalStorage = globalThis.localStorage

function readSource(relative: string): string {
  return readFileSync(resolve(process.cwd(), relative), 'utf8')
}

function stubLocalStorage(descriptor: PropertyDescriptor): void {
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, ...descriptor })
}

function seedRaw(raw: string): void {
  globalThis.localStorage.setItem(KEY, raw)
}

function readRaw(): string | null {
  return globalThis.localStorage.getItem(KEY)
}

function envelope(data: unknown, version = LIBRARY_STORAGE_VERSION): string {
  return JSON.stringify({ version, data })
}

function track(id: string, videoId = 'dQw4w9WgXcQ'): Track {
  return { id, source: 'youtube', videoId, title: `Track ${id}` }
}

/** 저장소에 들어 있는 LibraryData 를 꺼낸다. */
function storedData(): LibraryData {
  return JSON.parse(readRaw() as string).data
}

beforeEach(() => {
  globalThis.localStorage.clear()
  setActivePinia(createPinia())
})

afterEach(() => {
  stubLocalStorage({ value: realLocalStorage, writable: true })
  globalThis.localStorage.clear()
  vi.restoreAllMocks()
})

describe('A. 플레이리스트 CRUD', () => {
  it('최초 상태가 비어 있다', () => {
    const library = useLibraryStore()

    expect(library.playlists).toEqual([])
    expect(library.selectedPlaylistId).toBeNull()
    expect(library.selectedPlaylist).toBeNull()
  })

  it('플레이리스트를 만들고 고유 ID 를 발급한다', () => {
    const library = useLibraryStore()

    const first = library.createPlaylist('MY RECORDS')
    const second = library.createPlaylist('CHILL')

    expect(first.ok).toBe(true)
    expect(second.ok).toBe(true)
    const ids = library.playlists.map((playlist) => playlist.id)
    expect(new Set(ids).size).toBe(2)
    expect(ids.every((id) => id.length > 0)).toBe(true)
  })

  it('생성 직후 그 플레이리스트가 선택된다', () => {
    const library = useLibraryStore()
    library.createPlaylist('FIRST')
    const result = library.createPlaylist('SECOND')

    expect(result.ok && library.selectedPlaylistId).toBe(result.ok ? result.playlistId : null)
    expect(library.selectedPlaylist?.name).toBe('SECOND')
  })

  it('새 플레이리스트의 트랙 목록은 비어 있다', () => {
    const library = useLibraryStore()
    library.createPlaylist('NEW')

    expect(library.selectedPlaylist?.tracks).toEqual([])
  })

  it('이름의 앞뒤 공백을 제거한다', () => {
    const library = useLibraryStore()
    library.createPlaylist('   SPACED   ')

    expect(library.selectedPlaylist?.name).toBe('SPACED')
  })

  it.each([
    ['빈 문자열', ''],
    ['공백', '   '],
    ['탭·줄바꿈', ' \t\n '],
  ])('%s 이름은 거부한다', (_label, name) => {
    const library = useLibraryStore()
    const result = library.createPlaylist(name)

    expect(result).toEqual({ ok: false, reason: 'empty-name' })
    expect(library.playlists).toEqual([])
  })

  it('이름을 60자로 자른다', () => {
    const library = useLibraryStore()
    library.createPlaylist('X'.repeat(100))

    expect(library.selectedPlaylist?.name).toHaveLength(MAX_PLAYLIST_NAME_LENGTH)
  })

  it('이름을 바꿔도 ID 와 트랙이 유지된다', () => {
    const library = useLibraryStore()
    const created = library.createPlaylist('OLD')
    const id = created.ok ? created.playlistId : ''
    // 저장된 트랙이 있는 상태를 복원으로 만든다.
    seedRaw(
      envelope({ playlists: [{ id, name: 'OLD', tracks: [track('t1')] }], selectedPlaylistId: id }),
    )
    library.restore()

    const before = library.getPlaylist(id)?.tracks
    const result = library.renamePlaylist(id, 'NEW NAME')

    expect(result.ok).toBe(true)
    expect(library.getPlaylist(id)?.name).toBe('NEW NAME')
    expect(library.getPlaylist(id)?.id).toBe(id)
    expect(library.getPlaylist(id)?.tracks).toEqual(before)
  })

  it('이름 변경 시 공백 이름을 거부한다', () => {
    const library = useLibraryStore()
    const created = library.createPlaylist('KEEP')
    const id = created.ok ? created.playlistId : ''

    expect(library.renamePlaylist(id, '   ')).toEqual({ ok: false, reason: 'empty-name' })
    expect(library.getPlaylist(id)?.name).toBe('KEEP')
  })

  it('존재하지 않는 ID 의 이름 변경을 거부한다', () => {
    const library = useLibraryStore()
    library.createPlaylist('ONLY')

    expect(library.renamePlaylist('ghost', 'X')).toEqual({ ok: false, reason: 'not-found' })
    expect(library.playlists).toHaveLength(1)
  })

  it('요청한 플레이리스트만 삭제한다', () => {
    const library = useLibraryStore()
    const a = library.createPlaylist('A')
    library.createPlaylist('B')
    const c = library.createPlaylist('C')

    const result = library.deletePlaylist(a.ok ? a.playlistId : '')

    expect(result.ok).toBe(true)
    expect(library.playlists.map((playlist) => playlist.name)).toEqual(['B', 'C'])
    expect(library.getPlaylist(c.ok ? c.playlistId : '')).toBeDefined()
  })

  it('선택된 목록을 지우면 같은 자리의 목록을 선택한다', () => {
    const library = useLibraryStore()
    library.createPlaylist('A')
    const b = library.createPlaylist('B')
    library.createPlaylist('C')

    library.selectPlaylist(b.ok ? b.playlistId : '')
    library.deletePlaylist(b.ok ? b.playlistId : '')

    // B 가 있던 자리(index 1)에 C 가 온다.
    expect(library.selectedPlaylist?.name).toBe('C')
  })

  it('마지막 자리의 선택된 목록을 지우면 그 앞을 선택한다', () => {
    const library = useLibraryStore()
    library.createPlaylist('A')
    const b = library.createPlaylist('B')

    library.deletePlaylist(b.ok ? b.playlistId : '')

    expect(library.selectedPlaylist?.name).toBe('A')
  })

  it('모든 목록을 지우면 선택이 null 이 된다', () => {
    const library = useLibraryStore()
    const only = library.createPlaylist('ONLY')

    library.deletePlaylist(only.ok ? only.playlistId : '')

    expect(library.playlists).toEqual([])
    expect(library.selectedPlaylistId).toBeNull()
    expect(library.selectedPlaylist).toBeNull()
  })

  it('선택되지 않은 목록을 지워도 선택은 그대로다', () => {
    const library = useLibraryStore()
    const a = library.createPlaylist('A')
    const b = library.createPlaylist('B')

    library.selectPlaylist(b.ok ? b.playlistId : '')
    library.deletePlaylist(a.ok ? a.playlistId : '')

    expect(library.selectedPlaylist?.name).toBe('B')
  })

  it('존재하지 않는 ID 삭제는 상태를 바꾸지 않는다', () => {
    const library = useLibraryStore()
    library.createPlaylist('A')
    const before = [...library.playlists]
    const selectedBefore = library.selectedPlaylistId

    expect(library.deletePlaylist('ghost')).toEqual({ ok: false, reason: 'not-found' })
    expect(library.playlists).toEqual(before)
    expect(library.selectedPlaylistId).toBe(selectedBefore)
  })

  it('선택을 바꾼다', () => {
    const library = useLibraryStore()
    const a = library.createPlaylist('A')
    library.createPlaylist('B')

    const result = library.selectPlaylist(a.ok ? a.playlistId : '')

    expect(result.ok).toBe(true)
    expect(library.selectedPlaylist?.name).toBe('A')
  })

  it('존재하지 않는 ID 는 선택하지 않는다', () => {
    const library = useLibraryStore()
    const a = library.createPlaylist('A')

    expect(library.selectPlaylist('ghost')).toEqual({ ok: false, reason: 'not-found' })
    expect(library.selectedPlaylistId).toBe(a.ok ? a.playlistId : null)
  })

  it('선택 변경이 트랙 배열을 건드리지 않는다', () => {
    const library = useLibraryStore()
    seedRaw(
      envelope({
        playlists: [
          { id: 'p1', name: 'A', tracks: [track('t1'), track('t2')] },
          { id: 'p2', name: 'B', tracks: [track('t3')] },
        ],
        selectedPlaylistId: 'p1',
      }),
    )
    library.restore()
    const before = library.playlists.map((playlist) => [...playlist.tracks])

    library.selectPlaylist('p2')

    expect(library.playlists.map((playlist) => [...playlist.tracks])).toEqual(before)
  })
})

describe('B. 저장과 복원', () => {
  it('생성한 데이터가 저장된다', () => {
    const library = useLibraryStore()
    const created = library.createPlaylist('SAVED')

    expect(created.ok && created.persisted).toBe(true)
    expect(JSON.parse(readRaw() as string)).toEqual({
      version: LIBRARY_STORAGE_VERSION,
      data: {
        playlists: [{ id: created.ok ? created.playlistId : '', name: 'SAVED', tracks: [] }],
        selectedPlaylistId: created.ok ? created.playlistId : '',
      },
    })
  })

  it('새 Store 인스턴스에서 복원된다', () => {
    const first = useLibraryStore()
    first.createPlaylist('A')
    first.createPlaylist('B')
    const expected = first.playlists.map((playlist) => playlist.name)

    // 완전히 새로운 pinia 로 교체한다.
    setActivePinia(createPinia())
    const second = useLibraryStore()
    expect(second.restore()).toBe('stored')

    expect(second.playlists.map((playlist) => playlist.name)).toEqual(expected)
  })

  it('여러 플레이리스트와 트랙 순서를 보존한다', () => {
    const library = useLibraryStore()
    seedRaw(
      envelope({
        playlists: [
          { id: 'p1', name: 'A', tracks: [track('t1'), track('t2'), track('t3')] },
          { id: 'p2', name: 'B', tracks: [track('t4')] },
        ],
        selectedPlaylistId: 'p2',
      }),
    )

    library.restore()

    expect(library.playlists.map((playlist) => playlist.id)).toEqual(['p1', 'p2'])
    expect(library.getPlaylist('p1')?.tracks.map((t) => t.id)).toEqual(['t1', 't2', 't3'])
    expect(library.selectedPlaylistId).toBe('p2')
  })

  it('손상된 JSON 에서도 앱이 멈추지 않는다', () => {
    const library = useLibraryStore()
    seedRaw('{not json')

    expect(() => library.restore()).not.toThrow()
    expect(library.restore()).toBe('malformed')
    expect(library.playlists).toEqual([])
    expect(library.status).toBe('protected')
    expect(library.protectedReason).toBe('malformed')
  })

  it.each([
    ['playlists 누락', { selectedPlaylistId: null }],
    ['playlists 가 배열이 아님', { playlists: 'nope', selectedPlaylistId: null }],
    ['객체가 아님', 'nope'],
    ['배열', [1, 2, 3]],
  ])('%s 은 복구할 수 없다', (_label, data) => {
    const library = useLibraryStore()
    seedRaw(envelope(data))

    expect(library.restore()).toBe('invalid')
    expect(library.status).toBe('protected')
    expect(library.playlists).toEqual([])
  })

  it('불량 플레이리스트·트랙만 버리고 나머지를 살린다', () => {
    const library = useLibraryStore()
    seedRaw(
      envelope({
        playlists: [
          { id: 'good', name: 'GOOD', tracks: [track('t1'), { id: 't2', source: 'spotify' }] },
          { id: '', name: 'NO ID', tracks: [] },
          { id: 'noname', tracks: [] },
          { id: 'ok2', name: 'OK2', tracks: [] },
        ],
        selectedPlaylistId: 'good',
      }),
    )

    library.restore()

    expect(library.playlists.map((playlist) => playlist.id)).toEqual(['good', 'ok2'])
    expect(library.getPlaylist('good')?.tracks.map((t) => t.id)).toEqual(['t1'])
    // 일부만 살렸으므로 원본을 보호한다.
    expect(library.status).toBe('protected')
    expect(library.protectedReason).toBe('partial-recovery')
  })

  it('중복 플레이리스트 ID 는 처음 것만 남긴다', () => {
    const library = useLibraryStore()
    seedRaw(
      envelope({
        playlists: [
          { id: 'dup', name: 'FIRST', tracks: [] },
          { id: 'dup', name: 'SECOND', tracks: [] },
        ],
        selectedPlaylistId: 'dup',
      }),
    )

    library.restore()

    expect(library.playlists).toHaveLength(1)
    expect(library.getPlaylist('dup')?.name).toBe('FIRST')
    expect(library.status).toBe('protected')
  })

  it('플레이리스트 안의 중복 트랙 ID 도 처음 것만 남긴다', () => {
    const library = useLibraryStore()
    seedRaw(
      envelope({
        playlists: [
          { id: 'p1', name: 'A', tracks: [track('t1', 'dQw4w9WgXcQ'), track('t1', 'a_b-c1D2E3F')] },
        ],
        selectedPlaylistId: 'p1',
      }),
    )

    library.restore()

    expect(library.getPlaylist('p1')?.tracks).toHaveLength(1)
    expect(library.getPlaylist('p1')?.tracks[0]?.videoId).toBe('dQw4w9WgXcQ')
  })

  it('유효하지 않은 videoId 를 가진 트랙을 버린다', () => {
    const library = useLibraryStore()
    seedRaw(
      envelope({
        playlists: [
          {
            id: 'p1',
            name: 'A',
            tracks: [
              { id: 't1', source: 'youtube', videoId: 'tooshort', title: 'bad' },
              track('t2'),
            ],
          },
        ],
        selectedPlaylistId: 'p1',
      }),
    )

    library.restore()

    expect(library.getPlaylist('p1')?.tracks.map((t) => t.id)).toEqual(['t2'])
  })

  it('존재하지 않는 선택 ID 를 첫 목록으로 보정한다', () => {
    const library = useLibraryStore()
    seedRaw(
      envelope({
        playlists: [
          { id: 'p1', name: 'A', tracks: [] },
          { id: 'p2', name: 'B', tracks: [] },
        ],
        selectedPlaylistId: 'ghost',
      }),
    )

    library.restore()

    expect(library.selectedPlaylistId).toBe('p1')
    // 선택 보정은 데이터 손실이 아니므로 저장을 막지 않는다.
    expect(library.status).toBe('ready')
  })

  it('목록이 비어 있으면 선택은 null 이다', () => {
    const library = useLibraryStore()
    seedRaw(envelope({ playlists: [], selectedPlaylistId: 'ghost' }))

    library.restore()

    expect(library.selectedPlaylistId).toBeNull()
    expect(library.status).toBe('ready')
  })

  it('미래 버전 데이터를 보존하고 보호 상태가 된다', () => {
    const library = useLibraryStore()
    const future = envelope(
      { playlists: [], selectedPlaylistId: null },
      LIBRARY_STORAGE_VERSION + 1,
    )
    seedRaw(future)

    expect(library.restore()).toBe('version-mismatch')
    expect(library.status).toBe('protected')
    expect(library.protectedReason).toBe('version-mismatch')
    expect(readRaw()).toBe(future)
  })

  it('localStorage 접근 실패를 unavailable 로 처리한다', () => {
    stubLocalStorage({
      get() {
        throw new Error('blocked')
      },
    })
    const library = useLibraryStore()

    expect(library.restore()).toBe('unavailable')
    expect(library.status).toBe('unavailable')
    expect(library.canPersist).toBe(false)
  })

  it('저장 실패해도 메모리 수정은 유지된다', () => {
    const map = new Map<string, string>()
    stubLocalStorage({
      value: {
        get length() {
          return map.size
        },
        key: (index: number) => [...map.keys()][index] ?? null,
        getItem: (key: string) => map.get(key) ?? null,
        setItem: () => {
          throw new DOMException('full', 'QuotaExceededError')
        },
        removeItem: (key: string) => void map.delete(key),
        clear: () => map.clear(),
      } satisfies Storage,
      writable: true,
    })
    const library = useLibraryStore()

    const result = library.createPlaylist('STILL WORKS')

    expect(result.ok).toBe(true)
    expect(result.ok && result.persisted).toBe(false)
    expect(library.playlists.map((playlist) => playlist.name)).toEqual(['STILL WORKS'])
    expect(library.lastWriteFailure).toBe('quota-exceeded')
  })

  it('복원만으로 저장소에 쓰지 않는다', () => {
    const raw = envelope({
      playlists: [{ id: 'p1', name: 'A', tracks: [] }],
      selectedPlaylistId: 'p1',
    })
    seedRaw(raw)
    const library = useLibraryStore()

    library.restore()

    expect(readRaw()).toBe(raw)
  })

  it.each([
    ['손상된 JSON', '{not json'],
    [
      '복구 불가 데이터',
      JSON.stringify({ version: LIBRARY_STORAGE_VERSION, data: { playlists: 'nope' } }),
    ],
    [
      '미래 버전',
      JSON.stringify({ version: 99, data: { playlists: [], selectedPlaylistId: null } }),
    ],
  ])('%s — 이후 수정이 원본을 덮어쓰지 않는다', (_label, raw) => {
    seedRaw(raw)
    const library = useLibraryStore()
    library.restore()

    const result = library.createPlaylist('NEW')

    // 메모리에는 반영되지만 저장소는 그대로다.
    expect(result.ok).toBe(true)
    expect(result.ok && result.persisted).toBe(false)
    expect(library.playlists).toHaveLength(1)
    expect(readRaw()).toBe(raw)
  })

  it('일부만 복구한 경우에도 원본을 덮어쓰지 않는다', () => {
    const raw = envelope({
      playlists: [
        { id: 'good', name: 'GOOD', tracks: [] },
        { id: 'bad', tracks: [] },
      ],
      selectedPlaylistId: 'good',
    })
    seedRaw(raw)
    const library = useLibraryStore()
    library.restore()

    library.renamePlaylist('good', 'RENAMED')

    expect(library.getPlaylist('good')?.name).toBe('RENAMED')
    expect(readRaw()).toBe(raw)
  })

  it('정상 복원 후에는 다시 저장할 수 있다', () => {
    seedRaw(
      envelope({ playlists: [{ id: 'p1', name: 'A', tracks: [] }], selectedPlaylistId: 'p1' }),
    )
    const library = useLibraryStore()
    library.restore()

    expect(library.status).toBe('ready')
    const result = library.createPlaylist('B')

    expect(result.ok && result.persisted).toBe(true)
    expect(storedData().playlists).toHaveLength(2)
  })

  it('프로토타입 키를 읽지 않는다', () => {
    globalThis.localStorage.setItem('mlf_mono_vinyl_v08', JSON.stringify({ lists: [{ id: 'x' }] }))
    const library = useLibraryStore()

    library.restore()

    expect(library.playlists).toEqual([])
    expect(readSource('src/stores/library.ts')).not.toContain('mlf_mono_vinyl')
  })
})

describe('normalizeLibraryData', () => {
  it('형태가 근본적으로 다르면 null 이다', () => {
    for (const value of [null, undefined, 'x', 42, [], { playlists: 'no' }]) {
      expect(normalizeLibraryData(value)).toBeNull()
    }
  })

  it('버린 항목 수를 보고한다', () => {
    const result = normalizeLibraryData({
      playlists: [{ id: 'p1', name: 'A', tracks: [track('t1'), { id: 'bad' }] }, { id: 'p2' }],
      selectedPlaylistId: 'p1',
    })

    expect(result?.report).toEqual({
      droppedPlaylists: 1,
      droppedTracks: 1,
      repairedSelection: false,
    })
  })

  it('정상 데이터에서는 아무것도 버리지 않는다', () => {
    const result = normalizeLibraryData({
      playlists: [{ id: 'p1', name: 'A', tracks: [track('t1')] }],
      selectedPlaylistId: 'p1',
    })

    expect(result?.report).toEqual({
      droppedPlaylists: 0,
      droppedTracks: 0,
      repairedSelection: false,
    })
  })

  it('빈 라이브러리에서 선택 보정을 보고하지 않는다', () => {
    const result = normalizeLibraryData({ playlists: [], selectedPlaylistId: null })

    expect(result?.report.repairedSelection).toBe(false)
    expect(result?.data).toEqual({ playlists: [], selectedPlaylistId: null })
  })
})
