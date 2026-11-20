/**
 * ADR 0041 — 공유 카드 이미지: 무엇을 어떤 틀로 그릴지 (순수 함수). 실제 그리기(캔버스)는 실제 Chrome 확인에서 본다.
 */
import { describe, expect, it } from 'vitest'

import {
  artworkPlacement,
  buildShareCard,
  fitLine,
  formatAt,
  graphemes,
  receiptHeight,
  receiptRowsThatFit,
  SHARE_CARD_MAX_HEIGHT,
  shareCardFileName,
  tidyTitle,
  wrapLines,
  type Measure,
} from '@/features/backup/shareCard'
import type { ShareLinkContent } from '@/features/backup/shareLink'
import { shareCardArtKeys } from '@/features/backup/useShareCard'
import type { Playlist } from '@/shared/types'
import { DEFAULT_ARTWORK_DISPLAY } from '@/shared/types/artwork'

/** 글자 하나 = 10px (한글 · 영문 같게). */
const measure: Measure = (text) => graphemes(text).length * 10

const NOW = new Date(2026, 10, 20, 21, 42)

function playlist(count: number, moments: ShareLinkContent['moments'] = []): ShareLinkContent {
  return {
    kind: 'playlist',
    name: '여름 밤',
    tracks: Array.from({ length: count }, (_, i) => ({
      videoId: `v${String(i).padStart(10, '0')}`,
      title: `곡 ${String(i + 1)}`,
    })),
    moments,
  }
}

describe('A. 글자', () => {
  it('카드에서만 꼬리를 뗀다 — Official · MV · Audio · Lyrics · 가사, 다른 괄호는 그대로', () => {
    expect(tidyTitle('아이유 - 밤편지 (Through the Night) MV')).toBe(
      '아이유 - 밤편지 (Through the Night)',
    )
    expect(tidyTitle('Lauv - Paris in the Rain [Official Audio]')).toBe('Lauv - Paris in the Rain')
    expect(tidyTitle('NewJeans (뉴진스) Ditto Official MV')).toBe('NewJeans (뉴진스) Ditto')
    expect(tidyTitle('Coldplay - Yellow (Official Video)')).toBe('Coldplay - Yellow')
    expect(tidyTitle('곡 (가사)')).toBe('곡')
    expect(tidyTitle('Song (Lyric Video)')).toBe('Song')
    expect(tidyTitle('Crush - 잊어버리지마 (Feat. 태연)')).toBe('Crush - 잊어버리지마 (Feat. 태연)')
    expect(tidyTitle('백예린 - Square (2017)')).toBe('백예린 - Square (2017)')
    // 다 떼면 빈 글이 되면 원래 이름.
    expect(tidyTitle('[MV]')).toBe('[MV]')
  })

  it('시점 표기', () => {
    expect(formatAt(0)).toBe('0:00')
    expect(formatAt(83)).toBe('1:23')
    expect(formatAt(3723)).toBe('1:02:03')
  })

  it('한 줄 맞추기 — 넘치면 그래핌 단위로 줄이고 "…"', () => {
    expect(fitLine('짧은 글', 100, measure)).toBe('짧은 글')
    expect(fitLine('가나다라마바사아자차', 60, measure)).toBe('가나다라마…')
    // 이모지(결합 문자)를 반으로 자르지 않는다.
    const family = '👨‍👩‍👧'
    expect(graphemes(`${family}${family}${family}`)).toHaveLength(3)
    expect(fitLine(`${family}${family}${family}`, 25, measure)).toBe(`${family}…`)
  })

  it('여러 줄 — 낱말 안에서 끊지 않고, 너무 긴 낱말만 끊고, 넘치면 마지막 줄에 "…"', () => {
    expect(wrapLines('여름 밤 플레이리스트', 70, 2, measure)).toEqual(['여름 밤', '플레이리스트'])
    expect(wrapLines('가나다라마바사아자차카', 50, 3, measure)).toEqual([
      '가나다라마',
      '바사아자차',
      '카',
    ])
    const lines = wrapLines('하나 둘 셋 넷 다섯 여섯 일곱', 50, 2, measure)
    expect(lines).toHaveLength(2)
    expect(lines[1]?.endsWith('…')).toBe(true)
  })
})

