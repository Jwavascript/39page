import { computed, inject } from 'vue'

import { PLAYBACK_COORDINATOR } from '@/features/playback/playbackCoordinator'
import { useLibraryStore } from '@/stores/library'

export function useDeckLabel() {
  const coordinator = inject(PLAYBACK_COORDINATOR, null)
  const library = useLibraryStore()
  return computed(() => {
    const queue = coordinator?.queue.value
    if (queue != null) return queue.source?.name ?? 'KAWAII SYNTH MIX'
    return library.selectedPlaylist?.name ?? 'KAWAII SYNTH MIX'
  })
}
