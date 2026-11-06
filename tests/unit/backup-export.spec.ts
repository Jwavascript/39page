/**
 * M8-2 — JSON 백업 내보내기.
 *
 * 기준 문서는 `docs/architecture/BACKUP_FORMAT.md` 와 **ADR 0018** 이다.
 * 스키마·버전·필수 필드는 문서가 정하고, 이 테스트가 그것을 고정한다.
 *
 * 세 층을 따로 본다.
 *   A·B·C  `createBackup` — 순수 함수. 전수 검증한다
 *   D      `backupFileName` / `downloadBackup` — 브라우저 경계
 *   E·F·G  앱에 붙은 상태 — UI, 불변성, 플레이어 안정성
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { nextTick } from 'vue'

import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import App from '@/app/App.vue'
import {
  BACKUP_FORMAT,
  BACKUP_SCHEMA_VERSION,
  BACKUP_SECTION_VERSIONS,
  type BackupFile,
} from '@/features/backup/backupSchema'
import {
  countBackupItems,
  createBackup,
  resolveBackupIntegrity,
  type BackupSource,
} from '@/features/backup/createBackup'
import { backupFileName, downloadBackup } from '@/features/backup/downloadBackup'
import { FakePlayerAdapter } from '@/features/playback/FakePlayerAdapter'
import { PLAYER_ADAPTER_FACTORY } from '@/features/playback/PlayerAdapter'
import { STORAGE_KEYS } from '@/shared/storage'
import type { LibraryData } from '@/shared/types'
import { LIBRARY_STORAGE_VERSION, useLibraryStore } from '@/stores/library'
import { THEME_STORAGE_VERSION, useThemeStore } from '@/stores/theme'

const VIDEO_A = 'aaaaaaaaaaa'
const VIDEO_B = 'bbbbbbbbbbb'
const VIDEO_C = 'ccccccccccc'

/** 고정 시각. 내보낸 시각과 파일 이름을 결정적으로 만든다. */
const FIXED = new Date('2026-11-06T04:21:07.512Z')

function readSource(relative: string): string {
  return readFileSync(resolve(process.cwd(), relative), 'utf8')
}

/**
 * 주석을 걷어낸 코드.
 *
 * 경계 단정을 원문에 하면 **주석에 적힌 단어**가 걸린다. 예를 들어
 * `createBackup.ts` 는 "`localStorage` 를 읽지 않는다" 를 주석으로 적는데,
 * 그 문장이 "localStorage 를 쓰지 않는다" 단정을 깨뜨린다. 설명을 지우는 쪽이
 * 아니라 단정을 코드로 좁히는 쪽이 맞다.
 */
function readCode(relative: string): string {
  return readSource(relative)
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
}

function library(): LibraryData {
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
      {
        id: 'p2',
        name: 'MORNING',
        tracks: [{ id: 't3', source: 'youtube', videoId: VIDEO_C, title: 'THREE' }],
      },
    ],
    selectedPlaylistId: 'p2',
  }
}

function source(overrides: Partial<BackupSource> = {}): BackupSource {
  return {
    library: library(),
    theme: 'mono-vinyl',
    integrity: null,
    exportedAt: FIXED,
    ...overrides,
  }
}

beforeEach(() => {
  globalThis.localStorage.clear()
  delete document.documentElement.dataset.theme
  setActivePinia(createPinia())
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  globalThis.localStorage.clear()
  delete document.documentElement.dataset.theme
  document.body.innerHTML = ''
})

