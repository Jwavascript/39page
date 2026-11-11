/**
 * `moment/capture` — Music Moment 캡처 (M10-4). 판정은 순수 함수(`decideCapture`)로,
 * 흐름은 가짜 탭 포트로 본다. 실제 YouTube 에서의 시점은 통합 검증이 잰다.
 */
import { describe, expect, it } from 'vitest'

import { PLAYER_STATE, captureMoment, decideCapture } from '@/background/captureMoment'
import { COLLECT_DEDUPE_WINDOW_MS, createCollectDeduper } from '@/background/openCollect'
import { PortError } from '@/background/tabsPort'
import { MAX_AT_SECONDS } from '@/shared/collectUrl'
import { fail, ok, parsePlaybackSnapshot, type PlaybackSnapshot } from '@/shared/messages'

import { fakePort, ID, OTHER_ID, playback } from './support/fakePort'

const REQ = '3f0c6b1e-8d2a-4c7e-9b5f-1a2b3c4d5e6f'

function snap(overrides: Record<string, unknown> = {}): PlaybackSnapshot {
  const parsed = parsePlaybackSnapshot(playback(overrides))
  if (parsed === null) throw new Error('스냅샷 모양이 틀렸다')
  return parsed
}

function setup(options: Parameters<typeof fakePort>[0] = {}) {
  const { port } = fakePort(options)
  const clock = { now: 1_000 }
  const deps = {
    port,
    origin: 'https://39page.com',
    deduper: createCollectDeduper(),
    newRequestId: () => REQ,
    now: () => clock.now,
  }
  return { port, deps, clock }
}

describe('decideCapture — 지어낸 0초를 만들지 않는다', () => {
  it('재생 중이면 그 시점을 내림한 정수초', () => {
    expect(decideCapture(snap({ currentTime: 83.99 }), ID)).toEqual({
      kind: 'capture',
      atSeconds: 83,
      title: 'Player Title',
    })
  })

  it.each([
    ['일시정지', PLAYER_STATE.paused, 41.2, 41],
    ['재생 중 0.4초 — 확인된 0', PLAYER_STATE.playing, 0.4, 0],
    ['일시정지 0초 — 확인된 0', PLAYER_STATE.paused, 0, 0],
    ['버퍼링이지만 영상 중간', PLAYER_STATE.buffering, 120.7, 120],
    ['끝까지 봤다', PLAYER_STATE.ended, 212, 212],
  ])('%s → %i초', (_label, state, currentTime, atSeconds) => {
    expect(decideCapture(snap({ state, currentTime }), ID)).toMatchObject({
      kind: 'capture',
      atSeconds,
    })
  })

  it.each([
    ['시작 전(-1)', { state: PLAYER_STATE.unstarted, currentTime: 0 }, 'not-started'],
    ['대기(5)', { state: PLAYER_STATE.cued, currentTime: 0 }, 'not-started'],
    ['불러오는 중 0 근처', { state: PLAYER_STATE.buffering, currentTime: 0.2 }, 'not-started'],
    ['광고', { adShowing: true }, 'ad'],
    ['라이브', { live: true }, 'live'],
    ['시점 모름', { currentTime: null }, 'unreadable'],
    ['상태 모름', { state: null }, 'unreadable'],
    ['모르는 상태 값', { state: 7 }, 'unreadable'],
    ['음수', { currentTime: -3 }, 'unreadable'],
    ['길이보다 한참 뒤', { currentTime: 500, duration: 212 }, 'unreadable'],
    ['계약 상한 초과', { currentTime: MAX_AT_SECONDS + 1, duration: null }, 'unreadable'],
  ] as const)('%s → 거절 %s', (_label, overrides, reason) => {
    expect(decideCapture(snap(overrides), ID)).toEqual({ kind: 'refused', reason })
  })

  it('플레이어가 다른 영상을 띄우고 있으면 page-changed (자동 다음 영상 · SPA 이동)', () => {
    expect(decideCapture(snap({ videoId: OTHER_ID }), ID)).toEqual({ kind: 'page-changed' })
  })

  it('스냅샷이 없거나 영상 ID 가 없으면 unreadable', () => {
    expect(decideCapture(null, ID)).toEqual({ kind: 'refused', reason: 'unreadable' })
    expect(decideCapture(snap({ videoId: null }), ID)).toEqual({
      kind: 'refused',
      reason: 'unreadable',
    })
  })

  it('광고 판정이 시점 판정보다 먼저다 — 광고 중의 시점은 영상의 시점이 아니다', () => {
    expect(decideCapture(snap({ adShowing: true, currentTime: 12 }), ID)).toEqual({
      kind: 'refused',
      reason: 'ad',
    })
  })
})

