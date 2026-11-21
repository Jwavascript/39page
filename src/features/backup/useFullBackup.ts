/**
 * 전체 백업(ZIP) 내보내기 · 가져오기 (M12-4, ADR 0034 · ARTWORK_DESIGN §7-3).
 *
 * **가져오기는 기존 JSON 가져오기(`useBackupImport`)를 감싼다** — ZIP 의 `backup.json` 을 그대로 넘겨 그 검증 ·
 * 미리보기 · 잠금 · 지문 · 섹션별 결과를 쓰고, 앨범아트 단계만 앞뒤에 더한다:
 *
 * 1. 검증 — ZIP · manifest · 해시 · 이미지 재검증 (아무것도 쓰지 않음)
 * 2. 미리보기 — 기존 미리보기 + 앨범아트 줄
 * 3. 스테이징 — 새 그림을 저장소에 **더하기만** (내용 해시라 기존 그림을 덮지 않음). 실패하면 멈춘다
 * 4. 텍스트 확정 — 기존 `apply()`. 플레이리스트가 `saved` 가 아니면 연결을 바꾸지 않고 스테이징을 되돌린다
 * 5. 연결 확정 — 한 트랜잭션으로 통째 교체. 실패하면 "다시 시도" (스테이징은 남긴다)
 * 6. 정리 · 확인 — 쓰지 않게 된 그림을 지우고 다시 읽어 맞는지 본다
 *
 * 두 저장소는 원자적이지 않다 — 되돌릴 수 없는 지점(4) 전에 "지금 데이터 먼저 받기" 를 권한다.
 */
import { computed, inject, ref, shallowRef, type ComputedRef, type Ref } from 'vue'

import {
  ARTWORK_IMAGE_TOOLS,
  browserImageTools,
  sha256Hex,
} from '@/features/artwork/imageValidation'
import { formatBytes } from '@/shared/utils/bytes'
import { useArtworkStore } from '@/stores/artwork'
import { DECK_FAILURE_MESSAGE, useCustomThemeStore } from '@/stores/customTheme'
import { useLibraryStore } from '@/stores/library'
import { useMomentsStore } from '@/stores/moments'
import { useThemeStore } from '@/stores/theme'

import { createBackup, resolveBackupIntegrity } from './createBackup'
import { downloadBytes, fullBackupFileName } from './downloadBackup'
import {
  createFullBackupZip,
  readFullBackupZip,
  restoredAssignments,
  type FullBackupRead,
} from './fullBackup'
import { MAX_PACKAGE_BYTES } from './packageFormat'
import { readBackup } from './readBackup'
import type { BackupImportModel, SectionResult } from './useBackupImport'

/* ------------------------------------------------------------------ *
 * 내보내기
 * ------------------------------------------------------------------ */

export interface FullBackupExportModel {
  busy: Readonly<Ref<boolean>>
  notice: Readonly<Ref<string>>
  failed: Readonly<Ref<boolean>>
  /** 사용자 이미지를 쓰는 곡 수 — JSON 백업에 그림이 빠진다는 안내에 쓴다. */
  customCount: ComputedRef<number>
  exportZip(): Promise<void>
}

