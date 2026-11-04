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
 * 재생은 **요청만** 한다 (M3-2). 큐를 만들거나 플레이어를 부르지 않고,
 * 주입받은 Playback Coordinator 에 플레이리스트·트랙 id 를 넘긴다.
 * 이 컴포넌트는 `playback` store 도 `PlayerAdapter` 도 모른다
 * (`AGENTS.md` 규칙 2, 4).
 *
 * 트랙을 지운 뒤에는 **사실만** 알린다 (M3-5). 재생 중이던 곡이면 멈추는
 * 판단은 코디네이터가 한다.
 *
 * 재생 요청이 거절되면 **여기서** 안내한다 (M3-4). 플레이어의 `.status`
 * 영역은 좁은 화면에서 드로어와 함께 숨으므로, 사용자가 누른 자리에
 * 보여야 한다.
 *
 * 여기서 하지 않는 것: 이전/다음·재생/일시정지 트랜스포트 컨트롤(M3-3),
 * 지금 재생 중인 트랙 강조(M3-3), 오류 상세 안내와 외부 링크 — 그쪽은
 * 플레이어 영역의 책임이다(M3-5).
 */
import { computed, inject, nextTick, ref, watch } from 'vue'

import LibraryStatusBanner from '@/features/library/LibraryStatusBanner.vue'
import PlaylistList from '@/features/library/PlaylistList.vue'
import {
  PLAYBACK_COORDINATOR,
  type PlayRequestFailure,
  type PlayRequestResult,
} from '@/features/playback/playbackCoordinator'
import { parseYouTubeVideoId } from '@/shared/utils/youtube'
import { MAX_TRACK_TITLE_LENGTH, useLibraryStore } from '@/stores/library'

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

const closeButton = ref<HTMLButtonElement | null>(null)

/** 인라인 편집 모드. 레퍼런스의 `prompt()` 를 대체한다. */
type EditMode = { kind: 'none' } | { kind: 'create' } | { kind: 'rename'; id: string }

const edit = ref<EditMode>({ kind: 'none' })
const draftName = ref('')
const formError = ref('')
/** 마지막 동작이 저장되지 않았는지. `persisted: false` 를 알린다. */
const unsavedNotice = ref('')

const canDelete = computed<boolean>(() => library.playlists.length > 1)

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

/**
 * 재생 요청이 거절된 이유 (M3-4).
 *
 * 가장 흔한 경우는 좁은 화면에서 드로어가 스테이지를 **대체**한 상태다.
 * 그때 재생을 시작하면 보이지 않는 플레이어로 소리만 나게 되므로
 * 코디네이터가 거절한다 (개발자 정책 III.I.9).
 */
const playbackNotice = ref('')

const PLAY_REFUSED_MESSAGE: Record<PlayRequestFailure, string> = {
  'player-hidden': '좁은 화면에서는 라이브러리가 영상 자리를 차지합니다. 닫고 ▶ 를 눌러주세요.',
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
    linkError.value =
      result.reason === 'invalid-video-id'
        ? '올바른 YouTube 영상 링크를 입력해주세요.'
        : '해당 플레이리스트를 찾을 수 없습니다.'
    return
  }

  const added = library.getPlaylist(targetId)?.tracks.find((track) => track.id === result.trackId)
  addedNotice.value = `“${added?.title ?? ''}”을 추가했습니다.`
  reportPersisted(result)
  closeLinkForm()
}

/* ---------- 트랙 편집 ---------- */

/** 삭제 확인 중인 트랙. 플레이리스트 삭제와 같은 인라인 확인 패턴이다. */
const pendingTrackId = ref<string | null>(null)

function moveTrack(trackId: string, direction: 'up' | 'down'): void {
  const target = library.selectedPlaylist
  if (target === null) return

  reportResult(library.moveTrack(target.id, trackId, direction))
}

function confirmRemoveTrack(): void {
  const target = library.selectedPlaylist
  const trackId = pendingTrackId.value
  if (target === null || trackId === null) return

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
  pendingTrackId.value = null
}

