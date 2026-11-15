<script setup lang="ts">
/** 브랜드 줄 — 웹앱 헤더의 `.brand` 와 같은 글꼴·자간 (AppHeader.vue). */
import cassette from '@/ui/cassette.svg?inline'
</script>

<template>
  <header class="brand-header">
    <img class="cassette-mark" :src="cassette" alt="" width="44" height="44" />
    <h1 class="brand">39page</h1>
    <span class="role">YouTube 담기</span>
  </header>
</template>

<style scoped>
.brand-header {
  display: grid;
  grid-template-columns: 44px minmax(0, 1fr) auto;
  min-width: 0;
  gap: 8px;
  align-items: center;
  padding: 8px 12px;
  border-bottom: 1px solid var(--header-border-color);
}

/* 승인된 데크의 카세트 부분을 재사용한 장식. */
.cassette-mark {
  grid-row: 1 / 3;
  width: 44px;
  height: 44px;
  flex: none;
}

.brand {
  margin: 0;
  color: var(--brand-text-color);
  font: 12px var(--font-mono);
  letter-spacing: 0.08em;
}

.role {
  grid-column: 2;
  color: var(--text-muted-color);
  font: 10px var(--font-mono);
  letter-spacing: 0.02em;
  text-transform: uppercase;
}

@media (max-width: 260px) {
  .brand-header {
    grid-template-columns: minmax(0, 1fr);
    gap: 4px;
    padding: 8px;
  }
  .role {
    grid-column: 1;
  }
}
</style>
