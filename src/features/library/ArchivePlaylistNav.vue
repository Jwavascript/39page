<script setup lang="ts">
/**
 * 보관함 "음악" 탭의 **목록 칸** — 플레이리스트를 고르고 · 만들고 · 이름을 바꾸고 · 지운다
 * (M11-2, M11-7B 에서 역할을 다시 나눴다 · ADR 0030).
 *
 * M11-6 까지는 이 목록이 편집 표면 **위**에 쌓여 있어, 목록이 많으면 고른 목록의 곡이 화면 아래로
 * 밀렸다 (UAT U3). 이제 넓은 화면에서는 왼쪽 칸이고(오른쪽이 고른 목록의 상세 — `PlaylistEditor`),
 * 좁은 화면에서는 두 단계 중 첫 단계다. 배치는 `ArchivePanel` 이 정한다.
 *
 * 역할 (UAT U4 — 재생과 목록 관리는 다른 일이다)
 * - 이 칸: 목록 **선택 · 만들기 · 이름 수정 · 삭제**. 이름 수정과 삭제는 행의 "관리" 를 누르면 그 행
 *   아래에 글자 이름과 함께 펼쳐진다 (곡 줄의 "관리" 와 같은 방식). 삭제는 그 자리에서 확인을 받는다.
 * - 상세 칸: 전체 재생 · 링크 추가 · 곡. 이 칸에는 재생 단추가 없다.
 *
 * - 행 본문 = 그 목록을 고른다. 선택은 저장된다 (`selectPlaylist`).
 * - "♪ 재생 중인 목록" 은 **재생 큐의 출처**로 정한다 (코디네이터의 읽기 전용 보기) — 지금 곡이 든
 *   목록을 짐작하지 않는다. 고른 목록(테두리)과 재생 중인 목록(글)은 다른 표시다.
 * - 조작 영역은 44px 이상 (M11 U16). 목록은 이 칸 안에서 스크롤한다 — 상세 칸을 밀지 않는다.
 */
import { computed, inject, nextTick, ref, watch } from 'vue'

import { LIBRARY_BUSY_MESSAGE, LIBRARY_CONFLICT_MESSAGE } from '@/features/library/libraryFeedback'
import { UNSAVED_NOTICE, usePlaylistCreate } from '@/features/library/usePlaylistCreate'
import { PLAYBACK_COORDINATOR } from '@/features/playback/playbackCoordinator'
import {
  MAX_PLAYLIST_NAME_LENGTH,
  useLibraryStore,
  type LibraryMutationResult,
} from '@/stores/library'

const props = defineProps<{
  /** 보관함이 열려 있는지. 닫히면 쓰던 양식 · 펼친 관리 · 안내를 비운다. */
  active: boolean
}>()

const emit = defineEmits<{
  /** 새 목록을 만들었다 — 상세 칸이 다음 행동(곡 추가)으로 이어 줄 수 있다. */
  created: [playlistId: string]
  /** 목록을 골랐다 (이미 고른 목록을 다시 누른 것도 포함) — 좁은 화면은 상세 단계로 넘어간다. */
  selected: [playlistId: string]
}>()

const library = useLibraryStore()
const coordinator = inject(PLAYBACK_COORDINATOR, null)

const create = usePlaylistCreate()
const notice = ref('')

const shownNotice = computed<string>(() => notice.value || create.notice.value)

/** 재생 큐의 출처 목록 — 추정이 아니라 큐를 만든 쪽이 적은 기록이다 (M11-7B). */
const playingPlaylistId = computed<string | null>(
  () => coordinator?.queue.value?.source?.playlistId ?? null,
)

const FAILURE_MESSAGE: Readonly<Record<string, string>> = {
  'empty-name': '이름을 입력해주세요.',
  'not-found': '대상을 찾을 수 없습니다.',
  conflict: LIBRARY_CONFLICT_MESSAGE,
  busy: LIBRARY_BUSY_MESSAGE,
}

function failureMessage(reason: string | undefined): string {
  return FAILURE_MESSAGE[reason ?? ''] ?? '요청을 처리하지 못했습니다.'
}

async function select(id: string): Promise<void> {
  notice.value = ''
  if (id !== library.selectedPlaylistId) {
    const result = await library.selectPlaylist(id)
    if (!result.ok) {
      notice.value = failureMessage(result.reason)
      return
    }
  }
  emit('selected', id)
}

async function submitCreate(): Promise<void> {
  const id = await create.submit()
  if (id !== null) emit('created', id)
}

/* ---------- 관리: 이름 수정 · 삭제 (M11-7B 에서 상세 칸의 머리말에서 옮겨 왔다) ---------- */

