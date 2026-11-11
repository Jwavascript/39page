import { describe, expect, it, vi } from 'vitest'

import { createBackgroundRouter } from '@/background/router'
import { fail } from '@/shared/messages'

import { fakePort, ID } from './support/fakePort'

const EXTENSION_ID = 'abcdefghijklmnopabcdefghijklmnop'
const ORIGIN = `chrome-extension://${EXTENSION_ID}/`
const POPUP = { id: EXTENSION_ID, url: `${ORIGIN}src/popup/index.html` }

function router(port = fakePort({}).port) {
  return createBackgroundRouter({ port, extensionId: EXTENSION_ID, extensionOrigin: ORIGIN })
}

describe('Background 라우터', () => {
  it('팝업의 tab/inspect 를 처리한다', async () => {
    const result = await router().handle({ v: 1, type: 'tab/inspect', tabId: 1 }, POPUP)
    expect(result.ok && result.data).toMatchObject({ status: 'video', videoId: ID })
  })

  it.each([
    [
      '다른 확장',
      { id: 'zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz', url: 'chrome-extension://zzzz/x.html' },
    ],
    [
      '우리 content script (페이지 주소)',
      { id: EXTENSION_ID, url: 'https://www.youtube.com/watch?v=x' },
    ],
    ['주소 없음', { id: EXTENSION_ID }],
    ['id 없음 (웹페이지)', { url: `${ORIGIN}src/popup/index.html` }],
    ['비슷한 origin', { id: EXTENSION_ID, url: `chrome-extension://${EXTENSION_ID}x/a.html` }],
  ])('보낸 쪽 거절 — %s', async (_label, sender) => {
    const { port } = fakePort({})
    const result = await router(port).handle({ v: 1, type: 'tab/inspect', tabId: 1 }, sender)
    expect(!result.ok && result.error.code).toBe('forbidden-sender')
    expect(port.getTab).not.toHaveBeenCalled()
  })

  it.each([
    [{ v: 1, type: 'nope' }, 'unsupported-type'],
    [{ v: 9, type: 'tab/inspect', tabId: 1 }, 'unsupported-version'],
    [{ v: 1, type: 'tab/inspect', tabId: 'one' }, 'bad-request'],
    ['tab/inspect', 'bad-request'],
  ])('요청 거절 %j → %s', async (message, code) => {
    const result = await router().handle(message, POPUP)
    expect(!result.ok && result.error.code).toBe(code)
  })

  it('처리 중 예외는 internal 로 바꾸고 내부 문구를 싣지 않는다', async () => {
    const { port } = fakePort({})
    port.getTab.mockRejectedValueOnce(new Error('secret stack detail'))
    const result = await router(port).handle({ v: 1, type: 'tab/inspect', tabId: 1 }, POPUP)
    expect(result).toEqual(fail('internal', '확장 내부 오류'))
  })

  it('상태를 갖지 않는다 — 같은 요청에 같은 답', async () => {
    const r = router()
    const first = await r.handle({ v: 1, type: 'tab/inspect', tabId: 1 }, POPUP)
    const second = await r.handle({ v: 1, type: 'tab/inspect', tabId: 1 }, POPUP)
    expect(second).toEqual(first)
  })

  it('잘못된 요청은 탭에 손대지 않는다', async () => {
    const { port } = fakePort({})
    const spy = vi.spyOn(port, 'getTab')
    await router(port).handle({ v: 1, type: 'tab/inspect', tabId: -5 }, POPUP)
    expect(spy).not.toHaveBeenCalled()
  })
})
