<script setup lang="ts">
import { computed, ref, watch } from 'vue'

import type { ArtworkDisplay } from '@/shared/types/artwork'
import ArtworkPreview from '@/features/artwork/ArtworkPreview.vue'
import { useArtworkDisplayDrag } from '@/features/artwork/useArtworkDisplayDrag'
import type { TrackArtworkView } from '@/features/artwork/useTrackArtwork'

const props = defineProps<{
  videoId: string | null
  saved: TrackArtworkView
  draft: TrackArtworkView
  savedDisplay: ArtworkDisplay
  savedLabel: string
  dimensions: { width: number; height: number } | null
  active: boolean
  disabled: boolean
}>()
const display = defineModel<ArtworkDisplay>({ required: true })
const comparing = ref(false)
const shown = computed(() => (comparing.value ? props.saved : props.draft))
const drag = useArtworkDisplayDrag(
  display,
  computed(() => props.dimensions),
)

// 조절을 재개하면 즉시 편집 결과를 보여 준다. 비교 상태는 draft에 쓰지 않는다.
watch(
  [display, () => props.draft.mode, () => props.draft.src],
  () => {
    comparing.value = false
  },
  { deep: true },
)

function startDrag(event: PointerEvent): void {
  if (!props.disabled && !comparing.value && props.draft.mode === 'custom') drag.down(event)
}
function moveDrag(event: PointerEvent): void {
  if (!props.disabled && !comparing.value) drag.move(event)
}
function toggleComparison(): void {
  drag.end()
  comparing.value = !comparing.value
}
</script>

<template>
  <div class="settings-previews">
    <figure class="preview preview--draft" :data-comparing="comparing">
      <div
        class="preview-art"
        :class="{ 'preview-art--adjustable': draft.mode === 'custom' && !comparing && !disabled }"
        @pointerdown="startDrag"
        @pointermove="moveDrag"
        @pointerup="drag.end"
        @pointercancel="drag.end"
        @lostpointercapture="drag.end"
      >
        <!-- 같은 자산 비교는 src·img 노드를 유지하고 표시 구도만 바꾼다. -->
        <ArtworkPreview
          :video-id="videoId"
          :mode="shown.mode"
          :src="shown.src"
          :poster-src="shown.posterSrc"
          :animated="shown.animated"
          :display="comparing ? savedDisplay : display"
          :active="active"
        />
      </div>
      <figcaption class="preview-caption">
        <span class="preview-label" role="status" :title="comparing ? savedLabel : undefined">{{
          comparing ? '현재 저장된 이미지' : '저장 전 미리보기'
        }}</span>
        <button
          type="button"
          class="compare-button"
          :aria-pressed="comparing"
          @click="toggleComparison"
        >
          {{ comparing ? '편집 미리보기로' : '변경 전 보기' }}
        </button>
      </figcaption>
    </figure>
  </div>
</template>

<style scoped>
.settings-previews {
  position: sticky;
  top: 0;
  z-index: 1;
  min-width: 0;
  padding-bottom: 8px;
  background: var(--drawer-surface-color);
}
.preview {
  display: grid;
  grid-template-columns: var(--preview-size) minmax(0, 1fr);
  align-items: center;
  gap: 12px;
  min-width: 0;
  margin: 0;
}
.preview-art {
  width: var(--preview-size);
  height: var(--preview-size);
  border: 1px dashed var(--artwork-frame-border-color);
  background: var(--artwork-frame-surface-color);
  overflow: hidden;
}
.preview[data-comparing='true'] .preview-art {
  border-style: solid;
}
.preview-art--adjustable {
  touch-action: none;
  cursor: grab;
}
.preview-caption {
  display: flex;
  min-width: 0;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
}
.preview-label {
  font: 11px/1.4 var(--font-mono);
  overflow-wrap: anywhere;
}
.compare-button {
  min-height: 44px;
  max-width: 100%;
  padding: 6px 10px;
  border: 1px solid var(--pill-border-color);
  border-radius: var(--radius-control);
  background: var(--pill-surface-color);
  color: var(--pill-text-color);
  font: 11px/1.4 var(--font-mono);
}
@container artwork-editor (min-width: 560px) {
  .preview {
    grid-template-columns: minmax(0, 1fr);
  }
  .preview-art {
    width: min(100%, var(--preview-size));
    height: auto;
    aspect-ratio: 1;
  }
}
</style>
