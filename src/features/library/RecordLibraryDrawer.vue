<script setup lang="ts">
/**
 * 플레이리스트 편집 오버레이 (M6-5).
 *
 * 승인된 디자인의 `.drawer` 외형을 따른다. M6-2 에서 **오버레이**가 됐고,
 * 플레이어를 가리지 않는다는 보장은 레이아웃이 진다 (`WidgetHost.vue` 의
 * 정보 열 최소 폭, `DashboardShell.vue` 의 좁은 화면 아래 행).
 *
 * M6-5 에서 **한 플레이리스트의 편집 표면**으로 좁혔다. 이전에는 플레이리스트
 * 목록과 트랙 목록이 같은 스크롤에 쌓여 있어서 둘 중 하나만 길어져도 전체가
 * 아래로 늘어났다 (보고 7번). 플레이리스트는 `PlaylistWidget` 으로 꺼냈다.
 *
 * 그 결과 **위계가 공간에 드러난다** (보고 6a·6b).
 *
 *   `PlaylistWidget`  플레이리스트를 만들고 고른다 (`＋ 새 목록`)
 *   이 오버레이       고른 목록의 머리말에서 이름을 바꾸고 지운다
 *                     트랙 목록 **바로 위**에서 트랙을 추가한다
 *
 * 이전에는 `＋ 새 목록` 과 `＋ YouTube 링크 추가` 가 나란히 있어서 어느 것이
 * 노래를 추가하는지 알 수 없었고, `이름 수정` 이 트랙 목록 바로 위에 있어서
 * 트랙 이름을 바꾸는 것으로 읽혔다. 지금은 목록 바로 위에 있는 것이 트랙
 * 추가뿐이고, 이름 수정은 **무엇의 이름인지 적힌 머리말** 옆에 있다.
 *
 * 재생은 **요청만** 한다 (M3-2). 큐를 만들거나 플레이어를 부르지 않고,
 * 주입받은 Playback Coordinator 에 id 를 넘긴다. `playback` store 도
 * `PlayerAdapter` 도 모른다 (`AGENTS.md` 규칙 2, 4).
 *
 * 트랙을 지운 뒤에는 **사실만** 알린다 (M3-5). 재생 중이던 곡이면 멈추는
 * 판단은 코디네이터가 한다.
 *
 * M8-2 에서 바닥에 `BackupPanel` 이 들어왔다. 이 컴포넌트는 백업을 모른다 —
 * 자리만 내어 준다.
 *
 * 가시성 때문에 거절된 경우도 **여기서 말한다** (M7-1). M6-5 에서 "플레이어가
 * 항상 보이므로 플레이어의 `.status` 하나면 된다" 고 지웠는데, 세로 화면의
 * 시트가 플레이어를 덮을 수 있게 되면서 그 근거가 무너졌다 — 덮이면 그 안내도
 * 함께 덮인다. 사용자가 보고 있는 곳에 있어야 읽힌다.
 */
import { computed, inject, nextTick, ref, watch } from 'vue'

import BackupPanel from '@/features/backup/BackupPanel.vue'
import LibraryStatusBanner from '@/features/library/LibraryStatusBanner.vue'
import TrackList from '@/features/library/TrackList.vue'
import { LIBRARY_DRAWER } from '@/features/library/drawerController'
import {
  PLAYBACK_COORDINATOR,
  PLAY_REFUSED_HIDDEN_MESSAGE,
  type PlayRequestFailure,
  type PlayRequestResult,
} from '@/features/playback/playbackCoordinator'
import { parseYouTubeVideoId } from '@/shared/utils/youtube'
import { LIBRARY_CONFLICT_MESSAGE } from '@/features/library/libraryFeedback'
import { MAX_PLAYLIST_NAME_LENGTH, MAX_TRACK_TITLE_LENGTH, useLibraryStore } from '@/stores/library'

const props = defineProps<{ open: boolean; drawerId: string }>()
const emit = defineEmits<{ close: [] }>()

const library = useLibraryStore()

/**
 * 재생 요청 입구 (M3-2).
 *
 * `features/playback` 의 **계약 파일만** 가져온다. 구현
 * (`createPlaybackCoordinator`)은 보지 않는다. 주입되지 않으면 요청하지
 * 않는다 — 드로어를 단독으로 마운트하는 테스트를 위한 기본값이다.
 */