/** "관리" 가 펼쳐진 목록. 한 번에 하나다. */
const managingId = ref<string | null>(null)
/** 이름 수정 양식이 열린 목록. 열릴 때 정한 id 를 끝까지 쓴다. */
const renamingId = ref<string | null>(null)
const draftName = ref('')
const formError = ref('')
/** 삭제 확인을 기다리는 목록. `confirm()` 대신 그 행 아래에서 받는다. */
const pendingDeleteId = ref<string | null>(null)
/**
 * 저장을 기다리는 중 (ADR 0025). 저장은 탭 간 잠금 안에서 끝나므로 잠깐 걸린다 — 그동안 다시 눌러
 * 두 번 반영되지 않게 한다.
 */
const isSaving = ref(false)
/**
 * 이름 수정 입력란. 양식이 `v-for` 안에 있어 문자열 `ref` 는 **배열**이 된다 — 함수 ref 로 하나만 잡는다
 * (양식은 한 번에 하나만 열린다).
 */
const renameInput = ref<HTMLInputElement | null>(null)
function setRenameInput(el: unknown): void {
  renameInput.value = el instanceof HTMLInputElement ? el : null
}

/** 마지막 목록은 지울 수 없다. 전부 사라지면 돌아갈 자리가 없다. */
const canDelete = computed<boolean>(() => library.playlists.length > 1)

function resetManage(): void {
  renamingId.value = null
  pendingDeleteId.value = null
  draftName.value = ''
  formError.value = ''
}

function toggleManage(id: string): void {
  resetManage()
  managingId.value = managingId.value === id ? null : id
}

async function startRename(id: string): Promise<void> {
  const target = library.getPlaylist(id)
  if (target === undefined) return
  pendingDeleteId.value = null
  renamingId.value = id
  draftName.value = target.name
  formError.value = ''
  await nextTick()
  // 칸 안에서만 보이게 한다 — 페이지가 움직이지 않게.
  renameInput.value?.focus({ preventScroll: true })
  renameInput.value?.select()
}

async function saving(pending: Promise<LibraryMutationResult>): Promise<LibraryMutationResult> {
  isSaving.value = true
  try {
    return await pending
  } finally {
    isSaving.value = false
  }
}

async function submitRename(): Promise<void> {
  const id = renamingId.value
  if (id === null || isSaving.value) return

  const result = await saving(library.renamePlaylist(id, draftName.value))
  if (!result.ok) {
    // 실패해도 입력값을 지우지 않는다. 사용자가 고쳐 쓸 수 있어야 한다.
    formError.value = failureMessage(result.reason)
    return
  }
  notice.value = result.persisted ? '' : UNSAVED_NOTICE
  resetManage()
  managingId.value = null
}

function requestDelete(id: string): void {
  if (!canDelete.value) return
  renamingId.value = null
  formError.value = ''
  pendingDeleteId.value = id
}

async function confirmDelete(): Promise<void> {
  const id = pendingDeleteId.value
  if (id === null || isSaving.value) return

  const result = await saving(library.deletePlaylist(id))
  notice.value = result.ok
    ? result.persisted
      ? ''
      : UNSAVED_NOTICE
    : failureMessage(result.reason)
  resetManage()
  managingId.value = null
}

/** 보관함이 닫히면 쓰던 것을 비운다. */
watch(
  () => props.active,
  (isActive) => {
    if (isActive) return
    resetManage()
    managingId.value = null
    notice.value = ''
    create.cancel()
    create.clearNotice()
  },
)

/** 목록이 사라지면(다른 탭 · 복원) 그 목록을 겨냥한 관리도 닫는다. */
watch(
  () => library.playlists.map((playlist) => playlist.id).join(','),
  () => {
    if (managingId.value !== null && library.getPlaylist(managingId.value) === undefined) {
      resetManage()
      managingId.value = null
    }
  },
)

/** 고른 목록의 행으로 포커스를 옮긴다 — 좁은 화면에서 상세 단계에서 돌아올 때 (`ArchivePanel`). */
const rows = ref<HTMLElement | null>(null)
function focusSelected(): void {
  const target =
    rows.value?.querySelector<HTMLElement>('.list-row.is-selected .list-select') ??
    rows.value?.querySelector<HTMLElement>('.list-select') ??
    null
  target?.focus({ preventScroll: true })
}

const hasUnsavedInput = computed(
  () =>
    create.draftName.value.trim() !== '' ||
    (renamingId.value !== null && draftName.value !== library.getPlaylist(renamingId.value)?.name),
)
const busy = computed(() => isSaving.value || create.isSubmitting.value)
defineExpose({ focusSelected, hasUnsavedInput, busy })
</script>

