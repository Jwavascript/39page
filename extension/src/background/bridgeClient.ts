/**
 * 서비스 워커의 저장 브리지 연결 (M11-5, ADR 0028 · `M11_BRIDGE_POC.md` §12).
 *
 *   패널 → [이 모듈] → offscreen 문서 → 39page `bridge.html` → 기존 Library · Moments store
 *
 * 저장소 분할은 **브리지 안에서 알 수 없다** (실측: 분할된 iframe 도 `hasStorageAccess()` 가 true,
 * 분할된 빈 저장소도 `ready`). 그래서 이 모듈이 판단한다.
 *
 * 1. offscreen 을 만들기 **전**에 `permissions.contains` — 권한 없이 만든 문서는 분할 저장소를 본다.
 * 2. 만든 **뒤**에 다시 확인하고, 그동안 권한이 바뀌지 않았는지(세대 `gen`) 본다.
 * 3. **모든 요청 직전**에 다시 확인한다.
 * 4. 권한이 바뀌면(`onAdded` · `onRemoved`) 세대를 올리고 문서를 닫는다 — 부여 전에 만든 문서는 계속
 *    분할돼 있고, 철회 전에 만든 문서는 철회 뒤에도 사용자 저장소를 읽는다 (실측 Q4 · Q6).
 * 5. 워커가 다시 시작하면 이미 떠 있는 문서의 내력을 모른다 — 닫고 새로 만든다.
 * 6. offscreen 은 자기 세대와 다른 요청을 거절한다 — 닫히기 전의 낡은 문서로 가지 않는다.
 *
 * 남는 경계: 권한 철회가 쓰기 **처리 중**에 오면 그 쓰기는 (철회 전에 만든 문서라) 사용자 저장소에 들어갈
 * 수 있다. 답을 받으면 그대로 알리고, 답을 잃으면 `uncertain` — 성공이라 하지 않는다. 같은 요청 ID 로
 * 확인 · 재시도하면 한 번만 저장된다 (39page `derivedIds`).
 */
import {
  WRITE_OPS,
  envelope,
  isDefinitelyNotWritten,
  parseBridgeAnswer,
  type BridgeCallResult,
  type BridgePayload,
  type OffscreenMessage,
  type OffscreenReply,
  type UnavailableReason,
} from '@/shared/bridgeMessages'

export interface OffscreenPort {
  /** offscreen 문서가 떠 있는지. */
  exists(): Promise<boolean>
  /** 세대를 주소에 적어 만든다. */
  create(gen: number): Promise<void>
  /** 닫는다. 없으면 아무것도 하지 않는다. */
  close(): Promise<void>
  /** 메시지를 보내고 답을 기다린다. 문서가 없거나 답 없이 닫히면 거절된다. */
  send(message: OffscreenMessage): Promise<unknown>
}

export interface PermissionPort {
  /** 39page origin 호스트 권한이 **지금** 있는지. */
  contains(): Promise<boolean>
}

export interface BridgeClientDeps {
  readonly offscreen: OffscreenPort
  readonly permissions: PermissionPort
  readonly now: () => number
  /** 브리지 페이지가 준비를 알리기까지 기다리는 한도. */
  readonly readyTimeoutMs?: number
  /** 쓰기를 **시작해도 되는** 창 — 넘으면 브리지가 시작하지 않는다(`expired`). */
  readonly startWindowMs?: number
  /** 답을 기다리는 상한. 넘으면 쓰기는 `uncertain`. */
  readonly maxWaitMs?: number
  /** 유휴로 닫아도 되는 최소 시간 (offscreen 의 알림과 같은 값). */
  readonly idleMs?: number
}

