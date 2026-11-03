<script setup lang="ts">
/**
 * 데크 위젯 — 하나의 안정적인 인스턴스.
 *
 * 두 테마의 데크 아트를 **모두 마운트한 상태로** 두고, 활성 테마의 것만
 * 보여준다. 테마 전환으로 이 위젯이나 자식 아트가 언마운트되지 않는다
 * (`docs/decisions/0001-theme-switching-mechanism.md`).
 *
 * 표시 전환은 두 층에서 일어난다.
 *   시각적 표시 → 각 테마의 `deck.css` 가 `:root[data-theme]` 로 `display` 전환
 *   접근성 트리 → 비활성 아트에 `aria-hidden="true"`
 *
 * M2-2: 데크를 눌러 Record Library 를 여는 트리거를 더했다. 열기 버튼은
 * **SVG 밖의 네이티브 `<button>`** 이며, 승인된 디자인의 `.disc-open` /
 * `.cassette-open` 위치를 따른다. DeckArt SVG 는 수정하지 않았다.
 *
 * 비활성 테마의 버튼은 `display: none` 이므로 Tab 순서에서도 빠진다.
 *
 * M4: 재생 상태에 따라 루트에 `is-playing` / `is-paused` 를 건다. LP 회전 ·
 * 테이프 릴 회전 · 톤암 하강 · 전원 램프가 그 클래스를 본다 (테마별
 * `deck.css`). **`playback` store 만 읽는다** — 플레이어를 직접 부르지
 * 않는다 (`AGENTS.md` 규칙 4). 승인된 디자인은 같은 클래스를
 * `.workspace` 에 걸지만, 우리는 이 위젯 루트에 걸어
 * `DashboardShell` / `WidgetHost` 를 건드리지 않는다.
 *
 * 단일 루트를 유지한다. `WidgetHost` 가 `grid-area` 를 루트에 적용한다.
 */
import { computed, inject } from 'vue'

import { LIBRARY_DRAWER } from '@/features/library/drawerController'
import KawaiiCassetteDeckArt from '@/themes/kawaii-synth-cassette/DeckArt.vue'
import MonoVinylDeckArt from '@/themes/mono-vinyl/DeckArt.vue'
import { THEMES } from '@/themes'
import { usePlaybackStore } from '@/stores/playback'
import { useThemeStore } from '@/stores/theme'

const theme = useThemeStore()
const playback = usePlaybackStore()
const drawer = inject(LIBRARY_DRAWER, null)

/** 각 트리거는 **자기 테마의** 문구를 쓴다. 숨겨진 쪽도 올바른 이름을 갖는다. */
const monoCopy = THEMES['mono-vinyl'].deck
const kawaiiCopy = THEMES['kawaii-synth-cassette'].deck

/** 데크 아래 안내는 활성 테마의 문구다. */
const copy = computed(() => theme.metadata.deck)
const isOpen = computed<boolean>(() => drawer?.isOpen.value ?? false)

/**
 * 톤암이 내려와 있는 상태.
 *
 * 승인된 디자인은 `is-playing` 과 `is-paused` 둘 다에서 톤암을 내린다 —
 * 멈춰 있어도 바늘은 판 위에 있다.
 */
const isPaused = computed<boolean>(() => playback.playerState === 'paused')

function openLibrary(): void {
  drawer?.open()
}
</script>

