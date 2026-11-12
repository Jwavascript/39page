/**
 * M11-5B — 패널의 서비스 워커 쪽(`panel.ts` · 라우터의 패널 경계)과 content script 의 iframe(`panelFrame.ts`).
 */
// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'

import { createCollectDeduper } from '@/background/openCollect'
import {
  PANEL_BIND_WINDOW_MS,
  bindPanel,
  collectFromPanel,
  openPanel,
  syncPanel,
  type PanelDeps,
  type PanelSession,
} from '@/background/panel'
import { createBackgroundRouter, type RouterDeps } from '@/background/router'
import { createContentListener } from '@/content/listener'
import { PANEL_HOST_ID, createPanelFrame } from '@/content/panelFrame'

import { fakePort, ID } from './support/fakePort'

const EXT = 'pkagnijdhfmkodpdfgdehfdghcgbfpoa'
const PANEL_URL = `chrome-extension://${EXT}/src/panel/index.html`

function setup(now = { t: 1_000 }) {
  const { port } = fakePort({})
  const deps: PanelDeps = {
    port,
    origin: 'https://39page.com',
    deduper: createCollectDeduper(),
    newRequestId: () => '3f0c6b1e-8d2a-4c7e-9b5f-1a2b3c4d5e6f',
    now: () => now.t,
    sessions: new Map<number, PanelSession>(),
  }
  return { port, deps, now }
}

describe('패널 — 서비스 워커', () => {
  it('열면 지시 번호 · 탭 · (Moment 면) 누른 순간의 시점을 남기고 content 에 iframe 을 띄우게 한다', async () => {
    const { port, deps } = setup()
    expect(await openPanel(deps, 1, 'moment')).toEqual({
      v: 1,
      ok: true,
      data: { status: 'opened' },
    })
    expect(port.sendToContent).toHaveBeenCalledWith(1, { v: 1, type: 'panel/open' })
    expect(deps.sessions.get(1)).toMatchObject({
      seq: 1,
      mode: 'moment',
      capture: { status: 'captured', atSeconds: 83 },
      documentId: null,
    })
  })

  it('처음 동기화한 문서에 묶인다 — 다른 문서 · 늦은 문서는 거절', async () => {
    const now = { t: 1_000 }
    const { deps } = setup(now)
    await openPanel(deps, 1, 'music')
    expect(bindPanel(deps, 1, 'doc-A')).toBe(true)
    expect(bindPanel(deps, 1, 'doc-A')).toBe(true)
    expect(bindPanel(deps, 1, 'doc-B')).toBe(false)
    expect(bindPanel(deps, 2, 'doc-A')).toBe(false) // 연 적 없는 탭

    // 다시 열어도 이미 떠 있는 문서(focused) 는 그대로 묶여 있다.
    await openPanel(deps, 1, 'moment')
    expect(bindPanel(deps, 1, 'doc-A')).toBe(true)

    const late = setup({ t: 1_000 })
    await openPanel(late.deps, 1, 'music')
    late.now.t += PANEL_BIND_WINDOW_MS + 1
    expect(bindPanel(late.deps, 1, 'doc-X')).toBe(false)
  })

  it('동기화 — 지시와 지금 영상 (SPA 이동을 따라간다)', async () => {
    const { deps } = setup()
    await openPanel(deps, 1, 'music')
    const synced = await syncPanel(deps, 1)
    expect(synced).toMatchObject({
      ok: true,
      data: { seq: 1, mode: 'music', page: { status: 'video', videoId: ID } },
    })
  })

  it('수집 화면(대체 경로) — Moment 는 패널이 고정한 시점을 넘기고 메모는 주소에 싣지 않는다', async () => {
    const { port, deps } = setup()
    const result = await collectFromPanel(deps, 1, {
      kind: 'moment',
      videoId: ID,
      atSeconds: 42,
      title: '제목',
    })
    expect(result).toMatchObject({ ok: true, data: { status: 'opened' } })
    const url = port.createTab.mock.calls[0]?.[0].url ?? ''
    expect(url).toContain('kind=moment')
    expect(url).toContain('atSeconds=42')
    expect(url).not.toContain('note')
  })

  it('라우터 — 패널 주소의 요청은 묶인 문서만, 탭은 보낸 쪽 탭 · 패널 전용 요청은 패널만', async () => {
    const { deps } = setup()
    // 팝업이 패널을 열면 그 탭의 팝업을 끈다 — 다음 클릭은 깜빡임 없이 (M11-6).
    const onOpened = vi.fn<(tabId: number) => void>()
    const routerDeps = {
      port: deps.port,
      extensionId: EXT,
      extensionOrigin: `chrome-extension://${EXT}/`,
      collect: {
        origin: deps.origin,
        deduper: deps.deduper,
        newRequestId: deps.newRequestId,
        now: deps.now,
      },
      panel: { sessions: deps.sessions, panelPath: '/src/panel/index.html', onOpened },
    } satisfies RouterDeps
    const router = createBackgroundRouter(routerDeps)
    const panel = (documentId: string) => ({ id: EXT, url: PANEL_URL, tab: { id: 1 }, documentId })

    // 연 적이 없으면 동기화도 거절.
    expect(await router.handle({ v: 1, type: 'panel/sync' }, panel('doc-A'))).toMatchObject({
      ok: false,
      error: { code: 'forbidden-sender' },
    })
    await router.handle(
      { v: 1, type: 'panel/open', tabId: 1, mode: 'music' },
      { id: EXT, url: `chrome-extension://${EXT}/src/popup/index.html` },
    )
    expect(onOpened).toHaveBeenCalledWith(1)
    expect(await router.handle({ v: 1, type: 'panel/sync' }, panel('doc-A'))).toMatchObject({
      ok: true,
    })
    // 다른 문서(페이지가 따로 띄운 패널)는 아무것도 못 한다.
    expect(await router.handle({ v: 1, type: 'panel/close' }, panel('doc-B'))).toMatchObject({
      ok: false,
      error: { code: 'forbidden-sender' },
    })
    // 패널 전용 요청을 팝업 · 다른 확장 페이지가 보내면 거절.
    expect(
      await router.handle(
        { v: 1, type: 'panel/sync' },
        { id: EXT, url: `chrome-extension://${EXT}/src/popup/index.html` },
      ),
    ).toMatchObject({
      ok: false,
      error: { code: 'forbidden-sender' },
    })
    expect(await router.handle({ v: 1, type: 'panel/close' }, panel('doc-A'))).toMatchObject({
      ok: true,
    })
    expect(deps.sessions.has(1)).toBe(false)
  })
})

