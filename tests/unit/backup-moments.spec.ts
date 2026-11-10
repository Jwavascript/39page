/**
 * M9-5 — JSON 백업에 Music Moments 를 담고 되살린다.
 *
 * 규범: `BACKUP_FORMAT.md` §6 · `MOMENTS_DESIGN.md` §5 · ADR 0018 · 0019.
 *
 *   A  내보내기 — 섹션은 항상(0개여도), 필드는 골라서, 저장소는 건드리지 않는다
 *   B  해석 — 없음 · 건너뜀 · 있음(빈 배열 포함)을 섞지 않는다
 *   C  미리보기 — 승인 전 쓰기 0, 지금/가져올 개수, 낡은 승인 감지
 *   D  적용 — 섹션별 결과, 저장 실패·보류, 다시 저장
 *   E  보호 상태 — 원본 보존 · 명시적 교체 · 원문 꺼내기
 *   F  하위 호환 — 구형 백업(A)과 새 백업(B), M10 입구
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { nextTick } from 'vue'

import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import App from '@/app/App.vue'
import {
  BACKUP_SCHEMA_VERSION,
  BACKUP_SECTION_VERSIONS,
  type BackupFile,
} from '@/features/backup/backupSchema'
import {
  countBackupMoments,
  createBackup,
  resolveBackupIntegrity,
  type BackupSource,
} from '@/features/backup/createBackup'
import { readBackup } from '@/features/backup/readBackup'
import { FakePlayerAdapter } from '@/features/playback/FakePlayerAdapter'
import { PLAYER_ADAPTER_FACTORY } from '@/features/playback/PlayerAdapter'
import { STORAGE_KEYS } from '@/shared/storage'
import type { LibraryData, Moment } from '@/shared/types'
import { useLibraryStore } from '@/stores/library'
import { MOMENTS_STORAGE_VERSION, useMomentsStore } from '@/stores/moments'
import { usePlaybackStore } from '@/stores/playback'
import { useThemeStore } from '@/stores/theme'

import { installPlayerRect, uninstallPlayerRect } from '../support/playerLayout'

const OLD_FIXTURE = readFileSync(resolve(process.cwd(), 'tests/fixtures/backup-v1.json'), 'utf8')
const NEW_FIXTURE = readFileSync(
  resolve(process.cwd(), 'tests/fixtures/backup-v1-moments.json'),
  'utf8',
)
const FIXED = new Date('2026-11-10T09:30:00.000Z')
const realLocalStorage = globalThis.localStorage

function moment(overrides: Partial<Moment> = {}): Moment {
  return {
    id: 'cur-1',
    source: 'youtube',
    videoId: 'ddddddddddd',
    atSeconds: 7,
    note: '지금 있던 순간',
    title: 'CURRENT',
    createdAt: '2026-11-09T01:00:00.000Z',
    updatedAt: '2026-11-09T01:00:00.000Z',
    ...overrides,
  }
}

function currentLibrary(): LibraryData {
  return {
    playlists: [
      {
        id: 'cur-p',
        name: 'CURRENT LIST',
        tracks: [{ id: 'cur-t', source: 'youtube', videoId: 'ddddddddddd', title: 'CURRENT' }],
      },
    ],
    selectedPlaylistId: 'cur-p',
  }
}

const raw = (key: string) => globalThis.localStorage.getItem(key)

function seedStorage(
  options: { library?: LibraryData | string; moments?: Moment[] | string } = {},
) {
  const library = options.library ?? currentLibrary()
  globalThis.localStorage.setItem(
    STORAGE_KEYS.library,
    typeof library === 'string' ? library : JSON.stringify({ version: 1, data: library }),
  )
  const moments = options.moments ?? [moment(), moment({ id: 'cur-2', atSeconds: 30 })]
  globalThis.localStorage.setItem(
    STORAGE_KEYS.moments,
    typeof moments === 'string'
      ? moments
      : JSON.stringify({ version: MOMENTS_STORAGE_VERSION, data: moments }),
  )
}

/** `main.ts` 와 같은 순서로 복원하고 앱을 세운다. */
function boot() {
  setActivePinia(createPinia())
  useThemeStore().restore()
  useLibraryStore().restore()
  useMomentsStore().restore()

  const fake = new FakePlayerAdapter()
  const wrapper = mount(App, {
    attachTo: document.body,
    global: { provide: { [PLAYER_ADAPTER_FACTORY as symbol]: () => fake } },
  })
  return {
    wrapper,
    fake,
    library: useLibraryStore(),
    moments: useMomentsStore(),
    theme: useThemeStore(),
    playback: usePlaybackStore(),
  }
}

type Session = ReturnType<typeof boot>

/** 새로고침 = 새 Pinia 로 저장소에서 다시 읽는다. */
function reload() {
  setActivePinia(createPinia())
  const library = useLibraryStore()
  const moments = useMomentsStore()
  library.restore()
  moments.restore()
  return { library, moments }
}

