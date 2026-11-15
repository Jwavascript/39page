/**
 * 앨범아트 이미지 검증 (M12-3, ARTWORK_DESIGN §4).
 *
 * 1. 크기 한도 — 읽기 전에
 * 2. 형식 — **내용(매직 바이트)** 으로. 확장자 · `File.type` 을 믿지 않는다. SVG · HTML · 동영상 · 그 밖은 거절
 * 3. 움직이는 WebP — 초기 범위에서 거절 (검증 수단이 없다. TODO: M12 이후)
 * 4. GIF 프레임 수 — 둘 이상이면 움직이는 그림
 * 5. **실제 디코딩** — 성공해야 하고 폭 · 높이가 1 이상 · 한도 이하
 * 6. 포스터 — 움직이는 GIF 의 첫 프레임 (PNG)
 * 7. 해시 — SHA-256 → 자산 id
 *
 * 디코더 · 포스터 · 해시는 주입한다 — jsdom 에는 `createImageBitmap` · 캔버스가 없다. 브라우저 기본값은
 * `browserImageTools()`.
 */
import type { InjectionKey } from 'vue'

import type { ArtworkMimeType } from '@/shared/types/artwork'

/** 초기 권장 한도 (ARTWORK_DESIGN §3-5). 확정 사양이 아니다 — M12-5 측정 뒤 문서에 확정한다. */
export const ARTWORK_LIMITS = {
  stillBytes: 5 * 1024 * 1024,
  gifBytes: 12 * 1024 * 1024,
  maxDimension: 4096,
} as const

export type ArtworkRejectReason =
  | 'empty'
  | 'too-large'
  | 'unsupported-type'
  | 'animated-webp'
  | 'decode-failed'
  | 'too-many-pixels'
  | 'read-failed'

export const REJECT_MESSAGE: Readonly<Record<ArtworkRejectReason, string>> = {
  empty: '빈 파일입니다.',
  'too-large': '파일이 너무 큽니다 — 정지 이미지는 5 MB, GIF 는 12 MB 까지예요.',
  'unsupported-type': 'PNG · JPEG · WebP · GIF 이미지만 쓸 수 있어요.',
  'animated-webp': '움직이는 WebP 는 아직 지원하지 않아요. 움직이는 그림은 GIF 로 올려 주세요.',
  'decode-failed': '이미지가 손상되었거나 읽을 수 없습니다.',
  'too-many-pixels': '이미지가 너무 큽니다 — 가로 · 세로 4,096px 까지예요.',
  'read-failed': '파일을 읽지 못했습니다.',
}

export interface DecodedImage {
  readonly width: number
  readonly height: number
}

export interface ImageTools {
  /** 디코딩. 실패하면 던진다. */
  decode(blob: Blob): Promise<DecodedImage>
  /** 첫 프레임을 PNG 로. 실패하면 던진다. */
  poster(blob: Blob): Promise<Blob>
  /** SHA-256 16진수. */
  sha256(bytes: Uint8Array): Promise<string>
}

export interface ValidatedArtwork {
  readonly id: string
  /** 검증한 형식을 다시 붙인 원본 바이트. */
  readonly blob: Blob
  readonly poster: Blob | null
  readonly mimeType: ArtworkMimeType
  readonly byteSize: number
  readonly width: number
  readonly height: number
  readonly animated: boolean
}

export type ArtworkValidation =
  | { readonly ok: true; readonly artwork: ValidatedArtwork }
  | { readonly ok: false; readonly reason: ArtworkRejectReason }

const startsWith = (bytes: Uint8Array, signature: readonly number[], offset = 0): boolean =>
  bytes.length >= offset + signature.length &&
  signature.every((value, index) => bytes[offset + index] === value)

const ascii = (bytes: Uint8Array, offset: number, length: number): string =>
  String.fromCharCode(...bytes.subarray(offset, offset + length))

/** 매직 바이트로 형식을 정한다. 모르면 `null`. */
export function sniffImageType(bytes: Uint8Array): ArtworkMimeType | null {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png'
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg'
  if (bytes.length >= 6 && (ascii(bytes, 0, 6) === 'GIF87a' || ascii(bytes, 0, 6) === 'GIF89a')) {
    return 'image/gif'
  }
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') {
    return 'image/webp'
  }
  return null
}

/** WebP 가 움직이는 그림인가 — `VP8X` 의 애니메이션 비트 또는 `ANIM` 청크. */
export function isAnimatedWebp(bytes: Uint8Array): boolean {
  let offset = 12
  while (offset + 8 <= bytes.length) {
    const fourcc = ascii(bytes, offset, 4)
    // 부호 없는 32비트 리틀 엔디언. 큰 값이면 아래에서 배열 끝을 넘어 반복이 끝난다.
    const size =
      ((bytes[offset + 4] ?? 0) |
        ((bytes[offset + 5] ?? 0) << 8) |
        ((bytes[offset + 6] ?? 0) << 16) |
        ((bytes[offset + 7] ?? 0) << 24)) >>>
      0
    if (fourcc === 'VP8X' && ((bytes[offset + 8] ?? 0) & 0x02) !== 0) return true
    if (fourcc === 'ANIM' || fourcc === 'ANMF') return true
    offset += 8 + size + (size % 2)
  }
  return false
}

/**
 * GIF 의 이미지 프레임 수. 블록 구조를 걸어 이미지 서술자(0x2C)를 센다 — 깨진 파일이면 그때까지 센 수.
 * 2 를 넘으면 더 셀 필요가 없다 (`limit`).
 */
