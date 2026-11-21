<script setup lang="ts">
/**
 * Custom 데크 아트 (ADR 0045) — 사용자가 올린 그림 · 움짤을 카세트 · LP 자리에 그린다.
 *
 * 두 승인 데크와 **같은 틀**(900 × 570 비율)이라 데크 · 작은 띠 배치가 그대로다. 그림은 표시 설정(맞춤 · 위치 ·
 * 확대)대로 이 틀을 채운다. 움직이는 GIF 는 **재생 중에만** 움직인다 — 멈춰 있으면 첫 프레임(포스터). 카세트 릴 ·
 * LP 가 재생 중에만 도는 것과 같다. 움직임을 줄이도록 설정한 사용자에게는 늘 첫 프레임이다.
 *
 * 표현만 한다 — 무엇을 그릴지는 데크 위젯이 store 에서 읽어 준다. 플레이어를 모른다 (AGENTS 규칙 4).
 * 그림이 없으면 빈 틀만 그린다. "이미지 넣기" 단추는 데크 위젯이 그 위에 둔다.
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

import {
  DEFAULT_ARTWORK_DISPLAY,
  readArtworkDisplay,
  type ArtworkDisplay,
} from '@/shared/types/artwork'

const props = withDefaults(
  defineProps<{
    src?: string | null
    posterSrc?: string | null
    animated?: boolean
    display?: ArtworkDisplay
    playing?: boolean
  }>(),
  { src: null, posterSrc: null, animated: false, playing: false },
)

const reduced = ref(false)
let query: MediaQueryList | null = null
const onChange = () => {
  reduced.value = query?.matches ?? false
}
onMounted(() => {
  if (typeof window.matchMedia !== 'function') return
  query = window.matchMedia('(prefers-reduced-motion: reduce)')
  onChange()
  query.addEventListener('change', onChange)
})
onBeforeUnmount(() => query?.removeEventListener('change', onChange))

/** 보이는 주소 — 움직이는 그림은 재생 중이고 움직임을 줄이지 않았을 때만 원본, 아니면 첫 프레임. */
const shown = computed<string | null>(() => {
  if (props.src === null) return null
  if (!props.animated) return props.src
  return props.playing && !reduced.value ? props.src : (props.posterSrc ?? props.src)
})

const imageStyle = computed(() => {
  const display = readArtworkDisplay(props.display) ?? DEFAULT_ARTWORK_DISPLAY
  const position = `${String(display.positionX)}% ${String(display.positionY)}%`
  return {
    objectFit: display.fit,
    objectPosition: position,
    transform: `scale(${String(display.zoom)})`,
    transformOrigin: position,
  }
})
</script>

<template>
  <div
    class="deck-art deck-art--custom"
    :data-deck-image="shown === null ? 'empty' : shown === src ? 'image' : 'poster'"
    role="img"
    :aria-label="shown === null ? '빈 데크 그림 자리' : '사용자가 고른 데크 그림'"
  >
    <img
      v-if="shown !== null"
      :key="shown"
      class="deck-custom-image"
      :style="imageStyle"
      :src="shown"
      alt=""
      decoding="async"
      draggable="false"
    />
    <span v-else class="deck-custom-empty" aria-hidden="true"></span>
  </div>
</template>