<template>
  <section class="archive-lists" aria-labelledby="archive-lists-title">
    <div class="lists-head">
      <h3 id="archive-lists-title" class="section-title">
        플레이리스트 <span class="lists-count">{{ library.playlists.length }}</span>
      </h3>
      <button type="button" class="pill pill--strong" @click="create.start">＋ 새 목록</button>
    </div>

    <form v-if="create.isCreating.value" class="create-form" @submit.prevent="submitCreate">
      <label class="label" for="archive-new-playlist-name">새 플레이리스트 이름</label>
      <input
        id="archive-new-playlist-name"
        :ref="(el) => (create.nameInput.value = el as HTMLInputElement | null)"
        v-model="create.draftName.value"
        class="field"
        type="text"
        :maxlength="MAX_PLAYLIST_NAME_LENGTH"
        autocomplete="off"
        :aria-invalid="create.formError.value !== '' || undefined"
        aria-describedby="archive-new-playlist-error archive-new-playlist-next"
      />
      <p id="archive-new-playlist-error" class="error-msg">{{ create.formError.value }}</p>
      <p id="archive-new-playlist-next" class="form-hint">
        만들면 바로 이 목록에 YouTube 링크를 넣을 수 있어요.
      </p>
      <div class="form-actions">
        <button
          type="submit"
          class="pill pill--strong"
          :disabled="create.isSubmitting.value"
          :aria-busy="create.isSubmitting.value ? 'true' : 'false'"
        >
          만들기
        </button>
        <button type="button" class="pill" @click="create.cancel">취소</button>
      </div>
    </form>

    <p v-if="shownNotice !== ''" class="notice" role="status" aria-live="polite">
      {{ shownNotice }}
    </p>

    <p v-if="library.playlists.length === 0" class="empty">
      아직 플레이리스트가 없어요. ＋ 새 목록으로 시작하세요.
    </p>
    <!-- 이 칸 안에서만 스크롤한다 — 목록이 50개여도 상세 칸은 그 자리다. -->
    <ul v-else ref="rows" class="list-rows">
      <li
        v-for="playlist in library.playlists"
        :key="playlist.id"
        class="list-row"
        :class="{
          'is-selected': playlist.id === library.selectedPlaylistId,
          'is-playing': playlist.id === playingPlaylistId,
        }"
      >
        <div class="row-main">
          <button
            type="button"
            class="list-select"
            :aria-current="playlist.id === library.selectedPlaylistId ? 'true' : undefined"
            @click="select(playlist.id)"
          >
            <span class="list-name">{{ playlist.name }}</span>
            <span class="list-meta">
              {{ playlist.tracks.length === 0 ? '비어 있음' : `${playlist.tracks.length}곡`
              }}<span v-if="playlist.id === playingPlaylistId" class="list-playing">
                · ♪ 재생 중인 목록</span
              >
            </span>
          </button>
          <button
            type="button"
            class="list-manage"
            :aria-label="`${playlist.name} 관리 — 이름 수정 · 삭제`"
            :aria-expanded="managingId === playlist.id"
            @click="toggleManage(playlist.id)"
          >
            관리
          </button>
        </div>

        <div v-if="managingId === playlist.id" class="manage-panel">
          <div
            v-if="renamingId !== playlist.id && pendingDeleteId !== playlist.id"
            class="form-actions"
          >
            <button type="button" class="pill" @click="startRename(playlist.id)">이름 수정</button>
            <button
              type="button"
              class="pill pill--danger"
              :disabled="!canDelete"
              :title="canDelete ? undefined : '마지막 목록은 지울 수 없어요'"
              @click="requestDelete(playlist.id)"
            >
              목록 삭제
            </button>
          </div>

          <form v-if="renamingId === playlist.id" class="name-form" @submit.prevent="submitRename">
            <label class="label" for="playlist-name">플레이리스트 이름 수정</label>
            <input
              id="playlist-name"
              :ref="setRenameInput"
              v-model="draftName"
              class="field"
              type="text"
              :maxlength="MAX_PLAYLIST_NAME_LENGTH"
              autocomplete="off"
            />
            <p class="error-msg">{{ formError }}</p>
            <div class="form-actions">
              <button type="submit" class="pill pill--strong" :disabled="isSaving">저장</button>
              <button type="button" class="pill" @click="resetManage">취소</button>
            </div>
          </form>

          <div
            v-if="pendingDeleteId === playlist.id"
            class="confirm"
            role="alertdialog"
            aria-label="삭제 확인"
          >
            <p class="confirm-text">
              “{{ playlist.name }}”{{
                playlist.tracks.length > 0 ? ` 과 곡 ${playlist.tracks.length}개` : ''
              }}을(를) 삭제할까요? Moments 는 남아요.
            </p>
            <div class="form-actions">
              <button
                type="button"
                class="pill pill--strong"
                :disabled="isSaving"
                @click="confirmDelete"
              >
                삭제
              </button>
              <button type="button" class="pill" @click="resetManage">취소</button>
            </div>
          </div>
        </div>
      </li>
    </ul>
  </section>
