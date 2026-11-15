<script setup lang="ts">
/**
 * 39page 기본 앨범아트 (M12, ADR 0032 · ARTWORK_DESIGN §2-3).
 *
 * 썸네일을 쓸 수 없거나(목록 밖 · 오프라인 · 삭제된 영상) 사용자가 "기본 그림" 을 골랐을 때 보인다.
 *
 * 두 테마의 그림을 **둘 다 마운트하고 CSS 로 고른다** — 데크 아트와 같은 방식이다 (ADR 0001). 테마를 바꿔도
 * 이 컴포넌트는 다시 만들어지지 않는다.
 *
 * - Kawaii Synth Cassette: 도트 카세트 (마스코트 패널의 도트 화면을 이었다)
 * - Mono Vinyl: 미니멀한 LP
 *
 * 장식이다 — 곡 제목이 옆에 있다. 보조기기에는 숨긴다.
 */
import DotMatrix from './DotMatrix.vue'
import { CASSETTE_DOTS } from './dotPatterns'
import { THEMES } from '@/themes'

const cassetteLabel = THEMES['kawaii-synth-cassette'].artwork.defaultLabel
const vinylLabel = THEMES['mono-vinyl'].artwork.defaultLabel
</script>

<template>
  <div class="default-artwork" aria-hidden="true">
    <div class="default-artwork__face default-artwork__face--cassette">
      <DotMatrix :pattern="CASSETTE_DOTS" />
      <span class="default-artwork__label">{{ cassetteLabel }}</span>
    </div>
    <div class="default-artwork__face default-artwork__face--vinyl">
      <svg
        class="default-artwork__disc"
        viewBox="0 0 100 100"
        focusable="false"
        role="img"
        aria-label="기본 앨범아트 — LP"
      >
        <circle cx="50" cy="50" r="46" class="disc" />
        <circle cx="50" cy="50" r="40" class="groove" />
        <circle cx="50" cy="50" r="34" class="groove" />
        <circle cx="50" cy="50" r="28" class="groove" />
        <circle cx="50" cy="50" r="15" class="label" />
        <circle cx="50" cy="50" r="1.8" class="hole" />
      </svg>
      <span class="default-artwork__label">{{ vinylLabel }}</span>
    </div>
  </div>
</template>

<!--
  비스코프: 테마 전환이 `:root[data-theme]` 로 고르므로 조상 속성을 봐야 한다. 클래스 이름은 이 컴포넌트에만 있다.
-->
<style>
.default-artwork {
  position: relative;
  width: 100%;
  height: 100%;
  container-type: inline-size;
  overflow: hidden;
}

.default-artwork__face {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 7cqw;
}

.default-artwork__face--cassette {
  background: var(--artwork-card-background);
}

/* 도트 크기는 그림 폭을 따른다 — 72px 띠 · 148px 카드 · 160px 설정 미리보기가 같은 비율이다. */
.default-artwork .default-artwork__face--cassette .dot-matrix {
  --dot-size: 3.4cqw;
  --dot-gap: 1.5cqw;

  padding: 5cqw 6cqw;
}

.default-artwork__face--vinyl {
  background: var(--artwork-frame-surface-color);
}

.default-artwork__disc {
  width: 72%;
  height: auto;
}

.default-artwork__disc .disc {
  fill: #0d0d0c;
  stroke: var(--artwork-frame-border-color);
  stroke-width: 0.6;
}

.default-artwork__disc .groove {
  fill: none;
  stroke: #ffffff14;
  stroke-width: 0.5;
}

.default-artwork__disc .label {
  fill: var(--artwork-message-text-color);
}

.default-artwork__disc .hole {
  fill: #0d0d0c;
}

.default-artwork__label {
  color: var(--artwork-label-text-color);
  font: 6.2cqw / 1 var(--font-mono);
  letter-spacing: 0.08em;
  white-space: nowrap;
}

/* 작은 그림(띠 · 72px)에서는 글자가 읽히지 않는다 — 그림만 둔다. */
@container (max-width: 96px) {
  .default-artwork__label {
    display: none;
  }
}

/* 활성 테마의 그림만 보인다. 첫 페인트 기본은 Kawaii (ADR 0031). */
:root[data-theme='mono-vinyl'] .default-artwork__face--cassette,
:root:not([data-theme='mono-vinyl']) .default-artwork__face--vinyl {
  display: none;
}
</style>
