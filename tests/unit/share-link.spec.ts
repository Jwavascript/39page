/**
 * ADR 0040 — 링크 공유 형식 `#share?v=1&d=…` (만들기 · 읽기 · 검증).
 *
 * 조각은 누구나 만들 수 있다 — 읽기는 길이 · 압축 해제 크기 · 개수 · 글자 · 형식을 모두 본 뒤에만 내용을 돌려준다.
 */
import { deflateSync } from 'fflate'
import { describe, expect, it } from 'vitest'

import {
  encodeShareLink,
  isShareHash,
  MAX_SHARE_AT_SECONDS,
  MAX_SHARE_DATA_LENGTH,
  MAX_SHARE_LINK_TRACKS,
  MAX_SHARE_NAME_LENGTH,
  MAX_SHARE_NOTE_LENGTH,
  MAX_SHARE_TITLE_LENGTH,
  momentLinkContent,
  parseShareLink,
  playlistLinkContent,
  SHARE_LINK_PROBLEM_MESSAGE,
  shareLinkUrl,
  trackLinkContent,
  type ShareLinkContent,
} from '@/features/backup/shareLink'
import type { Moment, Playlist, Track } from '@/shared/types'
import { MAX_PLAYLIST_NAME_LENGTH, MAX_TRACK_TITLE_LENGTH } from '@/stores/library'
import { MAX_MOMENT_NOTE_LENGTH } from '@/stores/moments'

const ID = ['aaaaaaaaaaa', 'bbbbbbbbbbb', 'ccccccccccc', 'dQw4w9WgXcQ'] as const

const track = (id: string, videoId: string, title: string): Track => ({
  id,
  source: 'youtube',
  videoId,
  title,
})

const moment = (videoId: string, atSeconds: number, note = ''): Moment => ({
  id: `m-${videoId}-${String(atSeconds)}`,
  source: 'youtube',
  videoId,
  atSeconds,
  note,
  title: '',
  createdAt: '2026-11-20T00:00:00.000Z',
  updatedAt: '2026-11-20T00:00:00.000Z',
})

const PLAYLIST: Playlist = {
  id: 'p1',
  name: '여름 밤 플레이리스트',
  tracks: [
    track('t1', ID[0], '아이유 - 밤편지'),
    track('t2', ID[1], 'Sintel'),
    track('t3', ID[2], `YouTube · ${ID[2]}`),
  ],
}

/** 시험용 — 임의의 JSON 을 링크 조각으로 (만드는 쪽의 다듬기를 거치지 않는다). */
function rawLink(wire: unknown, version = '1'): string {
  const json = new Uint8Array(new TextEncoder().encode(JSON.stringify(wire)))
  return `#share?v=${version}&d=${base64url(deflateSync(json, { level: 9 }))}`
}

function base64url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

const ALL = { titles: true, notes: true }

