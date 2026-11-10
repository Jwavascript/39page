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
 *
 * M9-5 에서 Music Moments 를 더했다 (`BACKUP_FORMAT.md` §6).
 *
 * - 파일에 섹션이 **없으면** 지금 Moments 를 유지하고, **비었으면** 0개로
 *   교체한다. 둘을 섞지 않는 것이 M9 호환성의 전부다
 * - 쓰는 순서는 플레이리스트 → Moments → 테마. 플레이리스트를 교체했는데 저장이
 *   실패하면 Moments 는 **보류**한다 — 새로고침하면 "옛 목록 + 새 Moments" 가
 *   섞여 남는 일을 만들지 않는다 (`IMPLEMENTATION_PLAN.md` M9-5)
 * - 섹션마다 결과를 따로 돌려준다. 하나라도 저장되지 않았으면 "복원했습니다" 라고
 *   말하지 않는다
 */
import { computed, inject, ref, type ComputedRef, type Ref } from 'vue'

import { PLAYBACK_COORDINATOR } from '@/features/playback/playbackCoordinator'
import type { LibraryData, MomentsData, ThemeKey } from '@/shared/types'
import { libraryStorage, useLibraryStore } from '@/stores/library'
import { momentsStorage, useMomentsStore, type MomentDropReason } from '@/stores/moments'
import { themeStorage, useThemeStore } from '@/stores/theme'

import { createBackup, resolveBackupIntegrity } from './createBackup'
import {
  backupFileName,
  downloadText,
  rawDumpFileName,
  rawMomentsDumpFileName,
} from './downloadBackup'
import {
  checkBackupSize,
  readBackup,
  type BackupReadError,
  type BackupReadSuccess,
  type BackupWarning,
  type MomentsSectionState,
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
  /** 지금 Moment 수 (M9-5). */
  readonly currentMoments: number
  /** 가져올 Moment 수. 섹션이 `present` 일 때만 숫자이고 **0 일 수 있다.** */
  readonly incomingMoments: number | null
  readonly momentsSection: MomentsSectionState
  /**
   * 승인하면 교체되는 지금 데이터 (M9-5). 사용자가 무엇을 잃는지 한 줄씩 적는다.
   * 비어 있으면 교체되는 것이 없다 (예: 테마만 다르고 나머지는 유지).
   */
  readonly replacing: readonly string[]
  readonly sections: readonly SectionPlan[]
  readonly warnings: readonly BackupWarning[]
  /** 읽지 못한 원본을 덮어쓰게 되는가. */
  readonly overwritesProtected: boolean
  /** 원문을 꺼낼 수 있는가. 보호 상태에서만 뜻이 있다. */
  readonly rawAvailable: boolean
  /** 읽지 못한 **Moments** 원본을 덮어쓰게 되는가 (M9-5). 라이브러리와 따로다. */
  readonly overwritesProtectedMoments: boolean
  readonly rawMomentsAvailable: boolean
  /** 막은 이유. `null` 이면 진행할 수 있다. */
  readonly blocked: string | null
}

export type ImportStage = 'idle' | 'preview'

/**
 * 섹션 하나의 적용 결과 (M9-5).
 *
 * | 값        | 뜻                                                            |
 * | --------- | ------------------------------------------------------------- |
 * | `saved`   | 반영했고 저장했고 다시 읽어 확인했다                          |
 * | `unsaved` | 화면에는 반영했지만 저장되지 않았다 — 새로고침하면 사라진다   |
 * | `held`    | 반영하지 않았다 — 앞 섹션이 저장되지 않아 미뤘다              |
 * | `kept`    | 파일에 없어 지금 것을 그대로 두었다 (실패가 아니다)          |
 * | `skipped` | 파일에 있지만 가져오지 않았다 (읽을 수 없음 · 사용자가 끔)    |
 */
export type SectionOutcome = 'saved' | 'unsaved' | 'held' | 'kept' | 'skipped'