function stubDownloads(): Blob[] {
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

function stubLocalStorage(descriptor: PropertyDescriptor): void {
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, ...descriptor })
}

/**
 * 지금 `localStorage` 내용을 그대로 담은 저장소로 바꾸고, 특정 키 쓰기만 실패시킨다.
 * `failing` 을 바꿔 "다시 저장 시도" 를 성공시킬 수 있다.
 */
function stubFailingWrites(initial: readonly string[]) {
  const map = new Map<string, string>()
  for (let index = 0; index < realLocalStorage.length; index += 1) {
    const key = realLocalStorage.key(index)
    if (key !== null) map.set(key, realLocalStorage.getItem(key) ?? '')
  }
  const failing = new Set(initial)
  stubLocalStorage({
    value: {
      get length() {
        return map.size
      },
      key: (index: number) => [...map.keys()][index] ?? null,
      getItem: (key: string) => map.get(key) ?? null,
      setItem: (key: string, value: string) => {
        if (failing.has(key)) throw new DOMException('full', 'QuotaExceededError')
        map.set(key, value)
      },
      removeItem: (key: string) => void map.delete(key),
      clear: () => map.clear(),
    } satisfies Storage,
    writable: true,
  })
  return failing
}

const panel = (s: Session) => s.wrapper.get('.backup')
const exportButton = (s: Session) =>
  panel(s)
    .findAll('.pill')
    .filter((n) => n.text().includes('내보내기') && !n.text().includes('먼저'))[0]
const applyButton = (s: Session) =>
  s.wrapper.findAll('.preview .pill').filter((n) => n.text().includes('교체하고'))[0]
const cancelButton = (s: Session) =>
  s.wrapper.findAll('.preview .pill').filter((n) => n.text() === '취소')[0]

async function pick(s: Session, text: string): Promise<void> {
  const input = s.wrapper.get<HTMLInputElement>('.backup .file-input')
  const file = new File([text], 'backup.json', { type: 'application/json' })
  Object.defineProperty(input.element, 'files', { value: [file], configurable: true })
  await input.trigger('change')
  await flushPromises()
  await nextTick()
}

async function exportFile(s: Session, created: Blob[]): Promise<BackupFile> {
  await exportButton(s)?.trigger('click')
  await flushPromises()
  const blob = created[created.length - 1]
  if (blob === undefined) throw new Error('내려받지 않았다')
  return JSON.parse(await blob.text()) as BackupFile
}

function previewRow(s: Session, name: string): string[] {
  const row = s.wrapper
    .findAll('.preview-table tbody tr')
    .find((tr) => tr.get('th').text() === name)
  return row?.findAll('td').map((td) => td.text()) ?? []
}

function source(overrides: Partial<BackupSource> = {}): BackupSource {
  return {
    library: currentLibrary(),
    moments: [moment()],
    theme: 'mono-vinyl',
    integrity: null,
    exportedAt: FIXED,
    ...overrides,
  }
}

beforeEach(() => {
  globalThis.localStorage.clear()
  delete document.documentElement.dataset.theme
  installPlayerRect()
})

afterEach(() => {
  stubLocalStorage({ value: realLocalStorage, writable: true })
  globalThis.localStorage.clear()
  uninstallPlayerRect()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  delete document.documentElement.dataset.theme
  document.body.innerHTML = ''
})

/* ================================================================== *
 * A. 내보내기
 * ================================================================== */

