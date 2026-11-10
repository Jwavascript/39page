/**
 * M8-4 — 백업 파일 호환성 회귀.
 *
 * **고정 파일을 기준으로 본다.** `tests/fixtures/backup-v1.json` 은 과거에
 * 실제로 내보낸 파일의 모양이고, 수정하지 않는다. 포맷을 바꾸거나 내부
 * 스키마를 올릴 때 **구형 백업이 깨지면 이 테스트가 먼저 깨진다.**
 *
 * 왜 따로 두는가: `backup-export.spec.ts` 와 `backup-import.spec.ts` 는 **지금
 * 코드가 만든 파일**로 자기 자신을 검사한다. 양쪽을 같이 바꾸면 둘 다 통과하면서
 * 구형 파일이 조용히 안 읽히게 될 수 있다. 바깥에 고정된 파일이 그 구멍을 막는다.
 *
 * 기준 문서: `docs/architecture/BACKUP_FORMAT.md` §3 (버전과 호환성 정책).
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  BACKUP_FORMAT,
  BACKUP_SCHEMA_VERSION,
  BACKUP_SECTION_VERSIONS,
  type BackupFile,
} from '@/features/backup/backupSchema'
import { countBackupItems, createBackup } from '@/features/backup/createBackup'
import { readBackup, type BackupWarning } from '@/features/backup/readBackup'
import { LIBRARY_STORAGE_VERSION } from '@/stores/library'
import { THEME_STORAGE_VERSION } from '@/stores/theme'

/** 고정 파일. **이 파일을 수정해서 테스트를 통과시키면 안 된다.** */
const FIXTURE_PATH = resolve(process.cwd(), 'tests/fixtures/backup-v1.json')
const FIXTURE_TEXT = readFileSync(FIXTURE_PATH, 'utf8')

const warningKinds = (warnings: readonly BackupWarning[]): string[] =>
  warnings.map((warning) => warning.kind)

beforeEach(() => {
  globalThis.localStorage.clear()
  setActivePinia(createPinia())
})

afterEach(() => {
  globalThis.localStorage.clear()
})

describe('A. 고정된 v1 백업을 지금 코드가 읽는다', () => {
  it('거부하지 않고 읽는다', () => {
    const result = readBackup(FIXTURE_TEXT)

    expect(result.ok).toBe(true)
    /*
     * M9-5 부터 이 파일에는 안내가 **하나** 붙는다 — Moments 가 생기기 전 파일이라
     * 지금 Moments 는 그대로 남는다는 것. 그 밖의 경고는 여전히 없다.
     */
    expect(result.warnings).toEqual([{ kind: 'moments-section-absent' }])
    expect(result.ok && result.momentsSection).toBe('absent')
    expect(result.ok && result.moments).toBeNull()
  })

  it('플레이리스트 id 와 순서를 보존한다', () => {
    const result = readBackup(FIXTURE_TEXT)
    if (!result.ok || result.library === null) throw new Error('고정 파일을 읽지 못했다')

    expect(result.library.playlists.map((playlist) => playlist.id)).toEqual([
      'p-night',
      'p-morning',
    ])
    expect(result.library.playlists.map((playlist) => playlist.name)).toEqual([
      'NIGHT DRIVE',
      'MORNING',
    ])
  })

  it('트랙 id · videoId · 제목 · 순서를 보존한다', () => {
    const result = readBackup(FIXTURE_TEXT)
    if (!result.ok || result.library === null) throw new Error('고정 파일을 읽지 못했다')

    expect(result.library.playlists[0]?.tracks).toEqual([
      { id: 't-1', source: 'youtube', videoId: 'aaaaaaaaaaa', title: 'ALPHA' },
      { id: 't-2', source: 'youtube', videoId: 'bbbbbbbbbbb', title: 'BETA' },
    ])
    expect(result.library.playlists[1]?.tracks[0]?.id).toBe('t-3')
  })

  it('선택된 플레이리스트와 테마를 보존한다', () => {
    const result = readBackup(FIXTURE_TEXT)

    expect(result.ok && result.library?.selectedPlaylistId).toBe('p-morning')
    expect(result.ok && result.theme).toBe('kawaii-synth-cassette')
  })

  it('개수가 맞다', () => {
    const result = readBackup(FIXTURE_TEXT)
    expect(result.ok && result.counts).toEqual({ playlists: 2, tracks: 3 })
  })

  /*
   * 상수가 바뀌면 고정 파일이 안 읽힌다. 바꾸려면 마이그레이션이 먼저다.
   */
  it('지금 상수가 고정 파일의 버전과 맞는다', () => {
    const file = JSON.parse(FIXTURE_TEXT) as BackupFile

    expect(file.format).toBe(BACKUP_FORMAT)
    expect(file.schemaVersion).toBe(BACKUP_SCHEMA_VERSION)
    expect(file.data.library.version).toBe(BACKUP_SECTION_VERSIONS.library)
    expect(file.data.preferences?.theme?.version).toBe(BACKUP_SECTION_VERSIONS.theme)
  })

  it('섹션 버전이 내부 저장 버전과 같은 축이다', () => {
    expect(BACKUP_SECTION_VERSIONS.library).toBe(LIBRARY_STORAGE_VERSION)
    expect(BACKUP_SECTION_VERSIONS.theme).toBe(THEME_STORAGE_VERSION)
  })
})

