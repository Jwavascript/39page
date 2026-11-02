import { describe, expect, it } from 'vitest'

import { isYouTubeVideoId, parseYouTubeVideoId } from '@/shared/utils/youtube'

/** 유효한 11자 영상 ID. `_`와 `-`를 포함해 허용 문자 전체를 덮는다. */
const ID = 'dQw4w9WgXcQ'
const ID_WITH_SYMBOLS = 'a_b-c1D2E3F'

describe('isYouTubeVideoId', () => {
  it('11자 허용 문자 조합을 받아들인다', () => {
    expect(isYouTubeVideoId(ID)).toBe(true)
    expect(isYouTubeVideoId(ID_WITH_SYMBOLS)).toBe(true)
    expect(isYouTubeVideoId('___________')).toBe(true)
  })

  it('길이가 다르면 거부한다', () => {
    expect(isYouTubeVideoId('dQw4w9WgXc')).toBe(false) // 10자
    expect(isYouTubeVideoId('dQw4w9WgXcQQ')).toBe(false) // 12자
    expect(isYouTubeVideoId('')).toBe(false)
  })

  it('허용하지 않는 문자를 거부한다', () => {
    expect(isYouTubeVideoId('dQw4w9WgXc!')).toBe(false)
    expect(isYouTubeVideoId('dQw4w9WgXc ')).toBe(false)
    expect(isYouTubeVideoId('dQw4w9WgX.Q')).toBe(false)
  })

  it('문자열이 아닌 값을 거부한다', () => {
    expect(isYouTubeVideoId(undefined)).toBe(false)
    expect(isYouTubeVideoId(null)).toBe(false)
    expect(isYouTubeVideoId(12345678901)).toBe(false)
    expect(isYouTubeVideoId({ videoId: ID })).toBe(false)
  })
})

describe('parseYouTubeVideoId — 지원하는 형식', () => {
  it.each([
    ['watch', `https://www.youtube.com/watch?v=${ID}`],
    ['watch, www 없음', `https://youtube.com/watch?v=${ID}`],
    ['watch, 추가 파라미터', `https://www.youtube.com/watch?v=${ID}&t=42s&list=PLabc`],
    ['watch, v가 뒤에 위치', `https://www.youtube.com/watch?t=42s&v=${ID}`],
    ['watch, http', `http://www.youtube.com/watch?v=${ID}`],
    ['watch, m 접두사', `https://m.youtube.com/watch?v=${ID}`],
    ['music.youtube.com', `https://music.youtube.com/watch?v=${ID}`],
    ['youtube-nocookie.com', `https://www.youtube-nocookie.com/watch?v=${ID}`],
    ['shorts', `https://www.youtube.com/shorts/${ID}`],
    ['shorts, 끝 슬래시', `https://www.youtube.com/shorts/${ID}/`],
    ['shorts, 쿼리 포함', `https://www.youtube.com/shorts/${ID}?feature=share`],
    ['embed', `https://www.youtube.com/embed/${ID}`],
    ['embed, nocookie', `https://www.youtube-nocookie.com/embed/${ID}`],
    ['live', `https://www.youtube.com/live/${ID}`],
    ['youtu.be', `https://youtu.be/${ID}`],
    ['youtu.be, 쿼리 포함', `https://youtu.be/${ID}?t=30`],
    ['youtu.be, 프래그먼트 포함', `https://youtu.be/${ID}#t=30`],
    ['youtu.be, www 접두사', `https://www.youtu.be/${ID}`],
    ['대문자 호스트', `HTTPS://WWW.YOUTUBE.COM/watch?v=${ID}`],
    ['앞뒤 공백', `   https://youtu.be/${ID}   `],
  ])('%s', (_label, url) => {
    expect(parseYouTubeVideoId(url)).toEqual({ ok: true, videoId: ID })
  })

  it('기호가 들어간 ID를 보존한다', () => {
    const result = parseYouTubeVideoId(`https://youtu.be/${ID_WITH_SYMBOLS}`)
    expect(result).toEqual({ ok: true, videoId: ID_WITH_SYMBOLS })
  })
})

describe('parseYouTubeVideoId — 거부하는 입력', () => {
  it.each([
    ['빈 문자열', '', 'empty'],
    ['공백뿐', '   \t\n ', 'empty'],
    ['URL이 아님', 'not a url', 'malformed-url'],
    ['스킴 없음', `www.youtube.com/watch?v=${ID}`, 'malformed-url'],
    ['영상 ID만', ID, 'malformed-url'],
    ['javascript 스킴', `javascript:alert(1)`, 'unsupported-protocol'],
    ['file 스킴', `file:///watch?v=${ID}`, 'unsupported-protocol'],
    ['다른 사이트', `https://vimeo.com/watch?v=${ID}`, 'unsupported-host'],
    ['유사 호스트', `https://youtube.com.evil.test/watch?v=${ID}`, 'unsupported-host'],
    ['youtube를 포함한 다른 호스트', `https://notyoutube.com/watch?v=${ID}`, 'unsupported-host'],
    ['youtu.be 유사 호스트', `https://youtu.be.evil.test/${ID}`, 'unsupported-host'],
    ['지원하지 않는 경로', `https://www.youtube.com/playlist?list=PLabc`, 'unsupported-path'],
    ['채널 경로', `https://www.youtube.com/@someone`, 'unsupported-path'],
    ['구형 임베드 경로', `https://www.youtube.com/v/${ID}`, 'unsupported-path'],
    ['루트', `https://www.youtube.com/`, 'unsupported-path'],
    ['youtu.be 경로 없음', `https://youtu.be/`, 'unsupported-path'],
    ['watch에 v 없음', `https://www.youtube.com/watch?t=42s`, 'invalid-video-id'],
    ['watch의 v가 짧음', `https://www.youtube.com/watch?v=tooShort`, 'invalid-video-id'],
    ['watch의 v가 김', `https://www.youtube.com/watch?v=${ID}EXTRA`, 'invalid-video-id'],
    ['shorts ID가 짧음', `https://www.youtube.com/shorts/abc`, 'invalid-video-id'],
    ['youtu.be ID가 짧음', `https://youtu.be/abc`, 'invalid-video-id'],
  ])('%s', (_label, url, reason) => {
    expect(parseYouTubeVideoId(url)).toEqual({ ok: false, reason })
  })

  it('어떤 입력에도 예외를 던지지 않는다', () => {
    const hostile = [
      '',
      '://',
      'https://',
      'https://#',
      '%%%',
      'https://youtu.be/%%%',
      `https://www.youtube.com/watch?v=${'x'.repeat(5000)}`,
      '\u0000',
    ]
    for (const input of hostile) {
      expect(() => parseYouTubeVideoId(input)).not.toThrow()
      expect(parseYouTubeVideoId(input).ok).toBe(false)
    }
  })
})