const playback = inject(PLAYBACK_COORDINATOR, null)

/**
 * 재생 전에 비켜달라고 부탁하는 통로 (M7-2).
 *
 * 열림 상태는 `open` prop 으로 받지만, **스스로 비켜주는 일**은 셸이 해야 한다
 * — 가리는지 아닌지는 브레이크포인트를 아는 쪽만 판단할 수 있다.
 * 주입되지 않으면 비켜주지 않는다 (단독 마운트 테스트).
 */
const drawer = inject(LIBRARY_DRAWER, null)

const closeButton = ref<HTMLButtonElement | null>(null)

/** 이름 변경 폼이 열려 있는 대상. 열릴 때 정한 id 를 끝까지 쓴다. */
const renamingId = ref<string | null>(null)
const draftName = ref('')
const formError = ref('')
/** 마지막 동작이 저장되지 않았는지. `persisted: false` 를 알린다. */
const unsavedNotice = ref('')

/** 마지막 목록은 지울 수 없다. 전부 사라지면 돌아갈 자리가 없다. */
const canDelete = computed<boolean>(() => library.playlists.length > 1)

const trackCount = computed<number>(() => library.selectedPlaylist?.tracks.length ?? 0)

/* ---------- YouTube 링크 등록 ---------- */

/**
 * 링크 폼이 겨냥한 플레이리스트.
 *
 * 선택이 바뀌면 폼을 닫지만, 그래도 **열릴 때 정한 대상에만** 등록한다.
 * 잘못된 목록에 트랙이 들어가는 일을 구조로 막는다.
 */
const linkTargetId = ref<string | null>(null)
const draftUrl = ref('')
const draftTitle = ref('')
const linkError = ref('')
/** 방금 등록한 트랙 제목. 성공을 사용자가 확인할 수 있게 한다. */
const addedNotice = ref('')

/** 재생 요청이 거절된 이유 (M3-4). */
const playbackNotice = ref('')

/**
 * 거절 사유별 안내.
 *
 * `player-hidden` 문구는 `PlaylistWidget` · `useDeckTransport` 와 **공유한다**
 * (`PLAY_REFUSED_HIDDEN_MESSAGE`). 재생을 요청하는 세 표면이 같은 말을 해야
 * 사용자가 같은 사정을 두 가지 문제로 읽지 않는다.
 */
const PLAY_REFUSED_MESSAGE: Record<PlayRequestFailure, string> = {
  'player-hidden': PLAY_REFUSED_HIDDEN_MESSAGE,
  'empty-playlist': '재생할 트랙이 없습니다.',
  'playlist-not-found': '대상을 찾을 수 없습니다.',
  'track-not-found': '대상을 찾을 수 없습니다.',
}

/** 재생 요청 결과를 안내로 옮긴다. 성공이면 지운다. */
function reportPlayRequest(result: PlayRequestResult | undefined): void {
  playbackNotice.value =
    result === undefined || result.ok ? '' : PLAY_REFUSED_MESSAGE[result.reason]
}

const linkTarget = computed(() =>
  linkTargetId.value === null ? null : (library.getPlaylist(linkTargetId.value) ?? null),
)

function closeLinkForm(): void {
  linkTargetId.value = null
  draftUrl.value = ''
  draftTitle.value = ''
  linkError.value = ''
}

function startAddLink(): void {
  const current = library.selectedPlaylist
  if (current === null) return

  resetForm()
  linkTargetId.value = current.id
  draftUrl.value = ''
  draftTitle.value = ''
  linkError.value = ''
  addedNotice.value = ''
}

function submitLink(): void {
  const targetId = linkTargetId.value
  if (targetId === null) return

  const parsed = parseYouTubeVideoId(draftUrl.value)
  if (!parsed.ok) {
    // 실패해도 입력값을 지우지 않는다. 사용자가 고쳐 쓸 수 있어야 한다.
    linkError.value = '올바른 YouTube 영상 링크를 입력해주세요.'
    return
  }

  const result = library.addTrack(targetId, {
    videoId: parsed.videoId,
    title: draftTitle.value,
  })

  if (!result.ok) {
    // 실패해도 입력값을 지우지 않는다 — 충돌이면 최신 목록을 보고 그대로 다시 누를 수 있다.
    linkError.value =
      result.reason === 'invalid-video-id'
        ? '올바른 YouTube 영상 링크를 입력해주세요.'
        : result.reason === 'conflict'
          ? LIBRARY_CONFLICT_MESSAGE
          : '해당 플레이리스트를 찾을 수 없습니다.'
    return
  }

  const added = library.getPlaylist(targetId)?.tracks.find((track) => track.id === result.trackId)
  addedNotice.value = `“${added?.title ?? ''}”을 추가했습니다.`
  reportPersisted(result)
  closeLinkForm()
}