describe('A. 내보내기', () => {
  it('Moments 섹션을 저장 봉투 모양으로 담는다 — 섹션 버전은 store 의 것', () => {
    const file = createBackup(source())

    expect(file.schemaVersion).toBe(BACKUP_SCHEMA_VERSION)
    expect(file.schemaVersion).toBe(1)
    expect(BACKUP_SECTION_VERSIONS.moments).toBe(MOMENTS_STORAGE_VERSION)
    expect(file.data.moments).toEqual({ version: MOMENTS_STORAGE_VERSION, data: [moment()] })
  })

  it('0개여도 빈 섹션을 넣는다 — "없음" 과 "비었음" 을 파일에서 구별한다', () => {
    const file = createBackup(source({ moments: [] }))

    expect(file.data.moments).toEqual({ version: 1, data: [] })
    expect(countBackupMoments(file)).toBe(0)
    // 읽는 쪽도 빈 섹션을 "있음" 으로 읽는다.
    const read = readBackup(JSON.stringify(file))
    expect(read.ok && read.momentsSection).toBe('present')
    expect(read.ok && read.moments).toEqual([])
  })

  it('필드를 골라 담는다 — 알 수 없는 필드가 파일로 새지 않는다', () => {
    const polluted = { ...moment(), draft: '쓰던 메모', trackId: 't-1' }
    const file = createBackup(source({ moments: [polluted] }))

    expect(Object.keys(file.data.moments?.data[0] ?? {}).sort()).toEqual([
      'atSeconds',
      'createdAt',
      'id',
      'note',
      'source',
      'title',
      'updatedAt',
      'videoId',
    ])
  })

  it('추가된 순서를 그대로 담고, 깊은 복사다', () => {
    const input = [moment({ id: 'b', atSeconds: 90 }), moment({ id: 'a', atSeconds: 5 })]
    const file = createBackup(source({ moments: input }))
    const first = input[0]
    if (first !== undefined) first.note = '나중에 바꿈'

    expect(file.data.moments?.data.map((m) => m.id)).toEqual(['b', 'a'])
    expect(file.data.moments?.data[0]?.note).toBe('지금 있던 순간')
  })

  it('DATA 패널이 지금 Moments 를 담아 내려받고 개수를 적는다', async () => {
    seedStorage()
    const s = boot()
    const created = stubDownloads()

    expect(panel(s).get('.backup-count').text()).toContain('Moment 2개')
    const file = await exportFile(s, created)

    expect(file.data.moments?.data.map((m) => m.id)).toEqual(['cur-1', 'cur-2'])
    expect(file.integrity).toBeUndefined()
    expect(panel(s).text()).toContain('Moment 2개')
  })

  it('쓰던 메모·고정한 캡처는 담지 않는다 — store 의 영속 필드만', async () => {
    seedStorage({ moments: [] })
    const s = boot()
    const created = stubDownloads()
    await s.wrapper.get('.playlist-tile .playlist-play').trigger('click')
    await flushPromises()
    s.fake.emitReady()
    s.fake.emitStateChange('playing')
    s.fake.emitPosition(42)
    await nextTick()
    await s.wrapper.get('.capture-button').trigger('click')
    await s.wrapper.get('#moment-capture-note').setValue('아직 저장 안 한 메모')

    const file = await exportFile(s, created)

    expect(file.data.moments?.data).toEqual([])
    expect(JSON.stringify(file)).not.toContain('아직 저장 안 한 메모')
  })

  it('내보내기는 저장소를 건드리지 않는다', async () => {
    seedStorage()
    const s = boot()
    const created = stubDownloads()
    const before = { library: raw(STORAGE_KEYS.library), moments: raw(STORAGE_KEYS.moments) }
    const setItem = vi.spyOn(Storage.prototype, 'setItem')

    await exportFile(s, created)

    expect(setItem).not.toHaveBeenCalled()
    expect(raw(STORAGE_KEYS.library)).toBe(before.library)
    expect(raw(STORAGE_KEYS.moments)).toBe(before.moments)
  })

  it('Moments 만 보호 상태여도 복구본이다 — 확인을 거치고 Moments 쪽에 표시가 든다', async () => {
    seedStorage({ moments: '{깨진 Moments' })
    const s = boot()
    const created = stubDownloads()

    expect(panel(s).get('.backup-warning').text()).toContain('저장된 Moments 를 읽지 못했습니다')
    expect(exportButton(s)?.text()).toBe('복구본 내보내기')
    await exportButton(s)?.trigger('click')
    expect(created).toEqual([])

    const confirm = panel(s)
      .findAll('.pill')
      .filter((n) => n.text().includes('복구본으로'))[0]
    await confirm?.trigger('click')
    await flushPromises()
    const file = JSON.parse(await (created[0] as Blob).text()) as BackupFile

    // 라이브러리는 온전하다 — 섹션마다 따로 적는다.
    expect(file.integrity).toEqual({ moments: { level: 'recovered', reason: 'malformed' } })
    expect(raw(STORAGE_KEYS.moments)).toBe('{깨진 Moments')
  })

  it('섹션별 온전성을 따로 계산한다', () => {
    expect(
      resolveBackupIntegrity({
        status: 'ready',
        protectedReason: null,
        moments: { status: 'ready', protectedReason: null },
      }),
    ).toBeNull()
    expect(
      resolveBackupIntegrity({
        status: 'protected',
        protectedReason: 'malformed',
        moments: { status: 'unavailable', protectedReason: null },
      }),
    ).toEqual({
      library: { level: 'recovered', reason: 'malformed' },
      moments: { level: 'recovered', reason: 'unavailable' },
    })
  })

  it('Moments 쓰기 실패는 복구본이 아니다 — 파일에는 메모리의 것이 들어간다', async () => {
    seedStorage({ moments: [] })
    const s = boot()
    stubFailingWrites([STORAGE_KEYS.moments])
    s.moments.add({ videoId: 'ddddddddddd', atSeconds: 3, note: '저장 안 됨' })
    await nextTick()
    const created = stubDownloads()

    expect(panel(s).text()).toContain('이 세션의 변경이 저장되지 않았습니다')
    const file = await exportFile(s, created)

    expect(file.integrity).toBeUndefined()
    expect(file.data.moments?.data.map((m) => m.note)).toEqual(['저장 안 됨'])
  })
})

/* ================================================================== *
 * B. 해석
 * ================================================================== */

