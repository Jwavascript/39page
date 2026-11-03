<script setup lang="ts">
/**
 * 마스코트 패널 — 정적 표시.
 *
 * 승인된 디자인의 `.mascot-panel` 구조를 따른다: 도트 스크린 · 정보 영역 ·
 * 코너 장식.
 *
 * **정적이다.** 눈 깜빡임, 호흡, 재생 중 반응, 상태별 문구 전환은 M4 다.
 * 아직 이벤트에 연결되지 않은 동적 상태를 연출하지 않는다.
 *
 * 패턴과 문구는 테마 메타데이터·패턴 데이터에서 가져온다. 컴포넌트 구조는
 * 두 테마가 공통이며, 색과 디스플레이 스타일만 테마 토큰이 바꾼다.
 *
 * 단일 루트를 유지한다. `WidgetHost` 가 `grid-area` 를 루트에 적용한다.
 */
import { computed } from 'vue'

import DotMatrix from '@/features/mascot/DotMatrix.vue'
import { MASCOT_PATTERNS } from '@/features/mascot/patterns'
import { useThemeStore } from '@/stores/theme'

const theme = useThemeStore()

const pattern = computed(() => MASCOT_PATTERNS[theme.current])
const mascot = computed(() => theme.metadata.mascot)
</script>

<template>
  <section class="mascot-panel">
    <DotMatrix :pattern="pattern" />

    <div class="mascot-info">
      <span class="mascot-label">COMPANION / 01</span>
      <strong class="mascot-message">{{ mascot.message }}</strong>
      <small class="mascot-sub">{{ mascot.sub }}</small>
    </div>

    <span class="mascot-corner" aria-hidden="true">• • •</span>
  </section>
</template>

<style scoped>
/*
 * 승인된 디자인의 `.mascot-panel` 값을 따른다.
 * 레퍼런스의 `margin-top: 26px` 은 생략했다. 위젯 간 간격은 Grid 의 gap 이
 * 담당하므로 중복된다.
 */
.mascot-panel {
  position: relative;
  display: flex;
  min-height: 112px;
  max-width: 100%;
  align-items: center;
  padding: 13px 22px;
  border: 1px solid var(--mascot-panel-border-color);
  background: var(--mascot-panel-background);
  box-shadow: var(--mascot-panel-shadow);
  gap: 21px;
  overflow: hidden;
}

.mascot-info {
  display: flex;
  min-width: 0;
  flex-direction: column;
  font-family: var(--font-mono);
  gap: 6px;
}

.mascot-label {
  color: var(--mascot-label-text-color);
  font-size: 9px;
  letter-spacing: 0.12em;
}

.mascot-message {
  color: var(--mascot-message-text-color);
  font-size: 13px;
  font-weight: 500;
  letter-spacing: 0.14em;
}

.mascot-sub {
  color: var(--mascot-sub-text-color);
  font-size: 10px;
}

.mascot-corner {
  margin-left: auto;
  align-self: flex-start;
  color: var(--mascot-corner-text-color);
  font-size: 12px;
}

/* 승인된 디자인의 600px 규칙. */
@media (max-width: 600px) {
  .mascot-panel {
    padding: 10px;
    gap: 12px;
  }

  .mascot-sub {
    display: none;
  }
}
</style>
