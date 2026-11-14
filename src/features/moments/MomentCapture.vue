<script setup lang="ts">
/**
 * "＋ 이 순간 저장" 과 그 메모 양식 (M11-7C 에서 대시보드 위젯에서 떼어 냈다).
 *
 * 두 자리에서 쓴다 — **대시보드 Moments 위젯**(빠른 저장)과 **보관함 Moments › 이 곡**(이 곡의 순간 관리).
 * 보관함이 열린 영상 띠에는 없다 — 거기는 보기 · 재생 전용이다 (ADR 0030 · M11-7C).
 *
 * 저장의 판단은 `useMomentCapture` 가 한다. 이 컴포넌트는 보여 주고 누름을 넘긴다 (`AGENTS.md` 규칙 3).
 * 같은 화면에 두 개가 함께 있을 수 있으므로 DOM id 앞머리(`idPrefix`)를 받는다.
 */
import { computed, nextTick, ref } from 'vue'

import { MAX_MOMENT_NOTE_LENGTH, useMomentsStore } from '@/stores/moments'

import { useMomentCapture } from './useMomentCapture'

defineProps<{
  /** DOM id 앞머리 — 대시보드와 보관함에 함께 있어도 id 가 겹치지 않게. */
  idPrefix: string
}>()

const emit = defineEmits<{
  /** 새 순간을 저장했다 — 부모가 그 줄을 강조할 수 있다. */
  saved: [momentId: string]
}>()

const capture = useMomentCapture()
const moments = useMomentsStore()

const captureButton = ref<HTMLButtonElement | null>(null)
const noteField = ref<HTMLTextAreaElement | null>(null)

/** 방금 저장한 Moment 에 이미 메모가 있는지 — 단추 이름이 "메모 고치기" 가 된다. */
const lastSavedHasNote = computed<boolean>(() => {
  const saved = capture.lastSaved.value
  return saved !== null && (moments.getMoment(saved.id)?.note ?? '') !== ''
})

async function save(): Promise<void> {
  if (await capture.save()) {
    const saved = capture.lastSaved.value
    if (saved !== null) emit('saved', saved.id)
  }
}

function startNote(): void {
  capture.startNote()
  void nextTick(() => noteField.value?.focus())
}

function backToCapture(): void {
  // 폼이 사라진다. 포커스를 저장 단추로 되돌린다.
  void nextTick(() => captureButton.value?.focus())
}

async function submitNote(): Promise<void> {
  if (await capture.submitNote()) backToCapture()
}

function cancelNote(): void {
  capture.cancelNote()
  backToCapture()
}

defineExpose({ capture })
</script>

