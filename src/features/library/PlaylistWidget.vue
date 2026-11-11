<script setup lang="ts">
/**
 * 플레이리스트 위젯 (M6-4).
 *
 * 실기기 검증 보고 7번의 답이다 — 플레이리스트와 트랙이 드로어 한 열에
 * 쌓여 있어서 둘 중 하나만 길어져도 전체가 아래로 늘어났다. 두 표면으로
 * 나눈다 (`M6_PLAN.md` §3).
 *
 *   이 위젯          플레이리스트 타일 격자. 생성·전체 재생. **내부 스크롤**
 *   편집 오버레이    한 목록의 트랙. 이름 변경, 레코드 추가·삭제·순서·이름
 *
 * 사용자 구상은 바탕화면의 폴더 아이콘이다: 누르면 그 목록이 전체 재생되고,
 * `⋯`(또는 길게 누르기)로 그 목록의 레코드가 오른쪽 오버레이에 열린다.
 *
 * 왜 `src/widgets/` 가 아니라 여기인가: 플레이리스트 관리는 라이브러리
 * 도메인이다 (`AGENTS.md` 디렉터리 규약). `src/widgets/` 는 clock·weather
 * 처럼 도메인과 무관한 독립 위젯 자리다. 데크(`features/deck/DeckWidget.vue`)
 * 와 같은 선례를 따른다.
 *
 * 재생은 **요청만** 한다. 큐를 만들지 않고 플레이어를 부르지 않는다. 주입받은
 * Playback Coordinator 에 플레이리스트 id 를 넘길 뿐이다 (규칙 2, 4).
 */
import { computed, inject, nextTick, ref } from 'vue'

import PlaylistTile from '@/features/library/PlaylistTile.vue'
import { LIBRARY_DRAWER } from '@/features/library/drawerController'
import { LIBRARY_CONFLICT_MESSAGE } from '@/features/library/libraryFeedback'
import { PLAYLIST_SHELF } from '@/features/library/playlistShelfController'
import {
  PLAYBACK_COORDINATOR,
  PLAY_REFUSED_HIDDEN_MESSAGE,
  type PlayRequestFailure,
  type PlayRequestResult,
} from '@/features/playback/playbackCoordinator'
import { MAX_PLAYLIST_NAME_LENGTH, useLibraryStore } from '@/stores/library'

const library = useLibraryStore()

/**
 * 둘 다 주입되지 않을 수 있다. 위젯을 단독으로 마운트하는 테스트를 위한
 * 기본값이고, 그때는 해당 동작을 **하지 않는다**.
 */
const playback = inject(PLAYBACK_COORDINATOR, null)
const drawer = inject(LIBRARY_DRAWER, null)

/**
 * 접힘/펼침 (M7 요청 1). 데크를 누르면 바뀐다.
 *
 * 주입되지 않으면 **펼쳐진 것으로 본다** — 위젯을 단독으로 마운트하는
 * 테스트에서 타일이 접힌 채 숨지 않게 한다.
 */
const shelf = inject(PLAYLIST_SHELF, null)
const isExpanded = computed<boolean>(() => shelf?.isExpanded.value ?? true)

const isCreating = ref(false)
const draftName = ref('')
const formError = ref('')
const nameInput = ref<HTMLInputElement | null>(null)

/** 저장되지 않았거나 요청이 거절된 사실을 알린다. */
const notice = ref('')

const FAILURE_MESSAGE: Record<string, string> = {
  'empty-name': '이름을 입력해주세요.',
  'not-found': '대상을 찾을 수 없습니다.',
  conflict: LIBRARY_CONFLICT_MESSAGE,
}

/**
 * 선택도 저장되는 변경이다. 다른 탭이 먼저 바꿨으면 거절되고 최신 내용이
 * 다시 읽힌다 (M10-3) — 그 사실을 알린다. 재생 요청은 선택과 별개로 진행한다.
 */
function select(id: string): void {
  const result = library.selectPlaylist(id)
  if (!result.ok && result.reason === 'conflict') notice.value = LIBRARY_CONFLICT_MESSAGE
}

