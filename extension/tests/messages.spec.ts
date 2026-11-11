import { describe, expect, it } from 'vitest'

import {
  ERROR_CODES,
  fail,
  ok,
  parseContentRequest,
  parseExtensionRequest,
  parsePageInspection,
  parsePageSnapshot,
  parsePlayerCandidates,
  parseResult,
  PROTOCOL_VERSION,
  SNAPSHOT_HREF_MAX,
  SNAPSHOT_TEXT_MAX,
} from '@/shared/messages'

const ID = 'dQw4w9WgXcQ'

describe('메시지 계약 v1 — 요청 검증', () => {
  it('올바른 tab/inspect 를 받는다', () => {
    expect(parseExtensionRequest({ v: 1, type: 'tab/inspect', tabId: 7 })).toEqual({
      ok: true,
      value: { v: 1, type: 'tab/inspect', tabId: 7 },
    })
  })

  it('알지 못하는 필드는 결과에 옮기지 않는다', () => {
    const parsed = parseExtensionRequest({ v: 1, type: 'tab/inspect', tabId: 7, extra: 'x' })
    expect(parsed.ok && parsed.value).toEqual({ v: 1, type: 'tab/inspect', tabId: 7 })
  })

  it.each([
    ['객체가 아님', 'tab/inspect', 'bad-request'],
    ['null', null, 'bad-request'],
    ['배열', [1, 'tab/inspect'], 'bad-request'],
    ['버전 없음', { type: 'tab/inspect', tabId: 1 }, 'bad-request'],
    ['버전이 문자열', { v: '1', type: 'tab/inspect', tabId: 1 }, 'bad-request'],
    ['다른 버전', { v: 2, type: 'tab/inspect', tabId: 1 }, 'unsupported-version'],
    ['종류 없음', { v: 1, tabId: 1 }, 'bad-request'],
    ['모르는 종류', { v: 1, type: 'player/position' }, 'unsupported-type'],
    ['tabId 없음', { v: 1, type: 'tab/inspect' }, 'bad-request'],
    ['tabId 문자열', { v: 1, type: 'tab/inspect', tabId: '7' }, 'bad-request'],
    ['tabId 음수', { v: 1, type: 'tab/inspect', tabId: -1 }, 'bad-request'],
    ['tabId 소수', { v: 1, type: 'tab/inspect', tabId: 1.5 }, 'bad-request'],
    ['tabId NaN', { v: 1, type: 'tab/inspect', tabId: Number.NaN }, 'bad-request'],
  ])('%s → %s', (_label, input, code) => {
    expect(parseExtensionRequest(input)).toMatchObject({ ok: false, error: { code } })
  })

  it('collect/open — tabId 와 사용자가 본 videoId 를 받는다 (M10-3)', () => {
    expect(parseExtensionRequest({ v: 1, type: 'collect/open', tabId: 4, videoId: ID })).toEqual({
      ok: true,
      value: { v: 1, type: 'collect/open', tabId: 4, videoId: ID },
    })
  })

  it.each([
    ['videoId 없음', { v: 1, type: 'collect/open', tabId: 4 }],
    ['videoId 형식 아님', { v: 1, type: 'collect/open', tabId: 4, videoId: 'short' }],
    ['videoId 에 다른 글자', { v: 1, type: 'collect/open', tabId: 4, videoId: 'dQw4w9WgXc<' }],
    ['tabId 없음', { v: 1, type: 'collect/open', videoId: ID }],
  ])('collect/open 거절 — %s', (_label, input) => {
    expect(parseExtensionRequest(input)).toMatchObject({
      ok: false,
      error: { code: 'bad-request' },
    })
  })

  it('버전이 다르면 종류를 보지 않는다', () => {
    const parsed = parseExtensionRequest({ v: 2, type: 'nope' })
    expect(!parsed.ok && parsed.error.code).toBe('unsupported-version')
  })

  it('content 요청은 page/read 만 받는다', () => {
    expect(parseContentRequest({ v: 1, type: 'page/read' }).ok).toBe(true)
    const other = parseContentRequest({ v: 1, type: 'tab/inspect', tabId: 1 })
    expect(!other.ok && other.error.code).toBe('unsupported-type')
    const old = parseContentRequest({ v: 0, type: 'page/read' })
    expect(!old.ok && old.error.code).toBe('unsupported-version')
  })
})

