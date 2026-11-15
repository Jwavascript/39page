/**
 * 공유 파일 만들기 · 가져오기 (M12-4, ARTWORK_DESIGN §8).
 *
 * 가져오기 순서 — 실패하면 그 뒤를 하지 않고, 무엇이 들어왔는지 그대로 적는다:
 * 1. 그림 스테이징 (더하기만)
 * 2. 라이브러리 — 새 목록을 만들거나 고른 목록에 곡을 더한다 (기존 store 액션 · 잠금 그대로). 새 id 를 만든다
 * 3. 그림 연결 — 들어온 곡에만, 한 트랜잭션
 * 4. Moments — 켰을 때만, 같은 (영상 · 초 · 메모) 는 건너뜀
 * 5. 아무도 쓰지 않게 된 스테이징 그림 정리
 *
 * 서버 · 공개 URL 을 쓰지 않는다 — 파일을 주고받는다.
 */
import { computed, inject, ref, shallowRef, type ComputedRef, type Ref } from 'vue'

import {
  ARTWORK_IMAGE_TOOLS,
  browserImageTools,
  sha256Hex,
} from '@/features/artwork/imageValidation'
import type { ArtworkAssignment } from '@/shared/types/artwork'
import { createId } from '@/shared/utils/id'
import { useArtworkStore } from '@/stores/artwork'
import { useLibraryStore } from '@/stores/library'
import { createMoment, useMomentsStore } from '@/stores/moments'

import { downloadBytes } from './downloadBackup'
import { MAX_PACKAGE_BYTES } from './packageFormat'
import { createSharePackage, readSharePackage, shareFileName, type ShareRead } from './sharePackage'

/* ------------------------------------------------------------------ *
 * 만들기
 * ------------------------------------------------------------------ */

export interface ShareExportModel {
  busy: Readonly<Ref<boolean>>
  notice: Readonly<Ref<string>>
  failed: Readonly<Ref<boolean>>
  /** 목록 전체(`trackId` 없음) 또는 한 곡. */
  exportShare(options: {
    playlistId: string
    trackId?: string
    includeMoments: boolean
  }): Promise<void>
}

export function useShareExport(): ShareExportModel {
  const library = useLibraryStore()
  const moments = useMomentsStore()
  const artwork = useArtworkStore()
  const busy = ref(false)
  const notice = ref('')
  const failed = ref(false)

  async function exportShare(options: {
    playlistId: string
    trackId?: string
    includeMoments: boolean
  }): Promise<void> {
    const playlist = library.getPlaylist(options.playlistId)
    if (playlist === undefined || busy.value) return
    const track =
      options.trackId === undefined
        ? null
        : playlist.tracks.find((item) => item.id === options.trackId)
    if (track === undefined) return
    busy.value = true
    notice.value = ''
    failed.value = false
    try {
      const repository = artwork.repositoryForTransfer()
      let snapshot = null
      if (repository !== null) snapshot = await repository.exportAll().catch(() => null)
      const built = await createSharePackage({
        kind: track === null ? 'playlist' : 'track',
        playlist,
        trackIds: track === null ? playlist.tracks.map((item) => item.id) : [track.id],
        artwork: snapshot,
        moments: options.includeMoments ? moments.moments : null,
        now: new Date(),
        sha256: sha256Hex,
      })
      const result = downloadBytes(
        built.bytes,
        shareFileName(track === null ? playlist.name : track.title),
      )
      if (!result.ok) {
        failed.value = true
        notice.value = '공유 파일을 내려받지 못했습니다.'
        return
      }
      const parts = [`곡 ${String(built.tracks)}개`, `그림 ${String(built.images)}개`]
      if (options.includeMoments) parts.push(`Moment ${String(built.moments)}개`)
      if (repository === null || built.incomplete.length > 0) {
        failed.value = true
        notice.value = `“${result.fileName}” 을 내려받았지만 그림 일부를 넣지 못했습니다. ${parts.join(' · ')}.`
      } else {
        notice.value = `공유 파일 “${result.fileName}” 을 내려받았습니다. ${parts.join(' · ')}.`
      }
    } catch {
      failed.value = true
      notice.value = '공유 파일을 만들지 못했습니다.'
    } finally {
      busy.value = false
    }
  }

  return { busy, notice, failed, exportShare }
}

/* ------------------------------------------------------------------ *
 * 가져오기
 * ------------------------------------------------------------------ */

