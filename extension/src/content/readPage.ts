/**
 * YouTube 페이지에서 **읽기만** 한다 (`docs/architecture/EXTENSION_DESIGN.md` §2 · §3-2).
 *
 * 페이지를 바꾸지 않는다. 판단(이 제목이 지금 영상의 것인가)은 Background 가 한다 —
 * 여기서는 본 그대로 넘긴다. 선택자는 YouTube 가 바꿀 수 있으므로, 찾지 못하면
 * `null` 이고 Background 가 다른 출처로 대신한다.
 */
import { SNAPSHOT_HREF_MAX, SNAPSHOT_TEXT_MAX, type PageSnapshot } from '@/shared/messages'

/** 시청 페이지가 지금 띄운 영상 — 속성 `video-id`. */
const WATCH_ROOT = 'ytd-watch-flexy'
/** 시청 페이지의 제목 줄. */
const WATCH_HEADING = 'ytd-watch-metadata h1'

function bounded(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, max)
}

export function readPageSnapshot(doc: Document, href: string): PageSnapshot {
  const videoId = doc.querySelector(WATCH_ROOT)?.getAttribute('video-id') ?? null
  const heading = doc.querySelector(WATCH_HEADING)?.textContent ?? null

  return {
    href: bounded(href, SNAPSHOT_HREF_MAX),
    watch: {
      videoId: videoId === null ? null : bounded(videoId, 64),
      heading: heading === null ? null : bounded(heading, SNAPSHOT_TEXT_MAX),
    },
  }
}
