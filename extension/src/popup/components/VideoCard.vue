<script setup lang="ts">
/**
 * 현재 영상 — 종류 · 제목 · 영상 ID. 표현만 맡는다.
 *
 * 제목은 웹페이지가 정한 문자열이다. **텍스트로만** 그린다 (`v-html` 금지,
 * EXTENSION_DESIGN.md §3-2). 오른쪽에서 왼쪽으로 쓰는 제목도 있으므로 `dir="auto"`.
 */
import type { PageKind } from '@/shared/messages'

import { PAGE_KIND_LABEL, UNKNOWN_TITLE } from '../copy'

defineProps<{
  videoId: string
  pageKind: PageKind
  title: string | null
}>()
</script>

<template>
  <article class="video-card" aria-label="현재 영상">
    <span class="kind">{{ PAGE_KIND_LABEL[pageKind] }}</span>
    <p v-if="title !== null" class="title" dir="auto">{{ title }}</p>
    <p v-else class="title unknown">{{ UNKNOWN_TITLE }}</p>
    <dl class="meta">
      <dt>영상 ID</dt>
      <dd class="video-id">{{ videoId }}</dd>
    </dl>
  </article>
</template>

<style scoped>
.video-card {
  display: grid;
  gap: 8px;
  padding: 14px;
  border: 1px solid var(--info-border-color);
  border-radius: var(--radius-modal);
  background: var(--surface-raised-color);
}

.kind {
  justify-self: start;
  padding: 2px 7px;
  border: 1px solid var(--pill-border-color);
  border-radius: var(--radius-control);
  background: var(--pill-surface-color);
  color: var(--pill-text-color);
  font: 10px var(--font-mono);
  letter-spacing: 0.06em;
}

.title {
  display: -webkit-box;
  margin: 0;
  overflow: hidden;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
  color: var(--text-color);
  font-size: 14px;
  font-weight: 600;
  line-height: 1.4;
  overflow-wrap: anywhere;
}

.title.unknown {
  color: var(--text-muted-color);
  font-weight: 400;
}

.meta {
  display: flex;
  gap: 8px;
  align-items: baseline;
  margin: 0;
  color: var(--text-dim-color);
  font-size: 11px;
}

.meta dd {
  margin: 0;
}

.video-id {
  color: var(--text-muted-color);
  font-family: var(--font-mono);
  letter-spacing: 0.04em;
  user-select: all;
}
</style>
