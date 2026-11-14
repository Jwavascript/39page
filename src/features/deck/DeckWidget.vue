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
 * M7: 그 버튼이 여는 것이 **트랙 드로어에서 플레이리스트 위젯으로** 바뀌었다.
 * 실기기에서 "lp판을 누르면 최소화 되었던 playlist 위젯이 펼쳐지게" 로
 * 요청받았다. 트랙 드로어는 플레이리스트 타일을 눌러서 연다.
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
 * M6-6: 아트에 그려져 있던 ▶ / ■ 를 **동작하게** 했다. 실기기 검증에서 두 번
 * 보고된 문제다 (`M6_PLAN.md` §5-a). 열기 버튼과 **같은 방식**으로, SVG 밖의
 * 네이티브 `<button>` 을 승인된 아트의 컨트롤 위에 겹친다. DeckArt SVG 는
 * 수정하지 않았다 (규칙 6). 판단은 `useDeckTransport` 가 하고 이 컴포넌트는
 * 자리와 이름만 정한다 (규칙 3).
 *
 * M11-7B — 한 열 배치(700px 이하)에서는 **작은 데크 띠**가 된다 (ADR 0030 · 모바일). 승인된 아트를
 * 자르거나 고치지 않고 **통째로 줄여** 왼쪽에 두고, 안내 문구가 그 옆에 선다. 영상과 재생 조작이 첫
 * 화면에 들어오게 하면서 테마의 얼굴(LP · 카세트, 회전 연출)은 남긴다. 줄어든 아트 위의 재생 키는
 * 12px 남짓이라 누를 수 없으므로 띠에서는 끈다 — 재생 조작은 바로 아래 영상 밑에 있다. 띠 전체가
 * "음악 보관함 열기" 다.
 *
 * 단일 루트를 유지한다. `WidgetHost` 가 `grid-area` 를 루트에 적용한다.
 */
import { computed, inject } from 'vue'

import { ARCHIVE } from '@/features/archive/archiveController'
import { useDeckTransport } from '@/features/deck/useDeckTransport'
import KawaiiCassetteDeckArt from '@/themes/kawaii-synth-cassette/DeckArt.vue'
import MonoVinylDeckArt from '@/themes/mono-vinyl/DeckArt.vue'
import { THEMES } from '@/themes'
import { usePlaybackStore } from '@/stores/playback'
import { useThemeStore } from '@/stores/theme'

const theme = useThemeStore()
const playback = usePlaybackStore()
const archive = inject(ARCHIVE, null)

/** 각 트리거는 **자기 테마의** 문구를 쓴다. 숨겨진 쪽도 올바른 이름을 갖는다. */
const monoCopy = THEMES['mono-vinyl'].deck
const kawaiiCopy = THEMES['kawaii-synth-cassette'].deck

/** 데크 아래 안내는 활성 테마의 문구다. */
const copy = computed(() => theme.metadata.deck)
const isOpen = computed<boolean>(
  () => (archive?.isOpen.value ?? false) && archive?.tab.value === 'music',
)

/**
 * 톤암이 내려와 있는 상태.
 *
 * 승인된 디자인은 `is-playing` 과 `is-paused` 둘 다에서 톤암을 내린다 —
 * 멈춰 있어도 바늘은 판 위에 있다.
 */
const isPaused = computed<boolean>(() => playback.playerState === 'paused')

/**
 * 데크에 그려진 ▶ / ■ 의 동작 (M6-6).
 *
 * 이 위젯은 여전히 플레이어를 직접 부르지 않는다. 명령은 composable 이
 * 코디네이터에게 넘긴다 (`AGENTS.md` 규칙 4).
 */
const transport = useDeckTransport()

/** 플레이리스트 위젯을 펼치거나 접는다 (M7). */
/**
 * LP · 카세트를 누르면 **음악 보관함**이 열린다 (M11-3 — 이전에는 플레이리스트 선반을 펼쳤다).
 * 데스크톱에서 눌러도 화면이 거의 바뀌지 않던 것(U2)과 세로 화면에서 선반이 재생 화면을 밀던 것(U19)을
 * 함께 푼다. 보관함은 플레이어를 덮지 않는다 (ADR 0027).
 */
