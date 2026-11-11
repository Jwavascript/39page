/**
 * 수집 URL 계약 v1 — 확장 쪽 생성 (M10-3, ADR 0023, `EXTENSION_DESIGN.md` §5-1).
 *
 * ```
 * <origin>/#collect?v=1&kind=track&videoId=<11자>&title=<선택>&req=<요청 ID>
 * ```
 *
 * 웹앱이 같은 고정 파일(`tests/fixtures/collect-v1.json`)로 받아들이는 쪽을 검사하고,
 * 확장 테스트가 이 함수가 그 파일과 **글자까지 같은** 주소를 만드는지 검사한다.
 * 정보는 주소 **조각**에만 싣는다 — 서버로 가지 않는다.
 */
import { DEV_COLLECT_ORIGINS, PRODUCTION_COLLECT_ORIGIN } from './collectOrigin'

export interface CollectUrlInput {
  readonly videoId: string
  /** 정리된 제목(≤100자). 없으면 싣지 않는다 — 웹앱이 기본 제목을 쓴다. */
  readonly title: string | null
  readonly requestId: string
}

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/
const REQUEST_ID = /^[A-Za-z0-9_-]{16,64}$/

/**
 * 실행 중에도 origin 을 다시 확인한다. 개발용 localhost 는 **개발 빌드에서만**
 * 허용한다 — Vite 가 `import.meta.env.MODE` 를 상수로 바꾸므로 운영 번들에서는 이
 * 분기와 개발용 목록이 통째로 빠진다 (manifest 검사가 확인한다).
 */
function isAllowedAtRuntime(origin: string): boolean {
  if (origin === PRODUCTION_COLLECT_ORIGIN) return true
  return import.meta.env.MODE === 'development' && DEV_COLLECT_ORIGINS.includes(origin)
}

/** 계약에 맞지 않는 입력이면 던진다 — 만드는 쪽에서 틀린 주소를 내보내지 않는다. */
export function buildCollectUrl(origin: string, input: CollectUrlInput): string {
  if (!isAllowedAtRuntime(origin)) throw new Error(`허용하지 않은 수집 origin — ${origin}`)
  if (!VIDEO_ID.test(input.videoId)) throw new Error('videoId 가 11자 영상 ID 가 아니다')
  if (!REQUEST_ID.test(input.requestId)) throw new Error('요청 ID 형식이 아니다')

  const params = new URLSearchParams()
  params.set('v', '1')
  params.set('kind', 'track')
  params.set('videoId', input.videoId)
  if (input.title !== null && input.title !== '') params.set('title', input.title)
  params.set('req', input.requestId)
  return `${origin}/#collect?${params.toString()}`
}
