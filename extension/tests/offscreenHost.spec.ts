/**
 * M11-5 — offscreen 문서 (`offscreenHost.ts`): 서비스 워커의 메시지만 · 자기 세대만 · 39page iframe 만.
 */
import { describe, expect, it, vi } from 'vitest'

import { createOffscreenHost } from '@/offscreen/offscreenHost'

const ID = 'pkagnijdhfmkodpdfgdehfdghcgbfpoa'
const WORKER = `chrome-extension://${ID}/background.js`
const ORIGIN = 'https://39page.com'
const SW = { id: ID, url: WORKER }

function setup() {
  const posted: { message: unknown; origin: string }[] = []
  const win = {
    postMessage: (message: unknown, origin: string) => void posted.push({ message, origin }),
  }
  const host = createOffscreenHost({
    gen: 3,
    bridgeOrigin: ORIGIN,
    extensionId: ID,
    workerUrl: WORKER,
    frame: { contentWindow: win },
    readyTimeoutMs: 30,
  })
  const ask = (message: unknown, sender: object = SW) =>
    new Promise<unknown>((resolve) => {
      const async = host.onRuntimeMessage(message, sender, resolve)
      if (!async) setTimeout(() => resolve('no-answer'), 5)
    })
  return { host, win, posted, ask }
}

const request = (id = 'req-0000000000000001') => ({
  ns: '39page-bridge',
  v: 1,
  kind: 'request',
  id,
  deadline: 1,
  payload: { op: 'hello' },
})

