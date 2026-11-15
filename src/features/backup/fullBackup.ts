/**
 * 앨범아트를 포함한 전체 백업 — `39page-full-backup` ZIP (M12-4, ADR 0034 · ARTWORK_DESIGN §7).
 *
 * ```text
 * manifest.json   파일 목록 · 크기 · SHA-256 · 형식 버전 · 넣지 못한 그림
 * backup.json     기존 JSON 백업 파일 그대로 (39page-backup schemaVersion 1)
 * artwork.json    연결(playlistId · trackId · videoId · mode · assetId) + 그림 메타
 * assets/<sha256>.<ext>
 * ```
 *
 * 순수 함수다 — store · 저장소 · 시계를 읽지 않는다. 받은 것만으로 만들고 읽는다.
 */
import type { ImageTools } from '@/features/artwork/imageValidation'
import type { ArtworkAssignment } from '@/shared/types/artwork'

import type { BackupFile } from './backupSchema'
import {
  buildManifest,
  decodeJson,
  encodeJson,
  isRecord,
  MANIFEST_PROBLEM_MESSAGE,
  packagePolicy,
  packArtwork,
  readPackedPreference,
  unpackAssets,
  verifyManifest,
  type AssetProblem,
  type IncompleteArtwork,
  type PackageManifest,
  type PackedAsset,
  type PackInput,
  type UnpackedArtwork,
} from './packageFormat'
import { buildZip, readZip, ZIP_ERROR_MESSAGE, type ZipEntry } from './zipPackage'

export const FULL_BACKUP_FORMAT = '39page-full-backup'
export const FULL_BACKUP_VERSION = 1
export const ARTWORK_JSON_VERSION = 1

const META = ['manifest.json', 'backup.json', 'artwork.json'] as const

/** `artwork.json` 의 연결 한 줄 — 저장소의 수정 번호 · 시각은 옮기지 않는다 (복원하는 쪽이 새로 매긴다). */
export interface PackedAssignment {
  readonly playlistId: string
  readonly trackId: string
  readonly videoId: string
  readonly mode: 'default' | 'custom'
  readonly assetId?: string
}

export interface FullBackupBuild {
  readonly bytes: Uint8Array
  readonly links: number
  readonly assets: number
  readonly assetBytes: number
  readonly incomplete: readonly IncompleteArtwork[]
  /** 앨범아트 저장소를 읽을 수 없어 그림이 통째로 빠졌다. */
  readonly artworkUnavailable: boolean
  /** 라이브러리에 없는 트랙의 연결 — 넣지 않았다 (보일 곳이 없다). */
  readonly skippedOrphans: number
}

/**
 * 전체 백업 ZIP 을 만든다.
 *
 * @param artwork 앨범아트 저장소의 사진. `null` 이면 저장소를 읽을 수 없었다 — 그림 없이 만들되 manifest 에
 *   `incomplete: { artwork: 'unavailable' }` 을 적고 부르는 쪽이 "완료" 라고 하지 않는다.
 */
export async function createFullBackupZip(input: {
  readonly backup: BackupFile
  readonly artwork: PackInput | null
  readonly now: Date
  readonly sha256: (bytes: Uint8Array) => Promise<string>
}): Promise<FullBackupBuild> {
  const live = new Set<string>()
  for (const playlist of input.backup.data.library.data.playlists) {
    for (const track of playlist.tracks) live.add(JSON.stringify([playlist.id, track.id]))
  }

  let packedLinks: readonly ArtworkAssignment[] = []
  let packedAssets: readonly PackedAsset[] = []
  let assetFiles: readonly ZipEntry[] = []
  let incomplete: readonly IncompleteArtwork[] = []
  let skippedOrphans = 0

  if (input.artwork !== null) {
    const inLibrary = input.artwork.assignments.filter((assignment) =>
      live.has(JSON.stringify([assignment.playlistId, assignment.trackId])),
    )
    skippedOrphans = input.artwork.assignments.length - inLibrary.length
    const packed = await packArtwork({ ...input.artwork, assignments: inLibrary }, input.sha256)
    packedLinks = packed.assignments
    packedAssets = packed.assets
    assetFiles = packed.files
    incomplete = packed.incomplete
  }

  const artworkJson = {
    version: ARTWORK_JSON_VERSION,
    assignments: packedLinks.map((assignment): PackedAssignment => ({
      playlistId: assignment.playlistId,
      trackId: assignment.trackId,
      videoId: assignment.videoId,
      mode: assignment.mode,
      ...(assignment.mode === 'custom' && assignment.assetId !== undefined
        ? { assetId: assignment.assetId }
        : {}),
    })),
    assets: packedAssets,
  }

  const files: ZipEntry[] = [
    { path: 'backup.json', bytes: encodeJson(input.backup), compress: true },
    { path: 'artwork.json', bytes: encodeJson(artworkJson), compress: true },
    ...assetFiles,
  ]
  const manifest = await buildManifest(
    {
      format: FULL_BACKUP_FORMAT,
      formatVersion: FULL_BACKUP_VERSION,
      createdAt: input.now.toISOString(),
      contents: ['backup', 'artwork'],
      ...(input.artwork === null
        ? { incomplete: { artwork: 'unavailable' as const } }
        : incomplete.length > 0
          ? { incomplete }
          : {}),
    },
    files,
    input.sha256,
    new Map(packedAssets.map((asset) => [asset.id, asset.mimeType])),
  )
  const bytes = buildZip([
    { path: 'manifest.json', bytes: encodeJson(manifest), compress: true },
    ...files,
  ])

  return {
    bytes,
    links: packedLinks.length,
    assets: packedAssets.length,
    assetBytes: packedAssets.reduce((sum, asset) => sum + asset.byteSize, 0),
    incomplete,
    artworkUnavailable: input.artwork === null,
    skippedOrphans,
  }
}

