import { afterEach, describe, expect, it } from 'vitest'

import { readPlayersInPage } from '@/background/pageFunctions'

const ID = 'dQw4w9WgXcQ'

/** executeScript 처럼 함수 **문자열**에서 다시 만든다 — 바깥 식별자를 참조하면 여기서 깨진다. */
function rebuilt(): typeof readPlayersInPage {
  return new Function(`return (${readPlayersInPage.toString()})`)() as typeof readPlayersInPage
}

function player(id: string, data: unknown) {
  const element = document.createElement('div')
  element.id = id
  Object.assign(element, { getVideoData: () => data })
  document.body.append(element)
  return element
}

describe('readPlayersInPage — 메인 세계에서 실행하는 함수', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('자기 완결이다 — 문자열에서 다시 만들어도 같은 결과', () => {
    player('movie_player', { video_id: ID, title: 'Song' })
    expect(rebuilt()()).toEqual([{ videoId: ID, title: 'Song' }])
    expect(rebuilt()()).toEqual(readPlayersInPage())
  })

  it('시청 · Shorts 플레이어를 모두 읽고, ID 가 없는 숨은 플레이어는 건너뛴다', () => {
    player('shorts-player', { video_id: ID, title: 'Short' })
    player('movie_player', { video_id: '', title: '' })
    expect(rebuilt()()).toEqual([{ videoId: ID, title: 'Short' }])
  })

  it('페이지가 이상한 값을 줘도 문자열·null 만 돌려준다', () => {
    player('movie_player', { video_id: ID, title: { toString: () => 'x' } })
    player('shorts-player', 'not-an-object')
    expect(rebuilt()()).toEqual([{ videoId: ID, title: null }])
  })

  it('getVideoData 가 없거나 던지면 건너뛴다', () => {
    document.body.append(Object.assign(document.createElement('div'), { id: 'movie_player' }))
    const throwing = document.createElement('div')
    throwing.id = 'shorts-player'
    Object.assign(throwing, {
      getVideoData: () => {
        throw new Error('boom')
      },
    })
    document.body.append(throwing)
    expect(rebuilt()()).toEqual([])
  })

  it('긴 제목은 자르고, 지나치게 긴 ID 는 버린다', () => {
    player('movie_player', { video_id: ID, title: 'x'.repeat(5000) })
    player('shorts-player', { video_id: 'y'.repeat(65), title: 'z' })
    const [first, ...rest] = rebuilt()()
    expect(first?.title).toHaveLength(2000)
    expect(rest).toEqual([])
  })
})
