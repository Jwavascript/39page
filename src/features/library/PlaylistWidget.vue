<script setup lang="ts">
/**
 * 플레이리스트 위젯 — 대시보드의 **미리보기** (M6-4, M11-3 에서 다시 짰다).
 *
 * 타일 본문 = 그 목록을 골라 **음악 보관함**에서 편집한다. 타일의 ▶ = 그 목록 전체 재생 (보고 6a).
 *
 * M11-3 에서 바뀐 것
 * - **선반(접기 · 펼치기)과 위젯 안 스크롤을 없앴다.** 세로 화면에서 펼친 선반이 재생 화면을 아래로
 *   밀었고(U19), 위젯 안 스크롤이 페이지 스크롤과 겹쳤다. 대신 **목록 몇 개만** 보이고 나머지는
 *   "모든 목록 보기" 로 보관함에서 본다 — 기능을 숨기는 것이 아니라 관리 화면으로 넘기는 것이다.
 * - 새 목록을 만들면 바로 보관함의 그 목록 **링크 입력**으로 이어진다 (U15).
 * - 지금 재생 중인 곡이 든 목록을 글로도 표시한다 (U14). 재생 상태는 코디네이터 계약의 읽기 전용
 *   보기로만 안다 — playback store 를 보지 않는다 (ADR 0009).
 *
 * 재생은 **요청만** 한다 (M3-2). 큐를 만들거나 플레이어를 부르지 않는다 (`AGENTS.md` 규칙 2, 4).
 */
import { computed, inject, ref } from 'vue'

import { ARCHIVE } from '@/features/archive/archiveController'
import PlaylistTile from '@/features/library/PlaylistTile.vue'
import { LIBRARY_BUSY_MESSAGE, LIBRARY_CONFLICT_MESSAGE } from '@/features/library/libraryFeedback'
import { usePlaylistCreate } from '@/features/library/usePlaylistCreate'
import {
  PLAYBACK_COORDINATOR,
  PLAY_REFUSED_HIDDEN_MESSAGE,
  type PlayRequestFailure,
  type PlayRequestResult,
} from '@/features/playback/playbackCoordinator'
import { MAX_PLAYLIST_NAME_LENGTH, useLibraryStore } from '@/stores/library'

/** 대시보드에 보이는 타일 수. 나머지는 보관함에서 본다. */
const PLAYLIST_PREVIEW_LIMIT = 6

const library = useLibraryStore()

const playback = inject(PLAYBACK_COORDINATOR, null)
const archive = inject(ARCHIVE, null)

const create = usePlaylistCreate()

/** 재생 거절 · 선택 실패 안내. 만들기의 "저장되지 않음" 은 `create.notice` 가 말한다. */
const notice = ref('')
const shownNotice = computed<string>(() => notice.value || create.notice.value)

const FAILURE_MESSAGE: Record<string, string> = {
  'not-found': '대상을 찾을 수 없습니다.',
  conflict: LIBRARY_CONFLICT_MESSAGE,
  busy: LIBRARY_BUSY_MESSAGE,
}

const REFUSED_MESSAGE: Record<PlayRequestFailure, string> = {
  'empty-playlist': '이 목록에 아직 레코드가 없어요.',
  'playlist-not-found': '대상을 찾을 수 없습니다.',
  'track-not-found': '대상을 찾을 수 없습니다.',
  'player-hidden': PLAY_REFUSED_HIDDEN_MESSAGE,
}

const hasPlaylists = computed<boolean>(() => library.playlists.length > 0)

/**
 * 보이는 타일 — 앞에서부터 상한까지. 고른 목록이 그 뒤에 있으면 마지막 자리를 내준다 — 지금 고른
 * 목록이 대시보드에서 사라지지 않게.
 */
const previewPlaylists = computed(() => {
  const all = library.playlists
  if (all.length <= PLAYLIST_PREVIEW_LIMIT) return all
  const head = all.slice(0, PLAYLIST_PREVIEW_LIMIT)
  const selected = all.find((playlist) => playlist.id === library.selectedPlaylistId)
  if (selected === undefined || head.includes(selected)) return head
  return [...head.slice(0, PLAYLIST_PREVIEW_LIMIT - 1), selected]
})

const hiddenCount = computed<number>(() => library.playlists.length - previewPlaylists.value.length)

/** 지금 재생 중인 곡이 든 목록 id — 코디네이터의 읽기 전용 보기로만 안다. */
const playingPlaylistIds = computed<ReadonlySet<string>>(() => {
  const now = playback?.nowPlaying.value ?? null
  if (now === null) return new Set()
  return new Set(
    library.playlists
      .filter((playlist) => playlist.tracks.some((track) => track.id === now.trackId))
      .map((playlist) => playlist.id),
  )
})

async function select(id: string): Promise<boolean> {
  const result = await library.selectPlaylist(id)
  if (!result.ok && (result.reason === 'conflict' || result.reason === 'busy')) {
    notice.value = FAILURE_MESSAGE[result.reason] ?? ''
  }
  return result.ok
}

