<script setup lang="ts">
/**
 * 시계 위젯 (M4-1).
 *
 * 승인된 디자인의 `.clock-line` · `.clock-svg` · `.clock-date` · `.rule`
 * 구조를 따른다.
 *
 * 책임은 **타이머와 조립**뿐이다. 표시값 계산은 `clockFormat.ts`,
 * 도트 그리기는 `DotClock.vue` 가 한다 (`AGENTS.md` 규칙 3).
 *
 * 재생·테마·라이브러리를 모른다. store 를 하나도 읽지 않는다.
 *
 * 단일 루트를 유지한다. `WidgetHost` 가 `grid-area` 를 루트에 적용한다.
 */
import { onMounted, onUnmounted, ref } from 'vue'

import DotClock from './DotClock.vue'
import { clockAriaLabel, CLOCK_REGION_LABEL, readClock, type ClockReading } from './clockFormat'

/** 갱신 주기. 승인된 디자인의 `setInterval(updateClock, 15000)` 과 같다. */
const REFRESH_INTERVAL_MS = 15_000

const reading = ref<ClockReading>(readClock(new Date()))

/**
 * 타이머 핸들. 반응형이 아니다 — 화면에 쓰이지 않는 값이다.
 *
 * `number | null` 로 두고 정리 시 비운다. 재마운트되면 `onMounted` 가 다시
 * 건다. 같은 인스턴스에 두 개가 걸리는 일은 없다.
 */
let timer: ReturnType<typeof setInterval> | null = null

function refresh(): void {
  reading.value = readClock(new Date())
}

/**
 * 탭이 돌아올 때 다시 읽는다.
 *
 * 브라우저는 백그라운드 탭의 타이머를 분 단위까지 늦춘다. 그대로 두면
 * 돌아왔을 때 지난 시각이 한동안 보인다. 시계에서는 그것이 바로 결함이다.
 */
function onVisibilityChange(): void {
  if (document.visibilityState === 'visible') refresh()
}

onMounted(() => {
  refresh()
  timer = setInterval(refresh, REFRESH_INTERVAL_MS)
  document.addEventListener('visibilitychange', onVisibilityChange)
})

onUnmounted(() => {
  if (timer !== null) clearInterval(timer)
  timer = null
  document.removeEventListener('visibilitychange', onVisibilityChange)
})
</script>

<template>
  <section class="clock-widget">
    <p class="clock-line">
      <span>{{ CLOCK_REGION_LABEL }}</span>
      <span class="clock-period">{{ reading.dayPeriod }}</span>
    </p>

    <DotClock :text="reading.time" :label="clockAriaLabel(reading)" />

    <p class="clock-date">{{ reading.date }}</p>

    <!-- 승인된 디자인의 정보 열 구분선. 시계 블록 끝에 온다. -->
    <div class="rule" />
  </section>
</template>

<style scoped>
.clock-widget {
  min-width: 0;
}

/* 승인된 디자인의 `.clock-line` 값을 따른다. */
.clock-line {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin: 0;
  color: var(--clock-label-text-color);
  font: 11px var(--font-mono);
  letter-spacing: 0.05em;
}

/* 승인된 디자인의 `.clock-date` 값을 따른다. */
.clock-date {
  margin: 0;
  padding: 12px 0 20px;
  color: var(--clock-date-text-color);
  font: clamp(11px, 1.03vw, 15px) var(--font-mono);
  letter-spacing: 0.13em;
  white-space: nowrap;
}

/* 승인된 디자인의 `.rule` 값을 따른다. */
.rule {
  height: 1px;
  background: var(--rule-color);
}

/* 승인된 디자인의 650px 규칙. */
@media (max-width: 650px) {
  .clock-date {
    letter-spacing: 0.04em;
  }
}
</style>
