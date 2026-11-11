import { afterEach, describe, expect, it } from 'vitest'

import { capturePlaybackInPage, readPlayersInPage } from '@/background/pageFunctions'

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

describe('capturePlaybackInPage — 한 번에 읽는 재생 상태 (M10-4)', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  function watchPlayer(methods: Record<string, unknown>, classes: string[] = []) {
    const element = document.createElement('div')
    element.id = 'movie_player'
    element.classList.add(...classes)
    Object.assign(element, methods)
    document.body.append(element)
    return element
  }

  const rebuiltCapture = () =>
    new Function(`return (${capturePlaybackInPage.toString()})`)() as typeof capturePlaybackInPage

  it('자기 완결이다 — ID · 제목 · 시점 · 상태 · 길이를 같은 플레이어에서 읽는다', () => {
    watchPlayer({
      getVideoData: () => ({ video_id: ID, title: 'Song', isLive: false }),
      getCurrentTime: () => 83.6,
      getPlayerState: () => 1,
      getDuration: () => 212,
    })
    expect(rebuiltCapture()()).toEqual({
      videoId: ID,
      title: 'Song',
      currentTime: 83.6,
      state: 1,
      duration: 212,
      adShowing: false,
      live: false,
    })
  })

  it('NaN · Infinity 는 null — 모름을 0 으로 바꾸지 않는다', () => {
    watchPlayer({
      getVideoData: () => ({ video_id: ID, title: 'Song' }),
      getCurrentTime: () => Number.NaN,
      getPlayerState: () => 1,
      getDuration: () => Number.POSITIVE_INFINITY,
    })
    expect(rebuiltCapture()()).toMatchObject({ currentTime: null, duration: null })
  })

  it('광고 · 라이브 표시를 읽는다', () => {
    const element = watchPlayer(
      {
        getVideoData: () => ({ video_id: ID, title: 'Song', isLive: true }),
        getCurrentTime: () => 3,
        getPlayerState: () => 1,
        getDuration: () => 0,
      },
      ['ad-showing'],
    )
    expect(rebuiltCapture()()).toMatchObject({ adShowing: true, live: true })
    element.classList.remove('ad-showing')
    element.classList.add('ad-interrupting')
    expect(rebuiltCapture()()).toMatchObject({ adShowing: true })
  })

  it('Shorts 플레이어는 읽지 않는다 · 플레이어가 없으면 null · 던지면 null', () => {
    player('shorts-player', { video_id: ID, title: 'Short' })
    expect(rebuiltCapture()()).toBeNull()
    watchPlayer({
      getVideoData: () => {
        throw new Error('boom')
      },
    })
    expect(rebuiltCapture()()).toBeNull()
  })

  it('메서드가 없으면 그 값은 null', () => {
    watchPlayer({ getVideoData: () => ({ video_id: ID }) })
    expect(rebuiltCapture()()).toMatchObject({
      videoId: ID,
      title: null,
      currentTime: null,
      state: null,
    })
  })
})
