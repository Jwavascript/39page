/**
 * 팝업의 상태 — "지금 탭이 어떤 영상인가".
 *
 * - 열릴 때 한 번 묻고, 열려 있는 동안 **자기 탭**의 변경과 활성 탭 전환을 듣는다
 *   (`docs/architecture/EXTENSION_DESIGN.md` §3-1). 다른 탭의 변경은 무시한다.
 * - 이벤트는 짧게 묶어 한 번만 묻는다 — YouTube 는 이동 한 번에 url · title ·
 *   status 를 따로 알린다.
 * - 늦게 도착한 옛 응답은 버린다 (요청 번호).
 */
import { onMounted, onUnmounted, ref, type Ref } from 'vue'

import type {
  ErrorCode,
  PageKind,
  Result,
  PageInspection,
  UnsupportedReason,
} from '@/shared/messages'

import type { PopupBridge, TabEvent } from './bridge'

export type PopupView =
  | { readonly phase: 'loading' }
  | {
      readonly phase: 'video'
      readonly videoId: string
      readonly pageKind: PageKind
      readonly title: string | null
    }
  | { readonly phase: 'unsupported'; readonly reason: UnsupportedReason }
  | { readonly phase: 'error'; readonly code: ErrorCode }

export function toView(result: Result<PageInspection>): PopupView {
  if (!result.ok) return { phase: 'error', code: result.error.code }
  const data = result.data
  if (data.status === 'unsupported') return { phase: 'unsupported', reason: data.reason }
  return { phase: 'video', videoId: data.videoId, pageKind: data.pageKind, title: data.title }
}

export const EVENT_DEBOUNCE_MS = 150

/**
 * 제목을 아직 못 읽었을 때 다시 묻는 간격과 횟수.
 *
 * SPA 이동 직후에는 플레이어·제목 줄이 새 영상으로 바뀌기 전이라 제목이 비고,
 * 제목 줄이 바뀌는 순간에는 탭 이벤트가 오지 않는다 (M10-2 실측: 주소 이동 뒤
 * 약 3초). 한도를 둬 무한히 묻지 않는다.
 */
export const TITLE_RECHECK_MS = 1_500
export const TITLE_RECHECK_LIMIT = 2

export function useActiveVideo(
  bridge: PopupBridge,
  options: { readonly debounceMs?: number } = {},
): { view: Ref<PopupView>; retry: () => Promise<void> } {
  const debounceMs = options.debounceMs ?? EVENT_DEBOUNCE_MS
  const view = ref<PopupView>({ phase: 'loading' })

  let tabId: number | null = null
  let sequence = 0
  let timer: ReturnType<typeof setTimeout> | null = null
  let pendingReselect = false
  let unsubscribe: (() => void) | null = null
  let recheckTimer: ReturnType<typeof setTimeout> | null = null
  let recheckKey = ''
  let rechecks = 0

  /** 같은 탭·같은 영상에서 제목이 비어 있으면 몇 번만 다시 묻는다. */
  function scheduleTitleRecheck(): void {
    const current = view.value
    if (current.phase !== 'video' || current.title !== null) return

    const key = `${tabId}:${current.videoId}`
    if (key !== recheckKey) {
      recheckKey = key
      rechecks = 0
    }
    if (rechecks >= TITLE_RECHECK_LIMIT) return
    rechecks += 1

    if (recheckTimer !== null) clearTimeout(recheckTimer)
    recheckTimer = setTimeout(() => {
      recheckTimer = null
      void refresh(false)
    }, TITLE_RECHECK_MS)
  }

  async function refresh(reselectTab: boolean): Promise<void> {
    const ticket = ++sequence

    if (reselectTab || tabId === null) {
      let next: number | null
      try {
        next = await bridge.activeTabId()
      } catch {
        next = null
      }
      if (ticket !== sequence) return
      if (next === null) {
        view.value = { phase: 'error', code: 'no-tab' }
        return
      }
      tabId = next
    }

    const result = await bridge.inspect(tabId)
    if (ticket !== sequence) return
    view.value = toView(result)
    scheduleTitleRecheck()
  }

  function schedule(reselectTab: boolean): void {
    pendingReselect = pendingReselect || reselectTab
    if (timer !== null) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      const reselect = pendingReselect
      pendingReselect = false
      void refresh(reselect)
    }, debounceMs)
  }

  function onTabEvent(event: TabEvent): void {
    if (event.kind === 'activated') {
      if (event.tabId !== tabId) schedule(true)
      return
    }
    if (event.tabId === tabId) schedule(false)
  }

  onMounted(() => {
    unsubscribe = bridge.subscribe(onTabEvent)
    void refresh(true)
  })

  onUnmounted(() => {
    unsubscribe?.()
    if (timer !== null) clearTimeout(timer)
    if (recheckTimer !== null) clearTimeout(recheckTimer)
    sequence += 1
  })

  return {
    view,
    retry: () => {
      view.value = { phase: 'loading' }
      return refresh(true)
    },
  }
}
