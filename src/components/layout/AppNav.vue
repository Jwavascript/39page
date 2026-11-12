<script setup lang="ts">
/**
 * 헤더의 전역 입구 셋 — 음악 · Moments · 데이터 (M11-2, ADR 0027 결정 2).
 *
 * 처음 온 사용자가 "어디서 음악을 담고 · Moments 를 보고 · 백업하는지" 를 **이름으로** 찾게 한다
 * (M11 U1 · U5). 모든 폭에서 글자 이름을 남긴다 — 아이콘만 남기지 않는다 (D6 기본값: 글자 + 기호).
 *
 * 상태는 모른다. 셸이 내려 주는 열림 상태를 `aria-expanded` 로 알리고, 누름만 올린다.
 */
import type { ArchiveTab } from '@/features/archive/archiveController'

defineProps<{
  archiveId: string
  archiveOpen: boolean
  archiveTab: ArchiveTab
  dataDialogId: string
  dataOpen: boolean
}>()

const emit = defineEmits<{
  archive: [tab: ArchiveTab]
  data: []
}>()
</script>

<template>
  <nav class="app-nav" aria-label="39page 메뉴">
    <button
      type="button"
      class="nav-button"
      :class="{ 'is-active': archiveOpen && archiveTab === 'music' }"
      :aria-expanded="archiveOpen && archiveTab === 'music'"
      :aria-controls="archiveId"
      @click="emit('archive', 'music')"
    >
      <span aria-hidden="true">♪</span> 음악
    </button>
    <button
      type="button"
      class="nav-button"
      :class="{ 'is-active': archiveOpen && archiveTab === 'moments' }"
      :aria-expanded="archiveOpen && archiveTab === 'moments'"
      :aria-controls="archiveId"
      @click="emit('archive', 'moments')"
    >
      <span aria-hidden="true">◆</span> Moments
    </button>
    <button
      type="button"
      class="nav-button"
      aria-haspopup="dialog"
      :aria-expanded="dataOpen"
      :aria-controls="dataDialogId"
      @click="emit('data')"
    >
      <span aria-hidden="true">⇩</span> 데이터
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

/* 좁은 화면: 세 입구가 한 줄을 나눠 쓴다 (세로로 쌓이지 않게). */
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
