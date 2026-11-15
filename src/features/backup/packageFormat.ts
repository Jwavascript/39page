/**
 * 39page ZIP 패키지 공통 — manifest · 앨범아트 묶기/풀기 (M12-4, ADR 0034 · ARTWORK_DESIGN §7 · §8).
 *
 * 두 패키지가 같은 바탕을 쓴다:
 * - 전체 백업 `39page-full-backup` — `backup.json`(기존 JSON 백업 그대로) + `artwork.json` + `assets/`
 * - 공유 `39page-share` — `share.json` + `assets/` (공유는 연결을 `share.json` 안에 둔다)
 *
 * **manifest 는 모든 파일의 크기 · SHA-256 을 적는다.** 읽을 때 하나라도 어긋나면(빠짐 · 남는 파일 · 다른 해시)
 * 패키지를 받지 않는다. 자산은 파일 이름 = 내용 해시이고, 이미지 검증(매직 바이트 · 디코딩 · 한도)을 **다시** 한다.
 */
import {
  ARTWORK_EXTENSION,
  ARTWORK_MIME_TYPES,
  isArtworkAssetId,
  type ArtworkAsset,
  type ArtworkAssignment,
  type ArtworkMimeType,
} from '@/shared/types/artwork'
import { validateArtwork, type ImageTools } from '@/features/artwork/imageValidation'
import type { ArtworkBlobRecord, NewAsset } from '@/features/artwork/artworkRepository'

import type { ZipEntry, ZipReadPolicy } from './zipPackage'

/** 빌드할 때 vite 가 채운다 (`vite.config.ts` 의 `define`). */
declare const __APP_VERSION__: string

export const APP_VERSION: string = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0'

export interface ManifestFile {
  readonly path: string
  readonly byteSize: number
  readonly sha256: string
  readonly mimeType?: ArtworkMimeType
}

/** 넣지 못한 그림 — 숨기지 않고 manifest · 화면에 적는다. */
export interface IncompleteArtwork {
  readonly playlistId: string
  readonly trackId: string
  readonly assetId: string
  /** `missing` — 연결은 있는데 바이트가 없다. `corrupt` — 바이트의 해시가 id 와 다르다. */
  readonly reason: 'missing' | 'corrupt'
}

export interface PackageManifest {
  readonly format: string
  readonly formatVersion: number
  readonly createdAt: string
  readonly app: { readonly name: '39page'; readonly version: string }
  readonly contents: readonly string[]
  readonly files: readonly ManifestFile[]
  /** 넣지 못한 것이 있을 때만. 있으면 "완전한 백업" 이 아니다. */
  readonly incomplete?: readonly IncompleteArtwork[] | { readonly artwork: 'unavailable' }
}

/** 패키지 안 한 트랙의 그림. `auto` 는 적지 않는다. */
export interface PackedPreference {
  readonly mode: 'default' | 'custom'
  readonly assetId?: string
}

export interface PackedAsset {
  readonly id: string
  readonly mimeType: ArtworkMimeType
  readonly byteSize: number
  readonly width: number
  readonly height: number
  readonly animated: boolean
}

export const assetPath = (id: string, mimeType: ArtworkMimeType): string =>
  `assets/${id}.${ARTWORK_EXTENSION[mimeType]}`

const ASSET_PATH = /^assets\/([0-9a-f]{64})\.(png|jpg|webp|gif)$/

/** 패키지 공통 읽기 정책 — 메타 파일 이름은 패키지마다 다르다. */
export function packagePolicy(metaFiles: readonly string[]): ZipReadPolicy {
  return {
    allow: (path) =>
      metaFiles.includes(path) ? 8 * 1024 * 1024 : ASSET_PATH.test(path) ? 12 * 1024 * 1024 : null,
    maxEntries: 4000,
    maxTotalBytes: 1024 * 1024 * 1024,
    maxRatio: 200,
  }
}

/** ZIP 파일 자체의 한도 — 읽기 전에 본다. */
export const MAX_PACKAGE_BYTES = 512 * 1024 * 1024

export const encodeJson = (value: unknown): Uint8Array =>
  new TextEncoder().encode(JSON.stringify(value, null, 2))

