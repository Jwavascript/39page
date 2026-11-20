<script setup lang="ts">
/**
 * 트랜스포트 컨트롤 — 이전 / 재생·일시정지 / 다음.
 *
 * 승인된 디자인의 `.action-row` · `.controls-left` · `.round` 구조를 따른다.
 * 두 테마가 **같은 컴포넌트**를 쓴다. 색은 M1-2 토큰이 결정한다.
 *
 * **순수 표현 컴포넌트다.** store 도 코디네이터도 어댑터도 모른다. 상태는
 * props 로 받고 의도는 emit 으로 올린다 (`AGENTS.md` 규칙 3).
 *
 * 셔플 · 반복 단추(ADR 0038)는 `repeat` 을 넘길 때만 그린다 — 재생 단추 양옆, 같은 줄이다. 볼륨 · 탐색 바는
 * 만들지 않는다 (M3-0).
 */
import type { RepeatMode } from '@/shared/types'

defineProps<{
  /** `true` 면 ⏸, `false` 면 ▶. */
  showsPause: boolean
  canToggle: boolean
  canPrevious: boolean
  canNext: boolean
  /** 토글 버튼의 접근성 이름. 보이는 기호와 뜻이 같다. */
  toggleLabel: string
  /**
   * `YOUTUBE에서 열기 ↗` 가 가리킬 주소 (M3-5). 없으면 링크를 띄우지 않는다.
   *
   * 주소를 **여기서 만들지 않는다.** 받은 값을 그대로 쓴다. 영상 ID 검증과
   * 인코딩은 `shared/utils/youtube.ts` 가 한다.
   */
  youtubeUrl: string | null
  /** 셔플이 켜져 있는가. */
  shuffle?: boolean
  /** 반복 모드. 넘기지 않으면 셔플 · 반복 단추를 그리지 않는다. */
  repeat?: RepeatMode
  /** 반복 단추의 접근성 이름 — 지금 모드와 누르면 바뀔 모드를 말한다. */
  repeatLabel?: string
}>()

const emit = defineEmits<{
  previous: []
  toggle: []
  next: []
  shuffle: []
  repeat: []
}>()
</script>

<template>
  <!--
    네이티브 <button> 이다. Tab 으로 이동하고 Enter·Space 로 눌린다.
    비활성은 `disabled` 로 표시해 포커스 순서에서도 빠진다.
  -->
  <div class="action-row">
    <!--
      한 줄: 🔀 ⏮ ▶ ⏭ 🔁 (ADR 0038). 셔플 · 반복은 재생 단추 양옆에 둔다 — 줄을 바꾸지 않는다. 카드가 좁아 영상
      그림 옆에 다 들어가지 않으면 카드가 이 줄을 그림 아래 전체 폭으로 내린다 (`NowPlayingCard`).
    -->
    <div class="transport" :class="{ 'has-modes': repeat !== undefined }">
      <!--
        셔플 · 반복의 켜짐은 색만이 아니라 **테두리 · 점 · aria-pressed** 로 알린다. 한 곡 반복은 모서리 "1" 배지.
        큐가 없어도 누를 수 있다 — 다음에 시작하는 재생부터 적용된다.
      -->
      <button
        v-if="repeat !== undefined"
        type="button"
        class="round mode mode--shuffle"
        :class="{ 'is-on': shuffle === true }"
        :aria-pressed="shuffle === true"
        aria-label="셔플"
        :title="shuffle === true ? '셔플 끄기' : '셔플 켜기'"
        @click="emit('shuffle')"
      >
        <svg class="mode-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="M3 7h4l10 10h4" />
          <path d="M18 14l3 3-3 3" />
          <path d="M3 17h4l3-3" />
          <path d="M14 10l3-3h4" />
          <path d="M18 4l3 3-3 3" />
        </svg>
      </button>

      <div class="controls-left">
        <button
          type="button"
          class="round"
          title="이전 곡"
          aria-label="이전 곡"
          :disabled="!canPrevious"
          @click="emit('previous')"
        >
          ⏮
        </button>
        <button
          type="button"
          class="round round--main"
          :title="toggleLabel"
          :aria-label="toggleLabel"
          :disabled="!canToggle"
          @click="emit('toggle')"
        >
          {{ showsPause ? 'Ⅱ' : '▶' }}
        </button>
        <button
          type="button"
          class="round"
          title="다음 곡"
          aria-label="다음 곡"
          :disabled="!canNext"
          @click="emit('next')"
        >
          ⏭
        </button>
      </div>

      <button
        v-if="repeat !== undefined"
        type="button"
        class="round mode mode--repeat"
        :class="{ 'is-on': repeat !== 'off' }"
        :data-repeat="repeat"
        :aria-pressed="repeat !== 'off'"
        :aria-label="repeatLabel ?? '반복'"
        :title="repeatLabel ?? '반복'"
        @click="emit('repeat')"
      >
        <svg class="mode-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="M4 12V9.5A2.5 2.5 0 0 1 6.5 7H20" />
          <path d="M17 4l3 3-3 3" />
          <path d="M20 12v2.5a2.5 2.5 0 0 1-2.5 2.5H4" />
          <path d="M7 20l-3-3 3-3" />
        </svg>
        <span v-if="repeat === 'one'" class="mode-one" aria-hidden="true">1</span>
      </button>
    </div>

    <!--
      승인된 디자인의 `#openYouTube` 다. 재생할 수 없는 영상에서 사용자가
      갈 곳을 남긴다 (`MVP_SPEC.md` F3). 새 창이므로 `noopener noreferrer`
      를 함께 붙인다 — 열린 쪽이 `window.opener` 로 이 페이지를 건드리지
      못하게 한다.
    -->
    <a
      v-if="youtubeUrl !== null"
      class="pill external"
      :href="youtubeUrl"
      target="_blank"
      rel="noopener noreferrer"
    >
      YOUTUBE에서 열기 ↗
    </a>
  </div>
