<script setup lang="ts">
/**
 * 담을 영상 — 제목 · 영상 ID · YouTube 링크. 표현만 맡는다.
 *
 * 제목은 **다른 사이트가 만든 링크에서 온 값일 수 있다.** 텍스트로만 그린다
 * (`v-html` 금지). 오른쪽에서 왼쪽으로 쓰는 제목도 있으므로 `dir="auto"`.
 */
import { computed } from 'vue'

import { defaultTrackTitle } from '@/stores/library'
import { youtubeWatchUrl } from '@/shared/utils/youtube'

const props = defineProps<{
  videoId: string
  title: string | null
}>()

const watchUrl = computed(() => youtubeWatchUrl(props.videoId))
</script>

<template>
  <article class="video-summary" aria-label="담을 영상">
    <p class="eyebrow mono">담을 영상</p>
    <p v-if="title !== null" class="video-title" dir="auto">{{ title }}</p>
    <p v-else class="video-title video-title--missing">
      제목 없음 — “{{ defaultTrackTitle(videoId) }}” 로 저장됩니다
    </p>
    <p class="video-meta">
      <span class="mono">{{ videoId }}</span>
      <a v-if="watchUrl !== null" :href="watchUrl" target="_blank" rel="noopener noreferrer">
        YouTube 에서 보기 ↗
      </a>
    </p>
  </article>
</template>

<style scoped>
.video-summary {
  display: grid;
  gap: 6px;
  padding: 16px;
  border: 1px solid var(--info-border-color);
  border-radius: var(--radius-modal);
  background: var(--surface-raised-color);
}

.eyebrow {
  margin: 0;
  color: var(--text-dim-color);
  font-size: 10px;
  letter-spacing: 0.08em;
}

.video-title {
  margin: 0;
  font-size: 17px;
  font-weight: 600;
  line-height: 1.4;
  overflow-wrap: anywhere;
}

.video-title--missing {
  color: var(--text-muted-color);
  font-size: 14px;
  font-weight: 400;
}

.video-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 12px;
  margin: 0;
  color: var(--text-muted-color);
  font-size: 12px;
}
</style>
