/**
 * 백업 객체 조립 (M8-2). **순수 함수다.**
 *
 * store 도, `localStorage` 도, 시계도 읽지 않는다. 받은 것만으로 만든다 —
 * 레이아웃 없는 환경에서 전수 검증할 수 있어야 하고(가시성 측정과 같은 이유),
 * "내보내기가 아무것도 바꾸지 않는다" 를 **구조로** 보장하기 위해서다.
 *
 * 필드를 **명시적으로 골라 담는다.** 객체를 그대로 복사하지 않는 이유:
 *
 * - 파일 스키마가 **의도된 것**이 된다. `Track` 에 세션용 필드가 생겨도
 *   파일에 새지 않는다
 * - 깊은 복사가 공짜로 따라온다. 뒤에 store 가 바뀌어도 만들어 둔 객체가
 *   흔들리지 않는다
 * - Vue 의 반응형 프록시가 결과에 섞이지 않는다
 *
 * 재생 큐·현재 트랙·플레이어·화면 상태는 **입력 자체에 없다.** 담지 않는 것이
 * 아니라 받지 않는다.
 */
import type { LibraryData, Moment, MomentsData, Playlist, ThemeKey, Track } from '@/shared/types'
import type { LibraryProtectedReason, LibraryStatus } from '@/stores/library'
import type { MomentsProtectedReason, MomentsStatus } from '@/stores/moments'

import {
  BACKUP_FORMAT,
  BACKUP_SCHEMA_VERSION,
  BACKUP_SECTION_VERSIONS,
  type BackupFile,
  type BackupIntegrity,
  type BackupSectionIntegrity,
} from './backupSchema'

/**
 * 조립에 필요한 입력.
 *
 * `DeepReadonly` 를 받지 않고 **구조만** 요구한다. store 의 읽기 전용 값도
 * 평범한 값도 그대로 넘길 수 있고, 테스트가 리터럴을 쓸 수 있다.
 */
export interface BackupSource {
  readonly library: {
    readonly playlists: readonly {
      readonly id: string
      readonly name: string
      readonly tracks: readonly {
        readonly id: string
        readonly source: Track['source']
        readonly videoId: string
        readonly title: string
      }[]
    }[]
    readonly selectedPlaylistId: string | null
  }
  /**
   * Music Moments (M9-5). **필수다** — 0개여도 빈 배열을 넘긴다.
   *
   * 선택으로 두면 호출부가 빠뜨렸을 때 섹션이 사라지고, 그 파일을 가져오는
   * 쪽은 "Moments 를 모르던 시절 파일" 로 읽어 지금 Moments 를 유지한다.
   * 사용자가 0개였다는 사실이 파일에서 사라진다. 그래서 타입이 막는다.
   */
  readonly moments: readonly {
    readonly id: string
    readonly source: Moment['source']
    readonly videoId: string
    readonly atSeconds: number
    readonly note: string
    readonly title: string
    readonly createdAt: string
    readonly updatedAt: string
  }[]
  readonly theme: ThemeKey
  /** 온전하지 않으면 넣는다. `null` 이면 온전한 백업이다. */
  readonly integrity: BackupIntegrity | null
  /** 내보낸 시각. **호출부가 준다** — 이 함수는 시계를 읽지 않는다. */
  readonly exportedAt: Date
}

/**
 * 저장소 상태를 파일의 온전성으로 옮긴다. 순수 함수다.
 *
 * | `status`      | 결과                                  |
 * | ------------- | ------------------------------------- |
 * | `ready`       | `null` — 온전하다                     |
 * | `protected`   | `recovered` + 보호 이유               |
 * | `unavailable` | `recovered` + `unavailable`           |
 *
 * **쓰기 실패(`lastWriteFailure`)는 복구본으로 보지 않는다.** 그 경우 메모리는
 * 저장소보다 **더** 온전하다 — 이번 세션의 변경이 저장되지 않았을 뿐이고,
 * 파일에는 그것까지 들어간다. 불완전한 쪽은 저장소이고 파일이 아니다.
 * (그래도 사용자에게는 알려야 한다. UI 의 몫이다.)
 */
