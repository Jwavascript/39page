<script setup lang="ts">
/**
 * 고른 플레이리스트의 편집 표면 — 보관함 "음악" 탭의 본문 (M11-2, ADR 0027).
 *
 * M6-5 부터 M10 까지는 이 내용이 오른쪽 오버레이 드로어(`RecordLibraryDrawer`)였다. M11-2 에서
 * 드로어의 틀(머리말 · 닫기 · 바닥 안내)은 통합 보관함(`ArchivePanel`)으로 올라갔고, 이 컴포넌트는
 * **한 플레이리스트를 고치는 일**만 남았다. 위계는 그대로다 (보고 6a·6b).
 *
 *   보관함 위쪽 목록   플레이리스트를 만들고 고른다
 *   이 컴포넌트        고른 목록의 머리말에서 이름을 바꾸고 지운다
 *                      트랙 목록 **바로 위**에서 트랙을 추가한다
 *
 * JSON 백업은 **여기서 빠졌다** — 한 목록의 기능이 아니라 앱 전체 데이터 관리이므로 헤더의
 * "데이터" 대화상자로 옮겼다 (ADR 0027 결정 7, `BackupPanel` 은 그대로).
 *
 * 재생은 **요청만** 한다 (M3-2). 큐를 만들거나 플레이어를 부르지 않고, 주입받은 Playback
 * Coordinator 에 id 를 넘긴다 (`AGENTS.md` 규칙 2, 4). 트랙을 지운 뒤에는 **사실만** 알린다 (M3-5).
 *
 * 가시성 때문에 거절된 경우도 **여기서 말한다** (M7-1) — 사용자가 보고 있는 곳에 있어야 읽힌다.
 */
import { computed, inject, nextTick, ref, watch } from 'vue'

import { ARCHIVE } from '@/features/archive/archiveController'

import LibraryStatusBanner from '@/features/library/LibraryStatusBanner.vue'
import { useTitleLookup } from '@/features/library/useTitleLookup'
import TrackList from '@/features/library/TrackList.vue'
import {
  PLAYBACK_COORDINATOR,
  PLAY_REFUSED_HIDDEN_MESSAGE,
  type PlayRequestFailure,
  type PlayRequestResult,
} from '@/features/playback/playbackCoordinator'
import { parseYouTubeVideoId } from '@/shared/utils/youtube'
import { useMomentsStore } from '@/stores/moments'
import { LIBRARY_BUSY_MESSAGE, LIBRARY_CONFLICT_MESSAGE } from '@/features/library/libraryFeedback'
import {
  MAX_PLAYLIST_NAME_LENGTH,
  MAX_TRACK_TITLE_LENGTH,
  useLibraryStore,
  type LibraryMutationResult,
} from '@/stores/library'

/**
 * 보관함이 열려 있는지. 닫히면 쓰던 양식 · 안내를 비운다. Moments 탭을 잠깐 보고 와도 쓰던 링크는
 * 남는다 — 탭 전환은 닫기가 아니다.
 */
const props = defineProps<{ active: boolean }>()

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
const archive = inject(ARCHIVE, null)

/** 이름 변경 폼이 열려 있는 대상. 열릴 때 정한 id 를 끝까지 쓴다. */
const renamingId = ref<string | null>(null)
const draftName = ref('')
const formError = ref('')
/**
 * 양식(이름 · 링크 · 삭제 확인)이 저장을 기다리는 중 (M10-3 안정화, ADR 0025).
 * 저장은 탭 간 잠금 안에서 끝나므로 잠깐 걸린다 — 그동안 다시 제출해 두 번
 * 반영되지 않게 하고, 성공 안내는 저장이 끝난 뒤에만 쓴다.
 */
const isSaving = ref(false)
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

/**
 * 제목 칸 미리 채우기 (ADR 0029) — 링크를 넣고 제목 칸이 비어 있고 손대지 않았을 때만 YouTube oEmbed 로
 * 제목을 받아 **칸만** 채운다. 사용자가 쓴 제목을 덮지 않고, 추가는 조회를 기다리지 않는다.
 */
const titleLookup = useTitleLookup(draftUrl, draftTitle)

/** 재생 요청이 거절된 이유 (M3-4). */
const playbackNotice = ref('')

/**
 * 거절 사유별 안내.
 *
 * `player-hidden` 문구는 `NowPlaylistWidget` · `useDeckTransport` 와 **공유한다**
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
  titleLookup.reset()
  linkTargetId.value = null
  draftUrl.value = ''
  draftTitle.value = ''
  linkError.value = ''
}

async function startAddLink(): Promise<void> {
  const current = library.selectedPlaylist
  if (current === null) return

  resetForm()
  titleLookup.reset()
  linkTargetId.value = current.id
  draftUrl.value = ''
  draftTitle.value = ''
  linkError.value = ''
  addedNotice.value = ''
  // 링크 입력란으로 바로 간다 — 새 목록을 만든 뒤에도 같은 길이다 (M11 U15).
  await nextTick()
  document.getElementById('track-url')?.focus()
}

/** 곡 줄 — "Moments 에서 목록으로" 가 그 곡을 보이게 할 때 쓴다 (M11-4). */
const trackList = ref<InstanceType<typeof TrackList> | null>(null)

