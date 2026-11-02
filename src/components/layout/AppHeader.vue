<script setup lang="ts">
/**
 * 제품 헤더 — 최소 구현.
 *
 * 왼쪽에 브랜드, 오른쪽에 액션을 둔다. 현재 액션은 테마 전환뿐이다.
 * M1-4의 `DashboardShell`이 이 컴포넌트를 그대로 재사용하고,
 * 라이브러리·링크 추가 버튼은 `actions` 슬롯으로 더한다.
 *
 * 레퍼런스의 `.demo-top`(프로토타입 상단 바)과 가로·세로 보기 버튼은
 * 제품 UI가 아니므로 옮기지 않는다 (`design/references/README.md`).
 */
import ThemeSwitcher from '@/components/ui/ThemeSwitcher.vue'

defineProps<{ brand: string }>()
</script>

<template>
  <header class="app-header">
    <span class="brand">{{ brand }}</span>
    <div class="actions">
      <!-- M1-4에서 라이브러리·링크 추가 버튼이 이 앞에 들어온다. -->
      <slot name="actions" />
      <ThemeSwitcher />
    </div>
  </header>
</template>

<style scoped>
/* 승인된 디자인의 .header / .brand 값을 따른다. */
.app-header {
  display: flex;
  gap: 14px;
  align-items: center;
  justify-content: space-between;
  padding-bottom: 18px;
  border-bottom: 1px solid var(--header-border-color);
}

.brand {
  color: var(--brand-text-color);
  font: 12px var(--font-mono);
  letter-spacing: 0.08em;
}

.actions {
  display: flex;
  gap: 9px;
  align-items: center;
}

@media (max-width: 650px) {
  .app-header {
    align-items: flex-start;
    gap: 10px;
  }

  .brand {
    font-size: 10px;
  }
}
</style>
