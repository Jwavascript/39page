/**
 * "현재 Moment 저장" 버튼의 상태 (M10-4).
 *
 * - 한 번에 하나 — 응답을 기다리는 동안 다시 눌러도 요청이 하나다.
 * - 시점은 **누른 순간** Background 가 플레이어에서 읽어 고정한다. 이 composable 은
 *   시점을 만들지 않는다.
 * - 보낸 것은 지금 팝업이 보여 주는 영상의 ID 다. 다르면 `page-changed` 로 거절되고,
 *   팝업을 새로 고친다 (Quick Add 와 같다).
 * - 저장은 하지 않는다 — 39page 수집 화면에서 메모를 쓰고 저장한다.
 */
import { computed, ref, watch, type ComputedRef, type Ref } from 'vue'

import type { CaptureRefusal, ErrorCode, PageKind } from '@/shared/messages'

import type { PopupBridge } from './bridge'
import type { PopupView } from './useActiveVideo'

export type MomentCaptureState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'busy' }
  | { readonly kind: 'done'; readonly status: 'opened' | 'focused'; readonly atSeconds: number }
  | { readonly kind: 'refused'; readonly reason: CaptureRefusal }
  | { readonly kind: 'error'; readonly code: ErrorCode }

/** 페이지 종류만으로 미리 알 수 있는 거절 — 버튼을 끄고 이유를 보인다. */
export function unavailableReason(pageKind: PageKind): CaptureRefusal | null {
  if (pageKind === 'shorts') return 'shorts'
  if (pageKind === 'live') return 'live'
  if (pageKind === 'embed') return 'not-watch'
  return null
}

export function useMomentCapture(
  bridge: PopupBridge,
  context: {
    readonly view: Ref<PopupView>
    readonly currentTabId: () => number | null
    readonly refresh: () => Promise<void>
  },
): {
  state: Ref<MomentCaptureState>
  disabledReason: ComputedRef<CaptureRefusal | null>
  capture: () => Promise<void>
} {
  const state = ref<MomentCaptureState>({ kind: 'idle' })

  const disabledReason = computed(() =>
    context.view.value.phase === 'video' ? unavailableReason(context.view.value.pageKind) : null,
  )

  // 다른 영상으로 바뀌면 앞 영상의 결과를 지운다.
  watch(
    () => (context.view.value.phase === 'video' ? context.view.value.videoId : null),
    () => {
      if (state.value.kind !== 'busy') state.value = { kind: 'idle' }
    },
  )

  async function capture(): Promise<void> {
    if (state.value.kind === 'busy') return
    const view = context.view.value
    if (view.phase !== 'video' || disabledReason.value !== null) return
    const tabId = context.currentTabId()
    if (tabId === null) {
      state.value = { kind: 'error', code: 'no-tab' }
      return
    }

    state.value = { kind: 'busy' }
    const result = await bridge.captureMoment(tabId, view.videoId)
    if (result.ok) {
      state.value =
        result.data.status === 'refused'
          ? { kind: 'refused', reason: result.data.reason }
          : { kind: 'done', status: result.data.status, atSeconds: result.data.atSeconds }
      return
    }

    state.value = { kind: 'error', code: result.error.code }
    if (result.error.code === 'page-changed') {
      const shown = state.value
      await context.refresh()
      state.value = shown
    }
  }

  return { state, disabledReason, capture }
}