export function countGifFrames(bytes: Uint8Array, limit = 2): number {
  if (bytes.length < 13) return 0
  let offset = 13
  const packed = bytes[10] ?? 0
  if ((packed & 0x80) !== 0) offset += 3 * 2 ** ((packed & 0x07) + 1)

  const skipSubBlocks = (): boolean => {
    while (offset < bytes.length) {
      const size = bytes[offset] ?? 0
      offset += 1
      if (size === 0) return true
      offset += size
    }
    return false
  }

  let frames = 0
  while (offset < bytes.length) {
    const marker = bytes[offset]
    if (marker === 0x3b) break
    if (marker === 0x21) {
      offset += 2 // 0x21 + 라벨
      if (!skipSubBlocks()) break
      continue
    }
    if (marker === 0x2c) {
      frames += 1
      if (frames >= limit) return frames
      const local = bytes[offset + 9] ?? 0
      offset += 10
      if ((local & 0x80) !== 0) offset += 3 * 2 ** ((local & 0x07) + 1)
      offset += 1 // LZW 최소 코드 크기
      if (!skipSubBlocks()) break
      continue
    }
    break
  }
  return frames
}

/** 형식별 크기 한도. */
export function byteLimitFor(mimeType: ArtworkMimeType): number {
  return mimeType === 'image/gif' ? ARTWORK_LIMITS.gifBytes : ARTWORK_LIMITS.stillBytes
}

/**
 * 파일 하나를 검증한다. **아무것도 저장하지 않는다.** 백업 · 공유 패키지에서 꺼낸 바이트도 같은 함수로
 * 다시 검증한다 (ARTWORK_DESIGN §7-2).
 */
export async function validateArtwork(file: Blob, tools: ImageTools): Promise<ArtworkValidation> {
  if (file.size === 0) return { ok: false, reason: 'empty' }
  // 읽기 전에 가장 큰 한도로 먼저 거른다 — 형식은 읽어야 안다.
  if (file.size > ARTWORK_LIMITS.gifBytes) return { ok: false, reason: 'too-large' }

  let bytes: Uint8Array<ArrayBuffer>
  try {
    bytes = new Uint8Array(await file.arrayBuffer())
  } catch {
    return { ok: false, reason: 'read-failed' }
  }

  const mimeType = sniffImageType(bytes)
  if (mimeType === null) return { ok: false, reason: 'unsupported-type' }
  if (bytes.length > byteLimitFor(mimeType)) return { ok: false, reason: 'too-large' }
  if (mimeType === 'image/webp' && isAnimatedWebp(bytes)) {
    return { ok: false, reason: 'animated-webp' }
  }

  // 형식을 다시 붙인다 — 사용자가 준 `type` 을 쓰지 않는다.
  const blob = new Blob([bytes], { type: mimeType })

  let decoded: DecodedImage
  try {
    decoded = await tools.decode(blob)
  } catch {
    return { ok: false, reason: 'decode-failed' }
  }
  if (!(decoded.width >= 1 && decoded.height >= 1)) return { ok: false, reason: 'decode-failed' }
  if (decoded.width > ARTWORK_LIMITS.maxDimension || decoded.height > ARTWORK_LIMITS.maxDimension) {
    return { ok: false, reason: 'too-many-pixels' }
  }

  const animated = mimeType === 'image/gif' && countGifFrames(bytes) >= 2
  let poster: Blob | null = null
  if (animated) {
    try {
      poster = await tools.poster(blob)
    } catch {
      return { ok: false, reason: 'decode-failed' }
    }
  }

  const id = await tools.sha256(bytes)
  return {
    ok: true,
    artwork: {
      id,
      blob,
      poster,
      mimeType,
      byteSize: bytes.length,
      width: decoded.width,
      height: decoded.height,
      animated,
    },
  }
}

/** SHA-256 16진수 — Web Crypto. 보안 컨텍스트(https · localhost)에서만 있다. */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const subtle = globalThis.crypto?.subtle as SubtleCrypto | undefined
  if (subtle === undefined)
    throw new Error('SHA-256 을 쓸 수 없는 환경입니다 (보안 컨텍스트 아님).')
  const digest = await subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>)
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

/** 브라우저의 디코더 · 캔버스 · Web Crypto. */
export function browserImageTools(): ImageTools {
  return {
    async decode(blob) {
      const bitmap = await createImageBitmap(blob)
      const size = { width: bitmap.width, height: bitmap.height }
      bitmap.close()
      return size
    },
    async poster(blob) {
      const bitmap = await createImageBitmap(blob)
      try {
        if (typeof OffscreenCanvas === 'function') {
          const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
          const context = canvas.getContext('2d')
          if (context === null) throw new Error('no 2d context')
          context.drawImage(bitmap, 0, 0)
          return await canvas.convertToBlob({ type: 'image/png' })
        }
        const canvas = document.createElement('canvas')
        canvas.width = bitmap.width
        canvas.height = bitmap.height
        const context = canvas.getContext('2d')
        if (context === null) throw new Error('no 2d context')
        context.drawImage(bitmap, 0, 0)
        return await new Promise<Blob>((resolve, reject) => {
          canvas.toBlob(
            (made) => (made === null ? reject(new Error('toBlob')) : resolve(made)),
            'image/png',
          )
        })
      } finally {
        bitmap.close()
      }
    },
    sha256: sha256Hex,
  }
}

/** 화면이 쓰는 도구 — 시험이 가짜 디코더를 주입한다. 없으면 `browserImageTools()`. */
export const ARTWORK_IMAGE_TOOLS: InjectionKey<ImageTools> = Symbol('artwork-image-tools')
