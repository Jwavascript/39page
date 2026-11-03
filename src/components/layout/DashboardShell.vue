<script setup lang="ts">
/**
 * 대시보드 전체 화면 구조.
 *
 * 책임: 셸 여백·최대 폭, 헤더 통합, 워크스페이스 영역 제공.
 * 위젯을 직접 알지 않는다 — 레이아웃을 받아 `WidgetHost`에 넘길 뿐이다.
 *
 * 테마를 참조하지 않는다. 외형은 CSS 토큰이 결정하므로 두 테마가 **같은**
 * 셸 인스턴스를 공유한다. 테마별 셸을 따로 마운트하지 않는다
 * (`docs/decisions/0001-theme-switching-mechanism.md`).
 *
 * M2에서 Record Library 드로어가 `.workspace`의 형제 열로 들어온다.
 * 지금은 동작하지 않는 버튼을 만들지 않으므로 헤더에 액션이 없다.
 */
import AppHeader from '@/components/layout/AppHeader.vue'
import WidgetHost from '@/components/layout/WidgetHost.vue'
import type { DashboardLayout } from '@/shared/types'

defineProps<{
  brand: string
  layout: DashboardLayout
}>()
</script>

<template>
  <div class="dashboard-shell">
    <AppHeader :brand="brand">
      <!-- M2에서 라이브러리·링크 추가 버튼이 들어온다. -->
      <template #actions><slot name="header-actions" /></template>
    </AppHeader>

    <!-- M2에서 드로어가 이 안의 형제 열로 추가된다. -->
    <div class="workspace">
      <WidgetHost :layout="layout" />
    </div>
  </div>
</template>

<style scoped>
/* 승인된 디자인의 .shell 값을 따른다. */
.dashboard-shell {
  max-width: var(--size-shell-max-width);
  margin: auto;
  padding: 22px clamp(12px, 3vw, 46px) 44px;
}

/* 승인된 디자인의 .workspace 값을 따른다. 복합 배경을 그대로 쓴다. */
.workspace {
  min-height: var(--size-workspace-min-height);
  margin-top: clamp(23px, 2.6vw, 39px);
  padding: clamp(18px, 2.6vw, 36px);
  border: 1px solid var(--workspace-border-color);
  background: var(--workspace-background);
  /* 내부 요소가 워크스페이스 밖으로 넘치지 않게 한다. */
  overflow: hidden;
  isolation: isolate;
}

@media (max-width: 650px) {
  .dashboard-shell {
    padding: 10px 8px 35px;
  }

  .workspace {
    padding: 17px;
  }
}
</style>