export interface BridgeClient {
  /** 워커가 시작할 때 — 내력을 모르는 문서를 닫는다. */
  startup(): Promise<void>
  /** 권한이 바뀌었다 (`onAdded` · `onRemoved`). 세대를 올리고 문서를 닫는다. */
  permissionChanged(): Promise<void>
  hasPermission(): Promise<boolean>
  call(payload: BridgePayload, requestId: string): Promise<BridgeCallResult>
  /**
   * offscreen 이 유휴를 알렸다 (M11-6). 같은 세대이고, 처리 중인 요청이 없고, 마지막 요청 뒤
   * `idleMs` 가 지났을 때만 닫는다 — 저장 중인 요청을 끊지 않는다. 닫았으면 `true`.
   */
  idle(gen: number): Promise<boolean>
  /** 시험용 — 지금 세대. */
  generation(): number
}

type Ensure = 'ready' | UnavailableReason

const TIMEOUT = Symbol('timeout')

function withTimeout<T>(task: Promise<T>, ms: number): Promise<T | typeof TIMEOUT> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const limit = new Promise<typeof TIMEOUT>((resolve) => {
    timer = setTimeout(() => resolve(TIMEOUT), ms)
  })
  return Promise.race([task, limit]).finally(() => clearTimeout(timer))
}

function isReply(value: unknown): value is OffscreenReply {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { ok?: unknown }).ok === 'boolean'
  )
}

