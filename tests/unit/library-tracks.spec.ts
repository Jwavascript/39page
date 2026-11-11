import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { STORAGE_KEYS } from '@/shared/storage'
import {
  LIBRARY_STORAGE_VERSION,
  MAX_TRACK_TITLE_LENGTH,
  defaultTrackTitle,
  useLibraryStore,
} from '@/stores/library'

const KEY = STORAGE_KEYS.library
const realLocalStorage = globalThis.localStorage
const VIDEO_A = 'dQw4w9WgXcQ'
const VIDEO_B = 'a_b-c1D2E3F'

function stubLocalStorage(descriptor: PropertyDescriptor): void {
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, ...descriptor })
}

function readRaw(): string | null {
  return globalThis.localStorage.getItem(KEY)
}

function envelope(data: unknown, version = LIBRARY_STORAGE_VERSION): string {
  return JSON.stringify({ version, data })
}

/** 플레이리스트 하나를 만들고 id 를 돌려준다. */
async function withPlaylist(
  name = 'A',
): Promise<{ library: ReturnType<typeof useLibraryStore>; id: string }> {
  const library = useLibraryStore()
  const created = await library.createPlaylist(name)
  return { library, id: created.ok ? created.playlistId : '' }
}

beforeEach(() => {
  globalThis.localStorage.clear()
  setActivePinia(createPinia())
})

afterEach(() => {
  stubLocalStorage({ value: realLocalStorage, writable: true })
  globalThis.localStorage.clear()
})