export function decodeJson(bytes: Uint8Array | undefined): unknown {
  if (bytes === undefined) return undefined
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown
  } catch {
    return undefined
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/* ------------------------------------------------------------------ *
 * 쓰기
 * ------------------------------------------------------------------ */

export interface PackInput {
  readonly assignments: readonly ArtworkAssignment[]
  readonly assets: readonly ArtworkAsset[]
  readonly blobs: readonly ArtworkBlobRecord[]
}

export interface PackedArtwork {
  /** 넣은 연결 (원래 키). 자산이 없거나 깨진 custom 은 빠지고 `incomplete` 에 적힌다. */
  readonly assignments: readonly ArtworkAssignment[]
  readonly assets: readonly PackedAsset[]
  readonly files: readonly ZipEntry[]
  readonly incomplete: readonly IncompleteArtwork[]
}

/**
 * 연결들과 그 그림을 묶는다. 바이트의 SHA-256 을 다시 재서 id 와 맞는 것만 넣는다 — 저장소에서 깨진 것을
 * 백업에 옮기지 않는다.
 */
export async function packArtwork(
  input: PackInput,
  sha256: (bytes: Uint8Array) => Promise<string>,
): Promise<PackedArtwork> {
  const assetById = new Map(input.assets.map((asset) => [asset.id, asset]))
  const blobById = new Map(input.blobs.map((record) => [record.id, record]))
  const packedAssets = new Map<string, PackedAsset>()
  const files: ZipEntry[] = []
  const bad = new Map<string, IncompleteArtwork['reason']>()
  const assignments: ArtworkAssignment[] = []
  const incomplete: IncompleteArtwork[] = []

  for (const assignment of input.assignments) {
    if (assignment.mode !== 'custom' || assignment.assetId === undefined) {
      assignments.push(assignment)
      continue
    }
    const id = assignment.assetId
    if (!packedAssets.has(id) && !bad.has(id)) {
      const asset = assetById.get(id)
      const record = blobById.get(id)
      if (asset === undefined || record === undefined) {
        bad.set(id, 'missing')
      } else {
        const bytes = new Uint8Array(await record.blob.arrayBuffer())
        if ((await sha256(bytes)) !== id) {
          bad.set(id, 'corrupt')
        } else {
          packedAssets.set(id, {
            id,
            mimeType: asset.mimeType,
            byteSize: bytes.length,
            width: asset.width,
            height: asset.height,
            animated: asset.animated,
          })
          files.push({ path: assetPath(id, asset.mimeType), bytes, compress: false })
        }
      }
    }
    const reason = bad.get(id)
    if (reason !== undefined) {
      incomplete.push({
        playlistId: assignment.playlistId,
        trackId: assignment.trackId,
        assetId: id,
        reason,
      })
      continue
    }
    assignments.push(assignment)
  }

  return { assignments, assets: [...packedAssets.values()], files, incomplete }
}

/** manifest 를 만든다 — 모든 파일의 크기 · 해시. */
export async function buildManifest(
  base: Omit<PackageManifest, 'files' | 'app'>,
  files: readonly ZipEntry[],
  sha256: (bytes: Uint8Array) => Promise<string>,
  assetTypes: ReadonlyMap<string, ArtworkMimeType> = new Map(),
): Promise<PackageManifest> {
  const listed: ManifestFile[] = []
  for (const file of files) {
    const match = ASSET_PATH.exec(file.path)
    const mimeType = match === null ? undefined : assetTypes.get(match[1] ?? '')
    listed.push({
      path: file.path,
      byteSize: file.bytes.length,
      sha256: await sha256(file.bytes),
      ...(mimeType !== undefined ? { mimeType } : {}),
    })
  }
  return { ...base, app: { name: '39page', version: APP_VERSION }, files: listed }
}

/* ------------------------------------------------------------------ *
 * 읽기
 * ------------------------------------------------------------------ */

export type ManifestProblem =
  | { readonly kind: 'no-manifest' }
  | { readonly kind: 'wrong-format' }
  | { readonly kind: 'future-version'; readonly version: number }
  | { readonly kind: 'file-missing'; readonly path: string }
  | { readonly kind: 'file-unlisted'; readonly path: string }
  | { readonly kind: 'file-mismatch'; readonly path: string }

/**
 * manifest 와 ZIP 안 파일이 **정확히** 맞는지 본다 — 빠진 파일 · 목록에 없는 파일 · 크기 · 해시.
 */
export async function verifyManifest(
  files: ReadonlyMap<string, Uint8Array>,
  format: string,
  supportedVersion: number,
  sha256: (bytes: Uint8Array) => Promise<string>,
): Promise<{ ok: true; manifest: PackageManifest } | { ok: false; problem: ManifestProblem }> {
  const raw = decodeJson(files.get('manifest.json'))
  if (!isRecord(raw)) return { ok: false, problem: { kind: 'no-manifest' } }
  if (raw.format !== format) return { ok: false, problem: { kind: 'wrong-format' } }
  const version = raw.formatVersion
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    return { ok: false, problem: { kind: 'wrong-format' } }
  }
  if (version > supportedVersion) return { ok: false, problem: { kind: 'future-version', version } }
  if (!Array.isArray(raw.files)) return { ok: false, problem: { kind: 'wrong-format' } }

  const listed = new Set<string>()
  for (const entry of raw.files as unknown[]) {
    if (!isRecord(entry) || typeof entry.path !== 'string' || typeof entry.sha256 !== 'string') {
      return { ok: false, problem: { kind: 'wrong-format' } }
    }
    if (listed.has(entry.path)) return { ok: false, problem: { kind: 'wrong-format' } }
    listed.add(entry.path)
    const bytes = files.get(entry.path)
    if (bytes === undefined)
      return { ok: false, problem: { kind: 'file-missing', path: entry.path } }
    if (bytes.length !== entry.byteSize || (await sha256(bytes)) !== entry.sha256) {
      return { ok: false, problem: { kind: 'file-mismatch', path: entry.path } }
    }
  }
  for (const path of files.keys()) {
    if (path !== 'manifest.json' && !listed.has(path)) {
      return { ok: false, problem: { kind: 'file-unlisted', path } }
    }
  }
  return { ok: true, manifest: raw as unknown as PackageManifest }
}