/* ------------------------------------------------------------------ *
 * 읽기
 * ------------------------------------------------------------------ */

/** 연결 하나가 빠진 이유 — 그 곡은 자동(썸네일)으로 보인다. */
export interface DroppedLink {
  readonly playlistId: string
  readonly trackId: string
  readonly reason: AssetProblem['reason'] | 'unknown-asset'
}

export type FullBackupRead =
  | {
      readonly ok: true
      readonly manifest: PackageManifest
      /** 기존 JSON 가져오기에 그대로 넘길 원문. */
      readonly backupText: string
      readonly links: readonly PackedAssignment[]
      readonly artwork: UnpackedArtwork
      readonly dropped: readonly DroppedLink[]
      /** 만든 쪽이 이미 "넣지 못함" 이라고 적은 것. */
      readonly incompleteAtExport: PackageManifest['incomplete'] | null
    }
  | { readonly ok: false; readonly message: string }

function readLink(value: unknown): PackedAssignment | null {
  if (!isRecord(value)) return null
  const { playlistId, trackId, videoId } = value
  if (typeof playlistId !== 'string' || playlistId === '') return null
  if (typeof trackId !== 'string' || trackId === '') return null
  if (typeof videoId !== 'string') return null
  const preference = readPackedPreference(value)
  if (preference === null) return null
  return { playlistId, trackId, videoId, ...preference }
}

/** 전체 백업 ZIP 을 읽고 **모두** 검증한다. 아무것도 쓰지 않는다. */
export async function readFullBackupZip(
  bytes: Uint8Array,
  tools: ImageTools,
  now: Date,
): Promise<FullBackupRead> {
  const zip = readZip(bytes, packagePolicy(META))
  if (!zip.ok) return { ok: false, message: ZIP_ERROR_MESSAGE[zip.error.kind] }

  const verified = await verifyManifest(
    zip.files,
    FULL_BACKUP_FORMAT,
    FULL_BACKUP_VERSION,
    tools.sha256,
  )
  if (!verified.ok) return { ok: false, message: MANIFEST_PROBLEM_MESSAGE(verified.problem) }

  const backup = zip.files.get('backup.json')
  if (backup === undefined) return { ok: false, message: '백업 파일(backup.json)이 없습니다.' }
  let backupText: string
  try {
    backupText = new TextDecoder('utf-8', { fatal: true }).decode(backup)
  } catch {
    return { ok: false, message: '백업 파일(backup.json)을 읽을 수 없습니다.' }
  }

  // 앨범아트 — 없으면(옛 형식 · 비움) 그림 없이 복원한다.
  const rawArtwork = zip.files.has('artwork.json')
    ? decodeJson(zip.files.get('artwork.json'))
    : null
  const links: PackedAssignment[] = []
  let artwork: UnpackedArtwork = { assets: [], problems: [] }
  const dropped: DroppedLink[] = []
  if (rawArtwork !== null) {
    if (!isRecord(rawArtwork) || rawArtwork.version !== ARTWORK_JSON_VERSION) {
      return { ok: false, message: '앨범아트 목록(artwork.json)을 읽을 수 없습니다.' }
    }
    const unpacked = await unpackAssets(rawArtwork.assets, zip.files, tools, now)
    if (unpacked === null) {
      return {
        ok: false,
        message: '앨범아트 목록이 올바르지 않습니다 (같은 그림이 두 번 · 모르는 형식).',
      }
    }
    artwork = unpacked
    const good = new Set(unpacked.assets.map((item) => item.asset.id))
    const problemOf = new Map(unpacked.problems.map((problem) => [problem.assetId, problem.reason]))
    if (!Array.isArray(rawArtwork.assignments)) {
      return { ok: false, message: '앨범아트 목록이 올바르지 않습니다.' }
    }
    const seen = new Set<string>()
    for (const raw of rawArtwork.assignments as unknown[]) {
      const link = readLink(raw)
      if (link === null) return { ok: false, message: '앨범아트 연결이 올바르지 않습니다.' }
      const key = JSON.stringify([link.playlistId, link.trackId])
      if (seen.has(key)) return { ok: false, message: '같은 곡의 앨범아트 연결이 두 번 있습니다.' }
      seen.add(key)
      if (link.mode === 'custom' && !good.has(link.assetId ?? '')) {
        dropped.push({
          playlistId: link.playlistId,
          trackId: link.trackId,
          reason: problemOf.get(link.assetId ?? '') ?? 'unknown-asset',
        })
        continue
      }
      links.push(link)
    }
  }

  return {
    ok: true,
    manifest: verified.manifest,
    backupText,
    links,
    artwork,
    dropped,
    incompleteAtExport: verified.manifest.incomplete ?? null,
  }
}

/** 복원할 연결 — 가져온 라이브러리에 있는 트랙만, 수정 번호 1 로. */
export function restoredAssignments(
  links: readonly PackedAssignment[],
  library: { readonly playlists: readonly { id: string; tracks: readonly { id: string }[] }[] },
  now: Date,
): ArtworkAssignment[] {
  const live = new Set<string>()
  for (const playlist of library.playlists) {
    for (const track of playlist.tracks) live.add(JSON.stringify([playlist.id, track.id]))
  }
  return links
    .filter((link) => live.has(JSON.stringify([link.playlistId, link.trackId])))
    .map((link) => ({ ...link, revision: 1, updatedAt: now.toISOString() }))
}
