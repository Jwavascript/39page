import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  classifyChromeError,
  CONTENT_SCRIPT_FILE,
  createChromeTabsPort,
} from '@/background/chromeTabsPort'
import { readPlayersInPage } from '@/background/pageFunctions'
import { PortError } from '@/background/tabsPort'

type AnyFn = (...args: never[]) => unknown

describe('Chrome 오류 문구 → 실패 종류', () => {
  it.each([
    ['Could not establish connection. Receiving end does not exist.', 'no-receiver'],
    ['The message port closed before a response was received.', 'no-receiver'],
    ['No tab with id: 42.', 'no-tab'],
    ['Frame with ID 0 was removed.', 'no-tab'],
    [
      'Cannot access contents of the page. Extension manifest must request permission to access the respective host.',
      'no-access',
    ],
    ['Cannot access a chrome:// URL', 'no-access'],
    ['Missing host permission for the tab', 'no-access'],
    ['The extensions gallery cannot be scripted.', 'no-access'],
    ['Something else', 'other'],
  ])('%s → %s', (message, failure) => {
    expect(classifyChromeError(new Error(message))).toBe(failure)
  })
})

describe('createChromeTabsPort', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  function stubChrome(overrides: Record<string, unknown>) {
    vi.stubGlobal('chrome', {
      tabs: { get: vi.fn<AnyFn>(), sendMessage: vi.fn<AnyFn>() },
      scripting: { executeScript: vi.fn<AnyFn>() },
      ...overrides,
    })
  }

  it('탭이 없으면 null', async () => {
    stubChrome({ tabs: { get: vi.fn<AnyFn>().mockRejectedValue(new Error('No tab with id: 3.')) } })
    expect(await createChromeTabsPort({ contentTimeoutMs: 100 }).getTab(3)).toBeNull()
  })

  it('url 을 그대로 옮긴다 (권한이 없으면 undefined). 탭 제목은 쓰지 않는다', async () => {
    stubChrome({
      tabs: { get: vi.fn<AnyFn>().mockResolvedValue({ id: 3, title: 'Old - YouTube' }) },
    })
    expect(await createChromeTabsPort({ contentTimeoutMs: 100 }).getTab(3)).toEqual({
      id: 3,
      url: undefined,
      index: undefined,
      windowId: undefined,
    })
  })

  it('최상위 프레임에만 보내고, 수신자 없음을 PortError 로 바꾼다', async () => {
    const sendMessage = vi
      .fn<AnyFn>()
      .mockRejectedValue(new Error('Could not establish connection. Receiving end does not exist.'))
    stubChrome({ tabs: { get: vi.fn<AnyFn>(), sendMessage } })
    const port = createChromeTabsPort({ contentTimeoutMs: 100 })
    const error = await port.sendToContent(5, { v: 1, type: 'page/read' }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(PortError)
    expect((error as PortError).failure).toBe('no-receiver')
    expect(sendMessage).toHaveBeenCalledWith(5, { v: 1, type: 'page/read' }, { frameId: 0 })
  })

  it('content 가 답하지 않으면 시간 초과', async () => {
    vi.useFakeTimers()
    stubChrome({
      tabs: { get: vi.fn<AnyFn>(), sendMessage: vi.fn<AnyFn>(() => new Promise(() => {})) },
    })
    const pending = createChromeTabsPort({ contentTimeoutMs: 3000 })
      .sendToContent(5, { v: 1, type: 'page/read' })
      .catch((e: unknown) => e)
    await vi.advanceTimersByTimeAsync(3000)
    const error = await pending
    expect((error as PortError).failure).toBe('timeout')
  })

  it('content.js 하나를 최상위 프레임에 주입한다', async () => {
    const executeScript = vi.fn<AnyFn>().mockResolvedValue([])
    stubChrome({ scripting: { executeScript } })
    await createChromeTabsPort({ contentTimeoutMs: 100 }).injectContent(8)
    expect(executeScript).toHaveBeenCalledWith({
      target: { tabId: 8, frameIds: [0] },
      files: [CONTENT_SCRIPT_FILE],
    })
    expect(CONTENT_SCRIPT_FILE).toBe('content.js')
  })

  it('플레이어는 최상위 프레임의 메인 세계에서 읽고 결과를 그대로 넘긴다', async () => {
    const executeScript = vi
      .fn<AnyFn>()
      .mockResolvedValue([{ frameId: 0, result: [{ videoId: 'x', title: null }] }])
    stubChrome({ scripting: { executeScript } })
    expect(await createChromeTabsPort({ contentTimeoutMs: 100 }).readPlayers(8)).toEqual([
      { videoId: 'x', title: null },
    ])
    expect(executeScript).toHaveBeenCalledWith({
      target: { tabId: 8, frameIds: [0] },
      world: 'MAIN',
      func: readPlayersInPage,
    })
  })

  it('플레이어 읽기 실패도 PortError 로 바꾼다', async () => {
    stubChrome({
      scripting: {
        executeScript: vi
          .fn<AnyFn>()
          .mockRejectedValue(new Error('Missing host permission for the tab')),
      },
    })
    const error = await createChromeTabsPort({ contentTimeoutMs: 100 })
      .readPlayers(8)
      .catch((e: unknown) => e)
    expect((error as PortError).failure).toBe('no-access')
  })

  it('수집 탭을 앞으로 열고 id 를 돌려준다', async () => {
    const create = vi.fn<AnyFn>().mockResolvedValue({ id: 55 })
    stubChrome({ tabs: { get: vi.fn<AnyFn>(), sendMessage: vi.fn<AnyFn>(), create } })
    const port = createChromeTabsPort({ contentTimeoutMs: 100 })
    expect(
      await port.createTab({
        url: 'https://39page.com/#collect?v=1',
        openerTabId: 3,
        index: 4,
        windowId: 9,
      }),
    ).toEqual({ id: 55 })
    expect(create).toHaveBeenCalledWith({
      url: 'https://39page.com/#collect?v=1',
      openerTabId: 3,
      index: 4,
      windowId: 9,
      active: true,
    })
  })

  it('탭을 앞으로 가져오고, 없으면 false', async () => {
    const update = vi
      .fn<AnyFn>()
      .mockResolvedValueOnce({ id: 55, windowId: 9 })
      .mockRejectedValueOnce(new Error('No tab with id: 56.'))
    const windowsUpdate = vi.fn<AnyFn>().mockResolvedValue({})
    stubChrome({
      tabs: { get: vi.fn<AnyFn>(), sendMessage: vi.fn<AnyFn>(), update },
      windows: { update: windowsUpdate },
    })
    const port = createChromeTabsPort({ contentTimeoutMs: 100 })
    expect(await port.focusTab(55)).toBe(true)
    expect(windowsUpdate).toHaveBeenCalledWith(9, { focused: true })
    expect(await port.focusTab(56)).toBe(false)
  })

  it('getTab 이 창 안의 순서와 창을 옮긴다', async () => {
    stubChrome({
      tabs: {
        get: vi.fn<AnyFn>().mockResolvedValue({ id: 3, url: 'https://x/', index: 2, windowId: 7 }),
      },
    })
    expect(await createChromeTabsPort({ contentTimeoutMs: 100 }).getTab(3)).toEqual({
      id: 3,
      url: 'https://x/',
      index: 2,
      windowId: 7,
    })
  })

  it('주입 거부를 no-access 로 바꾼다', async () => {
    stubChrome({
      scripting: {
        executeScript: vi.fn<AnyFn>().mockRejectedValue(new Error('Cannot access a chrome:// URL')),
      },
    })
    const error = await createChromeTabsPort({ contentTimeoutMs: 100 })
      .injectContent(8)
      .catch((e: unknown) => e)
    expect((error as PortError).failure).toBe('no-access')
  })
})
