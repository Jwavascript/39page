/**
 * M11-1 PoC — 브리지 메시지 계약 · 확장 쪽 송신자 검증 (실험 코드의 단위 시험).
 */
import { describe, expect, it } from 'vitest'

import {
  ALLOWED_EXTENSION_ORIGINS,
  BRIDGE_NAMESPACE,
  isTrustedAncestry,
  parseBridgeRequest,
} from '../web/bridgeProtocol'
import {
  BRIDGE_ORIGIN,
  isBridgePortSender,
  isPanelSender,
  validateBridgeCall,
} from '../extension/protocol.js'

const VIDEO = 'dQw4w9WgXcQ'
const ID = 'req_0123456789abcdef'
const EXT = ALLOWED_EXTENSION_ORIGINS[0] ?? ''

function envelope(payload: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  return {
    ns: BRIDGE_NAMESPACE,
    v: 1,
    kind: 'request',
    id: ID,
    deadline: Date.now() + 5_000,
    payload,
    ...extra,
  }
}

function code(value: unknown): string | null {
  const parsed = parseBridgeRequest(value)
  if (parsed === null) return 'ignored'
  return parsed.ok ? null : parsed.error.code
}

describe('parseBridgeRequest', () => {
  it('다른 용도의 postMessage 는 무시한다 (답하지 않는다)', () => {
    expect(parseBridgeRequest({ hello: 1 })).toBeNull()
    expect(parseBridgeRequest('x')).toBeNull()
    expect(parseBridgeRequest({ ns: BRIDGE_NAMESPACE, kind: 'response' })).toBeNull()
  })

  it('요청 ID · 버전 · 마감 · 종류를 검증한다', () => {
    expect(code(envelope({ op: 'hello' }, { id: 'short' }))).toBe('bad-request')
    expect(code(envelope({ op: 'hello' }, { v: 2 }))).toBe('unsupported-version')
    expect(code(envelope({ op: 'hello' }, { deadline: 'soon' }))).toBe('bad-request')
    expect(code(envelope({ op: 'library/delete-all' }))).toBe('unsupported-op')
    expect(code(envelope({ op: 'hello' }))).toBeNull()
  })

  it('곡 담기 — videoId · 제목 규칙 (수집 URL 계약과 같은 금지 문자 · 100자)', () => {
    const base = { op: 'track/add', playlistId: 'p1', videoId: VIDEO }
    expect(code(envelope({ ...base, title: 'ok' }))).toBeNull()
    expect(code(envelope({ ...base, videoId: 'nope' }))).toBe('invalid-video-id')
    expect(code(envelope({ ...base, title: 'a'.repeat(101) }))).toBe('bad-request')
    expect(code(envelope({ ...base, title: 'evil‮txt' }))).toBe('bad-request')
    expect(code(envelope({ ...base, title: 'line\nbreak' }))).toBe('bad-request')
    expect(code(envelope({ ...base, playlistId: '' }))).toBe('bad-request')
    const parsed = parseBridgeRequest(envelope({ ...base, title: '   ' }))
    expect(parsed?.ok && parsed.request.payload).toMatchObject({ title: null })
  })

  it('새 목록 이름 — 비면 empty-name, 60자 초과 · 제어 문자 거절', () => {
    const base = { op: 'playlist/create-and-add', videoId: VIDEO }
    expect(code(envelope({ ...base, name: '  ' }))).toBe('empty-name')
    expect(code(envelope({ ...base, name: 'x'.repeat(61) }))).toBe('bad-request')
    expect(code(envelope({ ...base, name: 'a\u0007b' }))).toBe('bad-request')
    expect(code(envelope({ ...base, name: ' 새 목록 ' }))).toBeNull()
  })

  it('Moment — 시점은 0 이상 정수 999999 이하, 메모는 500자 · 줄바꿈 허용 · 양방향 재정의 거절', () => {
    const base = { op: 'moment/add', videoId: VIDEO, atSeconds: 83 }
    expect(code(envelope({ ...base, note: '첫 줄\n둘째 줄' }))).toBeNull()
    expect(code(envelope({ ...base, atSeconds: 0 }))).toBeNull()
    for (const atSeconds of [-1, 1.5, 1_000_000, Number.NaN, '83']) {
      expect(code(envelope({ ...base, atSeconds }))).toBe('invalid-time')
    }
    expect(code(envelope({ ...base, note: 'x'.repeat(501) }))).toBe('bad-request')
    expect(code(envelope({ ...base, note: 'a⁦b' }))).toBe('bad-request')
  })

  it('확인 조회 — moment/find 는 since 가 날짜여야 한다', () => {
    const base = { op: 'moment/find', videoId: VIDEO, atSeconds: 1 }
    expect(code(envelope({ ...base, since: 'yesterday' }))).toBe('bad-request')
    expect(code(envelope({ ...base, since: new Date().toISOString() }))).toBeNull()
  })
})

