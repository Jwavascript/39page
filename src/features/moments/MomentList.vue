<script setup lang="ts">
/**
 * 영상별로 묶은 Moment 목록 (M9-4, F14 · F16).
 *
 * **표현 컴포넌트다.** store 도 코디네이터도 모른다. 묶음을 props 로 받고,
 * 재생·삭제는 이벤트로 올린다 (`AGENTS.md` 규칙 3). `TrackList` 와
 * 같은 구조다 — 같은 앱의 같은 종류의 행이 같은 방식으로 움직인다.
 *
 * 메모 저장만 **결과를 기다리는 함수**(`saveNote`)로 받는다 (M10-3 안정화). 저장은
 * 탭 간 잠금 안에서 끝나고 거절될 수 있다(`conflict` · `busy`) — 그때 폼을 닫으면
 * 쓴 메모가 사라진다. 결과가 `true` 일 때만 닫는다.
 *
 * 삭제 확인은 **여기서** 받는다. 확인된 뒤에만 `remove` 를 올린다. 사용자
 * 데이터를 지우는 동작이므로 한 번 더 묻는다 (F16).
 *
 * 메모는 **일반 텍스트**로만 그린다. 보간(`{{ }}`)만 쓰고 HTML 로 해석하지
 * 않는다 — 사용자가 `<b>` 를 쓰면 `<b>` 가 보인다.
 */
import { nextTick, ref } from 'vue'

import { firstLine, formatMomentTime, type MomentGroup } from './momentsView'

const props = defineProps<{
  groups: readonly MomentGroup[]
  /** 지금 재생 중인 영상. 그 묶음을 강조한다. */
  currentVideoId: string | null
  maxNoteLength: number
  /** 메모를 저장한다. 폼을 닫아도 되면 `true` — 거절되면 `false` 이고 쓴 메모를 지킨다. */
  saveNote: (momentId: string, note: string) => Promise<boolean>
}>()

const emit = defineEmits<{
  play: [momentId: string]
  remove: [momentId: string]
}>()

/** 메모 저장을 기다리는 중 — 두 번 저장되지 않게 버튼을 끈다. */
const isSavingNote = ref(false)

/** 메모를 고치는 중인 Moment. 한 번에 하나만 열린다. */
const editingId = ref<string | null>(null)
const draftNote = ref('')
const editError = ref('')

/** 삭제 확인 중인 Moment. `confirm()` 대신 그 줄 바로 아래에서 묻는다. */
const pendingRemoveId = ref<string | null>(null)

/**
 * 목록 루트. 포커스를 옮길 때만 쓴다. `v-for` 안의 `ref` 는 배열이 되므로
 * 루트에서 찾는다 (`TrackList` 와 같은 이유).
 */
const root = ref<HTMLElement | null>(null)

function focusIn(selector: string): void {
  void nextTick(() => {
    root.value?.querySelector<HTMLElement>(selector)?.focus()
  })
}

function startEdit(momentId: string, note: string): void {
  pendingRemoveId.value = null
  editingId.value = momentId
  draftNote.value = note
  editError.value = ''
  focusIn(`#moment-note-${momentId}`)
}

function closeEdit(): void {
  const momentId = editingId.value
  editingId.value = null
  draftNote.value = ''
  editError.value = ''
  // 폼이 사라진 자리에 포커스가 떨어지지 않게 그 줄의 ✎ 로 돌려준다.
  if (momentId !== null) focusIn(`[data-moment-edit="${momentId}"]`)
}

async function submitEdit(): Promise<void> {
  const momentId = editingId.value
  if (momentId === null || isSavingNote.value) return

  if (draftNote.value.length > props.maxNoteLength) {
    editError.value = `메모는 ${String(props.maxNoteLength)}자까지 쓸 수 있어요.`
    return
  }

  isSavingNote.value = true
  let done: boolean
  try {
    done = await props.saveNote(momentId, draftNote.value)
  } finally {
    isSavingNote.value = false
  }
  // 기다리는 동안 다른 줄을 열었으면 그 폼을 닫지 않는다.
  if (done && editingId.value === momentId) closeEdit()
}

function requestRemove(momentId: string): void {
  // 고치는 중에 삭제를 누르면 폼을 닫는다. 두 폼이 겹치지 않게 한다 (TrackList 와 같다).
  editingId.value = null
  draftNote.value = ''
  editError.value = ''
  pendingRemoveId.value = momentId
}

function cancelRemove(): void {
  const momentId = pendingRemoveId.value
  pendingRemoveId.value = null
  if (momentId !== null) focusIn(`[data-moment-remove="${momentId}"]`)
}

