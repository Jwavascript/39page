<script setup lang="ts">
/**
 * 한 곡의 앨범아트를 그린다 (M12-2, ARTWORK_DESIGN §2-3).
 *
 * 우선순위: 사용자 이미지(M12-3) → YouTube 썸네일 → 39page 기본 그림.
 *
 * 기본 그림을 **늘 아래에 깔고**, 썸네일은 다 받은 뒤에만 그 위에 보인다 — 받는 동안 · 오프라인 · 삭제된 영상에서
 * 빈 상자가 보이지 않는다. 썸네일 실패(`error`)와 YouTube 의 "없음" 회색 그림(120×90)은 기본 그림으로 남는다.
 *
 * 표현만 한다. 무엇을 그릴지(선호)는 부모가 준다 — 저장소를 모른다.
 */
import { computed, ref, watch } from 'vue'
import {
  DEFAULT_ARTWORK_DISPLAY,
  readArtworkDisplay,
  type ArtworkDisplay,
} from '@/shared/types/artwork'

import DefaultArtwork from './DefaultArtwork.vue'
import { isPlaceholderThumbnail, youtubeThumbnailUrl } from './youtubeThumbnail'

const props = withDefaults(
  defineProps<{
    /** 지금 곡의 영상. 없으면(곡 없음) 기본 그림. */
    videoId: string | null
    /**
     * - `auto` — 썸네일 → 기본
     * - `default` — 사용자가 기본 그림을 골랐다 (썸네일을 받지 않는다)
     * - `custom` — 사용자 이미지 (`src`). 바이트를 읽는 동안(`loading`)은 기본 그림
     * - `missing` — 연결된 이미지를 찾지 못함: 기본 그림 (부르는 쪽이 알림을 띄운다)
     */
    mode?: 'auto' | 'default' | 'custom' | 'missing' | 'loading'
    /** 사용자 이미지의 `blob:` URL (custom). 움직임을 멈추면 부르는 쪽이 포스터 URL 을 준다. */
    src?: string | null
    display?: ArtworkDisplay
  }>(),
  { mode: 'auto', src: null },
)

const imageStyle = computed(() => {
  const display = readArtworkDisplay(props.display) ?? DEFAULT_ARTWORK_DISPLAY
  const position = `${display.positionX}% ${display.positionY}%`
  return {
    objectFit: display.fit,
    objectPosition: position,
    transform: `scale(${display.zoom})`,
    transformOrigin: position,
  }
})

const thumbnailUrl = computed<string | null>(() =>
  props.mode === 'auto' ? youtubeThumbnailUrl(props.videoId) : null,
)

/** 다 받은 썸네일 주소 · 실패한 주소. 곡이 바뀌면 새 주소라 저절로 다시 판단한다. */
const loadedUrl = ref<string | null>(null)
const failedUrl = ref<string | null>(null)

watch(thumbnailUrl, () => {
  loadedUrl.value = null
})

function onLoad(event: Event): void {
  const image = event.target as HTMLImageElement
  if (isPlaceholderThumbnail(image)) {
    failedUrl.value = image.getAttribute('src')
    return
  }
  loadedUrl.value = image.getAttribute('src')
}

function onError(event: Event): void {
  failedUrl.value = (event.target as HTMLImageElement).getAttribute('src')
}

/** 실제로 보이는 것 — 시험 · 실제 브라우저 측정이 읽는다. */
const shown = computed<'custom' | 'missing' | 'thumbnail' | 'loading' | 'default'>(() => {
  if (props.mode === 'custom' && props.src !== null) return 'custom'
  if (props.mode === 'missing') return 'missing'
  if (props.mode === 'custom' || props.mode === 'loading') return 'loading'
  const url = thumbnailUrl.value
  if (url === null || failedUrl.value === url) return 'default'
  return loadedUrl.value === url ? 'thumbnail' : 'loading'
})
</script>

<template>
  <div class="artwork-image" :data-artwork-source="shown">
    <DefaultArtwork v-if="shown !== 'custom'" />
    <!--
      썸네일. 기본 그림 위에 겹친다. 실패한 주소는 다시 요청하지 않는다(`v-if`). 이 페이지 주소를 YouTube 이미지
      서버에 보내지 않는다(`no-referrer`).
    -->
    <img
      v-if="thumbnailUrl !== null && failedUrl !== thumbnailUrl"
      :key="thumbnailUrl"
      class="artwork-image__thumb"
      :class="{ 'is-loaded': shown === 'thumbnail' }"
      :src="thumbnailUrl"
      alt=""
      decoding="async"
      draggable="false"
      referrerpolicy="no-referrer"
      @load="onLoad"
      @error="onError"
    />
    <!-- 사용자 이미지 (`blob:` — 이 브라우저 안의 바이트). 이미지 요소는 스크립트를 실행하지 않는다. -->
    <img
      v-if="shown === 'custom'"
      :key="src ?? ''"
      class="artwork-image__custom"
      :style="imageStyle"
      :src="src ?? ''"
      alt=""
      decoding="async"
      draggable="false"
    />
  </div>
</template>

<style scoped>
.artwork-image {
  background: var(--artwork-frame-surface-color);
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
}

/*
 * `hqdefault` 는 4:3(480×360)에 16:9 영상을 위아래 띠로 담는다. 정사각형에 `cover` 로 맞춘 뒤 1/0.75 배로 키워
 * 띠를 잘라낸다 — 남는 것은 16:9 내용의 가운데 정사각형이다.
 */
.artwork-image__thumb {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  opacity: 0;
  transform: scale(1.34);
  transition: opacity 0.2s ease;
}

.artwork-image__thumb.is-loaded {
  opacity: 1;
}

/* 사용자 이미지 — 정사각형을 가운데 기준으로 채운다 (비율이 다르면 넘치는 쪽이 잘린다). */
.artwork-image__custom {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

@media (prefers-reduced-motion: reduce) {
  .artwork-image__thumb {
    transition: none;
  }
}
</style>
