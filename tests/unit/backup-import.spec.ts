/**
 * M8-3 — JSON 백업 가져오기·복원.
 *
 * 기준은 `docs/architecture/BACKUP_FORMAT.md` §7-1 의 상황 표와 **ADR 0018** ·
 * **ADR 0007** 이다.
 *
 * 층을 나눠 본다.
 *   A·B·C  `readBackup` — 순수 함수. §7-1 의 13개 상황을 전수로 덮는다
 *   D      `library.replaceAll` — 보호 우회 액션
 *   E      미리보기 — **저장소 쓰기 0**
 *   F      적용 — 성공·부분 성공·실패
 *   G      앱 상태 — 재생·테마·새로고침·iframe
 *   H      경계 — 보호 우회가 가져오기 경로에만 있는지
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { nextTick } from 'vue'

import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import App from '@/app/App.vue'
import {
  BACKUP_FORMAT,
  BACKUP_SCHEMA_VERSION,
  type BackupFile,
} from '@/features/backup/backupSchema'
import { createBackup } from '@/features/backup/createBackup'
import {
  checkBackupSize,
  readBackup,
  MAX_BACKUP_BYTES,
  type BackupWarning,
} from '@/features/backup/readBackup'
import { FakePlayerAdapter } from '@/features/playback/FakePlayerAdapter'
import { PLAYER_ADAPTER_FACTORY } from '@/features/playback/PlayerAdapter'
import { STORAGE_KEYS } from '@/shared/storage'
import type { LibraryData } from '@/shared/types'
import { LIBRARY_STORAGE_VERSION, useLibraryStore } from '@/stores/library'
import { THEME_STORAGE_VERSION, useThemeStore } from '@/stores/theme'
import { usePlaybackStore } from '@/stores/playback'

import { installPlayerRect, uninstallPlayerRect } from '../support/playerLayout'

const VIDEO_A = 'aaaaaaaaaaa'
const VIDEO_B = 'bbbbbbbbbbb'
const FIXED = new Date('2026-11-06T04:21:07.512Z')

function readSource(relative: string): string {
  return readFileSync(resolve(process.cwd(), relative), 'utf8')
}

/** 주석을 걷어낸 코드. 경계 단정이 주석의 단어를 잡지 않게 한다. */
function readCode(relative: string): string {
  return readSource(relative)
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
}

function libraryData(): LibraryData {
  return {
    playlists: [
      {
        id: 'p1',
        name: 'NIGHT DRIVE',
        tracks: [
          { id: 't1', source: 'youtube', videoId: VIDEO_A, title: 'ONE' },
          { id: 't2', source: 'youtube', videoId: VIDEO_B, title: 'TWO' },
        ],
      },
      { id: 'p2', name: 'MORNING', tracks: [] },
    ],
    selectedPlaylistId: 'p2',
  }
}

/** 정상 백업 파일 객체. M8-2 의 조립을 그대로 쓴다 — 왕복을 보장한다. */
function backupFile(): BackupFile {
  return createBackup({
    library: libraryData(),
    moments: [],
    theme: 'kawaii-synth-cassette',
    integrity: null,
    exportedAt: FIXED,
  })
}

const backupText = (file: unknown = backupFile()): string => JSON.stringify(file, null, 2)

const warningKinds = (warnings: readonly BackupWarning[]): string[] =>
  warnings.map((warning) => warning.kind)

beforeEach(() => {
  globalThis.localStorage.clear()
  delete document.documentElement.dataset.theme
  setActivePinia(createPinia())
})

afterEach(() => {
  uninstallPlayerRect()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  globalThis.localStorage.clear()
  delete document.documentElement.dataset.theme
  document.body.innerHTML = ''
})

describe('A. readBackup — 정상 경로', () => {
  it('M8-2 가 만든 파일을 그대로 읽는다 (왕복)', () => {
    const result = readBackup(backupText())

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.schemaVersion).toBe(BACKUP_SCHEMA_VERSION)
    expect(result.exportedAt).toBe('2026-11-06T04:21:07.512Z')
    expect(result.library).toEqual(libraryData())
    expect(result.theme).toBe('kawaii-synth-cassette')
    expect(result.integrity).toBeNull()
    expect(result.warnings).toEqual([])
  })

  it('플레이리스트·트랙 순서와 식별자를 보존한다', () => {
    const result = readBackup(backupText())
    if (!result.ok || result.library === null) throw new Error('읽기 실패')

    expect(result.library.playlists.map((playlist) => playlist.id)).toEqual(['p1', 'p2'])
    expect(result.library.playlists[0]?.tracks.map((track) => track.id)).toEqual(['t1', 't2'])
    expect(result.library.playlists[0]?.tracks[0]?.videoId).toBe(VIDEO_A)
    expect(result.library.selectedPlaylistId).toBe('p2')
  })

  it('개수를 센다', () => {
    const result = readBackup(backupText())
    expect(result.ok && result.counts).toEqual({ playlists: 2, tracks: 2 })
  })

  it('빈 라이브러리 백업도 읽는다', () => {
    const file = createBackup({
      library: { playlists: [], selectedPlaylistId: null },
      moments: [],
      theme: 'mono-vinyl',
      integrity: null,
      exportedAt: FIXED,
    })

    const result = readBackup(backupText(file))

    expect(result.ok).toBe(true)
    expect(result.ok && result.library).toEqual({ playlists: [], selectedPlaylistId: null })
  })
})