export function useFullBackupExport(): FullBackupExportModel {
  const library = useLibraryStore()
  const moments = useMomentsStore()
  const theme = useThemeStore()
  const customTheme = useCustomThemeStore()
  const artwork = useArtworkStore()
  const busy = ref(false)
  const notice = ref('')
  const failed = ref(false)

  async function exportZip(): Promise<void> {
    if (busy.value) return
    busy.value = true
    notice.value = ''
    failed.value = false
    try {
      const now = new Date()
      const backup = createBackup({
        library: { playlists: library.playlists, selectedPlaylistId: library.selectedPlaylistId },
        moments: moments.moments,
        theme: theme.current,
        customTheme: { colors: customTheme.saved },
        integrity: resolveBackupIntegrity({
          status: library.status,
          protectedReason: library.protectedReason,
          moments: { status: moments.status, protectedReason: moments.protectedReason },
        }),
        exportedAt: now,
      })
      const repository = artwork.repositoryForTransfer()
      let snapshot = null
      if (repository !== null) {
        try {
          snapshot = await repository.exportAll()
        } catch {
          snapshot = null
        }
      }
      const built = await createFullBackupZip({
        backup,
        artwork: snapshot,
        deck: customTheme.deck,
        now,
        sha256: sha256Hex,
      })
      const result = downloadBytes(built.bytes, fullBackupFileName(now))
      if (!result.ok) {
        failed.value = true
        notice.value = '전체 백업 파일을 내려받지 못했습니다.'
        return
      }
      const art = `앨범아트 연결 ${String(built.links)}개 · 이미지 ${String(built.assets)}개 (${formatBytes(built.assetBytes)})${built.deckIncluded ? ' · 데크 그림' : ''}`
      if (built.deckCorrupt) {
        failed.value = true
        notice.value = `“${result.fileName}” 을 내려받았지만 데크 그림이 손상돼 넣지 못했습니다. ${art}.`
      } else if (built.artworkUnavailable) {
        failed.value = true
        notice.value = `“${result.fileName}” 을 내려받았지만 앨범아트 저장소를 읽을 수 없어 **그림이 빠졌습니다.** 전체 백업이 완료되지 않았습니다.`
      } else if (built.incomplete.length > 0) {
        failed.value = true
        notice.value = `“${result.fileName}” 을 내려받았지만 그림 ${String(built.incomplete.length)}개를 넣지 못했습니다 (사라짐 · 손상). ${art}. 전체 백업이 완료되지 않았습니다.`
      } else if (backup.integrity !== undefined) {
        failed.value = true
        notice.value = `복구본 “${result.fileName}” 을 내려받았습니다 (원본 일부를 읽지 못함). ${art}.`
      } else {
        notice.value = `전체 백업 “${result.fileName}” 을 내려받았습니다. ${art}.`
      }
    } catch {
      failed.value = true
      notice.value = '전체 백업을 만들지 못했습니다.'
    } finally {
      busy.value = false
    }
  }

  return {
    busy,
    notice,
    failed,
    customCount: computed(() => artwork.customCount),
    exportZip,
  }
}

/* ------------------------------------------------------------------ *
 * 가져오기
 * ------------------------------------------------------------------ */

export interface ArtworkImportPreview {
  readonly links: number
  readonly images: number
  readonly bytes: number
  /** 이 브라우저에 이미 있는 그림 (다시 저장하지 않는다). */
  readonly existing: number
  /** 받지 못하는 그림 · 연결 — 그 곡은 자동(썸네일)으로 보인다. */
  readonly problems: readonly string[]
  readonly unavailable: boolean
  readonly incompleteAtExport: boolean
  /** 파일에 받을 수 있는 데크 그림이 있다 (ADR 0045). 테마와 함께 적용한다. */
  readonly deckImage: boolean
}

export interface FullBackupImportModel {
  /** ZIP 을 읽는 중. */
  reading: Readonly<Ref<boolean>>
  /** ZIP 을 읽었고 미리보기 중. */
  active: ComputedRef<boolean>
  artworkPreview: ComputedRef<ArtworkImportPreview | null>
  /** 앨범아트 단계의 결과 — 기존 섹션 결과 뒤에 붙인다. */
  artworkResult: Readonly<Ref<SectionResult | null>>
  /** 데크 그림 단계의 결과 (ADR 0045). */
  deckResult: Readonly<Ref<SectionResult | null>>
  canRetryArtwork: Readonly<Ref<boolean>>
  notice: Readonly<Ref<string>>
  failed: Readonly<Ref<boolean>>
  selectZip(file: File): Promise<void>
  apply(): Promise<void>
  retryArtwork(): Promise<void>
  cancel(): void
}