</template>

<style scoped>
/* 승인된 디자인의 `.action-row` 값을 따른다. */
.action-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-top: 16px;
  gap: 8px;
}

/* 재생 단추 한 줄. 셔플 · 반복이 없으면 승인된 디자인의 `.controls-left` 그대로다. */
.transport {
  display: flex;
  align-items: center;
  gap: 8px;
}

/* 승인된 디자인의 `.controls-left` 값을 따른다. */
.controls-left {
  display: flex;
  align-items: center;
  gap: 8px;
}

/*
 * 단추 다섯 개(44 · 44 · 51 · 44 · 44)를 한 줄에 — 사이를 4px 로 좁혀 243px 이다. 카드는 영상 그림 옆 칸이 이보다
 * 좁아지면 이 줄을 그림 아래로 내린다. 그래도 넘치는 극단의 폭에서만 줄을 바꾼다 (가로로 넘치지 않게).
 */
.transport.has-modes,
.transport.has-modes .controls-left {
  gap: 4px;
}

.transport.has-modes {
  flex-wrap: wrap;
}

/* 승인된 디자인의 `.round` 값을 따른다. */
.round {
  display: grid;
  /* 터치 목표 44px (M11 U16 — 승인 디자인의 42px 에서 키웠다). */
  min-width: 44px;
  height: 44px;
  border: 0;
  border-radius: var(--radius-circle);
  background: transparent;
  color: var(--transport-text-color);
  font-size: 20px;
  place-items: center;
}

/* 터치 뒤 hover 표현이 남지 않게 (M11 U18). */
@media (hover: hover) {
  .round:hover:not(:disabled) {
    background: var(--transport-surface-hover-color);
  }

  .pill:hover {
    background: var(--pill-surface-hover-color);
  }
}

.round:disabled {
  cursor: not-allowed;
  opacity: 0.3;
}

.mode {
  position: relative;
  border: 1px solid transparent;
}

.mode-icon {
  width: 20px;
  height: 20px;
  fill: none;
  stroke: currentcolor;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 1.8;
}

/* 한 곡 반복 — 단추 모서리의 작은 "1" 배지. */
.mode-one {
  position: absolute;
  top: 2px;
  right: 2px;
  display: grid;
  min-width: 15px;
  height: 15px;
  padding: 0 3px;
  border-radius: 999px;
  background: var(--accent-strong-color);
  color: var(--accent-strong-text-color);
  font: 700 10px/1 var(--font-mono);
  place-items: center;
}

/* 켜짐 — 테두리 · 강조색 · 아래 점. 색을 못 봐도 테두리와 점으로 구분된다. */
.mode.is-on {
  border-color: var(--transport-main-border-color);
  color: var(--transport-main-text-color);
}

.mode.is-on::after {
  position: absolute;
  bottom: 5px;
  left: 50%;
  width: 4px;
  height: 4px;
  border-radius: var(--radius-circle);
  background: currentcolor;
  content: '';
  transform: translateX(-50%);
}

/* 승인된 디자인의 `.round.main` 값을 따른다. */
.round--main {
  min-width: 51px;
  height: 51px;
  border: 1px solid var(--transport-main-border-color);
  color: var(--transport-main-text-color);
}

/* 승인된 디자인의 `.pill` 값을 따른다. 터치 목표 44px (M11 U16). */
.pill {
  min-height: 44px;
  padding: 7px 12px;
  border: 1px solid var(--pill-border-color);
  border-radius: var(--radius-control);
  background: var(--pill-surface-color);
  color: var(--pill-text-color);
  font: 11px var(--font-mono);
}

/* 링크이므로 기본 밑줄을 걷어낸다. 레퍼런스의 `.pill` 과 같은 모양이 된다. */
.external {
  display: grid;
  flex: none;
  text-decoration: none;
  place-items: center;
}
</style>
