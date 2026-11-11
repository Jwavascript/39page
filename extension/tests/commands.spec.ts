/**
 * 단축키 (M10-5) — 팝업 없이 같은 경로로 Quick Add · Moment 캡처. 담지 못하면 그 탭
 * 아이콘에 `!` 와 이유를 달고 6초 뒤 지운다.
 */
import { describe, expect, it, vi } from 'vitest'

import type { ActionPort } from '@/background/actionPort'
import { BADGE_CLEAR_MS, handleCommand } from '@/background/commands'
import { createCollectDeduper } from '@/background/openCollect'

import { fakePort, ID, playback } from './support/fakePort'

const REQ = '3f0c6b1e-8d2a-4c7e-9b5f-1a2b3c4d5e6f'

function setup(options: Parameters<typeof fakePort>[0] = {}) {
  const { port } = fakePort(options)
  const action = {
    flag: vi.fn<ActionPort['flag']>(async () => {}),
    clear: vi.fn<ActionPort['clear']>(async () => {}),
  }
  const timers: { run: () => void; ms: number }[] = []
  const deps = {
    port,
    origin: 'https://39page.com',
    deduper: createCollectDeduper(),
    newRequestId: () => REQ,
    now: () => 1_000,
    action,
    later: (run: () => void, ms: number) => timers.push({ run, ms }),
  }
  return { port, action, timers, deps }
}

describe('handleCommand — 단축키', () => {
  it('quick-add — 탭을 확인하고 수집 화면을 연다 (팝업과 같은 경로)', async () => {
    const { port, action, deps } = setup()
    expect(await handleCommand(deps, 'quick-add', { id: 1 })).toEqual({
      kind: 'opened',
      tabId: 100,
    })
    expect(port.createTab.mock.calls[0]?.[0].url).toBe(
      `https://39page.com/#collect?v=1&kind=track&videoId=${ID}&title=Player+Title&req=${REQ}`,
    )
    expect(action.flag).not.toHaveBeenCalled()
    expect(action.clear).toHaveBeenCalledWith(1)
  })

  it('capture-moment — 누른 순간의 시점으로 Moment 수집 화면을 연다', async () => {
    const { port, deps } = setup()
    expect(await handleCommand(deps, 'capture-moment', { id: 1 })).toEqual({
      kind: 'opened',
      tabId: 100,
    })
    expect(port.createTab.mock.calls[0]?.[0].url).toContain('kind=moment')
    expect(port.createTab.mock.calls[0]?.[0].url).toContain('atSeconds=83')
  })

  it('거절되면 아이콘에 이유를 달고 6초 뒤 지운다 — 탭은 열지 않는다', async () => {
    const { port, action, timers, deps } = setup({ playback: playback({ adShowing: true }) })
    expect(await handleCommand(deps, 'capture-moment', { id: 1 })).toEqual({
      kind: 'flagged',
      message: '광고가 재생 중입니다. 광고가 끝난 뒤 다시 눌러 주세요.',
    })
    expect(port.createTab).not.toHaveBeenCalled()
    expect(action.flag).toHaveBeenCalledWith(
      1,
      '광고가 재생 중입니다. 광고가 끝난 뒤 다시 눌러 주세요.',
    )
    expect(timers).toHaveLength(1)
    expect(timers[0]?.ms).toBe(BADGE_CLEAR_MS)
    timers[0]?.run()
    expect(action.clear).toHaveBeenCalledWith(1)
  })

  it.each([
    ['다른 사이트', 'https://example.com/', 'YouTube 영상 페이지에서 단축키를 눌러 주세요.'],
    [
      'YouTube Music',
      `https://music.youtube.com/watch?v=${ID}`,
      'YouTube Music 은 아직 지원하지 않습니다.',
    ],
  ])('%s 에서는 아이콘으로 알린다', async (_label, url, message) => {
    const { port, action, deps } = setup({ tab: { id: 1, url, index: 0, windowId: 1 } })
    expect(await handleCommand(deps, 'quick-add', { id: 1 })).toEqual({ kind: 'flagged', message })
    expect(action.flag).toHaveBeenCalledWith(1, message)
    expect(port.createTab).not.toHaveBeenCalled()
  })

  it('Shorts 에서 Moment 단축키는 거절, 담기 단축키는 된다', async () => {
    const shorts = { id: 1, url: `https://www.youtube.com/shorts/${ID}`, index: 0, windowId: 1 }
    const moment = setup({ tab: shorts })
    expect(await handleCommand(moment.deps, 'capture-moment', { id: 1 })).toEqual({
      kind: 'flagged',
      message: 'Shorts 는 아직 Moment 를 저장할 수 없습니다.',
    })
    const quick = setup({ tab: shorts })
    expect(await handleCommand(quick.deps, 'quick-add', { id: 1 })).toMatchObject({
      kind: 'opened',
    })
  })

  it('재생목록 안의 영상(&list=)도 그 영상으로 담는다', async () => {
    const { port, deps } = setup({
      tab: {
        id: 1,
        url: `https://www.youtube.com/watch?v=${ID}&list=PL123&index=3`,
        index: 2,
        windowId: 1,
      },
    })
    await handleCommand(deps, 'capture-moment', { id: 1 })
    expect(port.createTab.mock.calls[0]?.[0].url).toContain(`videoId=${ID}`)
  })

  it('탭을 모르거나 모르는 명령이면 아무것도 하지 않는다', async () => {
    const { port, action, deps } = setup()
    expect(await handleCommand(deps, 'quick-add', undefined)).toEqual({ kind: 'ignored' })
    expect(await handleCommand(deps, 'quick-add', {})).toEqual({ kind: 'ignored' })
    expect(await handleCommand(deps, 'other', { id: 1 })).toEqual({ kind: 'ignored' })
    expect(port.getTab).not.toHaveBeenCalled()
    expect(action.flag).not.toHaveBeenCalled()
  })

  it('처리 중 예외는 아이콘으로만 알리고 던지지 않는다 (내부 문구를 싣지 않는다)', async () => {
    const { port, action, deps } = setup()
    port.getTab.mockRejectedValueOnce(new Error('secret stack detail'))
    const outcome = await handleCommand(deps, 'quick-add', { id: 1 })
    expect(outcome).toEqual({ kind: 'flagged', message: '확장 내부 오류 — 다시 눌러 주세요.' })
    expect(JSON.stringify(action.flag.mock.calls)).not.toContain('secret')
  })

  it('팝업과 같은 중복 기록을 쓴다 — 5초 안 같은 영상이면 열어 둔 탭으로', async () => {
    const { port, deps } = setup()
    await handleCommand(deps, 'quick-add', { id: 1 })
    expect(await handleCommand(deps, 'quick-add', { id: 1 })).toEqual({
      kind: 'focused',
      tabId: 100,
    })
    expect(port.createTab).toHaveBeenCalledTimes(1)
  })
})