describe('B. readBackup — 거부 (BACKUP_FORMAT.md §7-1)', () => {
  it('크기 상한을 넘으면 읽기 전에 막는다', () => {
    expect(checkBackupSize(MAX_BACKUP_BYTES + 1)).toEqual({
      kind: 'too-large',
      size: MAX_BACKUP_BYTES + 1,
      limit: MAX_BACKUP_BYTES,
    })
    expect(checkBackupSize(MAX_BACKUP_BYTES)).toBeNull()
  })

  it('잘못된 JSON 을 거부한다', () => {
    expect(readBackup('{not json')).toMatchObject({ ok: false, error: { kind: 'not-json' } })
  })

  it('객체가 아닌 JSON 을 거부한다', () => {
    expect(readBackup('[1,2,3]')).toMatchObject({ ok: false, error: { kind: 'not-backup' } })
    expect(readBackup('"text"')).toMatchObject({ ok: false, error: { kind: 'not-backup' } })
  })

  it('식별자가 다르면 거부한다 — 다른 앱의 JSON 을 받지 않는다', () => {
    const alien = { format: 'other-app-backup', schemaVersion: 1, data: {} }

    expect(readBackup(JSON.stringify(alien))).toMatchObject({
      ok: false,
      error: { kind: 'not-backup' },
    })
  })

  it('파일 버전이 미래면 거부한다', () => {
    const future = { ...backupFile(), schemaVersion: BACKUP_SCHEMA_VERSION + 1 }

    expect(readBackup(backupText(future))).toMatchObject({
      ok: false,
      error: { kind: 'unsupported-version', schemaVersion: BACKUP_SCHEMA_VERSION + 1 },
    })
  })

  it('파일 버전이 정수가 아니면 거부한다', () => {
    expect(readBackup(JSON.stringify({ format: BACKUP_FORMAT, schemaVersion: '1' }))).toMatchObject(
      { ok: false, error: { kind: 'missing-field', field: 'schemaVersion' } },
    )
  })

  it('data 가 없으면 거부한다', () => {
    expect(readBackup(JSON.stringify({ format: BACKUP_FORMAT, schemaVersion: 1 }))).toMatchObject({
      ok: false,
      error: { kind: 'missing-field', field: 'data' },
    })
  })

  it('data.library 가 없으면 거부한다', () => {
    const file = { format: BACKUP_FORMAT, schemaVersion: 1, data: { preferences: {} } }

    expect(readBackup(JSON.stringify(file))).toMatchObject({
      ok: false,
      error: { kind: 'missing-field', field: 'data.library' },
    })
  })

  it('섹션 봉투 모양이 아니면 거부한다', () => {
    const file = { format: BACKUP_FORMAT, schemaVersion: 1, data: { library: { data: {} } } }

    expect(readBackup(JSON.stringify(file))).toMatchObject({
      ok: false,
      error: { kind: 'missing-field', field: 'data.library.version' },
    })
  })

  it('가져올 것이 하나도 없으면 거부한다', () => {
    // 라이브러리는 미래 버전, 테마는 없다.
    const file = {
      format: BACKUP_FORMAT,
      schemaVersion: 1,
      exportedAt: FIXED.toISOString(),
      data: { library: { version: LIBRARY_STORAGE_VERSION + 1, data: {} } },
    }

    const result = readBackup(JSON.stringify(file))

    expect(result).toMatchObject({ ok: false, error: { kind: 'nothing-importable' } })
    // 왜 비었는지도 함께 알린다.
    expect(warningKinds(result.warnings)).toContain('section-skipped')
  })
})