describe('B. 왕복 동등성', () => {
  it('고정 파일 → 읽기 → 다시 조립 = 같은 data', () => {
    const read = readBackup(FIXTURE_TEXT)
    if (!read.ok || read.library === null || read.theme === null) {
      throw new Error('고정 파일을 읽지 못했다')
    }

    const rebuilt = createBackup({
      library: read.library,
      moments: [],
      theme: read.theme,
      integrity: null,
      exportedAt: new Date(read.exportedAt ?? 0),
    })

    const original = JSON.parse(FIXTURE_TEXT) as BackupFile
    /*
     * 고정 파일에 있던 섹션은 바이트 수준으로 같아야 한다. 왕복해도 아무것도
     * 늘거나 줄지 않는다. M9-5 의 조립은 Moments 섹션을 **항상** 더하므로(0개면
     * 빈 배열) 그 하나만 다르다.
     */
    const { moments, ...rest } = rebuilt.data
    expect(rest).toEqual(original.data)
    expect(moments).toEqual({ version: 1, data: [] })
    expect(rebuilt.exportedAt).toBe(original.exportedAt)
  })

  it('조립 → 읽기 → 조립 = 같은 결과 (두 번 왕복)', () => {
    const first = createBackup({
      library: {
        playlists: [
          {
            id: 'x',
            name: 'X',
            tracks: [{ id: 'tx', source: 'youtube', videoId: 'xxxxxxxxxxx', title: 'TX' }],
          },
        ],
        selectedPlaylistId: 'x',
      },
      moments: [],
      theme: 'mono-vinyl',
      integrity: null,
      exportedAt: new Date('2026-01-02T03:04:05.006Z'),
    })

    const read = readBackup(JSON.stringify(first))
    if (!read.ok || read.library === null || read.theme === null) throw new Error('읽기 실패')

    const second = createBackup({
      library: read.library,
      moments: [],
      theme: read.theme,
      integrity: null,
      exportedAt: new Date(first.exportedAt),
    })

    expect(second).toEqual(first)
  })

  it('왕복이 개수를 바꾸지 않는다', () => {
    const read = readBackup(FIXTURE_TEXT)
    if (!read.ok || read.library === null || read.theme === null) throw new Error('읽기 실패')

    const rebuilt = createBackup({
      library: read.library,
      moments: [],
      theme: read.theme,
      integrity: null,
      exportedAt: new Date(0),
    })

    expect(countBackupItems(rebuilt)).toEqual({ playlists: 2, tracks: 3 })
  })
})