describe('B. 틀 고르기', () => {
  it('목록 10곡까지 — Kawaii 는 J카드 1080×1350, Mono 는 LP 1080×1080, SIDE A/B 로 나눈다', () => {
    const kawaii = buildShareCard(playlist(10), 'kawaii', NOW)
    expect(kawaii.template).toBe('jcard')
    expect([kawaii.width, kawaii.height]).toEqual([1080, 1350])
    expect(kawaii.sides.map((side) => side.map((row) => row.no))).toEqual([
      ['A1', 'A2', 'A3', 'A4', 'A5'],
      ['B1', 'B2', 'B3', 'B4', 'B5'],
    ])
    const mono = buildShareCard(playlist(3), 'mono', NOW)
    expect(mono.template).toBe('lp')
    expect([mono.width, mono.height]).toEqual([1080, 1080])
    expect(mono.sides.map((side) => side.length)).toEqual([2, 1])
    expect(buildShareCard(playlist(1), 'mono', NOW).sides).toHaveLength(1)
  })

  it('목록 11곡부터는 두 테마 모두 영수증 — 곡 번호 01 부터', () => {
    const card = buildShareCard(playlist(11), 'mono', NOW)
    expect(card.template).toBe('receipt')
    expect(card.height).toBeNull()
    expect(card.rows.map((row) => row.no).slice(0, 2)).toEqual(['01', '02'])
    expect(buildShareCard(playlist(50), 'kawaii', NOW).template).toBe('receipt')
  })

  it('곡 하나 · Moment 는 싱글 — 높이는 그릴 때, Moments 는 시점 순 · 메모 포함 (ADR 0043)', () => {
    const track = buildShareCard(
      {
        kind: 'track',
        name: '',
        tracks: [{ videoId: 'aaaaaaaaaaa', title: '곡 (Official Video)' }],
        moments: [
          { videoId: 'aaaaaaaaaaa', atSeconds: 200, note: '둘째' },
          { videoId: 'aaaaaaaaaaa', atSeconds: 5, note: '' },
        ],
      },
      'kawaii',
      NOW,
    )
    expect([track.template, track.height, track.heading]).toEqual(['single', null, '곡'])
    expect(track.moments).toEqual([
      { at: '0:05', note: '' },
      { at: '3:20', note: '둘째' },
    ])

    const moment = buildShareCard(
      {
        kind: 'moment',
        name: '',
        tracks: [{ videoId: 'aaaaaaaaaaa', title: '' }],
        moments: [{ videoId: 'aaaaaaaaaaa', atSeconds: 83, note: '여기' }],
      },
      'mono',
      NOW,
    )
    expect([moment.template, moment.height]).toEqual(['single', null])
    // 곡 이름을 모르면 기본 이름.
    expect(moment.heading).toBe('YouTube · aaaaaaaaaaa')
    expect(moment.moments).toEqual([{ at: '1:23', note: '여기' }])
  })

  it('곡 줄의 Moment 는 그 곡의 첫 시점 · 날짜 · 시각 · 카탈로그 번호', () => {
    const card = buildShareCard(
      playlist(2, [
        { videoId: 'v0000000001', atSeconds: 125, note: '' },
        { videoId: 'v0000000001', atSeconds: 30, note: '' },
      ]),
      'kawaii',
      NOW,
    )
    expect(card.sides.flat().map((row) => row.moment)).toEqual([null, '0:30'])
    expect(card.momentCount).toBe(2)
    expect([card.date, card.time, card.catalog]).toEqual(['2026.11.20', '21:42', '39P-1120'])
  })

  it('목록 이름이 비면 "공유한 목록"', () => {
    expect(buildShareCard({ ...playlist(2), name: '  ' }, 'kawaii', NOW).heading).toBe(
      '공유한 목록',
    )
  })
})

describe('C. 영수증 높이 — 최대 3,240, 넘치면 "+N곡 더"', () => {
  it('10곡은 다 들어가고, 100곡은 상한 안에서 줄인다', () => {
    expect(receiptRowsThatFit(10, false, 1)).toBe(10)
    const rows = receiptRowsThatFit(100, true, 2)
    expect(rows).toBeLessThan(100)
    expect(rows).toBeGreaterThan(30)
    expect(receiptHeight({ rows, more: true, moments: true, nameLines: 2 })).toBeLessThanOrEqual(
      SHARE_CARD_MAX_HEIGHT,
    )
    expect(
      receiptHeight({ rows: rows + 1, more: true, moments: true, nameLines: 2 }),
    ).toBeGreaterThan(SHARE_CARD_MAX_HEIGHT)
  })

  it('곡이 늘면 높이가 곡당 56px 씩 는다', () => {
    const a = receiptHeight({ rows: 11, more: false, moments: false, nameLines: 1 })
    const b = receiptHeight({ rows: 12, more: false, moments: false, nameLines: 1 })
    expect(b - a).toBe(56)
  })
})

