<script setup lang="ts">
/**
 * Quick Add 가 들어올 자리 — **버튼이 아니다.**
 *
 * M10-3 전에는 동작하지 않으므로 누를 수 있는 것을 두지 않는다 (Batch 1 지시 3-3,
 * `AGENTS.md` 규칙 9). 준비 중이라는 글만 보인다.
 */
import { QUICK_ADD_COPY } from '../copy'
</script>

<template>
  <section class="quick-add" aria-labelledby="quick-add-title">
    <div class="quick-add-head">
      <h2 id="quick-add-title" class="quick-add-title">{{ QUICK_ADD_COPY.title }}</h2>
      <span class="status">{{ QUICK_ADD_COPY.status }}</span>
    </div>
    <p class="quick-add-body">{{ QUICK_ADD_COPY.body }}</p>
  </section>
</template>

<style scoped>
.quick-add {
  display: grid;
  gap: 6px;
  padding: 12px 14px;
  border: 1px dashed var(--line-color);
  border-radius: var(--radius-modal);
}

.quick-add-head {
  display: flex;
  gap: 8px;
  align-items: center;
  justify-content: space-between;
}

.quick-add-title {
  margin: 0;
  color: var(--text-muted-color);
  font-size: 12px;
  font-weight: 600;
}

.status {
  color: var(--text-dim-color);
  font: 10px var(--font-mono);
  letter-spacing: 0.06em;
}

.quick-add-body {
  margin: 0;
  color: var(--text-dim-color);
  font-size: 11px;
}
</style>
