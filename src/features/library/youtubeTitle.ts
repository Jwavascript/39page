/**
 * YouTube 영상 제목 조회 — oEmbed (M11-4 후속, D5 · ADR 0029).
 *
 * 링크만 넣고 제목을 비우면 곡이 `YouTube · <영상 ID>` 로 남는다 (U13). 링크 추가 양식이 **제목 칸을
 * 미리 채우는 데에만** 쓴다. 저장된 제목을 바꾸지 않는다.
 *
 * 왜 oEmbed 인가 (2026-11-12 조사 · 실제 Chrome 측정, `M11_UX_DESIGN.md` §12)
 * - IFrame Player API 에는 제목을 주는 **문서화된** 함수가 없다 (`getVideoData` 는 문서에 없다).
 * - Data API 는 키가 필요하다 — 정적 사이트에 키를 둘 수 없다 (ADR 0015).
 * - oEmbed 는 키가 없고, YouTube 가 자기 영상 페이지에 `application/json+oembed` 발견 링크로 알리는
 *   엔드포인트다 (oEmbed 제공자 목록에도 있다). 브라우저에서 CORS 로 읽힌다.
 *
 * 보내는 것: 영상 주소 하나. **쿠키 · 리퍼러를 보내지 않는다** (`credentials: 'omit'`,
 * `referrerPolicy: 'no-referrer'` — 실측에서 Cookie · Referer 헤더 없음, Origin 만).
 *
 * **던지지 않는다.** 실패는 이유와 함께 돌려주고, 호출부는 실패해도 곡 추가를 막지 않는다.
 */

export type TitleLookupFailure =
  /** 그런 영상이 없다 · 주소가 틀렸다 (YouTube 는 400 · 404). */
  | 'not-found'
  /** 비공개 · 제한된 영상이라 알려 주지 않는다 (401 · 403). */
  | 'unavailable'
  /** 연결 실패 · 다른 HTTP 오류. */
  | 'network'
  /** 시간 한도를 넘었다. */
  | 'timeout'
  /** 응답에 쓸 만한 제목이 없다. */
  | 'invalid'

export type TitleLookupResult =
  | { readonly ok: true; readonly title: string }
  | { readonly ok: false; readonly reason: TitleLookupFailure }

/** 기다리는 한도. 넘으면 포기하고 칸을 비워 둔다 (실측: 정상 응답 88–197ms). */
export const TITLE_LOOKUP_TIMEOUT_MS = 4000

/** 조회 주소. 영상 ID 로 표준 시청 주소를 만들어 넘긴다 — 사용자가 붙인 주소의 다른 매개변수는 보내지 않는다. */
export function oembedUrl(videoId: string): string {
  const watch = `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`
  return `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(watch)}`
}

/** 응답의 제목 — 문자열이고 공백만이 아니어야 한다. 제어 문자는 공백으로. */
export function titleFromPayload(payload: unknown): string | null {
  if (typeof payload !== 'object' || payload === null) return null
  const title = (payload as { title?: unknown }).title
  if (typeof title !== 'string') return null
  // 응답의 제어 문자(유니코드 Cc)는 공백으로.
  const clean = title.replace(/\p{Cc}+/gu, ' ').trim()
  return clean === '' ? null : clean
}

export async function fetchYouTubeTitle(
  videoId: string,
  options: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<TitleLookupResult> {
  const controller = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, options.timeoutMs ?? TITLE_LOOKUP_TIMEOUT_MS)
  const onAbort = (): void => controller.abort()
  options.signal?.addEventListener('abort', onAbort, { once: true })
  if (options.signal?.aborted) controller.abort()

  try {
    const response = await fetch(oembedUrl(videoId), {
      signal: controller.signal,
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      headers: { accept: 'application/json' },
    })
    if (response.status === 400 || response.status === 404)
      return { ok: false, reason: 'not-found' }
    if (response.status === 401 || response.status === 403)
      return { ok: false, reason: 'unavailable' }
    if (!response.ok) return { ok: false, reason: 'network' }
    let payload: unknown
    try {
      payload = await response.json()
    } catch {
      return { ok: false, reason: timedOut ? 'timeout' : 'invalid' }
    }
    const title = titleFromPayload(payload)
    return title === null ? { ok: false, reason: 'invalid' } : { ok: true, title }
  } catch {
    return { ok: false, reason: timedOut ? 'timeout' : 'network' }
  } finally {
    clearTimeout(timer)
    options.signal?.removeEventListener('abort', onAbort)
  }
}