/** 고른 목록에서 그 영상의 곡 줄을 보이고 그 줄로 포커스를 옮긴다. 없으면 `false`. */
function revealVideo(videoId: string): boolean {
  return trackList.value?.reveal(videoId) ?? false
}

defineExpose({ startAddLink, revealVideo })

/**
 * 영상별 Moment 수 — 곡 줄의 `◆ N` 배지 (M11-4 §5-4). 라이브러리는 Moments 를 모르고(ADR 0019),
 * 이 화면이 두 store 를 **읽기만** 해서 잇는다. Moments 를 고치지 않는다.
 */
const moments = useMomentsStore()
const momentCounts = computed<Map<string, number>>(() => {
  const counts = new Map<string, number>()
  for (const moment of moments.moments) {
    counts.set(moment.videoId, (counts.get(moment.videoId) ?? 0) + 1)
  }
  return counts
})

function openMoments(videoId: string): void {
  archive?.open('moments', { videoId })
}

async function submitLink(): Promise<void> {
  const targetId = linkTargetId.value
  if (targetId === null || isSaving.value) return

  const parsed = parseYouTubeVideoId(draftUrl.value)
  if (!parsed.ok) {
    // 실패해도 입력값을 지우지 않는다. 사용자가 고쳐 쓸 수 있어야 한다.
    linkError.value = '올바른 YouTube 영상 링크를 입력해주세요.'
    return
  }

  const result = await saving(
    library.addTrack(targetId, {
      videoId: parsed.videoId,
      title: draftTitle.value,
    }),
  )

  if (!result.ok) {
    // 실패해도 입력값을 지우지 않는다 — 충돌이면 최신 목록을 보고 그대로 다시 누를 수 있다.
    linkError.value =
      result.reason === 'invalid-video-id'
        ? '올바른 YouTube 영상 링크를 입력해주세요.'
        : result.reason === 'conflict'
          ? LIBRARY_CONFLICT_MESSAGE
          : result.reason === 'busy'
            ? LIBRARY_BUSY_MESSAGE
            : '해당 플레이리스트를 찾을 수 없습니다.'
    return
  }

  const added = library.getPlaylist(targetId)?.tracks.find((track) => track.id === result.trackId)
  addedNotice.value = `“${added?.title ?? ''}”을 추가했습니다. 다음 링크를 이어서 넣을 수 있어요.`
  reportPersisted(result)
  /*
   * 양식을 닫지 않는다 (M11-3 E) — 링크를 여러 개 넣을 때마다 "링크 추가" 를 다시 누르지 않게. 입력만
   * 비우고 링크 칸으로 돌아간다. 다 넣었으면 "닫기".
   */
  draftUrl.value = ''
  draftTitle.value = ''
  linkError.value = ''
  // 늦게 오는 조회가 다음 링크의 칸을 채우지 않게 — 조회도 처음 상태로.
  titleLookup.reset()
  await nextTick()
  document.getElementById('track-url')?.focus()
}

/** 지금 곡 — 코디네이터 계약의 읽기 전용 보기 (ADR 0009). playback store 를 보지 않는다. */
const nowPlayingTrackId = computed<string | null>(() => playback?.nowPlaying.value?.trackId ?? null)
const nowPlayingActive = computed<boolean>(() => playback?.nowPlaying.value?.playing ?? false)

/* ---------- 트랙 편집 ---------- */

async function moveTrack(trackId: string, direction: 'up' | 'down'): Promise<void> {
  const target = library.selectedPlaylist
  if (target === null) return

  reportResult(await library.moveTrack(target.id, trackId, direction))
}

/** 트랙 이름 변경 (M6-5, 보고 6c). 확인은 `TrackList` 가 받는다. */
async function renameTrack(trackId: string, title: string): Promise<void> {
  const target = library.selectedPlaylist
  if (target === null) return

  reportResult(await library.renameTrack(target.id, trackId, title))
}

