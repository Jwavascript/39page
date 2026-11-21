/**
 * LRCLIB 클라이언트 (ADR 0046) — https://lrclib.net 의 공개 가사 API.
 *
 * - 키 없음 · CORS 허용(`Access-Control-Allow-Origin: *`). 브라우저는 `User-Agent` 를 바꿀 수 없어 문서가 정한 대안
 *   `Lrclib-Client` 머리로 이 앱을 밝힌다.
 * - **한 번에 하나씩** 보낸다(앞 요청이 끝나고 짧게 쉰 뒤). 429 · 503 이면 `Retry-After`(+ 최대 30% 흔들기) 동안
 *   아무 요청도 보내지 않는다 — 문서의 요구다.
 * - 응답은 상태 코드와 모양을 검사한 뒤에만 쓴다. 가사 글자는 화면에 **글자로만** 넣는다(HTML 로 해석하지 않는다).
 *
 * Vue 를 모른다. 시계 · `fetch` · 난수는 주입한다(시험).
 */

export const LRCLIB_ORIGIN = 'https://lrclib.net'
/** 이 앱을 밝히는 값 — 이름 · 주소. 사용자 정보는 넣지 않는다. */
export const LRCLIB_CLIENT = '39page (https://39page.com)'
/** 요청 사이 최소 간격 (문서 권장 200–500ms). */
export const LRCLIB_GAP_MS = 300
const TIMEOUT_MS = 10_000

export interface LyricsRecord {
  readonly id: number
  readonly trackName: string
  readonly artistName: string
  readonly albumName: string
  /** 초. */
  readonly duration: number
  readonly instrumental: boolean
  readonly plainLyrics: string | null
  readonly syncedLyrics: string | null
}

export type LrclibFailure = 'not-found' | 'rate-limited' | 'network' | 'bad-response'

export type LrclibResult<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly reason: LrclibFailure }

const text = (value: unknown): string => (typeof value === 'string' ? value : '')
const lyrics = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() !== '' ? value : null

/** 응답 한 건을 검증한다. 모르는 모양이면 `null`. */
export function readLyricsRecord(value: unknown): LyricsRecord | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const raw = value as Record<string, unknown>
  if (typeof raw.id !== 'number' || !Number.isInteger(raw.id) || raw.id <= 0) return null
  const duration =
    typeof raw.duration === 'number' && Number.isFinite(raw.duration) ? raw.duration : 0
  return {
    id: raw.id,
    trackName: text(raw.trackName),
    artistName: text(raw.artistName),
    albumName: text(raw.albumName),
    duration: Math.max(0, duration),
    instrumental: raw.instrumental === true,
    plainLyrics: lyrics(raw.plainLyrics),
    syncedLyrics: lyrics(raw.syncedLyrics),
  }
}

/** `Retry-After` — 초 또는 HTTP 날짜. 모르면 60초. */
export function retryAfterSeconds(header: string | null, now: number): number {
  if (header === null) return 60
  const seconds = Number(header)
  if (Number.isFinite(seconds) && seconds >= 0) return seconds
  const date = Date.parse(header)
  return Number.isFinite(date) ? Math.max(0, (date - now) / 1000) : 60
}

export interface LrclibClientOptions {
  readonly fetch?: typeof fetch
  readonly now?: () => number
  readonly random?: () => number
  readonly wait?: (ms: number) => Promise<void>
}

export interface LrclibClient {
  search(
    params: { q?: string; track_name?: string; artist_name?: string },
    signal?: AbortSignal,
  ): Promise<LrclibResult<LyricsRecord[]>>
  get(id: number, signal?: AbortSignal): Promise<LrclibResult<LyricsRecord>>
  /** 이 시각(ms)까지 요청하지 않는다. 막히지 않았으면 0. */
  blockedUntil(): number
}

export function createLrclibClient(options: LrclibClientOptions = {}): LrclibClient {
  const doFetch = options.fetch ?? ((...args: Parameters<typeof fetch>) => fetch(...args))
  const now = options.now ?? Date.now
  const random = options.random ?? Math.random
  const wait =
    options.wait ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))

  let blocked = 0
  /** 마지막 요청이 끝난 시각. 첫 요청은 기다리지 않는다. */
  let last = Number.NEGATIVE_INFINITY
  /** 요청을 한 줄로 세운다. */
  let queue: Promise<unknown> = Promise.resolve()

  async function send(path: string, signal?: AbortSignal): Promise<LrclibResult<unknown>> {
    if (now() < blocked) return { ok: false, reason: 'rate-limited' }
    const gap = last + LRCLIB_GAP_MS - now()
    if (gap > 0) await wait(gap)
    if (signal?.aborted === true) return { ok: false, reason: 'network' }
    if (now() < blocked) return { ok: false, reason: 'rate-limited' }
    let response: Response
    try {
      const timeout = AbortSignal.timeout(TIMEOUT_MS)
      const combined =
        signal === undefined
          ? timeout
          : typeof AbortSignal.any === 'function'
            ? AbortSignal.any([signal, timeout])
            : signal
      response = await doFetch(`${LRCLIB_ORIGIN}${path}`, {
        headers: { 'Lrclib-Client': LRCLIB_CLIENT, Accept: 'application/json' },
        // 이 페이지 주소를 보내지 않는다 — 곡 이름 말고는 알릴 것이 없다.
        referrerPolicy: 'no-referrer',
        credentials: 'omit',
        signal: combined,
      })
    } catch {
      return { ok: false, reason: 'network' }
    } finally {
      last = now()
    }
    if (response.status === 429 || response.status === 503) {
      const delay = retryAfterSeconds(response.headers.get('Retry-After'), now())
      blocked = now() + delay * 1000 * (1 + random() * 0.3)
      return { ok: false, reason: 'rate-limited' }
    }
    if (response.status === 404) return { ok: false, reason: 'not-found' }
    if (!response.ok) return { ok: false, reason: 'network' }
    if (!(response.headers.get('Content-Type') ?? '').includes('json')) {
      return { ok: false, reason: 'bad-response' }
    }
    try {
      return { ok: true, value: (await response.json()) as unknown }
    } catch {
      return { ok: false, reason: 'bad-response' }
    }
  }

  function enqueue<T>(run: () => Promise<T>): Promise<T> {
    const next = queue.then(run, run)
    queue = next.catch(() => undefined)
    return next
  }

  return {
    search(params, signal) {
      const query = new URLSearchParams()
      for (const [key, value] of Object.entries(params)) {
        if (typeof value === 'string' && value.trim() !== '') query.set(key, value.trim())
      }
      return enqueue(async () => {
        const result = await send(`/api/search?${query.toString()}`, signal)
        if (!result.ok) return result
        if (!Array.isArray(result.value)) return { ok: false, reason: 'bad-response' }
        return {
          ok: true,
          value: result.value.flatMap((item) => {
            const record = readLyricsRecord(item)
            return record === null ? [] : [record]
          }),
        }
      })
    },
    get(id, signal) {
      return enqueue(async () => {
        if (!Number.isInteger(id) || id <= 0) return { ok: false, reason: 'not-found' }
        const result = await send(`/api/get/${String(id)}`, signal)
        if (!result.ok) return result
        const record = readLyricsRecord(result.value)
        return record === null ? { ok: false, reason: 'bad-response' } : { ok: true, value: record }
      })
    },
    blockedUntil: () => (now() < blocked ? blocked : 0),
  }
}
