<script setup lang="ts">
/**
 * 테마 선택 버튼 그룹.
 *
 * 네이티브 `<button>`을 쓴다. Tab 이동과 Enter/Space 활성화를 브라우저가
 * 처리하므로 커스텀 키보드 내비게이션을 만들지 않는다.
 *
 * 레이블은 Theme Registry(`src/themes/index.ts`)에서 가져온다. 문구를
 * 컴포넌트에 하드코딩하지 않는다.
 *
 * ADR 0045 — 커스텀 테마일 때 그 옆에 **팔레트 단추**(설정 창 — 데크 그림 · 색)를 둔다. 창은 셸이 연다.
 */
import { inject } from 'vue'

import { CUSTOM_THEME_DIALOG } from '@/shared/types/customTheme'
import { useThemeStore } from '@/stores/theme'

const theme = useThemeStore()
const customDialog = inject(CUSTOM_THEME_DIALOG, null)
</script>

<template>
  <div class="theme-switch" role="group" aria-label="테마 선택">
    <button
      v-for="option in theme.available"
      :key="option.key"
      type="button"
      class="theme-button"
      :class="{ 'is-active': option.key === theme.current }"
      :aria-pressed="option.key === theme.current"
      :title="option.description"
      @click="theme.setTheme(option.key)"
    >
      {{ option.label }}
    </button>
    <button
      v-if="theme.current === 'custom' && customDialog !== null"
      type="button"
      class="icon-button custom-settings"
      aria-label="커스텀 테마 설정"
      title="커스텀 테마 설정 (그림 · 색)"
      @click="customDialog.open()"
    >
      <span class="ui-icon ui-icon--palette" aria-hidden="true"></span>
    </button>
  </div>
</template>

<style scoped>
/* 기하·타이포는 승인된 디자인의 .theme-switch / .theme-btn 값을 따른다. */
.theme-switch {
  display: flex;
  gap: 4px;
  padding: 3px;
  border: 1px solid var(--theme-switch-border-color);
  border-radius: var(--radius-control);
}

.theme-button {
  /* 터치 목표 44px (M11 U16 — 승인 디자인의 31px 에서 키웠다). */
  min-height: 44px;
  padding: 6px 12px;
  border: 0;
  background: transparent;
  color: var(--theme-button-text-color);
  font: 10px var(--font-mono);
  letter-spacing: 0.04em;
}

/* 터치 뒤 hover 표현이 남지 않게 (M11 U18). */
@media (hover: hover) {
  .theme-button:hover {
    filter: brightness(1.14);
  }
}

/*
 * 선택된 테마는 색 반전으로 구별한다. 색에만 의존하지 않도록
 * aria-pressed 로도 상태를 노출한다.
 */
.theme-button.is-active {
  background: var(--theme-button-active-surface-color);
  color: var(--theme-button-active-text-color);
}

.custom-settings {
  width: 44px;
  height: 44px;
  color: var(--theme-button-text-color);
}

@media (max-width: 730px) {
  .theme-button {
    padding: 6px 8px;
    font-size: 9px;
  }
}
</style>
