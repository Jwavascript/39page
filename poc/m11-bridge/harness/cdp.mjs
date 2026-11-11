/**
 * M11-1 PoC 하네스 — 최소 CDP 클라이언트 (Node 내장 WebSocket, 의존성 없음).
 *
 * ⚠ 실험 코드. 격리된 시험 프로필의 Chrome for Testing 에만 붙는다.
 */
export async function connectBrowser(port) {
  const version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()
  const ws = new WebSocket(version.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    ws.onopen = resolve
    ws.onerror = reject
  })
  let nextId = 0
  const pending = new Map()
  const listeners = new Set()
  ws.onmessage = (event) => {
    const message = JSON.parse(event.data)
    if (message.id !== undefined) {
      const entry = pending.get(message.id)
      pending.delete(message.id)
      if (entry === undefined) return
      if (message.error) entry.reject(new Error(`${entry.method}: ${message.error.message}`))
      else entry.resolve(message.result)
      return
    }
    for (const listener of listeners) listener(message)
  }

  function send(method, params = {}, sessionId) {
    return new Promise((resolve, reject) => {
      const id = ++nextId
      pending.set(id, { resolve, reject, method })
      ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }))
    })
  }

  async function attach(targetId) {
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
    return sessionId
  }

  /** 표현식을 그 문맥에서 실행하고 값을 돌려준다. 예외면 던진다. */
  async function evaluate(sessionId, expression, { awaitPromise = true, timeout = 45_000 } = {}) {
    // 응답이 끝내 오지 않는 문맥(멈춘 워커 등)에서 하네스가 영영 서지 않게 한도를 둔다.
    const result = await Promise.race([
      send(
        'Runtime.evaluate',
        { expression, awaitPromise, returnByValue: true, userGesture: false },
        sessionId,
      ),
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error(`evaluate timeout: ${expression.slice(0, 60)}`)),
          timeout,
        ),
      ),
    ])
    if (result.exceptionDetails) {
      const text = result.exceptionDetails.exception?.description ?? result.exceptionDetails.text
      throw new Error(`evaluate failed: ${text}`)
    }
    return result.result.value
  }

  async function targets() {
    const { targetInfos } = await send('Target.getTargets', { filter: [{}] })
    return targetInfos
  }

  return {
    version: version.Browser,
    send,
    attach,
    evaluate,
    targets,
    on: (listener) => listeners.add(listener),
    off: (listener) => listeners.delete(listener),
    close: () => ws.close(),
  }
}

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** 조건이 참이 될 때까지 기다린다. 값이 나오면 그 값, 시간을 넘기면 던진다. */
export async function waitFor(
  check,
  { timeout = 15_000, interval = 100, label = 'condition' } = {},
) {
  const started = Date.now()
  let lastError = null
  while (Date.now() - started < timeout) {
    try {
      const value = await check()
      if (value) return value
    } catch (error) {
      lastError = error
    }
    await sleep(interval)
  }
  throw new Error(`timeout waiting for ${label}${lastError ? ` (${lastError.message})` : ''}`)
}
