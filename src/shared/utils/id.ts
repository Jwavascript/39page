/**
 * 앱 내부 식별자 생성.
 *
 * `crypto.randomUUID()`를 우선 쓰되 **없을 수 있다는 점**을 전제한다.
 * `randomUUID`는 보안 컨텍스트(https 또는 localhost)에서만 정의된다.
 * 같은 네트워크의 다른 기기에서 `http://<사설 IP>:5173` 으로 열면
 * `undefined`가 되므로 대체 경로가 필요하다.
 */

/** 안전한 난수원이 없을 때 쓰는 최후 수단. 충돌 가능성이 아주 낮으면 충분하다. */
function weakId(): string {
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

/** 충돌하지 않는 안정적인 식별자를 만든다. */
export function createId(): string {
  const webCrypto = globalThis.crypto as Crypto | undefined

  if (typeof webCrypto?.randomUUID === 'function') {
    return webCrypto.randomUUID()
  }

  if (typeof webCrypto?.getRandomValues === 'function') {
    const bytes = webCrypto.getRandomValues(new Uint8Array(16))
    return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')
  }

  return weakId()
}
