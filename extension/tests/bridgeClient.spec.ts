/**
 * M11-5 — 서비스 워커의 저장 브리지 연결 (`bridgeClient.ts`).
 *
 * 분할 저장소에 쓰지 않는 것이 핵심이다: 권한을 offscreen 생성 전 · 후 · **모든 요청 직전**에 보고,
 * 권한이 바뀌면 세대를 올려 문서를 닫으며, 답을 잃은 쓰기는 성공이라 하지 않는다(`uncertain`).
 */
import { describe, expect, it, vi } from 'vitest'

import { createBridgeClient, type OffscreenPort } from '@/background/bridgeClient'
import type { BridgePayload, OffscreenMessage } from '@/shared/bridgeMessages'

const A = 'aaaaaaaaaaa'
const REQ = 'req-0000000000000001'
const WRITE: BridgePayload = { op: 'moment/add', videoId: A, atSeconds: 5, note: '', title: null }
const READ: BridgePayload = { op: 'library/list', videoId: null }

type Responder = (message: OffscreenMessage) => Promise<unknown>

function setup(options: { granted?: boolean; responder?: Responder; exists?: boolean } = {}) {
  let granted = options.granted ?? true
  let open = options.exists ?? false
  const created: number[] = []
  const sent: OffscreenMessage[] = []
  let responder: Responder =
    options.responder ??
    (async (message) =>
      message.kind === 'ready'
        ? { ok: true, status: {} }
        : {
            ok: true,
            answer: {
              ns: '39page-bridge',
              v: 1,
              kind: 'response',
              id: message.request.id,
              ok: true,
              data: { saved: true },
            },
          })
  const offscreen: OffscreenPort = {
    exists: vi.fn<() => Promise<boolean>>(async () => open),
    create: vi.fn<(gen: number) => Promise<void>>(async (gen: number) => {
      open = true
      created.push(gen)
    }),
    close: vi.fn<() => Promise<void>>(async () => {
      open = false
    }),
    send: vi.fn<(message: OffscreenMessage) => Promise<unknown>>(
      async (message: OffscreenMessage) => {
        sent.push(message)
        if (!open) throw new Error('Could not establish connection. Receiving end does not exist.')
        return responder(message)
      },
    ),
  }
  const contains = vi.fn<() => Promise<boolean>>(async () => granted)
  const client = createBridgeClient({
    offscreen,
    permissions: { contains },
    now: () => 1_000,
    readyTimeoutMs: 50,
    maxWaitMs: 50,
  })
  return {
    client,
    offscreen,
    contains,
    created,
    sent,
    setGranted: (value: boolean) => {
      granted = value
    },
    setResponder: (r: Responder) => {
      responder = r
    },
    isOpen: () => open,
  }
}

