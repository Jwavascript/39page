/**
 * 곡별 앨범아트 (M12-3, ADR 0033 · `docs/architecture/ARTWORK_DESIGN.md` §2).
 *
 * 순수 데이터만 둔다. 저장은 `features/artwork/artworkRepository.ts` (IndexedDB), 화면이 읽는 경계는
 * `stores/artwork.ts` 다. 라이브러리 · Moments 의 저장 형식은 바꾸지 않는다 — 연결은 별도 저장소에 있다.
 */

/** 지원하는 이미지 형식. 내용(매직 바이트)으로 정한다 — 확장자 · `File.type` 을 믿지 않는다. */
export type ArtworkMimeType = 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'

export const ARTWORK_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
] as const satisfies readonly ArtworkMimeType[]

/** 파일 확장자 (백업 · 공유 패키지의 `assets/<id>.<ext>`). */
export const ARTWORK_EXTENSION: Readonly<Record<ArtworkMimeType, string>> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
}

/**
 * 트랙의 선호. 연결 레코드가 없으면 `auto` 다 — 기존 트랙을 고치지 않는다.
 *
 * - `auto` — YouTube 썸네일 → 실패하면 기본 그림
 * - `default` — 사용자가 39page 기본 그림을 골랐다 (썸네일을 받지 않는다)
 * - `custom` — 사용자가 올린 이미지
 */
export type ArtworkPreference =
  | { readonly mode: 'auto' }
  | { readonly mode: 'default' }
  | { readonly mode: 'custom'; readonly assetId: string }

/** 트랙 하나를 가리키는 키. 같은 영상의 여러 트랙 · 목록끼리 같은 트랙 id 를 구분한다. */
export interface TrackKey {
  readonly playlistId: string
  readonly trackId: string
}

/** IndexedDB `assignments` 의 레코드. `auto` 는 저장하지 않는다. */
export interface ArtworkAssignment {
  /** 원본 바이트와 독립적인 트랙별 표시 설정. 생략하면 기본값. */
  readonly display?: ArtworkDisplay
  readonly playlistId: string
  readonly trackId: string
  /** 연결할 때의 영상 — 진단 · 공유 · 고아 정리에 쓴다. 표시 판단에는 쓰지 않는다. */
  readonly videoId: string
  readonly mode: 'default' | 'custom'
  /** `mode === 'custom'` 일 때만. */
  readonly assetId?: string
  /** 이 연결의 수정 번호 (탭 간 충돌 판정). 1 부터. */
  readonly revision: number
  readonly updatedAt: string
}

export interface ArtworkDisplay {
  readonly fit: 'cover' | 'contain'
  readonly positionX: number
  readonly positionY: number
  readonly zoom: number
}

export const DEFAULT_ARTWORK_DISPLAY: Readonly<ArtworkDisplay> = Object.freeze({
  fit: 'cover',
  positionX: 50,
  positionY: 50,
  zoom: 1,
})

/** 생략은 구버전 기본값, 잘못된 값은 null. NaN·무한·범위 밖·부분 객체를 받지 않는다. */
export function readArtworkDisplay(value: unknown): ArtworkDisplay | null {
  if (value === undefined) return { ...DEFAULT_ARTWORK_DISPLAY }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const data = value as Record<string, unknown>
  const within = (n: unknown, min: number, max: number): n is number =>
    typeof n === 'number' && Number.isFinite(n) && n >= min && n <= max
  if (
    (data.fit !== 'cover' && data.fit !== 'contain') ||
    !within(data.positionX, 0, 100) ||
    !within(data.positionY, 0, 100) ||
    !within(data.zoom, 1, 3)
  )
    return null
  return { fit: data.fit, positionX: data.positionX, positionY: data.positionY, zoom: data.zoom }
}

/** 자산 메타데이터. id 는 내용의 SHA-256 (16진수 64자) — 같은 파일은 한 번만 저장된다. */
export interface ArtworkAsset {
  readonly id: string
  readonly mimeType: ArtworkMimeType
  readonly byteSize: number
  readonly width: number
  readonly height: number
  /** GIF 의 프레임이 둘 이상. */
  readonly animated: boolean
  readonly createdAt: string
}

/** 자산 id 형식 — SHA-256 16진수. 경로 · 파일 이름에 그대로 쓰므로 엄격히 본다. */
export function isArtworkAssetId(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value)
}

/** 트랙 키를 한 문자열로 (메모리 색인용). 저장 형식이 아니다. */
export function trackKeyString(key: TrackKey): string {
  return JSON.stringify([key.playlistId, key.trackId])
}