describe('B. 해석 — 섹션 없음 · 건너뜀 · 있음', () => {
  function withMoments(section: unknown): string {
    const file = JSON.parse(NEW_FIXTURE) as Record<string, unknown>
    ;(file.data as Record<string, unknown>).moments = section
    return JSON.stringify(file)
  }

  it('구형 파일 — 섹션이 없다. Moments 이전 파일이라고 알린다', () => {
    const result = readBackup(OLD_FIXTURE)

    expect(result.ok && result.momentsSection).toBe('absent')
    expect(result.ok && result.moments).toBeNull()
    expect(result.warnings).toContainEqual({ kind: 'moments-section-absent' })
  })

  it('새 파일 — 모든 Moment 를 id·순서·초·메모·제목·시각까지 읽는다', () => {
    const result = readBackup(NEW_FIXTURE)
    const original = (JSON.parse(NEW_FIXTURE) as BackupFile).data.moments?.data

    expect(result.ok && result.momentsSection).toBe('present')
    expect(result.ok && result.moments).toEqual(original)
    expect(result.warnings).toEqual([])
  })

  it('라이브러리에 없는 영상의 Moment 를 버리지 않는다', () => {
    const result = readBackup(NEW_FIXTURE)

    expect(result.ok && result.moments?.some((m) => m.videoId === 'zzzzzzzzzzz')).toBe(true)
  })

  it('빈 섹션은 "있음" 이고 빈 배열이다', () => {
    const result = readBackup(withMoments({ version: 1, data: [] }))

    expect(result.ok && result.momentsSection).toBe('present')
    expect(result.ok && result.moments).toEqual([])
  })

  it.each([
    ['봉투가 아님', [], 'invalid'],
    ['data 가 배열이 아님', { version: 1, data: { moments: [] } }, 'invalid'],
    ['version 없음', { data: [] }, 'invalid'],
    ['미래 버전', { version: 2, data: [] }, 'future-version'],
    ['이전 버전', { version: 0, data: [] }, 'old-version'],
  ])('%s — 건너뛰고 알린다 (0개로 읽지 않는다)', (_label, section, reason) => {
    const result = readBackup(withMoments(section))

    expect(result.ok && result.momentsSection).toBe('skipped')
    expect(result.ok && result.moments).toBeNull()
    expect(result.warnings).toContainEqual(
      expect.objectContaining({ kind: 'section-skipped', section: 'moments', reason }),
    )
    // 다른 섹션은 계속 읽는다.
    expect(result.ok && result.library?.playlists).toHaveLength(1)
  })

  it('일부만 유효하면 유효한 것만 살리고 버린 수를 이유별로 알린다', () => {
    const valid = (JSON.parse(NEW_FIXTURE) as BackupFile).data.moments?.data ?? []
    const result = readBackup(
      withMoments({
        version: 1,
        data: [
          ...valid,
          { ...valid[0], id: 'bad-video', videoId: 'short' },
          { ...valid[0], id: 'bad-time', atSeconds: 1.5 },
          { ...valid[0], id: 'bad-shape', note: 7 },
          'not-object',
          { ...valid[0] },
        ],
      }),
    )

    expect(result.ok && result.moments?.map((m) => m.id)).toEqual(valid.map((m) => m.id))
    expect(result.warnings).toContainEqual({
      kind: 'dropped-moments',
      count: 5,
      byReason: { shape: 2, 'video-id': 1, time: 1, 'duplicate-id': 1 },
    })
  })

  it('Moments 섹션의 복구본 표시를 라이브러리와 따로 읽는다', () => {
    const file = JSON.parse(NEW_FIXTURE) as Record<string, unknown>
    file.integrity = { moments: { level: 'recovered', reason: 'partial-recovery' } }

    const result = readBackup(JSON.stringify(file))

    expect(result.ok && result.integrity).toEqual({
      moments: { level: 'recovered', reason: 'partial-recovery' },
    })
    expect(result.warnings).toContainEqual({
      kind: 'recovered-backup',
      reason: 'partial-recovery',
      section: 'moments',
    })
  })

  it('라이브러리를 건너뛰어도 Moments 만으로 가져올 수 있다', () => {
    const file = JSON.parse(NEW_FIXTURE) as Record<string, Record<string, unknown>>
    ;(file.data as Record<string, unknown>).library = { version: 99, data: {} }
    delete (file.data as Record<string, unknown>).preferences

    const result = readBackup(JSON.stringify(file))

    expect(result.ok).toBe(true)
    expect(result.ok && result.library).toBeNull()
    expect(result.ok && result.moments).toHaveLength(3)
  })

  it('새 고정 파일 → 읽기 → 다시 조립 = 같은 data (왕복)', () => {
    const read = readBackup(NEW_FIXTURE)
    if (!read.ok || read.library === null || read.theme === null || read.moments === null) {
      throw new Error('새 고정 파일을 읽지 못했다')
    }

    const rebuilt = createBackup({
      library: read.library,
      moments: read.moments,
      theme: read.theme,
      integrity: null,
      exportedAt: FIXED,
    })

    expect(rebuilt.data).toEqual((JSON.parse(NEW_FIXTURE) as BackupFile).data)
  })
})

