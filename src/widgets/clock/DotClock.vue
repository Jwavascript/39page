<script setup lang="ts">
/**
 * 도트 매트릭스 숫자 렌더러.
 *
 * 글자열을 받아 SVG 원으로 그린다. 시간도 시간대도 모른다 — 좌표 계산은
 * `dotGlyphs.ts` 의 순수 함수가 하고, 이 컴포넌트는 그리기만 한다
 * (`AGENTS.md` 규칙 3).
 *
 * 꺼진 도트도 함께 그린다. 승인된 디자인의 전광판 질감이다
 * (`.time-off`, opacity 0.18).
 *
 * `role="img"` + `aria-label` 이므로 보조기기는 원 하나하나를 읽지 않는다.
 */
import { computed } from 'vue'

import { DOT_RADIUS, layoutDotText, VIEWBOX_HEIGHT } from './dotGlyphs'

const props = defineProps<{
  /** 그릴 글자열. 숫자와 `:` 만 도트가 된다. */
  text: string
  /** 보조기기에 읽힐 이름. */
  label: string
}>()

const layout = computed(() => layoutDotText(props.text))
const viewBox = computed(() => `0 0 ${String(layout.value.width)} ${String(VIEWBOX_HEIGHT)}`)
</script>

<template>
  <svg class="clock-svg" :viewBox="viewBox" role="img" :aria-label="label">
    <circle
      v-for="(circle, index) in layout.circles"
      :key="index"
      :cx="circle.cx"
      :cy="circle.cy"
      :r="DOT_RADIUS"
      :class="circle.on ? 'time-dot' : 'time-off'"
    />
  </svg>
</template>

<style scoped>
/* 승인된 디자인의 `.clock-svg` 값을 따른다. */
.clock-svg {
  display: block;
  width: 100%;
  height: auto;
  margin: 17px 0 5px;
  filter: var(--clock-glow);
}

/* 승인된 디자인의 `.time-dot` / `.time-off` 값을 따른다. */
.time-dot {
  fill: var(--clock-dot-color);
}

.time-off {
  fill: var(--clock-dot-off-color);
  opacity: var(--clock-dot-off-opacity);
}
</style>