function report(result: PlayRequestResult | undefined): void {
  notice.value = result === undefined || result.ok ? '' : REFUSED_MESSAGE[result.reason]
}

function playPlaylist(id: string): void {
  notice.value = ''
  create.clearNotice()
  if (id !== library.selectedPlaylistId) void select(id)

  void (async () => {
    await archive?.stepAside()
    report(playback?.playPlaylist(id))
  })()
}

function openPlaylist(id: string): void {
  notice.value = ''
  create.clearNotice()
  // 선택이 끝난 뒤에 연다 — 다른 목록이 잠깐 보이거나, 거절됐는데 엉뚱한 목록이 열리지 않게.
  void select(id).then((selected) => {
    if (selected) archive?.open('music')
  })
}

function openAll(): void {
  notice.value = ''
  archive?.open('music')
}

async function startCreate(): Promise<void> {
  notice.value = ''
  await create.start()
}

/** 만들면 그 목록이 골라진 채로 보관함이 열리고 링크 입력으로 간다 (U15). */
async function submitCreate(): Promise<void> {
  const id = await create.submit()
  if (id !== null) archive?.open('music', { addLink: true })
}
</script>

<template>
  <section class="playlist-widget" aria-labelledby="playlist-widget-title">
    <div class="widget-head">
      <div class="head-text">
        <h2 id="playlist-widget-title" class="widget-title">PLAYLISTS</h2>
        <!-- 무엇을 누르면 무슨 일이 일어나는지 화면에 적는다 (보고 6a). -->
        <p class="widget-sub">이름을 누르면 보관함에서 편집 · ▶ 로 전체 재생</p>
      </div>
      <button type="button" class="pill pill--strong" @click="startCreate">＋ 새 목록</button>
    </div>

    <form v-if="create.isCreating.value" class="create-form" @submit.prevent="submitCreate">
      <label class="label" for="new-playlist-name">새 플레이리스트 이름</label>
      <input
        id="new-playlist-name"
        :ref="(el) => (create.nameInput.value = el as HTMLInputElement | null)"
        v-model="create.draftName.value"
        class="field"
        type="text"
        :maxlength="MAX_PLAYLIST_NAME_LENGTH"
        autocomplete="off"
        :aria-invalid="create.formError.value !== '' || undefined"
        aria-describedby="new-playlist-error new-playlist-next"
      />
      <p id="new-playlist-error" class="error-msg">{{ create.formError.value }}</p>
      <p id="new-playlist-next" class="form-hint">
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

    <p v-if="shownNotice !== ''" class="widget-notice" role="status" aria-live="polite">
      {{ shownNotice }}
    </p>

    <p v-if="!hasPlaylists" class="empty">
      아직 플레이리스트가 없습니다.<br />＋ 새 목록으로 시작하세요.
    </p>

    <!-- 위젯 안 스크롤이 없다 — 보이는 수를 정하고 나머지는 보관함으로 (M11-3). -->
    <div v-else class="tile-grid">
      <!-- :key 는 배열 인덱스가 아니라 플레이리스트 id 다. -->
      <PlaylistTile
        v-for="playlist in previewPlaylists"
        :key="playlist.id"
        :playlist="playlist"
        :is-selected="playlist.id === library.selectedPlaylistId"
        :is-playing="playingPlaylistIds.has(playlist.id)"
        @play="playPlaylist(playlist.id)"
        @open="openPlaylist(playlist.id)"
      />
    </div>

    <button v-if="hasPlaylists" type="button" class="pill show-all" @click="openAll">
      모든 목록 보기 ({{ library.playlists.length }})<template v-if="hiddenCount > 0">
        · {{ hiddenCount }}개 더</template
      >
    </button>
  </section>
</template>

<style scoped>
.playlist-widget {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 10px;
}

/*
 * 칸이 좁으면 버튼이 제목 **아래로** 내려간다 (M9-6). 글 상자의 기준 폭을 0 으로 두어, 둘이 정말로
 * 한 줄에 들어가지 않을 때만 내려간다.
 */
.widget-head {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
}

.head-text {
  flex: 1 1 0;
}

/* 보관함의 머리말과 같은 조판이다. 같은 물건의 다른 표면이다. */
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
}

.pill--strong {
  border-color: var(--accent-strong-color);
  background: var(--accent-strong-color);
  color: var(--accent-strong-text-color);
}

.show-all {
  align-self: flex-start;
}

.create-form {
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

.widget-notice {
  margin: 0;
  color: var(--status-warning-text-color);
  font: 11px/1.6 var(--font-mono);
}

.tile-grid {
  display: grid;
  /* 폭에 따라 칸 수가 바뀐다. 폰 세로에서도 두 칸이 들어간다. */
  grid-template-columns: repeat(auto-fill, minmax(var(--size-playlist-tile-min), 1fr));
  gap: 7px;
}

.empty {
  margin: 0;
  color: var(--drawer-muted-text-color);
  font-size: 12px;
  line-height: 1.6;
}
</style>