describe('A. addTrack', () => {
  it('1. 트랙을 목록 끝에 추가한다', async () => {
    const { library, id } = await withPlaylist()

    const first = await library.addTrack(id, { videoId: VIDEO_A, title: 'First' })
    const second = await library.addTrack(id, { videoId: VIDEO_B, title: 'Second' })

    expect(first.ok).toBe(true)
    expect(second.ok).toBe(true)
    expect(library.getPlaylist(id)?.tracks.map((t) => t.title)).toEqual(['First', 'Second'])
    expect(library.getPlaylist(id)?.tracks[0]).toMatchObject({
      source: 'youtube',
      videoId: VIDEO_A,
    })
  })

  it('2. 존재하지 않는 플레이리스트를 거부한다', async () => {
    const { library } = await withPlaylist()

    expect(await library.addTrack('ghost', { videoId: VIDEO_A })).toEqual({
      ok: false,
      reason: 'not-found',
    })
  })

  it.each([
    ['짧은 ID', 'tooshort'],
    ['긴 ID', `${VIDEO_A}EXTRA`],
    ['빈 문자열', ''],
    ['허용하지 않는 문자', 'abcdefghij!'],
    ['URL 전체', 'https://youtu.be/dQw4w9WgXcQ'],
  ])('3. %s 는 invalid-video-id 로 거부한다', async (_label, videoId) => {
    const { library, id } = await withPlaylist()

    expect(await library.addTrack(id, { videoId })).toEqual({
      ok: false,
      reason: 'invalid-video-id',
    })
    expect(library.getPlaylist(id)?.tracks).toEqual([])
  })

  it('4. 제목의 앞뒤 공백을 제거한다', async () => {
    const { library, id } = await withPlaylist()

    library.addTrack(id, { videoId: VIDEO_A, title: '   Spaced Title   ' })

    expect(library.getPlaylist(id)?.tracks[0]?.title).toBe('Spaced Title')
  })

  it.each([
    ['미입력', undefined],
    ['빈 문자열', ''],
    ['공백뿐', '   '],
  ])('5. 제목이 %s 이면 기본 제목을 만든다', async (_label, title) => {
    const { library, id } = await withPlaylist()

    library.addTrack(id, { videoId: VIDEO_A, title })

    expect(library.getPlaylist(id)?.tracks[0]?.title).toBe(defaultTrackTitle(VIDEO_A))
    expect(library.getPlaylist(id)?.tracks[0]?.title).toBe(`YouTube · ${VIDEO_A}`)
  })

  it('6. 제목을 100자로 자른다', async () => {
    const { library, id } = await withPlaylist()

    library.addTrack(id, { videoId: VIDEO_A, title: 'X'.repeat(200) })

    expect(library.getPlaylist(id)?.tracks[0]?.title).toHaveLength(MAX_TRACK_TITLE_LENGTH)
  })

  it('7. 트랙 ID 가 서로 다르다', async () => {
    const { library, id } = await withPlaylist()

    for (let i = 0; i < 5; i += 1) library.addTrack(id, { videoId: VIDEO_A })

    const ids = library.getPlaylist(id)?.tracks.map((t) => t.id) ?? []
    expect(ids).toHaveLength(5)
    expect(new Set(ids).size).toBe(5)
    expect(ids.every((trackId) => trackId.length > 0)).toBe(true)
  })

  it('8. 같은 영상을 여러 번 넣어도 track.id 는 분리된다', async () => {
    const { library, id } = await withPlaylist()

    const a = await library.addTrack(id, { videoId: VIDEO_A, title: '1회차' })
    const b = await library.addTrack(id, { videoId: VIDEO_A, title: '2회차' })

    // 영상 중복 등록은 막지 않는다. 사용자가 의도적으로 배치할 수 있다.
    expect(library.getPlaylist(id)?.tracks).toHaveLength(2)
    expect(a.ok && b.ok && a.trackId !== b.trackId).toBe(true)
  })

  it('URL 문자열을 저장하지 않는다', async () => {
    const { library, id } = await withPlaylist()
    library.addTrack(id, { videoId: VIDEO_A })

    const stored = readRaw() ?? ''
    expect(stored).not.toContain('http')
    expect(stored).toContain(VIDEO_A)
  })

  it('다른 플레이리스트를 건드리지 않는다', async () => {
    const library = useLibraryStore()
    const a = await library.createPlaylist('A')
    const b = await library.createPlaylist('B')
    const idA = a.ok ? a.playlistId : ''
    const idB = b.ok ? b.playlistId : ''
    const beforeA = library.getPlaylist(idA)

    library.addTrack(idB, { videoId: VIDEO_A })

    expect(library.getPlaylist(idA)).toBe(beforeA)
    expect(library.getPlaylist(idA)?.tracks).toEqual([])
  })

  it('추가한 트랙이 복원 검증을 통과한다', async () => {
    // normalizeTrack 과 같은 기준으로 검증하므로 다음 복원에서 버려지지 않는다.
    const { library, id } = await withPlaylist()
    library.addTrack(id, { videoId: VIDEO_A, title: 'Keep me' })

    setActivePinia(createPinia())
    const reloaded = useLibraryStore()
    reloaded.restore()

    expect(reloaded.getPlaylist(id)?.tracks.map((t) => t.title)).toEqual(['Keep me'])
    expect(reloaded.status).toBe('ready')
  })
})

describe('A. removeTrack', () => {
  it('9. 트랙을 지우고 나머지 순서를 유지한다', async () => {
    const { library, id } = await withPlaylist()
    library.addTrack(id, { videoId: VIDEO_A, title: '1' })
    const middle = await library.addTrack(id, { videoId: VIDEO_B, title: '2' })
    library.addTrack(id, { videoId: VIDEO_A, title: '3' })
    const beforeIds = library.getPlaylist(id)?.tracks.map((t) => t.id) ?? []

    const result = await library.removeTrack(id, middle.ok ? (middle.trackId ?? '') : '')

    expect(result.ok).toBe(true)
    expect(library.getPlaylist(id)?.tracks.map((t) => t.title)).toEqual(['1', '3'])
    expect(library.getPlaylist(id)?.tracks.map((t) => t.id)).toEqual([beforeIds[0], beforeIds[2]])
  })

  it('10. 없는 트랙 삭제를 거부한다', async () => {
    const { library, id } = await withPlaylist()
    library.addTrack(id, { videoId: VIDEO_A })

    expect(await library.removeTrack(id, 'ghost')).toEqual({ ok: false, reason: 'not-found' })
    expect(library.getPlaylist(id)?.tracks).toHaveLength(1)
  })

  it('없는 플레이리스트의 트랙 삭제를 거부한다', async () => {
    const { library } = await withPlaylist()
    expect(await library.removeTrack('ghost', 'x')).toEqual({ ok: false, reason: 'not-found' })
  })
})

