/**
 * M12-4 — ZIP 읽기 보안 규칙 (ARTWORK_DESIGN §7-2).
 *
 * 경로 순회 · 허용 목록 밖 · 중복 경로 · 항목 수 · 항목 크기(실제 풀린 양) · 전체 크기 · 압축률(ZIP bomb) ·
 * 손상 · ZIP 아님.
 */
import { zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'

import {
  buildZip,
  isSafeZipPath,
  looksLikeZip,
  readZip,
  type ZipReadPolicy,
} from '@/features/backup/zipPackage'

// fflate 와 같은 realm 의 배열로 (jsdom 의 TextEncoder 는 다른 realm 의 Uint8Array 를 준다).
const text = (value: string) => new Uint8Array(new TextEncoder().encode(value))

const policy = (over: Partial<ZipReadPolicy> = {}): ZipReadPolicy => ({
  allow: (path) =>
    path === 'a.json' || path === 'b.json' || path.startsWith('assets/') ? 1024 * 1024 : null,
  maxEntries: 10,
  maxTotalBytes: 4 * 1024 * 1024,
  maxRatio: 200,
  ...over,
})

describe('A. 정상', () => {
  it('만들고 읽으면 같은 바이트 — 저장(이미지) · deflate(JSON) 모두', () => {
    const image = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3])
    const zip = buildZip([
      { path: 'a.json', bytes: text('{"x":1}'), compress: true },
      { path: 'assets/x.png', bytes: image, compress: false },
    ])
    expect(looksLikeZip(zip)).toBe(true)
    const read = readZip(zip, policy())
    expect(read.ok).toBe(true)
    if (!read.ok) return
    expect(new TextDecoder().decode(read.files.get('a.json'))).toBe('{"x":1}')
    expect(read.files.get('assets/x.png')).toEqual(image)
  })

  it('만들 때 같은 경로가 둘이면 던진다', () => {
    expect(() =>
      buildZip([
        { path: 'a.json', bytes: text('1'), compress: true },
        { path: 'a.json', bytes: text('2'), compress: true },
      ]),
    ).toThrow('duplicate')
  })
})

describe('B. 거절', () => {
  it('ZIP 이 아니다', () => {
    expect(readZip(text('{"format":"39page-backup"}'), policy())).toEqual({
      ok: false,
      error: { kind: 'not-zip' },
    })
  })

  it('경로 순회 · 절대 경로 · 역슬래시 · 드라이브 문자', () => {
    for (const path of [
      '../a.json',
      'x/../../a.json',
      '/a.json',
      'assets\\x.png',
      'C:/a.json',
      'assets/./x.png',
    ]) {
      expect(isSafeZipPath(path)).toBe(false)
      const zip = zipSync({ [path]: text('1') })
      const read = readZip(zip, policy({ allow: () => 1024 }))
      expect(read).toEqual({ ok: false, error: { kind: 'bad-path', path } })
    }
  })

  it('허용 목록에 없는 이름 (예: index.html · evil.js)', () => {
    const zip = zipSync({ 'a.json': text('1'), 'index.html': text('<script>alert(1)</script>') })
    expect(readZip(zip, policy())).toEqual({
      ok: false,
      error: { kind: 'bad-path', path: 'index.html' },
    })
  })

  it('같은 경로가 두 번 (중앙 디렉터리 · 로컬 머리말을 고쳐 만든 파일)', () => {
    const zip = zipSync({ 'a.json': text('1'), 'b.json': text('2') }, { level: 0 })
    // 두 번째 항목의 이름 b.json → a.json (같은 길이) — 로컬 머리말과 중앙 디렉터리 모두.
    const patched = new Uint8Array(zip)
    const needle = text('b.json')
    for (let i = 0; i + needle.length <= patched.length; i += 1) {
      if (needle.every((byte, k) => patched[i + k] === byte)) patched[i] = 'a'.charCodeAt(0)
    }
    const read = readZip(patched, policy())
    expect(read.ok).toBe(false)
    expect(['duplicate-path', 'corrupt']).toContain(
      (read as { error: { kind: string } }).error.kind,
    )
  })

  it('항목 수가 너무 많다', () => {
    const files: Record<string, Uint8Array> = {}
    for (let i = 0; i < 12; i += 1) files[`assets/${String(i)}.png`] = text(String(i))
    expect(readZip(zipSync(files), policy())).toEqual({
      ok: false,
      error: { kind: 'too-many-entries' },
    })
  })

  it('항목이 한도보다 크다 — 실제로 풀린 양으로 판단한다', () => {
    const big = new Uint8Array(1024 * 1024 + 1)
    const read = readZip(zipSync({ 'a.json': big }), policy())
    expect(read).toEqual({ ok: false, error: { kind: 'entry-too-large', path: 'a.json' } })
  })

  it('압축 폭탄 — 작은 ZIP 이 엄청나게 풀리면 멈춘다 (압축률 · 전체 크기)', () => {
    const zeros = new Uint8Array(3 * 1024 * 1024) // 약 3 KB 로 압축된다
    const zip = zipSync({ 'a.json': zeros }, { level: 9 })
    expect(zip.length).toBeLessThan(20_000)
    const read = readZip(zip, policy({ allow: () => 8 * 1024 * 1024 }))
    expect(read).toEqual({ ok: false, error: { kind: 'suspicious-ratio', path: 'a.json' } })

    const total = readZip(
      zipSync(
        { 'a.json': new Uint8Array(600_000).fill(7), 'b.json': new Uint8Array(600_000).fill(9) },
        { level: 0 },
      ),
      policy({ maxTotalBytes: 1_000_000 }),
    )
    expect(total).toEqual({ ok: false, error: { kind: 'total-too-large' } })
  })

  it('손상 — 중간이 잘린 ZIP', () => {
    const zip = zipSync({ 'a.json': text('x'.repeat(5000)) })
    const read = readZip(zip.subarray(0, Math.floor(zip.length / 2)), policy())
    expect(read.ok).toBe(false)
  })
})
