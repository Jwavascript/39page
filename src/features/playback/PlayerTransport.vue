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
 * 여기서 만들지 않는 것: 반복·셔플·볼륨·탐색 바 (M3-0 에서 MVP 제외).
 */
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
}>()

const emit = defineEmits<{ previous: []; toggle: []; next: [] }>()
</script>

<template>
  <!--
    네이티브 <button> 이다. Tab 으로 이동하고 Enter·Space 로 눌린다.
    비활성은 `disabled` 로 표시해 포커스 순서에서도 빠진다.
  -->
  <div class="action-row">
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

/* 승인된 디자인의 `.controls-left` 값을 따른다. */
.controls-left {
  display: flex;
  align-items: center;
  gap: 8px;
}

/* 승인된 디자인의 `.round` 값을 따른다. */
.round {
  display: grid;
  min-width: 42px;
  height: 42px;
  border: 0;
  border-radius: var(--radius-circle);
  background: transparent;
  color: var(--transport-text-color);
  font-size: 20px;
  place-items: center;
}

.round:hover:not(:disabled) {
  background: var(--transport-surface-hover-color);
}

.round:disabled {
  cursor: not-allowed;
  opacity: 0.3;
}

/* 승인된 디자인의 `.round.main` 값을 따른다. */
.round--main {
  min-width: 51px;
  height: 51px;
  border: 1px solid var(--transport-main-border-color);
  color: var(--transport-main-text-color);
}

/* 승인된 디자인의 `.pill` 값을 따른다. 드로어의 `.pill` 과 같은 값이다. */
.pill {
  min-height: 36px;
  padding: 7px 12px;
  border: 1px solid var(--pill-border-color);
  border-radius: var(--radius-control);
  background: var(--pill-surface-color);
  color: var(--pill-text-color);
  font: 11px var(--font-mono);
}

.pill:hover {
  background: var(--pill-surface-hover-color);
}

/* 링크이므로 기본 밑줄을 걷어낸다. 레퍼런스의 `.pill` 과 같은 모양이 된다. */
.external {
  display: grid;
  flex: none;
  text-decoration: none;
  place-items: center;
}
</style>
