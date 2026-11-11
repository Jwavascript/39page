<script setup lang="ts">
/** 플레이리스트 고르기 — 라디오 묶음. 표현만 맡는다. */
import type { PlaylistChoice } from './useCollect'

defineProps<{
  choices: PlaylistChoice[]
  disabled?: boolean
}>()

const selected = defineModel<string | null>({ required: true })
</script>

<template>
  <fieldset class="picker" :disabled="disabled">
    <legend class="picker-legend">플레이리스트</legend>
    <p v-if="choices.length === 0" class="picker-empty">
      플레이리스트가 없습니다. 대시보드에서 먼저 만들어 주세요.
    </p>
    <label v-for="choice in choices" :key="choice.id" class="choice">
      <input v-model="selected" type="radio" name="collect-playlist" :value="choice.id" />
      <span class="choice-name" dir="auto">{{ choice.name }}</span>
      <span class="choice-count mono">{{ choice.trackCount }}곡</span>
    </label>
  </fieldset>
</template>

<style scoped>
.picker {
  display: grid;
  gap: 6px;
  min-width: 0;
  margin: 0;
  padding: 0;
  border: 0;
}

.picker-legend {
  margin-bottom: 8px;
  padding: 0;
  color: var(--text-muted-color);
  font: 11px var(--font-mono);
  letter-spacing: 0.06em;
}

.picker-empty {
  margin: 0;
  color: var(--text-muted-color);
  font-size: 13px;
}

.choice {
  display: flex;
  gap: 10px;
  align-items: center;
  min-height: 44px;
  padding: 8px 12px;
  border: 1px solid var(--pill-border-color);
  border-radius: var(--radius-control);
  background: var(--pill-surface-color);
  color: var(--pill-text-color);
  cursor: pointer;
}

.choice:has(input:checked) {
  border-color: var(--accent-strong-color);
}

.choice-name {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.choice-count {
  flex: none;
  color: var(--text-dim-color);
  font-size: 11px;
}
</style>
