<script setup lang="ts">
/**
 * Record Library 드로어.
 *
 * 승인된 디자인의 `.drawer` 구조를 따른다. 넓은 화면에서는 워크스페이스
 * 그리드의 **형제 열**(340px)로 열린다. 영상을 덮는 레이어가 아니다
 * (원본 주석: *"Right Drawer is a sibling in layout, not a layer covering
 * the YouTube video"*).
 *
 * 두 테마가 **같은 컴포넌트**를 쓴다. 색은 M1-2 토큰이 결정한다.
 *
 * 여기서 하지 않는 것: YouTube 링크 추가, 트랙 추가·삭제·순서 변경,
 * 목록 전체 재생. 동작하지 않는 버튼을 만들지 않는다 (M2-3 / M3).
 */
import { computed, nextTick, ref, watch } from 'vue'

import LibraryStatusBanner from '@/features/library/LibraryStatusBanner.vue'
import PlaylistList from '@/features/library/PlaylistList.vue'
import { useLibraryStore } from '@/stores/library'

const props = defineProps<{ open: boolean; drawerId: string }>()
const emit = defineEmits<{ close: [] }>()

const library = useLibraryStore()

const closeButton = ref<HTMLButtonElement | null>(null)

/** 인라인 편집 모드. 레퍼런스의 `prompt()` 를 대체한다. */
type EditMode = { kind: 'none' } | { kind: 'create' } | { kind: 'rename'; id: string }

const edit = ref<EditMode>({ kind: 'none' })
const draftName = ref('')
const formError = ref('')
/** 마지막 동작이 저장되지 않았는지. `persisted: false` 를 알린다. */
const unsavedNotice = ref('')

const canDelete = computed<boolean>(() => library.playlists.length > 1)

function resetForm(): void {
  edit.value = { kind: 'none' }
  draftName.value = ''
  formError.value = ''
}

/** 액션 결과를 화면 안내로 옮긴다. 저장 여부를 성공과 뭉뚱그리지 않는다. */
function reportResult(result: { ok: boolean; persisted?: boolean; reason?: string }): boolean {
  if (!result.ok) {
    formError.value =
      result.reason === 'empty-name'
        ? '이름을 입력해주세요.'
        : '해당 플레이리스트를 찾을 수 없습니다.'
    return false
  }

  unsavedNotice.value =
    result.persisted === false ? '이 변경은 저장되지 않았습니다. 현재 세션에서만 유지됩니다.' : ''
  return true
}

function startCreate(): void {
  edit.value = { kind: 'create' }
  draftName.value = ''
  formError.value = ''
}

function startRename(): void {
  const current = library.selectedPlaylist
  if (current === null) return

  edit.value = { kind: 'rename', id: current.id }
  draftName.value = current.name
  formError.value = ''
}

function submitForm(): void {
  const mode = edit.value
  if (mode.kind === 'none') return

  const result =
    mode.kind === 'create'
      ? library.createPlaylist(draftName.value)
      : library.renamePlaylist(mode.id, draftName.value)

  if (reportResult(result)) resetForm()
}

/** 삭제 확인. `confirm()` 대신 인라인으로 받는다. */
const pendingDeleteId = ref<string | null>(null)

function requestDelete(): void {
  const current = library.selectedPlaylist
  if (current === null || !canDelete.value) return
  pendingDeleteId.value = current.id
}

function confirmDelete(): void {
  const id = pendingDeleteId.value
  if (id === null) return

  reportResult(library.deletePlaylist(id))
  pendingDeleteId.value = null
}

function selectPlaylist(id: string): void {
  // 선택만 바꾼다. 재생 큐는 건드리지 않는다.
  reportResult(library.selectPlaylist(id))
  pendingDeleteId.value = null
  resetForm()
}

/** 열릴 때 닫기 버튼으로 포커스를 옮긴다. 닫힐 때는 셸이 트리거로 되돌린다. */
watch(
  () => props.open,
  async (isOpen) => {
    if (!isOpen) {
      resetForm()
      pendingDeleteId.value = null
      unsavedNotice.value = ''
      return
    }
    await nextTick()
    closeButton.value?.focus()
  },
)
</script>