/**
 * 재생 거절 안내.
 *
 * `player-hidden` 문구는 드로어·데크와 **공유한다** (M7-1). 세로 시트가
 * 플레이어를 덮으면 플레이어의 `.status` 도 함께 덮이므로, 누른 자리에서
 * 말해야 읽힌다.
 *
 * `empty-playlist` 는 빈 타일의 `▶` 가 비활성이라 보통 닿지 않지만, 마지막
 * 트랙이 지워진 직후 같은 경계에서는 닿을 수 있다.
 */
const REFUSED_MESSAGE: Record<PlayRequestFailure, string> = {
  'empty-playlist': '이 목록에 아직 레코드가 없어요.',
  'playlist-not-found': '대상을 찾을 수 없습니다.',
  'track-not-found': '대상을 찾을 수 없습니다.',
  'player-hidden': PLAY_REFUSED_HIDDEN_MESSAGE,
}

const hasPlaylists = computed<boolean>(() => library.playlists.length > 0)

/** 저장 여부를 성공과 뭉뚱그리지 않고 따로 알린다. */
function reportPersisted(result: { persisted?: boolean }): void {
  notice.value =
    result.persisted === false ? '이 변경은 저장되지 않았습니다. 현재 세션에서만 유지됩니다.' : ''
}

async function startCreate(): Promise<void> {
  notice.value = ''
  formError.value = ''
  draftName.value = ''
  isCreating.value = true
  await nextTick()
  nameInput.value?.focus()
}

function cancelCreate(): void {
  isCreating.value = false
  draftName.value = ''
  formError.value = ''
}

function submitCreate(): void {
  const result = library.createPlaylist(draftName.value)

  if (!result.ok) {
    // 실패해도 입력값을 지우지 않는다. 사용자가 고쳐 쓸 수 있어야 한다.
    formError.value = FAILURE_MESSAGE[result.reason] ?? '요청을 처리하지 못했습니다.'
    return
  }

  reportPersisted(result)
  isCreating.value = false
  draftName.value = ''
  formError.value = ''
}

function report(result: PlayRequestResult | undefined): void {
  notice.value = result === undefined || result.ok ? '' : REFUSED_MESSAGE[result.reason]
}

/**
 * 타일의 `▶` — 그 목록 전체 재생.
 *
 * **재생하는 목록을 선택 상태로 맞춘다.** 그래야 편집 오버레이와 데크의 ▶ 가
 * 지금 울리는 목록을 가리킨다. 코디네이터는 선택을 바꾸지 않는다.
 *
 * 편집 시트가 열려 있으면 **먼저 비켜달라고 한다** (M7-2). 세로 화면에서는
 * 시트가 플레이어를 덮고 있을 수 있고, 그 상태로 요청하면 거절된다.
 */
function playPlaylist(id: string): void {
  notice.value = ''
  if (id !== library.selectedPlaylistId) select(id)

  void (async () => {
    await drawer?.stepAside()
    report(playback?.playPlaylist(id))
  })()
}

/** `⋯` 누름 — 그 목록을 선택하고 편집 오버레이를 연다. */
function openPlaylist(id: string): void {
  notice.value = ''
  select(id)
  drawer?.open()
}
</script>

<template>
  <section
    :id="shelf?.shelfId"
    class="playlist-widget"
    :class="{ 'is-collapsed': !isExpanded }"
    aria-labelledby="playlist-widget-title"
  >
    <div class="widget-head">
      <div class="head-text">
        <h2 id="playlist-widget-title" class="widget-title">PLAYLISTS</h2>
        <!-- 무엇을 누르면 무슨 일이 일어나는지 화면에 적는다 (보고 6a). -->
        <p class="widget-sub">누르면 트랙 편집 · ▶ 로 전체 재생</p>
      </div>
      <button type="button" class="pill pill--strong" @click="startCreate">＋ 새 목록</button>
    </div>

    <form v-if="isCreating" class="create-form" @submit.prevent="submitCreate">
      <label class="label" for="new-playlist-name">새 플레이리스트 이름</label>
      <input
        id="new-playlist-name"
        ref="nameInput"
        v-model="draftName"
        class="field"
        type="text"
        :maxlength="MAX_PLAYLIST_NAME_LENGTH"
        autocomplete="off"
        :aria-invalid="formError !== '' || undefined"
        aria-describedby="new-playlist-error"
      />
      <p id="new-playlist-error" class="error-msg">{{ formError }}</p>
      <div class="form-actions">
        <button type="submit" class="pill pill--strong">만들기</button>
        <button type="button" class="pill" @click="cancelCreate">취소</button>
      </div>
    </form>

    <p v-if="notice !== ''" class="widget-notice" role="status" aria-live="polite">
      {{ notice }}
    </p>

    <!--
      내부 스크롤 (사용자 요청). 목록이 길어져도 위젯이 아래로 늘어나지 않아
      다른 위젯을 밀지 않는다 — 보고 7번의 핵심이다.
    -->
    <div class="tile-scroll">
      <p v-if="!hasPlaylists" class="empty">
        아직 플레이리스트가 없습니다.<br />＋ 새 목록으로 시작하세요.
      </p>

      <div v-else class="tile-grid">
        <!-- :key 는 배열 인덱스가 아니라 플레이리스트 id 다. -->
        <PlaylistTile
          v-for="playlist in library.playlists"
          :key="playlist.id"
          :playlist="playlist"
          :is-selected="playlist.id === library.selectedPlaylistId"
          @play="playPlaylist(playlist.id)"
          @open="openPlaylist(playlist.id)"
        />
      </div>
    </div>
  </section>