describe('C. readBackup — 경고하고 가져온다', () => {
  function withLibrary(data: unknown, version = LIBRARY_STORAGE_VERSION): string {
    return JSON.stringify({
      format: BACKUP_FORMAT,
      schemaVersion: 1,
      exportedAt: FIXED.toISOString(),
      data: {
        library: { version, data },
        preferences: { theme: { version: THEME_STORAGE_VERSION, data: 'mono-vinyl' } },
      },
    })
  }

  it('중복 플레이리스트 id 는 처음 것만 남기고 개수를 알린다', () => {
    const result = readBackup(
      withLibrary({
        playlists: [
          { id: 'dup', name: 'FIRST', tracks: [] },
          { id: 'dup', name: 'SECOND', tracks: [] },
        ],
        selectedPlaylistId: 'dup',
      }),
    )

    expect(result.ok && result.library?.playlists.map((p) => p.name)).toEqual(['FIRST'])
    expect(result.warnings).toContainEqual({ kind: 'dropped-playlists', count: 1 })
  })

  it('중복 트랙 id 는 처음 것만 남기고 개수를 알린다', () => {
    const result = readBackup(
      withLibrary({
        playlists: [
          {
            id: 'p1',
            name: 'A',
            tracks: [
              { id: 'dup', source: 'youtube', videoId: VIDEO_A, title: 'FIRST' },
              { id: 'dup', source: 'youtube', videoId: VIDEO_B, title: 'SECOND' },
            ],
          },
        ],
        selectedPlaylistId: 'p1',
      }),
    )

    expect(result.ok && result.library?.playlists[0]?.tracks).toHaveLength(1)
    expect(result.warnings).toContainEqual({ kind: 'dropped-tracks', count: 1 })
  })

  it('잘못된 videoId 트랙만 버리고 개수를 알린다', () => {
    const result = readBackup(
      withLibrary({
        playlists: [
          {
            id: 'p1',
            name: 'A',
            tracks: [
              { id: 't1', source: 'youtube', videoId: 'too-short', title: 'BAD' },
              { id: 't2', source: 'youtube', videoId: VIDEO_A, title: 'GOOD' },
            ],
          },
        ],
        selectedPlaylistId: 'p1',
      }),
    )

    expect(result.ok && result.library?.playlists[0]?.tracks.map((t) => t.title)).toEqual(['GOOD'])
    expect(result.warnings).toContainEqual({ kind: 'dropped-tracks', count: 1 })
  })

  it('없는 선택 id 는 첫 목록으로 보정하고 알린다', () => {
    const result = readBackup(
      withLibrary({
        playlists: [{ id: 'p1', name: 'A', tracks: [] }],
        selectedPlaylistId: 'nope',
      }),
    )

    expect(result.ok && result.library?.selectedPlaylistId).toBe('p1')
    expect(warningKinds(result.warnings)).toContain('repaired-selection')
  })

  it('라이브러리 섹션이 미래 버전이면 건너뛰고 테마만 가져온다', () => {
    const result = readBackup(withLibrary({ playlists: [], selectedPlaylistId: null }, 99))

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.library).toBeNull()
    expect(result.theme).toBe('mono-vinyl')
    expect(result.warnings).toContainEqual({
      kind: 'section-skipped',
      section: 'library',
      reason: 'future-version',
      version: 99,
    })
  })

  it('라이브러리 섹션이 이전 버전이면 추측해서 올리지 않는다', () => {
    const result = readBackup(withLibrary({ playlists: [], selectedPlaylistId: null }, 0))

    expect(result.ok && result.library).toBeNull()
    expect(result.warnings).toContainEqual({
      kind: 'section-skipped',
      section: 'library',
      reason: 'old-version',
      version: 0,
    })
  })

  it('라이브러리 내용이 복구 불가면 건너뛴다', () => {
    const result = readBackup(withLibrary({ playlists: 'not-an-array' }))

    expect(result.ok && result.library).toBeNull()
    expect(result.warnings).toContainEqual({
      kind: 'section-skipped',
      section: 'library',
      reason: 'invalid',
    })
  })

  /*
   * M8-3 은 이 자리에서 `moments` 를 확장 경로의 예로 썼다. M9-5 부터 그 섹션은
   * 아는 섹션이므로 다른 이름으로 같은 성질 — 모르는 섹션이 있어도 파일 버전을
   * 올리지 않고 읽힌다 — 을 본다.
   */
  it('알 수 없는 섹션은 무시하고 이름을 알린다 — 확장 경로', () => {
    const file = backupFile() as unknown as Record<string, unknown>
    const data = file.data as Record<string, unknown>
    data.layouts = { version: 1, data: [{ id: 'l1' }] }

    const result = readBackup(JSON.stringify(file))

    // 파일 버전을 올리지 않아도 읽힌다. 라이브러리는 정상 복원된다.
    expect(result.ok).toBe(true)
    expect(result.ok && result.library).toEqual(libraryData())
    expect(result.warnings).toContainEqual({ kind: 'unknown-section', section: 'layouts' })
  })

  it('알 수 없는 설정도 알린다', () => {
    const file = backupFile() as unknown as Record<string, unknown>
    const preferences = (file.data as Record<string, unknown>).preferences as Record<
      string,
      unknown
    >
    preferences.locale = { version: 1, data: 'ko' }

    const result = readBackup(JSON.stringify(file))

    expect(result.warnings).toContainEqual({
      kind: 'unknown-section',
      section: 'preferences.locale',
    })
  })

  it('테마 섹션이 깨지면 건너뛰고 라이브러리는 가져온다', () => {
    const file = backupFile() as unknown as Record<string, unknown>
    const preferences = (file.data as Record<string, unknown>).preferences as Record<
      string,
      unknown
    >
    preferences.theme = { version: THEME_STORAGE_VERSION, data: 'no-such-theme' }

    const result = readBackup(JSON.stringify(file))

    expect(result.ok && result.theme).toBeNull()
    expect(result.ok && result.library).toEqual(libraryData())
    expect(result.warnings).toContainEqual({
      kind: 'section-skipped',
      section: 'preferences.theme',
      reason: 'invalid',
    })
  })

  it('복구본 표시를 읽어 경고한다', () => {
    const file = createBackup({
      library: libraryData(),
      moments: [],
      theme: 'mono-vinyl',
      integrity: { library: { level: 'recovered', reason: 'partial-recovery' } },
      exportedAt: FIXED,
    })

    const result = readBackup(backupText(file))

    expect(result.ok && result.integrity?.library?.level).toBe('recovered')
    expect(result.warnings).toContainEqual({
      kind: 'recovered-backup',
      reason: 'partial-recovery',
    })
  })

  it('integrity 가 깨졌으면 무시하고 파일은 거부하지 않는다', () => {
    const file = { ...backupFile(), integrity: { library: { level: 'nonsense' } } }

    const result = readBackup(backupText(file))

    expect(result.ok).toBe(true)
    expect(result.ok && result.integrity).toBeNull()
    expect(warningKinds(result.warnings)).not.toContain('recovered-backup')
  })

  it('내보낸 시각이 깨져도 거부하지 않고 알린다', () => {
    const file = { ...backupFile(), exportedAt: 'yesterday' }

    const result = readBackup(backupText(file))

    expect(result.ok).toBe(true)
    expect(result.ok && result.exportedAt).toBeNull()
    expect(warningKinds(result.warnings)).toContain('invalid-exported-at')
  })

  it('큰 파일은 저장 공간 경고를 붙인다', () => {
    const result = readBackup(backupText(), 5 * 1024 * 1024)

    expect(warningKinds(result.warnings)).toContain('large-file')
  })
})

/* ------------------------------------------------------------------ *
 * 앱에 붙은 상태
 * ------------------------------------------------------------------ */

function mountApp() {
  const fake = new FakePlayerAdapter()
  const wrapper = mount(App, {
    attachTo: document.body,
    global: { provide: { [PLAYER_ADAPTER_FACTORY as symbol]: () => fake } },
  })
  return {
    wrapper,
    fake,
    library: useLibraryStore(),
    theme: useThemeStore(),
    playback: usePlaybackStore(),
  }
}

type Context = ReturnType<typeof mountApp>

function stubDownloadGlobals() {
  const created: Blob[] = []
  vi.stubGlobal('URL', {
    ...URL,
    createObjectURL: vi.fn<(blob: Blob) => string>((blob) => {
      created.push(blob)
      return 'blob:fake'
    }),
    revokeObjectURL: vi.fn<(url: string) => void>(),
  })
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
  return created
}

/** 현재 라이브러리에 플레이리스트 하나와 트랙 하나를 둔다. */
function seed(context: Context): string {
  const created = context.library.createPlaylist('CURRENT')
  const id = created.ok ? created.playlistId : ''
  context.library.addTrack(id, { videoId: VIDEO_A, title: 'KEEP ME' })
  return id
}

const importButton = (context: Context) =>
  context.wrapper
    .findAll('.backup .pill')
    .filter((node) => node.text().includes('가져오기') && !node.text().includes('교체하고'))[0]

const applyButton = (context: Context) =>
  context.wrapper.findAll('.preview .pill').filter((node) => node.text().includes('교체하고'))[0]

const cancelButton = (context: Context) =>
  context.wrapper.findAll('.preview .pill').filter((node) => node.text() === '취소')[0]

/** 파일 입력에 파일을 넣고 change 를 흘린다. */
async function pick(context: Context, text: string, name = 'backup.json'): Promise<void> {
  const input = context.wrapper.get<HTMLInputElement>('.backup .file-input')
  const file = new File([text], name, { type: 'application/json' })
  Object.defineProperty(input.element, 'files', { value: [file], configurable: true })

  await input.trigger('change')
  await flushPromises()
  await nextTick()
}