export interface SectionResult {
  readonly name: string
  readonly outcome: SectionOutcome
  readonly detail: string
}

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
      return `${warning.section === 'moments' ? 'Moments' : warning.section} 을 건너뜁니다 (${
        warning.reason === 'future-version'
          ? '더 새 버전'
          : warning.reason === 'old-version'
            ? '이전 버전'
            : '형식 오류'
      }).`
    case 'unknown-section':
      return `이 버전에서 다루지 않는 항목이 있습니다: ${warning.section}.`
    case 'recovered-backup':
      return warning.section === 'moments'
        ? '이 파일의 Moments 는 복구본입니다. 일부 Moment 가 빠져 있을 수 있습니다.'
        : '이 파일은 **복구본**입니다. 온전한 전체 백업이 아니며 일부 항목이 빠져 있을 수 있습니다.'
    case 'dropped-moments':
      return `Moment ${String(warning.count)}개를 가져올 수 없습니다 — ${describeDropReasons(warning.byReason)}.`
    case 'moments-section-absent':
      return 'Moments 가 생기기 전에 만든 파일입니다. 복원해도 지금의 Moment 는 지워지지 않고 그대로 남습니다. 이 파일에는 Moment 가 없으므로, 이것만으로는 Moment 를 다른 기기로 옮길 수 없습니다.'
    case 'invalid-exported-at':
      return '내보낸 시각을 읽을 수 없습니다.'
    case 'large-file':
      /*
       * 실측 (Chromium 155, 7.68 MB · 30,000곡): 적용에 약 2.3초가 걸렸다.
       * "몇 초" 는 추정이 아니라 잰 값에서 나온 말이다.
       */
      return `파일이 큽니다 (${String(Math.round(warning.size / 1024 / 1024))} MB). 가져오는 데 몇 초 걸릴 수 있고, 저장 공간이 부족할 수 있습니다.`
  }
}

/** 버린 이유별 개수를 한 줄로. 0 인 이유는 적지 않는다. */
const DROP_REASON_LABEL: Readonly<Record<MomentDropReason, string>> = {
  shape: '형식 오류',
  'video-id': '영상 ID 오류',
  time: '시점 오류',
  'duplicate-id': '중복 id',
}

function describeDropReasons(byReason: Readonly<Record<MomentDropReason, number>>): string {
  return (Object.keys(DROP_REASON_LABEL) as MomentDropReason[])
    .filter((reason) => byReason[reason] > 0)
    .map((reason) => `${DROP_REASON_LABEL[reason]} ${String(byReason[reason])}개`)
    .join(' · ')
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
  /**
   * 화면에는 복원됐지만 **저장되지 않은** 상태 (M8-4).
   *
   * 새로고침하면 사라진다. 사용자가 이것을 영구 복원 성공으로 오인하면
   * 데이터를 잃는다 — 그래서 안내를 띄우고 다음 행동을 제공한다.
   */
  unsaved: Readonly<Ref<boolean>>
  /**
   * 마지막 적용의 섹션별 결과 (M9-5). 플레이리스트 · Moments · 테마를 **따로**
   * 보고한다. 적용 전에는 비어 있다.
   */
  results: Readonly<Ref<readonly SectionResult[]>>

  /** 파일을 받아 검증하고 미리보기를 만든다. **아무것도 쓰지 않는다.** */
  selectFile(file: File): Promise<void>
  /** 미리보기를 닫는다. **아무것도 쓰지 않는다.** */
  cancel(): void
  /** 지금 데이터를 먼저 파일로 꺼낸다 (M8-2 재사용). */
  exportCurrentFirst(): void
  /** 읽지 못한 원본을 원문 그대로 꺼낸다. */
  downloadRawOriginal(): void
  /** 읽지 못한 Moments 원본을 원문 그대로 꺼낸다 (M9-5). */
  downloadRawMoments(): void
  /** 승인. 여기서 **처음** 쓴다. */
  apply(): void
  /** 저장에 실패한 것을 다시 저장해 본다 (M8-4). */
  retrySave(): void
}

