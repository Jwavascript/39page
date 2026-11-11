<script setup lang="ts">
/**
 * 수집 화면 — Music Moment 저장 (M10-4). 상태는 `useCollectMoment` 가, 문구는
 * `collectCopy` 가 맡는다. 이 컴포넌트는 단계에 맞는 조각을 고른다.
 *
 * 메모는 **일반 텍스트**다 — 보간으로만 그린다. 500자 상한은 입력란(`maxlength`)이
 * 1차, store 호출 전 검사가 2차다 (붙여넣기·스크립트 경로).
 */
import { computed } from 'vue'

import { formatTimestamp } from '@/shared/utils/time'
import { defaultTrackTitle } from '@/stores/library'
import { MAX_MOMENT_NOTE_LENGTH } from '@/stores/moments'

import CollectNotice from './CollectNotice.vue'
import CollectVideoSummary from './CollectVideoSummary.vue'
import {
  MOMENT_BLOCKED_DETAIL,
  MOMENT_FAILURE_DETAIL,
  MOMENT_SAVE_ONLY_ON_CLICK,
} from './collectCopy'
import type { CollectMomentRequest } from './collectRequest'
import type { CollectOptions } from './useCollect'
import { useCollectMoment } from './useCollectMoment'

const props = defineProps<{
  request: CollectMomentRequest
  options?: CollectOptions
}>()

const moment = useCollectMoment(props.request, props.options)
const { phase, note, noteLength, isNoteTooLong, sameMoments, saving, canSave } = moment

const timeText = formatTimestamp(props.request.atSeconds)
const titleText = props.request.title ?? defaultTrackTitle(props.request.videoId)

const sameText = computed(() =>
  sameMoments.value === 0
    ? ''
    : `이 영상의 ${timeText} 에 저장한 Moment 가 이미 ${String(sameMoments.value)}개 있습니다. 저장하면 하나 더 생깁니다.`,
)
</script>

<template>
  <div class="collect">
    <CollectVideoSummary
      :video-id="request.videoId"
      :title="request.title"
      :at-seconds="request.atSeconds"
    />

    <CollectNotice
      v-if="phase.kind === 'blocked'"
      tone="error"
      title="지금은 Moment 를 저장할 수 없습니다"
      :detail="MOMENT_BLOCKED_DETAIL[phase.status]"
    >
      <a class="pill" href="/">대시보드로 이동</a>
    </CollectNotice>

    <CollectNotice
      v-else-if="phase.kind === 'saved'"
      tone="success"
      :title="`“${titleText}” ${timeText} 순간을 저장했습니다`"
      detail="이 탭은 닫아도 됩니다. 열려 있는 39page 탭의 Moments 에도 바로 보입니다."
    >
      <p v-if="note.trim() !== ''" class="saved-note" dir="auto">{{ note.trim() }}</p>
      <a class="pill pill--strong" href="/">대시보드로 이동</a>
    </CollectNotice>

    <form v-else class="choose" @submit.prevent="moment.save">
      <div>
        <label class="label" for="collect-moment-note">메모 (선택)</label>
        <textarea
          id="collect-moment-note"
          v-model="note"
          class="field field--area"
          rows="4"
          dir="auto"
          :maxlength="MAX_MOMENT_NOTE_LENGTH"
          :aria-invalid="isNoteTooLong || undefined"
          aria-describedby="collect-moment-count"
        />
        <p id="collect-moment-count" class="counter" :class="{ 'is-over': isNoteTooLong }">
          {{ noteLength }} / {{ MAX_MOMENT_NOTE_LENGTH }}
        </p>
      </div>

      <p v-if="sameText !== ''" class="duplicate" role="status">{{ sameText }}</p>
      <p v-if="phase.failure !== null" class="failure" role="alert">
        {{ MOMENT_FAILURE_DETAIL[phase.failure] }}
      </p>

      <div class="actions">
        <button
          type="submit"
          class="pill pill--strong"
          :disabled="!canSave"
          :aria-busy="saving ? 'true' : 'false'"
        >
          {{ saving ? '저장 중…' : 'Moment 저장' }}
        </button>
        <a class="pill" href="/">대시보드로 이동</a>
      </div>
      <p class="aside">{{ MOMENT_SAVE_ONLY_ON_CLICK }}</p>
    </form>
  </div>
</template>

<style scoped>
.collect {
  display: grid;
  gap: 16px;
}

.choose {
  display: grid;
  gap: 12px;
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

/* 곡 담기 화면 · 드로어의 `.pill` 과 같은 토큰 (승인된 디자인). */
.pill {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 40px;
  padding: 8px 14px;
  border: 1px solid var(--pill-border-color);
  border-radius: var(--radius-control);
  background: var(--pill-surface-color);
  color: var(--pill-text-color);
  font: 12px var(--font-mono);
  text-decoration: none;
}

.pill:hover:not(:disabled) {
  background: var(--pill-surface-hover-color);
}

.pill:disabled {
  cursor: not-allowed;
  opacity: 0.4;
}

.pill--strong {
  border-color: var(--accent-strong-color);
  background: var(--accent-strong-color);
  color: var(--accent-strong-text-color);
}

.pill--strong:hover:not(:disabled) {
  background: var(--accent-strong-color);
  filter: brightness(1.08);
}

/* Moments 위젯의 메모 입력란과 같은 값 (승인된 디자인의 `.field`). */
.label {
  display: block;
  margin: 0 0 7px;
  color: var(--label-text-color);
  font: 11px var(--font-mono);
}

.field {
  display: block;
  width: 100%;
  padding: 10px;
  border: 1px solid var(--field-border-color);
  border-radius: var(--radius-field);
  background: var(--field-surface-color);
  color: var(--field-text-color);
}

.field--area {
  min-height: 46px;
  resize: vertical;
  line-height: 1.5;
}

.counter {
  margin: 5px 0 0;
  color: var(--row-meta-text-color);
  font: 10px var(--font-mono);
  text-align: right;
}

.counter.is-over {
  color: var(--error-text-color);
}

.duplicate {
  margin: 0;
  color: var(--text-muted-color);
  font-size: 13px;
}

.failure {
  margin: 0;
  color: var(--error-text-color);
  font-size: 13px;
}

.aside {
  margin: 0;
  color: var(--text-dim-color);
  font-size: 12px;
}

.saved-note {
  margin: 0;
  color: var(--text-muted-color);
  font-size: 13px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
</style>