export const MANIFEST_PROBLEM_MESSAGE = (problem: ManifestProblem): string => {
  switch (problem.kind) {
    case 'no-manifest':
      return '39page 패키지의 manifest 가 없거나 읽을 수 없습니다.'
    case 'wrong-format':
      return '39page 의 이 종류 파일이 아닙니다.'
    case 'future-version':
      return '더 새 39page 에서 만든 파일입니다. 최신 39page 에서 가져오세요.'
    case 'file-missing':
      return `패키지의 파일이 빠져 있습니다: ${problem.path}`
    case 'file-unlisted':
      return `manifest 에 없는 파일이 들어 있습니다: ${problem.path}`
    case 'file-mismatch':
      return `파일 내용이 manifest 와 다릅니다 (손상 · 변조): ${problem.path}`
  }
}

/** 풀린 그림 하나의 문제 — 그 그림을 쓰는 연결만 빠진다. 숨기지 않는다. */
export interface AssetProblem {
  readonly assetId: string
  readonly reason: 'missing-file' | 'invalid-image' | 'hash-mismatch'
}

export interface UnpackedArtwork {
  readonly assets: readonly NewAsset[]
  readonly problems: readonly AssetProblem[]
}

/**
 * `assets` 목록(패키지의 그림 메타)과 파일을 풀어 다시 검증한다. 같은 id 가 두 번이면 `null` (패키지를 받지 않는다).
 */
export async function unpackAssets(
  list: unknown,
  files: ReadonlyMap<string, Uint8Array>,
  tools: ImageTools,
  now: Date,
): Promise<UnpackedArtwork | null> {
  if (!Array.isArray(list)) return null
  const seen = new Set<string>()
  const assets: NewAsset[] = []
  const problems: AssetProblem[] = []
  for (const entry of list as unknown[]) {
    if (!isRecord(entry) || !isArtworkAssetId(entry.id)) return null
    if (!(ARTWORK_MIME_TYPES as readonly unknown[]).includes(entry.mimeType)) return null
    const id = entry.id
    if (seen.has(id)) return null
    seen.add(id)
    const bytes = files.get(assetPath(id, entry.mimeType as ArtworkMimeType))
    if (bytes === undefined) {
      problems.push({ assetId: id, reason: 'missing-file' })
      continue
    }
    const result = await validateArtwork(new Blob([bytes as Uint8Array<ArrayBuffer>]), tools)
    if (!result.ok) {
      problems.push({ assetId: id, reason: 'invalid-image' })
      continue
    }
    if (result.artwork.id !== id || result.artwork.mimeType !== entry.mimeType) {
      problems.push({ assetId: id, reason: 'hash-mismatch' })
      continue
    }
    assets.push({
      asset: {
        id,
        mimeType: result.artwork.mimeType,
        byteSize: result.artwork.byteSize,
        width: result.artwork.width,
        height: result.artwork.height,
        animated: result.artwork.animated,
        createdAt: now.toISOString(),
      },
      blob: result.artwork.blob,
      poster: result.artwork.poster,
    })
  }
  return { assets, problems }
}

/** 패키지의 선호 하나를 검증한다 — 모르는 모양이면 `null`. */
export function readPackedPreference(value: unknown): PackedPreference | null {
  if (!isRecord(value)) return null
  if (value.mode === 'default') return { mode: 'default' }
  if (value.mode === 'custom' && isArtworkAssetId(value.assetId)) {
    return { mode: 'custom', assetId: value.assetId }
  }
  return null
}

export { isRecord }
