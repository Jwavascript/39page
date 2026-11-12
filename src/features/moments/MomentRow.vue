<script setup lang="ts">
/**
 * Moment 한 줄 (M11-4 — `MomentList` 에서 떼어 냈다).
 *
 * **표현 컴포넌트다.** store 도 코디네이터도 모른다. 재생 · 관리 · 삭제는 이벤트로 올리고, 어느 줄이
 * 무엇을 펼쳤는지(한 번에 하나)는 부모가 `mode` 로 정한다.
 *
 * 떼어 낸 이유 — 성능 (M9-6: 행 배치가 병목). 메모를 쓰는 동안의 입력(`draft`)이 **이 줄 안에만**
 * 있으므로 글자를 칠 때 다른 줄이 다시 그려지지 않는다. 다른 줄의 props(Moment 객체 · 제목 문자열 ·
 * 검색 낱말 배열)는 그대로라서 Vue 가 건너뛴다.
 *
 * 메모 저장만 **결과를 기다리는 함수**(`saveNote`)로 받는다 (M10-3 안정화). 저장은 탭 간 잠금 안에서
 * 끝나고 거절될 수 있다(`conflict` · `busy`) — 그때 폼을 닫으면 쓴 메모가 사라진다. `true` 일 때만 닫는다.
 *
 * 메모 · 제목은 **일반 텍스트**로만 그린다. 강조(`<mark>`)도 조각을 보간으로 그린다 — HTML 로 해석하지 않는다.
 */
import { computed, nextTick, ref, watch } from 'vue'

import type { Moment } from '@/shared/types'

import { highlight, noteLine } from './momentsSearch'
import { formatMomentTime } from './momentsView'

export type MomentRowMode = 'idle' | 'manage' | 'edit' | 'confirm'

const props = defineProps<{
  moment: Readonly<Moment>
  /** 그 곡의 표시 제목 — 단추 이름(aria)에 쓰고, `showSongTitle` 이면 줄에 적는다. */
  songTitle: string
  /** 최근(평면) 보기 — 묶음 머리가 없으니 줄마다 곡 제목을 적는다. */
  showSongTitle?: boolean
  /** 지금 곡인지 (평면 보기에서 줄을 강조). */
  isCurrent?: boolean
  /** 검색 낱말 (정규화됨). 없으면 빈 배열. */
  terms: readonly string[]
  mode: MomentRowMode
  idPrefix: string
  maxNoteLength: number
  saveNote: (momentId: string, note: string) => Promise<boolean>
}>()

const emit = defineEmits<{
  play: [momentId: string]
  'toggle-manage': [momentId: string]
  edit: [momentId: string]
  'request-remove': [momentId: string]
  'cancel-remove': [momentId: string]
  'confirm-remove': [momentId: string]
  /** 편집 폼을 닫았다 (저장했거나 취소). */
  'close-edit': [momentId: string]
}>()

const time = computed<string>(() => formatMomentTime(props.moment.atSeconds))
const line = computed<string>(() => noteLine(props.moment.note, props.terms))
const noteSegments = computed(() => highlight(line.value, props.terms))
const titleSegments = computed(() =>
  props.showSongTitle === true ? highlight(props.songTitle, props.terms) : [],
)
const id = (suffix: string): string => `${props.idPrefix}-${suffix}-${props.moment.id}`

/* ── 메모 편집 — 이 줄 안에만 있는 상태 ───────────────────────────── */
const draft = ref('')
const error = ref('')
const saving = ref(false)
const textarea = ref<HTMLTextAreaElement | null>(null)

watch(
  () => props.mode,
  (mode) => {
    if (mode !== 'edit') return
    draft.value = props.moment.note
    error.value = ''
    void nextTick(() => textarea.value?.focus())
  },
  { immediate: true },
)

async function submit(): Promise<void> {
  if (saving.value) return
  if (draft.value.length > props.maxNoteLength) {
    error.value = `메모는 ${String(props.maxNoteLength)}자까지 쓸 수 있어요.`
    return
  }
  saving.value = true
  let done: boolean
  try {
    done = await props.saveNote(props.moment.id, draft.value)
  } finally {
    saving.value = false
  }
  // 거절되면(다른 탭 · 잠금) 폼을 남긴다 — 쓴 메모를 잃지 않게. 이유는 위의 안내 자리가 말한다.
  if (done && props.mode === 'edit') emit('close-edit', props.moment.id)
  else if (!done)
    error.value =
      '저장하지 못했어요 — 메모는 그대로 있어요. 위 안내를 확인한 뒤 다시 저장해 주세요.'
}
</script>

