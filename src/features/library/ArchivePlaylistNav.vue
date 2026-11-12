<script setup lang="ts">
/**
 * 보관함 "음악" 탭 위쪽의 플레이리스트 목록 (M11-2, ADR 0027).
 *
 * 보관함이 열려 있는 동안 대시보드의 플레이리스트 위젯은 접혀 있다(플레이어와 보관함만 남는다).
 * 그래서 보관함 안에서 **목록을 고르고 · 만들고 · 바로 재생**할 수 있어야 한다 — 데드엔드가 없게.
 *
 * - 행 본문 = 그 목록을 고른다 (아래 편집 표면이 그 목록으로 바뀐다). 선택은 저장된다 —
 *   대시보드의 타일을 누른 것과 같다.
 * - ▶ = 그 목록을 처음부터 재생한다. 재생은 **요청만** 한다 (`AGENTS.md` 규칙 4).
 * - 조작 영역은 44px 이상 (M11 U16).
 */
import { computed, inject, ref } from 'vue'

import { ARCHIVE } from '@/features/archive/archiveController'
import { LIBRARY_BUSY_MESSAGE, LIBRARY_CONFLICT_MESSAGE } from '@/features/library/libraryFeedback'
import { usePlaylistCreate } from '@/features/library/usePlaylistCreate'
import {
  PLAYBACK_COORDINATOR,
  PLAY_REFUSED_HIDDEN_MESSAGE,
  type PlayRequestFailure,
} from '@/features/playback/playbackCoordinator'
import { MAX_PLAYLIST_NAME_LENGTH, useLibraryStore } from '@/stores/library'

const emit = defineEmits<{
  /** 새 목록을 만들었다 — 편집 표면이 다음 행동(곡 추가)으로 이어 줄 수 있다. */
  created: [playlistId: string]
}>()

const library = useLibraryStore()
const coordinator = inject(PLAYBACK_COORDINATOR, null)
const archive = inject(ARCHIVE, null)

const create = usePlaylistCreate()
const notice = ref('')

const REFUSED: Readonly<Record<PlayRequestFailure, string>> = {
  'empty-playlist': '이 목록에 아직 레코드가 없어요.',
  'playlist-not-found': '대상을 찾을 수 없습니다.',
  'track-not-found': '대상을 찾을 수 없습니다.',
  'player-hidden': PLAY_REFUSED_HIDDEN_MESSAGE,
}

const shownNotice = computed<string>(() => notice.value || create.notice.value)

async function select(id: string): Promise<boolean> {
  notice.value = ''
  if (id === library.selectedPlaylistId) return true
  const result = await library.selectPlaylist(id)
  if (!result.ok) {
    notice.value =
      result.reason === 'conflict'
        ? LIBRARY_CONFLICT_MESSAGE
        : result.reason === 'busy'
          ? LIBRARY_BUSY_MESSAGE
          : '대상을 찾을 수 없습니다.'
  }
  return result.ok
}

async function play(id: string): Promise<void> {
  await select(id)
  await archive?.stepAside()
  const result = coordinator?.playPlaylist(id)
  notice.value = result === undefined || result.ok ? '' : REFUSED[result.reason]
}

async function submitCreate(): Promise<void> {
  const id = await create.submit()
  if (id !== null) emit('created', id)
}
</script>

<template>
  <section class="archive-lists" aria-labelledby="archive-lists-title">
    <div class="lists-head">
      <h3 id="archive-lists-title" class="section-title">플레이리스트</h3>
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
        aria-describedby="archive-new-playlist-error"
      />
      <p id="archive-new-playlist-error" class="error-msg">{{ create.formError.value }}</p>
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
    <ul v-else class="list-rows">
      <li
        v-for="playlist in library.playlists"
        :key="playlist.id"
        class="list-row"
        :class="{ 'is-selected': playlist.id === library.selectedPlaylistId }"
      >
        <button
          type="button"
          class="list-select"
          :aria-current="playlist.id === library.selectedPlaylistId ? 'true' : undefined"
          @click="select(playlist.id)"
        >
          <span class="list-name">{{ playlist.name }}</span>
          <span class="list-meta">{{
            playlist.tracks.length === 0 ? '비어 있음' : `${playlist.tracks.length}곡`
          }}</span>
        </button>
        <button
          type="button"
          class="list-play"
          :aria-label="
            playlist.tracks.length === 0
              ? `${playlist.name} — 재생할 곡이 없음`
              : `${playlist.name} 처음부터 재생`
          "
          :disabled="playlist.tracks.length === 0"
          @click="play(playlist.id)"
        >
          ▶
        </button>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.archive-lists {
  min-width: 0;
  margin-bottom: 18px;
}

.lists-head {
  display: flex;
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

@media (hover: hover) {
  .pill:hover:not(:disabled):not(.pill--strong) {
    background: var(--pill-surface-hover-color);
  }
}

.create-form {
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

.form-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.notice {
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
  flex-direction: column;
  gap: 4px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.list-row {
  display: flex;
  min-width: 0;
  gap: 4px;
}

.list-select {
  display: flex;
  min-width: 0;
  min-height: 44px;
  flex: 1;
  align-items: center;
  gap: 10px;
  padding: 6px 12px;
  border: 1px solid transparent;
  border-radius: var(--radius-control);
  background: var(--row-surface-color);
  color: var(--row-text-color);
  text-align: left;
}

.list-row.is-selected .list-select {
  border-color: var(--row-selected-border-color);
  background: var(--row-selected-surface-color);
}

.list-name {
  min-width: 0;
  flex: 1;
  overflow-wrap: anywhere;
  font-size: 13px;
}

.list-meta {
  flex: none;
  color: var(--row-meta-text-color);
  font: 11px var(--font-mono);
}

.list-play {
  width: 44px;
  min-height: 44px;
  flex: none;
  border: 1px solid var(--pill-border-color);
  border-radius: var(--radius-control);
  background: var(--track-surface-color);
  color: var(--track-play-text-color);
}

.list-play:disabled {
  cursor: not-allowed;
  opacity: 0.4;
}
</style>
