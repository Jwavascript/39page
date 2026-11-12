/**
 * 단축키 (M10-5 → M11-5B) — YouTube 위 패널을 연다. 새 탭을 열지 않는다. Moment 단축키는 누른 순간의
 * 시점을 잡아 패널에 넘긴다(잡지 못한 이유도 패널이 보인다). 패널을 띄우지 못하거나 영상 페이지가
 * 아니면 그 탭 아이콘에 `!` 와 이유를 달고 6초 뒤 지운다.
 */
import { describe, expect, it, vi } from 'vitest'

import type { ActionPort } from '@/background/actionPort'
import { BADGE_CLEAR_MS, handleCommand } from '@/background/commands'
import { createCollectDeduper } from '@/background/openCollect'
import type { PanelSession } from '@/background/panel'
import { PortError } from '@/background/tabsPort'

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
    sessions: new Map<number, PanelSession>(),
    action,
    later: (run: () => void, ms: number) => timers.push({ run, ms }),
  }
  return { port, action, timers, deps }
}

describe('handleCommand — 단축키 → 패널', () => {
  it('quick-add — 음악 담기 패널을 연다 · 새 탭 없음', async () => {
    const { port, action, deps } = setup()
    expect(await handleCommand(deps, 'quick-add', { id: 1 })).toEqual({ kind: 'opened', tabId: 1 })
    expect(port.sendToContent).toHaveBeenCalledWith(1, { v: 1, type: 'panel/open' })
    expect(port.createTab).not.toHaveBeenCalled()
    expect(deps.sessions.get(1)).toMatchObject({ seq: 1, mode: 'music', capture: null })
    expect(action.flag).not.toHaveBeenCalled()
    expect(action.clear).toHaveBeenCalledWith(1)
  })

  it('capture-moment — 누른 순간의 시점을 잡아 Moment 패널에 넘긴다', async () => {
    const { port, deps } = setup()
    expect(await handleCommand(deps, 'capture-moment', { id: 1 })).toEqual({
      kind: 'opened',
      tabId: 1,
    })
    expect(port.createTab).not.toHaveBeenCalled()
    expect(deps.sessions.get(1)).toMatchObject({
      mode: 'moment',
      capture: { status: 'captured', videoId: ID, atSeconds: 83, at: 1_000 },
    })
  })

  it('패널이 이미 떠 있으면 다시 띄우지 않고 지시만 바꾼다 (번호가 오른다)', async () => {
    const { deps } = setup()
    await handleCommand(deps, 'quick-add', { id: 1 })
    expect(await handleCommand(deps, 'capture-moment', { id: 1 })).toEqual({
      kind: 'focused',
      tabId: 1,
    })
    expect(deps.sessions.get(1)).toMatchObject({ seq: 2, mode: 'moment' })
  })

  it('광고 중 Moment 단축키 — 패널은 열고 잡지 못한 이유를 넘긴다 (아이콘 배지 없음)', async () => {
    const { action, deps } = setup({ playback: playback({ adShowing: true }) })
    expect(await handleCommand(deps, 'capture-moment', { id: 1 })).toEqual({
      kind: 'opened',
      tabId: 1,
    })
    expect(deps.sessions.get(1)?.capture).toEqual({ status: 'refused', reason: 'ad' })
    expect(action.flag).not.toHaveBeenCalled()
  })

  it.each([
    ['다른 사이트', 'https://example.com/', 'YouTube 영상 페이지에서 단축키를 눌러 주세요.'],
    [
      'YouTube Music',
      `https://music.youtube.com/watch?v=${ID}`,
      'YouTube Music 은 아직 지원하지 않습니다.',
    ],
  ])('%s 에서는 아이콘으로 알리고 6초 뒤 지운다', async (_label, url, message) => {
    const { port, action, timers, deps } = setup({ tab: { id: 1, url, index: 0, windowId: 1 } })
    expect(await handleCommand(deps, 'quick-add', { id: 1 })).toEqual({ kind: 'flagged', message })
    expect(action.flag).toHaveBeenCalledWith(1, message)
    expect(port.createTab).not.toHaveBeenCalled()
    expect(timers[0]?.ms).toBe(BADGE_CLEAR_MS)
    timers[0]?.run()
    expect(action.clear).toHaveBeenCalledWith(1)
  })

  it('패널을 띄우지 못하면(주입 실패) 아이콘으로 알린다', async () => {
    const { action, deps } = setup({
      contentInstalled: false,
      injectError: new PortError('no-access', 'no access'),
    })
    const outcome = await handleCommand(deps, 'quick-add', { id: 1 })
    expect(outcome.kind).toBe('flagged')
    expect(action.flag).toHaveBeenCalled()
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
})
