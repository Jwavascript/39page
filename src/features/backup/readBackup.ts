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
import { isThemeKey, type LibraryData, type MomentsData, type ThemeKey } from '@/shared/types'
import { normalizeLibraryData } from '@/stores/library'
import { normalizeMomentsData, type MomentDropReason } from '@/stores/moments'

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
  | {
      readonly kind: 'recovered-backup'
      readonly reason: BackupIntegrityReason
      /** M9-5. Moments 섹션만 복구본이면 `'moments'`. 없으면 라이브러리다. */
      readonly section?: 'moments'
    }
  | {
      /** M9-5. 형식이 틀린 Moment 를 버렸다. 이유별 개수를 함께 준다. */
      readonly kind: 'dropped-moments'
      readonly count: number
      readonly byReason: Readonly<Record<MomentDropReason, number>>
    }
  | {
      /**
       * M9-5. 파일에 `data.moments` 가 **아예 없다** — Moments 가 생기기 전
       * (M8 이하) 빌드가 만든 파일이다. 지금 Moments 는 유지된다.
       *
       * 경고로 알리는 이유: 사용자가 이 파일을 자신의 **완전한** 백업으로
       * 오인하지 않게 한다 (`BACKUP_FORMAT.md` §6-2-2).
       */
      readonly kind: 'moments-section-absent'
    }
  | { readonly kind: 'invalid-exported-at' }
  | { readonly kind: 'large-file'; readonly size: number }

/**
 * 파일의 Moments 섹션이 어떤 상태인가 (M9-5).
 *
 * | 값        | 뜻                                      | 가져오기                 |
 * | --------- | --------------------------------------- | ------------------------ |
 * | `absent`  | 키가 없다 (M9 이전 파일)                | 지금 Moments **유지**    |
 * | `skipped` | 있지만 읽을 수 없다 (형식·미래 버전)    | 지금 Moments **유지**    |
 * | `present` | 읽었다. **빈 배열일 수 있다**           | 그 목록으로 **교체**     |
 *
 * `absent` 와 "빈 배열" 을 섞지 않는 것이 M9 호환성의 전부다 (§6-2).
 */
export type MomentsSectionState = 'absent' | 'skipped' | 'present'

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
  /**
   * 가져올 수 있는 Moments (M9-5). `momentsSection` 이 `present` 일 때만
   * 값이 있고, **빈 배열일 수 있다.** 그 밖에는 `null` 이다.
   */
  readonly moments: MomentsData | null
  readonly momentsSection: MomentsSectionState
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

  // 섹션마다 따로 읽는다 (M9-5). 한쪽이 깨졌다고 다른 쪽 표시를 버리지 않는다.
  const library = readSectionIntegrity(value.library)
  const moments = readSectionIntegrity(value.moments)
  if (library === null && moments === null) return null

  const integrity: BackupIntegrity = {}
  if (library !== null) integrity.library = library
  if (moments !== null) integrity.moments = moments
  return integrity
}

function readSectionIntegrity(section: unknown): BackupSectionIntegrity | null {
  if (!isRecord(section)) return null
  if (section.level !== 'recovered' && section.level !== 'complete') return null
  if (!INTEGRITY_REASONS.includes(section.reason as BackupIntegrityReason)) return null

  return { level: section.level, reason: section.reason as BackupIntegrityReason }
}

/** 우리가 아는 섹션 이름. 그 밖은 "알 수 없는 섹션" 으로 알린다. */
const KNOWN_SECTIONS = new Set(['library', 'moments', 'preferences'])

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
  if (integrity?.moments?.level === 'recovered') {
    warnings.push({
      kind: 'recovered-backup',
      reason: integrity.moments.reason,
      section: 'moments',
    })
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

  /* ---------- moments (M9-5) ---------- */

  const { moments, momentsSection } = readMomentsSection(data, warnings)

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

  if (libraryData === null && theme === null && moments === null) {
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
    moments,
    momentsSection,
    warnings,
    counts: {
      playlists: playlists.length,
      tracks: playlists.reduce((total, playlist) => total + playlist.tracks.length, 0),
    },
  }
}

/**
 * `data.moments` 를 읽는다 (M9-5, `BACKUP_FORMAT.md` §6-2).
 *
 * **새 검증 규칙을 만들지 않는다.** 항목 검증은 `normalizeMomentsData` —
 * 저장소에서 읽을 때와 **같은 함수**다. 가져온 Moment 가 다음 새로고침에서
 * 버려지는 일이 없다.
 *
 * 건너뛰는 모든 경우에 지금 Moments 는 **그대로 남는다** (호출부가 `null` 을
 * 보고 쓰지 않는다). 섹션 버전이 미래면 추측해서 변환하지 않는다 (§3-3).
 */
function readMomentsSection(
  data: Record<string, unknown>,
  warnings: BackupWarning[],
): { moments: MomentsData | null; momentsSection: MomentsSectionState } {
  if (!('moments' in data)) {
    warnings.push({ kind: 'moments-section-absent' })
    return { moments: null, momentsSection: 'absent' }
  }

  const section = asSection(data.moments)
  if (section === null) {
    warnings.push({ kind: 'section-skipped', section: 'moments', reason: 'invalid' })
    return { moments: null, momentsSection: 'skipped' }
  }

  if (section.version !== BACKUP_SECTION_VERSIONS.moments) {
    warnings.push({
      kind: 'section-skipped',
      section: 'moments',
      reason: section.version > BACKUP_SECTION_VERSIONS.moments ? 'future-version' : 'old-version',
      version: section.version,
    })
    return { moments: null, momentsSection: 'skipped' }
  }

  const normalized = normalizeMomentsData(section.data)
  if (normalized === null) {
    // 배열이 아니다. 복구할 것이 없다 — 0개로 읽지 않는다.
    warnings.push({ kind: 'section-skipped', section: 'moments', reason: 'invalid' })
    return { moments: null, momentsSection: 'skipped' }
  }

  if (normalized.report.droppedMoments > 0) {
    warnings.push({
      kind: 'dropped-moments',
      count: normalized.report.droppedMoments,
      byReason: { ...normalized.report.droppedByReason },
    })
  }

  return { moments: normalized.data, momentsSection: 'present' }
}