describe('D. library.replaceAll — 보호 우회 액션', () => {
  it('통째로 교체하고 저장한다', () => {
    const context = mountApp()
    seed(context)

    const result = context.library.replaceAll(libraryData())

    // M8-4: 쓴 값을 다시 읽어 확인한다.
    expect(result).toEqual({ ok: true, persisted: true, writeFailure: null, verified: true })
    expect(context.library.playlists.map((playlist) => playlist.name)).toEqual([
      'NIGHT DRIVE',
      'MORNING',
    ])
    expect(context.library.selectedPlaylistId).toBe('p2')
  })

  it('보호 상태에서도 교체하고 보호를 푼다', () => {
    globalThis.localStorage.setItem(STORAGE_KEYS.library, '{not json')
    const context = mountApp()
    context.library.restore()
    expect(context.library.status).toBe('protected')

    const result = context.library.replaceAll(libraryData())

    expect(result.persisted).toBe(true)
    expect(context.library.status).toBe('ready')
    expect(context.library.protectedReason).toBeNull()
    // 원본이 실제로 대체됐다.
    expect(globalThis.localStorage.getItem(STORAGE_KEYS.library)).toContain('NIGHT DRIVE')
  })

  it('저장이 실패하면 보호를 풀지 않고 메모리만 바꾼다', () => {
    globalThis.localStorage.setItem(STORAGE_KEYS.library, '{not json')
    const context = mountApp()
    context.library.restore()
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })

    const result = context.library.replaceAll(libraryData())

    expect(result.persisted).toBe(false)
    expect(result.writeFailure).toBe('unknown')
    expect(result.verified).toBe(false)
    // 원본을 아직 읽지 못했으므로 보호를 풀지 않는다.
    expect(context.library.status).toBe('protected')
    // 메모리에는 반영된다.
    expect(context.library.playlists).toHaveLength(2)
  })

  it('넘긴 객체와 참조를 공유하지 않는다', () => {
    const context = mountApp()
    const input = libraryData()

    context.library.replaceAll(input)
    input.playlists[0]!.name = 'MUTATED'
    input.playlists[0]!.tracks.push({
      id: 'late',
      source: 'youtube',
      videoId: VIDEO_A,
      title: 'LATE',
    })

    expect(context.library.playlists[0]?.name).toBe('NIGHT DRIVE')
    expect(context.library.playlists[0]?.tracks).toHaveLength(2)
  })
})

describe('E. 미리보기 — 저장소와 store 를 건드리지 않는다', () => {
  it('파일을 고르면 미리보기가 뜬다', async () => {
    const context = mountApp()
    seed(context)
    await nextTick()

    await pick(context, backupText())

    // `get` 은 없으면 던진다. 존재 자체가 단정이다.
    const preview = context.wrapper.get('[aria-label="백업 가져오기 미리보기"]')
    expect(preview.text()).toContain('가져오기 미리보기')
  })

  it('지금 개수와 가져올 개수를 함께 보여준다', async () => {
    const context = mountApp()
    seed(context)
    await nextTick()

    await pick(context, backupText())
    const table = context.wrapper.get('.preview-table').text()

    // 지금 1개 1곡, 가져올 것 2개 2곡.
    expect(table).toContain('1개')
    expect(table).toContain('2개')
    expect(table).toContain('1곡')
    expect(table).toContain('2곡')
  })

  it('현재 테마와 가져올 테마를 보여준다', async () => {
    const context = mountApp()
    await nextTick()

    await pick(context, backupText())
    const table = context.wrapper.get('.preview-table').text()

    expect(table).toContain('mono-vinyl')
    expect(table).toContain('kawaii-synth-cassette')
  })

  it('교체되는 섹션과 유지되는 섹션을 적는다', async () => {
    const context = mountApp()
    await nextTick()

    await pick(context, backupText())
    const sections = context.wrapper.get('.preview-sections').text()

    expect(sections).toContain('플레이리스트')
    expect(sections).toContain('교체')
    expect(sections).toContain('테마')
  })

  it('교체 위험을 경고한다', async () => {
    const context = mountApp()
    seed(context)
    await nextTick()

    await pick(context, backupText())

    expect(context.wrapper.get('.preview-danger').text()).toContain('교체됩니다')
  })

  it('무효한 항목과 사유를 적는다', async () => {
    const context = mountApp()
    await nextTick()
    const broken = {
      format: BACKUP_FORMAT,
      schemaVersion: 1,
      exportedAt: FIXED.toISOString(),
      data: {
        library: {
          version: LIBRARY_STORAGE_VERSION,
          data: {
            playlists: [
              {
                id: 'p1',
                name: 'A',
                tracks: [{ id: 't1', source: 'youtube', videoId: 'bad', title: 'X' }],
              },
            ],
            selectedPlaylistId: 'p1',
          },
        },
      },
    }

    await pick(context, JSON.stringify(broken))

    const warnings = context.wrapper.get('.preview-warnings').text()
    expect(warnings).toContain('1곡')
    expect(warnings).toContain('영상 ID')
  })

  it('복구본이면 그 사실을 먼저 알린다', async () => {
    const context = mountApp()
    await nextTick()
    const file = createBackup({
      library: libraryData(),
      moments: [],
      theme: 'mono-vinyl',
      integrity: { library: { level: 'recovered', reason: 'partial-recovery' } },
      exportedAt: FIXED,
    })

    await pick(context, backupText(file))

    expect(context.wrapper.get('.preview-warning').text()).toContain('복구본')
  })

  /*
   * ADR 0018 결정 5 — 가장 중요한 성질이다.
   */
  it('파일 선택·검증·미리보기 동안 setItem 을 한 번도 부르지 않는다', async () => {
    const context = mountApp()
    seed(context)
    await nextTick()
    const setItem = vi.spyOn(Storage.prototype, 'setItem')

    await pick(context, backupText())

    expect(setItem).not.toHaveBeenCalled()
  })

  it('거부되는 파일에서도 setItem 을 부르지 않는다', async () => {
    const context = mountApp()
    seed(context)
    await nextTick()
    const setItem = vi.spyOn(Storage.prototype, 'setItem')

    for (const text of [
      '{not json',
      '[1,2]',
      JSON.stringify({ format: 'other', schemaVersion: 1 }),
      backupText({ ...backupFile(), schemaVersion: 99 }),
    ]) {
      await pick(context, text)
    }

    expect(setItem).not.toHaveBeenCalled()
  })

  it('미리보기 동안 store 가 그대로다', async () => {
    const context = mountApp()
    seed(context)
    await nextTick()
    const before = JSON.stringify(context.library.playlists)

    await pick(context, backupText())

    expect(JSON.stringify(context.library.playlists)).toBe(before)
    expect(context.theme.current).toBe('mono-vinyl')
  })

  it('취소하면 미리보기가 닫히고 데이터가 그대로다', async () => {
    const context = mountApp()
    seed(context)
    await nextTick()
    const before = globalThis.localStorage.getItem(STORAGE_KEYS.library)

    await pick(context, backupText())
    await cancelButton(context)?.trigger('click')
    await nextTick()

    expect(context.wrapper.find('[aria-label="백업 가져오기 미리보기"]').exists()).toBe(false)
    expect(globalThis.localStorage.getItem(STORAGE_KEYS.library)).toBe(before)
    expect(context.library.playlists.map((playlist) => playlist.name)).toEqual(['CURRENT'])
  })

  it('거부 사유를 사용자 문구로 알린다', async () => {
    const context = mountApp()
    await nextTick()

    await pick(context, '{not json')

    const notices = context.wrapper.findAll('.backup-result').map((node) => node.text())
    expect(notices.join(' ')).toContain('JSON 파일이 아닙니다')
  })
})