describe('A. 스키마와 필수 필드', () => {
  it('식별자와 파일 버전이 문서와 같다', () => {
    const file = createBackup(source())

    expect(file.format).toBe('39page-backup')
    expect(file.schemaVersion).toBe(1)
    expect(BACKUP_FORMAT).toBe('39page-backup')
    expect(BACKUP_SCHEMA_VERSION).toBe(1)
  })

  it('필수 필드가 모두 있다', () => {
    const file = createBackup(source())

    expect(Object.keys(file).sort()).toEqual(['data', 'exportedAt', 'format', 'schemaVersion'])
    expect(file.data.library).toBeDefined()
  })

  it('섹션이 저장 봉투와 같은 모양이다', () => {
    const file = createBackup(source())

    // { version, data } — defineStorage 의 StorageEnvelope 와 같다.
    expect(Object.keys(file.data.library).sort()).toEqual(['data', 'version'])
    expect(Object.keys(file.data.preferences?.theme ?? {}).sort()).toEqual(['data', 'version'])
  })

  /*
   * 섹션 버전을 상수로 다시 적지 않는다. 내부 스키마를 올릴 때 한쪽만 바뀌면
   * 조용히 어긋나기 때문이다 (ADR 0018 결정 2·3).
   */
  it('섹션 버전이 내부 저장 버전과 같은 값이다', () => {
    const file = createBackup(source())

    expect(file.data.library.version).toBe(LIBRARY_STORAGE_VERSION)
    expect(file.data.preferences?.theme?.version).toBe(THEME_STORAGE_VERSION)
    expect(BACKUP_SECTION_VERSIONS.library).toBe(LIBRARY_STORAGE_VERSION)
    expect(BACKUP_SECTION_VERSIONS.theme).toBe(THEME_STORAGE_VERSION)
  })

  it('내보낸 시각이 ISO 8601 UTC 다', () => {
    const file = createBackup(source())

    expect(file.exportedAt).toBe('2026-11-06T04:21:07.512Z')
    expect(file.exportedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
  })

  it('온전한 백업에는 integrity 필드가 없다', () => {
    const file = createBackup(source())

    // 평범한 백업의 모양을 바꾸지 않는다 (ADR 0018 결정 2 의 취지).
    expect('integrity' in file).toBe(false)
  })

  it('만든 섹션 데이터가 기존 검증기를 통과한다', async () => {
    const { normalizeLibraryData } = await import('@/stores/library')
    const file = createBackup(source())

    const result = normalizeLibraryData(file.data.library.data)

    // 가져오기(M8-3)가 이 함수를 그대로 쓴다. 지금 통과해야 왕복이 가능하다.
    expect(result?.data).toEqual(library())
    expect(result?.report).toEqual({
      droppedPlaylists: 0,
      droppedTracks: 0,
      repairedSelection: false,
    })
  })
})

describe('B. 내용 보존', () => {
  it('여러 플레이리스트의 순서를 유지한다', () => {
    const file = createBackup(source())

    expect(file.data.library.data.playlists.map((playlist) => playlist.id)).toEqual(['p1', 'p2'])
  })

  it('트랙 순서를 유지한다', () => {
    const file = createBackup(source())

    expect(file.data.library.data.playlists[0]?.tracks.map((track) => track.id)).toEqual([
      't1',
      't2',
    ])
  })

  it('트랙 id · videoId · 제목 · source 를 모두 보존한다', () => {
    const file = createBackup(source())

    expect(file.data.library.data.playlists[0]?.tracks[0]).toEqual({
      id: 't1',
      source: 'youtube',
      videoId: VIDEO_A,
      title: 'ONE',
    })
  })

  it('선택된 플레이리스트 id 를 보존한다', () => {
    expect(createBackup(source()).data.library.data.selectedPlaylistId).toBe('p2')

    const none = createBackup(source({ library: { ...library(), selectedPlaylistId: null } }))
    expect(none.data.library.data.selectedPlaylistId).toBeNull()
  })

  it('현재 테마를 담는다', () => {
    expect(createBackup(source()).data.preferences?.theme?.data).toBe('mono-vinyl')
    expect(
      createBackup(source({ theme: 'kawaii-synth-cassette' })).data.preferences?.theme?.data,
    ).toBe('kawaii-synth-cassette')
  })

  it('빈 라이브러리도 유효한 백업이 된다', () => {
    const file = createBackup(source({ library: { playlists: [], selectedPlaylistId: null } }))

    expect(file.data.library.data).toEqual({ playlists: [], selectedPlaylistId: null })
    expect(countBackupItems(file)).toEqual({ playlists: 0, tracks: 0 })
    // 빈 것도 거부하지 않는다. "전부 지웠다" 는 보존할 가치가 있는 상태다.
    expect(file.format).toBe(BACKUP_FORMAT)
  })

  it('개수를 센다', () => {
    expect(countBackupItems(createBackup(source()))).toEqual({ playlists: 2, tracks: 3 })
  })

  /*
   * 필드를 명시적으로 골라 담는다. 객체를 그대로 복사하면 `Track` 에 세션용
   * 필드가 생겼을 때 파일로 새어 나간다.
   */
  it('알 수 없는 필드를 파일로 흘리지 않는다', () => {
    const polluted = {
      playlists: [
        {
          id: 'p1',
          name: 'A',
          tracks: [
            {
              id: 't1',
              source: 'youtube' as const,
              videoId: VIDEO_A,
              title: 'ONE',
              // 미래에 누가 세션용 필드를 더해도 파일에 들어가지 않아야 한다.
              nowPlaying: true,
              elapsed: 42,
            },
          ],
          collapsed: true,
        },
      ],
      selectedPlaylistId: 'p1',
    }

    const file = createBackup(source({ library: polluted as unknown as BackupSource['library'] }))
    const track = file.data.library.data.playlists[0]?.tracks[0]

    expect(Object.keys(track ?? {}).sort()).toEqual(['id', 'source', 'title', 'videoId'])
    expect(Object.keys(file.data.library.data.playlists[0] ?? {}).sort()).toEqual([
      'id',
      'name',
      'tracks',
    ])
  })

  it('깊은 복사다 — 만든 뒤 원본을 바꿔도 파일이 흔들리지 않는다', () => {
    const input = library()
    const file = createBackup(source({ library: input }))

    input.playlists[0]!.name = 'CHANGED'
    input.playlists[0]!.tracks.push({
      id: 't9',
      source: 'youtube',
      videoId: VIDEO_A,
      title: 'LATE',
    })

    expect(file.data.library.data.playlists[0]?.name).toBe('NIGHT DRIVE')
    expect(file.data.library.data.playlists[0]?.tracks).toHaveLength(2)
  })

  it('세션 상태를 담을 자리가 없다', () => {
    const file = createBackup(source())
    const text = JSON.stringify(file)

    for (const token of ['queue', 'queueIndex', 'currentTrack', 'playerState', 'statusMessage']) {
      expect(text).not.toContain(token)
    }
    expect(Object.keys(file.data).sort()).toEqual(['library', 'preferences'])
  })
})

describe('C. 온전성 판정 (resolveBackupIntegrity)', () => {
  it('ready 는 온전하다', () => {
    expect(resolveBackupIntegrity({ status: 'ready', protectedReason: null })).toBeNull()
  })

  it.each([
    ['partial-recovery'] as const,
    ['malformed'] as const,
    ['invalid'] as const,
    ['version-mismatch'] as const,
  ])('protected(%s) 는 복구본이다', (reason) => {
    expect(resolveBackupIntegrity({ status: 'protected', protectedReason: reason })).toEqual({
      library: { level: 'recovered', reason },
    })
  })

  it('unavailable 도 복구본이다', () => {
    expect(resolveBackupIntegrity({ status: 'unavailable', protectedReason: null })).toEqual({
      library: { level: 'recovered', reason: 'unavailable' },
    })
  })

  it('복구본이면 파일에 표시가 들어간다', () => {
    const file = createBackup(
      source({ integrity: { library: { level: 'recovered', reason: 'partial-recovery' } } }),
    )

    expect(file.integrity).toEqual({
      library: { level: 'recovered', reason: 'partial-recovery' },
    })
  })
})

describe('D. 파일 이름과 내려받기', () => {
  it('파일 이름에 접두사와 로컬 날짜·시각이 들어간다', () => {
    // 로컬 시각 기준이므로 로컬 생성자로 만든다.
    const name = backupFileName(new Date(2026, 10, 6, 13, 21, 45))

    expect(name).toBe('39page-backup-20261106-1321.json')
  })

  it('한 자리 월·일·시·분을 0 으로 채운다', () => {
    expect(backupFileName(new Date(2026, 0, 2, 3, 4, 0))).toBe('39page-backup-20260102-0304.json')
  })

  it('파일 이름에 콜론이 없다 — Windows 호환', () => {
    expect(backupFileName(FIXED)).not.toContain(':')
  })

  /** `URL.createObjectURL` 과 Blob 을 세우고 내려받기를 가로챈다. */
  function stubDownload() {
    const created: Blob[] = []
    const revoked: string[] = []
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: vi.fn<(blob: Blob) => string>((blob) => {
        created.push(blob)
        return 'blob:fake'
      }),
      revokeObjectURL: vi.fn<(url: string) => void>((url) => {
        revoked.push(url)
      }),
    })

    const clicks: HTMLAnchorElement[] = []
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function mocked(
      this: HTMLAnchorElement,
    ) {
      clicks.push(this)
    })

    return { created, revoked, clicks, click }
  }

  it('JSON 파일로 내려받고 결과를 알린다', () => {
    const { created, clicks } = stubDownload()

    const result = downloadBackup(createBackup(source()), 'test.json')

    expect(result.ok).toBe(true)
    expect(result.ok && result.fileName).toBe('test.json')
    expect(created).toHaveLength(1)
    expect(created[0]?.type).toBe('application/json;charset=utf-8')
    expect(clicks[0]?.download).toBe('test.json')
    expect(clicks[0]?.rel).toBe('noopener')
  })

  it('내려받은 내용이 백업 객체와 같다', async () => {
    const { created } = stubDownload()
    const file = createBackup(source())

    downloadBackup(file, 'test.json')
    const text = await (created[0] as Blob).text()

    expect(JSON.parse(text)).toEqual(file)
    // 사람이 열어볼 수 있어야 한다 (평문 고지와 같은 취지).
    expect(text).toContain('\n  "format"')
  })

  it('앵커를 문서에 남기지 않는다', () => {
    stubDownload()

    downloadBackup(createBackup(source()), 'test.json')

    expect(document.querySelectorAll('a[download]')).toHaveLength(0)
  })

  it('객체 주소를 즉시 해제하지 않고 다음 매크로태스크에서 해제한다', () => {
    vi.useFakeTimers()
    const { revoked } = stubDownload()

    downloadBackup(createBackup(source()), 'test.json')
    // 동기적으로 해제하면 일부 브라우저에서 다운로드가 시작되기 전에 끊긴다.
    expect(revoked).toEqual([])

    vi.runAllTimers()
    expect(revoked).toEqual(['blob:fake'])
    vi.useRealTimers()
  })

  it('직렬화할 수 없으면 실패로 알린다', () => {
    stubDownload()
    const circular = createBackup(source()) as unknown as Record<string, unknown>
    circular.self = circular

    const result = downloadBackup(circular as unknown as BackupFile, 'test.json')

    expect(result).toMatchObject({ ok: false, reason: 'serialize-failed' })
  })

  it('내려받기 수단이 없는 환경에서는 unsupported 로 알린다', () => {
    vi.stubGlobal('URL', { ...URL, createObjectURL: undefined })

    const result = downloadBackup(createBackup(source()), 'test.json')

    expect(result).toEqual({ ok: false, reason: 'unsupported' })
  })

  it('내려받기 중 예외는 unknown 으로 알리고 던지지 않는다', () => {
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: vi.fn<() => string>(() => {
        throw new Error('blocked')
      }),
      revokeObjectURL: vi.fn<(url: string) => void>(),
    })

    const result = downloadBackup(createBackup(source()), 'test.json')

    expect(result).toMatchObject({ ok: false, reason: 'unknown' })
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
  return { wrapper, fake, library: useLibraryStore(), theme: useThemeStore() }
}

