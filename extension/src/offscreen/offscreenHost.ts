/**
 * offscreen 문서의 일 (M11-5, ADR 0028) — 39page 브리지 iframe 을 띄우고 서비스 워커의 요청을 넘긴다.
 *
 * 신뢰 경계
 * - 서비스 워커의 메시지만 받는다 — 같은 확장, `background.js` 에서 온 것. 패널 · 팝업 · content script
 *   는 이 문서에 직접 닿지 못한다 (모두 서비스 워커를 거친다).
 * - 자기 세대(`gen`, 주소에 적혀 있다)와 다른 요청은 거절한다 — 권한이 바뀌기 전의 요청이다.
 * - iframe 에서 온 메시지는 그 iframe 창이고 origin 이 39page 일 때만 본다. iframe 으로는 그 origin 을
 *   지정해서만 보낸다.
 *
 * `chrome.*` 와 DOM 은 밖에서 넣는다 — 시험이 가짜를 끼운다.
 */
import { BRIDGE_NAMESPACE, isOffscreenMessage, type OffscreenReply } from '@/shared/bridgeMessages'

export interface FrameLike {
  readonly contentWindow: { postMessage(message: unknown, targetOrigin: string): void } | null
}

export interface OffscreenHostDeps {
  readonly gen: number
  readonly bridgeOrigin: string
  readonly extensionId: string
  /** 서비스 워커 스크립트 주소 — `chrome.runtime.getURL('background.js')`. */
  readonly workerUrl: string
  readonly frame: FrameLike
  /** 준비 신호를 기다리는 한도. */
  readonly readyTimeoutMs?: number
}

export interface OffscreenHost {
  /** iframe 창에서 온 `message` 이벤트. */
  onFrameMessage(event: { source: unknown; origin: string; data: unknown }): void
  /** `chrome.runtime.onMessage` 리스너 — 비동기로 답하면 `true`. */
  onRuntimeMessage(
    message: unknown,
    sender: { readonly id?: string; readonly url?: string; readonly tab?: unknown },
    sendResponse: (reply: OffscreenReply) => void,
  ): boolean
  state(): 'loading' | 'ready' | 'refused'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function createOffscreenHost(deps: OffscreenHostDeps): OffscreenHost {
  const readyTimeoutMs = deps.readyTimeoutMs ?? 8_000
  let state: 'loading' | 'ready' | 'refused' = 'loading'
  let status: unknown = null
  const readyWaiters: (() => void)[] = []
  const pending = new Map<string, ((answer: unknown) => void)[]>()

  function settleReady(): void {
    for (const resolve of readyWaiters.splice(0)) resolve()
  }

  function waitReady(): Promise<void> {
    if (state !== 'loading') return Promise.resolve()
    return new Promise((resolve) => {
      readyWaiters.push(resolve)
      setTimeout(resolve, readyTimeoutMs)
    })
  }

  function onFrameMessage(event: { source: unknown; origin: string; data: unknown }): void {
    if (event.source !== deps.frame.contentWindow || event.origin !== deps.bridgeOrigin) return
    const data = event.data
    if (!isRecord(data) || data.ns !== BRIDGE_NAMESPACE) return
    if (data.kind === 'ready') {
      state = 'ready'
      status = data.status ?? null
      settleReady()
    } else if (data.kind === 'refused') {
      state = 'refused'
      settleReady()
    } else if (data.kind === 'response' && typeof data.id === 'string') {
      const waiters = pending.get(data.id)
      if (waiters === undefined) return
      pending.delete(data.id)
      for (const resolve of waiters) resolve(data)
    }
  }

  async function ready(): Promise<OffscreenReply> {
    await waitReady()
    if (state === 'ready') return { ok: true, status }
    return { ok: false, transport: state === 'refused' ? 'not-allowed' : 'not-ready' }
  }

  function call(request: Record<string, unknown>, waitMs: number): Promise<OffscreenReply> {
    if (state === 'refused') return Promise.resolve({ ok: false, transport: 'not-allowed' })
    if (state !== 'ready') return Promise.resolve({ ok: false, transport: 'not-ready' })
    const target = deps.frame.contentWindow
    if (target === null || typeof request.id !== 'string') {
      return Promise.resolve({ ok: false, transport: 'bad-request' })
    }
    const id = request.id
    return new Promise((resolve) => {
      let done = false
      const finish = (reply: OffscreenReply): void => {
        if (done) return
        done = true
        resolve(reply)
      }
      const waiters = pending.get(id) ?? []
      waiters.push((answer) => finish({ ok: true, answer }))
      pending.set(id, waiters)
      setTimeout(() => finish({ ok: false, transport: 'timeout' }), waitMs)
      target.postMessage(request, deps.bridgeOrigin)
    })
  }

  function onRuntimeMessage(
    message: unknown,
    sender: { readonly id?: string; readonly url?: string; readonly tab?: unknown },
    sendResponse: (reply: OffscreenReply) => void,
  ): boolean {
    if (!isOffscreenMessage(message)) return false
    // 서비스 워커만 — 패널(탭 안의 확장 페이지) · content script 는 탭이 있고, 주소가 다르다.
    if (
      sender.id !== deps.extensionId ||
      sender.tab !== undefined ||
      sender.url !== deps.workerUrl
    ) {
      return false
    }
    if (message.gen !== deps.gen) {
      sendResponse({ ok: false, transport: 'stale-gen' })
      return false
    }
    const task =
      message.kind === 'ready'
        ? ready()
        : call(message.request as unknown as Record<string, unknown>, message.waitMs)
    void task.then(sendResponse)
    return true
  }

  return { onFrameMessage, onRuntimeMessage, state: () => state }
}
