/**
 * 내보내기 뷰 모델 (M8-2).
 *
 * store 를 **읽기만** 하고, 조립과 내려받기는 순수 함수·경계 함수에 넘긴다.
 * 표현은 컴포넌트가 맡는다 (`AGENTS.md` 규칙 3).
 *
 * 이 composable 은 **아무것도 바꾸지 않는다.** store 액션을 부르지 않고
 * `localStorage` 를 만지지 않는다. 그것이 M8-2 의 요구사항이고 테스트로
 * 고정한다.
 *
 * 재생을 모른다 — `playback` store 도 `PlayerAdapter` 도 가져오지 않는다
 * (규칙 4). 백업 대상에 재생 큐가 없으므로 알 이유가 없다.
 */
import { computed, ref, type ComputedRef, type Ref } from 'vue'

import { useLibraryStore } from '@/stores/library'
import { useThemeStore } from '@/stores/theme'

import { countBackupItems, createBackup, resolveBackupIntegrity } from './createBackup'
import { backupFileName, downloadBackup, type DownloadFailureReason } from './downloadBackup'

/**
 * 파일이 평문이라는 고지. **항상 보인다.**
 *
 * 숨기지 않는다 — 플레이리스트 이름과 영상 ID 가 그대로 보이는 파일을
 * 사용자가 어디에 둘지는 사용자가 알고 결정해야 한다
 * (`BACKUP_RESTORE.md` §3-6).
 */
export const PLAINTEXT_NOTICE = '파일은 평문입니다. 플레이리스트 이름과 영상 ID 가 그대로 보입니다.'

/** 복구본이 되는 이유별 경고. */
const RECOVERY_WARNING: Record<string, string> = {
  'partial-recovery':
    '저장된 데이터를 일부만 읽었습니다. 지금 내보내면 읽지 못한 항목이 빠진 복구본이 됩니다.',
  malformed:
    '저장된 데이터를 읽지 못했습니다. 지금 내보내면 이번 세션의 내용만 담긴 복구본이 됩니다.',
  invalid:
    '저장된 데이터를 읽지 못했습니다. 지금 내보내면 이번 세션의 내용만 담긴 복구본이 됩니다.',
  'version-mismatch':
    '더 새 버전에서 저장된 데이터라 읽지 못했습니다. 지금 내보내면 이번 세션의 내용만 담긴 복구본이 됩니다.',
  unavailable: '저장소를 쓸 수 없습니다. 지금 내보내면 이번 세션의 내용만 담긴 복구본이 됩니다.',
}

const DOWNLOAD_FAILURE_MESSAGE: Record<DownloadFailureReason, string> = {
  'serialize-failed': '파일을 만들지 못했습니다.',
  unsupported: '이 브라우저에서는 파일을 내려받을 수 없습니다.',
  unknown: '내려받지 못했습니다. 다시 시도해주세요.',
}

export interface BackupExportModel {
  /** 지금 내보내면 복구본이 되는가. */
  isRecovery: ComputedRef<boolean>
  /**
   * 복구본 확인 단계가 열려 있는가.
   *
   * 온전한 상태에서는 쓰이지 않는다 — 바로 내려받는다.
   */
  needsConfirm: Readonly<Ref<boolean>>
  /** 복구본 경고. 온전하면 빈 문자열이다. */
  warning: ComputedRef<string>
  /**
   * 이번 세션의 변경이 저장되지 않았다는 사실.
   *
   * 복구본과 **다른 사정**이다. 이때 파일은 저장소보다 더 온전하므로
   * 내보내기가 오히려 권장된다.
   */
  unsavedNotice: ComputedRef<string>
  /** 결과 안내. 성공·실패 모두. */
  notice: Readonly<Ref<string>>
  /** 실패였는지. 어조를 가른다. */
  failed: Readonly<Ref<boolean>>
  /** 담길 개수. 버튼 옆에 적는다. */
  counts: ComputedRef<{ playlists: number; tracks: number }>
  /** 평문 고지. */
  plaintextNotice: string

  /** 내보내기 요청. 온전하면 바로, 아니면 확인 단계를 연다. */
  request(): void
  /** 확인 단계에서 계속한다. */
  confirm(): void
  /** 확인 단계를 닫는다. */
  cancel(): void
}

export function useBackupExport(): BackupExportModel {
  const library = useLibraryStore()
  const theme = useThemeStore()

  const needsConfirm = ref(false)
  const notice = ref('')
  const failed = ref(false)

  const integrity = computed(() =>
    resolveBackupIntegrity({
      status: library.status,
      protectedReason: library.protectedReason,
    }),
  )

  const isRecovery = computed<boolean>(() => integrity.value !== null)

  const warning = computed<string>(() => {
    const reason = integrity.value?.library?.reason
    return reason === undefined ? '' : (RECOVERY_WARNING[reason] ?? '')
  })

  const unsavedNotice = computed<string>(() =>
    library.lastWriteFailure === null
      ? ''
      : '이 세션의 변경이 저장되지 않았습니다. 지금 내보내면 파일에는 포함됩니다.',
  )

  const counts = computed(() => ({
    playlists: library.playlists.length,
    tracks: library.playlists.reduce((total, playlist) => total + playlist.tracks.length, 0),
  }))

  /** 실제로 만들고 내려받는다. store 를 읽을 뿐 바꾸지 않는다. */
  function run(): void {
    const now = new Date()
    const file = createBackup({
      library: {
        playlists: library.playlists,
        selectedPlaylistId: library.selectedPlaylistId,
      },
      theme: theme.current,
      integrity: integrity.value,
      exportedAt: now,
    })

    const result = downloadBackup(file, backupFileName(now))

    if (!result.ok) {
      failed.value = true
      notice.value = DOWNLOAD_FAILURE_MESSAGE[result.reason]
      return
    }

    const { playlists, tracks } = countBackupItems(file)
    failed.value = false
    notice.value = isRecovery.value
      ? `복구본 “${result.fileName}” 을 내려받았습니다. 플레이리스트 ${String(playlists)}개 · ${String(tracks)}곡.`
      : `“${result.fileName}” 을 내려받았습니다. 플레이리스트 ${String(playlists)}개 · ${String(tracks)}곡.`
  }

  function request(): void {
    notice.value = ''
    failed.value = false

    // 온전하지 않으면 **명시적 선택**을 거친다 (복구본임을 알고 받아야 한다).
    if (isRecovery.value) {
      needsConfirm.value = true
      return
    }

    run()
  }

  function confirm(): void {
    needsConfirm.value = false
    run()
  }

  function cancel(): void {
    needsConfirm.value = false
  }

  return {
    isRecovery,
    needsConfirm,
    warning,
    unsavedNotice,
    notice,
    failed,
    counts,
    plaintextNotice: PLAINTEXT_NOTICE,
    request,
    confirm,
    cancel,
  }
}
