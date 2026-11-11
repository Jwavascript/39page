<script setup lang="ts">
/** 안내 상자 — 제목과 설명. 동작이 필요하면 슬롯으로 받는다. 표현만 맡는다. */
defineProps<{
  tone: 'info' | 'error' | 'success'
  title: string
  detail?: string
}>()
</script>

<template>
  <section
    class="collect-notice"
    :class="`collect-notice--${tone}`"
    :role="tone === 'error' ? 'alert' : 'status'"
  >
    <h2 class="notice-title">{{ title }}</h2>
    <p v-if="detail" class="notice-detail">{{ detail }}</p>
    <slot />
  </section>
</template>

<style scoped>
.collect-notice {
  display: grid;
  gap: 8px;
  padding: 16px;
  border: 1px solid var(--info-border-color);
  border-radius: var(--radius-modal);
  background: var(--surface-raised-color);
}

.collect-notice--error {
  border-color: var(--error-text-color);
}

.notice-title {
  margin: 0;
  font-size: 15px;
}

.notice-detail {
  margin: 0;
  color: var(--text-muted-color);
  font-size: 13px;
  line-height: 1.5;
}
</style>