<template>
  <li class="moment-item" :class="{ 'is-current': isCurrent }">
    <div class="moment">
      <button
        type="button"
        class="moment-play"
        :data-moment-play="moment.id"
        :aria-label="`${songTitle} ${time} 부터 재생`"
        :title="`${time} 부터 재생`"
        @click="emit('play', moment.id)"
      >
        <span aria-hidden="true">▶</span>
        <span class="moment-time">{{ time }}</span>
      </button>
      <span class="moment-text">
        <span v-if="showSongTitle" class="moment-song"
          ><template v-for="(part, i) in titleSegments" :key="i"
            ><mark v-if="part.match">{{ part.text }}</mark
            ><template v-else>{{ part.text }}</template></template
          ><template v-if="isCurrent"> · 재생 중</template></span
        >
        <!-- 전체 메모는 title 로도 볼 수 있다. 텍스트로만 그린다. -->
        <span class="moment-note" :class="{ 'is-empty': line === '' }" :title="moment.note"
          ><template v-if="line === ''">메모 없음</template
          ><template v-for="(part, i) in noteSegments" v-else :key="i"
            ><mark v-if="part.match">{{ part.text }}</mark
            ><template v-else>{{ part.text }}</template></template
          ></span
        >
      </span>
      <button
        type="button"
        class="moment-manage"
        :data-moment-manage="moment.id"
        :aria-expanded="mode === 'manage'"
        :aria-controls="id('actions')"
        :aria-label="`${songTitle} ${time} 관리`"
        @click="emit('toggle-manage', moment.id)"
      >
        관리
      </button>
    </div>

    <!-- 관리 — 메모 수정, 그리고 떨어진 자리의 삭제. 클래스 이름 `moment-controls` 는 M9 의 것을 잇는다. -->
    <div
      v-if="mode === 'manage'"
      :id="id('actions')"
      class="moment-controls"
      role="group"
      :aria-label="`${time} 관리 메뉴`"
    >
      <button
        type="button"
        class="pill"
        :data-moment-edit="moment.id"
        :aria-label="`${songTitle} ${time} 메모 수정`"
        @click="emit('edit', moment.id)"
      >
        ✎ 메모 수정
      </button>
      <button
        type="button"
        class="pill pill--danger"
        :data-moment-remove="moment.id"
        :aria-label="`${songTitle} ${time} 순간 삭제`"
        @click="emit('request-remove', moment.id)"
      >
        삭제
      </button>
    </div>

    <!-- 고치는 줄 **바로 아래** — 무엇의 메모인지 자리가 말해준다. 입력란은 내용만큼 자란다(내부 스크롤 없음). -->
    <form v-if="mode === 'edit'" class="edit-form" @submit.prevent="submit">
      <label class="label" :for="id('note')">{{ time }} 메모</label>
      <textarea
        :id="id('note')"
        ref="textarea"
        v-model="draft"
        class="field field--area"
        rows="3"
        :maxlength="maxNoteLength"
        :aria-invalid="error !== '' || undefined"
        :aria-describedby="`${id('note')}-count`"
      />
      <p :id="`${id('note')}-count`" class="counter">{{ draft.length }} / {{ maxNoteLength }}</p>
      <p class="error-msg" role="alert">{{ error }}</p>
      <div class="row-actions">
        <button
          type="submit"
          class="pill pill--strong"
          :disabled="saving"
          :aria-busy="saving ? 'true' : 'false'"
        >
          {{ saving ? '저장 중…' : '저장' }}
        </button>
        <button type="button" class="pill" @click="emit('close-edit', moment.id)">취소</button>
      </div>
    </form>

    <div
      v-if="mode === 'confirm'"
      class="confirm"
      role="alertdialog"
      :aria-label="`${time} 순간 삭제 확인`"
    >
      <p class="confirm-text">{{ time }} 순간을 지울까요? 메모도 함께 사라집니다.</p>
      <div class="row-actions">
        <button type="button" class="pill pill--strong" @click="emit('confirm-remove', moment.id)">
          삭제
        </button>
        <button type="button" class="pill" @click="emit('cancel-remove', moment.id)">취소</button>
      </div>
    </div>
  </li>