describe('저장 브리지 연결', () => {
  it('권한이 없으면 offscreen 을 만들지 않고 보내지도 않는다', async () => {
    const s = setup({ granted: false })
    expect(await s.client.call(WRITE, REQ)).toEqual({
      outcome: 'unavailable',
      reason: 'permission',
    })
    expect(s.offscreen.create).not.toHaveBeenCalled()
    expect(s.sent).toHaveLength(0)
  })

  it('권한이 있으면 문서를 한 번 만들고, 요청마다 권한을 다시 본다', async () => {
    const s = setup()
    expect(await s.client.call(READ, REQ)).toEqual({ outcome: 'ok', data: { saved: true } })
    expect(await s.client.call(WRITE, 'req-0000000000000002')).toMatchObject({ outcome: 'ok' })
    expect(s.created).toEqual([0])
    // 생성 전 · 생성 후 · 요청 직전 (첫 요청) + 생성 전 · 생성 후 · 요청 직전 (둘째) — 매번 본다.
    expect(s.contains.mock.calls.length).toBeGreaterThanOrEqual(5)
    const call = s.sent.find((m) => m.kind === 'call')
    expect(call).toMatchObject({
      gen: 0,
      request: { ns: '39page-bridge', kind: 'request', id: REQ, deadline: 9_000 },
    })
  })

  it('워커가 시작하면 내력을 모르는 문서를 닫는다', async () => {
    const s = setup({ exists: true })
    await s.client.startup()
    expect(s.offscreen.close).toHaveBeenCalledTimes(1)
    expect(s.isOpen()).toBe(false)
  })

  it('권한이 바뀌면 세대를 올리고 문서를 닫는다 — 다음 요청은 새 세대의 문서로', async () => {
    const s = setup()
    await s.client.call(READ, REQ)
    await s.client.permissionChanged()
    expect(s.isOpen()).toBe(false)
    expect(s.client.generation()).toBe(1)
    await s.client.call(READ, 'req-0000000000000003')
    expect(s.created).toEqual([0, 1])
  })

  it('띄우는 동안 권한이 철회되면 그 문서를 쓰지 않는다', async () => {
    const s = setup({
      responder: async (message) => {
        if (message.kind === 'ready') {
          s.setGranted(false)
          return { ok: true, status: {} }
        }
        return { ok: true }
      },
    })
    expect(await s.client.call(WRITE, REQ)).toEqual({
      outcome: 'unavailable',
      reason: 'permission',
    })
    expect(s.sent.filter((m) => m.kind === 'call')).toHaveLength(0)
    expect(s.isOpen()).toBe(false)
  })

  it('쓰기 처리 중에 권한이 바뀌어 문서가 닫히면 — 성공이라 하지 않고 uncertain', async () => {
    const s = setup()
    await s.client.call(READ, REQ) // 문서 준비
    s.setResponder(async (message) => {
      if (message.kind === 'call') {
        await s.client.permissionChanged()
        throw new Error('The message port closed before a response was received.')
      }
      return { ok: true, status: {} }
    })
    expect(await s.client.call(WRITE, 'req-0000000000000004')).toEqual({
      outcome: 'uncertain',
      reason: 'permission-changed',
    })
  })

  it('답이 없으면 쓰기는 uncertain(timeout), 읽기는 unavailable', async () => {
    const s = setup()
    await s.client.call(READ, REQ)
    s.setResponder((message) =>
      message.kind === 'ready'
        ? Promise.resolve({ ok: true })
        : Promise.resolve({ ok: false, transport: 'timeout' }),
    )
    expect(await s.client.call(WRITE, 'req-0000000000000005')).toEqual({
      outcome: 'uncertain',
      reason: 'timeout',
    })
    expect(await s.client.call(READ, 'req-0000000000000006')).toEqual({
      outcome: 'unavailable',
      reason: 'bridge-failed',
    })
  })

  it('offscreen 이 보내기 전에 거절하면(낡은 세대 · 준비 안 됨) 쓰지 않은 것이다', async () => {
    const s = setup()
    await s.client.call(READ, REQ)
    s.setResponder(async () => ({ ok: false, transport: 'stale-gen' }))
    expect(await s.client.call(WRITE, 'req-0000000000000007')).toEqual({
      outcome: 'unavailable',
      reason: 'bridge-failed',
    })
  })

  it('브리지가 이 확장을 받지 않으면 not-allowed (운영 브리지 꺼짐)', async () => {
    const s = setup({ responder: async () => ({ ok: false, transport: 'not-allowed' }) })
    expect(await s.client.call(READ, REQ)).toEqual({
      outcome: 'unavailable',
      reason: 'not-allowed',
    })
  })

  it('브리지의 답 — 쓰지 않았다는 실패는 error, 모르는 실패(internal)는 uncertain, 다른 ID 의 답은 믿지 않는다', async () => {
    const answer = (id: string, error: Record<string, unknown>) => ({
      ok: true,
      answer: { ns: '39page-bridge', v: 1, kind: 'response', id, ok: false, error },
    })
    const s = setup()
    await s.client.call(READ, REQ)
    s.setResponder(async (m) =>
      m.kind === 'call'
        ? answer(m.request.id, { code: 'conflict', retryable: true })
        : { ok: true },
    )
    expect(await s.client.call(WRITE, 'req-0000000000000008')).toEqual({
      outcome: 'error',
      error: { code: 'conflict', retryable: true },
    })
    s.setResponder(async (m) =>
      m.kind === 'call'
        ? answer(m.request.id, { code: 'internal', retryable: true })
        : { ok: true },
    )
    expect(await s.client.call(WRITE, 'req-0000000000000009')).toMatchObject({
      outcome: 'uncertain',
    })
    s.setResponder(async (m) =>
      m.kind === 'call'
        ? answer('req-other-000000000000', { code: 'conflict', retryable: true })
        : { ok: true },
    )
    expect(await s.client.call(WRITE, 'req-0000000000000010')).toMatchObject({
      outcome: 'uncertain',
    })
  })

  it('기동 실패는 기억하지 않는다 — 다음 요청이 다시 띄운다', async () => {
    const s = setup({ responder: async () => ({ ok: false, transport: 'not-ready' }) })
    expect(await s.client.call(READ, REQ)).toEqual({
      outcome: 'unavailable',
      reason: 'bridge-failed',
    })
    s.setResponder(async (m) =>
      m.kind === 'ready'
        ? { ok: true }
        : {
            ok: true,
            answer: {
              ns: '39page-bridge',
              v: 1,
              kind: 'response',
              id: m.request.id,
              ok: true,
              data: 1,
            },
          },
    )
    expect(await s.client.call(READ, 'req-0000000000000011')).toEqual({ outcome: 'ok', data: 1 })
    expect(s.created).toEqual([0, 0])
  })

  it('준비했던 문서가 사라지면(브라우저가 닫음) 다음 요청이 다시 띄운다 — 죽은 문서에 보내지 않는다', async () => {
    const s = setup()
    await s.client.call(READ, REQ)
    await s.offscreen.close() // 바깥에서 닫혔다
    expect(await s.client.call(READ, 'req-0000000000000012')).toMatchObject({ outcome: 'ok' })
    expect(s.created).toEqual([0, 0])
  })

  it('쓰기 중 문서가 사라져 uncertain 이 된 뒤 — 다음 요청(확인 · 재시도)은 새 문서로 간다', async () => {
    const s = setup()
    await s.client.call(READ, REQ)
    const normal = s.offscreen.send
    vi.mocked(s.offscreen.send).mockImplementationOnce(async () => {
      await s.offscreen.close()
      throw new Error('The message port closed before a response was received.')
    })
    expect(await s.client.call(WRITE, 'req-0000000000000013')).toEqual({
      outcome: 'uncertain',
      reason: 'disconnected',
    })
    expect(normal).toBe(s.offscreen.send)
    expect(await s.client.call(WRITE, 'req-0000000000000013')).toMatchObject({ outcome: 'ok' })
    expect(s.created).toEqual([0, 0])
  })
})