/* ================================================================== *
 * C. 미리보기
 * ================================================================== */

describe('C. 미리보기 — 승인 전에는 아무것도 쓰지 않는다', () => {
  it('지금 Moment 수와 가져올 수를 함께 보이고 교체를 알린다', async () => {
    seedStorage()
    const s = boot()

    await pick(s, NEW_FIXTURE)

    expect(previewRow(s, 'Moments')).toEqual(['2개', '3개'])
    const sections = s.wrapper.get('.preview-sections').text()
    expect(sections).toContain('Moments — 교체')
    expect(sections).toContain('지금 Moment 2개를 파일의 3개로')
    expect(s.wrapper.get('.preview-danger').text()).toContain('지금 Moment 2개')
  })

  it('구형 파일 — Moments 는 유지라고 적고 교체 목록에 넣지 않는다', async () => {
    seedStorage()
    const s = boot()

    await pick(s, OLD_FIXTURE)

    expect(previewRow(s, 'Moments')).toEqual(['2개', '— (파일에 없음)'])
    expect(s.wrapper.get('.preview-sections').text()).toContain('Moments — 유지')
    expect(s.wrapper.get('.preview-danger').text()).not.toContain('Moment')
    expect(s.wrapper.get('.preview-warnings').text()).toContain(
      'Moments 가 생기기 전에 만든 파일입니다',
    )
  })

  it('빈 섹션 — 모두 지워진다고 미리 말한다', async () => {
    seedStorage()
    const s = boot()
    const file = JSON.parse(NEW_FIXTURE) as BackupFile
    if (file.data.moments) file.data.moments.data = []

    await pick(s, JSON.stringify(file))

    expect(previewRow(s, 'Moments')).toEqual(['2개', '0개'])
    expect(s.wrapper.get('.preview-sections').text()).toContain('0개로')
    expect(s.wrapper.get('.preview-danger').text()).toContain('모두 지워집니다')
  })

  it('읽을 수 없는 섹션 — 유지라고 적는다', async () => {
    seedStorage()
    const s = boot()
    const file = JSON.parse(NEW_FIXTURE) as Record<string, Record<string, unknown>>
    ;(file.data as Record<string, unknown>).moments = { version: 7, data: [] }

    await pick(s, JSON.stringify(file))

    expect(previewRow(s, 'Moments')).toEqual(['2개', '— (읽을 수 없음)'])
    expect(s.wrapper.get('.preview-warnings').text()).toContain(
      'Moments 을 건너뜁니다 (더 새 버전)',
    )
  })

  it('버린 Moment 의 수와 이유를 미리보기에 적는다', async () => {
    seedStorage()
    const s = boot()
    const file = JSON.parse(NEW_FIXTURE) as BackupFile
    const first = file.data.moments?.data[0]
    file.data.moments?.data.push({ ...(first as Moment), id: 'x', videoId: 'bad' })
    file.data.moments?.data.push({ ...(first as Moment) })

    await pick(s, JSON.stringify(file))

    expect(s.wrapper.get('.preview-warnings').text()).toContain(
      'Moment 2개를 가져올 수 없습니다 — 영상 ID 오류 1개 · 중복 id 1개',
    )
    expect(previewRow(s, 'Moments')).toEqual(['2개', '3개'])
  })

  it('파일 선택·미리보기·취소까지 setItem 0회, 원문과 store 그대로', async () => {
    seedStorage()
    const s = boot()
    const before = {
      library: raw(STORAGE_KEYS.library),
      moments: raw(STORAGE_KEYS.moments),
      store: JSON.stringify(s.moments.moments),
    }
    const setItem = vi.spyOn(Storage.prototype, 'setItem')

    await pick(s, NEW_FIXTURE)
    await cancelButton(s)?.trigger('click')
    await nextTick()

    expect(setItem).not.toHaveBeenCalled()
    expect(raw(STORAGE_KEYS.library)).toBe(before.library)
    expect(raw(STORAGE_KEYS.moments)).toBe(before.moments)
    expect(JSON.stringify(s.moments.moments)).toBe(before.store)
    expect(s.wrapper.find('.preview').exists()).toBe(false)
  })

  it('미리보기 뒤 다른 탭이 Moments 를 바꾸면 낡은 승인으로 덮어쓰지 않는다', async () => {
    seedStorage()
    const s = boot()
    await pick(s, NEW_FIXTURE)

    // 다른 탭이 저장소의 Moments 를 바꿨다. 이 탭의 store 는 모른다.
    const otherTab = JSON.stringify({ version: 1, data: [moment({ id: 'other-tab' })] })
    realLocalStorage.setItem(STORAGE_KEYS.moments, otherTab)
    await applyButton(s)?.trigger('click')
    await nextTick()

    expect(s.wrapper.get('.preview').text()).toContain(
      '미리보기를 뜬 뒤 지금 데이터가 바뀌었습니다',
    )
    expect(raw(STORAGE_KEYS.moments)).toBe(otherTab)
    expect(s.moments.moments.map((m) => m.id)).toEqual(['cur-1', 'cur-2'])
  })

  it('미리보기 뒤 이 탭에서 Moment 를 더해도 다시 확인하게 한다', async () => {
    seedStorage()
    const s = boot()
    await pick(s, NEW_FIXTURE)

    s.moments.add({ videoId: 'ddddddddddd', atSeconds: 99 })
    await applyButton(s)?.trigger('click')
    await nextTick()

    expect(s.wrapper.get('.preview').text()).toContain('다시 확인해주세요')
    expect(s.moments.count).toBe(3)

    // 확인하고 다시 누르면 적용된다.
    await applyButton(s)?.trigger('click')
    await nextTick()
    expect(s.moments.moments.map((m) => m.id)).toEqual(['m-alpha-42', 'm-gone-0', 'm-beta-3725'])
  })
})

