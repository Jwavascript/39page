<script setup lang="ts">
/**
 * "＋ 이 순간 저장" — **잡기 → 메모 → Moment 저장** (M11-7C · 저장 모델 B, ADR 0030).
 *
 * 두 자리에서 쓴다 — **대시보드 Moments 위젯**(빠른 저장)과 **보관함 Moments › 이 곡**(이 곡의 순간 관리).
 * 보관함이 열린 영상 띠에는 없다 — 거기는 보기 · 재생 전용이다. 두 자리는 **같은 초안**을 본다
 * (`useMomentDraftStore`) — 대시보드에서 잡고 보관함에서 이어 써도 된다.
 *
 * 두 상태가 눈에 다르게 보인다.
 *
 * | 상태     | 보이는 것                                                                        |
 * | -------- | -------------------------------------------------------------------------------- |
 * | 초안 없음 | ＋ 이 순간 저장 단추와 안내                                                        |
 * | 저장 전  | "저장 전" 표시 · 잡은 시점 · 곡, 메모 입력란, **Moment 저장** · 취소 · ↻ 다시 잡기 |
 *
 * 저장한 뒤의 메모 고치기는 여기서 하지 않는다 — 보관함 Moments › 이 곡의 줄에서 한다(저장 전 메모와
 * 저장된 메모 고치기를 섞지 않는다).
 *
 * 키보드: 메모 입력란에서 Enter = 저장, Shift+Enter = 줄바꿈. 한글 조합 중의 Enter 는 저장하지 않는다.
 * 저장 판단은 `useMomentCapture` 가 한다. 이 컴포넌트는 보여 주고 누름을 넘긴다 (`AGENTS.md` 규칙 3).
 * 같은 화면에 두 개가 함께 있을 수 있으므로 DOM id 앞머리(`idPrefix`)를 받는다.
 */
import { nextTick, ref } from 'vue'

import { MAX_MOMENT_NOTE_LENGTH } from '@/stores/moments'

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

const captureButton = ref<HTMLButtonElement | null>(null)
const noteField = ref<HTMLTextAreaElement | null>(null)

function focusNote(): void {
  void nextTick(() => noteField.value?.focus())
}

function backToCapture(): void {
  // 양식이 사라진다. 포커스를 저장 단추로 되돌린다.
  void nextTick(() => captureButton.value?.focus())
}

function onCapture(): void {
  if (capture.capture()) focusNote()
}

function onRecapture(): void {
  if (capture.capture()) focusNote()
}

async function onSave(): Promise<void> {
  const id = await capture.save()
  if (id === null) return
  emit('saved', id)
  backToCapture()
}

function onCancel(): void {
  capture.cancel()
  backToCapture()
}

/** Enter = 저장, Shift+Enter = 줄바꿈. 한글 등 조합 중의 Enter 는 글자를 확정할 뿐이다. */
function onNoteKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Enter' || event.shiftKey || event.isComposing || event.keyCode === 229) return
  event.preventDefault()
  void onSave()
}

defineExpose({ capture, focusNote })
</script>

<template>
  <div class="moment-capture" :class="{ 'has-draft': capture.draft.value !== null }">
    <!-- ── ＋ 이 순간 저장 — 시점을 잡는다 (아직 저장하지 않는다) ─────────────── -->
    <div v-if="capture.draft.value === null" class="capture-row">
      <button
        ref="captureButton"
        type="button"
        class="pill pill--strong capture-button"
        :disabled="!capture.canCapture.value"
        :aria-describedby="`${idPrefix}-capture-hint`"
        @click="onCapture"
      >
        ＋ 이 순간 저장
      </button>
      <p :id="`${idPrefix}-capture-hint`" class="capture-hint">{{ capture.hint.value }}</p>
    </div>

    <!-- ── 저장 전 초안 — 메모(선택) → Moment 저장 ─────────────────────────── -->
    <form
      v-else
      class="note-form draft-form"
      :aria-labelledby="`${idPrefix}-note-target`"
      @submit.prevent="onSave"
    >
      <p :id="`${idPrefix}-note-target`" class="note-target">
        <span class="draft-state">저장 전</span>
        <span class="target-time">{{ capture.draftTime.value }}</span>
        <span class="target-title">{{ capture.draft.value.title }}</span>
      </p>
      <p v-if="capture.isDraftStale.value" class="stale-note">
        재생 중인 곡이 바뀌었어요. 이 초안은 위에 적힌 곡 · 시점으로 저장돼요. 지금 곡으로 바꾸려면
        ↻ 다시 잡기를 누르세요.
      </p>
      <label class="label" :for="`${idPrefix}-capture-note`">메모 (선택)</label>
      <textarea
        :id="`${idPrefix}-capture-note`"
        ref="noteField"
        v-model="capture.note.value"
        class="field field--area"
        rows="2"
        :maxlength="MAX_MOMENT_NOTE_LENGTH"
        :aria-invalid="capture.isNoteTooLong.value || undefined"
        :aria-describedby="`${idPrefix}-capture-count`"
        @keydown="onNoteKeydown"
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
        <template v-else> · Enter 저장 · Shift+Enter 줄바꿈</template>
      </p>
      <div class="row-actions">
        <button
          type="submit"
          class="pill pill--strong draft-save"
          :disabled="capture.isNoteTooLong.value || capture.saving.value"
          :aria-busy="capture.saving.value ? 'true' : 'false'"
        >
          {{ capture.saving.value ? '저장 중…' : 'Moment 저장' }}
        </button>
        <button
          type="button"
          class="pill draft-cancel"
          :disabled="capture.saving.value"
          @click="onCancel"
        >
          취소
        </button>
        <button
          type="button"
          class="pill draft-recapture"
          :disabled="!capture.canCapture.value"
          @click="onRecapture"
        >
          ↻ 지금 시점으로 다시 잡기
        </button>
      </div>
    </form>

    <!-- 잡기 · 저장 결과. 라이브 영역은 늘 있다 — 비어 있으면 자리를 차지하지 않는다. -->
    <p
      class="feedback"
      :class="{ 'is-warning': capture.feedback.value?.tone === 'warning' }"
      role="status"
      aria-live="polite"
    >
      {{ capture.feedback.value?.text ?? '' }}
    </p>
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
  border: 1px dashed var(--row-selected-border-color);
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

/* 저장 전 — 저장된 줄의 "방금 저장" 과 다른 모양 (점선). */
.draft-state {
  flex: none;
  padding: 0 5px;
  border: 1px dashed var(--accent-strong-color);
  color: var(--drawer-title-text-color);
  font: 10px/1.6 var(--font-mono);
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
