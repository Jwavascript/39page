<script setup lang="ts">
/**
 * Music Moment 캡처 (M10-4) — "현재 Moment 저장" 버튼과 그 결과. 표현만 맡는다.
 *
 * 이 버튼은 **저장하지 않는다.** 누른 순간의 시점을 고정해 39page 수집 화면을 열고,
 * 메모를 쓰고 저장하는 것은 그 화면에서 사용자가 한다 (ADR 0023). 쓸 수 없는
 * 페이지(Shorts · 라이브 · 임베드)에서는 버튼을 끄고 이유를 적는다.
 */
import { computed } from 'vue'

import type { CaptureRefusal } from '@/shared/messages'

import { CAPTURE_REFUSAL_COPY, MOMENT_COPY, momentCaptureMessage } from '../copy'
import type { MomentCaptureState } from '../useMomentCapture'
import ShortcutHint from './ShortcutHint.vue'

const props = defineProps<{
  state: MomentCaptureState
  disabledReason: CaptureRefusal | null
  shortcut?: string
}>()
const emit = defineEmits<{ capture: [] }>()

const message = computed(() => momentCaptureMessage(props.state))
const busy = computed(() => props.state.kind === 'busy')
const isProblem = computed(() => props.state.kind === 'error' || props.state.kind === 'refused')
</script>

<template>
  <section class="moment" aria-labelledby="moment-title">
    <h2 id="moment-title" class="moment-title">{{ MOMENT_COPY.title }}</h2>
    <button
      type="button"
      class="capture"
      :disabled="busy || disabledReason !== null"
      :aria-busy="busy"
      :aria-describedby="disabledReason !== null ? 'moment-unavailable' : 'moment-help'"
      @click="emit('capture')"
    >
      {{ busy ? MOMENT_COPY.busy : MOMENT_COPY.button }}
    </button>
    <p v-if="disabledReason !== null" id="moment-unavailable" class="moment-help">
      {{ CAPTURE_REFUSAL_COPY[disabledReason] }}
    </p>
    <p v-else id="moment-help" class="moment-help">{{ MOMENT_COPY.help }}</p>
    <ShortcutHint :shortcut="shortcut" />
    <p
      v-if="message !== null"
      class="moment-message"
      :class="{ 'is-error': isProblem }"
      :role="isProblem ? 'alert' : 'status'"
    >
      {{ message }}
    </p>
  </section>
</template>

<style scoped>
/* Quick Add 칸과 같은 토큰 — 두 동작이 같은 모양을 갖는다. */
.moment {
  display: grid;
  gap: 8px;
  padding: 12px 14px;
  border: 1px solid var(--info-border-color);
  border-radius: var(--radius-modal);
}

.moment-title {
  margin: 0;
  color: var(--text-muted-color);
  font-size: 12px;
  font-weight: 600;
}

/* 보조 동작 — 웹앱의 `.pill` 토큰 (주된 동작은 플레이리스트 추가). */
.capture {
  min-height: 36px;
  padding: 7px 12px;
  border: 1px solid var(--pill-border-color);
  border-radius: var(--radius-control);
  background: var(--pill-surface-color);
  color: var(--pill-text-color);
  font: 12px var(--font-mono);
  letter-spacing: 0.04em;
  cursor: pointer;
}

.capture:hover:not(:disabled) {
  background: var(--pill-surface-hover-color);
}

.capture:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

.capture[aria-busy='true'] {
  cursor: progress;
}

.moment-help {
  margin: 0;
  color: var(--text-dim-color);
  font-size: 11px;
}

.moment-message {
  margin: 0;
  color: var(--text-muted-color);
  font-size: 12px;
}

.moment-message.is-error {
  color: var(--text-color);
}
</style>