describe('메시지 계약 v1 — 응답 검증', () => {
  const snapshot = {
    href: `https://www.youtube.com/watch?v=${ID}`,

    watch: { videoId: ID, heading: 'Song' },
  }

  it('content 스냅샷 모양을 확인한다', () => {
    expect(parsePageSnapshot(snapshot)).toEqual(snapshot)
    expect(
      parsePageSnapshot({ ...snapshot, watch: { videoId: null, heading: null } }),
    ).not.toBeNull()
  })

  it.each([
    ['href 없음', { ...snapshot, href: undefined }],
    ['href 가 너무 김', { ...snapshot, href: 'x'.repeat(SNAPSHOT_HREF_MAX + 1) }],
    [
      '제목 줄이 너무 김',
      { ...snapshot, watch: { videoId: ID, heading: 'x'.repeat(SNAPSHOT_TEXT_MAX + 1) } },
    ],
    ['watch 없음', { ...snapshot, watch: undefined }],
    ['videoId 가 숫자', { ...snapshot, watch: { videoId: 1, heading: null } }],
    ['heading 이 객체', { ...snapshot, watch: { videoId: null, heading: {} } }],
  ])('스냅샷 거절 — %s', (_label, value) => {
    expect(parsePageSnapshot(value)).toBeNull()
  })

  it('document.title 을 싣지 않는다 — 실어 보내도 결과에 옮기지 않는다', () => {
    expect(parsePageSnapshot({ ...snapshot, documentTitle: 'Old - YouTube' })).toEqual(snapshot)
  })

  it('플레이어 후보 목록을 확인한다', () => {
    expect(
      parsePlayerCandidates([
        { videoId: ID, title: 'Song' },
        { videoId: ID, title: null },
      ]),
    ).toEqual([
      { videoId: ID, title: 'Song' },
      { videoId: ID, title: null },
    ])
    expect(parsePlayerCandidates([])).toEqual([])
  })

  it.each([
    ['배열이 아님', { videoId: ID }],
    ['다섯 개 이상', Array.from({ length: 5 }, () => ({ videoId: ID, title: null }))],
    ['ID 가 숫자', [{ videoId: 1, title: null }]],
    ['ID 가 너무 김', [{ videoId: 'x'.repeat(65), title: null }]],
    ['제목이 숫자', [{ videoId: ID, title: 3 }]],
    ['제목 키 없음', [{ videoId: ID }]],
  ])('플레이어 후보 거절 — %s', (_label, value) => {
    expect(parsePlayerCandidates(value)).toBeNull()
  })

  it('inspection 결과를 확인한다', () => {
    const video = {
      status: 'video',
      videoId: ID,
      pageKind: 'watch',
      title: 'Song',
      titleSource: 'player',
    }
    expect(parsePageInspection(video)).toEqual(video)
    expect(parsePageInspection({ ...video, titleSource: 'heading' })).not.toBeNull()
    expect(parsePageInspection({ status: 'unsupported', reason: 'youtube-music' })).toEqual({
      status: 'unsupported',
      reason: 'youtube-music',
    })
  })

  it.each([
    [
      '잘못된 ID',
      { status: 'video', videoId: 'short', pageKind: 'watch', title: null, titleSource: null },
    ],
    [
      '모르는 종류',
      { status: 'video', videoId: ID, pageKind: 'music', title: null, titleSource: null },
    ],
    [
      '제목만 있고 출처 없음',
      { status: 'video', videoId: ID, pageKind: 'watch', title: 'a', titleSource: null },
    ],
    [
      '출처만 있고 제목 없음',
      { status: 'video', videoId: ID, pageKind: 'watch', title: null, titleSource: 'tab' },
    ],
    [
      '모르는 출처',
      { status: 'video', videoId: ID, pageKind: 'watch', title: 'a', titleSource: 'dom' },
    ],
    [
      '없앤 출처 (탭 제목)',
      { status: 'video', videoId: ID, pageKind: 'watch', title: 'a', titleSource: 'tab' },
    ],
    ['모르는 이유', { status: 'unsupported', reason: 'nope' }],
    ['모르는 상태', { status: 'maybe' }],
  ])('inspection 거절 — %s', (_label, value) => {
    expect(parsePageInspection(value)).toBeNull()
  })

  it('응답 봉투가 틀리면 internal 실패로 바꾼다', () => {
    const parse = (data: unknown) => (data === 'ok' ? 'ok' : null)
    expect(parseResult(ok('ok'), parse)).toEqual(ok('ok'))
    expect(parseResult(undefined, parse).ok).toBe(false)
    expect(parseResult({ v: 2, ok: true, data: 'ok' }, parse)).toEqual(
      fail('internal', '응답 형식이 아니다'),
    )
    const badData = parseResult(ok('nope'), parse)
    expect(!badData.ok && badData.error.code).toBe('internal')
  })

  it('실패 응답은 코드와 메시지를 그대로 옮기되 모르는 코드는 받지 않는다', () => {
    const parse = () => null
    expect(parseResult(fail('no-tab', '없다'), parse)).toEqual(fail('no-tab', '없다'))
    const unknown = parseResult({ v: 1, ok: false, error: { code: 'boom', message: 'x' } }, parse)
    expect(!unknown.ok && unknown.error.code).toBe('internal')
    const long = parseResult(
      { v: 1, ok: false, error: { code: 'timeout', message: 'x'.repeat(999) } },
      parse,
    )
    expect(!long.ok && long.error.message.length).toBe(300)
  })

  it('오류 코드는 설계 문서의 9개다 (M10-3 에 page-changed)', () => {
    expect([...ERROR_CODES].sort()).toEqual(
      [
        'bad-request',
        'forbidden-sender',
        'internal',
        'no-receiver',
        'no-tab',
        'page-changed',
        'timeout',
        'unsupported-type',
        'unsupported-version',
      ].sort(),
    )
    expect(PROTOCOL_VERSION).toBe(1)
  })
})
