<script setup lang="ts">
/**
 * 대시보드의 Music Moments — **이 곡의 Moments** (M9-4, M11-3 에서 다시 짰다 · ADR 0027 결정 5).
 *
 * 대시보드는 "보는 곳" 이다. 여기서 하는 일은 셋뿐이다.
 *
 * 1. **＋ 이 순간 저장** — 누르면 바로 저장한다 (D2). 메모는 그다음에 "메모 추가" 로 붙인다.
 * 2. **지금 곡의 Moments 미리보기** — 시점 순 최대 3개. 누르면 그 시점부터 재생한다.
 * 3. **모두 보기** — 검색 · 수정 · 삭제 · 전체 목록은 보관함 Moments 탭에서 한다.
 *
 * M9 의 긴 목록 · 거르기 · 인라인 수정 · 접기/펼치기는 보관함으로 옮겼다 — 정보 열의 좁은 칸(1280×800
 * 에서 274px)에서 목록이 1~2행만 보였고(U6) 수정 폼이 스크롤 안에서 잘렸다(U7). 위젯 안 스크롤이 없다.
 *
 * 저장 · 재생 · 메모의 판단은 composable 이 한다 (`useMomentCapture` · `useMomentsBrowser`). 이 컴포넌트는
 * 보여 주고 누름을 넘길 뿐이다 (`AGENTS.md` 규칙 3).
 */
import { computed, inject, nextTick, ref } from 'vue'

import { ARCHIVE } from '@/features/archive/archiveController'
import { MAX_MOMENT_NOTE_LENGTH, useMomentsStore } from '@/stores/moments'

import MomentsStatusBanner from './MomentsStatusBanner.vue'
import { firstLine, formatMomentTime } from './momentsView'
import { useMomentCapture } from './useMomentCapture'
import { useMomentsBrowser } from './useMomentsBrowser'

/** 미리보기에 보이는 수. 더 있으면 "모두 보기" 로 보관함에서 본다. */
const MOMENT_PREVIEW_LIMIT = 3

const capture = useMomentCapture()
const browser = useMomentsBrowser()
const moments = useMomentsStore()
const archive = inject(ARCHIVE, null)

const captureButton = ref<HTMLButtonElement | null>(null)
const noteField = ref<HTMLTextAreaElement | null>(null)

/** 지금 곡의 Moments — 시점 순. */
const currentMoments = computed(() => {
  const videoId = browser.currentVideoId.value
  return videoId === null ? [] : moments.momentsForVideo(videoId)
})
const preview = computed(() => currentMoments.value.slice(0, MOMENT_PREVIEW_LIMIT))
const moreCount = computed<number>(() => currentMoments.value.length - preview.value.length)

/** 방금 저장한 Moment 에 이미 메모가 있는지 — 단추 이름이 "메모 고치기" 가 된다. */
const lastSavedHasNote = computed<boolean>(() => {
  const saved = capture.lastSaved.value
  return saved !== null && (moments.getMoment(saved.id)?.note ?? '') !== ''
})

