<script setup lang="ts">
/**
 * 한 플레이리스트의 트랙 목록 (M6-5).
 *
 * 승인된 디자인의 `.track-list` / `.track` 구조를 따른다. 드로어에서 **분리해
 * 꺼낸** 컴포넌트다 — 842 줄짜리 드로어가 플레이리스트·트랙·폼·확인을 모두
 * 담고 있었다 (`AGENTS.md` 규칙 3, `M6_PLAN.md` §3).
 *
 * 여기서 store 를 부르지 않는다. 행의 조작을 이벤트로 올릴 뿐이고, 실제 변경과
 * 재생 요청은 드로어가 한다. 재생 상태도 모른다.
 *
 * 삭제 확인은 **여기서** 받는다. 확인된 뒤에만 `remove` 를 올리므로, 드로어는
 * "지워졌다" 만 알고 확인 UI 를 모른다.
 *
 * M6-5 에서 더한 것: **트랙 이름 변경** (보고 6c). 사용자가 이미 저장한
 * 레코드의 이름을 바꿀 방법이 없었다.
 */
import { nextTick, ref } from 'vue'

import type { DeepReadonly } from 'vue'

import type { Track } from '@/shared/types'
import { MAX_TRACK_TITLE_LENGTH } from '@/stores/library'

const props = defineProps<{
  /**
   * 보여줄 트랙. **선택된 플레이리스트가 없으면 `null`** 이다.
   *
   * 빈 배열(`[]`)과 구분한다. 둘의 안내 문구가 다르다 — 하나는 "목록을
   * 선택하세요", 다른 하나는 "링크를 추가하세요" 다.
   */
  tracks: DeepReadonly<Track[]> | null
}>()

const emit = defineEmits<{
  play: [trackId: string]
  move: [trackId: string, direction: 'up' | 'down']
  remove: [trackId: string]
  rename: [trackId: string, title: string]
}>()

/** 삭제 확인 중인 트랙. `confirm()` 대신 인라인으로 받는다. */
const pendingTrackId = ref<string | null>(null)

/** 이름을 고치는 중인 트랙. */
const renamingId = ref<string | null>(null)
const draftTitle = ref('')

/**
 * 목록 루트. 이름 변경 입력으로 포커스를 옮길 때만 쓴다.
 *
 * 입력에 직접 `ref` 를 달지 않는다. `v-for` **안**에 있는 `ref` 는 Vue 가
 * 배열로 모으므로 `.focus()` 가 없는 값이 된다. 한 번에 한 폼만 열리므로
 * 루트에서 찾는 쪽이 간단하고 확실하다.
 */
const root = ref<HTMLElement | null>(null)

function isLast(index: number): boolean {
  return index === (props.tracks?.length ?? 0) - 1
}

async function startRename(track: DeepReadonly<Track>): Promise<void> {
  pendingTrackId.value = null
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

function confirmRemove(): void {
  const trackId = pendingTrackId.value
  if (trackId === null) return

  emit('remove', trackId)
  pendingTrackId.value = null
}

function requestRemove(trackId: string): void {
  // 이름을 고치는 중에 삭제를 누르면 폼을 닫는다. 두 폼이 겹치지 않게 한다.
  cancelRename()
  pendingTrackId.value = trackId
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
      <div class="track">
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
        <!-- 잘려도 전체 제목을 title 로 확인할 수 있다. -->
        <span class="track-name" :title="track.title">{{ track.title }}</span>
        <span class="track-id">{{ track.videoId }}</span>

        <!--
          순서: 이름 변경 → 위 → 아래 → 삭제. 되돌리기 어려운 삭제를 맨 끝에
          둔다. 이름 변경이 맨 앞인 것은 그것이 이 행에서 가장 자주 하는
          일이기 때문이다.
        -->
        <span class="track-controls">
          <button
            type="button"
            :aria-label="`${track.title} 이름 변경`"
            :title="`${track.title} 이름 변경`"
            @click="startRename(track)"
          >
            ✎
          </button>
          <button
            type="button"
            :aria-label="`${track.title} 위로`"
            :disabled="index === 0"
            @click="emit('move', track.id, 'up')"
          >
            ↑
          </button>
          <button
            type="button"
            :aria-label="`${track.title} 아래로`"
            :disabled="isLast(index)"
            @click="emit('move', track.id, 'down')"
          >
            ↓
          </button>
          <button
            type="button"
            :aria-label="`${track.title} 삭제`"
            @click="requestRemove(track.id)"
          >
            ×
          </button>
        </span>
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

    <div
      v-if="pendingTrackId !== null"
      class="confirm"
      role="alertdialog"
      aria-label="트랙 삭제 확인"
    >
      <p class="confirm-text">이 곡을 목록에서 제거할까요?</p>
      <div class="row-actions">
        <button type="button" class="pill pill--strong" @click="confirmRemove">삭제</button>
        <button type="button" class="pill" @click="pendingTrackId = null">취소</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 승인된 디자인의 `.track-list` / `.track` 값을 따른다. */
.track-list {
  display: grid;
  gap: 5px;
}

.track {
  display: flex;
  align-items: center;
  padding: 8px 7px;
  border: 1px solid transparent;
  background: var(--track-surface-color);
  gap: 7px;
}

.track-order {
  flex: none;
  width: 18px;
  color: var(--row-meta-text-color);
  font: 10px var(--font-mono);
  text-align: right;
}

.track-name {
  overflow: hidden;
  min-width: 0;
  flex: 1;
  color: var(--track-name-text-color);
  font-size: 12px;
  line-height: 1.35;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/*
 * 승인된 디자인의 `.track-play` 값을 따른다.
 *
 * `min-height` 만 더했다. 레퍼런스는 높이를 적지 않아 글자 높이(22px)가 되는데,
 * 그러면 터치 목표가 24px 아래로 내려간다 (M5 실측 30×22). 같은 행의
 * `.track-controls button` 이 29px 이므로 그 값에 맞춘다 — 새 치수를 만들지
 * 않고 이웃과 나란해진다.
 */
.track-play {
  width: 30px;
  min-height: 29px;
  flex: none;
  border: 0;
  background: transparent;
  color: var(--track-play-text-color);
  font-size: 17px;
}

/* 승인된 디자인의 `.track-controls` 값을 따른다. */
.track-controls {
  display: flex;
  flex: none;
  gap: 3px;
}

.track-controls button {
  min-width: 28px;
  height: 29px;
  border: 0;
  background: transparent;
  color: var(--row-action-text-color);
}

.track-controls button:hover:not(:disabled) {
  color: var(--row-action-hover-text-color);
}

.track-controls button:disabled {
  cursor: not-allowed;
  opacity: 0.3;
}

.track-id {
  color: var(--row-meta-text-color);
  font: 10px var(--font-mono);
}

/* 좁은 화면에서 영상 ID 를 접어 제목과 버튼을 확보한다. */
@media (max-width: 420px) {
  .track-id {
    display: none;
  }
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