describe('F. 적용 — 성공·부분 성공·실패', () => {
  it('승인하면 라이브러리와 테마가 교체된다', async () => {
    const context = mountApp()
    seed(context)
    await nextTick()

    await pick(context, backupText())
    await applyButton(context)?.trigger('click')
    await nextTick()

    expect(context.library.playlists.map((playlist) => playlist.name)).toEqual([
      'NIGHT DRIVE',
      'MORNING',
    ])
    expect(context.library.selectedPlaylistId).toBe('p2')
    expect(context.theme.current).toBe('kawaii-synth-cassette')
  })

  it('저장소에도 반영되어 새로고침 후 유지된다', async () => {
    const context = mountApp()
    seed(context)
    await nextTick()

    await pick(context, backupText())
    await applyButton(context)?.trigger('click')
    await nextTick()

    // 새로고침을 모사한다.
    setActivePinia(createPinia())
    const fresh = useLibraryStore()
    const freshTheme = useThemeStore()
    fresh.restore()
    freshTheme.restore()

    expect(fresh.playlists.map((playlist) => playlist.name)).toEqual(['NIGHT DRIVE', 'MORNING'])
    expect(fresh.selectedPlaylistId).toBe('p2')
    expect(fresh.status).toBe('ready')
    expect(freshTheme.current).toBe('kawaii-synth-cassette')
  })

  it('성공 결과에 반영된 항목을 적는다', async () => {
    const context = mountApp()
    await nextTick()

    await pick(context, backupText())
    await applyButton(context)?.trigger('click')
    await nextTick()

    const notice = context.wrapper
      .findAll('.backup-result')
      .map((node) => node.text())
      .join(' ')
    expect(notice).toContain('복원했습니다')
    expect(notice).toContain('2개')
    expect(notice).toContain('2곡')
  })

  it('테마를 끄면 라이브러리만 교체한다', async () => {
    const context = mountApp()
    await nextTick()

    await pick(context, backupText())
    await context.wrapper.get('.preview-toggle input').setValue(false)
    await applyButton(context)?.trigger('click')
    await nextTick()

    expect(context.library.playlists).toHaveLength(2)
    expect(context.theme.current).toBe('mono-vinyl')
  })

  it('라이브러리 섹션을 건너뛴 파일은 테마만 적용하고 목록을 유지한다', async () => {
    const context = mountApp()
    seed(context)
    await nextTick()
    const file = {
      format: BACKUP_FORMAT,
      schemaVersion: 1,
      exportedAt: FIXED.toISOString(),
      data: {
        library: { version: LIBRARY_STORAGE_VERSION + 1, data: {} },
        preferences: { theme: { version: THEME_STORAGE_VERSION, data: 'kawaii-synth-cassette' } },
      },
    }

    await pick(context, JSON.stringify(file))
    await applyButton(context)?.trigger('click')
    await nextTick()

    expect(context.library.playlists.map((playlist) => playlist.name)).toEqual(['CURRENT'])
    expect(context.theme.current).toBe('kawaii-synth-cassette')
  })

  /*
   * 요구 4-3 — 낡은 승인으로 새 데이터를 덮어쓰지 않는다.
   */
  it('미리보기 이후 데이터가 바뀌면 덮어쓰지 않고 다시 확인시킨다', async () => {
    const context = mountApp()
    seed(context)
    await nextTick()

    await pick(context, backupText())
    // 미리보기를 본 뒤 다른 곳에서 목록을 추가했다.
    context.library.createPlaylist('ADDED LATER')
    await nextTick()

    await applyButton(context)?.trigger('click')
    await nextTick()

    // 교체되지 않았다.
    expect(context.library.playlists.map((playlist) => playlist.name)).toEqual([
      'CURRENT',
      'ADDED LATER',
    ])
    const notice = context.wrapper
      .findAll('.backup-result')
      .map((node) => node.text())
      .join(' ')
    expect(notice).toContain('지금 데이터가 바뀌었습니다')
    // 미리보기는 열린 채로 남아 다시 누를 수 있다.
    expect(context.wrapper.find('[aria-label="백업 가져오기 미리보기"]').exists()).toBe(true)
  })

  it('다시 누르면 새 지문으로 교체된다', async () => {
    const context = mountApp()
    seed(context)
    await nextTick()

    await pick(context, backupText())
    context.library.createPlaylist('ADDED LATER')
    await nextTick()
    await applyButton(context)?.trigger('click')
    await nextTick()

    await applyButton(context)?.trigger('click')
    await nextTick()

    expect(context.library.playlists.map((playlist) => playlist.name)).toEqual([
      'NIGHT DRIVE',
      'MORNING',
    ])
  })

  it('다른 탭이 저장소를 바꾼 경우도 잡는다', async () => {
    const context = mountApp()
    seed(context)
    await nextTick()

    await pick(context, backupText())
    // store 는 모르는 변경. 다른 탭이 쓴 상황이다.
    globalThis.localStorage.setItem(
      STORAGE_KEYS.library,
      JSON.stringify({
        version: LIBRARY_STORAGE_VERSION,
        data: {
          playlists: [{ id: 'other', name: 'FROM OTHER TAB', tracks: [] }],
          selectedPlaylistId: 'other',
        },
      }),
    )

    await applyButton(context)?.trigger('click')
    await nextTick()

    const notice = context.wrapper
      .findAll('.backup-result')
      .map((node) => node.text())
      .join(' ')
    expect(notice).toContain('바뀌었습니다')
    expect(globalThis.localStorage.getItem(STORAGE_KEYS.library)).toContain('FROM OTHER TAB')
  })

  it('저장이 실패하면 실패를 성공으로 표시하지 않는다', async () => {
    const context = mountApp()
    seed(context)
    await nextTick()

    await pick(context, backupText())
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      const error = new Error('quota')
      error.name = 'QuotaExceededError'
      throw error
    })

    await applyButton(context)?.trigger('click')
    await nextTick()

    const notice = context.wrapper
      .findAll('.backup-result')
      .map((node) => node.text())
      .join(' ')
    expect(notice).toContain('일부만 복원했습니다')
    expect(notice).toContain('저장 공간 부족')
  })

  it('라이브러리는 성공하고 테마만 실패하면 둘을 구분해 알린다', async () => {
    const context = mountApp()
    await nextTick()
    await pick(context, backupText())

    // 라이브러리 키만 통과시키고 테마 키 쓰기를 막는다.
    const real = Storage.prototype.setItem
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function patched(
      this: Storage,
      key: string,
      value: string,
    ) {
      if (key === STORAGE_KEYS.theme) throw new Error('blocked')
      real.call(this, key, value)
    })

    await applyButton(context)?.trigger('click')
    await nextTick()

    const notice = context.wrapper
      .findAll('.backup-result')
      .map((node) => node.text())
      .join(' ')
    expect(notice).toContain('일부만 복원했습니다')
    expect(notice).toContain('플레이리스트 2개')
    expect(notice).toContain('테마')
    // 라이브러리는 실제로 저장됐다.
    expect(globalThis.localStorage.getItem(STORAGE_KEYS.library)).toContain('NIGHT DRIVE')
    // 테마는 적용은 됐다 (이번 세션).
    expect(context.theme.current).toBe('kawaii-synth-cassette')
  })

  it('지금 데이터를 먼저 내보낼 수 있다 (M8-2 재사용)', async () => {
    const context = mountApp()
    seed(context)
    await nextTick()
    const created = stubDownloadGlobals()

    await pick(context, backupText())
    const first = context.wrapper
      .findAll('.preview .pill')
      .filter((node) => node.text().includes('먼저 내보내기'))[0]
    await first?.trigger('click')
    await nextTick()

    expect(created).toHaveLength(1)
    const dumped = JSON.parse(await (created[0] as Blob).text()) as BackupFile
    expect(dumped.format).toBe(BACKUP_FORMAT)
    expect(dumped.data.library.data.playlists[0]?.name).toBe('CURRENT')
  })
})

