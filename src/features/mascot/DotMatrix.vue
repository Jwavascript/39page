<script setup lang="ts">
/**
 * 도트 매트릭스 렌더러.
 *
 * 패턴 데이터를 받아 CSS Grid 로 그린다. 패턴을 모르고, 어떤 캐릭터인지도
 * 모른다 — 데이터와 렌더링의 분리를 유지한다.
 *
 * SVG·Canvas 대신 CSS Grid 를 쓴 이유: 승인된 디자인이 그렇게 구현되어
 * 있고(`.mascot-screen`), 도트 개수가 192개뿐이라 가장 단순하다.
 *
 * 색과 디스플레이 스타일은 테마 토큰이 결정한다. 이 컴포넌트에 테마별
 * 분기가 없다.
 */
import { computed } from 'vue'

import { patternSize, type DotPattern } from './patterns'

const props = defineProps<{ pattern: DotPattern }>()

const size = computed(() => patternSize(props.pattern))

/** 행을 펼쳐 도트 하나하나로 만든다. */
const dots = computed(() =>
  props.pattern.flatMap((row, rowIndex) =>
    [...row].map((cell, columnIndex) => ({
      key: `${rowIndex}-${columnIndex}`,
      on: cell === '1',
    })),
  ),
)
</script>

<template>
  <!--
    도트는 장식이다. 보조기기가 192개 노드를 읽지 않도록 숨긴다.
    의미는 옆의 상태 문구가 전달한다.
  -->
  <div
    class="dot-matrix"
    aria-hidden="true"
    :style="{ '--dot-columns': size.columns }"
    :data-columns="size.columns"
    :data-rows="size.rows"
  >
    <span
      v-for="dot in dots"
      :key="dot.key"
      class="dot"
      :class="{ 'is-on': dot.on }"
      :data-on="dot.on ? 'true' : 'false'"
    />
  </div>
</template>

<style scoped>
/* 승인된 디자인의 `.mascot-screen` 값을 따른다. */
.dot-matrix {
  display: grid;
  flex: none;
  grid-auto-rows: 5px;
  grid-template-columns: repeat(var(--dot-columns), 5px);
  align-content: center;
  justify-content: center;
  padding: 7px 10px;
  border: 1px solid var(--mascot-screen-border-color);
  background: var(--mascot-screen-surface-color);
  box-shadow: var(--mascot-screen-shadow);
  gap: 3px;
}

/* 승인된 디자인의 `.mascot-dot` 값을 따른다. */
.dot {
  width: 5px;
  height: 5px;
  border-radius: var(--radius-circle);
  background: transparent;
}

.dot.is-on {
  background: var(--mascot-dot-color);
}

/* 좁은 화면에서 도트를 줄인다. 승인된 디자인의 600px 규칙이다. */
@media (max-width: 600px) {
  .dot-matrix {
    grid-auto-rows: 4px;
    grid-template-columns: repeat(var(--dot-columns), 4px);
    gap: 2px;
  }

  .dot {
    width: 4px;
    height: 4px;
  }
}
</style>
