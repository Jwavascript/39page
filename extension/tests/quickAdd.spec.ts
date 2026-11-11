/**
 * `useQuickAdd` 를 화면 없이 — 버튼이 비활성화되는 것과 별개로 composable 자체가
 * 한 번에 하나만 보낸다 (두 겹의 방어 중 안쪽).
 */
import { describe, expect, it } from 'vitest'
import { ref } from 'vue'

import type { PopupView } from '@/popup/useActiveVideo'
import { useQuickAdd } from '@/popup/useQuickAdd'
import { ok } from '@/shared/messages'

import { fakeBridge } from './support/fakeBridge'

const VIDEO: PopupView = {
  phase: 'video',
  videoId: 'dQw4w9WgXcQ',
  pageKind: 'watch',
  title: 'Song',
}

describe('useQuickAdd', () => {
  it('기다리는 동안 다시 불러도 요청은 하나다', async () => {
    const fake = fakeBridge()
    const quick = useQuickAdd(fake.bridge, {
      view: ref(VIDEO),
      currentTabId: () => 4,
      refresh: async () => {},
    })

    const first = quick.add()
    const second = quick.add()
    expect(fake.bridge.collect).toHaveBeenCalledTimes(1)
    expect(quick.state.value).toEqual({ kind: 'busy' })

    fake.collects[0]!.resolve(ok({ status: 'opened', tabId: 9 }))
    await Promise.all([first, second])
    expect(quick.state.value).toEqual({ kind: 'done', status: 'opened' })
  })

  it('영상이 아니면 보내지 않고, 탭을 모르면 no-tab', async () => {
    const fake = fakeBridge()
    const unsupported = useQuickAdd(fake.bridge, {
      view: ref<PopupView>({ phase: 'unsupported', reason: 'not-youtube' }),
      currentTabId: () => 4,
      refresh: async () => {},
    })
    await unsupported.add()
    expect(fake.bridge.collect).not.toHaveBeenCalled()

    const noTab = useQuickAdd(fake.bridge, {
      view: ref(VIDEO),
      currentTabId: () => null,
      refresh: async () => {},
    })
    await noTab.add()
    expect(noTab.state.value).toEqual({ kind: 'error', code: 'no-tab' })
  })
})
