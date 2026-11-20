/**
 * M11-6 — `bridge.html` 응답 헤더(`_headers`)와 허용 확장 ID 빌드 검사 (`vite.config.ts`).
 */
import { describe, expect, it } from 'vitest'

import { bridgeExtensionIds, bridgeHeaders } from '../../vite.config'

const DEV = 'pkagnijdhfmkodpdfgdehfdghcgbfpoa'
const STORE = 'abcdefghijklmnopabcdefghijklmnop'

describe('브리지 응답 헤더 · 허용 확장 ID', () => {
  it('목록이 비면 frame-ancestors none — 운영 브리지 꺼짐', () => {
    const headers = bridgeHeaders([])
    expect(headers).toContain("/bridge.html\n  Content-Security-Policy: frame-ancestors 'none'")
    // Workers 정적 자원은 /bridge.html 을 /bridge 로 옮긴다 — 둘 다 같은 헤더.
    expect(headers).toContain("/bridge\n  Content-Security-Policy: frame-ancestors 'none'")
  })

  it('허용 ID 가 있으면 그 확장 origin 만 액자로 띄울 수 있다', () => {
    expect(bridgeHeaders([STORE])).toContain(`frame-ancestors chrome-extension://${STORE}\n`)
  })

  it('형식이 틀린 ID · 개발 ID(시험 빌드 표시 없이)는 빌드를 멈춘다', () => {
    expect(bridgeExtensionIds({})).toEqual([])
    expect(bridgeExtensionIds({ VITE_BRIDGE_EXTENSION_IDS: ` ${STORE} ` })).toEqual([STORE])
    expect(() => bridgeExtensionIds({ VITE_BRIDGE_EXTENSION_IDS: 'bad-id' })).toThrow('형식')
    expect(() => bridgeExtensionIds({ VITE_BRIDGE_EXTENSION_IDS: DEV })).toThrow('개발용')
    expect(() =>
      bridgeExtensionIds({ VITE_BRIDGE_EXTENSION_IDS: 'mfijienedkbogcldkjfjjmgbfkfidocb' }),
    ).toThrow('개발용')
    expect(
      bridgeExtensionIds({ VITE_BRIDGE_EXTENSION_IDS: DEV, VITE_BRIDGE_DEV_BUILD: '1' }),
    ).toEqual([DEV])
  })
})
