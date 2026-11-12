<script setup lang="ts">
/**
 * 한 플레이리스트의 트랙 목록 (M2-3, M11-3 에서 행을 다시 짰다).
 *
 * 표현만 맡는다. 누름을 이벤트로 올리고, 저장 · 재생은 부모(`PlaylistEditor`)가 한다. 재생 상태도
 * 모른다 — "지금 곡" 은 부모가 prop 으로 알려 준다 (코디네이터의 읽기 전용 보기, ADR 0009).
 *
 * M11-3 에서 바뀐 것 (U4 · U12 · U14 · U16 · U17)
 * - **▶ 재생은 그대로 드러나 있다** — 자주 쓰는 일이다. 44×44.
 * - 이름 바꾸기 · 위 · 아래 · 삭제는 **"관리"** 단추를 누르면 행 아래에 글자 이름과 함께 펼쳐진다.
 *   아이콘 넷이 3px 간격으로 붙어 있던 자리(28×29)에서 잘못 누르기 쉬웠다. 단추에 글자가 있어 숨기는
 *   것이 아니라 **한 번 더 펼치는 것**이다 — 행마다 무엇이 있는지 "관리" 라는 이름이 말한다.
 * - 삭제는 그 줄의 맨 끝, 다른 단추와 떨어져 있고, 확인은 **그 행 바로 아래**에서 받는다.
 * - 긴 제목이 말줄임으로 잘리지 않고 줄을 바꾼다.
 * - 지금 곡은 글("재생 중")과 `aria-current` 로도 알린다 — 색만이 아니다.
 */
import { nextTick, onBeforeUnmount, ref } from 'vue'

import type { DeepReadonly } from 'vue'

import type { Track } from '@/shared/types'
import { MAX_TRACK_TITLE_LENGTH } from '@/stores/library'

const props = defineProps<{
  /**
   * 표시할 트랙. `null` 은 "선택된 플레이리스트 없음", 빈 배열은
   * "플레이리스트는 있지만 비어 있음" 이다. 둘의 안내 문구가 다르다.
   */
  tracks: DeepReadonly<Track[]> | null
  /** 지금 큐의 곡 (트랙 id). 없으면 `null`. */
  nowPlayingTrackId?: string | null
  /** 지금 곡이 실제로 소리 나는 중인지 — 일시정지면 "지금 곡" 으로 적는다. */
  nowPlayingActive?: boolean
  /**
   * 영상 ID → 그 영상의 Moment 수 (M11-4 §5-4). 있으면 행에 `◆ N` 단추 — 누르면 Moments 탭이 그 곡으로
   * 걸러져 열린다. 수는 부모가 Moments store 에서 읽어 준다 (이 컴포넌트는 store 를 모른다).
   */
  momentCounts?: ReadonlyMap<string, number>
}>()

const emit = defineEmits<{
  play: [trackId: string]
  move: [trackId: string, direction: 'up' | 'down']
  remove: [trackId: string]
  rename: [trackId: string, title: string]
  moments: [videoId: string]
}>()

/**
 * 다른 곳(Moments 묶음 머리의 "목록: A")에서 찾아온 곡 (M11-4). 테두리로 보이고, 그 줄의 ▶ 로 포커스가 온다.
 * 잠시 뒤 표시를 거둔다 — 오래 남으면 "지금 곡" 표시와 헷갈린다.
 */
const revealedId = ref<string | null>(null)
let revealTimer: ReturnType<typeof setTimeout> | null = null
const REVEAL_MS = 2400

function reveal(videoId: string): boolean {
  const track = props.tracks?.find((item) => item.videoId === videoId)
  if (track === undefined) return false
  revealedId.value = track.id
  if (revealTimer !== null) clearTimeout(revealTimer)
  revealTimer = setTimeout(() => {
    revealedId.value = null
    revealTimer = null
  }, REVEAL_MS)
  void nextTick(() => {
    const row = root.value?.querySelector<HTMLElement>(`[data-track-id="${track.id}"]`)
    if (typeof row?.scrollIntoView === 'function') row.scrollIntoView({ block: 'nearest' })
    row?.querySelector<HTMLElement>('.track-play')?.focus()
  })
  return true
}

onBeforeUnmount(() => {
  if (revealTimer !== null) clearTimeout(revealTimer)
})