describe('A. moveTrack', () => {
  async function threeTracks() {
    const { library, id } = await withPlaylist()
    for (const title of ['1', '2', '3']) library.addTrack(id, { videoId: VIDEO_A, title })
    return { library, id, ids: library.getPlaylist(id)?.tracks.map((t) => t.id) ?? [] }
  }

  it('11. 위로 옮긴다', async () => {
    const { library, id, ids } = await threeTracks()

    const result = await library.moveTrack(id, ids[1] ?? '', 'up')

    expect(result.ok).toBe(true)
    expect(library.getPlaylist(id)?.tracks.map((t) => t.title)).toEqual(['2', '1', '3'])
  })

  it('11. 아래로 옮긴다', async () => {
    const { library, id, ids } = await threeTracks()

    library.moveTrack(id, ids[1] ?? '', 'down')

    expect(library.getPlaylist(id)?.tracks.map((t) => t.title)).toEqual(['1', '3', '2'])
  })

  it('12. 첫 번째를 위로, 마지막을 아래로 옮길 수 없다', async () => {
    const { library, id, ids } = await threeTracks()

    expect(await library.moveTrack(id, ids[0] ?? '', 'up')).toEqual({
      ok: false,
      reason: 'out-of-range',
    })
    expect(await library.moveTrack(id, ids[2] ?? '', 'down')).toEqual({
      ok: false,
      reason: 'out-of-range',
    })
    // 상태가 바뀌지 않는다.
    expect(library.getPlaylist(id)?.tracks.map((t) => t.title)).toEqual(['1', '2', '3'])
  })

  it('13. 이동 후 모든 트랙 ID 와 데이터가 유지된다', async () => {
    const { library, id, ids } = await threeTracks()
    const before = library.getPlaylist(id)?.tracks.map((t) => ({ ...t })) ?? []

    library.moveTrack(id, ids[2] ?? '', 'up')
    library.moveTrack(id, ids[0] ?? '', 'down')

    const after = library.getPlaylist(id)?.tracks ?? []
    expect(after).toHaveLength(3)
    expect(new Set(after.map((t) => t.id)).size).toBe(3)
    // 같은 트랙 집합이어야 한다. 사라지거나 중복되지 않는다.
    expect([...after].sort((a, b) => a.id.localeCompare(b.id))).toEqual(
      [...before].sort((a, b) => a.id.localeCompare(b.id)),
    )
  })

  it('없는 트랙·플레이리스트 이동을 거부한다', async () => {
    const { library, id } = await threeTracks()

    expect(await library.moveTrack(id, 'ghost', 'up')).toEqual({ ok: false, reason: 'not-found' })
    expect(await library.moveTrack('ghost', 'x', 'up')).toEqual({ ok: false, reason: 'not-found' })
  })
})