/* ---------- 트랙 편집 ---------- */

function moveTrack(trackId: string, direction: 'up' | 'down'): void {
  const target = library.selectedPlaylist
  if (target === null) return

  reportResult(library.moveTrack(target.id, trackId, direction))
}

/** 트랙 이름 변경 (M6-5, 보고 6c). 확인은 `TrackList` 가 받는다. */
function renameTrack(trackId: string, title: string): void {
  const target = library.selectedPlaylist
  if (target === null) return

  reportResult(library.renameTrack(target.id, trackId, title))
}

function removeTrack(trackId: string): void {
  const target = library.selectedPlaylist
  if (target === null) return

  if (reportResult(library.removeTrack(target.id, trackId))) {
    /*
     * 재생 중이던 곡이면 멈추고 안내해야 한다 (`MVP_SPEC.md` F4, M3-5).
     *
     * 큐는 스냅샷이라 라이브러리에서 지워도 자동으로 끊기지 않는다. 그래서
     * **사실만** 알리고, 멈출지 말지는 코디네이터가 정한다. 이 컴포넌트는
     * 여전히 `playback` store 도 `PlayerAdapter` 도 모른다.
     */
    playback?.trackRemoved(trackId)
  }
}

function resetForm(): void {
  renamingId.value = null
  draftName.value = ''
  formError.value = ''
}

/** 저장 여부를 성공과 뭉뚱그리지 않고 따로 알린다. */
function reportPersisted(result: { persisted?: boolean }): void {
  unsavedNotice.value =
    result.persisted === false ? '이 변경은 저장되지 않았습니다. 현재 세션에서만 유지됩니다.' : ''
}

const FAILURE_MESSAGE: Record<string, string> = {
  'empty-name': '이름을 입력해주세요.',
  'not-found': '대상을 찾을 수 없습니다.',
  'invalid-video-id': '올바른 YouTube 영상 링크를 입력해주세요.',
  'out-of-range': '더 이상 옮길 수 없습니다.',
  conflict: LIBRARY_CONFLICT_MESSAGE,
}

/** 액션 결과를 화면 안내로 옮긴다. */
function reportResult(result: { ok: boolean; persisted?: boolean; reason?: string }): boolean {
  if (!result.ok) {
    formError.value = FAILURE_MESSAGE[result.reason ?? ''] ?? '요청을 처리하지 못했습니다.'
    return false
  }

  reportPersisted(result)
  return true
}

/* ---------- 플레이리스트 자체 ---------- */

function startRename(): void {
  const current = library.selectedPlaylist
  if (current === null) return

  renamingId.value = current.id
  draftName.value = current.name
  formError.value = ''
}