describe('offscreen 문서', () => {
  it('신뢰하는 창과 origin이어도 버전 없는/다른 버전의 ready는 무시한다', () => {
    const s = setup()
    for (const v of [undefined, 0, 2, '1']) {
      s.host.onFrameMessage({
        source: s.win,
        origin: ORIGIN,
        data: { ns: '39page-bridge', v, kind: 'ready' },
      })
    }
    expect(s.host.state()).toBe('loading')
  })
  it('서비스 워커가 아닌 보낸 쪽(패널 · content script · 다른 주소)은 무시한다', async () => {
    const s = setup()
    const ready = { target: 'offscreen', kind: 'ready', gen: 3 }
    expect(
      await s.ask(ready, {
        id: ID,
        url: `chrome-extension://${ID}/src/panel/index.html`,
        tab: { id: 1 },
      }),
    ).toBe('no-answer')
    expect(
      await s.ask(ready, { id: ID, url: 'https://www.youtube.com/watch?v=x', tab: { id: 1 } }),
    ).toBe('no-answer')
    expect(await s.ask(ready, { id: 'other', url: WORKER })).toBe('no-answer')
  })

  it('다른 세대의 요청은 stale-gen 으로 거절한다', async () => {
    const s = setup()
    const reply = vi.fn<(reply: unknown) => void>()
    s.host.onRuntimeMessage({ target: 'offscreen', kind: 'ready', gen: 2 }, SW, reply)
    expect(reply).toHaveBeenCalledWith({ ok: false, transport: 'stale-gen' })
  })

  it('준비 — 39page iframe 의 ready 를 기다린다. 다른 origin · 다른 창의 신호는 무시', async () => {
    const s = setup()
    const waiting = s.ask({ target: 'offscreen', kind: 'ready', gen: 3 })
    s.host.onFrameMessage({
      source: s.win,
      origin: 'https://evil.example',
      data: { ns: '39page-bridge', v: 1, kind: 'ready' },
    })
    s.host.onFrameMessage({
      source: {},
      origin: ORIGIN,
      data: { ns: '39page-bridge', v: 1, kind: 'ready' },
    })
    expect(s.host.state()).toBe('loading')
    s.host.onFrameMessage({
      source: s.win,
      origin: ORIGIN,
      data: { ns: '39page-bridge', v: 1, kind: 'ready', status: { a: 1 } },
    })
    expect(await waiting).toEqual({ ok: true, status: { a: 1 } })
  })

  it('브리지가 거절(허용 목록 밖)하면 not-allowed, 오지 않으면 not-ready', async () => {
    const refused = setup()
    refused.host.onFrameMessage({
      source: refused.win,
      origin: ORIGIN,
      data: { ns: '39page-bridge', v: 1, kind: 'refused' },
    })
    expect(await refused.ask({ target: 'offscreen', kind: 'ready', gen: 3 })).toEqual({
      ok: false,
      transport: 'not-allowed',
    })
    const silent = setup()
    expect(await silent.ask({ target: 'offscreen', kind: 'ready', gen: 3 })).toEqual({
      ok: false,
      transport: 'not-ready',
    })
  })

  it('요청을 39page origin 으로만 보내고, 그 ID 의 답을 돌려준다 · 답이 없으면 timeout', async () => {
    const s = setup()
    s.host.onFrameMessage({
      source: s.win,
      origin: ORIGIN,
      data: { ns: '39page-bridge', v: 1, kind: 'ready' },
    })
    const answer = s.ask({
      target: 'offscreen',
      kind: 'call',
      gen: 3,
      request: request(),
      waitMs: 50,
    })
    expect(s.posted).toEqual([{ message: request(), origin: ORIGIN }])
    const response = {
      ns: '39page-bridge',
      v: 1,
      kind: 'response',
      id: 'req-0000000000000001',
      ok: true,
      data: 1,
    }
    s.host.onFrameMessage({ source: s.win, origin: ORIGIN, data: response })
    expect(await answer).toEqual({ ok: true, answer: response })

    const lost = s.ask({
      target: 'offscreen',
      kind: 'call',
      gen: 3,
      request: request('req-0000000000000002'),
      waitMs: 10,
    })
    expect(await lost).toEqual({ ok: false, transport: 'timeout' })
  })

  it('준비 전 요청은 보내지 않는다 (not-ready)', async () => {
    const s = setup()
    expect(
      await s.ask({ target: 'offscreen', kind: 'call', gen: 3, request: request(), waitMs: 10 }),
    ).toEqual({
      ok: false,
      transport: 'not-ready',
    })
    expect(s.posted).toHaveLength(0)
  })

  it('유휴 — 요청이 없고 처리 중인 것도 없으면 한 번 알린다, 처리 중이면 기다린다 (M11-6)', async () => {
    vi.useFakeTimers()
    const notifyIdle = vi.fn<(gen: number) => void>()
    const posted: unknown[] = []
    const win = { postMessage: (message: unknown) => void posted.push(message) }
    const host = createOffscreenHost({
      gen: 3,
      bridgeOrigin: ORIGIN,
      extensionId: ID,
      workerUrl: WORKER,
      frame: { contentWindow: win },
      idleMs: 1_000,
      notifyIdle,
    })
    host.onFrameMessage({
      source: win,
      origin: ORIGIN,
      data: { ns: '39page-bridge', v: 1, kind: 'ready' },
    })
    host.onRuntimeMessage({ target: 'offscreen', kind: 'ready', gen: 3 }, SW, () => {})
    await vi.advanceTimersByTimeAsync(10)
    // 처리 중인 요청 — 답이 오지 않았다.
    host.onRuntimeMessage(
      { target: 'offscreen', kind: 'call', gen: 3, request: request(), waitMs: 60_000 },
      SW,
      () => {},
    )
    await vi.advanceTimersByTimeAsync(3_000)
    expect(notifyIdle).not.toHaveBeenCalled()
    host.onFrameMessage({
      source: win,
      origin: ORIGIN,
      data: { ns: '39page-bridge', v: 1, kind: 'response', id: 'req-0000000000000001', ok: true },
    })
    await vi.advanceTimersByTimeAsync(2_500)
    expect(notifyIdle).toHaveBeenCalledTimes(1)
    expect(notifyIdle).toHaveBeenCalledWith(3)
    await vi.advanceTimersByTimeAsync(5_000)
    expect(notifyIdle).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
  })
})