<template>
  <!--
    닫혀 있을 때 `hidden` 으로 둔다. 안쪽 버튼이 Tab 순서에 남지 않는다.
    실제 포커스 가둠(focus trap)을 구현하지 않았으므로 aria-modal 을
    선언하지 않는다. 넓은 화면에서는 나란히 놓이는 비모달 영역이다.
  -->
  <aside :id="drawerId" class="drawer" :hidden="!open" aria-labelledby="record-library-title">
    <div class="drawer-head">
      <div>
        <h2 id="record-library-title" class="drawer-title">RECORD LIBRARY</h2>
        <p class="drawer-sub">COLLECTION / YOUTUBE ONLY</p>
      </div>
      <button
        ref="closeButton"
        type="button"
        class="close"
        aria-label="라이브러리 닫기"
        @click="emit('close')"
      >
        ×
      </button>
    </div>

    <div class="drawer-body">
      <LibraryStatusBanner />

      <p v-if="unsavedNotice !== ''" class="unsaved" role="status">{{ unsavedNotice }}</p>

      <div class="drawer-actions">
        <button type="button" class="pill pill--strong" @click="startCreate">＋ 새 목록</button>
      </div>

      <form v-if="edit.kind !== 'none'" class="name-form" @submit.prevent="submitForm">
        <label class="label" for="playlist-name">
          {{ edit.kind === 'create' ? '새 플레이리스트 이름' : '플레이리스트 이름 수정' }}
        </label>
        <input
          id="playlist-name"
          v-model="draftName"
          class="field"
          type="text"
          :maxlength="60"
          autocomplete="off"
        />
        <p class="error-msg">{{ formError }}</p>
        <div class="drawer-actions">
          <button type="submit" class="pill pill--strong">저장</button>
          <button type="button" class="pill" @click="resetForm">취소</button>
        </div>
      </form>

      <h3 class="drawer-section-title">YOUR PLAYLISTS</h3>
      <PlaylistList
        :playlists="library.playlists"
        :selected-id="library.selectedPlaylistId"
        @select="selectPlaylist"
      />

      <div class="rule" />

      <h3 class="drawer-section-title">
        {{ library.selectedPlaylist?.name ?? 'SELECTED PLAYLIST' }} / TRACKS
      </h3>

      <div class="drawer-actions">
        <button
          type="button"
          class="pill"
          :disabled="library.selectedPlaylist === null"
          @click="startRename"
        >
          이름 수정
        </button>
        <button
          type="button"
          class="pill"
          :disabled="library.selectedPlaylist === null || !canDelete"
          @click="requestDelete"
        >
          삭제
        </button>
      </div>

      <div
        v-if="pendingDeleteId !== null"
        class="confirm"
        role="alertdialog"
        aria-label="삭제 확인"
      >
        <p class="confirm-text">“{{ library.getPlaylist(pendingDeleteId)?.name }}”을 삭제할까요?</p>
        <div class="drawer-actions">
          <button type="button" class="pill pill--strong" @click="confirmDelete">삭제</button>
          <button type="button" class="pill" @click="pendingDeleteId = null">취소</button>
        </div>
      </div>

      <!-- 트랙은 읽기 전용이다. 추가·삭제·순서 변경은 M2-3 이다. -->
      <div class="track-list">
        <p v-if="library.selectedPlaylist === null" class="muted">
          플레이리스트를 선택하면 트랙이 보입니다.
        </p>
        <p v-else-if="library.selectedPlaylist.tracks.length === 0" class="muted">
          아직 등록된 영상이 없어요.
        </p>
        <div
          v-for="(track, index) in library.selectedPlaylist?.tracks ?? []"
          :key="track.id"
          class="track"
        >
          <span class="track-name">{{ index + 1 }}. {{ track.title }}</span>
          <span class="track-id">{{ track.videoId }}</span>
        </div>
      </div>
    </div>

    <p class="drawer-foot">
      데크를 눌러 열고, ESC 또는 ×로 닫으세요.<br />
      YouTube 링크 추가는 다음 단계에서 연결됩니다.
    </p>
  </aside>
</template>

<style scoped>
/* 승인된 디자인의 `.drawer` 값을 따른다. */
.drawer {
  display: flex;
  min-width: 0;
  height: 100%;
  max-height: min(880px, 96vh);
  flex-direction: column;
  border-left: 1px solid var(--drawer-border-color);
  background: var(--drawer-surface-color);
}

.drawer[hidden] {
  display: none;
}

.drawer-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  padding: 21px 20px 16px;
  border-bottom: 1px solid var(--drawer-head-border-color);
  gap: 10px;
}

.drawer-title {
  margin: 0;
  color: var(--drawer-title-text-color);
  font: 13px var(--font-mono);
  font-weight: 400;
  letter-spacing: 0.1em;
}

.drawer-sub {
  margin: 8px 0 0;
  color: var(--drawer-sub-text-color);
  font: 11px var(--font-mono);
}

.close {
  width: 34px;
  height: 34px;
  border: 0;
  background: transparent;
  color: var(--close-button-text-color);
  font-size: 23px;
  line-height: 1;
}

.drawer-body {
  min-height: 0;
  flex: 1;
  padding: 18px 16px;
  overflow-y: auto;
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

.drawer-actions {
  display: flex;
  flex-wrap: wrap;
  margin-bottom: 13px;
  gap: 6px;
}

.drawer-section-title {
  margin: 14px 0 8px;
  color: var(--drawer-section-title-text-color);
  font: 10px var(--font-mono);
  font-weight: 400;
  letter-spacing: 0.12em;
}

.rule {
  height: 1px;
  background: var(--rule-color);
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

.error-msg {
  min-height: 17px;
  margin: 6px 0 0;
  color: var(--error-text-color);
  font-size: 12px;
}

.unsaved {
  margin: 0 0 12px;
  color: var(--status-warning-text-color);
  font: 10px/1.6 var(--font-mono);
}

.confirm {
  margin-bottom: 13px;
  padding: 10px 12px;
  border: 1px solid var(--row-selected-border-color);
  background: var(--row-selected-surface-color);
}

.confirm-text {
  margin: 0 0 10px;
  color: var(--row-text-color);
  font: 12px/1.5 var(--font-mono);
}

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

.track-id {
  color: var(--row-meta-text-color);
  font: 10px var(--font-mono);
}

.muted {
  margin: 0;
  color: var(--drawer-muted-text-color);
  font-size: 11px;
  line-height: 1.6;
}

.drawer-foot {
  margin: 0;
  padding: 13px 17px;
  border-top: 1px solid var(--drawer-foot-border-color);
  color: var(--drawer-foot-text-color);
  font: 10px/1.6 var(--font-mono);
}
</style>
