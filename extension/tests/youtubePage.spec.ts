import { describe, expect, it } from 'vitest'

import { parseYouTubeVideoId } from '@web/shared/utils/youtube'

import { classifyPageUrl } from '@/shared/youtubePage'

const ID = 'dQw4w9WgXcQ'

describe('YouTube 페이지 판정 (EXTENSION_DESIGN.md §3)', () => {
  it.each([
    [`https://www.youtube.com/watch?v=${ID}`, 'watch'],
    [`https://youtube.com/watch?v=${ID}&t=42s`, 'watch'],
    [`https://m.youtube.com/watch?v=${ID}`, 'watch'],
    [`https://www.youtube.com/watch?v=${ID}&list=PL123&index=3`, 'watch'],
    [`https://www.youtube.com/watch?app=desktop&v=${ID}`, 'watch'],
    [`https://www.youtube.com/shorts/${ID}`, 'shorts'],
    [`https://www.youtube.com/live/${ID}?si=abc`, 'live'],
    [`https://www.youtube.com/embed/${ID}`, 'embed'],
    [`https://WWW.YOUTUBE.COM/watch?v=${ID}`, 'watch'],
  ])('지원 — %s → %s', (url, pageKind) => {
    expect(classifyPageUrl(url)).toEqual({ kind: 'video', videoId: ID, pageKind })
  })

  it.each([
    ['https://example.com/', 'not-youtube'],
    ['https://notyoutube.com/watch?v=dQw4w9WgXcQ', 'not-youtube'],
    ['https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ', 'not-youtube'],
    ['https://39page.com/', 'not-youtube'],
    ['https://www.youtube.com/', 'not-video-page'],
    ['https://www.youtube.com/results?search_query=lofi', 'not-video-page'],
    ['https://www.youtube.com/@channel/videos', 'not-video-page'],
    ['https://www.youtube.com/watch', 'not-video-page'],
    ['https://www.youtube.com/watch?v=tooshort', 'not-video-page'],
    ['https://www.youtube.com/watch?v=dQw4w9WgXcQ!', 'not-video-page'],
    ['https://studio.youtube.com/video/dQw4w9WgXcQ/edit', 'not-video-page'],
    ['https://youtu.be/dQw4w9WgXcQ', 'not-video-page'],
    ['https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ', 'not-video-page'],
    ['https://music.youtube.com/watch?v=dQw4w9WgXcQ', 'youtube-music'],
    ['chrome://extensions/', 'restricted'],
    ['chrome-extension://abc/popup.html', 'restricted'],
    ['about:blank', 'restricted'],
    ['file:///sdcard/a.html', 'restricted'],
    ['view-source:https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'restricted'],
    ['ftp://www.youtube.com/watch?v=dQw4w9WgXcQ', 'restricted'],
    ['', 'not-youtube'],
    ['not a url', 'not-youtube'],
  ])('지원하지 않음 — %s → %s', (url, reason) => {
    expect(classifyPageUrl(url)).toEqual({ kind: 'unsupported', reason })
  })
})

/**
 * 호환성 — 확장이 받은 주소는 웹앱도 **같은 ID 로** 받는다 (ADR 0022 결정 2).
 * 확장은 웹앱 함수를 그대로 쓰고 좁히기만 한다. 이 표가 그 관계를 고정한다:
 * 웹앱 규칙이 바뀌어 확장이 웹앱보다 넓어지면 여기서 깨진다.
 */
describe('웹앱 parseYouTubeVideoId 와의 호환성', () => {
  const urls = [
    `https://www.youtube.com/watch?v=${ID}`,
    `http://www.youtube.com/watch?v=${ID}`,
    `https://m.youtube.com/watch?v=${ID}&feature=share`,
    `https://youtube.com/shorts/${ID}?feature=share`,
    `https://www.youtube.com/live/${ID}`,
    `https://www.youtube.com/embed/${ID}?start=10`,
    `https://music.youtube.com/watch?v=${ID}`,
    `https://youtu.be/${ID}`,
    `https://www.youtube-nocookie.com/embed/${ID}`,
    'https://www.youtube.com/watch?v=',
    'https://www.youtube.com/watch?v=abc',
    'https://www.youtube.com/shorts/',
    'https://www.youtube.com/feed/subscriptions',
    'https://example.com/watch?v=dQw4w9WgXcQ',
    'javascript:alert(1)',
    'https://www.youtube.com/watch?v=aaaaaaaaaaa&v=bbbbbbbbbbb',
  ]

  it.each(urls)('%s', (url) => {
    const extension = classifyPageUrl(url)
    const web = parseYouTubeVideoId(url)

    // 확장이 받았다면 웹앱도 같은 ID 로 받는다
    const extensionId = extension.kind === 'video' ? extension.videoId : null
    const webId = web.ok ? web.videoId : null
    expect(extensionId === null || extensionId === webId).toBe(true)
    // 웹앱이 거절하면 확장도 거절한다
    expect(webId === null && extensionId !== null).toBe(false)
  })

  it('확장이 일부러 좁힌 주소 — 웹앱은 받지만 확장은 영상 페이지로 다루지 않는다', () => {
    for (const url of [
      `https://music.youtube.com/watch?v=${ID}`,
      `https://youtu.be/${ID}`,
      `https://www.youtube-nocookie.com/embed/${ID}`,
    ]) {
      expect(parseYouTubeVideoId(url).ok).toBe(true)
      expect(classifyPageUrl(url).kind).toBe('unsupported')
    }
  })
})
