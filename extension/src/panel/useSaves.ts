/**
 * 패널의 두 저장 — 음악 담기(기존 목록 · 새 목록) · Moment 저장 (M11-5B). 접근 권한 상태도 여기서 든다.
 *
 * - 음악: 목록을 39page 에서 읽어 보인다(곡 수 · 이 영상이 이미 있는 자리). 이미 있으면 "한 번 더 담기" 를
 *   사용자가 골라야 담는다. 새 목록은 "만들기 + 담기" 한 흐름이고, 목록만 만들어지면(부분 성공) 그 목록 ID
 *   를 지킨 채 "이 플레이리스트에 다시 담기" — 같은 이름의 목록이 또 생기지 않는다.
 * - Moment: 잡은 시점 + 메모를 사용자가 저장을 눌러야 저장한다. 메모를 쓰는 동안 영상이 재생돼도 시점은
 *   그대로다. 시점을 잡지 못했으면 저장하지 않는다. 플레이리스트에 담을 필요가 없다 (독립).
 */
import { computed, ref, watch, type ComputedRef, type Ref } from 'vue'

import type { BridgeState } from '@/shared/bridgeMessages'

import type { PanelBridge } from './panelBridge'
import type { PanelModel } from './usePanel'
import { useSaveRequest, type SaveRequest } from './useSaveRequest'

export interface PlaylistView {
  readonly id: string
  readonly name: string
  readonly trackCount: number
  /** 이 영상이 이미 있는 자리 (1부터). */
  readonly positions: readonly number[]
}

export type ListPhase = 'idle' | 'loading' | 'ready' | 'blocked' | 'failed'

export const MAX_NOTE = 500
export const MAX_NAME = 60

export interface Saves {
  readonly access: Readonly<Ref<BridgeState | null>>
  readonly granting: Readonly<Ref<boolean>>
  readonly lists: Readonly<Ref<readonly PlaylistView[]>>
  readonly listPhase: Readonly<Ref<ListPhase>>
  readonly selected: Ref<string | null>
  readonly creating: Ref<boolean>
  readonly newName: Ref<string>
  readonly allowDuplicate: Ref<boolean>
  readonly selectedList: ComputedRef<PlaylistView | null>
  readonly music: SaveRequest
  readonly note: Ref<string>
  readonly moment: SaveRequest
  readonly momentsHere: Readonly<Ref<readonly number[]>>
  refreshAccess(): Promise<void>
  grant(): Promise<void>
  loadLists(): Promise<void>
  saveMusic(): Promise<void>
  /** 부분 성공 · 결과 불명 뒤 같은 요청으로 다시 담는다. */
  retryMusic(): Promise<void>
  saveMoment(): Promise<void>
}

export function useSaves(bridge: PanelBridge, panel: PanelModel): Saves {
  const access = ref<BridgeState | null>(null)
  const granting = ref(false)
  const lists = ref<readonly PlaylistView[]>([])
  const listPhase = ref<ListPhase>('idle')
  const selected = ref<string | null>(null)
  const creating = ref(false)
  const newName = ref('')
  const allowDuplicate = ref(false)
  const note = ref('')
  const momentsHere = ref<readonly number[]>([])
  const music = useSaveRequest(bridge)
  const moment = useSaveRequest(bridge)

  const selectedList = computed<PlaylistView | null>(
    () => lists.value.find((list) => list.id === selected.value) ?? null,
  )

  async function refreshAccess(): Promise<void> {
    const result = await bridge.bridgeState()
    if (result.ok) access.value = result.data
  }

  async function loadLists(): Promise<void> {
    const target = panel.video.value
    if (access.value?.permission !== 'granted') return
    listPhase.value = 'loading'
    const result = await bridge.call(
      { op: 'library/list', videoId: target?.videoId ?? null },
      bridge.newRequestId(),
    )
    if (result.outcome !== 'ok') {
      listPhase.value = 'failed'
      if (result.outcome === 'unavailable' && result.reason === 'permission') await refreshAccess()
      return
    }
    const data = result.data as { status?: string; playlists?: PlaylistView[] }
    lists.value = data.playlists ?? []
    listPhase.value = data.status === 'ready' ? 'ready' : 'blocked'
    if (selected.value !== null && !lists.value.some((list) => list.id === selected.value)) {
      selected.value = null
    }
    if (target !== null) {
      const moments = await bridge.call(
        { op: 'moment/list-for-video', videoId: target.videoId },
        bridge.newRequestId(),
      )
      momentsHere.value =
        moments.outcome === 'ok' ? ((moments.data as { atSeconds?: number[] }).atSeconds ?? []) : []
    }
  }

  async function grant(): Promise<void> {
    const origins = access.value?.origins
    if (origins === undefined || granting.value) return
    granting.value = true
    try {
      await bridge.requestPermission(origins)
      await refreshAccess()
      if (access.value?.permission === 'granted') await loadLists()
    } finally {
      granting.value = false
    }
  }

  async function saveMusic(): Promise<void> {
    const target = panel.video.value
    if (target === null) return
    const title = target.title
    if (creating.value) {
      const name = newName.value.trim()
      if (name === '') return
      await music.run({ op: 'playlist/create-and-add', name, videoId: target.videoId, title })
    } else {
      const list = selectedList.value
      if (list === null) return
      await music.run({
        op: 'track/add',
        playlistId: list.id,
        videoId: target.videoId,
        title,
        allowDuplicate: allowDuplicate.value,
      })
    }
    if (music.state.value.phase === 'done') {
      allowDuplicate.value = false
      await loadLists()
    }
  }

  async function retryMusic(): Promise<void> {
    await music.retry()
    if (music.state.value.phase === 'done') await loadLists()
  }

  async function saveMoment(): Promise<void> {
    const target = panel.video.value
    const shot = panel.capture.value
    if (target === null || shot?.status !== 'captured' || shot.videoId !== target.videoId) return
    if (note.value.length > MAX_NOTE) return
    await moment.run({
      op: 'moment/add',
      videoId: shot.videoId,
      atSeconds: shot.atSeconds,
      note: note.value,
      title: shot.title ?? target.title,
    })
    if (moment.state.value.phase === 'done') await loadLists()
  }

  // 고른 것이 바뀌면 앞 결과를 지운다 (결과를 모르는 요청은 확인할 수 있게 남긴다).
  const settled = (request: SaveRequest) =>
    request.state.value.phase !== 'uncertain' && request.state.value.phase !== 'partial'
  watch([selected, creating], () => {
    allowDuplicate.value = false
    if (settled(music)) music.reset()
  })
  watch(
    () => panel.video.value?.videoId,
    () => {
      if (settled(music)) music.reset()
      if (settled(moment)) moment.reset()
      void loadLists()
    },
  )
  watch(
    () => (panel.capture.value?.status === 'captured' ? panel.capture.value.at : null),
    () => {
      if (settled(moment)) moment.reset()
    },
  )

  return {
    access,
    granting,
    lists,
    listPhase,
    selected,
    creating,
    newName,
    allowDuplicate,
    selectedList,
    music,
    note,
    moment,
    momentsHere,
    refreshAccess,
    grant,
    loadLists,
    saveMusic,
    retryMusic,
    saveMoment,
  }
}
