/**
 * 브리지 페이지를 창(`window`)에 연결한다 (M11-5).
 *
 * - 자리(조상 origin)를 먼저 본다. 허용한 확장의 offscreen 문서 안이 아니면 **아무것도 달지 않는다** —
 *   웹사이트가 이 페이지를 액자로 띄우거나 사람이 직접 열어도 저장 명령이 살아나지 않는다.
 * - 부모 창에서, 허용한 확장 origin 으로 온 메시지만 본다. 답은 그 origin 으로만 보낸다.
 * - 준비되면 부모에게 `ready` 와 상태 요약을 알린다 — 확장은 이것을 받은 뒤에 요청한다.
 */
import {
  BRIDGE_NAMESPACE,
  BRIDGE_PROTOCOL_VERSION,
  isTrustedAncestry,
  parseBridgeRequest,
  respondError,
} from './bridgeProtocol'
import type { BridgeHandler } from './bridgeHandler'

/** 창에서 필요한 부분만 — 시험이 가짜 창을 넣는다. */
export interface BridgeWindow {
  readonly location: { readonly ancestorOrigins?: { readonly length: number; [i: number]: string } }
  readonly parent: { postMessage(message: unknown, targetOrigin: string): void }
  readonly top: unknown
  readonly self: unknown
  addEventListener(type: 'message', listener: (event: MessageEvent) => void): void
}

export type StartOutcome = 'started' | 'refused'

export function readAncestors(win: BridgeWindow): string[] | null {
  const list = win.location.ancestorOrigins
  if (list === undefined) return null
  const out: string[] = []
  for (let i = 0; i < list.length; i += 1) {
    const origin = list[i]
    if (typeof origin === 'string') out.push(origin)
  }
  return out
}

/**
 * 자리를 확인하고 리스너를 단다. 확인에 실패하면 `refused` — 리스너도 준비 신호도 없다.
 * `createHandler` 는 확인을 통과한 뒤에만 부른다 (저장소를 읽는 것도 그 뒤다).
 */
export function startBridge(
  win: BridgeWindow,
  allowed: readonly string[],
  createHandler: () => BridgeHandler,
): StartOutcome {
  const ancestors = readAncestors(win)
  if (!isTrustedAncestry(ancestors, win.top === win.self, allowed)) {
    // 액자 안이면 "받지 않는다" 만 알린다 — 내용 없는 신호다. 확장은 이것으로 "허용 목록 밖" 을
    // 연결 실패와 구별한다. 리스너는 달지 않는다.
    if (win.top !== win.self) {
      win.parent.postMessage(
        { ns: BRIDGE_NAMESPACE, v: BRIDGE_PROTOCOL_VERSION, kind: 'refused' },
        '*',
      )
    }
    return 'refused'
  }
  const parentOrigin = ancestors?.[0]
  if (parentOrigin === undefined) return 'refused'

  const handler = createHandler()

  win.addEventListener('message', (event: MessageEvent) => {
    if (event.source !== (win.parent as unknown) || event.origin !== parentOrigin) return
    const parsed = parseBridgeRequest(event.data)
    if (parsed === null) return
    const reply = (response: unknown): void => win.parent.postMessage(response, parentOrigin)
    if (!parsed.ok) {
      if (parsed.id !== null) reply(respondError(parsed.id, parsed.error))
      return
    }
    void handler.handle(parsed.request).then(reply)
  })

  win.parent.postMessage(
    { ns: BRIDGE_NAMESPACE, v: BRIDGE_PROTOCOL_VERSION, kind: 'ready', status: handler.hello() },
    parentOrigin,
  )
  return 'started'
}
