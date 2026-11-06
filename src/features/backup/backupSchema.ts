/**
 * 백업 파일 스키마 (M8-2).
 *
 * 규범 문서는 `docs/architecture/BACKUP_FORMAT.md` 이고 결정 근거는
 * **ADR 0018** 이다. 이 파일은 그 문서의 타입 표현이며, 문서와 어긋나면
 * 문서가 기준이다.
 *
 * **섹션은 저장 봉투를 그대로 품는다** (ADR 0018 결정 2). `data.library` 는
 * `39page.library` 에 들어가는 값과 같은 모양이고, 그래서 가져오기(M8-3)가
 * 기존 검증기 `normalizeLibraryData` 를 그대로 쓸 수 있다.
 *
 * 섹션 버전을 **상수로 다시 적지 않고 store 에서 가져온다.** 다시 적으면
 * 내부 스키마를 올릴 때 한쪽만 바뀌어 조용히 어긋난다.
 */
import type { LibraryData, ThemeKey } from '@/shared/types'
import { LIBRARY_STORAGE_VERSION, type LibraryProtectedReason } from '@/stores/library'
import { THEME_STORAGE_VERSION } from '@/stores/theme'

/** 파일 식별자. 이 값이 아니면 파싱된 JSON 이라도 우리 파일이 아니다. */
export const BACKUP_FORMAT = '39page-backup'

/**
 * 파일 **구조** 버전. 섹션 내용 스키마와 별개다 (`BACKUP_FORMAT.md` §2-3).
 *
 * 선택 섹션·선택 필드를 더하는 것은 이 값을 올리지 않는다 (§3-2).
 */
export const BACKUP_SCHEMA_VERSION = 1

/** 섹션 버전. 내부 저장 버전과 **같은 값**이다. */
export const BACKUP_SECTION_VERSIONS = {
  library: LIBRARY_STORAGE_VERSION,
  theme: THEME_STORAGE_VERSION,
} as const

/** 섹션 봉투. `defineStorage` 의 `StorageEnvelope` 와 같은 모양이다. */
export interface BackupSection<T> {
  version: number
  data: T
}

/** 스냅샷이 온전한지. 없으면 `complete` 로 본다. */
export type BackupIntegrityLevel = 'complete' | 'recovered'

/**
 * 복구본이 된 이유.
 *
 * `LibraryProtectedReason` 네 가지에 `unavailable` 을 더한 것이다. 저장소
 * 자체를 쓸 수 없으면 보호 상태가 아니지만, 그때도 파일에는 이번 세션의
 * 내용만 들어간다.
 */
export type BackupIntegrityReason = LibraryProtectedReason | 'unavailable'

export interface BackupSectionIntegrity {
  level: BackupIntegrityLevel
  reason: BackupIntegrityReason
}

/**
 * 섹션별 온전성 (M8-2 에서 추가한 **선택 필드**).
 *
 * 왜 필요한가: 저장된 원본을 온전히 읽지 못한 상태에서도 내보낼 수 있어야
 * 한다 — 그때가 백업이 가장 필요한 순간이다. 다만 그 파일을 나중에 **온전한
 * 전체 백업으로 오인하면** 사용자가 잃은 것을 모르고 덮어쓸 수 있다.
 *
 * 선택 필드이므로 파일 버전을 올리지 않는다 (`BACKUP_FORMAT.md` §3-2).
 * 온전할 때는 **필드 자체를 넣지 않는다** — 평범한 백업의 모양을 바꾸지 않는다.
 */
export interface BackupIntegrity {
  library?: BackupSectionIntegrity
}

export interface BackupPreferences {
  theme?: BackupSection<ThemeKey>
}

export interface BackupData {
  library: BackupSection<LibraryData>
  preferences?: BackupPreferences
}

/** 백업 파일 한 개. 이 객체를 JSON 으로 직렬화한 것이 파일이다. */
export interface BackupFile {
  format: typeof BACKUP_FORMAT
  schemaVersion: number
  /** ISO 8601 UTC. 정보용이며 가져오기 판단에 쓰지 않는다. */
  exportedAt: string
  /** 온전하지 않을 때만 들어간다. */
  integrity?: BackupIntegrity
  data: BackupData
}