describe('A. renameTrack (M6-5)', () => {
  /*
   * 실기기 검증 보고 6c: "이미 저장한 레코드들의 이름을 변경하는 기능이 추가로
   * 필요할 것 같고." 그때까지 트랙 이름을 바꿀 방법이 없었다.
   */
  async function twoTracks() {
    const { library, id } = await withPlaylist()
    library.addTrack(id, { videoId: VIDEO_A, title: 'First' })
    library.addTrack(id, { videoId: VIDEO_B, title: 'Second' })
    return { library, id, ids: library.getPlaylist(id)?.tracks.map((t) => t.id) ?? [] }
  }

  it('제목만 바꾸고 id · videoId · 순서는 그대로다', async () => {
    const { library, id, ids } = await twoTracks()
    const before = library.getPlaylist(id)?.tracks.map((t) => ({ ...t })) ?? []

    const result = await library.renameTrack(id, ids[0] ?? '', 'Renamed')

    expect(result.ok).toBe(true)
    const after = library.getPlaylist(id)?.tracks ?? []
    expect(after.map((t) => t.title)).toEqual(['Renamed', 'Second'])
    expect(after.map((t) => t.id)).toEqual(before.map((t) => t.id))
    expect(after.map((t) => t.videoId)).toEqual(before.map((t) => t.videoId))
  })

  it('앞뒤 공백을 제거한다', async () => {
    const { library, id, ids } = await twoTracks()

    library.renameTrack(id, ids[0] ?? '', '  Trimmed  ')

    expect(library.getPlaylist(id)?.tracks[0]?.title).toBe('Trimmed')
  })

  it('100자로 자른다', async () => {
    const { library, id, ids } = await twoTracks()

    library.renameTrack(id, ids[0] ?? '', 'x'.repeat(MAX_TRACK_TITLE_LENGTH + 20))

    expect(library.getPlaylist(id)?.tracks[0]?.title).toHaveLength(MAX_TRACK_TITLE_LENGTH)
  })

  it('비우면 기본 표기로 되돌아간다 — addTrack 과 같은 규칙이다', async () => {
    const { library, id, ids } = await twoTracks()

    const result = await library.renameTrack(id, ids[0] ?? '', '   ')

    // 추가할 때와 고칠 때 빈 제목의 뜻이 달라지면 예측할 수 없다.
    expect(result.ok).toBe(true)
    expect(library.getPlaylist(id)?.tracks[0]?.title).toBe(defaultTrackTitle(VIDEO_A))
  })

  it('없는 트랙·플레이리스트는 거부한다', async () => {
    const { library, id, ids } = await twoTracks()

    expect(await library.renameTrack(id, 'nope', 'X')).toEqual({ ok: false, reason: 'not-found' })
    expect(await library.renameTrack('nope', ids[0] ?? '', 'X')).toEqual({
      ok: false,
      reason: 'not-found',
    })
    expect(library.getPlaylist(id)?.tracks.map((t) => t.title)).toEqual(['First', 'Second'])
  })

  it('다른 플레이리스트를 건드리지 않는다', async () => {
    const { library, id, ids } = await twoTracks()
    const other = await library.createPlaylist('OTHER')
    const otherId = other.ok ? other.playlistId : ''
    library.addTrack(otherId, { videoId: VIDEO_A, title: 'Untouched' })
    const otherTracks = library.getPlaylist(otherId)?.tracks

    library.renameTrack(id, ids[0] ?? '', 'Renamed')

    // 편집하지 않은 목록은 같은 객체 참조로 남는다.
    expect(library.getPlaylist(otherId)?.tracks).toBe(otherTracks)
  })

  it('이름을 바꾸면 저장된다', async () => {
    const { library, id, ids } = await twoTracks()

    const result = await library.renameTrack(id, ids[0] ?? '', 'Persisted')

    expect(result.ok && result.persisted).toBe(true)
    expect(readRaw()).toContain('Persisted')
  })

  it('실패한 이름 변경은 쓰기를 발생시키지 않는다', async () => {
    const { library, id } = await twoTracks()
    const before = readRaw()

    library.renameTrack(id, 'nope', 'X')

    expect(readRaw()).toBe(before)
  })
})

describe('A. 실패 시 저장소를 건드리지 않는다', () => {
  it('14. 실패한 트랙 동작은 쓰기를 발생시키지 않는다', async () => {
    const { library, id } = await withPlaylist()
    library.addTrack(id, { videoId: VIDEO_A })
    const snapshot = readRaw()

    // 전부 실패하는 호출들.
    library.addTrack('ghost', { videoId: VIDEO_A })
    library.addTrack(id, { videoId: 'bad' })
    library.removeTrack(id, 'ghost')
    library.moveTrack(id, 'ghost', 'up')
    const onlyId = library.getPlaylist(id)?.tracks[0]?.id ?? ''
    library.moveTrack(id, onlyId, 'up')

    expect(readRaw()).toBe(snapshot)
  })
})

