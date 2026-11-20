/**
 * 데크(카세트 · LP) 위젯의 공유 아이콘 (ADR 0042) — 데크가 보이는 목록을 공유 대화상자로 연다.
 *
 * 공유할 목록은 데크 라벨(`useDeckLabel`)과 같다: 재생 큐가 있으면 그 **출처 목록**, 없으면 보관함에서 **고른 목록**.
 * 출처를 모르는 큐 · 지워진 목록 · 빈 목록은 공유할 것이 없다 — 아이콘은 남기되 누를 수 없고 이유를 이름으로 말한다.
 * 무엇을 어떻게 공유할지는 대화상자(`SharePanel`)의 일이다. 이 함수는 대상만 정한다.
 */
import { computed, inject, type ComputedRef } from 'vue'

import { PLAYBACK_COORDINATOR } from '@/features/playback/playbackCoordinator'
import { SHARE_DIALOG } from '@/shared/types/share'
import { useLibraryStore } from '@/stores/library'

export interface DeckShare {
  /** 공유 대화상자가 있는가 — 없으면(시험 · 대화상자 없는 조립) 아이콘을 그리지 않는다. */
  readonly available: boolean
  readonly canShare: ComputedRef<boolean>
  /** 접근성 이름 · 툴팁 — 누를 수 없을 때는 그 이유. */
  readonly label: ComputedRef<string>
  share(): void
}

export function useDeckShare(): DeckShare {
  const coordinator = inject(PLAYBACK_COORDINATOR, null)
  const shareDialog = inject(SHARE_DIALOG, null)
  const library = useLibraryStore()

  const playlist = computed(() => {
    const queue = coordinator?.queue.value
    const id = queue != null ? (queue.source?.playlistId ?? null) : library.selectedPlaylistId
    return id === null ? null : (library.getPlaylist(id) ?? null)
  })

  const canShare = computed(() => (playlist.value?.tracks.length ?? 0) > 0)

  const label = computed<string>(() => {
    const list = playlist.value
    if (list === null) return '공유할 목록이 없어요'
    if (list.tracks.length === 0) return `${list.name} — 빈 목록은 공유할 수 없어요`
    return `지금 목록 공유 — ${list.name}`
  })

  function share(): void {
    const list = playlist.value
    if (shareDialog === null || list === null || !canShare.value) return
    shareDialog.open({ playlistId: list.id })
  }

  return { available: shareDialog !== null, canShare, label, share }
}