function confirmRemove(): void {
  const momentId = pendingRemoveId.value
  if (momentId === null) return

  pendingRemoveId.value = null
  emit('remove', momentId)
  // 지운 줄이 사라진다. 포커스를 목록의 첫 재생 버튼으로 옮긴다.
  focusIn('.moment-play')
}

function noteLabel(note: string): string {
  const line = firstLine(note)
  return line === '' ? '메모 없음' : line
}
</script>

<template>
  <div ref="root" class="moment-list">
    <!-- :key 는 영상 ID 와 Moment id 다. 배열 인덱스를 쓰지 않는다. -->
    <section
      v-for="group in groups"
      :key="group.videoId"
      class="moment-group"
      :class="{ 'is-current': group.videoId === currentVideoId }"
      :aria-current="group.videoId === currentVideoId ? 'true' : undefined"
      :aria-labelledby="`moment-group-${group.videoId}`"
    >
      <div class="group-head">
        <h3 :id="`moment-group-${group.videoId}`" class="group-title" :title="group.title">
          {{ group.title }}
        </h3>
        <!-- 색에만 기대지 않는다. 지금 곡인지, 목록에서 빠졌는지 글로 적는다. -->
        <p class="group-meta">
          {{ group.moments.length }}개<template v-if="group.videoId === currentVideoId">
            · 재생 중</template
          ><template v-if="group.titleSource !== 'library'"> · 목록에 없음</template>
        </p>
      </div>

      <ul class="moment-rows">
        <li v-for="moment in group.moments" :key="moment.id" class="moment-item">
          <div class="moment">
            <button
              type="button"
              class="moment-play"
              :data-moment-play="moment.id"
              :aria-label="`${group.title} ${formatMomentTime(moment.atSeconds)} 부터 재생`"
              :title="`${formatMomentTime(moment.atSeconds)} 부터 재생`"
              @click="emit('play', moment.id)"
            >
              <span aria-hidden="true">▶</span>
              <span class="moment-time">{{ formatMomentTime(moment.atSeconds) }}</span>
            </button>
            <!-- 잘려도 전체 메모를 title 로 볼 수 있다. 텍스트로만 그린다. -->
            <span
              class="moment-note"
              :class="{ 'is-empty': firstLine(moment.note) === '' }"
              :title="moment.note"
              >{{ noteLabel(moment.note) }}</span
            >
            <span class="moment-controls">
              <button
                type="button"
                :data-moment-edit="moment.id"
                :aria-label="`${group.title} ${formatMomentTime(moment.atSeconds)} 메모 수정`"
                :title="`${formatMomentTime(moment.atSeconds)} 메모 수정`"
                @click="startEdit(moment.id, moment.note)"
              >
                ✎
              </button>
              <button
                type="button"
                :data-moment-remove="moment.id"
                :aria-label="`${group.title} ${formatMomentTime(moment.atSeconds)} 순간 삭제`"
                :title="`${formatMomentTime(moment.atSeconds)} 순간 삭제`"
                @click="requestRemove(moment.id)"
              >
                ×
              </button>
            </span>
          </div>

          <!-- 고치는 줄 **바로 아래**에 둔다. 무엇의 메모인지 자리가 말해준다. -->
          <form v-if="editingId === moment.id" class="edit-form" @submit.prevent="submitEdit">
            <label class="label" :for="`moment-note-${moment.id}`">
              {{ formatMomentTime(moment.atSeconds) }} 메모
            </label>
            <textarea
              :id="`moment-note-${moment.id}`"
              v-model="draftNote"
              class="field field--area"
              rows="3"
              :maxlength="maxNoteLength"
              :aria-invalid="editError !== '' || undefined"
              :aria-describedby="`moment-note-${moment.id}-count`"
            />
            <p :id="`moment-note-${moment.id}-count`" class="counter">
              {{ draftNote.length }} / {{ maxNoteLength }}
            </p>
            <p class="error-msg">{{ editError }}</p>
            <div class="row-actions">
              <button
                type="submit"
                class="pill pill--strong"
                :disabled="isSavingNote"
                :aria-busy="isSavingNote ? 'true' : 'false'"
              >
                저장
              </button>
              <button type="button" class="pill" @click="closeEdit">취소</button>
            </div>
          </form>

          <div
            v-if="pendingRemoveId === moment.id"
            class="confirm"
            role="alertdialog"
            :aria-label="`${formatMomentTime(moment.atSeconds)} 순간 삭제 확인`"
          >
            <p class="confirm-text">
              {{ formatMomentTime(moment.atSeconds) }} 순간을 지울까요? 메모도 함께 사라집니다.
            </p>
            <div class="row-actions">
              <button type="button" class="pill pill--strong" @click="confirmRemove">삭제</button>
              <button type="button" class="pill" @click="cancelRemove">취소</button>
            </div>
          </div>
        </li>
      </ul>
    </section>
  </div>