</template>

<style scoped>
/*
 * 색은 모두 승인된 디자인의 드로어·행 토큰을 재사용한다. 새 색을 만들지
 * 않는다 (`theme-tokens.spec.ts` 가 레퍼런스에 없는 색을 거부한다).
 */
.playlist-widget {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 10px;
}

/*
 * 칸이 좁으면 버튼이 제목 **아래로** 내려간다 (M9-6).
 *
 * 1100px 이하에서 이 위젯은 데크 옆 반 칸이다. 360px 에서 그 칸은 144px 인데
 * 줄바꿈할 수 없는 `PLAYLISTS`(약 82px) + 간격 + `＋ 새 목록`(81px) 이 그보다
 * 넓어 버튼이 위젯 밖으로 29px(390px 에서 14px) 나갔다 — M9-4 측정에서 찾았고
 * 기준 빌드에서도 같았다.
 *
 * 글 상자의 기준 폭을 0 으로 두는 것이 요점이다. 그러면 줄을 나눌지 정할 때
 * 글 상자의 크기가 **최소 내용 폭**(`PLAYLISTS`)으로 계산되므로, 둘이 정말로
 * 한 줄에 들어가지 않을 때만 내려간다. 넓은 칸에서는 글 상자가 남은 폭을 모두
 * 먹어 버튼이 이전과 똑같이 오른쪽 끝에 선다.
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

/* 드로어의 `.drawer-title` 과 같은 조판이다. 같은 물건의 다른 표면이다. */
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

.pill--strong {
  border-color: var(--accent-strong-color);
  background: var(--accent-strong-color);
  color: var(--accent-strong-text-color);
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

.widget-notice {
  margin: 0;
  color: var(--status-warning-text-color);
  font: 10px/1.6 var(--font-mono);
}

/*
 * 내부 스크롤. 상한은 토큰이 정한다 (`--size-playlist-max-height`).
 * `min-height: 0` 이 없으면 flex 자식이 줄어들지 않아 상한이 무시된다.
 */
.tile-scroll {
  min-height: 0;
  max-height: var(--size-playlist-max-height);
  overflow-y: auto;
}

/*
 * 접힌 상태 (M7 요청 1). 타일 한 줄만 보인다.
 *
 * `display: none` 으로 숨기지 않는다. 접혀 있어도 타일이 보여야 무엇이
 * 여기 있는지 알 수 있고, 데크를 누르면 펼쳐진다는 것도 짐작할 수 있다.
 */
.playlist-widget.is-collapsed .tile-scroll {
  max-height: var(--size-playlist-collapsed-max-height);
}

/*
 * 좁은 화면에서 펼치면 **데크 높이만큼** 쓴다 (M7 요청 5).
 *
 * 높이를 숫자로 정하지 않는다. `WidgetHost` 가 이 위젯을 데크와 같은 행에
 * 늘려 붙이므로(`align-self: stretch`) 행 높이가 곧 데크 높이다. 그 안에서
 * 목록이 길면 스크롤한다.
 */
@media (max-width: 1100px) {
  .playlist-widget:not(.is-collapsed) .tile-scroll {
    max-height: none;
    flex: 1;
  }
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
  font-size: 11px;
  line-height: 1.6;
}
</style>