describe('parsePlaybackSnapshot — 페이지에서 온 값을 믿지 않는다', () => {
  it.each([
    ['객체가 아님', 'x'],
    ['NaN 시점', playback({ currentTime: Number.NaN })],
    ['Infinity 시점', playback({ currentTime: Number.POSITIVE_INFINITY })],
    ['문자열 시점', playback({ currentTime: '83' })],
    ['너무 긴 ID', playback({ videoId: 'x'.repeat(65) })],
    ['광고 값이 불리언 아님', playback({ adShowing: 'yes' })],
  ])('%s → null', (_label, value) => {
    expect(parsePlaybackSnapshot(value)).toBeNull()
  })
})

describe('captureMoment — 흐름', () => {
  it('누른 순간의 시점으로 kind=moment 주소를 만들어 YouTube 탭 옆에 연다 — 메모는 싣지 않는다', async () => {
    const { port, deps } = setup()

    expect(await captureMoment(deps, 1, ID)).toEqual(
      ok({ status: 'opened', tabId: 100, videoId: ID, atSeconds: 83 }),
    )
    expect(port.capturePlayback).toHaveBeenCalledTimes(1)
    const url = port.createTab.mock.calls[0]?.[0].url ?? ''
    expect(url).toBe(
      `https://39page.com/#collect?v=1&kind=moment&videoId=${ID}&atSeconds=83&title=Player+Title&req=${REQ}`,
    )
    expect(url).not.toMatch(/note|memo/)
    expect(port.createTab).toHaveBeenCalledWith(
      expect.objectContaining({ openerTabId: 1, index: 4, windowId: 9 }),
    )
  })

  it.each([
    ['shorts', `https://www.youtube.com/shorts/${ID}`],
    ['live', `https://www.youtube.com/live/${ID}`],
    ['not-watch', `https://www.youtube.com/embed/${ID}`],
  ] as const)('%s 페이지는 플레이어를 읽지 않고 거절한다', async (reason, url) => {
    const { port, deps } = setup({ tab: { id: 1, url, index: 0, windowId: 1 } })

    expect(await captureMoment(deps, 1, ID)).toEqual(ok({ status: 'refused', reason }))
    expect(port.capturePlayback).not.toHaveBeenCalled()
    expect(port.createTab).not.toHaveBeenCalled()
  })

  it('주소의 영상이 팝업이 본 영상과 다르면 page-changed — 다른 영상의 시점을 담지 않는다', async () => {
    const { port, deps } = setup()
    expect(await captureMoment(deps, 1, OTHER_ID)).toEqual(
      fail('page-changed', '팝업이 보여 준 영상과 지금 탭의 영상이 다르다'),
    )
    expect(port.capturePlayback).not.toHaveBeenCalled()
  })

  it('주소는 같아도 플레이어가 다른 영상이면 page-changed', async () => {
    const { port, deps } = setup({ playback: playback({ videoId: OTHER_ID }) })
    const result = await captureMoment(deps, 1, ID)
    expect(result.ok).toBe(false)
    expect(!result.ok && result.error.code).toBe('page-changed')
    expect(port.createTab).not.toHaveBeenCalled()
  })

  it.each([
    ['광고', playback({ adShowing: true }), 'ad'],
    ['시작 전', playback({ state: -1, currentTime: 0 }), 'not-started'],
    ['읽지 못함(null)', null, 'unreadable'],
  ] as const)('%s → 거절, 탭을 열지 않는다', async (_label, value, reason) => {
    const { port, deps } = setup({ playback: value })
    expect(await captureMoment(deps, 1, ID)).toEqual(ok({ status: 'refused', reason }))
    expect(port.createTab).not.toHaveBeenCalled()
  })

  it('메인 세계 실행이 실패하면 unreadable, 탭이 사라졌으면 no-tab', async () => {
    const denied = setup({ playbackError: new PortError('no-access', 'Cannot access') })
    expect(await captureMoment(denied.deps, 1, ID)).toEqual(
      ok({ status: 'refused', reason: 'unreadable' }),
    )
    const gone = setup({ playbackError: new PortError('no-tab', 'No tab with id') })
    const result = await captureMoment(gone.deps, 1, ID)
    expect(!result.ok && result.error.code).toBe('no-tab')
  })

  it('주소를 볼 수 없으면(권한 회수) page-changed — 팝업이 다시 확인한다', async () => {
    const { deps } = setup({ tab: { id: 1, url: undefined, index: 0, windowId: 1 } })
    const result = await captureMoment(deps, 1, ID)
    expect(!result.ok && result.error.code).toBe('page-changed')
  })

  it('빠른 연속 클릭 — 진행 중인 캡처를 같이 써서 탭은 하나다', async () => {
    const { port, deps } = setup()
    const [first, second] = await Promise.all([
      captureMoment(deps, 1, ID),
      captureMoment(deps, 1, ID),
    ])
    expect(first).toEqual(ok({ status: 'opened', tabId: 100, videoId: ID, atSeconds: 83 }))
    expect(second).toEqual(ok({ status: 'focused', tabId: 100, videoId: ID, atSeconds: 83 }))
    expect(port.createTab).toHaveBeenCalledTimes(1)
    expect(port.capturePlayback).toHaveBeenCalledTimes(1)
  })

  it('5초 안에 같은 영상 · 같은 시점이면 열어 둔 탭으로, 다른 시점이면 새 탭', async () => {
    const { port, deps, clock } = setup()
    await captureMoment(deps, 1, ID)

    clock.now += 1_000
    expect(await captureMoment(deps, 1, ID)).toEqual(
      ok({ status: 'focused', tabId: 100, videoId: ID, atSeconds: 83 }),
    )

    port.capturePlayback.mockResolvedValueOnce(playback({ currentTime: 90.1 }))
    expect(await captureMoment(deps, 1, ID)).toEqual(
      ok({ status: 'opened', tabId: 101, videoId: ID, atSeconds: 90 }),
    )

    clock.now += COLLECT_DEDUPE_WINDOW_MS
    expect(await captureMoment(deps, 1, ID)).toMatchObject(ok({ status: 'opened', tabId: 102 }))
  })

  it('거절은 같이 쓰되 focused 로 바꾸지 않는다', async () => {
    const { deps } = setup({ playback: playback({ adShowing: true }) })
    const [first, second] = await Promise.all([
      captureMoment(deps, 1, ID),
      captureMoment(deps, 1, ID),
    ])
    expect(first).toEqual(ok({ status: 'refused', reason: 'ad' }))
    expect(second).toEqual(ok({ status: 'refused', reason: 'ad' }))
  })

  it('제목은 같은 스냅샷의 플레이어 제목을 정리해 싣는다 — 없으면 싣지 않는다', async () => {
    const { port, deps } = setup({ playback: playback({ title: null }) })
    await captureMoment(deps, 1, ID)
    expect(port.createTab.mock.calls[0]?.[0].url).toBe(
      `https://39page.com/#collect?v=1&kind=moment&videoId=${ID}&atSeconds=83&req=${REQ}`,
    )
  })
})