export function useFullBackupImport(restore: BackupImportModel): FullBackupImportModel {
  const artwork = useArtworkStore()
  const customTheme = useCustomThemeStore()
  const library = useLibraryStore()
  const tools = inject(ARTWORK_IMAGE_TOOLS, null) ?? browserImageTools()
  const deckResult = ref<SectionResult | null>(null)

  const read = shallowRef<Extract<FullBackupRead, { ok: true }> | null>(null)
  const reading = ref(false)
  const notice = ref('')
  const failed = ref(false)
  const artworkResult = ref<SectionResult | null>(null)
  const canRetryArtwork = ref(false)
  /** 다시 시도할 연결 (텍스트는 이미 확정됨). */
  let pendingLinks: ReturnType<typeof restoredAssignments> | null = null
  let staged: string[] = []

  const active = computed(() => read.value !== null && restore.stage.value === 'preview')

  const artworkPreview = computed<ArtworkImportPreview | null>(() => {
    const file = read.value
    if (file === null) return null
    const problems = [
      ...file.artwork.problems.map(
        (problem) => `그림 ${problem.assetId.slice(0, 8)}… — ${PROBLEM_LABEL[problem.reason]}`,
      ),
      ...file.dropped.map((link) => `곡 ${link.trackId.slice(0, 8)}…의 그림 연결 — 받지 않음`),
      ...(file.deckProblem === null
        ? []
        : [
            `데크 그림 — ${file.deckProblem === 'invalid' ? '읽을 수 없음' : PROBLEM_LABEL[file.deckProblem]}`,
          ]),
    ]
    return {
      links: file.links.length,
      images: file.artwork.assets.length,
      bytes: file.artwork.assets.reduce((sum, item) => sum + item.asset.byteSize, 0),
      existing: file.artwork.assets.filter((item) => artwork.assetFor(item.asset.id) !== null)
        .length,
      problems,
      unavailable: artwork.repositoryForTransfer() === null,
      incompleteAtExport: file.incompleteAtExport !== null,
      deckImage: file.deck !== null,
    }
  })

  function reset(): void {
    read.value = null
    pendingLinks = null
    staged = []
    canRetryArtwork.value = false
  }

  async function selectZip(file: File): Promise<void> {
    reset()
    notice.value = ''
    failed.value = false
    artworkResult.value = null
    deckResult.value = null
    if (file.size > MAX_PACKAGE_BYTES) {
      failed.value = true
      notice.value = '파일이 너무 큽니다 (최대 512 MB).'
      return
    }
    reading.value = true
    try {
      const bytes = new Uint8Array(await file.arrayBuffer())
      const result = await readFullBackupZip(bytes, tools, new Date())
      if (!result.ok) {
        failed.value = true
        notice.value = result.message
        return
      }
      // 기존 가져오기에 backup.json 을 그대로 넘긴다 — 검증 · 미리보기 · 지문을 거기서 한다.
      await restore.selectFile(
        new File([result.backupText], 'backup.json', { type: 'application/json' }),
      )
      if (restore.stage.value !== 'preview') return
      read.value = result
    } catch {
      failed.value = true
      notice.value = '파일을 읽지 못했습니다.'
    } finally {
      reading.value = false
    }
  }

  async function commitLinks(): Promise<void> {
    const repository = artwork.repositoryForTransfer()
    if (repository === null || pendingLinks === null) return
    const result = await repository.replaceAssignments(pendingLinks)
    if (!result.ok) {
      canRetryArtwork.value = true
      artworkResult.value = {
        name: '앨범아트',
        outcome: 'unsaved',
        detail:
          '곡은 복원됐지만 앨범아트 연결을 저장하지 못했습니다 — "앨범아트 다시 저장" 을 눌러 주세요. 그 전까지는 썸네일로 보입니다.',
      }
      return
    }
    // 쓰지 않게 된 그림(이전 백업의 것)을 지운다.
    await repository.cleanUp(() => true)
    await artwork.refreshAfterTransfer()
    const expected = pendingLinks.length
    const actual = (await repository.snapshot()).assignments.length
    canRetryArtwork.value = false
    pendingLinks = null
    artworkResult.value =
      actual === expected
        ? {
            name: '앨범아트',
            outcome: 'saved',
            detail: `연결 ${String(expected)}개 · 이미지 ${String(artwork.usage.assets)}개 복원`,
          }
        : {
            name: '앨범아트',
            outcome: 'unsaved',
            detail: `연결을 다시 읽어 보니 ${String(actual)}개입니다 (기대 ${String(expected)}개).`,
          }
  }

  async function apply(): Promise<void> {
    const file = read.value
    if (file === null) return
    const repository = artwork.repositoryForTransfer()

    // 3. 스테이징 — 더하기만. 실패하면 아무것도 바꾸지 않고 멈춘다.
    staged = []
    if (repository !== null && file.artwork.assets.length > 0) {
      const result = await repository.stageAssets(file.artwork.assets)
      if (!result.ok) {
        failed.value = true
        notice.value =
          result.reason === 'quota'
            ? '앨범아트를 저장할 공간이 부족해 아무것도 바꾸지 않았습니다. 공간을 비우고 다시 시도해 주세요.'
            : '앨범아트를 저장하지 못해 아무것도 바꾸지 않았습니다.'
        return
      }
      staged = result.added
    }

    // 4. 텍스트 확정 — 기존 경로.
    await restore.apply()
    const playlists = restore.results.value.find((result) => result.name === '플레이리스트')
    if (playlists?.outcome !== 'saved') {
      // 플레이리스트가 저장되지 않았다(거절 · 실패 · 보류) — 연결을 바꾸지 않고 스테이징을 되돌린다.
      if (repository !== null && staged.length > 0) await repository.removeUnused(staged)
      staged = []
      if (restore.results.value.length > 0) {
        artworkResult.value = {
          name: '앨범아트',
          outcome: 'held',
          detail: '플레이리스트가 저장되지 않아 앨범아트를 바꾸지 않았습니다.',
        }
        reset()
      }
      return
    }

    // 데크 그림 (ADR 0045) — 테마를 적용하기로 했을 때만, 플레이리스트가 저장된 뒤에.
    if (file.deck !== null) {
      if (!restore.applyTheme.value) {
        deckResult.value = {
          name: '데크 그림',
          outcome: 'skipped',
          detail: '테마를 적용하지 않도록 껐음',
        }
      } else {
        const written = await customTheme.writeDeck(file.deck, customTheme.deckRevision)
        deckResult.value = written.ok
          ? { name: '데크 그림', outcome: 'saved', detail: '커스텀 테마 데크 그림 복원' }
          : { name: '데크 그림', outcome: 'unsaved', detail: DECK_FAILURE_MESSAGE[written.reason] }
      }
    }

    if (repository === null) {
      artworkResult.value = {
        name: '앨범아트',
        outcome: 'skipped',
        detail: '이 브라우저에서 앨범아트 저장소를 열 수 없어 그림은 복원하지 않았습니다.',
      }
      reset()
      return
    }

    // 5. 연결 확정 — 가져온 라이브러리의 트랙만.
    const parsed = readBackup(file.backupText)
    const importedLibrary = parsed.ok && parsed.library !== null ? parsed.library : library
    pendingLinks = restoredAssignments(file.links, importedLibrary, new Date())
    read.value = null
    await commitLinks()
  }

  async function retryArtwork(): Promise<void> {
    await commitLinks()
  }

  function cancel(): void {
    reset()
    restore.cancel()
  }

  return {
    reading,
    active,
    artworkPreview,
    artworkResult,
    deckResult,
    canRetryArtwork,
    notice,
    failed,
    selectZip,
    apply,
    retryArtwork,
    cancel,
  }
}

const PROBLEM_LABEL = {
  'missing-file': '파일 없음',
  'invalid-image': '손상 · 지원하지 않는 이미지',
  'hash-mismatch': '내용이 이름과 다름',
} as const
