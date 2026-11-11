import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { cleanTitle, MAX_TITLE_LENGTH } from '@/shared/title'

describe('제목 정리 (EXTENSION_DESIGN.md §3-2)', () => {
  it.each([
    ['Song Title - YouTube', 'Song Title'],
    ['(3) Song Title - YouTube', 'Song Title'],
    ['(99+) Song Title - YouTube', 'Song Title'],
    ['  Song \n\t Title  ', 'Song Title'],
    ['Song - YouTube - YouTube', 'Song - YouTube'],
    ['Live - YouTube Music', 'Live - YouTube Music'],
    ['(Official Video) Song', '(Official Video) Song'],
    ['<img src=x onerror=alert(1)>', '<img src=x onerror=alert(1)>'],
    ['노래 제목 - YouTube', '노래 제목'],
  ])('%j → %j', (raw, expected) => {
    expect(cleanTitle(raw)).toBe(expected)
  })

  it.each([
    ['비어 있음', ''],
    ['공백뿐', '   '],
    ['사이트 이름뿐 (로드 중)', 'YouTube'],
    ['알림 수와 사이트 이름뿐', '(2) YouTube'],
    ['문자열이 아님', 42],
    ['null', null],
    ['undefined', undefined],
  ])('없음 — %s', (_label, raw) => {
    expect(cleanTitle(raw)).toBeNull()
  })

  it('제어 문자를 지우고 양방향 재정의 문자를 없앤다', () => {
    expect(cleanTitle('A\u0000B\u0007C')).toBe('A B C')
    expect(cleanTitle('safe\u202egnp.exe')).toBe('safegnp.exe')
    expect(cleanTitle('\u2066abc\u2069')).toBe('abc')
  })

  it('일반 오른쪽→왼쪽 글자는 그대로 둔다', () => {
    expect(cleanTitle('أغنية - YouTube')).toBe('أغنية')
  })

  it(`${MAX_TITLE_LENGTH}자로 자르고 서로게이트 쌍을 가르지 않는다`, () => {
    expect(cleanTitle('a'.repeat(250))).toHaveLength(MAX_TITLE_LENGTH)

    const emojiAtEdge = `${'a'.repeat(MAX_TITLE_LENGTH - 1)}🎵tail`
    const cut = cleanTitle(emojiAtEdge)
    expect(cut).toBe('a'.repeat(MAX_TITLE_LENGTH - 1))
    expect(cut?.length).toBeLessThanOrEqual(MAX_TITLE_LENGTH)
  })

  it('상한이 웹앱 MAX_TRACK_TITLE_LENGTH 와 같다 (호환성)', () => {
    // 테스트는 extension/ 에서 돈다 (vitest root). 웹앱 파일은 한 단계 위.
    const source = readFileSync(resolve(process.cwd(), '../src/stores/library.ts'), 'utf8')
    const match = /export const MAX_TRACK_TITLE_LENGTH = (\d+)/.exec(source)
    expect(match).not.toBeNull()
    expect(Number(match?.[1])).toBe(MAX_TITLE_LENGTH)
  })
})
