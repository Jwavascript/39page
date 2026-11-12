/**
 * 패널의 바탕 상태 (M11-5B) — 지금 영상 · 고정한 영상 · 탭 · 잡은 시점 · 서비스 워커 동기화.
 *
 * 영상 정책 (YouTube SPA 이동)
 * - 패널의 영상 카드는 **열 때(또는 단축키를 누를 때)의 영상에 고정**된다. 저장은 늘 카드의 영상이다 —
 *   자동 다음 영상이 재생돼도 사용자가 보던 영상이 아닌 곳에 저장하지 않는다.
 * - 페이지의 영상이 바뀌면 알린다("페이지의 영상이 바뀌었어요") · [새 영상으로 바꾸기] 를 누르면 카드를
 *   바꾼다. 쓰던 메모 · 고른 목록 · 새 목록 이름은 그대로 두고, 잡은 시점은 지운다(다른 영상의 시점이다).
 * - 단축키 · 아이콘을 다시 누르면(지시 번호가 바뀌면) 그 순간의 영상으로 카드를 바꾼다 — 명시적인 새 지시다.
 */
import { computed, onBeforeUnmount, onMounted, ref, type ComputedRef, type Ref } from 'vue'

import type { PageInspection, PageKind } from '@/shared/messages'
import type { CaptureOutcome, PanelMode } from '@/shared/panelMessages'

import type { CollectRequest, PanelBridge } from './panelBridge'

export const SYNC_INTERVAL_MS = 1_500

export interface LockedVideo {
  readonly videoId: string
  readonly title: string | null
  readonly pageKind: PageKind
}

export type Connection = 'connecting' | 'ok' | 'lost'

export interface PanelModel {
  readonly connection: Readonly<Ref<Connection>>
  readonly page: Readonly<Ref<PageInspection | null>>
  readonly video: Readonly<Ref<LockedVideo | null>>
  readonly mode: Ref<PanelMode>
  readonly capture: Readonly<Ref<CaptureOutcome | null>>
  readonly capturing: Readonly<Ref<boolean>>
  /** 다시 잡기가 실패한 이유 (페이지 이동 등). */
  readonly captureError: Readonly<Ref<string>>
  readonly pageChanged: ComputedRef<boolean>
  sync(): Promise<void>
  switchToCurrent(): void
  recapture(): Promise<void>
  close(): Promise<void>
  collect(kind: CollectRequest['kind']): Promise<string>
}

export function usePanel(bridge: PanelBridge, options: { poll?: boolean } = {}): PanelModel {
  const connection = ref<Connection>('connecting')
  const page = ref<PageInspection | null>(null)
  const video = ref<LockedVideo | null>(null)
  const mode = ref<PanelMode>('music')
  const capture = ref<CaptureOutcome | null>(null)
  const capturing = ref(false)
  const captureError = ref('')
  let seq = 0
  let timer: ReturnType<typeof setInterval> | null = null

  function lockToPage(): void {
    const current = page.value
    if (current?.status !== 'video') return
    video.value = { videoId: current.videoId, title: current.title, pageKind: current.pageKind }
  }

  async function sync(): Promise<void> {
    const result = await bridge.sync()
    if (!result.ok) {
      // 이 패널이 그 탭에 묶이지 않았다(워커가 다시 떴다 등) — 다시 열면 된다.
      if (result.error.code === 'forbidden-sender') {
        connection.value = 'lost'
        stop()
      }
      return
    }
    connection.value = 'ok'
    page.value = result.data.page
    if (result.data.seq !== seq) {
      // 새 지시 — 그 순간의 영상 · 탭 · 시점으로.
      seq = result.data.seq
      mode.value = result.data.mode
      lockToPage()
      if (result.data.capture !== null) {
        capture.value = result.data.capture
        captureError.value = ''
      } else if (result.data.mode === 'music') {
        // 음악으로 다시 열었다 — 앞서 잡은 시점이 다른 영상의 것이면 지운다.
        if (
          capture.value?.status === 'captured' &&
          capture.value.videoId !== video.value?.videoId
        ) {
          capture.value = null
        }
      }
    } else if (video.value === null) {
      lockToPage()
    } else if (
      result.data.page.status === 'video' &&
      result.data.page.videoId === video.value.videoId &&
      video.value.title === null &&
      result.data.page.title !== null
    ) {
      // 제목이 늦게 읽혔다 (SPA 이동 직후).
      video.value = { ...video.value, title: result.data.page.title }
    }
  }

  const pageChanged = computed<boolean>(
    () =>
      video.value !== null &&
      page.value?.status === 'video' &&
      page.value.videoId !== video.value.videoId,
  )

  function switchToCurrent(): void {
    lockToPage()
    capture.value = null
    captureError.value = ''
  }

  async function recapture(): Promise<void> {
    const target = video.value
    if (target === null || capturing.value) return
    capturing.value = true
    captureError.value = ''
    try {
      const result = await bridge.capture(target.videoId)
      if (result.ok) capture.value = result.data
      else if (result.error.code === 'page-changed') {
        captureError.value =
          '페이지의 영상이 카드의 영상과 달라 시점을 잡지 않았어요. 새 영상으로 바꾼 뒤 다시 잡아 주세요.'
      } else captureError.value = '재생 시점을 읽지 못했어요. 다시 눌러 주세요.'
    } finally {
      capturing.value = false
    }
  }

  async function close(): Promise<void> {
    stop()
    await bridge.close()
  }

  /** 기존 수집 화면(새 탭)으로 — 사용자가 고를 때만. 안내 문구를 돌려준다. */
  async function collect(kind: CollectRequest['kind']): Promise<string> {
    const target = video.value
    if (target === null) return ''
    const shot = capture.value?.status === 'captured' && capture.value.videoId === target.videoId
    if (kind === 'moment' && !shot) return '먼저 시점을 잡아 주세요.'
    const result = await bridge.collect({
      kind,
      videoId: target.videoId,
      atSeconds:
        kind === 'moment' && capture.value?.status === 'captured' ? capture.value.atSeconds : null,
      title: target.title,
    })
    if (result.ok) {
      return result.data.status === 'focused'
        ? '이미 열어 둔 39page 수집 화면으로 옮겼어요.'
        : '39page 수집 화면을 새 탭으로 열었어요. 그 화면에서 확인하고 저장해 주세요.'
    }
    return result.error.code === 'page-changed'
      ? '페이지의 영상이 바뀌어 수집 화면을 열지 않았어요. 새 영상으로 바꾼 뒤 다시 눌러 주세요.'
      : '수집 화면을 열지 못했어요.'
  }

  function stop(): void {
    if (timer !== null) clearInterval(timer)
    timer = null
  }

  function onVisibility(): void {
    if (document.visibilityState === 'visible') void sync()
  }

  onMounted(() => {
    void sync()
    if (options.poll !== false) {
      timer = setInterval(() => {
        if (document.visibilityState === 'visible') void sync()
      }, SYNC_INTERVAL_MS)
      document.addEventListener('visibilitychange', onVisibility)
    }
  })
  onBeforeUnmount(() => {
    stop()
    document.removeEventListener('visibilitychange', onVisibility)
  })

  return {
    connection,
    page,
    video,
    mode,
    capture,
    capturing,
    captureError,
    pageChanged,
    sync,
    switchToCurrent,
    recapture,
    close,
    collect,
  }
}