</template>

<style scoped>
/*
 * 색과 치수는 모두 기존 토큰이다. 행은 `TrackList` 의 `.track` 값을, 버튼은
 * `.track-play` · `.track-controls` 값을 그대로 따른다 (새 치수·새 색 없음).
 */
.moment-list {
  display: grid;
  gap: 12px;
}

.moment-group {
  display: grid;
  min-width: 0;
  gap: 5px;
}

.group-head {
  display: flex;
  min-width: 0;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
}

/* 드로어의 `.drawer-section-title` 조판이다. 묶음의 머리말이다. */
.group-title {
  overflow: hidden;
  min-width: 0;
  margin: 0;
  color: var(--drawer-section-title-text-color);
  font: 10px var(--font-mono);
  letter-spacing: 0.12em;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.group-meta {
  flex: none;
  margin: 0;
  color: var(--row-meta-text-color);
  font: 10px var(--font-mono);
}

/* 지금 곡의 묶음. 색과 함께 "· 재생 중" 글자로도 알린다. */
.moment-group.is-current .group-title {
  color: var(--accent-color);
}

.moment-group.is-current .moment {
  border-color: var(--track-current-border-color);
}

.moment-rows {
  display: grid;
  margin: 0;
  padding: 0;
  gap: 5px;
  list-style: none;
}

.moment-item {
  display: grid;
  min-width: 0;
  gap: 5px;
}

/* 승인된 디자인의 `.track` 값을 따른다. */
.moment {
  display: flex;
  min-width: 0;
  align-items: center;
  padding: 4px 7px 4px 3px;
  border: 1px solid transparent;
  background: var(--track-surface-color);
  gap: 7px;
}

/*
 * `.track-play` 의 색·높이에 시간 글자를 붙였다. 누르는 것이 "그 시점부터
 * 재생" 이므로 시점이 버튼의 일부다.
 */
.moment-play {
  display: flex;
  min-height: 29px;
  flex: none;
  align-items: center;
  padding: 0 6px;
  border: 0;
  background: transparent;
  color: var(--track-play-text-color);
  gap: 6px;
}

.moment-play:hover {
  color: var(--row-action-hover-text-color);
}

.moment-time {
  color: var(--track-name-text-color);
  font: 11px var(--font-mono);
  font-variant-numeric: tabular-nums;
}

.moment-note {
  overflow: hidden;
  min-width: 0;
  flex: 1;
  color: var(--track-name-text-color);
  font-size: 12px;
  line-height: 1.35;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.moment-note.is-empty {
  color: var(--row-meta-text-color);
  font-style: italic;
}

/* 승인된 디자인의 `.track-controls` 값을 따른다. */
.moment-controls {
  display: flex;
  flex: none;
  gap: 3px;
}

.moment-controls button {
  min-width: 28px;
  height: 29px;
  border: 0;
  background: transparent;
  color: var(--row-action-text-color);
}

.moment-controls button:hover {
  color: var(--row-action-hover-text-color);
}

/* `TrackList` 의 이름 변경 폼·삭제 확인과 같은 값이다. */
.edit-form,
.confirm {
  padding: 10px 12px;
  border: 1px solid var(--row-selected-border-color);
  background: var(--row-selected-surface-color);
}

.confirm-text {
  margin: 0 0 10px;
  color: var(--row-text-color);
  font: 12px/1.5 var(--font-mono);
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
  margin: 5px 0 0;
  color: var(--row-meta-text-color);
  font: 10px var(--font-mono);
  text-align: right;
}

.error-msg {
  min-height: 17px;
  margin: 2px 0 0;
  color: var(--error-text-color);
  font-size: 12px;
}

.row-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

/* 승인된 디자인의 `.pill` 값을 따른다. */
.pill {
  min-height: 36px;
  padding: 7px 12px;
  border: 1px solid var(--pill-border-color);
  border-radius: var(--radius-control);
  background: var(--pill-surface-color);
  color: var(--pill-text-color);
  font: 11px var(--font-mono);
}

.pill:hover {
  background: var(--pill-surface-hover-color);
}

.pill--strong {
  border-color: var(--accent-strong-color);
  background: var(--accent-strong-color);
  color: var(--accent-strong-text-color);
}
</style>