defineExpose({ reveal })

function momentCount(videoId: string): number {
  return props.momentCounts?.get(videoId) ?? 0
}

/** "관리" 가 펼쳐진 행. 한 번에 하나다. */
const managingId = ref<string | null>(null)
/** 삭제 확인을 받는 행. */
const pendingTrackId = ref<string | null>(null)

const renamingId = ref<string | null>(null)
const draftTitle = ref('')

const root = ref<HTMLElement | null>(null)

function isLast(index: number): boolean {
  return index === (props.tracks?.length ?? 0) - 1
}

function isCurrent(track: DeepReadonly<Track>): boolean {
  return props.nowPlayingTrackId !== undefined && props.nowPlayingTrackId === track.id
}

function toggleManage(trackId: string): void {
  pendingTrackId.value = null
  cancelRename()
  managingId.value = managingId.value === trackId ? null : trackId
}

async function startRename(track: DeepReadonly<Track>): Promise<void> {
  pendingTrackId.value = null
  managingId.value = null
  renamingId.value = track.id
  draftTitle.value = track.title
  await nextTick()
  root.value?.querySelector<HTMLInputElement>('.rename-form input')?.focus()
}

function cancelRename(): void {
  renamingId.value = null
  draftTitle.value = ''
}

function submitRename(): void {
  const trackId = renamingId.value
  if (trackId === null) return

  emit('rename', trackId, draftTitle.value)
  cancelRename()
}

function move(trackId: string, direction: 'up' | 'down'): void {
  // 옮겨도 "관리" 는 펼친 채 둔다 — 여러 칸을 연달아 옮길 수 있게.
  emit('move', trackId, direction)
}

function requestRemove(trackId: string): void {
  // 이름을 고치는 중에 삭제를 누르면 폼을 닫는다. 두 폼이 겹치지 않게 한다.
  cancelRename()
  pendingTrackId.value = trackId
}

function confirmRemove(): void {
  const trackId = pendingTrackId.value
  if (trackId === null) return

  emit('remove', trackId)
  pendingTrackId.value = null
  managingId.value = null
}
</script>