/** 현재 데이터의 지문. 미리보기 승인이 낡았는지 본다. */
interface Fingerprint {
  readonly store: string
  readonly rawLibrary: string | null
  readonly rawTheme: string | null
  /** M9-5. 다른 탭이 Moments 를 바꿔도 낡은 승인으로 덮어쓰지 않는다. */
  readonly rawMoments: string | null
}

export function useBackupImport(): BackupImportModel {
  const library = useLibraryStore()
  const moments = useMomentsStore()
  const theme = useThemeStore()
  const playback = inject(PLAYBACK_COORDINATOR, null)

  const stage = ref<ImportStage>('idle')
  const notice = ref('')
  const failed = ref(false)
  const applyTheme = ref(true)
  const stale = ref(false)

  /**
   * 저장에 실패해 **메모리에만** 남은 것 (M8-4).
   *
   * 다시 저장을 시도할 수 있게 들고 있는다. 저장되면 비운다.
   */
  const pending = ref<{
    library: LibraryData | null
    moments: MomentsData | null
    theme: ThemeKey | null
  } | null>(null)
  const unsaved = computed<boolean>(() => pending.value !== null)
  const results = ref<readonly SectionResult[]>([])

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
        moments: moments.moments,
      }),
      rawLibrary: libraryStorage.raw(),
      rawTheme: themeStorage.raw(),
      rawMoments: momentsStorage.raw(),
    }
  }

  function sameFingerprint(a: Fingerprint, b: Fingerprint): boolean {
    return (
      a.store === b.store &&
      a.rawLibrary === b.rawLibrary &&
      a.rawTheme === b.rawTheme &&
      a.rawMoments === b.rawMoments
    )
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
     * Moments 도 같은 정책이다 (M9-5, ADR 0007). 섹션이 `present` 일 때만 교체가
     * 일어나므로 그때만 원본을 덮어쓴다. 섹션이 없거나 건너뛰면 원본은 그대로다.
     */
    const overwritesProtectedMoments = file.moments !== null && moments.status === 'protected'
    const rawMomentsAvailable = momentsStorage.raw() !== null

    /*
     * 안전한 복원을 보장할 수 없으면 **막는다.**
     *
     * 보호 상태인데 저장소에 접근할 수 없다면 원본을 꺼내 줄 수도, 덮어쓸
     * 수도 없다. 그 상태로 진행하면 "복원했다" 고 말하면서 아무것도 하지
     * 못한다 — 실패를 성공으로 표시하지 않기 위해 미리 막는다.
     */
    const blocked =
      (overwritesProtected && !libraryStorage.available()) ||
      (overwritesProtectedMoments && !momentsStorage.available())
        ? '저장소에 접근할 수 없어 읽지 못한 원본을 안전하게 다룰 수 없습니다. 원본을 꺼낼 수도, 덮어쓸 수도 없으므로 가져오기를 막았습니다.'
        : null

    const currentMoments = moments.count
    const incomingMoments = file.moments === null ? null : file.moments.length

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
      momentsPlan(file.momentsSection, currentMoments, incomingMoments),
      file.theme === null
        ? { name: '테마', action: 'keep', note: '파일에 쓸 수 있는 테마가 없습니다' }
        : applyTheme.value
          ? { name: '테마', action: 'replace', note: '파일의 테마를 적용합니다' }
          : { name: '테마', action: 'keep', note: '적용하지 않도록 껐습니다' },
    ]

    const replacing: string[] = []
    if (file.library !== null) {
      replacing.push(
        `플레이리스트 ${String(currentCounts.value.playlists)}개 · ${String(currentCounts.value.tracks)}곡`,
      )
    }
    if (incomingMoments !== null) {
      replacing.push(
        incomingMoments === 0
          ? `Moment ${String(currentMoments)}개 — 파일에는 0개라 모두 지워집니다`
          : `Moment ${String(currentMoments)}개`,
      )
    }

    return {
      schemaVersion: file.schemaVersion,
      exportedAt: file.exportedAt,
      recovered,
      incoming: file.library === null ? null : file.counts,
      current: currentCounts.value,
      incomingTheme: file.theme,
      currentTheme: theme.current,
      currentMoments,
      incomingMoments,
      momentsSection: file.momentsSection,
      replacing,
      sections,
      warnings: file.warnings,
      overwritesProtected,
      rawAvailable,
      overwritesProtectedMoments,
      rawMomentsAvailable,
      blocked,
    }
  })

  /**
   * 미리보기의 Moments 줄 (M9-5, `BACKUP_FORMAT.md` §6-2).
   *
   * 셋을 섞지 않는다 — 파일에 **없음**(유지), **읽을 수 없음**(유지), **있음**
   * (교체, 0개일 수 있다).
   */
  function momentsPlan(
    state: MomentsSectionState,
    current: number,
    incoming: number | null,
  ): SectionPlan {
    if (state === 'absent') {
      return {
        name: 'Moments',
        action: 'keep',
        note: `파일에 없습니다 (Moments 이전 파일) — 지금 Moment ${String(current)}개를 그대로 둡니다`,
      }
    }
    if (state === 'skipped' || incoming === null) {
      return {
        name: 'Moments',
        action: 'keep',
        note: `파일의 Moments 를 읽을 수 없어 지금 Moment ${String(current)}개를 그대로 둡니다`,
      }
    }
    return {
      name: 'Moments',
      action: 'replace',
      note:
        incoming === 0
          ? `지금 Moment ${String(current)}개를 **0개로** 교체합니다 (파일의 Moments 가 비어 있습니다)`
          : `지금 Moment ${String(current)}개를 파일의 ${String(incoming)}개로 **교체**합니다`,
    }
  }

  function reset(): void {
    stage.value = 'idle'
    read.value = null
    stale.value = false
    fingerprint = null
  }

  async function selectFile(file: File): Promise<void> {
    notice.value = ''
    failed.value = false
    results.value = []
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
    results.value = []
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
      moments: moments.moments,
      theme: theme.current,
      integrity: resolveBackupIntegrity({
        status: library.status,
        protectedReason: library.protectedReason,
        moments: { status: moments.status, protectedReason: moments.protectedReason },
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

  /** 읽지 못한 Moments 원본을 원문 그대로 꺼낸다 (M9-5). */
  function downloadRawMoments(): void {
    const raw = momentsStorage.raw()
    if (raw === null) {
      failed.value = true
      notice.value = '저장된 Moments 원문을 꺼낼 수 없습니다.'
      return
    }

    const result = downloadText(raw, rawMomentsDumpFileName(new Date()))
    notice.value = result.ok
      ? `읽지 못한 Moments 원본을 “${result.fileName}” 으로 내려받았습니다.`
      : 'Moments 원본을 내려받지 못했습니다.'
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

    const outcome = write({
      library: file.library,
      moments: file.moments,
      theme: applyTheme.value ? file.theme : null,
    })

    // 파일에서 가져오지 않은 것도 결과에 적는다. 조용히 빠뜨리지 않는다.
    if (file.library === null) {
      outcome.results.unshift({
        name: '플레이리스트',
        outcome: 'skipped',
        detail: '파일에서 가져올 수 없음',
      })
    }
    if (file.momentsSection === 'absent') {
      outcome.results.push({
        name: 'Moments',
        outcome: 'kept',
        detail: `파일에 없음 — 지금 Moment ${String(moments.count)}개 유지`,
      })
    } else if (file.momentsSection === 'skipped') {
      outcome.results.push({
        name: 'Moments',
        outcome: 'skipped',
        detail: '파일의 Moments 를 읽을 수 없음 — 지금 것 유지',
      })
    }
    if (file.theme !== null && !applyTheme.value) {
      outcome.results.push({ name: '테마', outcome: 'skipped', detail: '적용하지 않도록 껐음' })
    }

    report(outcome)
    reset()
  }

  /** 집계 결과. 저장되지 않은 것이 있으면 `pending` 에 남는다. */
  interface WriteOutcome {
    results: SectionResult[]
    unsavedLibrary: LibraryData | null
    /** 화면에 반영했지만 저장 못 했거나, 앞 섹션 때문에 **보류**한 Moments. */
    unsavedMoments: MomentsData | null
    unsavedTheme: ThemeKey | null
  }

  /**
   * 실제 쓰기. **가치가 큰 것부터** 쓴다 (ADR 0018 결정 9) — 플레이리스트 →
   * Moments → 테마.
   *
   * `localStorage` 에 여러 키 트랜잭션이 없으므로 원자성을 약속하지 않는다.
   * 대신 무엇이 반영되고 무엇이 안 됐는지 섹션마다 정확히 돌려준다.
   */
  function write(next: {
    library: LibraryData | null
    moments: MomentsData | null
    theme: ThemeKey | null
  }): WriteOutcome {
    const outcome: WriteOutcome = {
      results: [],
      unsavedLibrary: null,
      unsavedMoments: null,
      unsavedTheme: null,
    }

    /** 플레이리스트를 교체했다면 그것이 **저장까지** 됐는가. 교체하지 않았으면 참. */
    let libraryLanded = true

    if (next.library !== null) {
      const result = library.replaceAll(next.library)
      const tracks = next.library.playlists.reduce(
        (total, playlist) => total + playlist.tracks.length,
        0,
      )
      const label = `${String(next.library.playlists.length)}개 · ${String(tracks)}곡`

      if (result.persisted && result.verified) {
        outcome.results.push({ name: '플레이리스트', outcome: 'saved', detail: label })
      } else {
        libraryLanded = false
        outcome.unsavedLibrary = next.library
        outcome.results.push({
          name: '플레이리스트',
          outcome: 'unsaved',
          detail: !result.persisted
            ? result.writeFailure === 'quota-exceeded'
              ? '저장 공간 부족 — 이번 세션에만 반영'
              : '저장 실패 — 이번 세션에만 반영'
            : // 썼다고 했는데 다시 읽으니 다르다. 성공으로 보고하지 않는다 (M8-4).
              '저장했지만 다시 읽을 수 없음',
        })
      }

      /*
       * 라이브러리가 통째로 바뀌었으면 재생을 멈추고 큐를 비운다 (M8-3).
       *
       * 메모리 반영은 성공했으므로 저장 실패와 무관하게 알린다. **Moments 만
       * 교체할 때는 부르지 않는다** — 큐가 가리키는 라이브러리는 그대로다.
       */
      playback?.libraryReplaced()
    }

    if (next.moments !== null) {
      if (!libraryLanded) {
        /*
         * 플레이리스트가 저장되지 않았다. Moments 를 지금 쓰면 새로고침 뒤
         * "옛 플레이리스트 + 파일의 Moments" 가 섞여 남는다. 반영하지 않고
         * 미뤄 둔다 — 다시 저장을 시도할 때 플레이리스트 다음에 쓴다.
         */
        outcome.unsavedMoments = next.moments
        outcome.results.push({
          name: 'Moments',
          outcome: 'held',
          detail: '플레이리스트가 저장되지 않아 반영하지 않음 — 다시 저장 시도 때 함께 반영',
        })
      } else {
        const result = moments.replaceAllMoments(next.moments)
        const label = `Moment ${String(next.moments.length)}개`

        if (result.persisted && result.verified) {
          outcome.results.push({ name: 'Moments', outcome: 'saved', detail: label })
        } else {
          outcome.unsavedMoments = next.moments
          outcome.results.push({
            name: 'Moments',
            outcome: 'unsaved',
            detail: !result.persisted
              ? result.writeFailure === 'quota-exceeded'
                ? `${label} — 저장 공간 부족, 이번 세션에만 반영`
                : `${label} — 저장 실패, 이번 세션에만 반영`
              : `${label} — 저장했지만 다시 읽을 수 없음`,
          })
        }
      }
    }

    if (next.theme !== null) {
      const saved = theme.setTheme(next.theme)
      if (saved) {
        outcome.results.push({ name: '테마', outcome: 'saved', detail: next.theme })
      } else {
        outcome.unsavedTheme = next.theme
        outcome.results.push({
          name: '테마',
          outcome: 'unsaved',
          detail: '적용은 됐지만 저장 실패',
        })
      }
    }

    return outcome
  }

  /** 결과를 문구로 옮기고 저장 안 된 것을 기억한다. */
  function report(outcome: WriteOutcome): void {
    const hadFailure =
      outcome.unsavedLibrary !== null ||
      outcome.unsavedMoments !== null ||
      outcome.unsavedTheme !== null

    pending.value = hadFailure
      ? {
          library: outcome.unsavedLibrary,
          moments: outcome.unsavedMoments,
          theme: outcome.unsavedTheme,
        }
      : null

    results.value = outcome.results

    /*
     * `kept`(파일에 없어 유지)는 실패가 아니다. M8 파일을 복원할 때마다 "일부만
     * 복원했습니다" 라고 하면 사용자가 무엇이 잘못됐는지 찾게 된다.
     */
    const notApplied = outcome.results.filter(
      (result) => result.outcome !== 'saved' && result.outcome !== 'kept',
    )
    const applied = outcome.results.filter((result) => result.outcome === 'saved')
    const kept = outcome.results.filter((result) => result.outcome === 'kept')

    failed.value = notApplied.length > 0
    const head = notApplied.length > 0 ? '일부만 복원했습니다.' : '복원했습니다.'
    const appliedText =
      applied.length === 0
        ? ''
        : ` 반영: ${applied.map((result) => appliedLabel(result)).join(' · ')}.`
    const keptText =
      kept.length === 0
        ? ''
        : ` 유지: ${kept.map((result) => `${result.name} (${result.detail})`).join(' · ')}.`
    const notAppliedText =
      notApplied.length === 0
        ? ''
        : ` 반영되지 않음: ${notApplied.map((result) => `${result.name} (${result.detail})`).join(' · ')}.`
    notice.value = `${head}${appliedText}${keptText}${notAppliedText}`
  }

  /** 반영된 섹션의 짧은 이름. M8 의 문구를 그대로 잇는다. */
  function appliedLabel(result: SectionResult): string {
    if (result.name === '플레이리스트') return `플레이리스트 ${result.detail}`
    if (result.name === '테마') return `테마 ${result.detail}`
    return result.detail
  }

  /**
   * 저장에 실패한 것을 다시 저장해 본다 (M8-4).
   *
   * 사용자가 승인한 **같은 데이터**를 같은 경로로 다시 쓴다. 새 승인을 받을
   * 이유가 없다 — 승인한 복원이 저장되지 않았을 뿐이다. 순서도 같다 —
   * 플레이리스트가 이번에도 저장되지 않으면 보류한 Moments 는 계속 보류된다.
   */
  function retrySave(): void {
    const target = pending.value
    if (target === null) return

    report(write({ library: target.library, moments: target.moments, theme: target.theme }))
  }

  return {
    stage,
    preview,
    notice,
    failed,
    applyTheme,
    stale,
    unsaved,
    results,
    selectFile,
    cancel,
    exportCurrentFirst,
    downloadRawOriginal,
    downloadRawMoments,
    apply,
    retrySave,
  }
}
