<script setup lang="ts">
/**
 * 앱 루트 — M1-3 기준 최소 셸.
 *
 * 테마 전환을 눈으로 확인할 수 있을 만큼만 그린다. 실제 대시보드 골격은
 * M1-4의 `DashboardShell`이 맡고, 아래 `.workspace-placeholder`를 대체한다.
 *
 * 데크(LP/카세트), 플레이어, Record Library, 마스코트, 시계·날씨 위젯은
 * 이번 단계에 없다.
 */
import AppHeader from '@/components/layout/AppHeader.vue'
import { useThemeStore } from '@/stores/theme'

const theme = useThemeStore()
</script>

<template>
  <div class="app-shell">
    <AppHeader brand="39page" />

    <!-- M1-4에서 DashboardShell + WidgetHost 로 교체된다. -->
    <main class="workspace-placeholder">
      <p class="placeholder-note">{{ theme.metadata.name }} — 대시보드는 M1-4에서 구현합니다.</p>
    </main>
  </div>
</template>

<style scoped>
/* 승인된 디자인의 .shell 값을 따른다. */
.app-shell {
  max-width: var(--size-shell-max-width);
  margin: auto;
  padding: 22px clamp(12px, 3vw, 46px) 44px;
}

/*
 * 워크스페이스의 복합 배경을 확인할 수 있는 최소 영역.
 * 레이아웃 그리드는 M1-4에서 만든다.
 */
.workspace-placeholder {
  display: grid;
  place-items: center;
  min-height: var(--size-workspace-min-height);
  margin-top: clamp(23px, 2.6vw, 39px);
  border: 1px solid var(--workspace-border-color);
  background: var(--workspace-background);
}

.placeholder-note {
  margin: 0;
  color: var(--text-muted-color);
  font: 12px var(--font-mono);
  letter-spacing: 0.05em;
}
</style>
