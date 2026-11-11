<script setup lang="ts">
/**
 * 수집 화면의 앱 루트 (M10-3B).
 *
 * `#collect?…` 로 열렸을 때 `main.ts` 가 대시보드(`App.vue`) 대신 이것을 마운트한다.
 * 플레이어·위젯·Moments 를 띄우지 않는다 — 두 번째 YouTube iframe 이 생기지 않는다.
 * 조립만 한다.
 */
import CollectView from '@/features/collect/CollectView.vue'

defineProps<{ hash: string }>()
</script>

<template>
  <div class="collect-shell">
    <header class="collect-header">
      <h1 class="brand">39page</h1>
      <span class="role mono">YOUTUBE 에서 담기</span>
    </header>
    <main class="collect-main">
      <CollectView :hash="hash" />
    </main>
  </div>
</template>

<style scoped>
.collect-shell {
  width: min(100%, 560px);
  margin: 0 auto;
  padding: 24px 16px 40px;
}

.collect-header {
  display: flex;
  gap: 12px;
  align-items: baseline;
  justify-content: space-between;
  margin-bottom: 20px;
  padding-bottom: 14px;
  border-bottom: 1px solid var(--header-border-color);
}

/* 대시보드 헤더의 `.brand` 와 같은 값 (AppHeader.vue). */
.brand {
  margin: 0;
  color: var(--brand-text-color);
  font: 12px var(--font-mono);
  letter-spacing: 0.08em;
}

.role {
  color: var(--text-dim-color);
  font-size: 10px;
  letter-spacing: 0.06em;
}
</style>