function openLibrary(): void {
  archive?.open('music')
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
        v-if="archive !== null"
        type="button"
        class="deck-open deck-open--mono-vinyl"
        :aria-label="monoCopy.openLabel"
        :aria-expanded="isOpen"
        :aria-controls="archive.panelId"
        @click="openLibrary"
      >
        <span class="deck-open-hint">{{ monoCopy.openHint }}</span>
      </button>
      <button
        v-if="archive !== null"
        type="button"
        class="deck-open deck-open--kawaii-synth-cassette"
        :aria-label="kawaiiCopy.openLabel"
        :aria-expanded="isOpen"
        :aria-controls="archive.panelId"
        @click="openLibrary"
      >
        <span class="deck-open-hint">{{ kawaiiCopy.openHint }}</span>
      </button>

      <!--
        아트에 그려진 트랜스포트 (M6-6).

        **열기 버튼보다 뒤에 둔다.** 둘 다 절대 위치이므로 같은 z-index 에서는
        나중 형제가 위에 온다. Mono Vinyl 의 `START / STOP` 키 상자가 LP 열기
        원과 모서리에서 겹치는데, 이 순서가 트랜스포트를 이기게 한다.

        비활성 테마의 키는 `display: none` 이라 Tab 순서에서도 빠진다.
      -->
      <button
        type="button"
        class="deck-key deck-key--mono-vinyl"
        :aria-label="transport.toggleLabel.value"
        :title="transport.toggleLabel.value"
        @click="transport.toggle()"
      ></button>
      <button
        type="button"
        class="deck-key deck-key--kawaii-stop"
        :aria-label="transport.pauseLabel.value"
        :title="transport.pauseLabel.value"
        @click="transport.pause()"
      ></button>
      <button
        type="button"
        class="deck-key deck-key--kawaii-play"
        :aria-label="transport.playLabel.value"
        :title="transport.playLabel.value"
        @click="transport.play()"
      ></button>
    </div>

    <!-- 데크 아래 안내. 트리거가 실제로 동작하므로 표시한다. -->
    <p v-if="archive !== null" class="deck-hint">
      {{ copy.hintMark }} <strong>{{ copy.hintStrong }}</strong> {{ copy.hintRest }}
    </p>

    <!--
      재생 요청이 거절된 이유 (M6-6).

      사용자가 누른 자리에 띄운다. 가려짐 때문에 거절된 경우는 비워 두는데,
      그때는 플레이어의 `.status` 가 이미 사유를 말한다 (`useDeckTransport`).
    -->
    <p v-if="transport.notice.value !== ''" class="deck-notice" role="status" aria-live="polite">
      {{ transport.notice.value }}
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

/*
 * 누르는 순간 눌린 모양 (M11-3 U2) — 데스크톱에서 눌러도 시각 변화가 없던 문제. 보관함이 열리면서
 * 화면이 바뀌지만, 누른 자리에서도 반응한다. 움직임을 줄이도록 설정한 사용자에게는 크기를 바꾸지 않는다.
 */
.deck-open:active {
  background: var(--deck-open-hover-surface-color);
}

@media (prefers-reduced-motion: no-preference) {
  .deck-open {
    transition: transform var(--duration-hint) ease;
  }

  .deck-open:active {
    transform: scale(0.985);
  }
}

:root[data-theme='mono-vinyl'] .deck-open--mono-vinyl:focus-visible {
  background: var(--deck-open-hover-surface-color);
  outline: var(--deck-open-focus-ring-width) solid var(--deck-open-focus-ring-color);
  outline-offset: var(--deck-open-focus-ring-offset);
}

/* 마우스를 올릴 수 있는 기기에서만 hover 표현 — 터치 뒤 덮개가 남지 않게 (M11 U18). */
@media (hover: hover) {
  :root[data-theme='mono-vinyl'] .deck-open--mono-vinyl:hover {
    background: var(--deck-open-hover-surface-color);
    outline: var(--deck-open-focus-ring-width) solid var(--deck-open-focus-ring-color);
    outline-offset: var(--deck-open-focus-ring-offset);
  }
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

/* 툴팁은 키보드 포커스와, **마우스가 있는 기기**의 hover 에서만 — 터치 뒤 남지 않게 (M11 U18). */
.deck-open:focus-visible .deck-open-hint {
  opacity: 1;
  transform: none;
}

@media (hover: hover) {
  .deck-open:hover .deck-open-hint {
    opacity: 1;
    transform: none;
  }
}

/*
 * 아트에 그려진 트랜스포트 키 (M6-6).
 *
 * 좌표는 승인된 SVG 에서 그대로 읽은 값이다. `.deck-art` 가
 * `width: 100%; height: auto` 이고 viewBox 가 `0 0 900 570` 이므로 퍼센트가
 * viewBox 단위에 선형으로 대응한다 — `.deck-open` 과 같은 방식이다.
 *
 * 상자를 글자보다 **넉넉하게** 잡는다. 카세트의 `■ STOP` / `▶ PLAY` 는
 * 15px 글자라 글자 폭(약 54 단위)만 덮으면 데크가 400px 일 때 터치 목표가
 * 24px 아래로 내려간다. 84 × 60 단위로 잡으면 같은 폭에서 약 37 × 27px 이
 * 된다. 넓혀도 겹치는 것이 없다 — 카세트 열기 버튼은 y 467 에서 끝나고
 * 본체는 y 536 까지다.
 */
.deck-key {
  position: absolute;
  display: none;
  padding: 0;
  border: 0;
  background: transparent;
}

@media (hover: hover) {
  .deck-key:hover {
    background: var(--deck-open-hover-surface-color);
  }
}

/*
 * 터치 목표 44px (M11 U16). 그려진 키는 데크 폭에 비례해 작아진다(폰에서 약 26–37px). 키 모양은 그대로
 * 두고 **누를 수 있는 자리만** 보이지 않는 의사 요소로 넓힌다. 카세트의 두 키 사이는 넓혀도 겹치지
 * 않는다 (360px 데크에서 키 사이 약 48px).
 */
.deck-key::after {
  position: absolute;
  top: 50%;
  left: 50%;
  width: max(100%, 44px);
  height: max(100%, 44px);
  content: '';
  transform: translate(-50%, -50%);
}

.deck-key:focus-visible {
  outline: var(--deck-open-focus-ring-width) solid var(--deck-open-focus-ring-color);
  outline-offset: var(--deck-open-focus-ring-offset);
}

/*
 * Mono Vinyl 의 `START / STOP` 금속 키. 원본 좌표는 cx 103 · cy 478 이고
 * 바깥 히트 원이 r 36 이다 → x 67‥139, y 442‥514.
 *
 * 키가 **하나뿐이므로 토글**이다. 레퍼런스의 글자도 `START / STOP` 이라
 * 한 키가 두 일을 한다는 뜻이 이미 들어 있다.
 */
:root[data-theme='mono-vinyl'] .deck-key--mono-vinyl {
  display: block;
  top: 77.54%;
  left: 7.44%;
  width: 8%;
  height: 12.63%;
  border-radius: var(--radius-circle);
}

/* 카세트의 `■ STOP` 글자 (x 70, y 504) 를 덮는다 → x 58‥142, y 470‥530. */
:root[data-theme='kawaii-synth-cassette'] .deck-key--kawaii-stop {
  display: block;
  top: 82.46%;
  left: 6.44%;
  width: 9.33%;
  height: 10.53%;
}

/* 카세트의 `▶ PLAY` 글자 (x 274, y 504) 를 덮는다 → x 262‥346. */
:root[data-theme='kawaii-synth-cassette'] .deck-key--kawaii-play {
  display: block;
  top: 82.46%;
  left: 29.11%;
  width: 9.33%;
  height: 10.53%;
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

/* 재생 요청이 거절된 이유 (M6-6). 사용자가 뭔가 해야 하므로 경고 색이다. */
.deck-notice {
  margin: 6px 0 0;
  color: var(--status-warning-text-color);
  font: 11px/1.6 var(--font-mono);
  text-align: center;
}

/*
 * 700px 이하 — **작은 데크 띠** (M11-7B). `WidgetHost` 의 한 열 배치와 같은 경계다.
 *
 * 아트는 SVG 통째로 줄어든다(자르지 않는다 — viewBox 가 비율을 지킨다). 회전 · 릴 연출은 그대로다.
 */
@media (max-width: 700px) {
  .deck-widget {
    display: grid;
    align-items: center;
    column-gap: 12px;
    grid-template-columns: clamp(118px, 36%, 164px) minmax(0, 1fr);
  }

  .deck-graphic {
    grid-row: 1 / span 2;
  }

  /* 띠의 아트 전체가 "음악 보관함 열기" 다. 두 테마 모두 아트 전체를 덮는다. */
  :root[data-theme='mono-vinyl'] .deck-open--mono-vinyl,
  :root[data-theme='kawaii-synth-cassette'] .deck-open--kawaii-synth-cassette {
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    border-radius: var(--radius-control);
  }

  /* 툴팁은 아트보다 크다 — 옆의 안내 문구가 같은 말을 한다. */
  .deck-open-hint {
    display: none;
  }

  /*
   * 줄어든 아트 위의 재생 키는 누를 수 없는 크기다(약 12px). 44px 누름 영역을 그대로 두면 "보관함
   * 열기" 와 겹쳐 잘못 눌린다. 띠에서는 끈다 — 재생 · 일시정지는 바로 아래 영상 밑에 있다.
   */
  :root[data-theme='mono-vinyl'] .deck-key--mono-vinyl,
  :root[data-theme='kawaii-synth-cassette'] .deck-key--kawaii-stop,
  :root[data-theme='kawaii-synth-cassette'] .deck-key--kawaii-play {
    display: none;
  }

  .deck-hint,
  .deck-notice {
    margin: 0;
    text-align: left;
  }

  .deck-hint {
    line-height: 1.5;
  }
}
</style>