<template>
  <div ref="root" class="track-list">
    <p v-if="tracks === null" class="muted">플레이리스트를 선택하면 트랙이 보입니다.</p>
    <p v-else-if="tracks.length === 0" class="muted">
      아직 등록된 영상이 없어요.<br />＋ YouTube 링크 추가를 눌러 시작하세요.
    </p>

    <!-- :key 는 배열 인덱스가 아니라 트랙 id 를 쓴다. -->
    <template v-for="(track, index) in tracks ?? []" :key="track.id">
      <div
        class="track"
        :data-track-id="track.id"
        :class="{ 'is-current': isCurrent(track), 'is-revealed': revealedId === track.id }"
        :aria-current="isCurrent(track) ? 'true' : undefined"
      >
        <button
          type="button"
          class="track-play"
          :aria-label="`${track.title} 재생`"
          :title="`${track.title} 재생`"
          @click="emit('play', track.id)"
        >
          ▶
        </button>
        <span class="track-order">{{ index + 1 }}</span>
        <span class="track-text">
          <span class="track-name">{{ track.title }}</span>
          <span v-if="isCurrent(track)" class="track-badge">
            {{ nowPlayingActive === false ? '지금 곡' : '♪ 재생 중' }}
          </span>
          <span class="track-id">{{ track.videoId }}</span>
        </span>
        <button
          v-if="momentCount(track.videoId) > 0"
          type="button"
          class="track-moments"
          :data-track-moments="track.videoId"
          :aria-label="`${track.title} 의 Moments ${momentCount(track.videoId)}개 보기`"
          :title="`이 곡의 Moments ${momentCount(track.videoId)}개 보기`"
          @click="emit('moments', track.videoId)"
        >
          <span aria-hidden="true">◆</span> {{ momentCount(track.videoId) }}
        </button>
        <button
          type="button"
          class="track-manage"
          :aria-expanded="managingId === track.id"
          :aria-controls="`track-actions-${track.id}`"
          :aria-label="`${track.title} 관리`"
          @click="toggleManage(track.id)"
        >
          관리
        </button>
      </div>

      <!--
        관리 — 이름 바꾸기 · 위 · 아래, 그리고 떨어진 자리의 삭제. 순서는 자주 쓰는 일부터이고 되돌리기
        어려운 삭제를 맨 끝에 둔다. 클래스 이름 `track-controls` 는 M2 의 것을 잇는다.
      -->
      <div
        v-if="managingId === track.id"
        :id="`track-actions-${track.id}`"
        class="track-controls"
        role="group"
        :aria-label="`${track.title} 관리 메뉴`"
      >
        <button
          type="button"
          class="pill"
          :aria-label="`${track.title} 이름 변경`"
          @click="startRename(track)"
        >
          ✎ 이름 바꾸기
        </button>
        <button
          type="button"
          class="pill"
          :aria-label="`${track.title} 위로`"
          :disabled="index === 0"
          @click="move(track.id, 'up')"
        >
          ↑ 위로
        </button>
        <button
          type="button"
          class="pill"
          :aria-label="`${track.title} 아래로`"
          :disabled="isLast(index)"
          @click="move(track.id, 'down')"
        >
          ↓ 아래로
        </button>
        <button
          type="button"
          class="pill pill--danger"
          :aria-label="`${track.title} 삭제`"
          @click="requestRemove(track.id)"
        >
          삭제
        </button>
      </div>

      <!-- 삭제 확인 — 지울 행 **바로 아래**. -->
      <div
        v-if="pendingTrackId === track.id"
        class="confirm"
        role="alertdialog"
        aria-label="트랙 삭제 확인"
      >
        <p class="confirm-text">“{{ track.title }}” 을(를) 이 목록에서 제거할까요?</p>
        <div class="row-actions">
          <button type="button" class="pill pill--strong" @click="confirmRemove">삭제</button>
          <button type="button" class="pill" @click="pendingTrackId = null">취소</button>
        </div>
      </div>

      <!--
        이름 변경 폼. 고치는 행 **바로 아래**에 둔다. 무엇의 이름인지 자리가
        말해준다 — 보고 6b 에서 위치가 뜻을 바꾼다는 것을 배웠다.
      -->
      <form v-if="renamingId === track.id" class="rename-form" @submit.prevent="submitRename">
        <label class="label" :for="`track-title-${track.id}`">곡 이름</label>
        <input
          :id="`track-title-${track.id}`"
          v-model="draftTitle"
          class="field"
          type="text"
          :maxlength="MAX_TRACK_TITLE_LENGTH"
          autocomplete="off"
        />
        <p class="muted">비우면 YouTube 영상 ID로 표시됩니다.</p>
        <div class="row-actions">
          <button type="submit" class="pill pill--strong">저장</button>
          <button type="button" class="pill" @click="cancelRename">취소</button>
        </div>
      </form>
    </template>
  </div>
</template>

<style scoped>
/*
 * 승인된 디자인의 `.track-list` / `.track` 값을 따른다.
 *
 * `container-type` — 트랙 행이 들어갈 자리는 **뷰포트가 아니라 이 목록의 폭**이 정한다.
 */
.track-list {
  display: grid;
  /*
   * 열 하나를 **목록 폭에 묶는다** (M9-6). 행이 목록 폭을 넘지 않는다 — 긴 제목은 이제 줄을 바꾼다.
   */
  grid-template-columns: minmax(0, 1fr);
  container-type: inline-size;
  gap: 5px;
}

.track {
  display: flex;
  align-items: center;
  padding: 4px 6px 4px 2px;
  border: 1px solid transparent;
  background: var(--track-surface-color);
  gap: 6px;
}

/* 지금 곡 — 테두리(색)와 "재생 중" 글(아래)을 함께 쓴다. */
.track.is-current {
  border-color: var(--track-current-border-color);
}

/* Moments 에서 찾아온 곡 — 잠시 겹테두리. 포커스 링도 함께 보인다. */
.track.is-revealed {
  border-color: var(--row-selected-border-color);
  outline: 1px solid var(--row-selected-border-color);
  outline-offset: 1px;
}

/* 이 곡의 Moments 수 — 누르면 Moments 탭이 이 곡으로 걸러져 열린다. 44px. */
.track-moments {
  min-width: 44px;
  min-height: 44px;
  flex: none;
  padding: 0 8px;
  border: 0;
  background: transparent;
  color: var(--row-action-text-color);
  font: 11px var(--font-mono);
  font-variant-numeric: tabular-nums;
}

