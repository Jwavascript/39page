import { afterEach, describe, expect, it, vi } from 'vitest'

import { fakeEvent } from './support/fakeEvent'

const EXTENSION_ID = 'abcdefghijklmnopabcdefghijklmnop'
const ORIGIN = `chrome-extension://${EXTENSION_ID}/`

type Listener = (message: unknown, sender: unknown, sendResponse: (r: unknown) => void) => unknown

/** 워커 시작 = 모듈을 처음부터 실행. 실제로 서비스 워커가 다시 깨어날 때와 같다. */
async function startWorker() {
  const onMessage = fakeEvent<Listener>()
  vi.stubGlobal('chrome', {
    runtime: { id: EXTENSION_ID, getURL: (path: string) => `${ORIGIN}${path}`, onMessage },
    tabs: {
      get: vi
        .fn<(id: number) => Promise<object>>()
        .mockResolvedValue({ id: 1, url: 'https://example.com/', title: 'x' }),
      sendMessage: vi.fn<() => Promise<unknown>>(),
    },
    scripting: { executeScript: vi.fn<() => Promise<unknown>>() },
  })
  vi.resetModules()
  await import('@/background/index')
  return onMessage
}

function send(listener: Listener, message: unknown, sender: unknown) {
  return new Promise((resolve) => {
    const keepOpen = listener(message, sender, resolve)
    expect(keepOpen).toBe(true)
  })
}

describe('Background 진입점', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('불러오는 즉시 리스너 하나를 동기로 건다', async () => {
    const onMessage = await startWorker()
    expect(onMessage.listeners).toHaveLength(1)
  })

  it('비동기로 답한다 (true 를 돌려주고 sendResponse 를 나중에 부른다)', async () => {
    const [listener] = (await startWorker()).listeners
    const reply = await send(
      listener!,
      { v: 1, type: 'tab/inspect', tabId: 1 },
      {
        id: EXTENSION_ID,
        url: `${ORIGIN}src/popup/index.html`,
      },
    )
    expect(reply).toEqual({
      v: 1,
      ok: true,
      data: { status: 'unsupported', reason: 'not-youtube' },
    })
  })

  it('워커가 다시 시작해도(모듈 재실행) 상태 없이 같은 답을 한다', async () => {
    const sender = { id: EXTENSION_ID, url: `${ORIGIN}src/popup/index.html` }
    const message = { v: 1, type: 'tab/inspect', tabId: 1 }
    const before = await send((await startWorker()).listeners[0]!, message, sender)
    const after = await send((await startWorker()).listeners[0]!, message, sender)
    expect(after).toEqual(before)
  })

  it('웹페이지·content script 가 보낸 것은 거절한다', async () => {
    const [listener] = (await startWorker()).listeners
    const reply = await send(
      listener!,
      { v: 1, type: 'tab/inspect', tabId: 1 },
      {
        id: EXTENSION_ID,
        url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      },
    )
    expect(reply).toMatchObject({ ok: false, error: { code: 'forbidden-sender' } })
  })
})
