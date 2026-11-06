/**
 * 가져오기 뷰 모델 (M8-3).
 *
 * 세 단계를 상태로 갖는다 — `idle` → `preview` → 결과. 표현은 컴포넌트가
 * 맡는다 (`AGENTS.md` 규칙 3).
 *
 * **가장 중요한 성질: 사용자가 `apply()` 를 부르기 전까지 store 도
 * `localStorage` 도 쓰지 않는다.** 파일 선택·파싱·검증·미리보기·취소가 모두
 * 읽기 전용이다 (ADR 0018 결정 5). 해석은 순수 함수(`readBackup`)가 하고,
 * 이 composable 은 **읽은 결과를 들고 있을 뿐**이다.
 *
 * 복원은 **공식 store API**로만 한다. `localStorage` 를 직접 쓰지 않는다
 * (`SYSTEM_DESIGN.md` §7.4).
 */
import { computed, inject, ref, type ComputedRef, type Ref } from 'vue'

import { PLAYBACK_COORDINATOR } from '@/features/playback/playbackCoordinator'
import type { ThemeKey } from '@/shared/types'
import { libraryStorage, useLibraryStore } from '@/stores/library'
import { themeStorage, useThemeStore } from '@/stores/theme'

import { createBackup, resolveBackupIntegrity } from './createBackup'
import { backupFileName, downloadText, rawDumpFileName } from './downloadBackup'
import {
  checkBackupSize,
  readBackup,
  type BackupReadError,
  type BackupReadSuccess,
  type BackupWarning,
} from './readBackup'

/** 섹션이 어떻게 되는지. 미리보기에 그대로 적는다. */
export interface SectionPlan {
  readonly name: string
  readonly action: 'replace' | 'keep'
  readonly note: string
}

export interface ImportPreview {
  readonly schemaVersion: number
  readonly exportedAt: string | null
  /** 복구본이면 그 사유. 아니면 `null`. */
  readonly recovered: BackupWarning | null
  /** 가져올 라이브러리 개수. 섹션을 건너뛰었으면 `null`. */
  readonly incoming: { readonly playlists: number; readonly tracks: number } | null
  readonly current: { readonly playlists: number; readonly tracks: number }
  readonly incomingTheme: ThemeKey | null
  readonly currentTheme: ThemeKey
  readonly sections: readonly SectionPlan[]
  readonly warnings: readonly BackupWarning[]
  /** 읽지 못한 원본을 덮어쓰게 되는가. */
  readonly overwritesProtected: boolean
  /** 원문을 꺼낼 수 있는가. 보호 상태에서만 뜻이 있다. */
  readonly rawAvailable: boolean
  /** 막은 이유. `null` 이면 진행할 수 있다. */
  readonly blocked: string | null
}

export type ImportStage = 'idle' | 'preview'

const READ_ERROR_MESSAGE: Record<BackupReadError['kind'], string> = {
  'too-large': '파일이 너무 큽니다 (최대 8 MB).',
  'not-json': 'JSON 파일이 아닙니다.',
  'not-backup': '39page 백업 파일이 아닙니다.',
  'unsupported-version': '더 새 버전의 39page 에서 만든 파일입니다. 최신 39page 에서 가져오세요.',
  'missing-field': '백업 파일의 필수 항목이 없습니다.',
  'nothing-importable': '이 버전에서 가져올 수 있는 항목이 없습니다.',
}