.track-order {
  flex: none;
  width: 18px;
  color: var(--row-meta-text-color);
  font: 10px var(--font-mono);
  text-align: right;
}

.track-text {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 2px 8px;
  padding: 6px 0;
}

/* 긴 제목은 잘리지 않고 줄을 바꾼다 (M11 U12). 행 폭은 목록 폭에 묶여 있다. */
.track-name {
  min-width: 0;
  color: var(--track-name-text-color);
  font-size: 12px;
  line-height: 1.4;
  overflow-wrap: anywhere;
}

.track-badge {
  color: var(--row-text-color);
  font: 10px var(--font-mono);
  letter-spacing: 0.04em;
}

/*
 * 승인된 디자인의 `.track-play` 값을 따른다. 터치 목표 44×44 (M11 U16 — M5 의 30×29 에서 키웠다).
 */
.track-play {
  width: 44px;
  min-height: 44px;
  flex: none;
  border: 0;
  background: transparent;
  color: var(--track-play-text-color);
  font-size: 17px;
}

.track-manage {
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

.track-manage[aria-expanded='true'] {
  border-color: var(--row-selected-border-color);
  background: var(--row-selected-surface-color);
  color: var(--row-text-color);
}

/* 관리 줄 — 글자 이름이 있는 단추들. 삭제는 맨 끝으로 떨어진다. */
.track-controls {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 6px;
  border: 1px solid var(--row-selected-border-color);
  background: var(--row-selected-surface-color);
}

.track-controls .pill--danger {
  margin-left: auto;
}

.track-controls button:disabled {
  cursor: not-allowed;
  opacity: 0.35;
}

.track-id {
  color: var(--row-meta-text-color);
  font: 10px var(--font-mono);
}

/*
 * 좁은 자리에서 영상 ID 를 접는다. 컨테이너 질의가 실제 기준이고, 뷰포트 질의는 컨테이너 질의를
 * 모르는 브라우저를 위한 보루다 (2026-11-06 운영 배포 검증에서 발견).
 */
@container (max-width: 420px) {
  .track-id {
    display: none;
  }
}

@media (max-width: 420px) {
  .track-id {
    display: none;
  }
}

/* 승인된 디자인의 `.pill` 값을 따른다. 터치 목표 44px (M11 U16). */
.pill {
  min-height: 44px;
  padding: 7px 12px;
  border: 1px solid var(--pill-border-color);
  border-radius: var(--radius-control);
  background: var(--pill-surface-color);
  color: var(--pill-text-color);
  font: 11px var(--font-mono);
}

/* 터치 뒤 hover 색이 남지 않게 (M11 U18). */
@media (hover: hover) {
  .pill:hover:not(:disabled):not(.pill--strong) {
    background: var(--pill-surface-hover-color);
  }

  .track-moments:hover,
  .track-manage:hover {
    color: var(--row-action-hover-text-color);
  }
}

.pill--strong {
  border-color: var(--accent-strong-color);
  background: var(--accent-strong-color);
  color: var(--accent-strong-text-color);
}

.pill--danger {
  border-color: var(--error-text-color);
  color: var(--error-text-color);
}

.row-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.confirm {
  padding: 10px 12px;
  border: 1px solid var(--row-selected-border-color);
  background: var(--row-selected-surface-color);
}

.confirm-text {
  margin: 0 0 10px;
  color: var(--row-text-color);
  font: 12px/1.5 var(--font-mono);
  overflow-wrap: anywhere;
}

.rename-form {
  padding: 10px 12px;
  border: 1px solid var(--row-selected-border-color);
  background: var(--row-selected-surface-color);
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
  height: 46px;
  padding: 10px;
  border: 1px solid var(--field-border-color);
  border-radius: var(--radius-field);
  background: var(--field-surface-color);
  color: var(--field-text-color);
}

.muted {
  margin: 8px 0 10px;
  color: var(--drawer-muted-text-color);
  font-size: 11px;
  line-height: 1.6;
}

/* 비어 있을 때의 안내는 아래 여백이 필요 없다. */
.track-list > .muted {
  margin: 0;
}
</style>
