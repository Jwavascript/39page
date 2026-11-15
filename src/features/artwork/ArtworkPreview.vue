<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, useTemplateRef } from 'vue'
import type { ArtworkDisplay } from '@/shared/types/artwork'
import type { TrackArtworkMode } from './useTrackArtwork'
import ArtworkImage from './ArtworkImage.vue'

const props = withDefaults(
  defineProps<{
    videoId: string | null
    mode: TrackArtworkMode
    src: string | null
    posterSrc: string | null
    animated: boolean
    display?: ArtworkDisplay
    active?: boolean
  }>(),
  { active: true },
)
const box = useTemplateRef<HTMLElement>('box')
const visible = ref(true)
const reduced = ref(false)
const playing = ref<boolean | null>(null)
let query: MediaQueryList | null = null
let observer: IntersectionObserver | null = null
const change = () => {
  reduced.value = query?.matches ?? false
}
onMounted(() => {
  if (typeof window.matchMedia === 'function') {
    query = window.matchMedia('(prefers-reduced-motion: reduce)')
    change()
    query.addEventListener('change', change)
  }
  if (box.value !== null && typeof IntersectionObserver === 'function') {
    observer = new IntersectionObserver((entries) => {
      visible.value = entries[entries.length - 1]?.isIntersecting ?? false
    })
    observer.observe(box.value)
  }
})
onBeforeUnmount(() => {
  query?.removeEventListener('change', change)
  observer?.disconnect()
})
const motion = computed(() => playing.value ?? !reduced.value)
const source = computed(() =>
  props.animated && (!motion.value || !visible.value || !props.active)
    ? props.posterSrc
    : props.src,
)
</script>

<template>
  <div ref="box" class="artwork-preview">
    <ArtworkImage :video-id="videoId" :mode="mode" :src="source" :display="display" />
    <button
      v-if="animated && mode === 'custom'"
      type="button"
      :aria-pressed="!motion"
      :aria-label="motion ? '미리보기 움직임 멈춤' : '미리보기 움직임 다시 재생'"
      @pointerdown.stop
      @click="playing = !motion"
    >
      {{ motion ? 'Ⅱ' : '▶' }}
    </button>
  </div>
</template>

<style scoped>
.artwork-preview {
  position: relative;
  width: 100%;
  height: 100%;
}
button {
  position: absolute;
  right: 0;
  bottom: 0;
  min-width: 44px;
  min-height: 44px;
  border: 1px solid var(--pill-border-color);
  background: var(--pill-surface-color);
  color: var(--pill-text-color);
}
</style>