describe('C. 저장과 복원', () => {
  it('27 · 28. 트랙 추가 후 새 Store 에서 복원된다', async () => {
    const { library, id } = await withPlaylist('NIGHT DRIVE')
    library.addTrack(id, { videoId: VIDEO_A, title: 'One' })
    library.addTrack(id, { videoId: VIDEO_B, title: 'Two' })

    setActivePinia(createPinia())
    const reloaded = useLibraryStore()
    reloaded.restore()

    expect(reloaded.getPlaylist(id)?.tracks.map((t) => t.title)).toEqual(['One', 'Two'])
  })

  it('29. 삭제 후 복원된다', async () => {
    const { library, id } = await withPlaylist()
    const first = await library.addTrack(id, { videoId: VIDEO_A, title: 'One' })
    library.addTrack(id, { videoId: VIDEO_B, title: 'Two' })
    library.removeTrack(id, first.ok ? (first.trackId ?? '') : '')

    setActivePinia(createPinia())
    const reloaded = useLibraryStore()
    reloaded.restore()

    expect(reloaded.getPlaylist(id)?.tracks.map((t) => t.title)).toEqual(['Two'])
  })

  it('30. 순서 변경 후 복원된다', async () => {
    const { library, id } = await withPlaylist()
    for (const title of ['1', '2', '3']) library.addTrack(id, { videoId: VIDEO_A, title })
    const ids = library.getPlaylist(id)?.tracks.map((t) => t.id) ?? []
    library.moveTrack(id, ids[2] ?? '', 'up')

    setActivePinia(createPinia())
    const reloaded = useLibraryStore()
    reloaded.restore()

    expect(reloaded.getPlaylist(id)?.tracks.map((t) => t.title)).toEqual(['1', '3', '2'])
  })

  it('31. 저장 실패를 persisted: false 로 알린다', async () => {
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
    const { library, id } = await withPlaylist()

    const result = await library.addTrack(id, { videoId: VIDEO_A })

    expect(result.ok).toBe(true)
    expect(result.ok && result.persisted).toBe(false)
    expect(library.getPlaylist(id)?.tracks).toHaveLength(1)
  })

  it('32. protected 상태에서 원본이 보존된다', async () => {
    const raw = '{not json'
    globalThis.localStorage.setItem(KEY, raw)
    const library = useLibraryStore()
    library.restore()
    const created = await library.createPlaylist('IN MEMORY')
    const id = created.ok ? created.playlistId : ''

    const result = await library.addTrack(id, { videoId: VIDEO_A, title: 'Ghost' })

    expect(result.ok).toBe(true)
    expect(result.ok && result.persisted).toBe(false)
    expect(library.getPlaylist(id)?.tracks).toHaveLength(1)
    expect(readRaw()).toBe(raw)
  })

  it('33. unavailable 상태에서도 메모리 편집은 된다', async () => {
    stubLocalStorage({
      get() {
        throw new Error('blocked')
      },
    })
    const library = useLibraryStore()
    library.restore()
    const created = await library.createPlaylist('A')
    const id = created.ok ? created.playlistId : ''

    const result = await library.addTrack(id, { videoId: VIDEO_A })

    expect(result.ok && result.persisted).toBe(false)
    expect(library.getPlaylist(id)?.tracks).toHaveLength(1)
    expect(library.status).toBe('unavailable')
  })

  it('34. 일부 불량 트랙이 있어도 복원이 멈추지 않는다', () => {
    globalThis.localStorage.setItem(
      KEY,
      envelope({
        playlists: [
          {
            id: 'p1',
            name: 'A',
            tracks: [
              { id: 't1', source: 'youtube', videoId: VIDEO_A, title: 'good' },
              { id: 't2', source: 'youtube', videoId: 'broken', title: 'bad' },
            ],
          },
        ],
        selectedPlaylistId: 'p1',
      }),
    )
    const library = useLibraryStore()

    expect(() => library.restore()).not.toThrow()
    expect(library.getPlaylist('p1')?.tracks.map((t) => t.id)).toEqual(['t1'])
    // 버린 항목이 있으므로 원본을 보호한다 (ADR 0007).
    expect(library.status).toBe('protected')
    expect(library.protectedReason).toBe('partial-recovery')
  })
})
