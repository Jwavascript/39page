/**
 * 파일 공유 패키지 — `39page-share` ZIP (M12-4, ADR 0034 · ARTWORK_DESIGN §8).
 *
 * ```text
 * manifest.json   파일 목록 · 크기 · SHA-256
 * share.json      { kind, playlist: { sourceId, name, tracks: [{ sourceId, videoId, title, artwork? }] }, assets, moments? }
 * assets/<sha256>.<ext>
 * ```
 *
 * **넣는 것만 넣는다**: 고른 곡(한 곡 또는 한 목록)의 제목 · 영상 · 순서 · 그림. 다른 목록 · 선택 상태 · 테마는 넣지
 * 않고, Moments 는 부르는 쪽이 켰을 때 그 곡들의 영상 것만 넣는다. 보낸 쪽 id 는 `sourceId` 로만 남긴다 — 받는 쪽은
 * 새 id 를 만든다 (장래 커뮤니티 공유에서 같은 출처를 알아보는 안정 식별자).
 *
 * 순수 함수다 — store · 저장소를 읽지 않는다.
 */
import type { ImageTools } from '@/features/artwork/imageValidation'
import type { Moment, Playlist } from '@/shared/types'
import { trackKeyString } from '@/shared/types/artwork'
import { isYouTubeVideoId } from '@/shared/utils/youtube'

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
  type IncompleteArtwork,
  type PackedPreference,
  type PackInput,
  type UnpackedArtwork,
} from './packageFormat'
import { buildZip, readZip, ZIP_ERROR_MESSAGE } from './zipPackage'

export const SHARE_FORMAT = '39page-share'
export const SHARE_VERSION = 2
/** 한 패키지의 곡 수 상한 — 손상 · 악의적인 파일로 라이브러리를 부풀리지 않게. */
export const MAX_SHARE_TRACKS = 2000
export const MAX_SHARE_MOMENTS = 10000

export type ShareKind = 'track' | 'playlist'

export interface SharedTrack {
  readonly sourceId: string
  readonly videoId: string
  readonly title: string
  readonly artwork: PackedPreference | null
}

export interface SharedMoment {
  readonly videoId: string
  readonly atSeconds: number
  readonly note: string
  readonly title: string
  readonly createdAt: string
}

export interface ShareBuild {
  readonly bytes: Uint8Array
  readonly tracks: number
  readonly images: number
  readonly moments: number
  readonly incomplete: readonly IncompleteArtwork[]
}

/** 공유 패키지를 만든다. `trackIds` 순서대로 넣는다 (목록이면 목록 순서 그대로). */
export async function createSharePackage(input: {
  readonly kind: ShareKind
  readonly playlist: Playlist
  readonly trackIds: readonly string[]
  readonly artwork: PackInput | null
  /** 넣을 Moments — 켰을 때만. 이 함수가 그 곡들의 영상 것만 남긴다. */
  readonly moments: readonly Moment[] | null
  readonly now: Date
  readonly sha256: (bytes: Uint8Array) => Promise<string>
}): Promise<ShareBuild> {
  const wanted = new Set(input.trackIds)
  const tracks = input.playlist.tracks.filter((track) => wanted.has(track.id))
  const keys = new Set(
    tracks.map((track) => trackKeyString({ playlistId: input.playlist.id, trackId: track.id })),
  )

  const packed =
    input.artwork === null
      ? { assignments: [], assets: [], files: [], incomplete: [] }
      : await packArtwork(
          {
            ...input.artwork,
            assignments: input.artwork.assignments.filter((assignment) =>
              keys.has(trackKeyString(assignment)),
            ),
          },
          input.sha256,
        )
  const preferenceOf = new Map(
    packed.assignments.map((assignment) => [
      assignment.trackId,
      assignment.mode === 'custom'
        ? {
            mode: 'custom' as const,
            assetId: assignment.assetId ?? '',
            ...(assignment.display !== undefined ? { display: assignment.display } : {}),
          }
        : { mode: 'default' as const },
    ]),
  )

  const videoIds = new Set(tracks.map((track) => track.videoId))
  const moments =
    input.moments === null
      ? null
      : input.moments
          .filter((moment) => videoIds.has(moment.videoId))
          .map((moment): SharedMoment => ({
            videoId: moment.videoId,
            atSeconds: moment.atSeconds,
            note: moment.note,
            title: moment.title,
            createdAt: moment.createdAt,
          }))

  const share = {
    version: SHARE_VERSION,
    kind: input.kind,
    playlist: {
      sourceId: input.playlist.id,
      name: input.playlist.name,
      tracks: tracks.map((track) => ({
        sourceId: track.id,
        videoId: track.videoId,
        title: track.title,
        ...(preferenceOf.has(track.id) ? { artwork: preferenceOf.get(track.id) } : {}),
      })),
    },
    assets: packed.assets,
    ...(moments === null ? {} : { moments }),
  }
  const files = [{ path: 'share.json', bytes: encodeJson(share), compress: true }, ...packed.files]
  const manifest = await buildManifest(
    {
      format: SHARE_FORMAT,
      formatVersion: SHARE_VERSION,
      createdAt: input.now.toISOString(),
      contents: moments === null ? ['share'] : ['share', 'moments'],
      ...(packed.incomplete.length > 0 ? { incomplete: packed.incomplete } : {}),
    },
    files,
    input.sha256,
    new Map(packed.assets.map((asset) => [asset.id, asset.mimeType])),
  )
  return {
    bytes: buildZip([
      { path: 'manifest.json', bytes: encodeJson(manifest), compress: true },
      ...files,
    ]),
    tracks: tracks.length,
    images: packed.assets.length,
    moments: moments?.length ?? 0,
    incomplete: packed.incomplete,
  }
}