function submitForm(): void {
  const id = renamingId.value
  if (id === null) return

  if (reportResult(library.renamePlaylist(id, draftName.value))) resetForm()
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

/* ---------- 재생 요청 ---------- */

/**
 * 재생을 요청하기 전에 **시트를 비켜준다** (M7-2).
 *
 * 세로 화면에서 이 드로어가 플레이어를 덮고 있으면 가드가 거절한다. 사용자가
 * 안내를 읽고 직접 닫는 대신 그냥 닫히고 재생되기를 원했다.
 *
 * 비켜준 **뒤에** 요청한다. 순서가 중요하다 — 같은 틱에 요청하면 가림이 아직
 * 0 으로 보고되지 않아 그대로 거절된다.
 *
 * 넓은 화면에서는 `stepAside()` 가 아무 일도 하지 않으므로 드로어가 열린 채로
 * 남는다.
 */
async function playAfterStepAside(request: () => PlayRequestResult | undefined): Promise<void> {
  await drawer?.stepAside()

  reportPlayRequest(request())
}

/** 지금 선택된 목록을 처음부터 재생한다. */
function requestPlaySelected(): void {
  const current = library.selectedPlaylist
  if (current === null) return

  void playAfterStepAside(() => playback?.playPlaylist(current.id))
}

/**
 * 고른 트랙부터 재생한다.
 *
 * 큐는 **그 트랙 하나가 아니라 목록 전체**다. 코디네이터가 그렇게 만든다.
 */
function requestPlayTrack(trackId: string): void {
  const current = library.selectedPlaylist
  if (current === null) return

  void playAfterStepAside(() => playback?.playTrack(current.id, trackId))
}

/** 선택된 목록을 재생할 수 있는지. 빈 목록은 재생할 수 없다. */
const canPlaySelected = computed<boolean>(() => trackCount.value > 0)

/** 열고 닫을 때, 그리고 대상이 바뀔 때 비우는 것들. */
function clearTransientState(): void {
  resetForm()
  closeLinkForm()
  pendingDeleteId.value = null
  addedNotice.value = ''
  playbackNotice.value = ''
}

/**
 * 편집 대상이 바뀌면 작성 중인 것을 닫는다 (M6-5).
 *
 * 선택을 바꾸는 곳이 이제 **이 컴포넌트 밖**(`PlaylistWidget`)이다. 머리말은
 * 새 목록을 가리키는데 폼이 옛 목록을 겨냥한 채 열려 있으면 사용자가 어디에
 * 쓰는지 알 수 없다. `createPlaylist` 도 선택을 옮기므로 새 목록을 만들 때도
 * 함께 닫힌다.
 */
watch(() => library.selectedPlaylistId, clearTransientState)

/** 열릴 때 닫기 버튼으로 포커스를 옮긴다. 닫힐 때는 셸이 트리거로 되돌린다. */
watch(
  () => props.open,
  async (isOpen) => {
    if (!isOpen) {
      clearTransientState()
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
    선언하지 않는다. 넓은 화면에서는 플레이어를 비켜가는 비모달 영역이다.
  -->
  <aside :id="drawerId" class="drawer" :hidden="!open" aria-labelledby="record-library-title">
    <div class="drawer-head">
      <div class="head-text">
        <!--
          머리말이 **무엇을 편집하는지** 말한다. `이름 수정` 이 이 옆에 있으므로
          무엇의 이름인지 자명하다 (보고 6b).
        -->
        <h2 id="record-library-title" class="drawer-title">
          {{ library.selectedPlaylist?.name ?? 'RECORD LIBRARY' }}
        </h2>
        <p class="drawer-sub">
          {{ library.selectedPlaylist === null ? 'COLLECTION' : `${trackCount} TRACKS` }} / YOUTUBE
          ONLY
        </p>
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
      <p v-if="addedNotice !== ''" class="added" role="status">{{ addedNotice }}</p>
      <p v-if="playbackNotice !== ''" class="play-notice" role="status" aria-live="polite">
        {{ playbackNotice }}
      </p>

      <!-- 이 목록 자체에 대한 동작. 트랙 목록에서 멀리 떨어뜨린다 (보고 6b). -->
      <div class="drawer-actions">
        <button
          type="button"
          class="pill pill--strong"
          :disabled="!canPlaySelected"
          @click="requestPlaySelected"
        >
          ▶ 목록 전체 재생
        </button>
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
          목록 삭제
        </button>
      </div>

      <form v-if="renamingId !== null" class="name-form" @submit.prevent="submitForm">
        <label class="label" for="playlist-name">플레이리스트 이름 수정</label>
        <input
          id="playlist-name"
          v-model="draftName"
          class="field"
          type="text"
          :maxlength="MAX_PLAYLIST_NAME_LENGTH"
          autocomplete="off"
        />
        <p class="error-msg">{{ formError }}</p>
        <div class="drawer-actions">
          <button type="submit" class="pill pill--strong">저장</button>
          <button type="button" class="pill" @click="resetForm">취소</button>
        </div>
      </form>

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

      <p v-if="library.selectedPlaylist === null" class="muted">
        플레이리스트를 먼저 만들거나 선택하면 링크를 추가할 수 있어요.
      </p>

      <div class="rule" />

      <h3 class="drawer-section-title">TRACKS</h3>

      <!--
        트랙 목록 **바로 위**에 있는 동작은 트랙 추가뿐이다. 자리가 무엇에
        대한 동작인지 말해준다 (보고 6a·6b).
      -->
      <div class="drawer-actions">
        <button
          type="button"
          class="pill"
          :disabled="library.selectedPlaylist === null"
          @click="startAddLink"
        >
          ＋ YouTube 링크 추가
        </button>
      </div>

      <!-- YouTube 링크 등록 폼. 대상 플레이리스트를 라벨에 명시한다. -->
      <form v-if="linkTarget !== null" class="link-form" @submit.prevent="submitLink">
        <p class="form-target">
          <strong>{{ linkTarget.name }}</strong
          >에 추가
        </p>

        <label class="label" for="track-url">YouTube URL</label>
        <input
          id="track-url"
          v-model="draftUrl"
          class="field"
          type="url"
          inputmode="url"
          autocomplete="off"
          placeholder="https://www.youtube.com/watch?v=..."
          :aria-invalid="linkError !== '' || undefined"
          aria-describedby="track-url-error"
        />

        <label class="label" for="track-title">곡 이름 (선택)</label>
        <input
          id="track-title"
          v-model="draftTitle"
          class="field"
          type="text"
          :maxlength="MAX_TRACK_TITLE_LENGTH"
          autocomplete="off"
          placeholder="입력하지 않으면 YouTube 영상 ID로 표시"
        />

        <p id="track-url-error" class="error-msg">{{ linkError }}</p>

        <div class="drawer-actions">
          <button type="submit" class="pill pill--strong">이 목록에 추가</button>
          <button type="button" class="pill" @click="closeLinkForm">취소</button>
        </div>
      </form>

      <TrackList
        :tracks="library.selectedPlaylist === null ? null : library.selectedPlaylist.tracks"
        @play="requestPlayTrack"
        @move="moveTrack"
        @remove="removeTrack"
        @rename="renameTrack"
      />

      <!--
        JSON 백업 (M8-2). 편집 영역과 **선으로 끊고 다른 머리말**을 둔다 —
        이 목록을 고치는 일과 앱 전체 데이터를 파일로 꺼내는 일은 성격이 다르다.
      -->
      <BackupPanel />
    </div>

    <p class="drawer-foot">
      데크나 플레이리스트의 ⋯ 로 열고, ESC 또는 ×로 닫으세요.<br />
      ▶를 누르면 그 곡부터 목록을 이어서 재생합니다.
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

/*
 * 글 상자가 줄어들 수 있어야 제목의 말줄임이 실제로 일어난다 (M9-6).
 *
 * 제목은 `nowrap` 이라 최소 내용 폭이 이름 전체다. 이 상자에 `min-width: 0`
 * 이 없으면 플렉스 항목의 자동 최소 폭이 그 이름 전체가 되어, 이름이 드로어보다
 * 길면 머리말이 드로어 밖으로 늘어났다 — 390px 에서 60자 이름일 때 닫기(×)가
 * 화면 밖 638px 에 섰다. 공백이 있는 이름도 `nowrap` 이므로 똑같다.
 * M9-6 실측에서 찾았고, M9 이전 빌드부터 있던 결함이다.
 */
.head-text {
  min-width: 0;
}

.drawer-title {
  margin: 0;
  overflow: hidden;
  color: var(--drawer-title-text-color);
  font: 13px var(--font-mono);
  font-weight: 400;
  letter-spacing: 0.1em;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.drawer-sub {
  margin: 8px 0 0;
  color: var(--drawer-sub-text-color);
  font: 11px var(--font-mono);
}

.close {
  width: 34px;
  height: 34px;
  flex: none;
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
  margin-top: 4px;
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

.form-target {
  margin: 0 0 10px;
  color: var(--drawer-sub-text-color);
  font: 11px var(--font-mono);
}

.form-target strong {
  color: var(--row-text-color);
  font-weight: 500;
}

.added {
  margin: 0 0 12px;
  color: var(--row-meta-text-color);
  font: 10px/1.6 var(--font-mono);
}

/* 재생 거절 안내 (M3-4). 사용자가 뭔가 해야 하므로 경고 색을 쓴다. */
.play-notice {
  margin: 0 0 12px;
  color: var(--status-warning-text-color);
  font: 11px/1.6 var(--font-mono);
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
