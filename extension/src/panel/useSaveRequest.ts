/**
 * 저장 요청 하나의 생명 주기 (M11-5B) — 음악 담기 · Moment 저장이 같은 규칙을 쓴다.
 *
 * - **요청 ID 는 저장 의도마다 하나.** 결과를 모르면(`uncertain`) · 부분 성공 · 다시 해도 되는 실패면 같은 ID 로
 *   다시 보낸다 — 39page 가 그 ID 로 만든 항목이 있으면 쓰지 않는다(정확히 한 번). 내용을 바꾸면 새 ID.
 * - 성공은 39page 가 저장소에서 확인한 뒤에만(`ok`). 답을 잃으면 자동으로 다시 보내지 않는다 — 사용자가
 *   "저장됐는지 확인" 또는 "다시 시도" 를 고른다(둘 다 중복이 생기지 않는다).
 */
import { readonly, ref, type Ref } from 'vue'

import type {
  BridgeError,
  BridgePayload,
  UnavailableReason,
  UncertainReason,
  WriteKind,
} from '@/shared/bridgeMessages'

import type { PanelBridge } from './panelBridge'

export type SaveState =
  | { readonly phase: 'idle' }
  | { readonly phase: 'saving' }
  | { readonly phase: 'checking' }
  | { readonly phase: 'done'; readonly data: Record<string, unknown> }
  | { readonly phase: 'error'; readonly error: BridgeError }
  | { readonly phase: 'partial'; readonly playlistId: string; readonly playlistName: string }
  | { readonly phase: 'uncertain'; readonly reason: UncertainReason }
  | { readonly phase: 'unavailable'; readonly reason: UnavailableReason }
  /** 확인해 보니 저장되지 않았다 — 같은 ID 로 다시 저장해도 된다. */
  | { readonly phase: 'not-saved' }

export interface SaveRequest {
  readonly state: Readonly<Ref<SaveState>>
  run(payload: BridgePayload): Promise<SaveState>
  /** 같은 요청(같은 ID)으로 다시 보낸다. */
  retry(): Promise<SaveState>
  /** 저장됐는지 저장소에서 확인한다 (`uncertain` · 부분 성공). */
  check(): Promise<SaveState>
  reset(): void
}

function kindOf(payload: BridgePayload): WriteKind | null {
  if (payload.op === 'track/add') return 'track'
  if (payload.op === 'playlist/create-and-add') return 'playlist'
  if (payload.op === 'moment/add') return 'moment'
  return null
}

export function useSaveRequest(bridge: PanelBridge): SaveRequest {
  const state = ref<SaveState>({ phase: 'idle' })
  let requestId: string | null = null
  let lastPayload: BridgePayload | null = null
  let lastKey = ''

  async function send(payload: BridgePayload, id: string): Promise<SaveState> {
    state.value = { phase: 'saving' }
    const result = await bridge.call(payload, id)
    let next: SaveState
    if (result.outcome === 'ok') {
      next = { phase: 'done', data: (result.data ?? {}) as Record<string, unknown> }
    } else if (result.outcome === 'uncertain') {
      next = { phase: 'uncertain', reason: result.reason }
    } else if (result.outcome === 'unavailable') {
      next = { phase: 'unavailable', reason: result.reason }
    } else if (result.error.code === 'partial') {
      const detail = result.error.detail ?? {}
      next = {
        phase: 'partial',
        playlistId: String(detail.playlistId ?? ''),
        playlistName: String(detail.playlistName ?? ''),
      }
    } else {
      next = { phase: 'error', error: result.error }
    }
    state.value = next
    // 끝났거나 다시 하면 안 되는 실패면 다음 저장은 새 ID 다.
    if (next.phase === 'done') requestId = null
    if (next.phase === 'error' && (!next.error.retryable || next.error.code === 'id-reused')) {
      requestId = null
    }
    return next
  }

  async function run(payload: BridgePayload): Promise<SaveState> {
    if (state.value.phase === 'saving' || state.value.phase === 'checking') return state.value
    const key = JSON.stringify(payload)
    // 같은 내용을 다시 누르면 같은 ID — 결과를 모르는 요청과 겹쳐도 한 번만 저장된다.
    if (requestId === null || key !== lastKey) requestId = bridge.newRequestId()
    lastKey = key
    lastPayload = payload
    return send(payload, requestId)
  }

  async function retry(): Promise<SaveState> {
    if (lastPayload === null || requestId === null) return state.value
    return send(lastPayload, requestId)
  }

  async function check(): Promise<SaveState> {
    const payload = lastPayload
    const id = requestId
    const kind = payload === null ? null : kindOf(payload)
    if (payload === null || id === null || kind === null) return state.value
    state.value = { phase: 'checking' }
    const result = await bridge.call(
      {
        op: 'request/status',
        kind,
        target: id,
        playlistId: payload.op === 'track/add' ? payload.playlistId : null,
      },
      bridge.newRequestId(),
    )
    let next: SaveState
    if (result.outcome !== 'ok') {
      next =
        result.outcome === 'unavailable'
          ? { phase: 'unavailable', reason: result.reason }
          : { phase: 'uncertain', reason: 'disconnected' }
    } else {
      const data = (result.data ?? {}) as Record<string, unknown>
      if (data.state === 'saved') {
        next = { phase: 'done', data }
        requestId = null
      } else if (data.state === 'partial') {
        next = {
          phase: 'partial',
          playlistId: String(data.playlistId ?? ''),
          playlistName: String(data.playlistName ?? ''),
        }
      } else {
        next = { phase: 'not-saved' }
      }
    }
    state.value = next
    return next
  }

  function reset(): void {
    if (state.value.phase === 'saving' || state.value.phase === 'checking') return
    state.value = { phase: 'idle' }
    requestId = null
    lastPayload = null
    lastKey = ''
  }

  return { state: readonly(state) as Readonly<Ref<SaveState>>, run, retry, check, reset }
}
