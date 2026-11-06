/**
 * 백업 파일 해석과 검증 (M8-3). **순수 함수다.**
 *
 * `localStorage` 도 store 도 DOM 도 만지지 않는다. 문자열을 받아 "무엇을
 * 가져올 수 있고 무엇을 버리는가" 를 돌려줄 뿐이다. 그래서
 * **미리보기 단계가 구조적으로 읽기 전용**이 된다 (ADR 0018 결정 5).
 *
 * **새 검증 규칙을 만들지 않는다.** 섹션 내용은 `normalizeLibraryData` 와
 * `isThemeKey` 가 본다 — M2 가 쓰는 것과 **같은 함수**다. 복사하면 두 경로가
 * 어긋나고, 어긋나면 "가져온 것이 다음 복원에서 버려지는" 사고가 난다
 * (ADR 0018 결정 2).
 *
 * **임의로 고치지 않는다.** 지원하지 않는 버전이나 깨진 데이터를 그럴듯한
 * 값으로 바꾸지 않는다. 버리거나 건너뛰고, **개수와 사유를 보고한다.**
 */
import { isThemeKey, type LibraryData, type ThemeKey } from '@/shared/types'
import { normalizeLibraryData } from '@/stores/library'

import {
  BACKUP_FORMAT,
  BACKUP_SCHEMA_VERSION,
  BACKUP_SECTION_VERSIONS,
  type BackupIntegrity,
  type BackupIntegrityReason,
  type BackupSectionIntegrity,
} from './backupSchema'

/**
 * 가져오기 거부 상한 (`BACKUP_FORMAT.md` §5-2).
 *
 * 트랙 하나가 JSON 약 150바이트이므로 8 MiB 는 5만 곡 이상이다. 정당한
 * 백업을 막지 않으면서 병리적인 입력이 파싱 단계에서 탭을 멈추는 것을 막는다.
 */
export const MAX_BACKUP_BYTES = 8 * 1024 * 1024

/**
 * 저장 용량 경고 기준.
 *
 * `localStorage` 가 origin 당 대개 5 MiB 다. 넘으면 저장이 실패할 수 있다고
 * **미리** 알린다 — 실제 실패는 쓰기 결과의 `quota-exceeded` 가 알려준다.
 */
export const BACKUP_SIZE_WARNING_BYTES = 4 * 1024 * 1024

/** 파일 전체를 거부하는 사유. */
export type BackupReadError =
  | { readonly kind: 'too-large'; readonly size: number; readonly limit: number }
  | { readonly kind: 'not-json' }
  | { readonly kind: 'not-backup' }
  | {
      readonly kind: 'unsupported-version'
      readonly schemaVersion: number
      readonly supported: number
    }
  | { readonly kind: 'missing-field'; readonly field: string }
  | { readonly kind: 'nothing-importable' }

/** 가져올 수는 있지만 사용자가 알아야 하는 사실. */
export type BackupWarning =
  | { readonly kind: 'dropped-playlists'; readonly count: number }
  | { readonly kind: 'dropped-tracks'; readonly count: number }
  | { readonly kind: 'repaired-selection' }
  | {
      readonly kind: 'section-skipped'
      readonly section: string
      readonly reason: 'future-version' | 'old-version' | 'invalid'
      readonly version?: number
    }
  | { readonly kind: 'unknown-section'; readonly section: string }
  | { readonly kind: 'recovered-backup'; readonly reason: BackupIntegrityReason }
  | { readonly kind: 'invalid-exported-at' }
  | { readonly kind: 'large-file'; readonly size: number }

export interface BackupReadSuccess {
  readonly ok: true
  readonly schemaVersion: number
  /** 파일이 적은 시각. 형식이 깨졌으면 `null` 이고 경고가 붙는다. */
  readonly exportedAt: string | null
  /** 복구본 표시. 없으면 `null`. */
  readonly integrity: BackupIntegrity | null
  /** 가져올 수 있는 라이브러리. 섹션을 건너뛰었으면 `null`. */
  readonly library: LibraryData | null
  /** 가져올 수 있는 테마. 없거나 건너뛰었으면 `null`. */
  readonly theme: ThemeKey | null
  readonly warnings: readonly BackupWarning[]
  /** `library` 가 담고 있는 개수. 건너뛰었으면 0 이다. */
  readonly counts: { readonly playlists: number; readonly tracks: number }
}