describe('C. 미래 확장과의 공존 (M9 Music Moments)', () => {
  /**
   * 고정 파일에 선택 섹션을 더한 것. M8-4 가 M9 를 **미리 흉내낸** 모양이다 —
   * `source` · `title` · `updatedAt` 이 빠져 있다. M9-5 의 검증은 그것을 형식
   * 오류로 버린다 (아래).
   */
  function withMoments(): string {
    const file = JSON.parse(FIXTURE_TEXT) as Record<string, unknown>
    const data = file.data as Record<string, unknown>
    data.moments = {
      version: 1,
      data: [
        {
          id: 'm-1',
          videoId: 'aaaaaaaaaaa',
          atSeconds: 42,
          note: '여기부터 좋다',
          createdAt: '2026-11-06T04:30:00.000Z',
        },
      ],
    }
    return JSON.stringify(file)
  }

  it('알 수 없는 선택 섹션이 있어도 라이브러리를 정상 복원한다', () => {
    const result = readBackup(withMoments())

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.library?.playlists).toHaveLength(2)
    expect(result.library?.selectedPlaylistId).toBe('p-morning')
    expect(result.theme).toBe('kawaii-synth-cassette')
  })

  /*
   * M8-4 까지 `moments` 는 "알 수 없는 섹션" 이었다. M9-5 부터는 아는 섹션이고
   * `normalizeMomentsData` 가 검증한다. 흉내낸 모양은 필드가 빠졌으므로 버리고,
   * **조용히 버리지 않고** 개수와 이유를 알린다.
   */
  it('흉내낸 Moment 는 필드가 빠져 형식 오류로 버리고 알린다', () => {
    const result = readBackup(withMoments())

    expect(result.warnings).not.toContainEqual({ kind: 'unknown-section', section: 'moments' })
    expect(result.warnings).toContainEqual({
      kind: 'dropped-moments',
      count: 1,
      byReason: { shape: 1, 'video-id': 0, time: 0, 'duplicate-id': 0 },
    })
    // 섹션 자체는 읽었다 — 남은 것이 0개일 뿐이다.
    expect(result.ok && result.momentsSection).toBe('present')
    expect(result.ok && result.moments).toEqual([])
  })

  it('모르는 섹션은 여전히 이름을 알린다 — 조용히 버리지 않는다', () => {
    const file = JSON.parse(FIXTURE_TEXT) as Record<string, unknown>
    ;(file.data as Record<string, unknown>).layouts = { version: 1, data: [] }

    const result = readBackup(JSON.stringify(file))

    expect(result.warnings).toContainEqual({ kind: 'unknown-section', section: 'layouts' })
  })

  /*
   * 선택 섹션을 더하는 것은 파일 버전을 올리지 않는다
   * (`BACKUP_FORMAT.md` §3-2). 그래서 구형 앱도 그 파일을 읽을 수 있다.
   */
  it('선택 섹션이 추가돼도 파일 버전은 1 이다', () => {
    const result = readBackup(withMoments())

    expect(result.ok && result.schemaVersion).toBe(1)
  })

  it('알 수 없는 설정이 있어도 테마를 가져온다', () => {
    const file = JSON.parse(FIXTURE_TEXT) as Record<string, unknown>
    const preferences = (file.data as Record<string, unknown>).preferences as Record<
      string,
      unknown
    >
    preferences.locale = { version: 1, data: 'ko' }

    const result = readBackup(JSON.stringify(file))

    expect(result.ok && result.theme).toBe('kawaii-synth-cassette')
    expect(result.warnings).toContainEqual({
      kind: 'unknown-section',
      section: 'preferences.locale',
    })
  })
})

describe('D. 버전 경계 — 실제 지원 범위', () => {
  function withVersions(fileVersion: number, libraryVersion: number): string {
    const file = JSON.parse(FIXTURE_TEXT) as Record<string, unknown>
    file.schemaVersion = fileVersion
    ;((file.data as Record<string, unknown>).library as Record<string, unknown>).version =
      libraryVersion
    return JSON.stringify(file)
  }

  it('미래 파일 버전은 거부한다 — 구조를 추측하지 않는다', () => {
    expect(readBackup(withVersions(2, 1))).toMatchObject({
      ok: false,
      error: { kind: 'unsupported-version', schemaVersion: 2, supported: 1 },
    })
  })

  it('미래 섹션 버전은 그 섹션만 건너뛴다 — 파일 전체를 버리지 않는다', () => {
    const result = readBackup(withVersions(1, 2))

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.library).toBeNull()
    // 테마는 살아남는다.
    expect(result.theme).toBe('kawaii-synth-cassette')
    expect(result.warnings).toContainEqual({
      kind: 'section-skipped',
      section: 'library',
      reason: 'future-version',
      version: 2,
    })
  })

  /*
   * **이전 섹션 버전의 실제 지원 범위: 없다.**
   *
   * 마이그레이션 함수가 아직 없으므로 (`BACKUP_FORMAT.md` §3-3) 이전 버전
   * 섹션은 **추측해서 올리지 않고 건너뛴다.** 내부 스키마를 2 로 올릴 때
   * 마이그레이션을 **순수 함수로 따로 내보내** 저장 계층과 가져오기가 같은
   * 것을 쓰게 해야 한다 (ADR 0018 결정 6).
   *
   * 이 테스트는 그 제약을 **고정한다.** 마이그레이션을 붙이는 작업에서 이
   * 테스트가 깨지고, 그때 양쪽이 같은 함수를 쓰는지 확인하게 된다.
   */
  it('이전 섹션 버전은 지원하지 않는다 — 건너뛰고 알린다', () => {
    const result = readBackup(withVersions(1, 0))

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.library).toBeNull()
    expect(result.warnings).toContainEqual({
      kind: 'section-skipped',
      section: 'library',
      reason: 'old-version',
      version: 0,
    })
  })

  it('라이브러리와 테마가 모두 못 읽히면 거부한다', () => {
    const file = JSON.parse(FIXTURE_TEXT) as Record<string, unknown>
    const data = file.data as Record<string, unknown>
    ;(data.library as Record<string, unknown>).version = 99
    delete data.preferences

    expect(readBackup(JSON.stringify(file))).toMatchObject({
      ok: false,
      error: { kind: 'nothing-importable' },
    })
  })

  it('파일 버전과 섹션 버전은 독립적으로 움직인다', () => {
    // 파일 1 · 섹션 1 = 읽힌다. 섹션만 올리면 섹션만 막힌다.
    expect(readBackup(withVersions(1, 1)).ok).toBe(true)
    const sectionOnly = readBackup(withVersions(1, 2))
    expect(sectionOnly.ok).toBe(true)
    expect(sectionOnly.ok && sectionOnly.schemaVersion).toBe(1)
  })
})

