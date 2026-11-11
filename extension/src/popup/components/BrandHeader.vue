<script setup lang="ts">
/** 브랜드 줄 — 웹앱 헤더의 `.brand` 와 같은 글꼴·자간 (AppHeader.vue). */
</script>

<template>
  <header class="brand-header">
    <span class="disc" aria-hidden="true"></span>
    <h1 class="brand">39page</h1>
    <span class="role">YouTube 담기</span>
  </header>
</template>

<style scoped>
.brand-header {
  display: flex;
  gap: 9px;
  align-items: center;
  padding: 13px 16px 12px;
  border-bottom: 1px solid var(--header-border-color);
}

/* 작은 LP — 장식. 검은 판 · 홈 · 아이보리 라벨. */
.disc {
  width: 16px;
  height: 16px;
  flex: none;
  border-radius: var(--radius-circle);
  background:
    radial-gradient(circle, var(--accent-color) 0 22%, transparent 23%),
    repeating-radial-gradient(circle, #0d0c0b 0 1px, #1c1a17 1px 2px);
  box-shadow: 0 0 0 1px var(--line-color);
}

.brand {
  margin: 0;
  color: var(--brand-text-color);
  font: 12px var(--font-mono);
  letter-spacing: 0.08em;
}

.role {
  margin-left: auto;
  color: var(--text-dim-color);
  font: 10px var(--font-mono);
  letter-spacing: 0.06em;
  text-transform: uppercase;
}
</style>
