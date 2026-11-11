/**
 * 수집 URL 계약 v1 — 확장 쪽. 웹앱과 **같은 고정 파일**을 읽는다
 * (`../tests/fixtures/collect-v1.json`, 웹앱 `tests/unit/collect-request.spec.ts`).
 * 확장이 만드는 주소가 웹앱이 받아들이는 주소와 글자까지 같아야 한다.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { buildCollectUrl } from '@/shared/collectUrl'
import { cleanTitle } from '@/shared/title'

interface Fixture {
  origin: string
  build: { input: { videoId: string; title: string | null; requestId: string }; hash: string }[]
}

const fixture = JSON.parse(
  readFileSync(resolve(process.cwd(), '../tests/fixtures/collect-v1.json'), 'utf8'),
) as Fixture

describe('buildCollectUrl — 고정 파일과 같은 주소', () => {
  it.each(fixture.build.map((item) => [item.hash, item] as const))('%s', (_hash, item) => {
    expect(buildCollectUrl(fixture.origin, item.input)).toBe(`${fixture.origin}/${item.hash}`)
  })

  it('제목이 비면 싣지 않는다', () => {
    expect(
      buildCollectUrl('https://39page.com', {
        videoId: 'jNQXAC9IVRw',
        title: '',
        requestId: 'a1B2c3D4e5F6g7H8',
      }),
    ).toBe('https://39page.com/#collect?v=1&kind=track&videoId=jNQXAC9IVRw&req=a1B2c3D4e5F6g7H8')
  })

  it('정리된 제목(cleanTitle)은 웹앱이 받는 범위다 — 제어·양방향 문자가 없고 100자 이하', () => {
    const cleaned = cleanTitle(`(3) ${'가'.repeat(150)}‮\u0007 - YouTube`)
    expect(cleaned).not.toBeNull()
    expect(cleaned!.length).toBeLessThanOrEqual(100)
    expect(cleaned).not.toMatch(/[‪-‮⁦-⁩]/)
    for (const char of cleaned!) {
      const code = char.charCodeAt(0)
      expect(code > 0x1f && !(code >= 0x7f && code <= 0x9f)).toBe(true)
    }
  })
})

describe('buildCollectUrl — 틀린 주소를 내보내지 않는다', () => {
  const ok = { videoId: 'jNQXAC9IVRw', title: null, requestId: 'a1B2c3D4e5F6g7H8' }

  it.each([
    ['허용하지 않은 origin', 'https://evil.example', ok, '허용하지 않은 수집 origin'],
    ['www origin', 'https://www.39page.com', ok, '허용하지 않은 수집 origin'],
    ['http origin', 'http://39page.com', ok, '허용하지 않은 수집 origin'],
    ['개발용 origin (운영·테스트 빌드)', 'http://localhost:5173', ok, '허용하지 않은 수집 origin'],
    [
      '잘못된 videoId',
      'https://39page.com',
      { ...ok, videoId: 'short' },
      'videoId 가 11자 영상 ID 가 아니다',
    ],
    ['잘못된 요청 ID', 'https://39page.com', { ...ok, requestId: 'x' }, '요청 ID 형식이 아니다'],
  ] as const)('%s → 던진다', (_label, origin, input, message) => {
    expect(() => buildCollectUrl(origin, input)).toThrow(message)
  })

  it('정보는 주소 조각(#)에만 있다 — 경로·쿼리는 비어 있다', () => {
    const url = new URL(buildCollectUrl('https://39page.com', { ...ok, title: 'Song' }))
    expect(url.pathname).toBe('/')
    expect(url.search).toBe('')
    expect(url.hash.startsWith('#collect?')).toBe(true)
  })
})