describe('E. 앨범아트 (ADR 0042)', () => {
  const ART = { assetId: 'a'.repeat(64), display: DEFAULT_ARTWORK_DISPLAY }

  it('모델은 넘긴 그림을 그대로 담는다 — 없으면 null (39page 기본 그림)', () => {
    expect(buildShareCard(playlist(3), 'kawaii', NOW).art).toBeNull()
    expect(buildShareCard(playlist(3), 'kawaii', NOW, ART).art).toEqual(ART)
    expect(buildShareCard(playlist(30), 'mono', NOW, ART).art).toEqual(ART)
  })

  it('맞춤은 앱(CSS)과 같다 — cover 는 짧은 변을 칸에 맞춰 가운데, contain 은 긴 변을 맞춘다', () => {
    const cover = { ...DEFAULT_ARTWORK_DISPLAY, fit: 'cover' as const }
    expect(artworkPlacement(100, 200, 100, cover)).toEqual({
      x: -50,
      y: 0,
      width: 200,
      height: 100,
    })
    const contain = { ...DEFAULT_ARTWORK_DISPLAY, fit: 'contain' as const }
    expect(artworkPlacement(100, 200, 100, contain)).toEqual({
      x: 0,
      y: 25,
      width: 100,
      height: 50,
    })
  })

  it('위치는 넘친 쪽의 몇 % 를 보일지, 확대는 그 점을 중심으로', () => {
    const left = { ...DEFAULT_ARTWORK_DISPLAY, positionX: 0 }
    expect(artworkPlacement(100, 200, 100, left)).toEqual({ x: 0, y: 0, width: 200, height: 100 })
    const right = { ...DEFAULT_ARTWORK_DISPLAY, positionX: 100 }
    expect(artworkPlacement(100, 200, 100, right).x).toBe(-100)
    const zoom = { ...DEFAULT_ARTWORK_DISPLAY, zoom: 2 }
    // 가운데(50, 50)를 중심으로 두 배 — 정사각형 그림이면 (-50, -50) 에서 200 × 200.
    expect(artworkPlacement(100, 100, 100, zoom)).toEqual({
      x: -50,
      y: -50,
      width: 200,
      height: 200,
    })
  })

  it('영수증은 그림 자리(240 + 30)만큼 길어지고, 상한 안에 드는 곡 수가 그만큼 준다', () => {
    const without = receiptHeight({ rows: 12, more: false, moments: false, nameLines: 1 })
    const withArt = receiptHeight({
      rows: 12,
      more: false,
      moments: false,
      nameLines: 1,
      art: true,
    })
    expect(withArt - without).toBe(270)
    expect(receiptRowsThatFit(100, false, 1, true)).toBeLessThan(receiptRowsThatFit(100, false, 1))
  })

  it('그림을 찾아볼 트랙 — 목록은 곡 순서, 곡은 그 곡, Moment 는 같은 영상의 트랙(앞 목록 먼저)', () => {
    const list = (id: string, videoIds: string[]): Playlist => ({
      id,
      name: id,
      tracks: videoIds.map((videoId, index) => ({
        id: `${id}${String(index)}`,
        source: 'youtube' as const,
        videoId,
        title: '',
      })),
    })
    const a = list('a', ['v1', 'v2'])
    const b = list('b', ['v2'])
    expect(shareCardArtKeys({ kind: 'playlist', playlist: a }, [])).toEqual([
      { playlistId: 'a', trackId: 'a0' },
      { playlistId: 'a', trackId: 'a1' },
    ])
    const track = a.tracks[1]
    if (track === undefined) throw new Error('track')
    expect(shareCardArtKeys({ kind: 'track', playlist: a, track }, [])).toEqual([
      { playlistId: 'a', trackId: 'a1' },
    ])
    const moment = {
      id: 'm',
      source: 'youtube' as const,
      videoId: 'v2',
      atSeconds: 3,
      note: '',
      title: '',
      createdAt: '',
      updatedAt: '',
    }
    expect(shareCardArtKeys({ kind: 'moment', moment, title: '' }, [b, null, a])).toEqual([
      { playlistId: 'b', trackId: 'b0' },
      { playlistId: 'a', trackId: 'a1' },
    ])
    expect(shareCardArtKeys(null, [a])).toEqual([])
  })
})

describe('D. 파일 이름', () => {
  it('쓸 수 없는 글자를 걷어내고 .39page.png', () => {
    expect(shareCardFileName('여름 밤')).toBe('여름 밤.39page.png')
    expect(shareCardFileName('a/b:c*?')).toBe('a_b_c__.39page.png')
    expect(shareCardFileName('  ')).toBe('39page.39page.png')
  })
})