describe('G. 보호 상태의 복원', () => {
  async function protectedApp(): Promise<Context> {
    globalThis.localStorage.setItem(STORAGE_KEYS.library, '{not json')
    const context = mountApp()
    context.library.restore()
    await nextTick()
    return context
  }

  it('보호 상태에서도 복원 경로가 있다', async () => {
    const context = await protectedApp()
    expect(context.library.status).toBe('protected')

    await pick(context, backupText())
    await applyButton(context)?.trigger('click')
    await nextTick()

    expect(context.library.playlists).toHaveLength(2)
    expect(context.library.status).toBe('ready')
  })

  it('읽지 못한 원본을 덮어쓴다는 사실을 알린다', async () => {
    const context = await protectedApp()

    await pick(context, backupText())

    const warnings = context.wrapper.findAll('.preview-warning').map((node) => node.text())
    expect(warnings.join(' ')).toContain('덮어씁니다')
  })

  it('덮어쓰기 전에 원본 원문을 내려받을 수 있다', async () => {
    const context = await protectedApp()
    const created = stubDownloadGlobals()

    await pick(context, backupText())
    const rawButton = context.wrapper
      .findAll('.preview .pill')
      .filter((node) => node.text().includes('원본 내려받기'))[0]
    await rawButton?.trigger('click')
    await nextTick()

    expect(created).toHaveLength(1)
    // 우리가 해석하지 못한 원문 그대로다.
    expect(await (created[0] as Blob).text()).toBe('{not json')
  })

  it('정상 상태에서는 원본 내려받기 버튼이 없다', async () => {
    const context = mountApp()
    await nextTick()

    await pick(context, backupText())

    const rawButton = context.wrapper
      .findAll('.preview .pill')
      .filter((node) => node.text().includes('원본 내려받기'))
    expect(rawButton).toHaveLength(0)
  })

  it('저장소에 접근할 수 없으면 위험한 덮어쓰기를 막는다', async () => {
    const context = await protectedApp()
    // 원본을 꺼낼 수도, 덮어쓸 수도 없는 상태.
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })

    await pick(context, backupText())
    await nextTick()

    expect(context.wrapper.get('.preview-blocked').text()).toContain('막았습니다')
    expect(applyButton(context)?.attributes('disabled')).toBeDefined()
  })

  it('손상된 원본과 정규화된 복구본을 구분해 보여준다', async () => {
    // 저장된 원본은 일부만 복구된 상태이고, 파일은 복구본 표시를 갖는다.
    globalThis.localStorage.setItem(
      STORAGE_KEYS.library,
      JSON.stringify({
        version: LIBRARY_STORAGE_VERSION,
        data: {
          playlists: [
            { id: 'keep', name: 'KEPT', tracks: [] },
            { id: '', name: 'DROPPED', tracks: [] },
          ],
          selectedPlaylistId: 'keep',
        },
      }),
    )
    const context = mountApp()
    context.library.restore()
    await nextTick()
    expect(context.library.protectedReason).toBe('partial-recovery')

    const file = createBackup({
      library: libraryData(),
      moments: [],
      theme: 'mono-vinyl',
      integrity: { library: { level: 'recovered', reason: 'malformed' } },
      exportedAt: FIXED,
    })
    await pick(context, backupText(file))

    const text = context.wrapper.get('[aria-label="백업 가져오기 미리보기"]').text()
    // 파일 쪽 사정 (복구본) 과 저장소 쪽 사정 (읽지 못한 원본) 을 따로 말한다.
    expect(text).toContain('복구본')
    expect(text).toContain('덮어씁니다')
  })
})