async function save(): Promise<void> {
  browser.clearFeedback()
  await capture.save()
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

function openAll(): void {
  archive?.open('moments')
}

/** 이 곡의 Moments 를 보관함에서 — 그 곡으로 걸러져 열린다 (M11-4). */
function openCurrent(): void {
  const videoId = browser.currentVideoId.value
  if (videoId === null) openAll()
  else archive?.open('moments', { videoId })
}
</script>

<template>
  <section class="moments-widget" aria-labelledby="moments-widget-title">
    <div class="widget-head">
      <div class="head-text">
        <h2 id="moments-widget-title" class="widget-title">MOMENTS</h2>
        <p class="widget-sub">
          이 곡 {{ currentMoments.length }}개 · 전체 {{ browser.total.value }}개
        </p>
      </div>
      <button type="button" class="pill" @click="openAll">
        모두 보기 ({{ browser.total.value }})
      </button>
    </div>

    <MomentsStatusBanner />

    <!-- ── ＋ 이 순간 저장 (F13 · 빠른 저장) ─────────────────────────────── -->
    <div class="capture-row">
      <button
        ref="captureButton"
        type="button"
        class="pill pill--strong capture-button"
        :disabled="!capture.canCapture.value"
        :aria-busy="capture.saving.value ? 'true' : 'false'"
        aria-describedby="moment-capture-hint"
        @click="save"
      >
        {{ capture.saving.value ? '저장 중…' : '＋ 이 순간 저장' }}
      </button>
      <p id="moment-capture-hint" class="capture-hint">{{ capture.hint.value }}</p>
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
      aria-labelledby="moment-note-target"
      @submit.prevent="submitNote"
    >
      <p id="moment-note-target" class="note-target">
        <span class="target-time">{{ capture.lastSavedTime.value }}</span>
        <span class="target-title">{{ capture.lastSaved.value.title }}</span>
      </p>
      <p v-if="capture.isLastSavedStale.value" class="stale-note">
        재생 중인 곡이 바뀌었어요. 메모는 위에 적힌 순간에 붙어요.
      </p>
      <label class="label" for="moment-capture-note">메모 (선택)</label>
      <textarea
        id="moment-capture-note"
        ref="noteField"
        v-model="capture.draftNote.value"
        class="field field--area"
        rows="3"
        :maxlength="MAX_MOMENT_NOTE_LENGTH"
        :aria-invalid="capture.isNoteTooLong.value || undefined"
        aria-describedby="moment-capture-count"
      />
      <p
        id="moment-capture-count"
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

    <!-- ── 이 곡의 Moments 미리보기 ────────────────────────────────────── -->
    <ul v-if="preview.length > 0" class="preview" aria-label="이 곡의 Moments">
      <li v-for="moment in preview" :key="moment.id" class="preview-row">
        <button
          type="button"
          class="preview-play"
          :data-moment-play="moment.id"
          :aria-label="`${formatMomentTime(moment.atSeconds)} 부터 재생${
            firstLine(moment.note) === '' ? '' : ` — ${firstLine(moment.note)}`
          }`"
          @click="() => void browser.play(moment.id)"
        >
          <span class="preview-time">▶ {{ formatMomentTime(moment.atSeconds) }}</span>
          <span class="preview-note" :class="{ 'is-empty': firstLine(moment.note) === '' }">{{
            firstLine(moment.note) === '' ? '메모 없음' : firstLine(moment.note)
          }}</span>
        </button>
      </li>
    </ul>
    <p v-if="moreCount > 0" class="more">
      이 곡의 Moments {{ moreCount }}개 더 —
      <button type="button" class="link" @click="openCurrent">모두 보기</button>
    </p>
    <p v-else-if="browser.total.value === 0" class="empty">
      아직 저장한 순간이 없어요. 곡을 듣다가 ＋ 이 순간 저장을 눌러보세요.
    </p>
    <p
      v-else-if="browser.currentVideoId.value !== null && currentMoments.length === 0"
      class="empty"
    >
      이 곡에 저장한 순간이 없어요.
    </p>

    <!-- 재생 결과 (가려짐 · 플레이어 준비 전 등) -->
    <p
      class="feedback"
      :class="{ 'is-warning': browser.feedback.value?.tone === 'warning' }"
      role="status"
      aria-live="polite"
    >
      {{ browser.feedback.value?.text ?? '' }}
    </p>
  </section>
</template>

<style scoped>
/*
 * 색 · 치수는 기존 토큰만 쓴다. 머리말은 `PlaylistWidget` 과 같은 조판이다. **위젯 안 스크롤이 없다** —
 * 미리보기는 최대 3행이고 나머지는 보관함이다 (M11-3).
 */
.moments-widget {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 10px;
}

.widget-head {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
}

.head-text {
  min-width: 0;
  flex: 1 1 0;
}

.widget-title {
  margin: 0;
  color: var(--drawer-title-text-color);
  font: 13px var(--font-mono);
  font-weight: 400;
  letter-spacing: 0.1em;
}

.widget-sub {
  margin: 7px 0 0;
  color: var(--drawer-sub-text-color);
  font: 11px var(--font-mono);
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

/* 승인된 디자인의 `.pill` 값을 따른다. 터치 목표 44px (M11 U16). */
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

/* 터치 뒤 hover 색이 남지 않게 (M11 U18). */
@media (hover: hover) {
  .pill:hover:not(:disabled):not(.pill--strong) {
    background: var(--pill-surface-hover-color);
  }

  .preview-play:hover {
    border-color: var(--row-selected-border-color);
  }
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

/* 안내. 비어 있으면 자리를 차지하지 않는다 — 라이브 영역 자체는 남는다. */
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

/* `TrackList` 의 이름 변경 폼과 같은 상자다. */
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

.preview {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.preview-play {
  display: flex;
  width: 100%;
  min-width: 0;
  min-height: 44px;
  align-items: center;
  gap: 10px;
  padding: 6px 10px;
  border: 1px solid transparent;
  border-radius: var(--radius-control);
  background: var(--row-surface-color);
  color: var(--row-text-color);
  text-align: left;
}

.preview-time {
  flex: none;
  color: var(--track-play-text-color);
  font: 12px var(--font-mono);
  font-variant-numeric: tabular-nums;
}

/* 메모는 두 줄까지 — 그 이상은 보관함에서 (U12). */
.preview-note {
  display: -webkit-box;
  overflow: hidden;
  min-width: 0;
  font-size: 12px;
  line-height: 1.45;
  overflow-wrap: anywhere;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  line-clamp: 2;
}

.preview-note.is-empty {
  color: var(--drawer-muted-text-color);
  font-style: italic;
}

.more,
.empty {
  margin: 0;
  color: var(--drawer-muted-text-color);
  font-size: 12px;
  line-height: 1.6;
}

.link {
  min-height: 44px;
  padding: 0 4px;
  border: 0;
  background: none;
  color: var(--row-text-color);
  font: inherit;
  text-decoration: underline;
}
</style>
