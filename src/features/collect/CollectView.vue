<script setup lang="ts">
/**
 * 수집 화면 (M10-3B). 상태는 `useCollect` 가, 문구는 `collectCopy` 가, 모양은
 * 하위 컴포넌트가 맡는다. 이 컴포넌트는 단계에 맞는 조각을 고른다.
 *
 * 대시보드·플레이어(iframe)를 띄우지 않는다 — `main.ts` 가 이 화면만 마운트한다.
 */
import { computed } from 'vue'

import CollectNotice from './CollectNotice.vue'
import CollectPlaylistPicker from './CollectPlaylistPicker.vue'
import CollectVideoSummary from './CollectVideoSummary.vue'
import {
  BLOCKED_DETAIL,
  FAILURE_DETAIL,
  NOTHING_SAVED,
  REJECT_DETAIL,
  SAVE_ONLY_ON_CLICK,
} from './collectCopy'
import { useCollect, type CollectOptions } from './useCollect'

const props = defineProps<{
  hash: string
  options?: CollectOptions
}>()

const collect = useCollect(props.hash, props.options)
const { phase, choices, selectedId, duplicatePositions, saving, canAdd } = collect

const duplicateText = computed(() => {
  const positions = duplicatePositions.value
  if (positions.length === 0) return ''
  return `이 플레이리스트에 이미 있습니다 (${positions.join(', ')}번째). 한 번 더 추가하면 같은 곡이 또 들어갑니다.`
})

const addLabel = computed(() => {
  if (saving.value) return '저장 중…'
  return duplicatePositions.value.length > 0 ? '한 번 더 추가' : '플레이리스트에 추가'
})
</script>

<template>
  <div class="collect">
    <template v-if="phase.kind === 'rejected'">
      <CollectNotice
        tone="error"
        title="이 수집 요청은 열 수 없습니다"
        :detail="REJECT_DETAIL[phase.reason]"
      >
        <p class="aside">{{ NOTHING_SAVED }}</p>
        <a class="pill" href="/">대시보드로 이동</a>
      </CollectNotice>
    </template>

    <template v-else>
      <CollectVideoSummary
        v-if="collect.request !== null"
        :video-id="collect.request.videoId"
        :title="collect.request.title"
      />

      <CollectNotice
        v-if="phase.kind === 'blocked'"
        tone="error"
        title="지금은 추가할 수 없습니다"
        :detail="BLOCKED_DETAIL[phase.status]"
      >
        <a class="pill" href="/">대시보드로 이동</a>
      </CollectNotice>

      <CollectNotice
        v-else-if="phase.kind === 'saved'"
        tone="success"
        :title="`“${phase.trackTitle}” 을(를) “${phase.playlistName}” 에 추가했습니다`"
        detail="이 탭은 닫아도 됩니다. 열려 있는 39page 탭에도 바로 보입니다."
      >
        <a class="pill pill--strong" href="/">대시보드로 이동</a>
      </CollectNotice>

      <form v-else class="choose" @submit.prevent="collect.add">
        <CollectPlaylistPicker v-model="selectedId" :choices="choices" />

        <p v-if="duplicateText !== ''" class="duplicate" role="status">{{ duplicateText }}</p>
        <p v-if="phase.failure !== null" class="failure" role="alert">
          {{ FAILURE_DETAIL[phase.failure] }}
        </p>

        <div class="actions">
          <button
            type="submit"
            class="pill pill--strong"
            :disabled="!canAdd"
            :aria-busy="saving ? 'true' : 'false'"
          >
            {{ addLabel }}
          </button>
          <a class="pill" href="/">대시보드로 이동</a>
        </div>
        <p class="aside">{{ SAVE_ONLY_ON_CLICK }}</p>
      </form>
    </template>
  </div>
</template>

<style scoped>
.collect {
  display: grid;
  gap: 16px;
}

.choose {
  display: grid;
  gap: 12px;
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

/* 드로어의 `.pill` 과 같은 토큰 (승인된 디자인). 링크도 같은 모양으로 그린다. */
.pill {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 40px;
  padding: 8px 14px;
  border: 1px solid var(--pill-border-color);
  border-radius: var(--radius-control);
  background: var(--pill-surface-color);
  color: var(--pill-text-color);
  font: 12px var(--font-mono);
  text-decoration: none;
}

.pill:hover:not(:disabled) {
  background: var(--pill-surface-hover-color);
}

.pill:disabled {
  cursor: not-allowed;
  opacity: 0.4;
}

.pill--strong {
  border-color: var(--accent-strong-color);
  background: var(--accent-strong-color);
  color: var(--accent-strong-text-color);
}

.pill--strong:hover:not(:disabled) {
  background: var(--accent-strong-color);
  filter: brightness(1.08);
}

.duplicate {
  margin: 0;
  color: var(--text-muted-color);
  font-size: 13px;
}

.failure {
  margin: 0;
  color: var(--error-text-color);
  font-size: 13px;
}

.aside {
  margin: 0;
  color: var(--text-dim-color);
  font-size: 12px;
}
</style>