export function createBridgeClient(deps: BridgeClientDeps): BridgeClient {
  const readyTimeoutMs = deps.readyTimeoutMs ?? 8_000
  const startWindowMs = deps.startWindowMs ?? 8_000
  const maxWaitMs = deps.maxWaitMs ?? 30_000

  let gen = 0
  let inflight = 0
  let lastUse = deps.now()
  const idleMs = deps.idleMs ?? 5 * 60_000
  let current: { gen: number; ready: Promise<Ensure> } | null = null
  let started: Promise<void> | null = null

  async function closeQuietly(): Promise<void> {
    try {
      await deps.offscreen.close()
    } catch {
      // 이미 닫혔다.
    }
  }

  function startup(): Promise<void> {
    started ??= (async () => {
      if (await deps.offscreen.exists().catch(() => false)) await closeQuietly()
    })()
    return started
  }

  async function permissionChanged(): Promise<void> {
    gen += 1
    current = null
    await closeQuietly()
  }

  async function boot(myGen: number): Promise<Ensure> {
    // 앞 세대의 문서가 남아 있으면 닫는다 — 한 확장에 offscreen 은 하나다.
    if (await deps.offscreen.exists().catch(() => false)) await closeQuietly()
    try {
      await deps.offscreen.create(myGen)
    } catch {
      return 'bridge-failed'
    }
    let reply: unknown
    try {
      reply = await withTimeout(
        deps.offscreen.send({ target: 'offscreen', kind: 'ready', gen: myGen }),
        readyTimeoutMs + 1_000,
      )
    } catch {
      return 'bridge-failed'
    }
    if (reply === TIMEOUT) return 'timeout'
    if (!isReply(reply)) return 'bridge-failed'
    if (!reply.ok) {
      if (reply.transport === 'not-allowed') return 'not-allowed'
      if (reply.transport === 'not-ready' || reply.transport === 'timeout') return 'timeout'
      return 'bridge-failed'
    }
    return 'ready'
  }

  async function ensure(): Promise<Ensure> {
    await startup()
    if (!(await deps.permissions.contains())) return 'permission'
    const myGen = gen
    // 준비했던 문서가 사라졌으면(브라우저가 닫음 · 충돌) 다시 띄운다 — 죽은 문서에 보내지 않는다.
    if (current?.gen === myGen && (await current.ready) === 'ready') {
      if (!(await deps.offscreen.exists().catch(() => false))) current = null
    }
    if (current === null || current.gen !== myGen) {
      current = { gen: myGen, ready: boot(myGen) }
    }
    const state = await current.ready
    if (state !== 'ready') {
      // 실패한 기동은 기억하지 않는다 — 다음 요청이 다시 시도한다.
      if (current?.gen === myGen) current = null
      await closeQuietly()
      return state
    }
    // 띄우는 동안 권한이 바뀌었으면 이 문서를 쓰지 않는다 (분할 저장소일 수 있다).
    if (gen !== myGen || !(await deps.permissions.contains())) {
      if (gen === myGen) await permissionChanged()
      return 'permission'
    }
    return 'ready'
  }

  async function call(payload: BridgePayload, requestId: string): Promise<BridgeCallResult> {
    inflight += 1
    lastUse = deps.now()
    try {
      return await callOnce(payload, requestId)
    } finally {
      inflight -= 1
      lastUse = deps.now()
    }
  }

  async function idle(idleGen: number): Promise<boolean> {
    // 다른 세대(이미 닫고 새로 띄운 뒤의 낡은 알림) · 처리 중 · 방금 쓴 문서는 닫지 않는다.
    if (idleGen !== gen || inflight > 0 || deps.now() - lastUse < idleMs - 5_000) return false
    if (current?.gen === gen) current = null
    await closeQuietly()
    return true
  }

  async function callOnce(payload: BridgePayload, requestId: string): Promise<BridgeCallResult> {
    const write = WRITE_OPS.includes(payload.op)
    const state = await ensure()
    if (state !== 'ready') return { outcome: 'unavailable', reason: state }

    const myGen = gen
    // 모든 요청 직전 — 권한이 없으면 보내지 않는다.
    if (!(await deps.permissions.contains()) || gen !== myGen) {
      return { outcome: 'unavailable', reason: 'permission' }
    }

    const request = envelope(requestId, deps.now() + startWindowMs, payload)
    let reply: unknown
    try {
      reply = await withTimeout(
        deps.offscreen.send({
          target: 'offscreen',
          kind: 'call',
          gen: myGen,
          request,
          waitMs: maxWaitMs,
        }),
        maxWaitMs + 2_000,
      )
    } catch {
      // 답 없이 문서가 사라졌다. 쓰기는 들어갔을 수 있다. 다음 요청은 문서를 다시 띄운다.
      if (current?.gen === myGen) current = null
      if (!write) return { outcome: 'unavailable', reason: 'bridge-failed' }
      return {
        outcome: 'uncertain',
        reason: gen !== myGen ? 'permission-changed' : 'disconnected',
      }
    }

    if (reply === TIMEOUT) {
      // 멈춘 문서일 수 있다 — 다음 요청은 새로 띄운다.
      if (current?.gen === myGen) current = null
      await closeQuietly()
      return write
        ? { outcome: 'uncertain', reason: 'timeout' }
        : { outcome: 'unavailable', reason: 'timeout' }
    }
    if (!isReply(reply)) {
      return write
        ? { outcome: 'uncertain', reason: 'disconnected' }
        : { outcome: 'unavailable', reason: 'bridge-failed' }
    }
    if (!reply.ok) {
      // offscreen 이 브리지에 보내기 **전**에 거절했다 — 쓰지 않았다.
      if (reply.transport === 'stale-gen' || reply.transport === 'not-ready') {
        return { outcome: 'unavailable', reason: 'bridge-failed' }
      }
      if (reply.transport === 'not-allowed')
        return { outcome: 'unavailable', reason: 'not-allowed' }
      if (reply.transport === 'bad-request') {
        return {
          outcome: 'error',
          error: { code: 'bad-request', retryable: false },
        }
      }
      // 브리지에 보냈는데 답이 없다.
      return write
        ? { outcome: 'uncertain', reason: 'timeout' }
        : { outcome: 'unavailable', reason: 'timeout' }
    }

    const answer = parseBridgeAnswer(reply.answer)
    if (answer === null || answer.id !== requestId) {
      return write
        ? { outcome: 'uncertain', reason: 'disconnected' }
        : { outcome: 'unavailable', reason: 'bridge-failed' }
    }
    if (answer.ok) return { outcome: 'ok', data: answer.data }
    if (write && !isDefinitelyNotWritten(answer.error.code)) {
      return { outcome: 'uncertain', reason: 'disconnected' }
    }
    return { outcome: 'error', error: answer.error }
  }

  return {
    startup,
    permissionChanged,
    hasPermission: () => deps.permissions.contains(),
    call,
    idle,
    generation: () => gen,
  }
}
