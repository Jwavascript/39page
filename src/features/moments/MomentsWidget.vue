<script setup lang="ts">
/**
 * Music Moments 위젯 (M9-4).
 *
 * 영상의 한 순간을 남기고(F13), 목록에서 찾아(F14), 그 지점부터 다시 듣고(F15),
 * 메모를 고치거나 지운다(F16).
 *
 * 이 컴포넌트는 **조립만** 한다 (`AGENTS.md` 규칙 3).
 *
 *   `useMomentCapture`   지금 시점을 고정하고 저장한다
 *   `useMomentsBrowser`  묶고 거르고, 재생·수정·삭제를 요청한다
 *   `MomentList`         행을 그리고 확인을 받는다 (표현 전용)
 *   `MomentsStatusBanner` 저장소 보호·실패 안내
 *
 * 자리는 **정보 열의 빈자리**다 (넓은 화면). M7-4 가 시계·날씨 아래를 다른
 * 위젯 자리로 비워 두었다. 그 칸에서 끝나므로 위젯을 늘려도 데크·플레이어·
 * 플레이리스트를 밀지 않는다 (`WidgetHost.vue`). 저장 버튼을 플레이어
 * 트랜스포트 줄이 아니라 여기에 둔 이유는 **ADR 0021** 에 실측과 함께 있다.
 *
 * 플레이어도 YouTube API 도 모른다. iframe 을 만들거나 옮기지 않는다.
 */
import { computed, nextTick, ref } from 'vue'

import { MAX_MOMENT_NOTE_LENGTH } from '@/stores/moments'

import MomentList from './MomentList.vue'
import MomentsStatusBanner from './MomentsStatusBanner.vue'
import { useMomentCapture } from './useMomentCapture'
import { useMomentsBrowser } from './useMomentsBrowser'

const capture = useMomentCapture()
const browser = useMomentsBrowser()

/**
 * 접힘/펼침. **좁은 화면에서만** 의미가 있다.
 *
 * 넓은 화면에서 이 위젯은 정보 열의 남은 칸을 그대로 채우고 그 안에서
 * 스크롤한다 — 접어도 다른 위젯이 올라오지 않는다. 그래서 그때는 토글을
 * 그리지 않는다 (CSS). 좁은 화면에서는 위젯이 한 행을 차지하므로 플레이리스트
 * 위젯과 **같은 방식·같은 치수**로 접는다 (F14, M7 패턴). 기본은 접힘이다.
 */
const isExpanded = ref(false)

const captureButton = ref<HTMLButtonElement | null>(null)
const noteField = ref<HTMLTextAreaElement | null>(null)

const isCapturing = computed<boolean>(() => capture.target.value !== null)

function beginCapture(): void {
  browser.clearFeedback()
  if (!capture.begin()) return
  // 메모 칸으로 바로 간다. 쓰지 않고 저장해도 된다 — 메모는 선택이다.
  void nextTick(() => noteField.value?.focus())
}

function finishCapture(): void {
  // 폼이 사라진다. 포커스를 저장 버튼으로 되돌린다.
  void nextTick(() => captureButton.value?.focus())
}

function submitCapture(): void {
  if (capture.submit()) finishCapture()
}

function cancelCapture(): void {
  capture.cancel()
  finishCapture()
}

function onSaveNote(momentId: string, note: string): void {
  browser.saveNote(momentId, note)
}

const emptyMessage = computed<string>(() => {
  if (browser.total.value === 0) return ''
  return browser.currentVideoId.value === null
    ? '지금 재생 중인 곡이 없어요.'
    : '이 곡에 저장한 순간이 없어요.'
})
</script>

