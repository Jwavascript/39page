<script setup lang="ts">
/** 안내 · 오류 상자. 문구는 부모가 준다. 동작이 필요하면 슬롯으로 받는다. */
defineProps<{
  tone: 'info' | 'error'
  title: string
  body: string
}>()
</script>

<template>
  <section class="notice" :class="tone" :role="tone === 'error' ? 'alert' : undefined">
    <h2 class="notice-title">{{ title }}</h2>
    <p class="notice-body">{{ body }}</p>
    <slot />
  </section>
</template>

<style scoped>
.notice {
  display: grid;
  gap: 6px;
  padding: 14px;
  border: 1px solid var(--info-border-color);
  border-radius: var(--radius-modal);
  background: var(--surface-raised-color);
}

.notice.error {
  border-color: var(--button-border-color);
}

.notice-title {
  margin: 0;
  color: var(--text-color);
  font-size: 13px;
  font-weight: 600;
}

.notice-body {
  margin: 0;
  color: var(--text-muted-color);
  font-size: 12px;
}
</style>