describe('E. 복구본과 불완전한 파일', () => {
  function withIntegrity(reason: string): string {
    const file = JSON.parse(FIXTURE_TEXT) as Record<string, unknown>
    file.integrity = { library: { level: 'recovered', reason } }
    return JSON.stringify(file)
  }

  it('복구본 표시를 읽어 경고한다', () => {
    const result = readBackup(withIntegrity('partial-recovery'))

    expect(result.ok && result.integrity).toEqual({
      library: { level: 'recovered', reason: 'partial-recovery' },
    })
    expect(result.warnings).toContainEqual({
      kind: 'recovered-backup',
      reason: 'partial-recovery',
    })
  })

  it('복구본이어도 담긴 데이터는 그대로 가져온다', () => {
    const result = readBackup(withIntegrity('malformed'))

    expect(result.ok && result.library?.playlists).toHaveLength(2)
  })

  it.each(['partial-recovery', 'malformed', 'invalid', 'version-mismatch', 'unavailable'])(
    '복구 사유 %s 를 읽는다',
    (reason) => {
      const result = readBackup(withIntegrity(reason))
      expect(result.ok && result.integrity?.library?.reason).toBe(reason)
    },
  )

  it('모르는 복구 사유는 무시하고 파일은 거부하지 않는다', () => {
    const result = readBackup(withIntegrity('something-else'))

    expect(result.ok).toBe(true)
    expect(result.ok && result.integrity).toBeNull()
    expect(warningKinds(result.warnings)).not.toContain('recovered-backup')
  })

  it('불완전한 파일의 제외 개수가 정확하다', () => {
    const file = JSON.parse(FIXTURE_TEXT) as Record<string, unknown>
    const library = (file.data as Record<string, unknown>).library as Record<string, unknown>
    library.data = {
      playlists: [
        // 유효
        { id: 'ok', name: 'OK', tracks: [] },
        // id 가 빈 문자열 → 버린다
        { id: '', name: 'DROP 1', tracks: [] },
        // tracks 가 배열이 아니다 → 버린다
        { id: 'bad', name: 'DROP 2', tracks: 'nope' },
        // 중복 id → 뒤를 버린다
        { id: 'ok', name: 'DROP 3', tracks: [] },
        {
          id: 'mixed',
          name: 'MIXED',
          tracks: [
            { id: 'g1', source: 'youtube', videoId: 'aaaaaaaaaaa', title: 'GOOD' },
            // videoId 가 11자가 아니다 → 버린다
            { id: 'b1', source: 'youtube', videoId: 'short', title: 'BAD' },
            // source 가 다르다 → 버린다
            { id: 'b2', source: 'vimeo', videoId: 'bbbbbbbbbbb', title: 'BAD' },
          ],
        },
      ],
      selectedPlaylistId: 'gone',
    }

    const result = readBackup(JSON.stringify(file))

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.library?.playlists.map((playlist) => playlist.name)).toEqual(['OK', 'MIXED'])
    expect(result.warnings).toContainEqual({ kind: 'dropped-playlists', count: 3 })
    expect(result.warnings).toContainEqual({ kind: 'dropped-tracks', count: 2 })
    expect(warningKinds(result.warnings)).toContain('repaired-selection')
    // 보정된 선택은 첫 유효 목록이다.
    expect(result.library?.selectedPlaylistId).toBe('ok')
    expect(result.counts).toEqual({ playlists: 2, tracks: 1 })
  })
})