</template>

<style scoped>
/*
 * 색과 치수는 모두 기존 토큰이다. 행은 `TrackList` 의 `.track` 값을, 버튼은
 * `.track-play` · `.track-controls` 값을 그대로 따른다 (새 치수·새 색 없음).
 */
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

/* 지금 곡 — 묶음이면 묶음이, 평면 보기면 줄이 테두리로 알린다. 글("재생 중")도 함께. */
:global(.moment-group.is-current) .moment,
.moment-item.is-current .moment {
  border-color: var(--track-current-border-color);
}

/* 시점이 버튼의 일부다 — 누르는 것이 "그 시점부터 재생" 이다. */
.moment-play {
  display: flex;
  /* 터치 목표 44px (M11 U16). */
  min-height: 44px;
  flex: none;
  align-items: center;
  padding: 0 6px;
  border: 0;
  background: transparent;
  color: var(--track-play-text-color);
  gap: 6px;
}

@media (hover: hover) {
  .moment-play:hover,
  .moment-manage:hover {
    color: var(--row-action-hover-text-color);
  }

  .pill:hover:not(.pill--strong) {
    background: var(--pill-surface-hover-color);
  }
}

.moment-time {
  color: var(--track-name-text-color);
  font: 11px var(--font-mono);
  font-variant-numeric: tabular-nums;
}

.moment-text {
  display: grid;
  min-width: 0;
  flex: 1;
  gap: 2px;
}

.moment-song {
  color: var(--row-meta-text-color);
  font: 10px/1.4 var(--font-mono);
  overflow-wrap: anywhere;
}

.moment-note {
  min-width: 0;
  color: var(--track-name-text-color);
  font-size: 12px;
  line-height: 1.35;
  overflow-wrap: anywhere;
}

.moment-note.is-empty {
  color: var(--row-meta-text-color);
  font-style: italic;
}

/* 검색 강조 — 브라우저 기본 노랑 대신 테마의 강조색 테두리. 색만이 아니라 밑줄도. */
mark {
  background: transparent;
  color: inherit;
  font-weight: 700;
  text-decoration: underline;
  text-decoration-color: var(--accent-color);
  text-decoration-thickness: 2px;
  text-underline-offset: 2px;
}

.moment-manage {
  min-width: 56px;
  min-height: 44px;
  flex: none;
  padding: 0 10px;
  border: 1px solid var(--pill-border-color);
  border-radius: var(--radius-control);
  background: transparent;
  color: var(--row-action-text-color);
  font: 11px var(--font-mono);
}

.moment-manage[aria-expanded='true'] {
  border-color: var(--row-selected-border-color);
  background: var(--row-selected-surface-color);
  color: var(--row-text-color);
}

/* 관리 줄 — 글자 이름이 있는 단추. 삭제는 맨 끝으로 떨어진다. */
.moment-controls {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 4px;
  padding: 6px;
  border: 1px solid var(--row-selected-border-color);
  background: var(--row-selected-surface-color);
}

.moment-controls .pill--danger {
  margin-left: auto;
}

.pill--danger {
  border-color: var(--error-text-color);
  color: var(--error-text-color);
}

/* `TrackList` 의 이름 변경 폼 · 삭제 확인과 같은 값이다. */
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

/* 내용만큼 자란다 (지원하는 브라우저) — 입력란 안의 두 번째 스크롤을 만들지 않는다. */
.field--area {
  min-height: 4.5em;
  field-sizing: content;
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
  min-height: 44px;
  padding: 7px 12px;
  border: 1px solid var(--pill-border-color);
  border-radius: var(--radius-control);
  background: var(--pill-surface-color);
  color: var(--pill-text-color);
  font: 11px var(--font-mono);
}

.pill--strong {
  border-color: var(--accent-strong-color);
  background: var(--accent-strong-color);
  color: var(--accent-strong-text-color);
}
</style>