/** 경고를 사람이 읽는 한 줄로. */
export function describeWarning(warning: BackupWarning): string {
  switch (warning.kind) {
    case 'dropped-playlists':
      return `플레이리스트 ${String(warning.count)}개를 가져올 수 없습니다 (형식 오류).`
    case 'dropped-tracks':
      return `트랙 ${String(warning.count)}곡을 가져올 수 없습니다 (영상 ID 형식 오류).`
    case 'repaired-selection':
      return '선택된 플레이리스트가 없어 첫 목록을 고릅니다.'
    case 'section-skipped':
      return `${warning.section} 을 건너뜁니다 (${
        warning.reason === 'future-version'
          ? '더 새 버전'
          : warning.reason === 'old-version'
            ? '이전 버전'
            : '형식 오류'
      }).`
    case 'unknown-section':
      return `이 버전에서 다루지 않는 항목이 있습니다: ${warning.section}.`
    case 'recovered-backup':
      return '이 파일은 **복구본**입니다. 온전한 전체 백업이 아니며 일부 항목이 빠져 있을 수 있습니다.'
    case 'invalid-exported-at':
      return '내보낸 시각을 읽을 수 없습니다.'
    case 'large-file':
      return `파일이 큽니다 (${String(Math.round(warning.size / 1024 / 1024))} MB). 저장 공간이 부족할 수 있습니다.`
  }
}

export interface BackupImportModel {
  stage: Readonly<Ref<ImportStage>>
  preview: ComputedRef<ImportPreview | null>
  /** 결과·오류 안내. */
  notice: Readonly<Ref<string>>
  failed: Readonly<Ref<boolean>>
  /** 설정(테마)을 함께 적용할지. 사용자가 끌 수 있다. */
  applyTheme: Ref<boolean>
  /** 미리보기를 뜬 뒤 현재 데이터가 바뀌었다. 다시 확인해야 한다. */
  stale: Readonly<Ref<boolean>>

  /** 파일을 받아 검증하고 미리보기를 만든다. **아무것도 쓰지 않는다.** */
  selectFile(file: File): Promise<void>
  /** 미리보기를 닫는다. **아무것도 쓰지 않는다.** */
  cancel(): void
  /** 지금 데이터를 먼저 파일로 꺼낸다 (M8-2 재사용). */
  exportCurrentFirst(): void
  /** 읽지 못한 원본을 원문 그대로 꺼낸다. */
  downloadRawOriginal(): void
  /** 승인. 여기서 **처음** 쓴다. */
  apply(): void
}

/** 현재 데이터의 지문. 미리보기 승인이 낡았는지 본다. */
interface Fingerprint {
  readonly store: string
  readonly rawLibrary: string | null
  readonly rawTheme: string | null
}