<template>
  <div class="deck-widget" :class="{ 'is-playing': playback.isPlaying, 'is-paused': isPaused }">
    <div class="deck-graphic">
      <!--
        두 아트가 항상 함께 존재한다. v-if 로 교체하지 않는다.
        :key 를 쓰지 않으므로 테마가 바뀌어도 재마운트되지 않는다.
      -->
      <MonoVinylDeckArt :aria-hidden="theme.current !== 'mono-vinyl' || undefined" />
      <KawaiiCassetteDeckArt
        :aria-hidden="theme.current !== 'kawaii-synth-cassette' || undefined"
      />

      <!--
        열기 버튼. 네이티브 button 이므로 Tab / Enter / Space 가 기본 동작한다.
        위치는 테마별로 다르다 (LP 는 원형, 카세트는 사각).
      -->
      <button
        v-if="drawer !== null"
        type="button"
        class="deck-open deck-open--mono-vinyl"
        :aria-label="monoCopy.openLabel"
        :aria-expanded="isOpen"
        :aria-controls="drawer.drawerId"
        @click="openLibrary"
      >
        <span class="deck-open-hint">{{ monoCopy.openHint }}</span>
      </button>
      <button
        v-if="drawer !== null"
        type="button"
        class="deck-open deck-open--kawaii-synth-cassette"
        :aria-label="kawaiiCopy.openLabel"
        :aria-expanded="isOpen"
        :aria-controls="drawer.drawerId"
        @click="openLibrary"
      >
        <span class="deck-open-hint">{{ kawaiiCopy.openHint }}</span>
      </button>
    </div>

    <!-- 데크 아래 안내. Drawer 가 실제로 동작하므로 이제 표시한다. -->
    <p v-if="drawer !== null" class="deck-hint">
      {{ copy.hintMark }} <strong>{{ copy.hintStrong }}</strong> {{ copy.hintRest }}
    </p>
  </div>
</template>

<style scoped>
.deck-widget {
  min-width: 0;
  width: 100%;
}

/*
 * 승인된 디자인의 `.deck-graphic` 값을 따른다.
 * 그림자는 테마 토큰이 결정한다 (mono / kawaii 가 다르다).
 */
.deck-graphic {
  position: relative;
  width: 100%;
  filter: var(--deck-shadow);
}

/*
 * 열기 버튼. 기본은 숨김이고 활성 테마의 것만 보인다.
 * 숨겨진 버튼은 Tab 순서에서도 빠진다.
 */
.deck-open {
  position: absolute;
  display: none;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--deck-open-text-color);
}

/* 승인된 디자인의 `.disc-open` 위치와 표현. */
:root[data-theme='mono-vinyl'] .deck-open--mono-vinyl {
  display: flex;
  top: 10.6%;
  left: 13.9%;
  width: 48.9%;
  height: 77%;
  border-radius: var(--radius-circle);
}

:root[data-theme='mono-vinyl'] .deck-open--mono-vinyl:hover,
:root[data-theme='mono-vinyl'] .deck-open--mono-vinyl:focus-visible {
  background: var(--deck-open-hover-surface-color);
  outline: var(--deck-open-focus-ring-width) solid var(--deck-open-focus-ring-color);
  outline-offset: var(--deck-open-focus-ring-offset);
}

/* 승인된 디자인의 `.cassette-open` 위치와 표현. */
:root[data-theme='kawaii-synth-cassette'] .deck-open--kawaii-synth-cassette {
  display: flex;
  top: 25%;
  left: 16%;
  width: 68%;
  height: 57%;
}

:root[data-theme='kawaii-synth-cassette'] .deck-open--kawaii-synth-cassette:focus-visible {
  outline: var(--deck-open-focus-ring-width) solid var(--deck-open-focus-ring-color);
  outline-offset: var(--deck-open-focus-ring-offset);
}

/* 툴팁. hover / focus 에서만 드러난다. */
.deck-open-hint {
  padding: 10px 12px;
  border: 1px solid var(--deck-open-hint-border-color);
  background: var(--deck-open-hint-surface-color);
  font: 12px var(--font-mono);
  letter-spacing: 0.07em;
  opacity: 0;
  transform: translateY(5px);
  transition:
    opacity var(--duration-hint) ease,
    transform var(--duration-hint) ease;
}

.deck-open:hover .deck-open-hint,
.deck-open:focus-visible .deck-open-hint {
  opacity: 1;
  transform: none;
}

/* 승인된 디자인의 `.deck-hint` 값을 따른다. */
.deck-hint {
  margin: 5px 0 0;
  color: var(--deck-hint-text-color);
  font: 12px var(--font-mono);
  letter-spacing: 0.01em;
  text-align: center;
}

.deck-hint strong {
  color: var(--deck-hint-strong-text-color);
  font-weight: 500;
}
</style>
