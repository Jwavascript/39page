/**
 * YouTube 썸네일 주소 (M12, ARTWORK_DESIGN §2-3).
 *
 * 사용자가 그림을 고르지 않은 트랙(`auto`)의 그림이다. **저장하지 않는다** — 브라우저 캐시에 맡긴다.
 *
 * `hqdefault` 를 쓴다: 모든 영상에 있고(480×360), `maxresdefault` 는 없는 영상이 많다. 위아래 검은 띠는 표시하는
 * 쪽이 잘라낸다 (`ArtworkImage` 의 `scale`).
 */
import { isYouTubeVideoId } from '@/shared/utils/youtube'

/** 썸네일 서버. CSP 를 도입하면 `img-src` 에 넣어야 한다 (ARTWORK_DESIGN §1). */
export const THUMBNAIL_ORIGIN = 'https://i.ytimg.com'

/** 영상 id 가 형식에 맞을 때만 주소를 만든다. 아니면 `null` — 기본 그림을 쓴다. */
export function youtubeThumbnailUrl(videoId: string | null | undefined): string | null {
  if (!isYouTubeVideoId(videoId)) return null
  return `${THUMBNAIL_ORIGIN}/vi/${videoId}/hqdefault.jpg`
}

/**
 * YouTube 가 "썸네일 없음" 일 때 주는 회색 그림인가 — 삭제 · 비공개 영상은 오류 대신 120×90 그림을 준다.
 * 정상 `hqdefault` 는 480×360 이다.
 */
export function isPlaceholderThumbnail(size: {
  naturalWidth: number
  naturalHeight: number
}): boolean {
  return size.naturalWidth <= 120 && size.naturalHeight <= 90
}