export function resolveBackupIntegrity(input: {
  status: LibraryStatus
  protectedReason: LibraryProtectedReason | null
  /**
   * Moments 저장소 상태 (M9-5). 생략하면 온전한 것으로 본다 — M8 의 호출
   * 모양을 그대로 받기 위해서다. 앱의 두 내보내기 경로는 항상 넘긴다.
   */
  moments?: { status: MomentsStatus; protectedReason: MomentsProtectedReason | null }
}): BackupIntegrity | null {
  const library = resolveSectionIntegrity(input)
  const moments = input.moments === undefined ? null : resolveSectionIntegrity(input.moments)

  if (library === null && moments === null) return null

  // 온전한 섹션은 적지 않는다. 평범한 백업의 모양을 바꾸지 않는다.
  const integrity: BackupIntegrity = {}
  if (library !== null) integrity.library = library
  if (moments !== null) integrity.moments = moments
  return integrity
}

/**
 * 저장소 하나의 상태를 섹션 온전성으로 옮긴다 (M9-5 에서 뽑아냈다).
 *
 * 라이브러리와 Moments 가 **같은 규칙**을 쓴다 — 같은 정책(ADR 0007)이다.
 */
export function resolveSectionIntegrity(input: {
  status: LibraryStatus | MomentsStatus
  protectedReason: LibraryProtectedReason | MomentsProtectedReason | null
}): BackupSectionIntegrity | null {
  if (input.status === 'ready') return null

  return input.status === 'unavailable'
    ? { level: 'recovered', reason: 'unavailable' }
    : // 보호 상태인데 이유가 없는 조합은 store 가 만들지 않는다.
      // 그래도 방어적으로 `invalid` 로 둔다 — 복구본이라는 사실이 더 중요하다.
      { level: 'recovered', reason: input.protectedReason ?? 'invalid' }
}

function copyTrack(track: BackupSource['library']['playlists'][number]['tracks'][number]): Track {
  return { id: track.id, source: track.source, videoId: track.videoId, title: track.title }
}

function copyPlaylist(playlist: BackupSource['library']['playlists'][number]): Playlist {
  // 순서를 그대로 유지한다. 정렬하지 않는다.
  return { id: playlist.id, name: playlist.name, tracks: playlist.tracks.map(copyTrack) }
}

/**
 * Moment 하나를 **필드를 골라** 옮긴다. 화면 상태(고정해 둔 캡처, 쓰던 메모,
 * 거르기)는 입력에 없다 — store 의 영속 필드만 담긴다.
 */
function copyMoment(moment: BackupSource['moments'][number]): Moment {
  return {
    id: moment.id,
    source: moment.source,
    videoId: moment.videoId,
    atSeconds: moment.atSeconds,
    note: moment.note,
    title: moment.title,
    createdAt: moment.createdAt,
    updatedAt: moment.updatedAt,
  }
}

function copyMoments(moments: BackupSource['moments']): MomentsData {
  // 추가된 순서 그대로다. 정렬은 화면의 일이다 (ADR 0019 결정 5).
  return moments.map(copyMoment)
}

function copyLibrary(library: BackupSource['library']): LibraryData {
  return {
    playlists: library.playlists.map(copyPlaylist),
    selectedPlaylistId: library.selectedPlaylistId,
  }
}

/** 백업 파일 객체를 만든다. 어떤 것도 바꾸지 않는다. */
export function createBackup(source: BackupSource): BackupFile {
  const file: BackupFile = {
    format: BACKUP_FORMAT,
    schemaVersion: BACKUP_SCHEMA_VERSION,
    exportedAt: source.exportedAt.toISOString(),
    data: {
      library: {
        version: BACKUP_SECTION_VERSIONS.library,
        data: copyLibrary(source.library),
      },
      // 0개여도 넣는다 — "없음" 과 "비었음" 을 파일에서 구별한다 (§6-2).
      moments: {
        version: BACKUP_SECTION_VERSIONS.moments,
        data: copyMoments(source.moments),
      },
      preferences: {
        theme: { version: BACKUP_SECTION_VERSIONS.theme, data: source.theme },
      },
    },
  }

  // 온전하면 필드를 아예 넣지 않는다. 평범한 백업의 모양을 바꾸지 않는다.
  if (source.integrity !== null) file.integrity = source.integrity

  return file
}

/** 파일에 담긴 Moment 수 (M9-5). 섹션이 없으면 0 이다. */
export function countBackupMoments(file: BackupFile): number {
  return file.data.moments?.data.length ?? 0
}

/** 파일에 담긴 개수. 사용자 안내와 테스트에 쓴다. */
export function countBackupItems(file: BackupFile): { playlists: number; tracks: number } {
  const playlists = file.data.library.data.playlists
  return {
    playlists: playlists.length,
    tracks: playlists.reduce((total, playlist) => total + playlist.tracks.length, 0),
  }
}