export type BackupReadResult =
  | BackupReadSuccess
  | {
      readonly ok: false
      readonly error: BackupReadError
      readonly warnings: readonly BackupWarning[]
    }

/** 파일을 읽기 **전에** 크기를 본다. 넘으면 파싱조차 하지 않는다. */
export function checkBackupSize(size: number): BackupReadError | null {
  return size > MAX_BACKUP_BYTES ? { kind: 'too-large', size, limit: MAX_BACKUP_BYTES } : null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** `{ version: number, data: unknown }` 인지. 저장 봉투와 같은 모양이다. */
function asSection(value: unknown): { version: number; data: unknown } | null {
  if (!isRecord(value)) return null
  if (!Number.isInteger(value.version)) return null
  if (!('data' in value)) return null
  return { version: value.version as number, data: value.data }
}

const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/

const INTEGRITY_REASONS: readonly BackupIntegrityReason[] = [
  'partial-recovery',
  'malformed',
  'invalid',
  'version-mismatch',
  'unavailable',
]

/**
 * `integrity` 를 읽는다. 모양이 어긋나면 **무시한다** (`null`).
 *
 * 선택 필드이므로 깨졌다고 파일을 거부하지 않는다. 다만 복구본 표시를 놓치면
 * 사용자가 불완전한 백업을 온전한 것으로 오인하므로, 읽을 수 있는 한 읽는다.
 */
function readIntegrity(value: unknown): BackupIntegrity | null {
  if (!isRecord(value)) return null

  const section = value.library
  if (!isRecord(section)) return null
  if (section.level !== 'recovered' && section.level !== 'complete') return null
  if (!INTEGRITY_REASONS.includes(section.reason as BackupIntegrityReason)) return null

  const library: BackupSectionIntegrity = {
    level: section.level,
    reason: section.reason as BackupIntegrityReason,
  }
  return { library }
}

/** 우리가 아는 섹션 이름. 그 밖은 "알 수 없는 섹션" 으로 알린다. */
const KNOWN_SECTIONS = new Set(['library', 'preferences'])

/** 우리가 아는 설정 이름. */
const KNOWN_PREFERENCES = new Set(['theme'])

/**
 * 백업 파일 문자열을 해석한다.
 *
 * 순서가 뜻을 갖는다 — 먼저 걸린 것이 사용자에게 보이는 사유가 된다.
 * 바깥(파일 자체)에서 안(항목)으로 좁혀 간다.
 */
export function readBackup(text: string, size?: number): BackupReadResult {
  const warnings: BackupWarning[] = []

  if (size !== undefined && size > BACKUP_SIZE_WARNING_BYTES) {
    warnings.push({ kind: 'large-file', size })
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return { ok: false, error: { kind: 'not-json' }, warnings }
  }

  if (!isRecord(parsed)) {
    return { ok: false, error: { kind: 'not-backup' }, warnings }
  }

  // 다른 앱의 JSON 을 "구조가 비슷하니" 받아들이지 않는다.
  if (parsed.format !== BACKUP_FORMAT) {
    return { ok: false, error: { kind: 'not-backup' }, warnings }
  }

  if (!Number.isInteger(parsed.schemaVersion)) {
    return { ok: false, error: { kind: 'missing-field', field: 'schemaVersion' }, warnings }
  }

  const schemaVersion = parsed.schemaVersion as number
  if (schemaVersion > BACKUP_SCHEMA_VERSION) {
    // 구조를 모르는 파일을 추측해서 읽지 않는다 (`BACKUP_FORMAT.md` §3-1).
    return {
      ok: false,
      error: { kind: 'unsupported-version', schemaVersion, supported: BACKUP_SCHEMA_VERSION },
      warnings,
    }
  }

  if (!isRecord(parsed.data)) {
    return { ok: false, error: { kind: 'missing-field', field: 'data' }, warnings }
  }

  const data = parsed.data

  // `exportedAt` 은 정보용이다. 깨졌다고 거부하지 않는다.
  let exportedAt: string | null = null
  if (typeof parsed.exportedAt === 'string' && ISO_UTC.test(parsed.exportedAt)) {
    exportedAt = parsed.exportedAt
  } else {
    warnings.push({ kind: 'invalid-exported-at' })
  }

  const integrity = readIntegrity(parsed.integrity)
  if (integrity?.library?.level === 'recovered') {
    warnings.push({ kind: 'recovered-backup', reason: integrity.library.reason })
  }

  /* ---------- 알 수 없는 섹션 ---------- */

  for (const name of Object.keys(data)) {
    if (!KNOWN_SECTIONS.has(name)) warnings.push({ kind: 'unknown-section', section: name })
  }

  /* ---------- library ---------- */

  if (!('library' in data)) {
    return { ok: false, error: { kind: 'missing-field', field: 'data.library' }, warnings }
  }

  const librarySection = asSection(data.library)
  if (librarySection === null) {
    return { ok: false, error: { kind: 'missing-field', field: 'data.library.version' }, warnings }
  }

  let libraryData: LibraryData | null = null

  if (librarySection.version > BACKUP_SECTION_VERSIONS.library) {
    // 앞으로 되돌릴 수 없다. 섹션만 건너뛰고 나머지는 계속 본다.
    warnings.push({
      kind: 'section-skipped',
      section: 'library',
      reason: 'future-version',
      version: librarySection.version,
    })
  } else if (librarySection.version < BACKUP_SECTION_VERSIONS.library) {
    /*
     * 마이그레이션 수단이 아직 없다 (`BACKUP_FORMAT.md` §3-3).
     * 추측해서 올리지 않는다 — 올리려면 저장 계층과 **같은 순수 함수**를
     * 써야 하고, 그것은 내부 버전을 올리는 작업의 몫이다 (ADR 0018 결정 6).
     */
    warnings.push({
      kind: 'section-skipped',
      section: 'library',
      reason: 'old-version',
      version: librarySection.version,
    })
  } else {
    const normalized = normalizeLibraryData(librarySection.data)
    if (normalized === null) {
      warnings.push({ kind: 'section-skipped', section: 'library', reason: 'invalid' })
    } else {
      libraryData = normalized.data
      // 버린 것을 세지 않는다 — M2 의 정규화가 이미 세어 준다.
      if (normalized.report.droppedPlaylists > 0) {
        warnings.push({
          kind: 'dropped-playlists',
          count: normalized.report.droppedPlaylists,
        })
      }
      if (normalized.report.droppedTracks > 0) {
        warnings.push({ kind: 'dropped-tracks', count: normalized.report.droppedTracks })
      }
      if (normalized.report.repairedSelection) {
        warnings.push({ kind: 'repaired-selection' })
      }
    }
  }

  /* ---------- preferences.theme ---------- */

  let theme: ThemeKey | null = null

  if (isRecord(data.preferences)) {
    for (const name of Object.keys(data.preferences)) {
      if (!KNOWN_PREFERENCES.has(name)) {
        warnings.push({ kind: 'unknown-section', section: `preferences.${name}` })
      }
    }

    if ('theme' in data.preferences) {
      const themeSection = asSection(data.preferences.theme)
      if (themeSection === null) {
        warnings.push({ kind: 'section-skipped', section: 'preferences.theme', reason: 'invalid' })
      } else if (themeSection.version !== BACKUP_SECTION_VERSIONS.theme) {
        warnings.push({
          kind: 'section-skipped',
          section: 'preferences.theme',
          reason:
            themeSection.version > BACKUP_SECTION_VERSIONS.theme ? 'future-version' : 'old-version',
          version: themeSection.version,
        })
      } else if (isThemeKey(themeSection.data)) {
        theme = themeSection.data
      } else {
        warnings.push({ kind: 'section-skipped', section: 'preferences.theme', reason: 'invalid' })
      }
    }
  } else if ('preferences' in data) {
    warnings.push({ kind: 'section-skipped', section: 'preferences', reason: 'invalid' })
  }

  /* ---------- 가져올 것이 남았는가 ---------- */

  if (libraryData === null && theme === null) {
    return { ok: false, error: { kind: 'nothing-importable' }, warnings }
  }

  const playlists = libraryData?.playlists ?? []

  return {
    ok: true,
    schemaVersion,
    exportedAt,
    integrity,
    library: libraryData,
    theme,
    warnings,
    counts: {
      playlists: playlists.length,
      tracks: playlists.reduce((total, playlist) => total + playlist.tracks.length, 0),
    },
  }
}