describe('G2. 저장 실패 — 메모리와 저장소가 어긋난 상태 (M8-4)', () => {
  /** 라이브러리 키만 막는다. 테마는 통과시킨다. */
  function blockLibraryWrites(): void {
    const real = Storage.prototype.setItem
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function patched(
      this: Storage,
      key: string,
      value: string,
    ) {
      if (key === STORAGE_KEYS.library) {
        const error = new Error('quota')
        error.name = 'QuotaExceededError'
        throw error
      }
      real.call(this, key, value)
    })
  }

  it('저장 실패 뒤 화면은 복원됐지만 새로고침하면 되돌아간다', async () => {
    const context = mountApp()
    seed(context)
    await nextTick()
    const rawBefore = globalThis.localStorage.getItem(STORAGE_KEYS.library)

    await pick(context, backupText())
    blockLibraryWrites()
    await applyButton(context)?.trigger('click')
    await nextTick()

    // 메모리(화면)는 복원됐다.
    expect(context.library.playlists.map((playlist) => playlist.name)).toEqual([
      'NIGHT DRIVE',
      'MORNING',
    ])
    // 저장소는 그대로다.
    expect(globalThis.localStorage.getItem(STORAGE_KEYS.library)).toBe(rawBefore)

    // 새로고침하면 복원 전으로 돌아간다 — 이것이 사용자가 오인하면 안 되는 상태다.
    vi.restoreAllMocks()
    setActivePinia(createPinia())
    const fresh = useLibraryStore()
    fresh.restore()
    expect(fresh.playlists.map((playlist) => playlist.name)).toEqual(['CURRENT'])
  })

  it('영구 복원 성공으로 오인하지 않게 안내한다', async () => {
    const context = mountApp()
    seed(context)
    await nextTick()

    await pick(context, backupText())
    blockLibraryWrites()
    await applyButton(context)?.trigger('click')
    await nextTick()

    const block = context.wrapper.get('[aria-label="저장되지 않은 복원"]')
    expect(block.text()).toContain('저장되지 않았습니다')
    expect(block.text()).toContain('새로고침하면 되돌아갑니다')
  })

  it('다음 행동을 제공한다 — 다시 저장과 JSON 내보내기', async () => {
    const context = mountApp()
    seed(context)
    await nextTick()

    await pick(context, backupText())
    blockLibraryWrites()
    await applyButton(context)?.trigger('click')
    await nextTick()

    const labels = context.wrapper
      .findAll('[aria-label="저장되지 않은 복원"] .pill')
      .map((node) => node.text())
    expect(labels).toContain('다시 저장 시도')
    expect(labels).toContain('지금 화면을 JSON으로 내보내기')
  })

  it('다시 저장이 성공하면 안내가 사라진다', async () => {
    const context = mountApp()
    seed(context)
    await nextTick()

    await pick(context, backupText())
    blockLibraryWrites()
    await applyButton(context)?.trigger('click')
    await nextTick()
    expect(context.wrapper.find('[aria-label="저장되지 않은 복원"]').exists()).toBe(true)

    // 저장소가 다시 동작한다.
    vi.restoreAllMocks()
    const retry = context.wrapper
      .findAll('[aria-label="저장되지 않은 복원"] .pill')
      .find((node) => node.text() === '다시 저장 시도')
    await retry?.trigger('click')
    await nextTick()

    expect(context.wrapper.find('[aria-label="저장되지 않은 복원"]').exists()).toBe(false)
    expect(globalThis.localStorage.getItem(STORAGE_KEYS.library)).toContain('NIGHT DRIVE')
  })

  it('다시 저장도 실패하면 안내가 남는다', async () => {
    const context = mountApp()
    seed(context)
    await nextTick()

    await pick(context, backupText())
    blockLibraryWrites()
    await applyButton(context)?.trigger('click')
    await nextTick()

    const retry = context.wrapper
      .findAll('[aria-label="저장되지 않은 복원"] .pill')
      .find((node) => node.text() === '다시 저장 시도')
    await retry?.trigger('click')
    await nextTick()

    expect(context.wrapper.find('[aria-label="저장되지 않은 복원"]').exists()).toBe(true)
  })

  it('지금 화면을 JSON으로 내보내 잃지 않게 할 수 있다', async () => {
    const context = mountApp()
    seed(context)
    await nextTick()

    await pick(context, backupText())
    blockLibraryWrites()
    await applyButton(context)?.trigger('click')
    await nextTick()

    vi.restoreAllMocks()
    const created = stubDownloadGlobals()
    const exportNow = context.wrapper
      .findAll('[aria-label="저장되지 않은 복원"] .pill')
      .find((node) => node.text().includes('JSON으로 내보내기'))
    await exportNow?.trigger('click')
    await nextTick()

    expect(created).toHaveLength(1)
    const dumped = JSON.parse(await (created[0] as Blob).text()) as BackupFile
    // 저장되지 않은 **메모리 상태**가 파일로 나온다.
    expect(dumped.data.library.data.playlists.map((playlist) => playlist.name)).toEqual([
      'NIGHT DRIVE',
      'MORNING',
    ])
  })

  it('테마만 실패하면 라이브러리는 저장된 채로 안내한다', async () => {
    const context = mountApp()
    await nextTick()
    await pick(context, backupText())

    const real = Storage.prototype.setItem
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function patched(
      this: Storage,
      key: string,
      value: string,
    ) {
      if (key === STORAGE_KEYS.theme) throw new Error('blocked')
      real.call(this, key, value)
    })

    await applyButton(context)?.trigger('click')
    await nextTick()

    expect(globalThis.localStorage.getItem(STORAGE_KEYS.library)).toContain('NIGHT DRIVE')
    expect(context.wrapper.get('[aria-label="저장되지 않은 복원"]').text()).toContain(
      '저장되지 않았습니다',
    )
  })

  it('쓰기는 성공했는데 다시 읽으니 다르면 성공으로 보고하지 않는다', async () => {
    const context = mountApp()
    seed(context)
    await nextTick()
    await pick(context, backupText())

    /*
     * 쓰기를 삼키는 저장소를 흉내낸다 — `setItem` 은 성공하지만 값이 남지
     * 않는다. 쓰기 결과만 믿으면 "복원했습니다" 가 나간다.
     */
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {})

    await applyButton(context)?.trigger('click')
    await nextTick()

    const notice = context.wrapper
      .findAll('.backup-result')
      .map((node) => node.text())
      .join(' ')
    expect(notice).toContain('일부만 복원했습니다')
    expect(notice).toContain('다시 읽을 수 없음')
    expect(context.wrapper.find('[aria-label="저장되지 않은 복원"]').exists()).toBe(true)
  })
})