<template>
  <div class="moment-capture">
    <!-- ── ＋ 이 순간 저장 (F13 · 빠른 저장) ─────────────────────────────── -->
    <div class="capture-row">
      <button
        ref="captureButton"
        type="button"
        class="pill pill--strong capture-button"
        :disabled="!capture.canCapture.value"
        :aria-busy="capture.saving.value ? 'true' : 'false'"
        :aria-describedby="`${idPrefix}-capture-hint`"
        @click="save"
      >
        {{ capture.saving.value ? '저장 중…' : '＋ 이 순간 저장' }}
      </button>
      <p :id="`${idPrefix}-capture-hint`" class="capture-hint">{{ capture.hint.value }}</p>
    </div>

    <!-- 저장 결과. 라이브 영역은 늘 있다 — 비어 있으면 자리를 차지하지 않는다. -->
    <p
      class="feedback"
      :class="{ 'is-warning': capture.feedback.value?.tone === 'warning' }"
      role="status"
      aria-live="polite"
    >
      {{ capture.feedback.value?.text ?? '' }}
    </p>

    <!-- 방금 저장한 순간에 메모를 붙이는 길 (저장 직후) -->
    <div v-if="capture.lastSaved.value !== null && !capture.noteOpen.value" class="after-save">
      <button type="button" class="pill" @click="startNote">
        {{ lastSavedHasNote ? '메모 고치기' : '메모 추가' }}
        <span class="after-save-time">{{ capture.lastSavedTime.value }}</span>
      </button>
    </div>

    <form
      v-if="capture.noteOpen.value && capture.lastSaved.value !== null"
      class="note-form"
      :aria-labelledby="`${idPrefix}-note-target`"
      @submit.prevent="submitNote"
    >
      <p :id="`${idPrefix}-note-target`" class="note-target">
        <span class="target-time">{{ capture.lastSavedTime.value }}</span>
        <span class="target-title">{{ capture.lastSaved.value.title }}</span>
      </p>
      <p v-if="capture.isLastSavedStale.value" class="stale-note">
        재생 중인 곡이 바뀌었어요. 메모는 위에 적힌 순간에 붙어요.
      </p>
      <label class="label" :for="`${idPrefix}-capture-note`">메모 (선택)</label>
      <textarea
        :id="`${idPrefix}-capture-note`"
        ref="noteField"
        v-model="capture.draftNote.value"
        class="field field--area"
        rows="3"
        :maxlength="MAX_MOMENT_NOTE_LENGTH"
        :aria-invalid="capture.isNoteTooLong.value || undefined"
        :aria-describedby="`${idPrefix}-capture-count`"
      />
      <p
        :id="`${idPrefix}-capture-count`"
        class="counter"
        :class="{ 'is-over': capture.isNoteTooLong.value }"
      >
        {{ capture.noteLength.value }} / {{ MAX_MOMENT_NOTE_LENGTH }}
        <template v-if="capture.isNoteTooLong.value">
          · 메모는 {{ MAX_MOMENT_NOTE_LENGTH }}자까지 쓸 수 있어요</template
        >
      </p>
      <div class="row-actions">
        <button
          type="submit"
          class="pill pill--strong"
          :disabled="capture.isNoteTooLong.value || capture.noteSaving.value"
          :aria-busy="capture.noteSaving.value ? 'true' : 'false'"
        >
          {{ capture.noteSaving.value ? '저장 중…' : '메모 저장' }}
        </button>
        <button type="button" class="pill" @click="cancelNote">취소</button>
      </div>
    </form>
  </div>
</template>

<style scoped>
.moment-capture {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 10px;
}

.capture-row {
  display: flex;
  min-width: 0;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 10px;
}

.capture-hint {
  min-width: 0;
  flex: 1 1 140px;
  margin: 0;
  color: var(--drawer-muted-text-color);
  font: 11px/1.5 var(--font-mono);
}

.pill {
  min-height: 44px;
  flex: none;
  padding: 7px 14px;
  border: 1px solid var(--pill-border-color);
  border-radius: var(--radius-control);
  background: var(--pill-surface-color);
  color: var(--pill-text-color);
  font: 12px var(--font-mono);
}

.pill:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}

.pill--strong {
  border-color: var(--accent-strong-color);
  background: var(--accent-strong-color);
  color: var(--accent-strong-text-color);
}

.after-save-time {
  margin-left: 4px;
  font-variant-numeric: tabular-nums;
  opacity: 0.8;
}

.feedback {
  margin: 0;
  color: var(--status-text-color);
  font: 11px/1.6 var(--font-mono);
}

.feedback:empty {
  display: none;
}

.feedback.is-warning {
  color: var(--status-warning-text-color);
}

.note-form {
  padding: 10px 12px;
  border: 1px solid var(--row-selected-border-color);
  background: var(--row-selected-surface-color);
}

.note-target {
  display: flex;
  min-width: 0;
  flex-wrap: wrap;
  align-items: baseline;
  margin: 0 0 10px;
  gap: 4px 8px;
}

.target-time {
  flex: none;
  color: var(--accent-color);
  font: 13px var(--font-mono);
  font-variant-numeric: tabular-nums;
}

.target-title {
  min-width: 0;
  color: var(--row-text-color);
  font-size: 12px;
  overflow-wrap: anywhere;
}

.stale-note {
  margin: 0 0 10px;
  color: var(--status-warning-text-color);
  font: 11px/1.6 var(--font-mono);
}

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
  margin: 5px 0 8px;
  color: var(--row-meta-text-color);
  font: 10px var(--font-mono);
  text-align: right;
}

.counter.is-over {
  color: var(--error-text-color);
}

.row-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

/* 터치 뒤 hover 색이 남지 않게 (M11 U18). */
@media (hover: hover) {
  .pill:hover:not(:disabled):not(.pill--strong) {
    background: var(--pill-surface-hover-color);
  }
}
</style>
