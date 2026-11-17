<script setup lang="ts">
/**
 * 저장 결과 한 자리 (M11-5B) — 성공은 `status`, 실패 · 불확실은 `alert`. 무엇을 하면 되는지 단추로 준다.
 * 성공 문구는 부모가 만든다(`success`) — 무엇을 어디에 저장했는지는 그쪽이 안다.
 */
import { computed } from 'vue'

import { UNAVAILABLE_COPY, UNCERTAIN_COPY, UNCERTAIN_HINT, errorCopy } from '../panelCopy'
import type { SaveState } from '../useSaveRequest'

const props = defineProps<{
  state: SaveState
  /** 성공 문구. */
  success: string
  /** 부분 성공 문구 (음악 · 새 목록). */
  partial?: string
}>()

const emit = defineEmits<{ check: []; retry: []; collect: []; reconnect: [] }>()

const tone = computed(() =>
  props.state.phase === 'done' ? 'ok' : props.state.phase === 'idle' ? 'none' : 'warn',
)
const heading = computed(() => {
  switch (props.state.phase) {
    case 'error':
    case 'not-saved':
      return '저장하지 못했어요'
    case 'partial':
      return '일부만 저장됐어요'
    case 'unavailable':
      return '바로 저장을 사용할 수 없어요'
    default:
      return '저장 여부를 확인해 주세요'
  }
})
</script>

<template>
  <div v-if="state.phase === 'saving' || state.phase === 'checking'" class="feedback" role="status">
    <p class="feedback-heading"><span aria-hidden="true">…</span> 저장 확인 중</p>
    {{
      state.phase === 'saving'
        ? '저장하는 중… 39page 가 저장을 확인하면 알려 드려요.'
        : '저장됐는지 확인하는 중…'
    }}
  </div>
  <div v-else-if="state.phase === 'done'" class="feedback ok" role="status">
    <p class="feedback-heading"><span aria-hidden="true">✓</span> 저장 완료</p>
    <p>{{ success }}</p>
  </div>
  <div
    v-else-if="tone === 'warn'"
    class="feedback warn"
    :class="{ error: state.phase === 'error' || state.phase === 'not-saved' }"
    role="alert"
  >
    <p class="feedback-heading"><span aria-hidden="true">!</span> {{ heading }}</p>
    <template v-if="state.phase === 'uncertain'">
      <p>{{ UNCERTAIN_COPY[state.reason] }}</p>
      <p class="hint">{{ UNCERTAIN_HINT }}</p>
      <div class="actions">
        <button type="button" class="btn primary" @click="emit('check')">저장됐는지 확인</button>
        <button type="button" class="btn" @click="emit('retry')">다시 시도</button>
      </div>
    </template>
    <template v-else-if="state.phase === 'partial'">
      <p>{{ partial ?? '일부만 저장됐어요.' }}</p>
      <div class="actions">
        <button type="button" class="btn primary" @click="emit('retry')">
          이 플레이리스트에 다시 담기
        </button>
      </div>
    </template>
    <template v-else-if="state.phase === 'not-saved'">
      <p>확인해 보니 저장되지 않았어요. 다시 저장해도 한 번만 저장돼요.</p>
      <div class="actions">
        <button type="button" class="btn primary" @click="emit('retry')">다시 저장</button>
      </div>
    </template>
    <template v-else-if="state.phase === 'unavailable'">
      <p>{{ UNAVAILABLE_COPY[state.reason] }}</p>
      <div class="actions">
        <button
          v-if="state.reason === 'bridge-failed' || state.reason === 'timeout'"
          type="button"
          class="btn"
          @click="emit('reconnect')"
        >
          다시 연결
        </button>
        <button type="button" class="btn" @click="emit('collect')">
          39page 수집 화면으로 열기
        </button>
      </div>
    </template>
    <template v-else-if="state.phase === 'error'">
      <p>{{ errorCopy(state.error.code) }}</p>
      <div v-if="state.error.retryable" class="actions">
        <button type="button" class="btn" @click="emit('retry')">다시 저장</button>
      </div>
    </template>
  </div>
</template>