<template>
  <section
    class="moments-widget"
    :class="{ 'is-collapsed': !isExpanded }"
    aria-labelledby="moments-widget-title"
  >
    <div class="widget-head">
      <div class="head-text">
        <h2 id="moments-widget-title" class="widget-title">MOMENTS</h2>
        <p class="widget-sub">{{ browser.total.value }}개 · 지금 이 순간을 남기고 다시 듣기</p>
      </div>
      <!--
        좁은 화면 전용 (CSS). 목록이 없으면 접고 펼 것도 없으므로 그리지 않는다.
        저장 폼을 쓰는 동안에는 목록이 잠시 물러나므로 함께 숨긴다.
      -->
      <button
        v-if="browser.total.value > 0"
        v-show="!isCapturing"
        type="button"
        class="pill expand-toggle"
        :aria-expanded="isExpanded"
        aria-controls="moments-list"
        @click="isExpanded = !isExpanded"
      >
        {{ isExpanded ? '접기' : '펼치기' }}
      </button>
    </div>

    <div class="moments-body">
      <MomentsStatusBanner />

      <!-- ── 지금 이 순간 저장 (F13) ───────────────────────────────── -->
      <div v-if="!isCapturing" class="capture-idle">
        <button
          ref="captureButton"
          type="button"
          class="pill pill--strong capture-button"
          :disabled="!capture.canCapture.value"
          aria-describedby="moment-capture-hint"
          @click="beginCapture"
        >
          ＋ 이 순간 저장
        </button>
        <p id="moment-capture-hint" class="capture-hint">{{ capture.hint.value }}</p>
      </div>

      <!--
        누른 순간의 대상을 **고정해** 보여준다. 메모를 쓰는 동안 재생이 흘러도,
        곡이 바뀌어도 저장되는 것은 이 줄에 적힌 순간이다 (ADR 0020 결정 4).
      -->
      <form
        v-else
        class="capture-form"
        aria-labelledby="moment-capture-target"
        @submit.prevent="submitCapture"
      >
        <p id="moment-capture-target" class="capture-target">
          <span class="target-time">{{ capture.targetTime.value }}</span>
          <span class="target-title" :title="capture.target.value?.title">{{
            capture.target.value?.title
          }}</span>
        </p>
        <p v-if="capture.isTargetStale.value" class="stale-note">
          재생 중인 곡이 바뀌었어요. 메모는 위에 적힌 순간에 저장됩니다.
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
          <button type="submit" class="pill pill--strong" :disabled="capture.isNoteTooLong.value">
            저장
          </button>
          <button type="button" class="pill" @click="cancelCapture">취소</button>
        </div>
      </form>

      <!-- 항상 있는 라이브 영역. 저장 결과를 누른 자리에서 말한다. -->
      <p
        class="feedback"
        :class="{ 'is-warning': capture.feedback.value?.tone === 'warning' }"
        role="status"
        aria-live="polite"
      >
        {{ capture.feedback.value?.text ?? '' }}
      </p>

      <!-- ── 목록 (F14) — 저장 폼을 쓰는 동안에는 잠시 물러난다 ────────── -->
      <div
        v-if="browser.total.value > 0"
        v-show="!isCapturing"
        class="filter"
        role="group"
        aria-label="보여줄 순간"
      >
        <button
          type="button"
          class="pill chip"
          :class="{ 'pill--strong': browser.filter.value === 'current' }"
          :aria-pressed="browser.filter.value === 'current'"
          :disabled="browser.currentVideoId.value === null"
          @click="browser.filter.value = 'current'"
        >
          이 곡 {{ browser.currentCount.value }}
        </button>
        <button
          type="button"
          class="pill chip"
          :class="{ 'pill--strong': browser.filter.value === 'all' }"
          :aria-pressed="browser.filter.value === 'all'"
          @click="browser.filter.value = 'all'"
        >
          전체 {{ browser.total.value }}
        </button>
      </div>

      <p
        class="feedback"
        :class="{ 'is-warning': browser.feedback.value?.tone === 'warning' }"
        role="status"
        aria-live="polite"
      >
        {{ browser.feedback.value?.text ?? '' }}
      </p>

      <div v-show="!isCapturing" id="moments-list" class="list-scroll">
        <p v-if="browser.total.value === 0" class="empty">
          아직 저장한 순간이 없어요.<br />곡을 듣다가 ＋ 이 순간 저장을 눌러보세요.
        </p>
        <p v-else-if="browser.groups.value.length === 0" class="empty">{{ emptyMessage }}</p>
        <MomentList
          v-else
          :groups="browser.groups.value"
          :current-video-id="browser.currentVideoId.value"
          :max-note-length="MAX_MOMENT_NOTE_LENGTH"
          @play="(id) => void browser.play(id)"
          @save-note="onSaveNote"
          @remove="browser.remove"
        />
      </div>
    </div>
  </section>
</template>

<style scoped>
/*
 * 색·치수는 기존 토큰만 쓴다 (IMPLEMENTATION_PLAN 4.7). 머리말은
 * `PlaylistWidget` 과 같은 조판이고, 목록 스크롤 높이도 플레이리스트 위젯의
 * 토큰을 그대로 쓴다 — "같은 펼침 방식" 이므로 같은 치수다.
 */
.moments-widget {
  display: flex;
  min-width: 0;
  min-height: 0;
  flex-direction: column;
  gap: 10px;
}

/*
 * 포커스 링을 **안쪽으로** 그린다.
 *
 * 전역 링은 요소 밖으로 5px(두께 2 + 간격 3) 나간다. 이 위젯은 넓은 화면에서
 * 정해진 칸 안에서 스크롤하므로, 가장자리에 붙은 버튼의 링이 스크롤 영역에
 * 잘린다. 링 색과 두께는 그대로 두고 위치만 안으로 들인다.
 */
.moments-widget :focus-visible {
  outline-offset: calc(-1 * var(--focus-ring-width));
}

.widget-head {
  display: flex;
  flex: none;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
}

.head-text {
  min-width: 0;
}

/* `PlaylistWidget` 의 `.widget-title` · `.widget-sub` 와 같은 조판이다. */
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