export interface ShareImportPreview {
  readonly kind: 'track' | 'playlist'
  readonly name: string
  readonly tracks: number
  readonly images: number
  readonly bytes: number
  /** 패키지의 Moments 수. 들어 있지 않으면 `null`. */
  readonly moments: number | null
  readonly droppedArtwork: number
  readonly problems: number
  /** 고른 대상 목록에 이미 있는 같은 영상 수. 새 목록이면 0. */
  readonly duplicates: number
}

export interface ShareImportModel {
  preview: ComputedRef<ShareImportPreview | null>
  /** `'new'` = 새 목록, 아니면 기존 목록 id. */
  target: Ref<string>
  /** 같은 영상이 대상 목록에 이미 있을 때. */
  duplicates: Ref<'skip' | 'add'>
  includeMoments: Ref<boolean>
  busy: Readonly<Ref<boolean>>
  notice: Readonly<Ref<string>>
  failed: Readonly<Ref<boolean>>
  results: Readonly<Ref<readonly string[]>>
  selectFile(file: File): Promise<void>
  apply(): Promise<void>
  cancel(): void
}

export function useShareImport(): ShareImportModel {
  const library = useLibraryStore()
  const moments = useMomentsStore()
  const artwork = useArtworkStore()
  const tools = inject(ARTWORK_IMAGE_TOOLS, null) ?? browserImageTools()

  const read = shallowRef<Extract<ShareRead, { ok: true }> | null>(null)
  const target = ref('new')
  const duplicates = ref<'skip' | 'add'>('skip')
  const includeMoments = ref(false)
  const busy = ref(false)
  const notice = ref('')
  const failed = ref(false)
  const results = ref<readonly string[]>([])

  const preview = computed<ShareImportPreview | null>(() => {
    const file = read.value
    if (file === null) return null
    const existing = new Set(
      target.value === 'new'
        ? []
        : (library.getPlaylist(target.value)?.tracks.map((track) => track.videoId) ?? []),
    )
    return {
      kind: file.kind,
      name: file.name,
      tracks: file.tracks.length,
      images: file.artwork.assets.length,
      bytes: file.artwork.assets.reduce((sum, item) => sum + item.asset.byteSize, 0),
      moments: file.moments?.length ?? null,
      droppedArtwork: file.droppedArtwork,
      problems: file.artwork.problems.length,
      duplicates: file.tracks.filter((track) => existing.has(track.videoId)).length,
    }
  })

  async function selectFile(file: File): Promise<void> {
    read.value = null
    notice.value = ''
    failed.value = false
    results.value = []
    if (file.size > MAX_PACKAGE_BYTES) {
      failed.value = true
      notice.value = '파일이 너무 큽니다 (최대 512 MB).'
      return
    }
    busy.value = true
    try {
      const result = await readSharePackage(
        new Uint8Array(await file.arrayBuffer()),
        tools,
        new Date(),
      )
      if (!result.ok) {
        failed.value = true
        notice.value = result.message
        return
      }
      read.value = result
      target.value = 'new'
      duplicates.value = 'skip'
      includeMoments.value = false
    } catch {
      failed.value = true
      notice.value = '파일을 읽지 못했습니다.'
    } finally {
      busy.value = false
    }
  }

  /** 같은 이름이 있으면 "(2)" · "(3)" … */
  function uniqueName(name: string): string {
    const names = new Set(library.playlists.map((playlist) => playlist.name))
    if (!names.has(name)) return name
    for (let n = 2; ; n += 1) {
      const candidate = `${name} (${String(n)})`
      if (!names.has(candidate)) return candidate
    }
  }

  async function apply(): Promise<void> {
    const file = read.value
    if (file === null || busy.value) return
    busy.value = true
    notice.value = ''
    failed.value = false
    const lines: string[] = []
    const repository = artwork.repositoryForTransfer()
    let staged: string[] = []
    try {
      // 1. 그림 스테이징
      if (repository !== null && file.artwork.assets.length > 0) {
        const stagedResult = await repository.stageAssets(file.artwork.assets)
        if (!stagedResult.ok) {
          failed.value = true
          notice.value =
            stagedResult.reason === 'quota'
              ? '그림을 저장할 공간이 부족해 아무것도 가져오지 않았습니다.'
              : '그림을 저장하지 못해 아무것도 가져오지 않았습니다.'
          return
        }
        staged = stagedResult.added
      }

      // 2. 라이브러리
      let playlistId = target.value
      if (playlistId === 'new') {
        const created = await library.createPlaylist(uniqueName(file.name))
        if (!created.ok) {
          failed.value = true
          notice.value = `목록을 만들지 못했습니다 (${created.reason}). 아무것도 가져오지 않았습니다.`
          return
        }
        playlistId = created.playlistId
        lines.push(
          `새 목록 “${library.getPlaylist(playlistId)?.name ?? file.name}” 을 만들었습니다.`,
        )
      } else if (library.getPlaylist(playlistId) === undefined) {
        failed.value = true
        notice.value = '고른 목록이 없어졌습니다. 다시 골라 주세요.'
        return
      }
      const existing = new Set(
        library.getPlaylist(playlistId)?.tracks.map((track) => track.videoId) ?? [],
      )
      const links: ArtworkAssignment[] = []
      let added = 0
      let skipped = 0
      let unsaved = false
      for (const track of file.tracks) {
        if (duplicates.value === 'skip' && existing.has(track.videoId)) {
          skipped += 1
          continue
        }
        const result = await library.addTrack(playlistId, {
          videoId: track.videoId,
          title: track.title,
        })
        if (!result.ok || result.trackId === undefined) {
          failed.value = true
          lines.push(
            `곡 ${String(added)}개를 더한 뒤 멈췄습니다 (${result.ok ? 'unknown' : result.reason}).`,
          )
          break
        }
        if (!result.persisted) unsaved = true
        added += 1
        if (track.artwork !== null) {
          links.push({
            playlistId,
            trackId: result.trackId,
            videoId: track.videoId,
            mode: track.artwork.mode,
            ...(track.artwork.mode === 'custom' ? { assetId: track.artwork.assetId ?? '' } : {}),
            revision: 1,
            updatedAt: new Date().toISOString(),
          })
        }
      }
      lines.push(
        `곡 ${String(added)}개를 더했습니다${skipped > 0 ? ` · 이미 있는 같은 영상 ${String(skipped)}곡은 건너뜀` : ''}.`,
      )
      if (unsaved) {
        failed.value = true
        lines.push(
          '라이브러리를 저장하지 못했습니다 — 새로고침하면 사라집니다. 데이터 · 백업에서 확인해 주세요.',
        )
      }

      // 3. 그림 연결
      if (links.length > 0) {
        if (repository === null) {
          lines.push('이 브라우저에서 앨범아트 저장소를 열 수 없어 그림은 가져오지 않았습니다.')
        } else {
          const linked = await repository.putAssignments(links)
          if (linked.ok) {
            lines.push(`그림 ${String(links.length)}곡에 연결했습니다.`)
          } else {
            failed.value = true
            lines.push(
              '곡은 들어왔지만 그림 연결을 저장하지 못했습니다 — 그 곡들은 썸네일로 보입니다.',
            )
          }
        }
      }
      if (file.droppedArtwork > 0) {
        lines.push(
          `손상된 그림 ${String(file.droppedArtwork)}개는 받지 않았습니다 (그 곡은 썸네일).`,
        )
      }

      // 4. Moments
      if (includeMoments.value && file.moments !== null) {
        const have = new Set(
          moments.moments.map((m) => `${m.videoId}|${String(m.atSeconds)}|${m.note}`),
        )
        const fresh = file.moments
          .filter((m) => !have.has(`${m.videoId}|${String(m.atSeconds)}|${m.note}`))
          .map((m) =>
            createMoment({
              videoId: m.videoId,
              atSeconds: m.atSeconds,
              note: m.note,
              title: m.title,
              now: new Date(),
              id: createId(),
            }),
          )
        const result = fresh.length === 0 ? null : await moments.addMoments(fresh)
        if (result === null) lines.push('새 Moment 가 없습니다 (모두 이미 있음).')
        else if (!result.ok) {
          failed.value = true
          lines.push('Moments 를 더하지 못했습니다 (다른 탭이 저장 중) — 곡은 들어왔습니다.')
        } else {
          lines.push(
            `Moment ${String(result.added)}개를 더했습니다${file.moments.length - fresh.length > 0 ? ` · 같은 Moment ${String(file.moments.length - fresh.length)}개는 건너뜀` : ''}.`,
          )
        }
      }
    } finally {
      // 5. 아무도 쓰지 않게 된 스테이징 그림 (건너뛴 곡 · 실패) 정리
      if (repository !== null && staged.length > 0) await repository.removeUnused(staged)
      if (repository !== null) await artwork.refreshAfterTransfer()
      busy.value = false
    }
    results.value = lines
    if (lines.length > 0) read.value = null
  }

  function cancel(): void {
    read.value = null
    notice.value = ''
    failed.value = false
    results.value = []
  }

  return {
    preview,
    target,
    duplicates,
    includeMoments,
    busy,
    notice,
    failed,
    results,
    selectFile,
    apply,
    cancel,
  }
}