</template>

<style scoped>
/* 칸 전체가 세로 플렉스다 — 머리말 · 양식은 그 자리에 있고 목록만 스크롤한다. */
.archive-lists {
  display: flex;
  min-width: 0;
  min-height: 0;
  flex-direction: column;
}

.lists-head {
  display: flex;
  flex: none;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 10px;
}

.section-title {
  margin: 0;
  color: var(--drawer-section-title-text-color);
  font: 11px var(--font-mono);
  font-weight: 400;
  letter-spacing: 0.12em;
}

.lists-count {
  margin-left: 4px;
  opacity: 0.8;
}

.pill {
  min-height: 44px;
  padding: 7px 14px;
  border: 1px solid var(--pill-border-color);
  border-radius: var(--radius-control);
  background: var(--pill-surface-color);
  color: var(--pill-text-color);
  font: 12px var(--font-mono);
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

/* 지우는 단추는 색으로도 구분하고, 다른 단추와 떨어뜨린다 — 잘못 누르지 않게. */
.pill--danger {
  margin-left: auto;
  border-color: var(--error-text-color);
  color: var(--error-text-color);
}

@media (hover: hover) {
  .pill:hover:not(:disabled):not(.pill--strong) {
    background: var(--pill-surface-hover-color);
  }

  .list-manage:hover {
    color: var(--row-action-hover-text-color);
  }
}

.create-form {
  flex: none;
  margin-bottom: 12px;
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

.error-msg {
  min-height: 17px;
  margin: 6px 0 0;
  color: var(--error-text-color);
  font-size: 12px;
}

.form-hint {
  margin: 0 0 8px;
  color: var(--drawer-muted-text-color);
  font: 11px/1.5 var(--font-mono);
}

.form-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.notice {
  flex: none;
  margin: 0 0 10px;
  color: var(--status-warning-text-color);
  font: 11px/1.6 var(--font-mono);
}

.empty {
  margin: 0;
  color: var(--drawer-muted-text-color);
  font-size: 12px;
}

.list-rows {
  display: flex;
  min-height: 0;
  flex: 1 1 auto;
  flex-direction: column;
  gap: 4px;
  margin: 0;
  padding: 0 4px 0 0;
  list-style: none;
  overflow-y: auto;
  /* 끝까지 스크롤해도 페이지 · 상세 칸으로 넘어가지 않는다. */
  overscroll-behavior: contain;
  scrollbar-color: var(--line-color) transparent;
  scrollbar-width: thin;
}

.list-row {
  min-width: 0;
  flex: none;
}

.row-main {
  display: flex;
  min-width: 0;
  gap: 4px;
}

.list-select {
  display: flex;
  min-width: 0;
  min-height: 48px;
  flex: 1;
  flex-direction: column;
  justify-content: center;
  gap: 2px;
  padding: 6px 12px;
  border: 1px solid transparent;
  border-radius: var(--radius-control);
  background: var(--row-surface-color);
  color: var(--row-text-color);
  text-align: left;
}

/* 고른 목록 = 테두리와 배경. 재생 중인 목록 = 글 ("♪ 재생 중인 목록"). 둘은 다른 표시다. */
.list-row.is-selected .list-select {
  border-color: var(--row-selected-border-color);
  background: var(--row-selected-surface-color);
}

/* 긴 이름은 두 줄까지 — 줄이 끝없이 길어지지 않게. */
.list-name {
  display: -webkit-box;
  overflow: hidden;
  min-width: 0;
  font-size: 13px;
  line-height: 1.35;
  overflow-wrap: anywhere;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  line-clamp: 2;
}

.list-meta {
  color: var(--row-meta-text-color);
  font: 11px var(--font-mono);
}

.list-playing {
  color: var(--drawer-title-text-color);
}

.list-manage {
  min-width: 48px;
  min-height: 48px;
  flex: none;
  padding: 0 8px;
  border: 1px solid var(--pill-border-color);
  border-radius: var(--radius-control);
  background: var(--track-surface-color);
  color: var(--row-action-text-color);
  font: 11px var(--font-mono);
}

.list-manage[aria-expanded='true'] {
  border-color: var(--row-selected-border-color);
  color: var(--row-text-color);
}

.manage-panel {
  margin: 4px 0 6px;
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
</style>