.moments-body {
  display: flex;
  min-height: 0;
  flex: 1 1 auto;
  flex-direction: column;
  gap: 10px;
}

.capture-idle {
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
  font: 10px/1.5 var(--font-mono);
}

/* `TrackList` 의 이름 변경 폼과 같은 상자다. */
.capture-form {
  padding: 10px 12px;
  border: 1px solid var(--row-selected-border-color);
  background: var(--row-selected-surface-color);
}

.capture-target {
  display: flex;
  min-width: 0;
  align-items: baseline;
  margin: 0 0 10px;
  gap: 8px;
}

.target-time {
  flex: none;
  color: var(--accent-color);
  font: 13px var(--font-mono);
  font-variant-numeric: tabular-nums;
}

.target-title {
  overflow: hidden;
  min-width: 0;
  color: var(--row-text-color);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.stale-note {
  margin: 0 0 10px;
  color: var(--status-warning-text-color);
  font: 10px/1.6 var(--font-mono);
}

.label {
  display: block;
  margin: 0 0 7px;
  color: var(--label-text-color);
  font: 11px var(--font-mono);
}

/* 승인된 디자인의 `.field` 값을 따른다. 여러 줄이라 높이만 내용에 맡긴다. */
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

/* 안내. 비어 있으면 자리를 차지하지 않는다 — 라이브 영역 자체는 남는다. */
.feedback {
  margin: 0;
  color: var(--status-text-color);
  font: 10px/1.6 var(--font-mono);
}

.feedback:empty {
  display: none;
}

.feedback.is-warning {
  color: var(--status-warning-text-color);
}

.filter {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

/* 승인된 디자인의 `.pill` 값을 따른다. */
.pill {
  min-height: 36px;
  flex: none;
  padding: 7px 12px;
  border: 1px solid var(--pill-border-color);
  border-radius: var(--radius-control);
  background: var(--pill-surface-color);
  color: var(--pill-text-color);
  font: 11px var(--font-mono);
}

.pill:hover:not(:disabled) {
  background: var(--pill-surface-hover-color);
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

.pill--strong:hover:not(:disabled) {
  background: var(--accent-strong-color);
}

/* 거르기 단추. 눌린 쪽이 강조된다 — `aria-pressed` 와 같은 것을 색으로도 말한다. */
.chip {
  min-height: 32px;
  padding: 5px 10px;
}

/*
 * 목록 스크롤. **좁은 화면**의 기본값이다 — 플레이리스트 위젯과 같은 토큰.
 * 접힘: 줄 두세 개, 펼침: 플레이리스트 위젯의 펼친 높이.
 */
.list-scroll {
  min-height: 0;
  max-height: var(--size-playlist-collapsed-max-height);
  overflow-y: auto;
  /*
   * 스크롤바 자리를 **늘 비워 둔다** (M9-6 성능).
   *
   * 스크롤바가 폭을 차지하는 환경(Windows·Linux 데스크톱 Chrome 등)에서
   * `overflow-y: auto` 는 내용이 바뀔 때마다 "스크롤바가 필요한가" 를 정하려고
   * 목록 전체를 다시 배치한다. 1000개에서 한 줄만 바뀌어도 레이아웃이
   * 550~700ms 걸렸고(M9-6 실측, 1440px), 저장·삭제 확인·메모 수정을 열 때마다
   * 그만큼 멈췄다. 자리를 고정하면 폭이 바뀔 일이 없어 바뀐 줄만 다시
   * 배치한다 — 같은 조건에서 10ms.
   *
   * 스크롤바가 내용 위에 겹치는 환경(Android·iOS·macOS 기본)에서는 아무 효과가
   * 없다. 그런 환경인 390px 모바일 에뮬레이션에서는 처음부터 이 비용이 없었다
   * (8ms). 실기기로는 재지 않았다.
   */
  scrollbar-gutter: stable;
}

.moments-widget:not(.is-collapsed) .list-scroll {
  max-height: var(--size-playlist-max-height);
}

.empty {
  margin: 0;
  color: var(--drawer-muted-text-color);
  font-size: 11px;
  line-height: 1.6;
}

/*
 * 넓은 화면: 정보 열의 남은 칸을 **그대로** 쓴다.
 *
 * 위젯의 높이는 `WidgetHost` 가 그 칸에 맞춰 준다(`contain: size` + 늘이기).
 * 몸통이 칸 안에서 스크롤하고, 목록은 남은 높이를 모두 쓴다. 접을 이유가
 * 없으므로 토글을 그리지 않는다.
 */
@media (min-width: 1101px) {
  .moments-body {
    overflow-y: auto;
  }

  .list-scroll,
  .moments-widget:not(.is-collapsed) .list-scroll {
    max-height: none;
    flex: 1 1 auto;
  }

  .expand-toggle {
    display: none;
  }
}
</style>