describe('패널 iframe — content script', () => {
  it('닫힌 shadow root 안의 iframe 하나 — 다시 열면 포커스만, 닫으면 거두고 포커스를 되돌린다', () => {
    document.body.innerHTML = '<button id="before">영상</button>'
    const before = document.getElementById('before') as HTMLButtonElement
    before.focus()
    const frame = createPanelFrame({ document, panelUrl: PANEL_URL })
    expect(frame.open()).toBe('opened')
    expect(frame.open()).toBe('focused')
    const hosts = document.querySelectorAll(`#${PANEL_HOST_ID}`)
    expect(hosts).toHaveLength(1)
    // 닫힌 shadow root — 페이지 스크립트는 안을 볼 수 없다.
    expect((hosts[0] as HTMLElement).shadowRoot).toBeNull()
    expect(document.querySelectorAll('iframe')).toHaveLength(0)
    expect(hosts[0]?.getAttribute('style')).toContain('right: 16px')

    frame.close()
    expect(document.getElementById(PANEL_HOST_ID)).toBeNull()
    expect(document.activeElement).toBe(before)
    // 여러 번 열고 닫아도 쌓이지 않는다.
    for (let i = 0; i < 5; i += 1) {
      frame.open()
      frame.close()
    }
    expect(document.querySelectorAll(`#${PANEL_HOST_ID}`)).toHaveLength(0)
  })

  it('content 리스너 — 우리 확장의 panel/open · panel/close 만', () => {
    const panel = {
      open: vi.fn<() => 'opened' | 'focused'>(() => 'opened'),
      close: vi.fn<() => void>(),
    }
    const listener = createContentListener({ extensionId: EXT, read: () => ({}) as never, panel })
    const reply = vi.fn<(r: unknown) => void>()
    listener({ v: 1, type: 'panel/open' }, { id: EXT }, reply)
    expect(reply).toHaveBeenLastCalledWith({ v: 1, ok: true, data: { status: 'opened' } })
    listener({ v: 1, type: 'panel/open' }, { id: 'other' }, reply)
    expect(reply).toHaveBeenLastCalledWith(expect.objectContaining({ ok: false }))
    listener({ v: 1, type: 'panel/close' }, { id: EXT }, reply)
    expect(panel.close).toHaveBeenCalledTimes(1)
    expect(panel.open).toHaveBeenCalledTimes(1)
  })
})
