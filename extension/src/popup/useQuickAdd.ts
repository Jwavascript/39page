/**
 * Quick Add 버튼의 상태 (M10-3).
 *
 * - 한 번에 하나 — 응답을 기다리는 동안 다시 눌러도 요청이 하나다.
 * - 보낸 것은 **지금 팝업이 보여 주는 영상**의 ID 다. Background 가 탭을 다시 확인해
 *   다르면 `page-changed` 로 거절하고, 이 composable 은 팝업을 새로 고친다.
 * - 저장은 하지 않는다 — 39page 수집 화면을 열 뿐이다.
 */
import { ref, watch, type Ref } from 'vue'

import type { CollectOpened, ErrorCode } from '@/shared/messages'

import type { PopupBridge } from './bridge'
import type { PopupView } from './useActiveVideo'

export type QuickAddState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'busy' }
  | { readonly kind: 'done'; readonly status: CollectOpened['status'] }
  | { readonly kind: 'error'; readonly code: ErrorCode }

export function useQuickAdd(
  bridge: PopupBridge,
  context: {
    readonly view: Ref<PopupView>
    readonly currentTabId: () => number | null
    readonly refresh: () => Promise<void>
  },
): { state: Ref<QuickAddState>; add: () => Promise<void> } {
  const state = ref<QuickAddState>({ kind: 'idle' })

  // 다른 영상으로 바뀌면 앞 영상의 결과를 지운다.
  watch(
    () => (context.view.value.phase === 'video' ? context.view.value.videoId : null),
    () => {
      if (state.value.kind !== 'busy') state.value = { kind: 'idle' }
    },
  )

  async function add(): Promise<void> {
    if (state.value.kind === 'busy') return
    const view = context.view.value
    const tabId = context.currentTabId()
    if (view.phase !== 'video') return
    if (tabId === null) {
      state.value = { kind: 'error', code: 'no-tab' }
      return
    }

    state.value = { kind: 'busy' }
    const result = await bridge.collect(tabId, view.videoId)
    if (result.ok) {
      state.value = { kind: 'done', status: result.data.status }
      return
    }

    state.value = { kind: 'error', code: result.error.code }
    if (result.error.code === 'page-changed') {
      // 지금 탭의 영상을 다시 보여 준다. 오류 안내는 남긴다.
      const shown = state.value
      await context.refresh()
      state.value = shown
    }
  }

  return { state, add }
}