/* ================================================================== *
 * D. 적용
 * ================================================================== */

describe('D. 적용 — 섹션마다 따로 보고한다', () => {
  const resultItems = (s: Session) => s.wrapper.findAll('.result-list li').map((li) => li.text())

  it('새 백업 — 플레이리스트·Moments·테마를 모두 되살리고 새로고침해도 남는다', async () => {
    seedStorage()
    const s = boot()

    await pick(s, NEW_FIXTURE)
    await applyButton(s)?.trigger('click')
    await nextTick()

    const expected = (JSON.parse(NEW_FIXTURE) as BackupFile).data.moments?.data
    expect(s.moments.moments).toEqual(expected)
    expect(resultItems(s)).toEqual([
      '플레이리스트 — 저장됨 · 1개 · 2곡',
      'Moments — 저장됨 · Moment 3개',
      '테마 — 저장됨 · mono-vinyl',
    ])
    expect(panel(s).text()).toContain('복원했습니다. 반영: 플레이리스트 1개 · 2곡 · Moment 3개')

    const after = reload()
    expect(after.moments.moments).toEqual(expected)
    expect(after.moments.status).toBe('ready')
    expect(after.library.playlists.map((p) => p.id)).toEqual(['p-night'])
  })

  it('구형 백업 — 플레이리스트는 교체하고 Moments 는 원문까지 그대로 남긴다', async () => {
    seedStorage()
    const s = boot()
    const momentsBefore = raw(STORAGE_KEYS.moments)

    await pick(s, OLD_FIXTURE)
    await applyButton(s)?.trigger('click')
    await nextTick()

    expect(s.library.playlists.map((p) => p.id)).toEqual(['p-night', 'p-morning'])
    expect(s.moments.moments.map((m) => m.id)).toEqual(['cur-1', 'cur-2'])
    expect(raw(STORAGE_KEYS.moments)).toBe(momentsBefore)
    // 유지는 실패가 아니다.
    expect(panel(s).text()).toContain('복원했습니다.')
    expect(panel(s).text()).not.toContain('일부만 복원')
    expect(resultItems(s)).toContain('Moments — 유지 · 파일에 없음 — 지금 Moment 2개 유지')

    const after = reload()
    expect(after.moments.moments.map((m) => m.id)).toEqual(['cur-1', 'cur-2'])
  })

  it('빈 섹션 — 승인하면 0개로 교체한다', async () => {
    seedStorage()
    const s = boot()
    const file = JSON.parse(NEW_FIXTURE) as BackupFile
    if (file.data.moments) file.data.moments.data = []

    await pick(s, JSON.stringify(file))
    await applyButton(s)?.trigger('click')
    await nextTick()

    expect(s.moments.count).toBe(0)
    expect(JSON.parse(raw(STORAGE_KEYS.moments) as string)).toEqual({ version: 1, data: [] })
  })

  it('미래 버전 섹션 — 건너뛰고 지금 Moments 를 지키며 일부만 복원이라고 말한다', async () => {
    seedStorage()
    const s = boot()
    const momentsBefore = raw(STORAGE_KEYS.moments)
    const file = JSON.parse(NEW_FIXTURE) as Record<string, Record<string, unknown>>
    ;(file.data as Record<string, unknown>).moments = { version: 2, data: [{ future: true }] }

    await pick(s, JSON.stringify(file))
    await applyButton(s)?.trigger('click')
    await nextTick()

    expect(raw(STORAGE_KEYS.moments)).toBe(momentsBefore)
    expect(s.moments.count).toBe(2)
    expect(panel(s).text()).toContain('일부만 복원했습니다')
    expect(resultItems(s)).toContain(
      'Moments — 가져오지 않음 · 파일의 Moments 를 읽을 수 없음 — 지금 것 유지',
    )
  })

  it('Moments 만 교체하면 라이브러리·재생을 건드리지 않는다', async () => {
    seedStorage()
    const s = boot()
    await s.wrapper.get('.playlist-tile .playlist-play').trigger('click')
    await flushPromises()
    s.fake.emitReady()
    s.fake.emitStateChange('playing')
    const queueBefore = s.playback.queue.map((track) => track.id)
    const libraryBefore = raw(STORAGE_KEYS.library)
    const file = JSON.parse(NEW_FIXTURE) as Record<string, Record<string, unknown>>
    ;(file.data as Record<string, unknown>).library = { version: 99, data: {} }
    delete (file.data as Record<string, unknown>).preferences

    await pick(s, JSON.stringify(file))
    await applyButton(s)?.trigger('click')
    await nextTick()

    expect(s.moments.count).toBe(3)
    expect(raw(STORAGE_KEYS.library)).toBe(libraryBefore)
    expect(s.playback.queue.map((track) => track.id)).toEqual(queueBefore)
    expect(s.playback.playerState).toBe('playing')
    expect(s.fake.calls.pause).toBe(0)
  })

  it('Moments 만 저장에 실패하면 — 화면엔 반영, 저장소는 그대로, 새로고침하면 옛 Moments', async () => {
    seedStorage()
    const s = boot()
    const momentsBefore = raw(STORAGE_KEYS.moments)
    await pick(s, NEW_FIXTURE)
    const failing = stubFailingWrites([STORAGE_KEYS.moments])

    await applyButton(s)?.trigger('click')
    await nextTick()

    expect(s.moments.count).toBe(3)
    expect(globalThis.localStorage.getItem(STORAGE_KEYS.moments)).toBe(momentsBefore)
    expect(resultItems(s)).toContain(
      'Moments — 저장되지 않음 (새로고침하면 사라짐) · Moment 3개 — 저장 공간 부족, 이번 세션에만 반영',
    )
    expect(resultItems(s)[0]).toContain('플레이리스트 — 저장됨')
    expect(panel(s).text()).toContain('일부만 복원했습니다')
    // "일부만" 없이 "복원했습니다" 라고 말하지 않는다 — 영구 복원 성공으로 보이면 안 된다.
    expect(panel(s).text()).not.toMatch(/(?<!일부만 )복원했습니다/)
    expect(s.wrapper.find('.unsaved-block').exists()).toBe(true)

    // 새로고침하면: 새 플레이리스트 + 옛 Moments. 실제로 무엇이 남는지 본다.
    const after = reload()
    expect(after.library.playlists.map((p) => p.id)).toEqual(['p-night'])
    expect(after.moments.moments.map((m) => m.id)).toEqual(['cur-1', 'cur-2'])

    // 공간이 돌아오면 같은 데이터로 다시 저장한다.
    setActivePinia(s.wrapper.vm.$pinia)
    failing.clear()
    const retry = s.wrapper
      .findAll('.unsaved-block .pill')
      .find((n) => n.text().includes('다시 저장'))
    await retry?.trigger('click')
    await nextTick()
    expect(resultItems(s)).toContain('Moments — 저장됨 · Moment 3개')
    expect(
      JSON.parse(globalThis.localStorage.getItem(STORAGE_KEYS.moments) as string).data,
    ).toHaveLength(3)
  })

  it('플레이리스트 저장이 실패하면 Moments 는 보류한다 — 옛 목록 + 새 Moments 가 섞여 남지 않는다', async () => {
    seedStorage()
    const s = boot()
    const momentsBefore = raw(STORAGE_KEYS.moments)
    await pick(s, NEW_FIXTURE)
    const failing = stubFailingWrites([STORAGE_KEYS.library])

    await applyButton(s)?.trigger('click')
    await nextTick()

    // 화면의 Moments 도, 저장소도 그대로다.
    expect(s.moments.moments.map((m) => m.id)).toEqual(['cur-1', 'cur-2'])
    expect(globalThis.localStorage.getItem(STORAGE_KEYS.moments)).toBe(momentsBefore)
    expect(resultItems(s)).toContain(
      'Moments — 보류 · 플레이리스트가 저장되지 않아 반영하지 않음 — 다시 저장 시도 때 함께 반영',
    )

    // 다시 저장 — 이번엔 플레이리스트가 저장되고, 그 다음 Moments 가 반영된다.
    failing.clear()
    const retry = s.wrapper
      .findAll('.unsaved-block .pill')
      .find((n) => n.text().includes('다시 저장'))
    await retry?.trigger('click')
    await nextTick()

    expect(s.moments.moments.map((m) => m.id)).toEqual(['m-alpha-42', 'm-gone-0', 'm-beta-3725'])
    expect(resultItems(s)).toEqual([
      '플레이리스트 — 저장됨 · 1개 · 2곡',
      'Moments — 저장됨 · Moment 3개',
    ])
    expect(s.wrapper.find('.unsaved-block').exists()).toBe(false)
  })
})

