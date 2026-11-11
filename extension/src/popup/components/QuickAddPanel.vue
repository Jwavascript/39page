<script setup lang="ts">
/**
 * Quick Add (M10-3) — "39page 에 추가" 버튼과 그 결과. 표현만 맡는다.
 *
 * 이 버튼은 **저장하지 않는다.** 39page 수집 화면을 열고, 플레이리스트를 고르고
 * 저장하는 것은 그 화면에서 사용자가 한다 (ADR 0023). 그 사실을 화면에 적는다.
 */
import { computed } from 'vue'

import { QUICK_ADD_COPY, quickAddMessage } from '../copy'
import type { QuickAddState } from '../useQuickAdd'

const props = defineProps<{ state: QuickAddState }>()
const emit = defineEmits<{ add: [] }>()

const message = computed(() => quickAddMessage(props.state))
const busy = computed(() => props.state.kind === 'busy')
</script>

<template>
  <section class="quick-add" aria-labelledby="quick-add-title">
    <h2 id="quick-add-title" class="quick-add-title">{{ QUICK_ADD_COPY.title }}</h2>
    <button type="button" class="add" :disabled="busy" :aria-busy="busy" @click="emit('add')">
      {{ busy ? QUICK_ADD_COPY.busy : QUICK_ADD_COPY.button }}
    </button>
    <p class="quick-add-help">{{ QUICK_ADD_COPY.help }}</p>
    <p
      v-if="message !== null"
      class="quick-add-message"
      :class="{ 'is-error': state.kind === 'error' }"
      :role="state.kind === 'error' ? 'alert' : 'status'"
    >
      {{ message }}
    </p>
  </section>
</template>

<style scoped>
.quick-add {
  display: grid;
  gap: 8px;
  padding: 12px 14px;
  border: 1px solid var(--info-border-color);
  border-radius: var(--radius-modal);
}

.quick-add-title {
  margin: 0;
  color: var(--text-muted-color);
  font-size: 12px;
  font-weight: 600;
}

/* 웹앱의 `.pill--strong` 과 같은 토큰 — 주된 동작. */
.add {
  min-height: 36px;
  padding: 7px 12px;
  border: 1px solid var(--accent-strong-color);
  border-radius: var(--radius-control);
  background: var(--accent-strong-color);
  color: var(--accent-strong-text-color);
  font: 12px var(--font-mono);
  letter-spacing: 0.04em;
  cursor: pointer;
}

.add:disabled {
  cursor: progress;
  opacity: 0.6;
}

.quick-add-help {
  margin: 0;
  color: var(--text-dim-color);
  font-size: 11px;
}

.quick-add-message {
  margin: 0;
  color: var(--text-muted-color);
  font-size: 12px;
}

.quick-add-message.is-error {
  color: var(--text-color);
}
</style>
