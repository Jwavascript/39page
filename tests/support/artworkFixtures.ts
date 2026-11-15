/**
 * 앨범아트 시험용 바이트 · 도구 (M12-3).
 *
 * 실제 이미지를 디코딩하지 않는다 — jsdom · Node 에는 `createImageBitmap` 이 없다. 형식 판별(매직 바이트) ·
 * GIF 프레임 수 · 움직이는 WebP 판별은 **실제 바이트 구조**로 시험하고, 디코딩 결과는 가짜 도구가 정한다.
 * 실제 디코딩은 M12-5 의 실제 Chrome 시험이 본다.
 */
import { sha256Hex, type ImageTools } from '@/features/artwork/imageValidation'

const bytes = (...parts: (number[] | string)[]): Uint8Array<ArrayBuffer> => {
  const out: number[] = []
  for (const part of parts) {
    if (typeof part === 'string') for (const char of part) out.push(char.charCodeAt(0))
    else out.push(...part)
  }
  return new Uint8Array(out)
}

const le32 = (value: number) => [
  value & 0xff,
  (value >> 8) & 0xff,
  (value >> 16) & 0xff,
  (value >>> 24) & 0xff,
]

/** PNG 서명 + 아무 내용. `seed` 로 내용(해시)을 바꾼다. */
export function pngBytes(seed = 0, size = 64): Uint8Array<ArrayBuffer> {
  const body = Array.from({ length: Math.max(0, size - 8) }, (_, index) => (index + seed) % 256)
  return bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], body)
}

export function jpegBytes(): Uint8Array<ArrayBuffer> {
  return bytes([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10], 'JFIF', [0, 1, 2, 3, 4, 5])
}

/** GIF89a, 1×1, 전역 색표 없음, 프레임 `frames` 개. 프레임 사이에 그래픽 제어 확장. */
export function gifBytes(frames: number, seed = 0): Uint8Array<ArrayBuffer> {
  const out: number[] = [...bytes('GIF89a'), 1, 0, 1, 0, 0x00, 0, 0]
  for (let index = 0; index < frames; index += 1) {
    out.push(0x21, 0xf9, 0x04, 0x00, 0x0a, 0x00, 0x00, 0x00) // 그래픽 제어 확장
    out.push(0x2c, 0, 0, 0, 0, 1, 0, 1, 0, 0x00) // 이미지 서술자
    out.push(0x02, 0x02, 0x44, (0x01 + seed) % 256, 0x00) // LZW 최소 코드 + 하위 블록 + 끝
  }
  out.push(0x3b)
  return new Uint8Array(out)
}

/** 정지 WebP — `VP8 ` 청크 하나. */
export function webpBytes(): Uint8Array<ArrayBuffer> {
  const chunk = bytes('VP8 ', le32(4), [1, 2, 3, 4])
  return bytes('RIFF', le32(4 + chunk.length), 'WEBP', [...chunk])
}

/** 움직이는 WebP — `VP8X` 의 애니메이션 비트(0x02). */
export function animatedWebpBytes(): Uint8Array<ArrayBuffer> {
  const vp8x = bytes('VP8X', le32(10), [0x02, 0, 0, 0, 0, 0, 0, 0, 0, 0])
  return bytes('RIFF', le32(4 + vp8x.length), 'WEBP', [...vp8x])
}

export function fileOf(data: Uint8Array<ArrayBuffer> | string, name: string, type = ''): File {
  return new File([data], name, { type })
}

/**
 * 가짜 도구 — 디코딩은 `dimensions` 를 돌려주고, `failDecode` 면 던진다. 포스터는 작은 PNG. 해시는 진짜 SHA-256.
 */
export function fakeImageTools(
  options: { dimensions?: { width: number; height: number }; failDecode?: boolean } = {},
): ImageTools & { decoded: number; posters: number } {
  const tools = {
    decoded: 0,
    posters: 0,
    async decode() {
      tools.decoded += 1
      if (options.failDecode === true) throw new Error('decode failed')
      return options.dimensions ?? { width: 320, height: 320 }
    },
    async poster() {
      tools.posters += 1
      return new Blob([pngBytes(99, 16)], { type: 'image/png' })
    },
    sha256: sha256Hex,
  }
  return tools
}

/** Object URL 기록기 — 만든 수 · 지운 수를 센다 (누수 시험). */
export function recordingUrls() {
  let next = 0
  const live = new Set<string>()
  const api = {
    created: 0,
    revoked: 0,
    live,
    create(_blob: Blob): string {
      next += 1
      api.created += 1
      const url = `blob:test/${String(next)}`
      live.add(url)
      return url
    },
    revoke(url: string): void {
      api.revoked += 1
      live.delete(url)
    },
  }
  return api
}
