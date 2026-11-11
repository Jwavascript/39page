/**
 * 수집 URL 계약 v1 — 웹앱 쪽 (M10-3B). 같은 고정 파일을 확장 테스트도 읽는다
 * (`extension/tests/collectUrl.spec.ts`) — 확장이 만드는 주소와 웹앱이 받는 주소가
 * 한 표에 묶인다.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { resolveEntry } from '@/app/entry'
import {
  isCollectHash,
  MAX_COLLECT_TITLE_LENGTH,
  parseCollectRequest,
  type CollectRejectReason,
} from '@/features/collect/collectRequest'
import { MAX_TRACK_TITLE_LENGTH } from '@/stores/library'

interface Fixture {
  origin: string
  build: { input: { videoId: string; title: string | null; requestId: string }; hash: string }[]
  reject: { hash: string; reason: CollectRejectReason }[]
  acceptExtra: { hash: string; videoId: string; title: string | null }[]
}

const fixture = JSON.parse(
  readFileSync(resolve(process.cwd(), 'tests/fixtures/collect-v1.json'), 'utf8'),
) as Fixture

describe('계약 v1 — 고정 파일', () => {
  it.each(fixture.build.map((item) => [item.hash, item] as const))('받는다: %s', (_hash, item) => {
    expect(parseCollectRequest(item.hash)).toEqual({
      ok: true,
      request: {
        v: 1,
        kind: 'track',
        videoId: item.input.videoId,
        title: item.input.title,
        requestId: item.input.requestId,
      },
    })
  })

  // 표의 줄마다 따로 돈다 — 앞부분이 같은 줄이 서로를 가리지 않게.
  it.each(fixture.reject)('거절한다 #$# — $reason', ({ hash, reason }) => {
    expect(parseCollectRequest(hash)).toEqual({ ok: false, reason })
  })

  it.each(fixture.acceptExtra.map((item) => [item.hash, item] as const))(
    '모르는 필드는 무시하고 빈 제목은 null: %s',
    (_hash, item) => {
      const result = parseCollectRequest(item.hash)
      expect(result.ok && result.request.videoId).toBe(item.videoId)
      expect(result.ok && result.request.title).toBe(item.title)
    },
  )

  it('운영 origin 은 https://39page.com 이다', () => {
    expect(fixture.origin).toBe('https://39page.com')
  })
})

describe('계약 v1 — 경계', () => {
  it('제목 상한이 라이브러리 상한과 같다', () => {
    expect(MAX_COLLECT_TITLE_LENGTH).toBe(MAX_TRACK_TITLE_LENGTH)
  })

  it('조각은 데이터일 뿐이다 — 스크립트 같은 제목도 그대로 문자열', () => {
    const item = fixture.build.find((candidate) => candidate.input.title?.includes('<script>'))
    const result = parseCollectRequest(item?.hash ?? '')
    expect(result.ok && result.request.title).toBe(
      '<script>alert(1)</script><img src=x onerror=alert(2)>',
    )
  })

  it.each([
    ['#collect', true],
    ['#collect?v=1', true],
    ['#collection', false],
    ['#collect/x', false],
    ['', false],
    ['#/', false],
  ] as const)('수집 조각인가 %j → %s', (hash, expected) => {
    expect(isCollectHash(hash)).toBe(expected)
  })

  it('어느 화면을 띄울지 — 수집 조각만 수집 화면', () => {
    expect(resolveEntry('#collect?v=1&kind=track')).toBe('collect')
    expect(resolveEntry('#collect?v=999')).toBe('collect') // 잘못된 요청도 수집 화면이 거절을 보여 준다
    expect(resolveEntry('')).toBe('dashboard')
    expect(resolveEntry('#anything')).toBe('dashboard')
  })
})
