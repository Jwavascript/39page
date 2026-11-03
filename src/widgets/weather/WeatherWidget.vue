<script setup lang="ts">
/**
 * 날씨 위젯 (M4-2).
 *
 * 승인된 디자인의 `.weather` · `.weather-note` · `.rule` 구조를 따른다.
 * 슬롯 네 개(아이콘 · 기온 · 설명 · 최고/최저)는 어느 상태에서도 같다 —
 * 레이아웃이 흔들리지 않는다.
 *
 * **가짜 날씨를 보여주지 않는다.** 불러오는 중과 실패는 기온 자리에 `--°`
 * 를 두고 설명으로 사정을 말한다 (`MVP_SPEC.md` F7).
 *
 * `.weather-note` 는 프로토타입에서 `디자인 예시 · 실제 API 연결 전` 이던
 * 자리다. 이제 **위치와 출처**를 적는다 — 위치를 명확히 밝혀야 하는 요구를
 * 새 UI 없이 만족시킨다.
 *
 * 단일 루트를 유지한다. `WidgetHost` 가 `grid-area` 를 루트에 적용한다.
 */
import { computed } from 'vue'

import { WEATHER_LOCATION, WEATHER_PROVIDER_LABEL, type WeatherFailureReason } from './weatherApi'
import { weatherLook } from './weatherCodes'
import { useWeather } from './useWeather'

const { state } = useWeather()

/** 기온을 모를 때 그 자리에 둘 값. 숫자처럼 보이지 않아야 한다. */
const UNKNOWN_TEMPERATURE = '--°'

const FAILURE_DESCRIPTION: Readonly<Record<WeatherFailureReason, string>> = {
  network: '날씨를 불러오지 못했어요',
  http: '날씨 제공처가 응답하지 않아요',
  malformed: '날씨 정보가 없어요',
}

const look = computed(() => {
  const value = state.value
  if (value.status === 'ready') return weatherLook(value.reading.code)
  if (value.status === 'loading') return { icon: '·', description: '날씨를 불러오는 중…' }

  return { icon: '!', description: FAILURE_DESCRIPTION[value.reason] }
})

const temperature = computed<string>(() =>
  state.value.status === 'ready'
    ? `${String(state.value.reading.temperature)}°`
    : UNKNOWN_TEMPERATURE,
)

const highLow = computed<string>(() => {
  const value = state.value
  if (value.status !== 'ready') return ''

  return `H ${String(value.reading.high)}° / L ${String(value.reading.low)}°`
})

/** 출처와 위치. 실패했을 때는 다시 시도한다는 사실까지 적는다. */
const note = computed<string>(() => {
  const base = `WEATHER / ${WEATHER_LOCATION.label} · ${WEATHER_PROVIDER_LABEL}`
  return state.value.status === 'error' ? `${base} · 잠시 후 다시 시도합니다` : base
})
</script>

<template>
  <section class="weather-widget">
    <p class="weather" :data-status="state.status">
      <span class="wxicon" aria-hidden="true">{{ look.icon }}</span>
      <span class="temp">{{ temperature }}</span>
      <span class="desc">{{ look.description }}</span>
      <span class="highlow">{{ highLow }}</span>
    </p>

    <p class="weather-note">{{ note }}</p>

    <!-- 승인된 디자인의 정보 열 구분선. 날씨 블록 끝에 온다. -->
    <div class="rule" />
  </section>
</template>

<style scoped>
.weather-widget {
  min-width: 0;
}

/* 승인된 디자인의 `.weather` 값을 따른다. */
.weather {
  display: flex;
  min-height: 66px;
  align-items: center;
  margin: 0;
  font-family: var(--font-mono);
  gap: 13px;
}

/* 승인된 디자인의 `.weather .wxicon` 값을 따른다. */
.wxicon {
  color: var(--weather-icon-text-color);
  font-size: 27px;
  font-weight: 300;
}

/* 승인된 디자인의 `.weather .temp` 값을 따른다. */
.temp {
  color: var(--weather-temp-text-color);
  font-size: 24px;
}

/* 승인된 디자인의 `.weather .desc` 값을 따른다. */
.desc {
  min-width: 0;
  overflow: hidden;
  color: var(--weather-desc-text-color);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 승인된 디자인의 `.weather .highlow` 값을 따른다. */
.highlow {
  margin-left: auto;
  color: var(--weather-highlow-text-color);
  font-size: 11px;
  white-space: nowrap;
}

/* 승인된 디자인의 `.weather-note` 값을 따른다. */
.weather-note {
  margin-top: -4px;
  margin-bottom: 14px;
  color: var(--weather-note-text-color);
  font: 10px var(--font-mono);
}

/* 승인된 디자인의 `.rule` 값을 따른다. */
.rule {
  height: 1px;
  background: var(--rule-color);
}

/* 승인된 디자인의 650px 규칙. */
@media (max-width: 650px) {
  .weather {
    gap: 8px;
  }

  .highlow {
    font-size: 10px;
  }
}
</style>