function resetForm(): void {
  edit.value = { kind: 'none' }
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

/* ---------- 재생 요청 ---------- */

/**
 * 목록 전체 재생.
 *
 * 레퍼런스와 같이 **재생하는 목록을 선택 상태로 맞춘다.** 그래야 아래
 * 트랙 목록이 지금 울리는 곡들을 보여준다. 이미 선택돼 있으면 건드리지
 * 않는다 — 작성 중인 폼을 괜히 닫지 않기 위해서다.
 */
function requestPlayPlaylist(id: string): void {
  if (id !== library.selectedPlaylistId) selectPlaylist(id)
  reportPlayRequest(playback?.playPlaylist(id))
}

/** 지금 선택된 목록을 처음부터 재생한다. */
function requestPlaySelected(): void {
  const current = library.selectedPlaylist
  if (current === null) return

  reportPlayRequest(playback?.playPlaylist(current.id))
}

/**
 * 고른 트랙부터 재생한다.
 *
 * 큐는 **그 트랙 하나가 아니라 목록 전체**다. 코디네이터가 그렇게 만든다.
 */
function requestPlayTrack(trackId: string): void {
  const current = library.selectedPlaylist
  if (current === null) return

  reportPlayRequest(playback?.playTrack(current.id, trackId))
}

/** 선택된 목록을 재생할 수 있는지. 빈 목록은 재생할 수 없다. */
const canPlaySelected = computed<boolean>(() => (library.selectedPlaylist?.tracks.length ?? 0) > 0)

function selectPlaylist(id: string): void {
  // 선택만 바꾼다. 재생 큐는 건드리지 않는다.
  reportResult(library.selectPlaylist(id))
  pendingDeleteId.value = null
  pendingTrackId.value = null
  addedNotice.value = ''
  playbackNotice.value = ''
  resetForm()
  // 선택이 바뀌면 링크 폼을 닫는다. 등록 대상이 모호해지지 않게 한다.
  closeLinkForm()
}

/** 열릴 때 닫기 버튼으로 포커스를 옮긴다. 닫힐 때는 셸이 트리거로 되돌린다. */
watch(
  () => props.open,
  async (isOpen) => {
    if (!isOpen) {
      resetForm()
      closeLinkForm()
      pendingDeleteId.value = null
      pendingTrackId.value = null
      unsavedNotice.value = ''
      addedNotice.value = ''
      playbackNotice.value = ''
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
      <p v-if="addedNotice !== ''" class="added" role="status">{{ addedNotice }}</p>
      <p v-if="playbackNotice !== ''" class="play-notice" role="status" aria-live="polite">
        {{ playbackNotice }}
      </p>

      <div class="drawer-actions">
        <button type="button" class="pill pill--strong" @click="startCreate">＋ 새 목록</button>
        <button
          type="button"
          class="pill"
          :disabled="library.selectedPlaylist === null"
          @click="startAddLink"
        >
          ＋ YouTube 링크 추가
        </button>
      </div>

      <p v-if="library.selectedPlaylist === null" class="muted">
        플레이리스트를 먼저 만들거나 선택하면 링크를 추가할 수 있어요.
      </p>

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
        @play="requestPlayPlaylist"
      />

      <div class="rule" />

      <h3 class="drawer-section-title">
        {{ library.selectedPlaylist?.name ?? 'SELECTED PLAYLIST' }} / TRACKS
      </h3>

      <div class="drawer-actions">
        <button
          type="button"
          class="pill"
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

      <div class="track-list">
        <p v-if="library.selectedPlaylist === null" class="muted">
          플레이리스트를 선택하면 트랙이 보입니다.
        </p>
        <p v-else-if="library.selectedPlaylist.tracks.length === 0" class="muted">
          아직 등록된 영상이 없어요.<br />＋ YouTube 링크 추가를 눌러 시작하세요.
        </p>

        <!-- :key 는 배열 인덱스가 아니라 트랙 id 를 쓴다. -->
        <div
          v-for="(track, index) in library.selectedPlaylist?.tracks ?? []"
          :key="track.id"
          class="track"
        >
          <button
            type="button"
            class="track-play"
            :aria-label="`${track.title} 재생`"
            :title="`${track.title} 재생`"
            @click="requestPlayTrack(track.id)"
          >
            ▶
          </button>
          <span class="track-order">{{ index + 1 }}</span>
          <!-- 잘려도 전체 제목을 title 로 확인할 수 있다. -->
          <span class="track-name" :title="track.title">{{ track.title }}</span>
          <span class="track-id">{{ track.videoId }}</span>

          <span class="track-controls">
            <button
              type="button"
              :aria-label="`${track.title} 위로`"
              :disabled="index === 0"
              @click="moveTrack(track.id, 'up')"
            >
              ↑
            </button>
            <button
              type="button"
              :aria-label="`${track.title} 아래로`"
              :disabled="index === (library.selectedPlaylist?.tracks.length ?? 0) - 1"
              @click="moveTrack(track.id, 'down')"
            >
              ↓
            </button>
            <button
              type="button"
              :aria-label="`${track.title} 삭제`"
              @click="pendingTrackId = track.id"
            >
              ×
            </button>
          </span>
        </div>

        <div
          v-if="pendingTrackId !== null"
          class="confirm"
          role="alertdialog"
          aria-label="트랙 삭제 확인"
        >
          <p class="confirm-text">이 곡을 목록에서 제거할까요?</p>
          <div class="drawer-actions">
            <button type="button" class="pill pill--strong" @click="confirmRemoveTrack">
              삭제
            </button>
            <button type="button" class="pill" @click="pendingTrackId = null">취소</button>
          </div>
        </div>
      </div>
    </div>

    <p class="drawer-foot">
      데크를 눌러 열고, ESC 또는 ×로 닫으세요.<br />
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

/* 승인된 디자인의 `.track-play` 값을 따른다. */
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

/* 좁은 화면에서 영상 ID 를 접어 제목과 버튼을 확보한다. */
@media (max-width: 420px) {
  .track-id {
    display: none;
  }
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