/* ================================================================== *
 * E. 보호 상태
 * ================================================================== */

describe('E. 보호 상태 — 원본 보존과 명시적 교체', () => {
  it('보호된 Moments 원본은 구형 파일을 가져와도 그대로다', async () => {
    seedStorage({ moments: '{깨진 Moments' })
    const s = boot()

    await pick(s, OLD_FIXTURE)
    expect(s.wrapper.find('.preview').text()).not.toContain('Moments 원본을 읽지 못한')
    await applyButton(s)?.trigger('click')
    await nextTick()

    expect(raw(STORAGE_KEYS.moments)).toBe('{깨진 Moments')
    expect(s.moments.status).toBe('protected')
  })

  it('새 파일로 교체하면 덮어쓴다고 먼저 알리고, 원문을 꺼낼 수 있다', async () => {
    seedStorage({ moments: '{깨진 Moments' })
    const s = boot()
    const created = stubDownloads()

    await pick(s, NEW_FIXTURE)
    expect(s.wrapper.get('.preview').text()).toContain('저장된 Moments 원본을 읽지 못한 상태입니다')

    const rawButton = s.wrapper
      .findAll('.preview .pill')
      .find((n) => n.text() === '읽지 못한 Moments 원본 내려받기')
    await rawButton?.trigger('click')
    expect(await (created[0] as Blob).text()).toBe('{깨진 Moments')

    await applyButton(s)?.trigger('click')
    await nextTick()

    // 사용자가 명시적으로 교체했다. 보호가 풀리고 새 Moments 가 저장된다.
    expect(s.moments.status).toBe('ready')
    expect(JSON.parse(raw(STORAGE_KEYS.moments) as string).data).toHaveLength(3)
  })

  it('보호 상태인데 저장소에 접근할 수 없으면 가져오기를 막는다', async () => {
    seedStorage({ moments: '{깨진 Moments' })
    const s = boot()
    await pick(s, NEW_FIXTURE)
    stubLocalStorage({
      get() {
        throw new Error('blocked')
      },
    })
    // 미리보기를 다시 계산하게 한다.
    s.moments.add({ videoId: 'ddddddddddd', atSeconds: 1 })
    await nextTick()

    expect(s.wrapper.get('.preview-blocked').text()).toContain('가져오기를 막았습니다')
    expect(applyButton(s)?.attributes('disabled')).toBeDefined()
  })

  it('부분 복구된 Moments 원본도 보호한다 — 구형 파일 복원 뒤에도 원문 그대로', async () => {
    const partial = JSON.stringify({ version: 1, data: [moment(), { id: 'broken' }] })
    seedStorage({ moments: partial })
    const s = boot()
    expect(s.moments.protectedReason).toBe('partial-recovery')

    await pick(s, OLD_FIXTURE)
    await applyButton(s)?.trigger('click')
    await nextTick()

    expect(raw(STORAGE_KEYS.moments)).toBe(partial)
  })
})

