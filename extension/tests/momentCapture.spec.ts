/**
 * `useMomentCapture` 를 화면 없이 (M10-4) — 버튼이 꺼지는 것과 별개로 composable 자체가
 * 한 번에 하나만 보내고, 쓸 수 없는 페이지에서는 보내지 않는다 (두 겹의 방어 중 안쪽).
 */
import { describe, expect, it } from 'vitest'
import { ref } from 'vue'

import type { PopupView } from '@/popup/useActiveVideo'
import { unavailableReason, useMomentCapture } from '@/popup/useMomentCapture'
import { ok } from '@/shared/messages'

import { fakeBridge } from './support/fakeBridge'

const VIDEO: PopupView = {
  phase: 'video',
  videoId: 'dQw4w9WgXcQ',
  pageKind: 'watch',
  title: 'Song',
}

describe('useMomentCapture', () => {
  it('기다리는 동안 다시 불러도 요청은 하나다', async () => {
    const fake = fakeBridge()
    const moment = useMomentCapture(fake.bridge, {
      view: ref(VIDEO),
      currentTabId: () => 4,
      refresh: async () => {},
    })

    const first = moment.capture()
    const second = moment.capture()
    expect(fake.bridge.captureMoment).toHaveBeenCalledTimes(1)
    expect(fake.bridge.captureMoment).toHaveBeenCalledWith(4, 'dQw4w9WgXcQ')
    expect(moment.state.value).toEqual({ kind: 'busy' })

    fake.captures[0]!.resolve(
      ok({ status: 'opened', tabId: 9, videoId: 'dQw4w9WgXcQ', atSeconds: 0 }),
    )
    await Promise.all([first, second])
    expect(moment.state.value).toEqual({ kind: 'done', status: 'opened', atSeconds: 0 })
  })

  it.each([
    ['shorts', 'shorts'],
    ['live', 'live'],
    ['embed', 'not-watch'],
    ['watch', null],
  ] as const)('%s 페이지 — 미리 아는 거절은 %s, 그때는 보내지 않는다', async (pageKind, reason) => {
    expect(unavailableReason(pageKind)).toBe(reason)
    const fake = fakeBridge()
    const moment = useMomentCapture(fake.bridge, {
      view: ref<PopupView>({ ...VIDEO, pageKind }),
      currentTabId: () => 4,
      refresh: async () => {},
    })
    expect(moment.disabledReason.value).toBe(reason)
    void moment.capture()
    expect(fake.bridge.captureMoment).toHaveBeenCalledTimes(reason === null ? 1 : 0)
  })

  it('영상이 아니면 보내지 않고, 탭을 모르면 no-tab', async () => {
    const fake = fakeBridge()
    const unsupported = useMomentCapture(fake.bridge, {
      view: ref<PopupView>({ phase: 'unsupported', reason: 'not-youtube' }),
      currentTabId: () => 4,
      refresh: async () => {},
    })
    await unsupported.capture()
    expect(fake.bridge.captureMoment).not.toHaveBeenCalled()

    const noTab = useMomentCapture(fake.bridge, {
      view: ref(VIDEO),
      currentTabId: () => null,
      refresh: async () => {},
    })
    await noTab.capture()
    expect(noTab.state.value).toEqual({ kind: 'error', code: 'no-tab' })
  })
})
