<script setup lang="ts">
/**
 * 헤더의 전역 입구 — **보관함** · **데이터 · 백업** (M11-7B, ADR 0030 · H1).
 *
 * M11-2 의 입구 셋(음악 · Moments · 데이터)에서 음악과 Moments 를 "보관함" 하나로 합쳤다. 같은 보관함의
 * 두 탭으로 가는 단추가 헤더에 따로 있어 "무엇을 눌러야 하는지" 가 헷갈렸다 (UAT U8). 탭은 보관함
 * 안에서 고르고, 헤더의 단추는 **마지막으로 쓰던 탭**으로 연다. 문맥이 있는 입구(데크 → 음악,
 * Moments 위젯의 "모두 보기" → Moments)는 그 자리에 남아 있다.
 *
 * **모든 폭에서 글자 이름을 남긴다** — 아이콘만 남기거나 "더보기" 메뉴에 넣지 않는다. 계정이 없는
 * 39page 에서 백업은 유일한 데이터 보호 수단이라 이름으로 찾을 수 있어야 한다.
 *
 * 상태는 모른다. 셸이 내려 주는 열림 상태를 `aria-expanded` 로 알리고, 누름만 올린다.
 */
defineProps<{
  archiveId: string
  archiveOpen: boolean
  dataDialogId: string
  dataOpen: boolean
}>()

const emit = defineEmits<{
  archive: []
  data: []
}>()
</script>

<template>
  <nav class="app-nav" aria-label="39page 메뉴">
    <button
      type="button"
      class="nav-button"
      :class="{ 'is-active': archiveOpen }"
      :aria-expanded="archiveOpen"
      :aria-controls="archiveId"
      @click="emit('archive')"
    >
      <span aria-hidden="true">▤</span> 보관함
    </button>
    <button
      type="button"
      class="nav-button"
      aria-haspopup="dialog"
      :aria-expanded="dataOpen"
      :aria-controls="dataDialogId"
      @click="emit('data')"
    >
      <span aria-hidden="true">⇩</span> 데이터 · 백업
    </button>
  </nav>
</template>

<style scoped>
.app-nav {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.nav-button {
  min-width: 44px;
  min-height: 44px;
  padding: 6px 14px;
  border: 1px solid var(--pill-border-color);
  border-radius: var(--radius-control);
  background: var(--pill-surface-color);
  color: var(--pill-text-color);
  font: 12px var(--font-mono);
  letter-spacing: 0.04em;
  white-space: nowrap;
}

.nav-button.is-active {
  border-color: var(--accent-strong-color);
  background: var(--accent-strong-color);
  color: var(--accent-strong-text-color);
}

/* 좁은 화면: 두 입구가 한 줄을 나눠 쓴다 — 글자는 그대로 남는다 (줄바꿈 · 아이콘화 없음). */
@media (max-width: 650px) {
  .app-nav {
    flex: 1 1 100%;
    flex-wrap: nowrap;
  }

  .nav-button {
    min-width: 0;
    flex: 1 1 0;
    padding: 6px 8px;
  }
}

/* 터치 뒤 hover 색이 남지 않게 — 실제로 마우스를 올릴 수 있는 기기에서만 (M11 U18). */
@media (hover: hover) {
  .nav-button:hover:not(.is-active) {
    background: var(--pill-surface-hover-color);
  }
}
</style>
