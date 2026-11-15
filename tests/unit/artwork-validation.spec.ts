/**
 * M12-3 — 앨범아트 이미지 검증 (ARTWORK_DESIGN §4).
 *
 * 형식은 내용으로 정한다 · 한도 · 움직이는 WebP 거절 · GIF 프레임 · 디코딩 실패 · 픽셀 한도 · 포스터 · 해시.
 */
import { describe, expect, it } from 'vitest'

import {
  ARTWORK_LIMITS,
  countGifFrames,
  isAnimatedWebp,
  sha256Hex,
  sniffImageType,
  validateArtwork,
} from '@/features/artwork/imageValidation'
import { formatBytes } from '@/shared/utils/bytes'

import {
  animatedWebpBytes,
  fakeImageTools,
  fileOf,
  gifBytes,
  jpegBytes,
  pngBytes,
  webpBytes,
} from '../support/artworkFixtures'

describe('A. 형식 — 내용(매직 바이트)으로', () => {
  it('PNG · JPEG · GIF · WebP 를 알아본다', () => {
    expect(sniffImageType(pngBytes())).toBe('image/png')
    expect(sniffImageType(jpegBytes())).toBe('image/jpeg')
    expect(sniffImageType(gifBytes(1))).toBe('image/gif')
    expect(sniffImageType(webpBytes())).toBe('image/webp')
  })

  it('SVG · HTML · 동영상 · 빈 바이트는 모른다', () => {
    const text = (value: string) => new TextEncoder().encode(value)
    expect(
      sniffImageType(text('<svg xmlns="http://www.w3.org/2000/svg"><script>1</script></svg>')),
    ).toBeNull()
    expect(sniffImageType(text('<!doctype html><html><script>alert(1)</script>'))).toBeNull()
    expect(sniffImageType(new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70]))).toBeNull() // mp4
    expect(sniffImageType(new Uint8Array())).toBeNull()
  })

  it('GIF 프레임을 블록 구조로 센다 — 하나면 정지, 둘 이상이면 움직임', () => {
    expect(countGifFrames(gifBytes(1))).toBe(1)
    expect(countGifFrames(gifBytes(3))).toBe(2) // 2 에서 멈춘다 (더 셀 필요가 없다)
    expect(countGifFrames(gifBytes(3), 10)).toBe(3)
    expect(countGifFrames(new Uint8Array([0x47, 0x49]))).toBe(0)
  })

  it('움직이는 WebP 를 알아본다', () => {
    expect(isAnimatedWebp(animatedWebpBytes())).toBe(true)
    expect(isAnimatedWebp(webpBytes())).toBe(false)
  })
})

describe('B. 검증', () => {
  it('정지 PNG — 형식 · 크기 · 해시(SHA-256 = 자산 id), 포스터 없음', async () => {
    const data = pngBytes(1)
    const result = await validateArtwork(fileOf(data, 'a.png'), fakeImageTools())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.artwork.mimeType).toBe('image/png')
    expect(result.artwork.byteSize).toBe(data.length)
    expect(result.artwork.id).toBe(await sha256Hex(data))
    expect(result.artwork.id).toMatch(/^[0-9a-f]{64}$/)
    expect(result.artwork.animated).toBe(false)
    expect(result.artwork.poster).toBeNull()
    expect(result.artwork.blob.type).toBe('image/png')
  })

  it('확장자 · File.type 을 믿지 않는다 — 내용이 GIF 면 GIF 다', async () => {
    const result = await validateArtwork(
      fileOf(gifBytes(1), 'photo.png', 'image/png'),
      fakeImageTools(),
    )
    expect(result.ok && result.artwork.mimeType).toBe('image/gif')
    expect(result.ok && result.artwork.blob.type).toBe('image/gif')
  })

  it('SVG 를 PNG 라고 해도 거절한다', async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>'
    const result = await validateArtwork(fileOf(svg, 'evil.png', 'image/png'), fakeImageTools())
    expect(result).toEqual({ ok: false, reason: 'unsupported-type' })
  })

  it('움직이는 GIF — 포스터(첫 프레임)를 만든다', async () => {
    const tools = fakeImageTools()
    const result = await validateArtwork(fileOf(gifBytes(2), 'a.gif'), tools)
    expect(result.ok && result.artwork.animated).toBe(true)
    expect(result.ok && result.artwork.poster).not.toBeNull()
    expect(tools.posters).toBe(1)
  })

  it('움직이는 WebP 는 이번 범위에서 거절한다 (GIF 로 안내)', async () => {
    const result = await validateArtwork(fileOf(animatedWebpBytes(), 'a.webp'), fakeImageTools())
    expect(result).toEqual({ ok: false, reason: 'animated-webp' })
  })

  it('디코딩이 실패하면(손상) 거절한다', async () => {
    const result = await validateArtwork(
      fileOf(pngBytes(), 'broken.png'),
      fakeImageTools({ failDecode: true }),
    )
    expect(result).toEqual({ ok: false, reason: 'decode-failed' })
  })

  it('가로 · 세로 4,096px 을 넘으면 거절한다', async () => {
    const tools = fakeImageTools({ dimensions: { width: 4097, height: 100 } })
    const result = await validateArtwork(fileOf(pngBytes(), 'big.png'), tools)
    expect(result).toEqual({ ok: false, reason: 'too-many-pixels' })
  })

  it('빈 파일 · 크기 한도 — 정지 5 MB, GIF 12 MB', async () => {
    expect(await validateArtwork(fileOf(new Uint8Array(), 'e.png'), fakeImageTools())).toEqual({
      ok: false,
      reason: 'empty',
    })
    const stillOver = new Uint8Array(ARTWORK_LIMITS.stillBytes + 1)
    stillOver.set(pngBytes())
    expect(await validateArtwork(fileOf(stillOver, 'big.png'), fakeImageTools())).toEqual({
      ok: false,
      reason: 'too-large',
    })
    // 같은 크기의 GIF 는 들어간다 (12 MB 한도).
    const gifOk = new Uint8Array(ARTWORK_LIMITS.stillBytes + 1)
    gifOk.set(gifBytes(1))
    expect((await validateArtwork(fileOf(gifOk, 'big.gif'), fakeImageTools())).ok).toBe(true)
    // 12 MB 를 넘으면 읽지도 않고 거절한다.
    const tools = fakeImageTools()
    const gifOver = new Uint8Array(ARTWORK_LIMITS.gifBytes + 1)
    gifOver.set(gifBytes(1))
    expect(await validateArtwork(fileOf(gifOver, 'huge.gif'), tools)).toEqual({
      ok: false,
      reason: 'too-large',
    })
    expect(tools.decoded).toBe(0)
  })

  it('크기 표기', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(5 * 1024 * 1024)).toBe('5 MB')
    expect(formatBytes(1536)).toBe('1.5 KB')
    expect(formatBytes(Number.NaN)).toBe('0 B')
  })
})
