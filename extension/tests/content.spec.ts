import { describe, expect, it, vi } from 'vitest'

import {
  createContentListener,
  installContentListener,
  LISTENER_SLOT,
  type ContentListener,
} from '@/content/listener'
import { readPageSnapshot } from '@/content/readPage'
import { fail, ok, SNAPSHOT_TEXT_MAX } from '@/shared/messages'

import { fakeEvent } from './support/fakeEvent'

const EXTENSION_ID = 'abcdefghijklmnopabcdefghijklmnop'
const ID = 'dQw4w9WgXcQ'

function watchDocument(): Document {
  const doc = document.implementation.createHTMLDocument('(4) Song - YouTube')
  doc.body.innerHTML = `
    <ytd-watch-flexy video-id="${ID}">
      <ytd-watch-metadata><div id="title"><h1><yt-formatted-string>Song</yt-formatted-string></h1></div></ytd-watch-metadata>
    </ytd-watch-flexy>`
  return doc
}

describe('readPageSnapshot — 읽기만 한다', () => {
  it('시청 페이지에서 주소 · 영상 ID · 제목 줄을 읽는다 (document.title 은 싣지 않는다)', () => {
    expect(readPageSnapshot(watchDocument(), `https://www.youtube.com/watch?v=${ID}`)).toEqual({
      href: `https://www.youtube.com/watch?v=${ID}`,

      watch: { videoId: ID, heading: 'Song' },
    })
  })

  it('요소가 없으면 null — 선택자가 바뀌어도 던지지 않는다', () => {
    const doc = document.implementation.createHTMLDocument('Shorts - YouTube')
    expect(readPageSnapshot(doc, 'https://www.youtube.com/shorts/x').watch).toEqual({
      videoId: null,
      heading: null,
    })
  })

  it('페이지를 바꾸지 않는다', () => {
    const doc = watchDocument()
    const before = doc.documentElement.outerHTML
    readPageSnapshot(doc, 'https://www.youtube.com/watch?v=x')
    expect(doc.documentElement.outerHTML).toBe(before)
  })

  it('긴 문자열은 계약 상한으로 자른다 — 응답이 검증에서 버려지지 않게', () => {
    const doc = document.implementation.createHTMLDocument('t')
    doc.body.innerHTML = `<ytd-watch-metadata><h1>${'x'.repeat(SNAPSHOT_TEXT_MAX + 50)}</h1></ytd-watch-metadata>`
    expect(readPageSnapshot(doc, 'https://www.youtube.com/').watch.heading).toHaveLength(
      SNAPSHOT_TEXT_MAX,
    )
  })
})

describe('content 리스너', () => {
  const snapshot = readPageSnapshot(watchDocument(), `https://www.youtube.com/watch?v=${ID}`)
  const listener = createContentListener({ extensionId: EXTENSION_ID, read: () => snapshot })

  function call(message: unknown, sender: { id?: string } = { id: EXTENSION_ID }) {
    const sendResponse = vi.fn<(response: unknown) => void>()
    const keepOpen = listener(message, sender, sendResponse)
    return { keepOpen, response: sendResponse.mock.calls[0]?.[0] }
  }

  it('page/read 에 스냅샷으로 답한다 — 동기로, 채널을 열어 두지 않는다', () => {
    expect(call({ v: 1, type: 'page/read' })).toEqual({ keepOpen: false, response: ok(snapshot) })
  })

  it('다른 확장이 보낸 것은 거절한다', () => {
    expect(call({ v: 1, type: 'page/read' }, { id: 'other' }).response).toMatchObject({
      ok: false,
      error: { code: 'forbidden-sender' },
    })
  })

  it.each([
    [{ v: 1, type: 'player/position' }, 'unsupported-type'],
    [{ v: 2, type: 'page/read' }, 'unsupported-version'],
    [null, 'bad-request'],
  ])('%j → %s', (message, code) => {
    expect(call(message).response).toMatchObject({ ok: false, error: { code } })
  })

  it('읽다가 예외가 나면 internal 로 답한다', () => {
    const broken = createContentListener({
      extensionId: EXTENSION_ID,
      read: () => {
        throw new Error('boom')
      },
    })
    const sendResponse = vi.fn<(response: unknown) => void>()
    broken({ v: 1, type: 'page/read' }, { id: EXTENSION_ID }, sendResponse)
    expect(sendResponse).toHaveBeenCalledWith(fail('internal', '페이지를 읽지 못했다'))
  })
})

describe('installContentListener — 다시 주입돼도 리스너는 하나', () => {
  it('앞의 리스너를 떼고 새로 건다', () => {
    const events = fakeEvent<ContentListener>()
    const slot: Record<string, unknown> = {}
    const first = vi.fn<ContentListener>(() => false as const)
    const second = vi.fn<ContentListener>(() => false as const)

    installContentListener(events, slot, first)
    installContentListener(events, slot, second)

    expect(events.listeners).toEqual([second])
    expect(slot[LISTENER_SLOT]).toBe(second)
  })

  it('옛 리스너를 떼다 실패해도(끊긴 확장 문맥) 새 리스너는 건다', () => {
    const events = fakeEvent<ContentListener>()
    const slot: Record<string, unknown> = { [LISTENER_SLOT]: vi.fn<ContentListener>() }
    events.removeListener = () => {
      throw new Error('Extension context invalidated.')
    }
    const fresh = vi.fn<ContentListener>(() => false as const)
    installContentListener(events, slot, fresh)
    expect(events.listeners).toEqual([fresh])
  })
})