export function useBackupImport(): BackupImportModel {
  const library = useLibraryStore()
  const theme = useThemeStore()
  const playback = inject(PLAYBACK_COORDINATOR, null)

  const stage = ref<ImportStage>('idle')
  const notice = ref('')
  const failed = ref(false)
  const applyTheme = ref(true)
  const stale = ref(false)

  /** 읽은 파일. 반응형 상태에 두지만 **store 가 아니다.** */
  const read = ref<BackupReadSuccess | null>(null)
  let fingerprint: Fingerprint | null = null

  /**
   * 지금 데이터의 지문을 뜬다.
   *
   * store 상태와 **저장소 원문**을 함께 본다. 다른 탭이 저장소를 바꾸면 이
   * store 는 알지 못하므로(`storage` 이벤트를 듣지 않는다) store 만 보면
   * 놓친다.
   */
  function takeFingerprint(): Fingerprint {
    return {
      store: JSON.stringify({
        playlists: library.playlists,
        selectedPlaylistId: library.selectedPlaylistId,
        theme: theme.current,
      }),
      rawLibrary: libraryStorage.raw(),
      rawTheme: themeStorage.raw(),
    }
  }

  function sameFingerprint(a: Fingerprint, b: Fingerprint): boolean {
    return a.store === b.store && a.rawLibrary === b.rawLibrary && a.rawTheme === b.rawTheme
  }

  const currentCounts = computed(() => ({
    playlists: library.playlists.length,
    tracks: library.playlists.reduce((total, playlist) => total + playlist.tracks.length, 0),
  }))

  const preview = computed<ImportPreview | null>(() => {
    const file = read.value
    if (file === null) return null

    const recovered = file.warnings.find((warning) => warning.kind === 'recovered-backup') ?? null

    /*
     * 보호 상태의 원본을 덮어쓰는가.
     *
     * 라이브러리를 교체할 때만 해당한다 — 테마만 적용하면 원본은 그대로다.
     */
    const overwritesProtected = file.library !== null && library.status === 'protected'
    const rawAvailable = libraryStorage.raw() !== null

    /*
     * 안전한 복원을 보장할 수 없으면 **막는다.**
     *
     * 보호 상태인데 저장소에 접근할 수 없다면 원본을 꺼내 줄 수도, 덮어쓸
     * 수도 없다. 그 상태로 진행하면 "복원했다" 고 말하면서 아무것도 하지
     * 못한다 — 실패를 성공으로 표시하지 않기 위해 미리 막는다.
     */
    const blocked =
      overwritesProtected && !libraryStorage.available()
        ? '저장소에 접근할 수 없어 읽지 못한 원본을 안전하게 다룰 수 없습니다. 원본을 꺼낼 수도, 덮어쓸 수도 없으므로 가져오기를 막았습니다.'
        : null

    const sections: SectionPlan[] = [
      file.library === null
        ? {
            name: '플레이리스트',
            action: 'keep',
            note: '파일에서 가져올 수 없어 지금 것을 유지합니다',
          }
        : {
            name: '플레이리스트',
            action: 'replace',
            note: '지금 목록을 파일의 것으로 **교체**합니다',
          },
      file.theme === null
        ? { name: '테마', action: 'keep', note: '파일에 쓸 수 있는 테마가 없습니다' }
        : applyTheme.value
          ? { name: '테마', action: 'replace', note: '파일의 테마를 적용합니다' }
          : { name: '테마', action: 'keep', note: '적용하지 않도록 껐습니다' },
    ]

    return {
      schemaVersion: file.schemaVersion,
      exportedAt: file.exportedAt,
      recovered,
      incoming: file.library === null ? null : file.counts,
      current: currentCounts.value,
      incomingTheme: file.theme,
      currentTheme: theme.current,
      sections,
      warnings: file.warnings,
      overwritesProtected,
      rawAvailable,
      blocked,
    }
  })

  function reset(): void {
    stage.value = 'idle'
    read.value = null
    stale.value = false
    fingerprint = null
  }

  async function selectFile(file: File): Promise<void> {
    notice.value = ''
    failed.value = false
    reset()

    // 읽기 전에 크기를 본다. 넘으면 파싱조차 하지 않는다.
    const tooLarge = checkBackupSize(file.size)
    if (tooLarge !== null) {
      failed.value = true
      notice.value = READ_ERROR_MESSAGE[tooLarge.kind]
      return
    }

    let text: string
    try {
      text = await file.text()
    } catch {
      failed.value = true
      notice.value = '파일을 읽지 못했습니다.'
      return
    }

    const result = readBackup(text, file.size)
    if (!result.ok) {
      failed.value = true
      notice.value = READ_ERROR_MESSAGE[result.error.kind]
      return
    }

    read.value = result
    fingerprint = takeFingerprint()
    stage.value = 'preview'
  }

  function cancel(): void {
    reset()
    notice.value = ''
    failed.value = false
  }

  /**
   * 지금 데이터를 먼저 꺼낸다 (M8-2 재사용).
   *
   * 조립 규칙은 `createBackup` 한 곳에만 있다. 여기서는 지금 store 상태를
   * 그 함수에 넘겨 받은 객체를 내려받을 뿐이다.
   */
  function exportCurrentFirst(): void {
    const now = new Date()
    const file = createBackup({
      library: { playlists: library.playlists, selectedPlaylistId: library.selectedPlaylistId },
      theme: theme.current,
      integrity: resolveBackupIntegrity({
        status: library.status,
        protectedReason: library.protectedReason,
      }),
      exportedAt: now,
    })

    const result = downloadText(JSON.stringify(file, null, 2), backupFileName(now))
    notice.value = result.ok
      ? `지금 데이터를 “${result.fileName}” 으로 내려받았습니다.`
      : '지금 데이터를 내려받지 못했습니다.'
    failed.value = !result.ok
  }

  /** 읽지 못한 원본을 원문 그대로 꺼낸다. 우리가 해석 못 해도 사용자는 보관할 수 있다. */
  function downloadRawOriginal(): void {
    const raw = libraryStorage.raw()
    if (raw === null) {
      failed.value = true
      notice.value = '저장된 원문을 꺼낼 수 없습니다.'
      return
    }

    const result = downloadText(raw, rawDumpFileName(new Date()))
    notice.value = result.ok
      ? `읽지 못한 원본을 “${result.fileName}” 으로 내려받았습니다.`
      : '원본을 내려받지 못했습니다.'
    failed.value = !result.ok
  }

  function apply(): void {
    const file = read.value
    if (file === null) return

    const current = preview.value
    if (current?.blocked != null) {
      failed.value = true
      notice.value = current.blocked
      return
    }

    /*
     * 미리보기 이후 데이터가 바뀌었는가 (요구 4-3).
     *
     * 낡은 승인으로 새 데이터를 덮어쓰지 않는다. 지문을 새로 떠서 다시
     * 확인하게 한다 — 미리보기는 그대로 두므로 사용자가 비교한 뒤 다시 누를 수
     * 있다.
     */
    const now = takeFingerprint()
    if (fingerprint !== null && !sameFingerprint(fingerprint, now)) {
      fingerprint = now
      stale.value = true
      failed.value = true
      notice.value =
        '미리보기를 뜬 뒤 지금 데이터가 바뀌었습니다. 아래 내용을 다시 확인하고 눌러주세요.'
      return
    }
    stale.value = false

    const applied: string[] = []
    const skipped: string[] = []
    let hadFailure = false

    /* ---------- 라이브러리 (가치가 큰 것부터) ---------- */

    if (file.library !== null) {
      const result = library.replaceAll(file.library)

      if (result.persisted) {
        applied.push(
          `플레이리스트 ${String(file.counts.playlists)}개 · ${String(file.counts.tracks)}곡`,
        )
      } else {
        hadFailure = true
        skipped.push(
          result.writeFailure === 'quota-exceeded'
            ? '플레이리스트 (저장 공간 부족 — 이번 세션에만 반영)'
            : '플레이리스트 (저장 실패 — 이번 세션에만 반영)',
        )
      }

      /*
       * 라이브러리가 통째로 바뀌었으면 재생을 멈추고 큐를 비운다 (M8-3).
       *
       * 메모리 반영은 성공했으므로 저장 실패와 무관하게 알린다 — 큐가 가리키는
       * 라이브러리가 사라진 것은 저장 성공 여부와 상관없는 사실이다.
       */
      playback?.libraryReplaced()
    } else {
      skipped.push('플레이리스트 (파일에서 가져올 수 없음)')
    }

    /* ---------- 테마 (최선 노력) ---------- */

    if (file.theme !== null && applyTheme.value) {
      const saved = theme.setTheme(file.theme)
      if (saved) {
        applied.push(`테마 ${file.theme}`)
      } else {
        hadFailure = true
        skipped.push('테마 (적용은 됐지만 저장 실패)')
      }
    } else if (file.theme !== null) {
      skipped.push('테마 (적용하지 않도록 껐음)')
    }

    /* ---------- 결과 ---------- */

    failed.value = hadFailure
    const head = hadFailure ? '일부만 복원했습니다.' : '복원했습니다.'
    const appliedText = applied.length === 0 ? '' : ` 반영: ${applied.join(' · ')}.`
    const skippedText = skipped.length === 0 ? '' : ` 반영되지 않음: ${skipped.join(' · ')}.`
    notice.value = `${head}${appliedText}${skippedText}`

    reset()
  }

  return {
    stage,
    preview,
    notice,
    failed,
    applyTheme,
    stale,
    selectFile,
    cancel,
    exportCurrentFirst,
    downloadRawOriginal,
    apply,
  }
}