async function removeTrack(trackId: string): Promise<void> {
  const target = library.selectedPlaylist
  if (target === null) return

  // 지워진 것이 확인된 뒤에만 재생 쪽에 알린다 — 거절됐으면 곡은 그대로 있다.
  if (reportResult(await library.removeTrack(target.id, trackId))) {
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
  busy: LIBRARY_BUSY_MESSAGE,
}

/** 양식의 저장을 기다린다. 기다리는 동안 `isSaving` 이 켜진다. */
async function saving(pending: Promise<LibraryMutationResult>): Promise<LibraryMutationResult> {
  isSaving.value = true
  try {
    return await pending
  } finally {
    isSaving.value = false
  }
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

async function submitForm(): Promise<void> {
  const id = renamingId.value
  if (id === null || isSaving.value) return

  if (reportResult(await saving(library.renamePlaylist(id, draftName.value)))) resetForm()
}

/** 삭제 확인. `confirm()` 대신 인라인으로 받는다. */
const pendingDeleteId = ref<string | null>(null)

function requestDelete(): void {
  const current = library.selectedPlaylist
  if (current === null || !canDelete.value) return
  pendingDeleteId.value = current.id
}

async function confirmDelete(): Promise<void> {
  const id = pendingDeleteId.value
  if (id === null || isSaving.value) return

  reportResult(await saving(library.deletePlaylist(id)))
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
  await archive?.stepAside()

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
 * 선택을 바꾸는 곳이 이제 **이 컴포넌트 밖**(보관함의 목록 칸 · `NowPlaylistWidget`)이다. 머리말은
 * 새 목록을 가리키는데 폼이 옛 목록을 겨냥한 채 열려 있으면 사용자가 어디에
 * 쓰는지 알 수 없다. `createPlaylist` 도 선택을 옮기므로 새 목록을 만들 때도
 * 함께 닫힌다.
 */
watch(() => library.selectedPlaylistId, clearTransientState)

/** 보관함이 닫히면 쓰던 양식 · 일시 안내를 비운다. 포커스는 보관함이 맡는다. */
watch(
  () => props.active,
  (isActive) => {
    if (isActive) return
    clearTransientState()
    unsavedNotice.value = ''
  },
)
</script>

<template>
  <section class="playlist-editor" aria-labelledby="playlist-editor-title">
    <div class="editor-head">
      <!--
        머리말이 **무엇을 편집하는지** 말한다. `이름 수정` 이 이 아래에 있으므로 무엇의 이름인지
        자명하다 (보고 6b).
      -->
      <h3 id="playlist-editor-title" class="drawer-title">
        {{ library.selectedPlaylist?.name ?? '플레이리스트' }}
      </h3>
      <p class="drawer-sub">
        {{ library.selectedPlaylist === null ? '선택한 목록 없음' : `${trackCount} TRACKS` }} /
        YOUTUBE ONLY
      </p>
    </div>

    <div class="editor-body">
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
          <button type="submit" class="pill pill--strong" :disabled="isSaving">저장</button>
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
          <button
            type="button"
            class="pill pill--strong"
            :disabled="isSaving"
            @click="confirmDelete"
          >
            삭제
          </button>
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
          placeholder="비워 두면 YouTube 에서 제목을 찾아 채워요"
          aria-describedby="track-title-status"
          @input="titleLookup.markEdited()"
        />
        <p
          id="track-title-status"
          class="title-status"
          :class="{ 'is-failed': titleLookup.status.value === 'failed' }"
          role="status"
          aria-live="polite"
        >
          {{ titleLookup.message.value }}
        </p>

        <p id="track-url-error" class="error-msg">{{ linkError }}</p>

        <div class="drawer-actions">
          <button type="submit" class="pill pill--strong" :disabled="isSaving">
            이 목록에 추가
          </button>
          <button type="button" class="pill" @click="closeLinkForm">닫기</button>
        </div>
      </form>

      <TrackList
        ref="trackList"
        :moment-counts="momentCounts"
        :now-playing-track-id="nowPlayingTrackId"
        :now-playing-active="nowPlayingActive"
        :tracks="library.selectedPlaylist === null ? null : library.selectedPlaylist.tracks"
        @play="requestPlayTrack"
        @move="moveTrack"
        @remove="removeTrack"
        @rename="renameTrack"
        @moments="openMoments"
      />
    </div>
  </section>
</template>

<style scoped>
/* 제목 미리 채우기 안내 — 제목 칸 바로 아래 한 줄 (ADR 0029). */
.title-status {
  margin: -4px 0 8px;
  color: var(--drawer-sub-text-color);
  font: 11px/1.5 var(--font-mono);
}

.title-status:empty {
  display: none;
}

.title-status.is-failed {
  color: var(--status-warning-text-color);
}

.playlist-editor {
  min-width: 0;
}

.editor-head {
  min-width: 0;
  padding-bottom: 12px;
  margin-bottom: 14px;
  border-bottom: 1px solid var(--drawer-head-border-color);
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
.drawer-title {
  margin: 0;
  overflow: hidden;
  color: var(--drawer-title-text-color);
  font: 13px var(--font-mono);
  font-weight: 400;
  letter-spacing: 0.1em;
  overflow-wrap: anywhere;
}

.drawer-sub {
  margin: 8px 0 0;
  color: var(--drawer-sub-text-color);
  font: 11px var(--font-mono);
}

.editor-body {
  min-width: 0;
}

/* 승인된 디자인의 `.pill` 값을 따른다. */
.pill {
  /* 터치 목표 44px (M11 U16). */
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
</style>
