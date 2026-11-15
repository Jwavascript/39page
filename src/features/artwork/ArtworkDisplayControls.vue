<script setup lang="ts">
import { DEFAULT_ARTWORK_DISPLAY, type ArtworkDisplay } from '@/shared/types/artwork'

const display = defineModel<ArtworkDisplay>({ required: true })
defineProps<{ disabled?: boolean }>()

function update(key: 'positionX' | 'positionY' | 'zoom', event: Event): void {
  display.value = { ...display.value, [key]: Number((event.target as HTMLInputElement).value) }
}
</script>

<template>
  <fieldset class="display-controls" :disabled="disabled">
    <legend>표시 영역 조정 · 저장 전</legend>
    <label
      >맞춤
      <select
        :value="display.fit"
        aria-label="이미지 맞춤"
        @change="
          display = {
            ...display,
            fit: ($event.target as HTMLSelectElement).value as ArtworkDisplay['fit'],
          }
        "
      >
        <option value="cover">채우기 (Cover)</option>
        <option value="contain">전체 보기 (Contain)</option>
      </select>
    </label>
    <label
      >가로 위치 {{ Math.round(display.positionX) }}%
      <input
        type="range"
        aria-label="가로 위치"
        min="0"
        max="100"
        step="1"
        :value="display.positionX"
        @input="update('positionX', $event)"
      />
    </label>
    <label
      >세로 위치 {{ Math.round(display.positionY) }}%
      <input
        type="range"
        aria-label="세로 위치"
        min="0"
        max="100"
        step="1"
        :value="display.positionY"
        @input="update('positionY', $event)"
      />
    </label>
    <label
      >확대율 {{ display.zoom.toFixed(2) }}×
      <input
        type="range"
        aria-label="확대율"
        min="1"
        max="3"
        step="0.05"
        :value="display.zoom"
        @input="update('zoom', $event)"
      />
    </label>
    <button type="button" @click="display = { ...DEFAULT_ARTWORK_DISPLAY }">기본값 초기화</button>
    <p>미리보기에서 끌어 위치를 조절할 수 있어요. 원본 파일과 GIF 움직임은 유지됩니다.</p>
  </fieldset>
</template>

<style scoped>
.display-controls {
  display: grid;
  min-width: 0;
  margin: 0;
  gap: 8px;
  border: 1px solid var(--drawer-head-border-color);
  font: 12px/1.5 var(--font-body);
}
label {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
input {
  flex: 1;
  min-width: 80px;
  min-height: 44px;
}
select,
button {
  min-height: 44px;
  max-width: 100%;
  color: var(--pill-text-color);
  background: var(--pill-surface-color);
  border: 1px solid var(--pill-border-color);
  border-radius: var(--radius-control);
}
p {
  margin: 0;
  overflow-wrap: anywhere;
}
</style>
