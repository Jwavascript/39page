/**
 * 패널이 바깥과 말하는 유일한 통로 (M11-5B). 컴포넌트 · composable 은 `chrome.*` 를 부르지 않는다
 * (boundaries 시험). 시험은 가짜 다리를 끼운다.
 */
import type { InjectionKey } from 'vue'

import type { BridgeCallResult, BridgePayload, BridgeState } from '@/shared/bridgeMessages'
import { PROTOCOL_VERSION, type ExtensionRequest, type Result } from '@/shared/messages'
import type { CaptureOutcome, PanelSync } from '@/shared/panelMessages'

export interface CollectRequest {
  readonly kind: 'track' | 'moment'
  readonly videoId: string
  readonly atSeconds: number | null
  readonly title: string | null
}

export interface PanelBridge {
  sync(): Promise<Result<PanelSync>>
  capture(videoId: string): Promise<Result<CaptureOutcome>>
  close(): Promise<void>
  collect(request: CollectRequest): Promise<Result<{ status: 'opened' | 'focused'; tabId: number }>>
  bridgeState(): Promise<Result<BridgeState>>
  /** 39page 사이트 접근 권한을 묻는다 — 사용자의 클릭 안에서만 부른다. */
  requestPermission(origins: readonly string[]): Promise<boolean>
  call(payload: BridgePayload, requestId: string): Promise<BridgeCallResult>
  newRequestId(): string
}

export const PANEL_BRIDGE: InjectionKey<PanelBridge> = Symbol('panel-bridge')

/** 서비스 워커가 답하지 않으면 패널이 멈추지 않게 — 저장은 30초 상한 + 여유. */
const SEND_TIMEOUT_MS = 40_000

export function createChromePanelBridge(): PanelBridge {
  async function send<T>(request: ExtensionRequest): Promise<Result<T>> {
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      return (await Promise.race([
        chrome.runtime.sendMessage(request),
        new Promise((resolve) => {
          timer = setTimeout(
            () =>
              resolve({
                v: PROTOCOL_VERSION,
                ok: false,
                error: { code: 'timeout', message: '확장이 답하지 않았다' },
              }),
            SEND_TIMEOUT_MS,
          )
        }),
      ])) as Result<T>
    } catch {
      return {
        v: PROTOCOL_VERSION,
        ok: false,
        error: { code: 'internal', message: '확장과 연결이 끊겼다' },
      }
    } finally {
      clearTimeout(timer)
    }
  }

  return {
    sync: () => send({ v: PROTOCOL_VERSION, type: 'panel/sync' }),
    capture: (videoId) => send({ v: PROTOCOL_VERSION, type: 'panel/capture', videoId }),
    async close() {
      await send({ v: PROTOCOL_VERSION, type: 'panel/close' })
    },
    collect: (request) => send({ v: PROTOCOL_VERSION, type: 'panel/collect', ...request }),
    bridgeState: () => send({ v: PROTOCOL_VERSION, type: 'bridge/state' }),
    async requestPermission(origins) {
      try {
        return await chrome.permissions.request({ origins: [...origins] })
      } catch {
        return false
      }
    },
    async call(payload, requestId) {
      const result = await send<BridgeCallResult>({
        v: PROTOCOL_VERSION,
        type: 'bridge/call',
        requestId,
        payload,
      })
      if (result.ok) return result.data
      // 워커가 답을 못 했다 — 쓰기였다면 저장됐는지 알 수 없다.
      const write =
        payload.op === 'track/add' ||
        payload.op === 'playlist/create-and-add' ||
        payload.op === 'moment/add'
      return write
        ? { outcome: 'uncertain', reason: 'disconnected' }
        : { outcome: 'unavailable', reason: 'bridge-failed' }
    },
    newRequestId: () => crypto.randomUUID(),
  }
}
