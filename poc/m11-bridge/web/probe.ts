/**
 * M11-1 PoC — 저장소 파티션 측정용 탐침 (39page origin).
 *
 * ⚠ 실험 코드. 사용자 데이터를 읽거나 쓰지 않는다 — 전용 표지 키(`39page-poc-probe*`)만 다루고,
 * 라이브러리 원문은 **길이**만 본다. 격리된 시험 프로필에서만 띄운다.
 *
 * 어떤 자리에 놓였을 때 이 문서가 최상위 39page 탭과 같은 저장소 · 잠금 관리자 · storage
 * 이벤트를 공유하는지 본다.
 */
const MARKER_KEY = '39page-poc-probe'
const FRAME_KEY = '39page-poc-probe-from-frame'
const storageEvents: string[] = []

globalThis.addEventListener('storage', (event) => {
  storageEvents.push(`${event.key ?? 'null'}=${event.newValue ?? 'null'}`)
})

async function report(): Promise<Record<string, unknown>> {
  let marker: string | null = null
  let libraryLength: number | null = null
  let storageError: string | null = null
  try {
    marker = localStorage.getItem(MARKER_KEY)
    libraryLength = localStorage.getItem('39page.library')?.length ?? null
  } catch (error) {
    storageError = String(error)
  }
  let locks: string[] | null = null
  try {
    const snapshot = await navigator.locks.query()
    locks = [...(snapshot.held ?? []), ...(snapshot.pending ?? [])].map((l) => l.name ?? '')
  } catch {
    locks = null
  }
  return {
    href: globalThis.location.href,
    isTop: globalThis.top === globalThis.self,
    ancestors: globalThis.location.ancestorOrigins
      ? Array.from(globalThis.location.ancestorOrigins)
      : null,
    marker,
    libraryLength,
    storageError,
    locks,
    storageEvents: [...storageEvents],
  }
}

globalThis.addEventListener('message', (event: MessageEvent) => {
  const data = event.data as {
    ns?: string
    cmd?: string
    value?: string
    name?: string
    ms?: number
  }
  if (data?.ns !== '39page-poc-probe') return
  const reply = (body: Record<string, unknown>): void => {
    ;(event.source as Window | null)?.postMessage({ ns: '39page-poc-probe', ...body }, '*')
  }
  if (data.cmd === 'report') void report().then((r) => reply({ kind: 'report', report: r }))
  if (data.cmd === 'write') {
    localStorage.setItem(FRAME_KEY, data.value ?? '')
    reply({ kind: 'written' })
  }
  if (data.cmd === 'hold-lock' && data.name !== undefined) {
    void navigator.locks.request(
      data.name,
      () => new Promise((r) => setTimeout(r, data.ms ?? 3_000)),
    )
    reply({ kind: 'holding' })
  }
})

void report().then((r) => {
  ;(globalThis as unknown as { __probe: unknown }).__probe = r
  if (globalThis.parent !== globalThis.self) {
    globalThis.parent.postMessage({ ns: '39page-poc-probe', kind: 'loaded', report: r }, '*')
  }
})

export {}
