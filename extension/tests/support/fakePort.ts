import { vi } from 'vitest'

import { PortError, type TabInfo, type TabsPort } from '@/background/tabsPort'
import { ok, type PageSnapshot } from '@/shared/messages'

export const ID = 'dQw4w9WgXcQ'
export const OTHER_ID = 'aaaaaaaaaaa'
export const WATCH_URL = `https://www.youtube.com/watch?v=${ID}`

export function snapshot(overrides: Partial<PageSnapshot> = {}): PageSnapshot {
  return {
    href: WATCH_URL,
    watch: { videoId: ID, heading: '  Heading Title ' },
    ...overrides,
  }
}

/** 메인 세계의 플레이어 — 기본은 주소의 영상을 띄운 플레이어 하나. */
export const PLAYERS = [{ videoId: ID, title: 'Player Title' }]

/**
 * 가짜 탭. `contentInstalled` 가 거짓이면 첫 질의가 "수신자 없음" 이고, 주입하면
 * 참이 된다 — 실제 Chrome 의 순서를 흉내 낸다.
 */
export function fakePort(options: {
  tab?: TabInfo | null
  contentInstalled?: boolean
  reply?: unknown
  injectError?: PortError
  sendError?: PortError
  players?: unknown
  playersError?: PortError
}) {
  const state = { contentInstalled: options.contentInstalled ?? true }
  const tab =
    options.tab === undefined
      ? { id: 1, url: WATCH_URL, title: 'Tab Title - YouTube' }
      : options.tab
  const port = {
    getTab: vi.fn<TabsPort['getTab']>(async () => tab),
    sendToContent: vi.fn<TabsPort['sendToContent']>(async () => {
      if (options.sendError) throw options.sendError
      if (!state.contentInstalled)
        throw new PortError('no-receiver', 'Receiving end does not exist.')
      return options.reply ?? ok(snapshot())
    }),
    injectContent: vi.fn<TabsPort['injectContent']>(async () => {
      if (options.injectError) throw options.injectError
      state.contentInstalled = true
    }),
    readPlayers: vi.fn<TabsPort['readPlayers']>(async () => {
      if (options.playersError) throw options.playersError
      return options.players === undefined ? PLAYERS : options.players
    }),
  } satisfies TabsPort
  return { port, state }
}