describe('isTrustedAncestry — 브리지가 일해도 되는 자리', () => {
  it('조상이 모두 허용한 확장일 때만', () => {
    expect(isTrustedAncestry([EXT], false)).toBe(true)
    expect(isTrustedAncestry([EXT, EXT], false)).toBe(true)
  })

  it('최상위 · 웹사이트 아래(분할된 저장소) · 다른 확장 · 판단 불가는 거절', () => {
    expect(isTrustedAncestry([], true)).toBe(false)
    expect(isTrustedAncestry([EXT, 'https://www.youtube.com'], false)).toBe(false)
    expect(isTrustedAncestry(['https://evil.example'], false)).toBe(false)
    expect(isTrustedAncestry(['chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'], false)).toBe(
      false,
    )
    expect(isTrustedAncestry(null, false)).toBe(false)
  })
})

describe('확장 쪽 송신자 검증 (PoC protocol.js)', () => {
  const runtimeId = 'pkagnijdhfmkodpdfgdehfdghcgbfpoa'
  const panelUrl = `chrome-extension://${runtimeId}/panel.html`

  it('패널만 bridge/call 을 보낼 수 있다', () => {
    expect(isPanelSender({ id: runtimeId, url: panelUrl }, runtimeId, panelUrl)).toBe(true)
    // content script 의 sender.url 은 웹페이지 주소다
    expect(
      isPanelSender(
        { id: runtimeId, url: 'https://www.youtube.com/watch?v=x' },
        runtimeId,
        panelUrl,
      ),
    ).toBe(false)
    expect(isPanelSender({ id: 'other', url: panelUrl }, runtimeId, panelUrl)).toBe(false)
    expect(isPanelSender(null, runtimeId, panelUrl)).toBe(false)
  })

  it('외부 포트는 허용 origin 의 브리지 페이지만', () => {
    const bridge = `${BRIDGE_ORIGIN}/poc/m11-bridge/web/bridge.html?mode=connect`
    expect(isBridgePortSender({ origin: BRIDGE_ORIGIN, url: bridge })).toBe(true)
    expect(isBridgePortSender({ origin: BRIDGE_ORIGIN, url: `${BRIDGE_ORIGIN}/` })).toBe(false)
    expect(isBridgePortSender({ origin: 'https://evil.example', url: bridge })).toBe(false)
  })

  it('bridge/call 봉투', () => {
    const ok = {
      ns: '39page-poc',
      v: 1,
      type: 'bridge/call',
      route: 'offscreen',
      request: { id: ID, deadline: 1, payload: { op: 'hello' } },
    }
    expect(validateBridgeCall(ok)).not.toBeNull()
    expect(validateBridgeCall({ ...ok, route: 'direct-storage' })).toBeNull()
    expect(validateBridgeCall({ ...ok, request: { ...ok.request, id: 'x' } })).toBeNull()
  })
})