describe('H. 앱 상태와 경계', () => {
  it('라이브러리를 교체하면 재생을 멈추고 큐를 비운다', async () => {
    // jsdom 은 레이아웃을 계산하지 않는다. 가시성 가드가 거절하지 않게 세운다.
    installPlayerRect()
    const context = mountApp()
    const id = seed(context)
    await nextTick()

    // 재생을 시작한다.
    await context.wrapper.get('.playlist-play').trigger('click')
    await flushPromises()
    context.fake.emitReady()
    context.fake.emitStateChange('playing')
    await nextTick()
    expect(context.playback.queue).toHaveLength(1)
    expect(id).not.toBe('')

    await pick(context, backupText())
    await applyButton(context)?.trigger('click')
    await nextTick()

    // 큐가 가리키던 라이브러리가 사라졌으므로 멈추고 비운다.
    expect(context.fake.calls.pause).toBe(1)
    expect(context.playback.queue).toEqual([])
    expect(context.playback.currentTrack).toBeNull()
    expect(context.playback.statusMessage).toContain('백업을 복원해')
  })

  it('복원이 실패해도 재생을 괜히 멈추지 않는다', async () => {
    installPlayerRect()
    const context = mountApp()
    seed(context)
    await nextTick()
    await context.wrapper.get('.playlist-play').trigger('click')
    await flushPromises()
    context.fake.emitReady()
    context.fake.emitStateChange('playing')
    await nextTick()

    // 거부되는 파일을 고른다.
    await pick(context, '{not json')

    expect(context.fake.calls.pause).toBe(0)
    expect(context.playback.playerState).toBe('playing')
    expect(context.playback.queue).toHaveLength(1)
  })

  it('복원 중 PlayerSurface 와 어댑터가 재생성되지 않는다', async () => {
    const context = mountApp()
    seed(context)
    await nextTick()
    const surface = context.wrapper.get('[data-instance-id="player-main"]').element
    const mountHost = context.wrapper.get('.player-mount').element
    const adapterNode = context.fake.hostNode

    await pick(context, backupText())
    await applyButton(context)?.trigger('click')
    await nextTick()

    expect(context.wrapper.get('[data-instance-id="player-main"]').element).toBe(surface)
    expect(context.wrapper.get('.player-mount').element).toBe(mountHost)
    expect(context.fake.hostNode).toBe(adapterNode)
    expect(context.fake.calls.mount).toBe(1)
    expect(context.fake.calls.destroy).toBe(0)
  })

  it('복원 뒤 화면이 저장 결과와 일치한다', async () => {
    const context = mountApp()
    seed(context)
    await nextTick()

    await pick(context, backupText())
    await applyButton(context)?.trigger('click')
    await nextTick()

    // 타일이 새 목록을 보여준다.
    expect(context.wrapper.findAll('.playlist-tile .pname').map((node) => node.text())).toEqual([
      'NIGHT DRIVE',
      'MORNING',
    ])
    // 선택된 목록이 표시된다.
    expect(context.wrapper.get('#record-library-title').text()).toBe('MORNING')
    // 테마가 문서에 반영된다.
    expect(document.documentElement.dataset.theme).toBe('kawaii-synth-cassette')
  })

  /*
   * ⚠ ADR 0007 의 보호가 무의미해지지 않게 호출 지점을 고정한다.
   */
  it('replaceAll 은 가져오기 경로에서만 불린다', () => {
    const callers: string[] = []
    for (const file of [
      'src/features/backup/useBackupImport.ts',
      'src/features/backup/useBackupExport.ts',
      'src/features/backup/createBackup.ts',
      'src/features/backup/readBackup.ts',
      'src/features/backup/BackupPanel.vue',
      'src/features/library/RecordLibraryDrawer.vue',
      'src/features/library/PlaylistWidget.vue',
      'src/features/library/PlaylistTile.vue',
      'src/features/library/TrackList.vue',
      'src/features/deck/DeckWidget.vue',
      'src/features/deck/useDeckTransport.ts',
      'src/features/playback/createPlaybackCoordinator.ts',
      'src/components/layout/DashboardShell.vue',
      'src/main.ts',
    ]) {
      if (readCode(file).includes('replaceAll')) callers.push(file)
    }

    expect(callers).toEqual(['src/features/backup/useBackupImport.ts'])
  })

  it('가져오기가 localStorage 를 직접 쓰지 않는다 — store API 만 쓴다', () => {
    const code = readCode('src/features/backup/useBackupImport.ts')

    expect(code).not.toContain('localStorage')
    expect(code).not.toContain('setItem')
    // 공식 API 로만 복원한다.
    expect(code).toContain('library.replaceAll')
    expect(code).toContain('theme.setTheme')
  })

  it('해석은 순수 함수가 한다 — store 도 DOM 도 모른다', () => {
    const code = readCode('src/features/backup/readBackup.ts')

    expect(code).not.toContain('useLibraryStore')
    expect(code).not.toContain('useThemeStore')
    expect(code).not.toContain('localStorage')
    expect(code).not.toContain('document')
    // 검증은 기존 규칙을 재사용한다.
    expect(code).toContain('normalizeLibraryData')
    expect(code).toContain('isThemeKey')
  })

  it('두 테마에서 가져오기 버튼이 보이고 새 색을 만들지 않았다', async () => {
    const context = mountApp()
    expect(importButton(context)).toBeDefined()

    context.theme.setTheme('kawaii-synth-cassette')
    await nextTick()

    expect(importButton(context)).toBeDefined()
    expect(readSource('src/features/backup/BackupPanel.vue')).not.toMatch(/:\s*#[0-9a-fA-F]{3,8}/)
  })

  it('최종 버튼 문구가 결과를 드러낸다', async () => {
    const context = mountApp()
    await nextTick()

    await pick(context, backupText())

    expect(applyButton(context)?.text()).toBe('교체하고 가져오기')
  })
})