type Context = ReturnType<typeof mountApp>

const backupButton = (context: Context) =>
  context.wrapper.findAll('.backup .pill').filter((node) => node.text().includes('내보내기'))[0]

function seed(store: ReturnType<typeof useLibraryStore>): void {
  const created = store.createPlaylist('NIGHT DRIVE')
  const id = created.ok ? created.playlistId : ''
  store.addTrack(id, { videoId: VIDEO_A, title: 'ONE' })
  store.addTrack(id, { videoId: VIDEO_B, title: 'TWO' })
}

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

describe('E. 드로어 바닥의 백업 패널', () => {
  it('패널이 편집 영역과 구분되어 바닥에 있다', () => {
    const context = mountApp()

    const panel = context.wrapper.get('.backup')
    // 선과 다른 머리말로 끊는다.
    expect(panel.find('.rule').exists()).toBe(true)
    expect(panel.get('.backup-title').text()).toBe('DATA')
    // 트랙 목록보다 뒤에 온다.
    const body = context.wrapper.get('.drawer-body').element
    const list = context.wrapper.get('.track-list').element
    expect(body.contains(panel.element)).toBe(true)
    expect(list.compareDocumentPosition(panel.element) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    )
  })

  it('편집 버튼과 달리 강조를 쓰지 않는다', () => {
    const context = mountApp()

    expect(backupButton(context)?.classes()).not.toContain('pill--strong')
    expect(backupButton(context)?.text()).toContain('JSON 백업 내보내기')
  })

  it('평문이라는 사실을 항상 알린다', () => {
    const context = mountApp()

    const note = context.wrapper.get('.backup-note').text()
    expect(note).toContain('평문')
    expect(note).toContain('영상 ID')
  })

  it('담길 개수를 버튼 옆에 적는다', async () => {
    const context = mountApp()
    seed(context.library)
    await nextTick()

    expect(context.wrapper.get('.backup-count').text()).toContain('1개')
    expect(context.wrapper.get('.backup-count').text()).toContain('2곡')
  })

  it('두 테마에서 모두 보인다', async () => {
    const context = mountApp()
    expect(backupButton(context)?.exists()).toBe(true)

    context.theme.setTheme('kawaii-synth-cassette')
    await nextTick()

    expect(backupButton(context)?.exists()).toBe(true)
    // 테마별 색을 새로 만들지 않았다 — 드로어 토큰을 그대로 쓴다.
    const panelSource = readSource('src/features/backup/BackupPanel.vue')
    expect(panelSource).not.toMatch(/:\s*#[0-9a-fA-F]{3,8}/)
  })

  it('누르면 내려받고 결과를 알린다', async () => {
    const context = mountApp()
    seed(context.library)
    await nextTick()
    const created = stubDownloadGlobals()

    await backupButton(context)?.trigger('click')

    expect(created).toHaveLength(1)
    const result = context.wrapper.get('.backup-result').text()
    expect(result).toContain('39page-backup-')
    expect(result).toContain('1개')
    expect(result).toContain('2곡')
    expect(context.wrapper.get('.backup-result').classes()).not.toContain('is-failed')
  })

  it('내려받은 파일이 지금 라이브러리와 테마를 담는다', async () => {
    const context = mountApp()
    seed(context.library)
    context.theme.setTheme('kawaii-synth-cassette')
    await nextTick()
    const created = stubDownloadGlobals()

    await backupButton(context)?.trigger('click')
    const file = JSON.parse(await (created[0] as Blob).text()) as BackupFile

    expect(file.data.library.data.playlists[0]?.name).toBe('NIGHT DRIVE')
    expect(file.data.library.data.playlists[0]?.tracks.map((track) => track.title)).toEqual([
      'ONE',
      'TWO',
    ])
    expect(file.data.library.data.selectedPlaylistId).toBe(context.library.selectedPlaylistId)
    expect(file.data.preferences?.theme?.data).toBe('kawaii-synth-cassette')
  })

  it('내려받기가 실패하면 오류 어조로 알린다', async () => {
    const context = mountApp()
    await nextTick()
    vi.stubGlobal('URL', { ...URL, createObjectURL: undefined })

    await backupButton(context)?.trigger('click')

    expect(context.wrapper.get('.backup-result').classes()).toContain('is-failed')
    expect(context.wrapper.get('.backup-result').text()).toContain('내려받을 수 없습니다')
  })
})

describe('F. 보호·접근 실패 상태', () => {
  it('보호 상태에서는 경고하고 바로 내려받지 않는다', async () => {
    globalThis.localStorage.setItem(STORAGE_KEYS.library, '{not json')
    const context = mountApp()
    context.library.restore()
    await nextTick()
    const created = stubDownloadGlobals()

    expect(context.library.status).toBe('protected')
    expect(context.wrapper.get('.backup-warning').text()).toContain('복구본')
    expect(backupButton(context)?.text()).toContain('복구본 내보내기')

    await backupButton(context)?.trigger('click')

    // 명시적 선택을 거친다.
    expect(created).toEqual([])
    expect(context.wrapper.find('[aria-label="복구본 내보내기 확인"]').exists()).toBe(true)
  })

  it('확인하면 복구본 표시가 들어간 파일을 내려받는다', async () => {
    globalThis.localStorage.setItem(STORAGE_KEYS.library, '{not json')
    const context = mountApp()
    context.library.restore()
    await nextTick()
    const created = stubDownloadGlobals()

    await backupButton(context)?.trigger('click')
    await context.wrapper.get('[aria-label="복구본 내보내기 확인"] .pill--strong').trigger('click')

    const file = JSON.parse(await (created[0] as Blob).text()) as BackupFile
    expect(file.integrity).toEqual({ library: { level: 'recovered', reason: 'malformed' } })
    expect(context.wrapper.get('.backup-result').text()).toContain('복구본')
  })

  it('취소하면 아무것도 내려받지 않는다', async () => {
    globalThis.localStorage.setItem(STORAGE_KEYS.library, '{not json')
    const context = mountApp()
    context.library.restore()
    await nextTick()
    const created = stubDownloadGlobals()

    await backupButton(context)?.trigger('click')
    const cancel = context.wrapper
      .findAll('[aria-label="복구본 내보내기 확인"] .pill')
      .find((node) => node.text() === '취소')
    await cancel?.trigger('click')

    expect(created).toEqual([])
    expect(context.wrapper.find('[aria-label="복구본 내보내기 확인"]').exists()).toBe(false)
  })

  it('일부만 복구한 경우도 복구본이다', async () => {
    globalThis.localStorage.setItem(
      STORAGE_KEYS.library,
      JSON.stringify({
        version: LIBRARY_STORAGE_VERSION,
        data: {
          playlists: [
            { id: 'p1', name: 'KEEP', tracks: [] },
            // 불량 항목 — 정규화가 버린다.
            { id: '', name: 'DROP', tracks: [] },
          ],
          selectedPlaylistId: 'p1',
        },
      }),
    )
    const context = mountApp()
    context.library.restore()
    await nextTick()
    const created = stubDownloadGlobals()

    expect(context.library.protectedReason).toBe('partial-recovery')

    await backupButton(context)?.trigger('click')
    await context.wrapper.get('[aria-label="복구본 내보내기 확인"] .pill--strong').trigger('click')

    const file = JSON.parse(await (created[0] as Blob).text()) as BackupFile
    expect(file.integrity?.library?.reason).toBe('partial-recovery')
    // 살린 것은 담긴다.
    expect(file.data.library.data.playlists.map((playlist) => playlist.name)).toEqual(['KEEP'])
  })

  it('저장 실패는 복구본이 아니라 안내로 다룬다', async () => {
    const context = mountApp()
    seed(context.library)
    await nextTick()
    /*
     * 쓰기만 막는다. 복원은 정상이었다.
     *
     * 인스턴스가 아니라 프로토타입에 스파이를 건다 — jsdom 의 `localStorage`
     * 는 프록시라서 인스턴스 속성 정의가 먹지 않는다.
     */
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    context.library.createPlaylist('IN MEMORY')
    await nextTick()

    expect(context.library.lastWriteFailure).not.toBeNull()
    // 이때 파일은 저장소보다 **더** 온전하다. 복구본이 아니다.
    expect(context.wrapper.get('.backup-warning').text()).toContain('저장되지 않았습니다')
    expect(backupButton(context)?.text()).toContain('JSON 백업 내보내기')
  })
})

describe('G. 내보내기가 아무것도 바꾸지 않는다', () => {
  it('localStorage 원문이 바이트 단위로 같다', async () => {
    const context = mountApp()
    seed(context.library)
    await nextTick()
    const before = globalThis.localStorage.getItem(STORAGE_KEYS.library)
    const themeBefore = globalThis.localStorage.getItem(STORAGE_KEYS.theme)
    stubDownloadGlobals()

    await backupButton(context)?.trigger('click')

    expect(globalThis.localStorage.getItem(STORAGE_KEYS.library)).toBe(before)
    expect(globalThis.localStorage.getItem(STORAGE_KEYS.theme)).toBe(themeBefore)
  })

  it('setItem 을 한 번도 부르지 않는다', async () => {
    const context = mountApp()
    seed(context.library)
    await nextTick()
    stubDownloadGlobals()
    const setItem = vi.spyOn(Storage.prototype, 'setItem')

    await backupButton(context)?.trigger('click')

    expect(setItem).not.toHaveBeenCalled()
  })

  it('store 상태가 그대로다', async () => {
    const context = mountApp()
    seed(context.library)
    await nextTick()
    stubDownloadGlobals()

    const before = {
      playlists: JSON.stringify(context.library.playlists),
      selected: context.library.selectedPlaylistId,
      status: context.library.status,
      theme: context.theme.current,
    }

    await backupButton(context)?.trigger('click')

    expect(JSON.stringify(context.library.playlists)).toBe(before.playlists)
    expect(context.library.selectedPlaylistId).toBe(before.selected)
    expect(context.library.status).toBe(before.status)
    expect(context.theme.current).toBe(before.theme)
  })

  it('플레이어 DOM 과 어댑터가 유지된다', async () => {
    const context = mountApp()
    seed(context.library)
    await nextTick()
    stubDownloadGlobals()

    const surface = context.wrapper.get('[data-instance-id="player-main"]').element
    const mountHost = context.wrapper.get('.player-mount').element
    const adapterNode = context.fake.hostNode

    await backupButton(context)?.trigger('click')
    await nextTick()

    expect(context.wrapper.get('[data-instance-id="player-main"]').element).toBe(surface)
    expect(context.wrapper.get('.player-mount').element).toBe(mountHost)
    expect(context.fake.hostNode).toBe(adapterNode)
    expect(context.fake.calls.mount).toBe(1)
    expect(context.fake.calls.destroy).toBe(0)
    expect(context.fake.calls.load).toEqual([])
  })

  it('내보내기 경로가 재생을 모른다', () => {
    for (const file of [
      'src/features/backup/createBackup.ts',
      'src/features/backup/downloadBackup.ts',
      'src/features/backup/useBackupExport.ts',
      'src/features/backup/BackupPanel.vue',
    ]) {
      const code = readCode(file)
      expect(code).not.toContain('usePlaybackStore')
      expect(code).not.toContain('PlayerAdapter')
      expect(code).not.toContain('PLAYBACK_COORDINATOR')
      expect(code).not.toContain('features/playback')
    }
  })

  it('조립 함수가 store 와 시계를 모르는 순수 함수다', () => {
    const code = readCode('src/features/backup/createBackup.ts')

    expect(code).not.toContain('useLibraryStore')
    expect(code).not.toContain('useThemeStore')
    expect(code).not.toContain('localStorage')
    // 시각은 호출부가 준다.
    expect(code).not.toContain('new Date()')
  })
})
