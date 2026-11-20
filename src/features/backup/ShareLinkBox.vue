<script setup lang="ts">
/**
 * 공유 대화상자의 본문 (ADR 0040 · 0041 → ADR 0043) — 이미지 카드, 그 아래 링크.
 *
 * 고르는 칸이 없다 — 무엇이 들어가는지는 대상이 정한다 (`useShareLink`). 링크는 내용을 그대로 담으므로 링크를 가진 누구나
 * 볼 수 있다는 것만 짧게 말한다. 판단은 `useShareLink` · `useShareCard` 가, 표현은 이 컴포넌트가 한다 (규칙 3).
 */
import { computed, nextTick, ref, toRef } from 'vue'

import { useLibraryStore } from '@/stores/library'

import ShareCardBox from './ShareCardBox.vue'
import { shareCardArtKeys } from './useShareCard'
import { useShareLink, type ShareLinkTarget } from './useShareLink'

const props = defineProps<{ target: ShareLinkTarget }>()

const link = useShareLink(toRef(props, 'target'))
const field = ref<HTMLInputElement | null>(null)
const library = useLibraryStore()
/** 카드의 앨범아트를 찾아볼 트랙들 — Moment 는 같은 영상의 트랙(고른 목록 먼저). */
const artKeys = computed(() =>
  shareCardArtKeys(props.target, [library.selectedPlaylist, ...library.playlists]),
)

function selectField(): void {
  field.value?.select()
}

async function copy(): Promise<void> {
  await link.copy()
  if (link.copyState.value === 'manual') {
    // 복사가 막혔다 — 링크를 골라 두면 Ctrl+C(⌘C) 한 번이다.
    await nextTick()
    field.value?.focus()
    selectField()
  }
}
</script>

<template>
  <div class="share-body">
    <ShareCardBox :content="link.cardContent.value" :art-keys="artKeys" />

    <section class="link-share" aria-label="링크">
      <div class="link-row">
        <input
          ref="field"
          class="link-field"
          type="text"
          readonly
          :value="link.url.value ?? ''"
          aria-label="공유 링크"
          @focus="selectField"
        />
        <button
          type="button"
          class="pill pill--strong copy"
          :disabled="link.url.value === null"
          @click="copy"
        >
          링크 복사
        </button>
      </div>
      <p class="copy-status" role="status" aria-live="polite">
        <template v-if="link.copyState.value === 'copied'">링크를 복사했어요.</template>
        <template v-else-if="link.copyState.value === 'manual'">
          복사하지 못했어요 — 링크를 골라 두었으니 Ctrl+C(⌘C)로 복사하세요.
        </template>
      </p>
      <p v-if="link.level.value === 'too-long'" class="warn">
        곡이 너무 많아 링크로 담을 수 없어요.
      </p>
      <p v-else-if="link.level.value === 'long'" class="warn">
        링크가 길어 일부 게시판에서 잘릴 수 있어요.
      </p>
      <p v-if="link.titlesDropped.value" class="note">
        링크에는 곡 이름을 뺐어요 — 받는 사람이 열 때 YouTube 에서 찾아요.
      </p>
      <p class="note">링크를 가진 누구나 내용을 볼 수 있어요.</p>
    </section>
  </div>
</template>

<style scoped>
.link-share {
  margin-top: 12px;
}

.warn,
.note,
.copy-status {
  margin: 4px 0;
  font: 11px/1.6 var(--font-mono);
}

.note {
  color: var(--drawer-sub-text-color);
}

.warn {
  color: var(--status-warning-text-color);
}

.copy-status:empty {
  display: none;
}

.link-row {
  display: flex;
  flex-wrap: wrap;
  margin: 4px 0;
  gap: 6px;
}

.link-field {
  min-width: 0;
  height: 44px;
  flex: 1 1 200px;
  padding: 8px 10px;
  border: 1px solid var(--field-border-color);
  border-radius: var(--radius-field);
  background: var(--field-surface-color);
  color: var(--field-text-color);
  font: 12px var(--font-mono);
  text-overflow: ellipsis;
}

.pill {
  min-height: 44px;
  flex: none;
  padding: 7px 14px;
  border: 1px solid var(--pill-border-color);
  border-radius: var(--radius-control);
  background: var(--pill-surface-color);
  color: var(--pill-text-color);
  font: 12px var(--font-mono);
}

.pill:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}

.pill--strong {
  border-color: var(--accent-strong-color);
  background: var(--accent-strong-color);
  color: var(--accent-strong-text-color);
}
</style>