/** 파일 이름에 쓸 수 없는 글자를 걷어낸다. */
export function shareFileName(name: string): string {
  // 제어 문자(0x00 ~ 0x1f)도 걷어낸다 — 정규식 대신 글자 코드로 (lint: no-control-regex).
  const safe = [...name.replace(/[\\/:*?"<>|]/g, '_')]
    .map((char) => (char.charCodeAt(0) < 0x20 ? '_' : char))
    .join('')
    .trim()
    .slice(0, 60)
  return `${safe === '' ? '39page' : safe}.39page-share.zip`
}

/* ------------------------------------------------------------------ *
 * 읽기
 * ------------------------------------------------------------------ */

export type ShareRead =
  | {
      readonly ok: true
      readonly kind: ShareKind
      readonly name: string
      readonly tracks: readonly SharedTrack[]
      readonly artwork: UnpackedArtwork
      /** 패키지에 Moments 가 들어 있는지 (`null` = 안 들어 있음). */
      readonly moments: readonly SharedMoment[] | null
      /** 그림을 받지 못하는 곡 수 — 그 곡은 자동(썸네일)으로 보인다. */
      readonly droppedArtwork: number
    }
  | { readonly ok: false; readonly message: string }

function readTrack(value: unknown): SharedTrack | null {
  if (!isRecord(value)) return null
  if (typeof value.sourceId !== 'string' || !isYouTubeVideoId(value.videoId)) return null
  if (typeof value.title !== 'string') return null
  const artwork = value.artwork === undefined ? null : readPackedPreference(value.artwork)
  if (value.artwork !== undefined && artwork === null) return null
  return { sourceId: value.sourceId, videoId: value.videoId, title: value.title, artwork }
}

function readMoment(value: unknown): SharedMoment | null {
  if (!isRecord(value) || !isYouTubeVideoId(value.videoId)) return null
  const at = value.atSeconds
  if (typeof at !== 'number' || !Number.isInteger(at) || at < 0) return null
  if (typeof value.note !== 'string' || typeof value.title !== 'string') return null
  return {
    videoId: value.videoId,
    atSeconds: at,
    note: value.note,
    title: value.title,
    createdAt: typeof value.createdAt === 'string' ? value.createdAt : '',
  }
}

/** 공유 패키지를 읽고 **모두** 검증한다. 아무것도 쓰지 않는다. */
export async function readSharePackage(
  bytes: Uint8Array,
  tools: ImageTools,
  now: Date,
): Promise<ShareRead> {
  const zip = readZip(bytes, packagePolicy(['manifest.json', 'share.json']))
  if (!zip.ok) return { ok: false, message: ZIP_ERROR_MESSAGE[zip.error.kind] }
  const verified = await verifyManifest(zip.files, SHARE_FORMAT, SHARE_VERSION, tools.sha256)
  if (!verified.ok) return { ok: false, message: MANIFEST_PROBLEM_MESSAGE(verified.problem) }

  const share = decodeJson(zip.files.get('share.json'))
  if (!isRecord(share) || (share.version !== 1 && share.version !== SHARE_VERSION)) {
    return { ok: false, message: '공유 내용(share.json)을 읽을 수 없습니다.' }
  }
  if (share.kind !== 'track' && share.kind !== 'playlist') {
    return { ok: false, message: '공유 내용의 종류를 알 수 없습니다.' }
  }
  const playlist = share.playlist
  if (!isRecord(playlist) || typeof playlist.name !== 'string' || !Array.isArray(playlist.tracks)) {
    return { ok: false, message: '공유한 목록을 읽을 수 없습니다.' }
  }
  if (playlist.tracks.length === 0 || playlist.tracks.length > MAX_SHARE_TRACKS) {
    return { ok: false, message: '공유한 곡 수가 올바르지 않습니다.' }
  }
  const tracks: SharedTrack[] = []
  for (const raw of playlist.tracks as unknown[]) {
    const track = readTrack(raw)
    if (track === null) return { ok: false, message: '공유한 곡 중 읽을 수 없는 것이 있습니다.' }
    tracks.push(track)
  }

  const unpacked = await unpackAssets(share.assets ?? [], zip.files, tools, now)
  if (unpacked === null) return { ok: false, message: '공유한 그림 목록이 올바르지 않습니다.' }
  const good = new Set(unpacked.assets.map((item) => item.asset.id))
  let droppedArtwork = 0
  const checked = tracks.map((track) => {
    if (track.artwork?.mode === 'custom' && !good.has(track.artwork.assetId ?? '')) {
      droppedArtwork += 1
      return { ...track, artwork: null }
    }
    return track
  })

  let moments: SharedMoment[] | null = null
  if (share.moments !== undefined) {
    if (!Array.isArray(share.moments) || share.moments.length > MAX_SHARE_MOMENTS) {
      return { ok: false, message: '공유한 Moments 를 읽을 수 없습니다.' }
    }
    moments = []
    for (const raw of share.moments as unknown[]) {
      const moment = readMoment(raw)
      if (moment === null)
        return { ok: false, message: '공유한 Moments 중 읽을 수 없는 것이 있습니다.' }
      moments.push(moment)
    }
  }

  return {
    ok: true,
    kind: share.kind,
    name: playlist.name.trim() === '' ? '공유받은 목록' : playlist.name,
    tracks: checked,
    artwork: unpacked,
    moments,
    droppedArtwork,
  }
}
