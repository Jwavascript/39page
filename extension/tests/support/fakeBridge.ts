import { vi } from 'vitest'

import type { PopupBridge, TabEvent } from '@/popup/bridge'
import type { CollectOpened, PageInspection, Result } from '@/shared/messages'

/** 응답을 테스트가 손으로 풀어 주는 가짜 bridge. */
export function fakeBridge(initialTabId: number | null = 1) {
  let activeTab = initialTabId
  const listeners: ((event: TabEvent) => void)[] = []
  const pending: { tabId: number; resolve: (r: Result<PageInspection>) => void }[] = []
  const collects: {
    tabId: number
    videoId: string
    resolve: (r: Result<CollectOpened>) => void
  }[] = []

  const bridge = {
    activeTabId: vi.fn<PopupBridge['activeTabId']>(async () => activeTab),
    inspect: vi.fn<PopupBridge['inspect']>(
      (tabId: number) =>
        new Promise<Result<PageInspection>>((resolve) => {
          pending.push({ tabId, resolve })
        }),
    ),
    collect: vi.fn<PopupBridge['collect']>(
      (tabId: number, videoId: string) =>
        new Promise<Result<CollectOpened>>((resolve) => {
          collects.push({ tabId, videoId, resolve })
        }),
    ),
    subscribe: vi.fn<PopupBridge['subscribe']>((listener: (event: TabEvent) => void) => {
      listeners.push(listener)
      return () => {
        const index = listeners.indexOf(listener)
        if (index !== -1) listeners.splice(index, 1)
      }
    }),
  } satisfies PopupBridge

  return {
    bridge,
    pending,
    collects,
    listeners,
    setActiveTab(id: number | null) {
      activeTab = id
    },
    emit(event: TabEvent) {
      // 복사본을 돈다 — 리스너가 도중에 구독을 끊을 수 있다.
      for (const listener of listeners.slice()) listener(event)
    },
  }
}
