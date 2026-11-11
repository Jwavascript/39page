/**
 * 탭 주소가 "확장이 다루는 YouTube 영상 페이지" 인지 판정한다
 * (`docs/architecture/EXTENSION_DESIGN.md` §3).
 *
 * **판정 = 웹앱 `parseYouTubeVideoId` 성공 ∩ 호스트 제한.** 웹앱 함수를 그대로
 * 가져다 쓰므로(ADR 0022 결정 2) 확장이 받아들인 주소는 웹앱도 반드시 받아들이고,
 * 두 쪽의 `videoId` 가 같다. 여기서 더하는 것은 **좁히는** 규칙뿐이다.
 */
import { parseYouTubeVideoId } from '@web/shared/utils/youtube'

import type { PageKind, UnsupportedReason } from './messages'

/** 확장이 영상 페이지로 다루는 호스트. YouTube Music 은 M10 범위 밖. */
export const SUPPORTED_HOSTS: readonly string[] = [
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
]

const YOUTUBE_MUSIC_HOST = 'music.youtube.com'

/** 확장이 손댈 수 없는 스킴. activeTab 도 부여되지 않는다. */
const RESTRICTED_PROTOCOLS: readonly string[] = [
  'chrome:',
  'chrome-extension:',
  'chrome-untrusted:',
  'chrome-search:',
  'devtools:',
  'edge:',
  'about:',
  'view-source:',
  'file:',
  'data:',
  'blob:',
  'javascript:',
]

export type PageClassification =
  | { readonly kind: 'video'; readonly videoId: string; readonly pageKind: PageKind }
  | { readonly kind: 'unsupported'; readonly reason: UnsupportedReason }

function unsupported(reason: UnsupportedReason): PageClassification {
  return { kind: 'unsupported', reason }
}

/** YouTube 계열이지만 영상 페이지로 다루지 않는 호스트(스튜디오 · 짧은 주소 · 임베드 전용). */
function isYouTubeFamily(host: string): boolean {
  return (
    host === 'youtube.com' ||
    host.endsWith('.youtube.com') ||
    host === 'youtu.be' ||
    host === 'youtube-nocookie.com' ||
    host.endsWith('.youtube-nocookie.com')
  )
}

function pageKindOf(pathname: string): PageKind | null {
  if (pathname === '/watch') return 'watch'
  if (pathname.startsWith('/shorts/')) return 'shorts'
  if (pathname.startsWith('/live/')) return 'live'
  if (pathname.startsWith('/embed/')) return 'embed'
  return null
}

export function classifyPageUrl(url: string): PageClassification {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return unsupported('not-youtube')
  }

  if (RESTRICTED_PROTOCOLS.includes(parsed.protocol)) return unsupported('restricted')
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return unsupported('restricted')

  const host = parsed.hostname.toLowerCase()
  if (host === YOUTUBE_MUSIC_HOST) return unsupported('youtube-music')
  if (!SUPPORTED_HOSTS.includes(host)) {
    return unsupported(isYouTubeFamily(host) ? 'not-video-page' : 'not-youtube')
  }

  const result = parseYouTubeVideoId(url)
  if (!result.ok) return unsupported('not-video-page')

  // 웹앱 함수가 받아들인 경로는 아래 넷 중 하나다. 아니면 좁혀서 거절한다.
  const pageKind = pageKindOf(parsed.pathname)
  if (pageKind === null) return unsupported('not-video-page')

  return { kind: 'video', videoId: result.videoId, pageKind }
}
