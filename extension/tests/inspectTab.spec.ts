import { describe, expect, it } from 'vitest'

import { inspectTab, pickTitle, readPlayers, readSnapshot } from '@/background/inspectTab'
import { PortError } from '@/background/tabsPort'
import { fail, ok } from '@/shared/messages'

import { fakePort, ID, OTHER_ID, snapshot } from './support/fakePort'

describe('pickTitle — M10-2 실측으로 정한 규칙 (§3-2)', () => {
  it('주소의 영상을 띄운 플레이어의 제목을 먼저 쓴다', () => {
    expect(pickTitle(ID, [{ videoId: ID, title: 'Player' }], snapshot())).toEqual({
      text: 'Player',
      source: 'player',
    })
  })

  it('숨은 플레이어·이전 영상의 플레이어는 건너뛴다 (Shorts 의 숨은 #movie_player)', () => {
    const players = [
      { videoId: OTHER_ID, title: 'Old' },
      { videoId: ID, title: 'Current' },
    ]
    expect(pickTitle(ID, players, null)).toEqual({ text: 'Current', source: 'player' })
  })

  it('플레이어가 아직 이전 영상이면 제목 줄 — flexy 가 주소의 영상일 때만', () => {
    expect(pickTitle(ID, [{ videoId: OTHER_ID, title: 'Old' }], snapshot())).toEqual({
      text: 'Heading Title',
      source: 'heading',
    })
  })

  it('SPA 이동 직후(플레이어·flexy 모두 이전 영상)에는 짐작하지 않는다 — null', () => {
    const stale = snapshot({ watch: { videoId: OTHER_ID, heading: 'Old Heading' } })
    expect(pickTitle(ID, [{ videoId: OTHER_ID, title: 'Old' }], stale)).toBeNull()
  })

  it('플레이어 제목이 비면 제목 줄로 내려간다', () => {
    expect(pickTitle(ID, [{ videoId: ID, title: '  ' }], snapshot())?.source).toBe('heading')
    expect(pickTitle(ID, [{ videoId: ID, title: null }], snapshot())?.source).toBe('heading')
  })

  it('둘 다 읽지 못하면 null', () => {
    expect(pickTitle(ID, null, null)).toBeNull()
    expect(pickTitle(ID, [], snapshot({ watch: { videoId: null, heading: null } }))).toBeNull()
  })

  it('플레이어 제목도 정리한다', () => {
    expect(pickTitle(ID, [{ videoId: ID, title: ' A\u0000B ' }], null)?.text).toBe('A B')
  })
})

describe('readPlayers', () => {
  it('검증된 후보만 돌려준다', async () => {
    expect(await readPlayers(fakePort({}).port, 1)).toEqual([
      { videoId: ID, title: 'Player Title' },
    ])
    expect(await readPlayers(fakePort({ players: [{ videoId: 3 }] }).port, 1)).toBeNull()
    expect(await readPlayers(fakePort({ players: 'x' }).port, 1)).toBeNull()
  })

  it('메인 세계 실행이 거부돼도 던지지 않는다', async () => {
    const { port } = fakePort({ playersError: new PortError('no-access', 'Cannot access') })
    expect(await readPlayers(port, 1)).toBeNull()
  })
})

describe('readSnapshot — 수신자 없음 → 주입 → 1회 재시도', () => {
  it('이미 있으면 주입하지 않는다', async () => {
    const { port } = fakePort({ contentInstalled: true })
    expect(await readSnapshot(port, 1)).toEqual(snapshot())
    expect(port.injectContent).not.toHaveBeenCalled()
    expect(port.sendToContent).toHaveBeenCalledTimes(1)
  })

  it('수신자가 없으면 한 번 주입하고 다시 묻는다', async () => {
    const { port } = fakePort({ contentInstalled: false })
    expect(await readSnapshot(port, 1)).toEqual(snapshot())
    expect(port.injectContent).toHaveBeenCalledTimes(1)
    expect(port.sendToContent).toHaveBeenCalledTimes(2)
  })

  it('주입이 실패하면 null — 던지지 않는다', async () => {
    const { port } = fakePort({
      contentInstalled: false,
      injectError: new PortError('no-access', 'Cannot access contents of the page'),
    })
    expect(await readSnapshot(port, 1)).toBeNull()
    expect(port.sendToContent).toHaveBeenCalledTimes(1)
  })

  it('수신자 없음이 아닌 실패(시간 초과)는 주입하지 않는다', async () => {
    const { port } = fakePort({ sendError: new PortError('timeout', 'slow') })
    expect(await readSnapshot(port, 1)).toBeNull()
    expect(port.injectContent).not.toHaveBeenCalled()
  })

  it('content 가 실패로 답하거나 모양이 틀리면 null', async () => {
    expect(await readSnapshot(fakePort({ reply: fail('internal', 'x') }).port, 1)).toBeNull()
    expect(await readSnapshot(fakePort({ reply: ok({ href: 1 }) }).port, 1)).toBeNull()
    expect(await readSnapshot(fakePort({ reply: 'garbage' }).port, 1)).toBeNull()
  })
})

describe('inspectTab', () => {
  it('영상 페이지 → videoId · 종류 · 플레이어 제목', async () => {
    expect(await inspectTab(fakePort({}).port, 1)).toEqual(
      ok({
        status: 'video',
        videoId: ID,
        pageKind: 'watch',
        title: 'Player Title',
        titleSource: 'player',
      }),
    )
  })

  it('탭이 없으면 no-tab 실패', async () => {
    expect(await inspectTab(fakePort({ tab: null }).port, 9)).toEqual(
      fail('no-tab', '탭을 찾을 수 없다'),
    )
  })

  it('주소가 보이지 않으면(권한 없음) no-access — 페이지에 손대지 않는다', async () => {
    const { port } = fakePort({ tab: { id: 1, url: undefined } })
    expect(await inspectTab(port, 1)).toEqual(ok({ status: 'unsupported', reason: 'no-access' }))
    expect(port.sendToContent).not.toHaveBeenCalled()
    expect(port.readPlayers).not.toHaveBeenCalled()
  })

  it('지원하지 않는 페이지는 정상 결과이고 아무것도 주입·실행하지 않는다', async () => {
    const { port } = fakePort({ tab: { id: 1, url: 'https://example.com/' } })
    expect(await inspectTab(port, 1)).toEqual(ok({ status: 'unsupported', reason: 'not-youtube' }))
    expect(port.sendToContent).not.toHaveBeenCalled()
    expect(port.injectContent).not.toHaveBeenCalled()
    expect(port.readPlayers).not.toHaveBeenCalled()
  })

  it('페이지를 전혀 읽지 못해도 영상 정보는 주고 제목만 비운다', async () => {
    const { port } = fakePort({
      contentInstalled: false,
      injectError: new PortError('no-access', 'Missing host permission for the tab'),
      playersError: new PortError('no-access', 'Missing host permission for the tab'),
    })
    expect(await inspectTab(port, 1)).toEqual(
      ok({ status: 'video', videoId: ID, pageKind: 'watch', title: null, titleSource: null }),
    )
  })

  it('SPA 이동 직후 — 이전 영상의 제목을 새 ID 에 붙이지 않는다', async () => {
    const { port } = fakePort({
      players: [{ videoId: OTHER_ID, title: 'Old Video' }],
      reply: ok(snapshot({ watch: { videoId: OTHER_ID, heading: 'Old Video' } })),
    })
    expect(await inspectTab(port, 1)).toEqual(
      ok({ status: 'video', videoId: ID, pageKind: 'watch', title: null, titleSource: null }),
    )
  })
})
