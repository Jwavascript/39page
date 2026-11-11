import { describe, expect, it } from 'vitest'

import {
  COLLECT_DEDUPE_WINDOW_MS,
  createCollectDeduper,
  openCollect,
} from '@/background/openCollect'
import { PortError } from '@/background/tabsPort'
import { fail, ok } from '@/shared/messages'

import { fakePort, ID, OTHER_ID } from './support/fakePort'

const REQ = '3f0c6b1e-8d2a-4c7e-9b5f-1a2b3c4d5e6f'

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

describe('collect/open — Quick Add (M10-3)', () => {
  it('지금 탭을 다시 확인하고, 그 영상과 제목으로 수집 화면을 YouTube 탭 옆에 연다', async () => {
    const { port, deps } = setup()

    expect(await openCollect(deps, 1, ID)).toEqual(ok({ status: 'opened', tabId: 100 }))
    expect(port.readPlayers).toHaveBeenCalled()
    expect(port.createTab).toHaveBeenCalledWith({
      url: `https://39page.com/#collect?v=1&kind=track&videoId=${ID}&title=Player+Title&req=${REQ}`,
      openerTabId: 1,
      index: 4,
      windowId: 9,
    })
  })

  it('사용자가 본 영상과 지금 탭이 다르면 거절하고 탭을 열지 않는다', async () => {
    const { port, deps } = setup()
    expect(await openCollect(deps, 1, OTHER_ID)).toMatchObject({
      ok: false,
      error: { code: 'page-changed' },
    })
    expect(port.createTab).not.toHaveBeenCalled()
  })

  it('영상 페이지가 아니게 됐으면 거절한다', async () => {
    const { port, deps } = setup({
      tab: { id: 1, url: 'https://www.youtube.com/', index: 0, windowId: 1 },
    })
    expect(await openCollect(deps, 1, ID)).toMatchObject({
      ok: false,
      error: { code: 'page-changed' },
    })
    expect(port.createTab).not.toHaveBeenCalled()
  })

  it('탭이 없으면 no-tab', async () => {
    const { deps } = setup({ tab: null })
    expect(await openCollect(deps, 1, ID)).toEqual(fail('no-tab', '탭을 찾을 수 없다'))
  })

  it('제목을 읽지 못하면 제목 없이 연다 — 웹앱이 기본 제목을 쓴다', async () => {
    const { port, deps } = setup({
      players: [{ videoId: OTHER_ID, title: '이전 영상' }],
      playersError: undefined,
      contentInstalled: false,
      injectError: new PortError('no-access', 'x'),
    })
    await openCollect(deps, 1, ID)
    expect(port.createTab.mock.calls[0]?.[0].url).toBe(
      `https://39page.com/#collect?v=1&kind=track&videoId=${ID}&req=${REQ}`,
    )
  })

  it('5초 안에 같은 영상을 다시 누르면 새 탭 대신 열어 둔 탭을 앞으로', async () => {
    const { port, deps, clock } = setup()
    await openCollect(deps, 1, ID)
    clock.now += COLLECT_DEDUPE_WINDOW_MS - 1

    expect(await openCollect(deps, 1, ID)).toEqual(ok({ status: 'focused', tabId: 100 }))
    expect(port.createTab).toHaveBeenCalledTimes(1)
    expect(port.focusTab).toHaveBeenCalledWith(100)
  })

  it('5초가 지났거나 열어 둔 탭이 닫혔으면 새로 연다', async () => {
    const late = setup()
    await openCollect(late.deps, 1, ID)
    late.clock.now += COLLECT_DEDUPE_WINDOW_MS
    expect(await openCollect(late.deps, 1, ID)).toEqual(ok({ status: 'opened', tabId: 101 }))

    const closed = setup({ aliveTabs: [] })
    await openCollect(closed.deps, 1, ID)
    expect(await openCollect(closed.deps, 1, ID)).toEqual(ok({ status: 'opened', tabId: 101 }))
  })

  it('동시에 두 번 와도(빠른 연속 클릭) 탭은 하나다', async () => {
    const { port, deps } = setup()
    const [first, second] = await Promise.all([openCollect(deps, 1, ID), openCollect(deps, 1, ID)])

    expect(first).toEqual(ok({ status: 'opened', tabId: 100 }))
    expect(second).toEqual(ok({ status: 'focused', tabId: 100 }))
    expect(port.createTab).toHaveBeenCalledTimes(1)
  })

  it('다른 영상은 5초 안이어도 따로 연다 (중복 기록은 영상별)', async () => {
    const first = setup()
    await openCollect(first.deps, 1, ID)

    const other = setup({
      tab: { id: 2, url: `https://www.youtube.com/watch?v=${OTHER_ID}`, index: 0, windowId: 9 },
      players: [{ videoId: OTHER_ID, title: '다른 곡' }],
    })
    const shared = { ...other.deps, deduper: first.deps.deduper }
    expect(await openCollect(shared, 2, OTHER_ID)).toEqual(ok({ status: 'opened', tabId: 100 }))
    expect(other.port.createTab).toHaveBeenCalledTimes(1)
    expect(other.port.focusTab).not.toHaveBeenCalled()
  })

  it('허용하지 않은 origin 이면 열지 않는다 (실행 중 검사)', async () => {
    const { port, deps } = setup()
    await expect(openCollect({ ...deps, origin: 'https://evil.example' }, 1, ID)).rejects.toThrow(
      '허용하지 않은 수집 origin',
    )
    expect(port.createTab).not.toHaveBeenCalled()
  })
})