/* ================================================================== *
 * F. 하위 호환과 M10 입구
 * ================================================================== */

describe('F. 하위 호환 — 구형 백업 A · 새 백업 B', () => {
  it('A. 구형 백업을 가져오면 기존 Moments 가 살아남는다', async () => {
    seedStorage()
    const s = boot()

    await pick(s, OLD_FIXTURE)
    await applyButton(s)?.trigger('click')
    await nextTick()

    expect(reload().moments.moments.map((m) => m.id)).toEqual(['cur-1', 'cur-2'])
  })

  it('B. 내보낸 새 백업을 다른 브라우저(빈 저장소)에 가져오면 Moments 까지 정확히 복원된다', async () => {
    seedStorage({
      moments: [
        moment({ id: 'x1', atSeconds: 0, note: '' }),
        moment({ id: 'x2', videoId: 'zzzzzzzzzzz', atSeconds: 3725, note: '첫 줄\n둘째 줄' }),
      ],
    })
    const s = boot()
    const created = stubDownloads()
    const exported = await exportFile(s, created)
    const original = JSON.parse(JSON.stringify(s.moments.moments)) as Moment[]
    s.wrapper.unmount()

    // 다른 기기: 저장소가 비어 있다.
    globalThis.localStorage.clear()
    const other = boot()
    expect(other.moments.count).toBe(0)
    await pick(other, JSON.stringify(exported))
    await applyButton(other)?.trigger('click')
    await nextTick()

    expect(other.moments.moments).toEqual(original)
    expect(reload().moments.moments).toEqual(original)
  })

  it('M10 입구(addMoments)로 들어온 Moment 도 같은 검증·같은 백업 경로를 지난다', async () => {
    seedStorage({ moments: [] })
    const s = boot()
    const fromExtension = [
      moment({ id: 'ext-1', videoId: 'eeeeeeeeeee', title: '확장에서 저장' }),
      { id: 'ext-bad', videoId: 'nope' },
    ]
    const added = s.moments.addMoments(fromExtension)
    expect(added).toMatchObject({ added: 1, dropped: 1 })

    const created = stubDownloads()
    const file = await exportFile(s, created)
    const read = readBackup(JSON.stringify(file))

    expect(read.ok && read.moments?.map((m) => m.id)).toEqual(['ext-1'])
  })
})
