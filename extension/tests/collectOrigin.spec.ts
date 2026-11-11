import { describe, expect, it } from 'vitest'

import {
  DEV_COLLECT_ORIGINS,
  isAllowedCollectOrigin,
  PRODUCTION_COLLECT_ORIGIN,
  resolveCollectOrigin,
} from '@/shared/collectOrigin'

describe('수집 origin (M10-3, Batch 2 지시 E)', () => {
  it('운영 빌드는 https://39page.com 고정이다', () => {
    expect(resolveCollectOrigin('production', undefined)).toBe('https://39page.com')
    expect(resolveCollectOrigin('production', '')).toBe(PRODUCTION_COLLECT_ORIGIN)
    expect(resolveCollectOrigin('test', undefined)).toBe(PRODUCTION_COLLECT_ORIGIN)
  })

  it('운영 빌드에서 origin 을 바꾸려 하면 빌드가 멈춘다', () => {
    expect(() => resolveCollectOrigin('production', 'http://localhost:5173')).toThrow(
      '운영 빌드에서는 수집 origin 을 바꿀 수 없다',
    )
    expect(() => resolveCollectOrigin('production', 'https://evil.example')).toThrow(
      '운영 빌드에서는 수집 origin 을 바꿀 수 없다',
    )
  })

  it('개발 빌드는 허용 목록의 localhost 만 쓴다', () => {
    expect(resolveCollectOrigin('development', undefined)).toBe('http://localhost:5173')
    expect(resolveCollectOrigin('development', 'http://127.0.0.1:4173')).toBe(
      'http://127.0.0.1:4173',
    )
    for (const bad of [
      'https://evil.example',
      'http://localhost:8080',
      'http://localhost:5173/',
      'http://0.0.0.0:5173',
      'https://39page.com.evil.example',
    ]) {
      expect(() => resolveCollectOrigin('development', bad)).toThrow(
        '허용하지 않은 개발용 수집 origin',
      )
    }
  })

  it('실행 중 검사도 같은 목록이다', () => {
    expect(isAllowedCollectOrigin('https://39page.com')).toBe(true)
    for (const origin of DEV_COLLECT_ORIGINS) expect(isAllowedCollectOrigin(origin)).toBe(true)
    expect(isAllowedCollectOrigin('https://www.39page.com')).toBe(false)
    expect(isAllowedCollectOrigin('http://39page.com')).toBe(false)
  })
})
