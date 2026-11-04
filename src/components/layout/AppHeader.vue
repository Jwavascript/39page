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
 *
 * M5: 브랜드를 `<h1>` 으로 올렸다. 레퍼런스는 `<span class="brand">` 인데,
 * 그러면 페이지에 제목이 하나도 없어 보조기기 사용자가 문서의 시작을 찾을
 * 수 없다 — 드로어의 `<h2>` 가 첫 제목이 되어 단계가 끊긴다.
 * **보이는 모습은 같다**: `.brand` 의 `font` 단축 속성이 크기·굵기를 다시
 * 정하고 기본 여백을 지운다 (작성된 의도를 따른 개선, ADR 0004 와 같은 판단).
 */
import ThemeSwitcher from '@/components/ui/ThemeSwitcher.vue'

defineProps<{ brand: string }>()
</script>

<template>
  <header class="app-header">
    <h1 class="brand">{{ brand }}</h1>
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

/*
 * 승인된 디자인의 `.brand` 값을 따른다.
 *
 * `font` 단축 속성이 `h1` 의 기본 크기·굵기를 덮고, `margin: 0` 이 기본
 * 여백을 지운다. 그래서 `<h1>` 으로 올려도 보이는 모습이 같다.
 */
.brand {
  margin: 0;
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
