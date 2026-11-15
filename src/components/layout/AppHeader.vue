<script setup lang="ts">
/**
 * 제품 헤더 — 메뉴와 접기/펼치기 표현.
 *
 * 왼쪽에 브랜드, 오른쪽에 전역 메뉴·테마·접기 버튼을 둔다.
 * DashboardShell이 화면 상태를 소유하며 전역 메뉴는 actions 슬롯으로 전달한다.
 * 접어도 메뉴와 테마 컴포넌트를 마운트한 채 hidden으로 숨긴다.
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

withDefaults(defineProps<{ brand: string; expanded?: boolean }>(), { expanded: true })
const emit = defineEmits<{ toggle: [] }>()
</script>

<template>
  <header class="app-header" :class="{ 'is-collapsed': !expanded }" :aria-label="brand">
    <div id="dashboard-header-content" class="header-content" :hidden="!expanded">
      <h1 class="brand">{{ brand }}</h1>
      <div class="actions">
        <!-- M1-4에서 라이브러리·링크 추가 버튼이 이 앞에 들어온다. -->
        <slot name="actions" />
        <ThemeSwitcher />
      </div>
    </div>
    <button
      type="button"
      class="header-toggle"
      :aria-expanded="expanded"
      aria-controls="dashboard-header-content"
      :aria-label="expanded ? '헤더 접기' : '헤더 펼치기'"
      :title="expanded ? '상단 메뉴를 접어 감상 공간 넓히기' : '보관함 · 데이터 · 테마 메뉴 펼치기'"
      @click="emit('toggle')"
    >
      <svg aria-hidden="true" focusable="false" width="16" height="16" viewBox="0 0 16 16">
        <path d="m4 6 4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.5" />
      </svg>
    </button>
  </header>
</template>

<style scoped>
/* 승인된 디자인의 .header / .brand 값을 따른다. */
.app-header {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  gap: 14px;
  align-items: center;
  justify-content: space-between;
  padding-bottom: 18px;
  border-bottom: 1px solid var(--header-border-color);
}

.header-content {
  display: contents;
}
.header-content[hidden] {
  display: none;
}
.header-toggle {
  display: grid;
  place-items: center;
  grid-column: 3;
  grid-row: 1;
  min-width: 44px;
  min-height: 44px;
  padding: 6px 10px;
  border: 0;
  background: transparent;
  color: var(--pill-text-color);
}
.app-header.is-collapsed {
  padding-bottom: 0;
  border-bottom: 0;
  grid-template-columns: minmax(0, 1fr) auto;
}
.is-collapsed .header-toggle {
  grid-column: 2;
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
  min-width: 0;
  flex-wrap: wrap;
  gap: 9px;
  align-items: center;
  justify-content: flex-end;
}

@media (max-width: 650px) {
  .app-header {
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: flex-start;
    gap: 10px;
  }

  .header-toggle {
    grid-column: 2;
  }
  .actions {
    grid-row: 2;
    grid-column: 1 / -1;
  }

  .brand {
    font-size: 10px;
  }

  /* M11-2: 전역 입구가 생겼다 — 좁은 화면에서는 브랜드 아래 한 줄을 통째로 쓴다. */
  .actions {
    width: 100%;
  }
}
</style>
