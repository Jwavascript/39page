<script setup lang="ts">
/**
 * 마스코트 패널 — 정적 표시.
 *
 * 승인된 디자인의 `.mascot-panel` 구조를 따른다: 도트 스크린 · 정보 영역 ·
 * 코너 장식.
 *
 * M4 에서 **재생 상태에 반응**하게 됐다. `playback` store 만 읽는다 —
 * 플레이어도 어댑터도 코디네이터도 모른다 (`AGENTS.md` 규칙 4).
 *   표정  → `moods.ts` 가 상태를 기분으로 옮기고 패턴을 고른다
 *   문구  → 기분별 문구, 없으면 테마 메타데이터의 승인된 문구
 *   호흡  → 재생 중일 때만. `prefers-reduced-motion` 에서 멈춘다
 *
 * 패턴과 문구는 테마 메타데이터·패턴 데이터에서 가져온다. 컴포넌트 구조는
 * 두 테마가 공통이며, 색과 디스플레이 스타일만 테마 토큰이 바꾼다.
 *
 * 단일 루트를 유지한다. `WidgetHost` 가 `grid-area` 를 루트에 적용한다.
 */
import { computed } from 'vue'

import DotMatrix from '@/features/mascot/DotMatrix.vue'
import { mascotMessage, mascotPattern, moodFromPlayerState } from '@/features/mascot/moods'
import { usePlaybackStore } from '@/stores/playback'
import { useThemeStore } from '@/stores/theme'

const theme = useThemeStore()
const playback = usePlaybackStore()

const mood = computed(() => moodFromPlayerState(playback.playerState))
const pattern = computed(() => mascotPattern(theme.current, mood.value))
const mascot = computed(() => theme.metadata.mascot)
const message = computed(() => mascotMessage(theme.current, mood.value, mascot.value.message))
</script>

<template>
  <section class="mascot-panel" :class="{ 'is-playing': playback.isPlaying }" :data-mood="mood">
    <DotMatrix :pattern="pattern" />

    <div class="mascot-info">
      <span class="mascot-label">COMPANION / 01</span>
      <strong class="mascot-message">{{ message }}</strong>
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

/*
 * 승인된 디자인의 호흡 애니메이션.
 *
 * `.workspace.is-playing .mascot-dot.on` 과 같은 뜻이다. 레퍼런스는
 * 워크스페이스에 클래스를 걸지만, 우리 구조에서는 이 패널이 store 를 직접
 * 읽으므로 자기 루트에 건다 — `DashboardShell` 과 `WidgetHost` 를 건드리지
 * 않는다.
 *
 * 도트는 자식 컴포넌트가 소유하므로 `:deep()` 로 닿는다.
 * `prefers-reduced-motion` 에서는 `--duration-breath` 가 0s 가 되고,
 * `base.css` 의 안전망이 한 번 더 막는다.
 */
.mascot-panel.is-playing :deep(.dot.is-on) {
  animation: mascot-breath var(--duration-breath) ease-in-out infinite alternate;
}

@keyframes mascot-breath {
  to {
    opacity: 0.72;
  }
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
