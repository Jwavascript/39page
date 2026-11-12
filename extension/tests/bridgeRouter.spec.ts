/**
 * M11-5 — 라우터의 저장 브리지 요청 (`bridge/state` · `bridge/call`).
 */
import { describe, expect, it, vi } from 'vitest'

import type { BridgeClient } from '@/background/bridgeClient'
import { createBackgroundRouter, type RouterDeps } from '@/background/router'
import { parseExtensionRequest } from '@/shared/messages'

const ID = 'pkagnijdhfmkodpdfgdehfdghcgbfpoa'
const ORIGIN = `chrome-extension://${ID}/`
const PANEL = { id: ID, url: `${ORIGIN}src/panel/index.html`, tab: { id: 7 } }

function router(granted = true) {
  const client: BridgeClient = {
    startup: vi.fn<() => Promise<void>>(async () => {}),
    permissionChanged: vi.fn<() => Promise<void>>(async () => {}),
    hasPermission: vi.fn<() => Promise<boolean>>(async () => granted),
    call: vi.fn<BridgeClient['call']>(async () => ({ outcome: 'ok' as const, data: { ok: 1 } })),
    generation: () => 0,
  }
  const deps = {
    port: {} as RouterDeps['port'],
    extensionId: ID,
    extensionOrigin: ORIGIN,
    collect: {} as RouterDeps['collect'],
    bridge: { client, origin: 'https://39page.com', originPattern: 'https://39page.com/*' },
  } satisfies RouterDeps
  return { r: createBackgroundRouter(deps), client }
}

describe('라우터 — 저장 브리지', () => {
  it('상태 — 권한 여부와 요청할 권한(정확한 origin 하나)', async () => {
    const { r } = router(false)
    expect(await r.handle({ v: 1, type: 'bridge/state' }, PANEL)).toEqual({
      v: 1,
      ok: true,
      data: {
        permission: 'not-granted',
        origins: ['https://39page.com/*'],
        origin: 'https://39page.com',
      },
    })
  })

  it('명령 — 검증한 값만 브리지로 넘긴다', async () => {
    const { r, client } = router()
    const payload = {
      op: 'moment/add',
      videoId: 'aaaaaaaaaaa',
      atSeconds: 9,
      note: '메모',
      title: null,
      extra: 'x',
    }
    const result = await r.handle(
      { v: 1, type: 'bridge/call', requestId: 'req-0000000000000001', payload },
      PANEL,
    )
    expect(result).toEqual({ v: 1, ok: true, data: { outcome: 'ok', data: { ok: 1 } } })
    expect(client.call).toHaveBeenCalledWith(
      { op: 'moment/add', videoId: 'aaaaaaaaaaa', atSeconds: 9, note: '메모', title: null },
      'req-0000000000000001',
    )
  })

  it('목록 밖 명령 · 틀린 요청 ID · 웹페이지 · content script 는 거절', async () => {
    const { r, client } = router()
    const call = (payload: unknown, requestId = 'req-0000000000000002') => ({
      v: 1,
      type: 'bridge/call',
      requestId,
      payload,
    })
    expect(parseExtensionRequest(call({ op: 'library/replace-all' })).ok).toBe(false)
    expect(parseExtensionRequest(call({ op: 'hello' }, 'x')).ok).toBe(false)
    expect(
      await r.handle(call({ op: 'hello' }), {
        id: ID,
        url: 'https://www.youtube.com/watch?v=a',
        tab: { id: 1 },
      }),
    ).toMatchObject({
      ok: false,
      error: { code: 'forbidden-sender' },
    })
    expect(
      await r.handle(call({ op: 'hello' }), {
        id: 'other-extension',
        url: `chrome-extension://other/`,
      }),
    ).toMatchObject({
      ok: false,
      error: { code: 'forbidden-sender' },
    })
    expect(client.call).not.toHaveBeenCalled()
  })
})