describe('A. 만들고 읽으면 같은 내용', () => {
  it('목록 — 이름 · 곡 순서 · 곡 이름 · Moments(메모 · 줄바꿈 포함)', () => {
    const content = playlistLinkContent(
      PLAYLIST,
      [moment(ID[1], 30, '여기\n최고'), moment(ID[0], 83, '후렴'), moment('zzzzzzzzzzz', 1)],
      ALL,
    )
    const parsed = parseShareLink(encodeShareLink(content))

    expect(parsed).toEqual({
      ok: true,
      content: {
        kind: 'playlist',
        name: '여름 밤 플레이리스트',
        tracks: [
          { videoId: ID[0], title: '아이유 - 밤편지' },
          { videoId: ID[1], title: 'Sintel' },
          // 이름을 지은 적 없는 곡의 기본 이름은 싣지 않는다 — 받는 쪽이 YouTube 에서 찾는다.
          { videoId: ID[2], title: '' },
        ],
        // 목록에 없는 영상의 Moment 는 넣지 않는다. 곡 순서 → 시점 순서.
        moments: [
          { videoId: ID[0], atSeconds: 83, note: '후렴' },
          { videoId: ID[1], atSeconds: 30, note: '여기\n최고' },
        ],
      },
    })
  })

  it('곡 이름 · 메모를 빼면 빈 글자로 온다', () => {
    const content = playlistLinkContent(PLAYLIST, [moment(ID[0], 5, '메모')], {
      titles: false,
      notes: false,
    })
    const parsed = parseShareLink(encodeShareLink(content))
    expect(parsed.ok && parsed.content.tracks.map((t) => t.title)).toEqual(['', '', ''])
    expect(parsed.ok && parsed.content.moments).toEqual([
      { videoId: ID[0], atSeconds: 5, note: '' },
    ])
  })

  it('곡 하나 · Moment 하나', () => {
    const single = trackLinkContent(PLAYLIST.tracks[0] as Track, [moment(ID[0], 12)], ALL)
    expect(parseShareLink(encodeShareLink(single))).toEqual({ ok: true, content: single })

    const one = momentLinkContent(moment(ID[3], 42, '이 부분'), 'Never Gonna', ALL)
    expect(parseShareLink(encodeShareLink(one))).toEqual({
      ok: true,
      content: {
        kind: 'moment',
        name: '',
        tracks: [{ videoId: ID[3], title: 'Never Gonna' }],
        moments: [{ videoId: ID[3], atSeconds: 42, note: '이 부분' }],
      },
    })
  })

  it('같은 내용이면 같은 링크 — 주소에 쓰이는 글자만', () => {
    const content = playlistLinkContent(PLAYLIST, null, ALL)
    const a = encodeShareLink(content)
    expect(encodeShareLink(content)).toBe(a)
    expect(a).toMatch(/^#share\?v=1&d=[A-Za-z0-9_-]+$/)
    expect(shareLinkUrl('https://39page.com/', content)).toBe(`https://39page.com/${a}`)
    expect(shareLinkUrl('https://39page.com/#old', content)).toBe(`https://39page.com/${a}`)
  })

  it('길이 — 영상 ID 만이면 100곡이 약 1,300자, 한글 제목 30곡은 2,000자 안팎', () => {
    const many: Playlist = {
      id: 'x',
      name: '긴 목록',
      tracks: Array.from({ length: 100 }, (_, i) =>
        track(`t${String(i)}`, `v${String(i).padStart(10, '0')}`, `노래 제목 ${String(i)}`),
      ),
    }
    const idsOnly = encodeShareLink(
      playlistLinkContent(many, null, { titles: false, notes: false }),
    )
    expect(idsOnly.length).toBeLessThan(1600)

    const korean: Playlist = {
      id: 'k',
      name: '한글 목록',
      tracks: Array.from({ length: 30 }, (_, i) =>
        track(
          `k${String(i)}`,
          `k${String(i).padStart(10, '0')}`,
          `가수이름${String(i)} - 아주 긴 한글 노래 제목 ${String(i)}`,
        ),
      ),
    }
    const withTitles = encodeShareLink(playlistLinkContent(korean, null, ALL))
    expect(withTitles.length).toBeLessThan(2600)
    expect(parseShareLink(withTitles).ok).toBe(true)
  })
})

describe('B. 만들 때 다듬는다', () => {
  it('쓸 수 없는 글자를 걷어내고 상한에서 자른다 — 메모만 줄바꿈을 지킨다', () => {
    const dirty: Playlist = {
      id: 'd',
      name: `이름‮거꾸로${'가'.repeat(80)}`,
      tracks: [track('t', ID[0], `제목\u0007\n둘째 줄${'나'.repeat(150)}`)],
    }
    const parsed = parseShareLink(
      encodeShareLink(
        playlistLinkContent(
          dirty,
          [moment(ID[0], 1, `메모\u0000\r\n다음${'다'.repeat(600)}`)],
          ALL,
        ),
      ),
    )
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect([...parsed.content.name]).toHaveLength(MAX_SHARE_NAME_LENGTH)
    expect(parsed.content.name.startsWith('이름거꾸로')).toBe(true)
    expect(parsed.content.tracks[0]?.title.startsWith('제목둘째 줄')).toBe(true)
    expect([...(parsed.content.tracks[0]?.title ?? '')]).toHaveLength(MAX_SHARE_TITLE_LENGTH)
    expect(parsed.content.moments[0]?.note.startsWith('메모\n다음')).toBe(true)
    expect([...(parsed.content.moments[0]?.note ?? '')]).toHaveLength(MAX_SHARE_NOTE_LENGTH)
  })

  it('잘못된 영상 ID · 범위 밖 시점은 넣지 않는다', () => {
    const content: ShareLinkContent = {
      kind: 'playlist',
      name: 'x',
      tracks: [
        { videoId: 'bad', title: 'x' },
        { videoId: ID[0], title: 'ok' },
      ],
      moments: [
        { videoId: ID[0], atSeconds: MAX_SHARE_AT_SECONDS + 1, note: '' },
        { videoId: ID[0], atSeconds: 1.5, note: '' },
        { videoId: ID[0], atSeconds: 7, note: '' },
      ],
    }
    const parsed = parseShareLink(encodeShareLink(content))
    expect(parsed.ok && parsed.content.tracks).toEqual([{ videoId: ID[0], title: 'ok' }])
    expect(parsed.ok && parsed.content.moments).toEqual([
      { videoId: ID[0], atSeconds: 7, note: '' },
    ])
  })
})

describe('C. 읽기 — 거절', () => {
  it('공유 조각이 아니다 · 버전 · 중복 · 내용 없음', () => {
    expect(isShareHash('#share')).toBe(true)
    expect(isShareHash('#shared?v=1')).toBe(false)
    expect(parseShareLink('#collect?v=1')).toEqual({ ok: false, problem: 'not-share' })
    expect(parseShareLink('#share?d=abc')).toEqual({ ok: false, problem: 'missing-version' })
    expect(parseShareLink('#share?v=2&d=abc')).toEqual({
      ok: false,
      problem: 'unsupported-version',
    })
    expect(parseShareLink('#share?v=1.0&d=abc')).toEqual({
      ok: false,
      problem: 'unsupported-version',
    })
    expect(parseShareLink('#share?v=1&v=1&d=abc')).toEqual({ ok: false, problem: 'invalid' })
    expect(parseShareLink('#share?v=1')).toEqual({ ok: false, problem: 'missing-data' })
    expect(parseShareLink('#share?v=1&d=')).toEqual({ ok: false, problem: 'missing-data' })
  })

  it('base64url 이 아니다 · 압축이 손상됐다 · 잘렸다', () => {
    expect(parseShareLink('#share?v=1&d=ab%cd')).toEqual({ ok: false, problem: 'corrupt' })
    expect(parseShareLink('#share?v=1&d=a')).toEqual({ ok: false, problem: 'corrupt' })
    expect(
      parseShareLink(`#share?v=1&d=${base64url(new Uint8Array([1, 2, 3, 250, 251]))}`),
    ).toEqual({ ok: false, problem: 'corrupt' })
    const good = encodeShareLink(playlistLinkContent(PLAYLIST, null, ALL))
    // 게시판이 링크 끝을 잘랐다.
    expect(parseShareLink(good.slice(0, good.length - 12))).toEqual({
      ok: false,
      problem: 'corrupt',
    })
  })

  it('JSON 이 아니다 · 형식이 틀렸다', () => {
    const notJson = new Uint8Array(new TextEncoder().encode('not json'))
    expect(parseShareLink(`#share?v=1&d=${base64url(deflateSync(notJson))}`)).toEqual({
      ok: false,
      problem: 'corrupt',
    })
    const bad: unknown[] = [
      [],
      { k: 'x', t: [[ID[0]]] },
      { k: 'p' },
      { k: 'p', t: [] },
      { k: 'p', t: [[ID[0], 'a', 'b']] },
      { k: 'p', t: [['not-an-id']] },
      { k: 'p', t: [[ID[0], 5]] },
      { k: 'p', t: [[ID[0], 'x'.repeat(MAX_SHARE_TITLE_LENGTH + 1)]] },
      { k: 'p', t: [[ID[0], '제어\u0001문자']] },
      { k: 'p', t: [[ID[0], '방향‮바꾸기']] },
      { k: 'p', t: [[ID[0], '줄\n바꿈']] },
      { k: 'p', n: 'x'.repeat(MAX_SHARE_NAME_LENGTH + 1), t: [[ID[0]]] },
      { k: 't', n: '곡에는 이름이 없다', t: [[ID[0]]] },
      { k: 't', t: [[ID[0]], [ID[1]]] },
      { k: 'm', t: [[ID[0]]] },
      {
        k: 'm',
        t: [[ID[0]]],
        m: [
          [0, 1],
          [0, 2],
        ],
      },
      { k: 'p', t: [[ID[0]]], m: [[1, 5]] },
      { k: 'p', t: [[ID[0]]], m: [[0, -1]] },
      { k: 'p', t: [[ID[0]]], m: [[0, 1.5]] },
      { k: 'p', t: [[ID[0]]], m: [[0, MAX_SHARE_AT_SECONDS + 1]] },
      { k: 'p', t: [[ID[0]]], m: [[0, 1, 'x'.repeat(MAX_SHARE_NOTE_LENGTH + 1)]] },
      { k: 'p', t: [[ID[0]]], m: [[0, 1, '널\u0000문자']] },
      { k: 'p', t: [[ID[0]]], m: 'x' },
    ]
    for (const wire of bad) {
      expect({ wire, parsed: parseShareLink(rawLink(wire)) }).toEqual({
        wire,
        parsed: {
          ok: false,
          problem: 'invalid',
        },
      })
    }
    // 메모의 줄바꿈은 받는다. 모르는 키는 무시한다 (같은 버전 안의 선택 필드).
    expect(
      parseShareLink(rawLink({ k: 'p', t: [[ID[0]]], m: [[0, 1, '줄\n바꿈']], z: 1 })).ok,
    ).toBe(true)
  })

  it('곡이 너무 많다 · 링크가 너무 길다 · 작은 링크가 엄청나게 풀린다(압축 폭탄)', () => {
    const tooMany = Array.from({ length: MAX_SHARE_LINK_TRACKS + 1 }, () => [ID[0]])
    expect(parseShareLink(rawLink({ k: 'p', t: tooMany }))).toEqual({
      ok: false,
      problem: 'too-many',
    })
    expect(parseShareLink(`#share?v=1&d=${'A'.repeat(MAX_SHARE_DATA_LENGTH + 1)}`)).toEqual({
      ok: false,
      problem: 'too-long',
    })
    // 0 으로 가득 찬 3 MB → 약 3 KB. 끝까지 풀지 않고 멈춘다.
    const bomb = deflateSync(new Uint8Array(3 * 1024 * 1024), { level: 9 })
    expect(parseShareLink(`#share?v=1&d=${base64url(bomb)}`)).toEqual({
      ok: false,
      problem: 'too-long',
    })
  })

  it('모든 거절 이유에 받는 사람이 할 일을 말하는 안내가 있다', () => {
    for (const message of Object.values(SHARE_LINK_PROBLEM_MESSAGE)) {
      expect(message.length).toBeGreaterThan(5)
    }
  })
})

describe('D. 상한은 라이브러리 · Moments 의 입력 상한과 같다', () => {
  it('이름 60 · 곡 이름 100 · 메모 500', () => {
    expect(MAX_SHARE_NAME_LENGTH).toBe(MAX_PLAYLIST_NAME_LENGTH)
    expect(MAX_SHARE_TITLE_LENGTH).toBe(MAX_TRACK_TITLE_LENGTH)
    expect(MAX_SHARE_NOTE_LENGTH).toBe(MAX_MOMENT_NOTE_LENGTH)
  })
})
