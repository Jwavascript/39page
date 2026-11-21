<script setup lang="ts">
/**
 * 한 플레이리스트의 트랙 목록 (M2-3, M11-3 에서 행을 다시 짰다, M11-7C 에서 순서 편집을 더했다).
 *
 * 표현만 맡는다. 누름을 이벤트로 올리고, 저장 · 재생은 부모(`PlaylistEditor`)가 한다. 재생 상태도
 * 모른다 — "지금 곡" 은 부모가 prop 으로 알려 준다 (코디네이터의 읽기 전용 보기, ADR 0009).
 *
 * M11-3 에서 바뀐 것 (U4 · U12 · U14 · U16 · U17)
 * - **▶ 재생은 그대로 드러나 있다** — 자주 쓰는 일이다. 44×44.
 * - (ADR 0044) "관리" 메뉴를 없앴다. 이름 바꾸기(연필) · 앨범아트 · 공유 · 삭제(휴지통)가 **행 오른쪽의 아이콘**
 *   이다. 삭제 확인은 그대로 **그 행 바로 아래**에서 받는다. 맨 위로 · 맨 아래로는 손잡이의 Home · End 다.
 * - 긴 제목이 말줄임으로 잘리지 않고 줄을 바꾼다.
 * - 지금 곡은 글("재생 중")과 `aria-current` 로도 알린다 — 색만이 아니다.
 *
 * M11-7C — 트랙 순서 편집 (ADR 0030 · UAT)
 * - **끌기 손잡이(⠿)** — 행 맨 앞. ▶ · 제목과 떨어져 있어 재생을 잘못 누르지 않는다. 마우스 · 펜 · 손가락
 *   모두 포인터 이벤트로 끈다. 손잡이만 `touch-action: none` 이라 목록의 스크롤과 다투지 않는다. 끄는 동안
 *   놓일 자리에 선이 보이고, 놓으면 부모에게 `reorder(trackId, toIndex)` 를 올린다. Esc 로 그만둔다.
 *   마우스가 있는 넓은 화면에서는 늘 보인다. 터치 화면은 **편집** 모드에서만 보인다(스크롤과 헷갈리지 않게).
 * - **키보드** — 손잡이에서 ↑ · ↓ 한 칸, Home · End 맨 위 · 맨 아래. 옮긴 뒤에도 그 곡의 손잡이에 포커스가
 *   남는다. 결과는 부모가 주는 `status` 로 알린다(aria-live).
 * - **순서 모드** — ⇅ 아이콘을 누르면 행마다 손잡이 · ↑ · ↓ 가 드러나고 ▶ · 행 아이콘은 잠시 숨는다. 한 번 더
 *   누르면 돌아온다. 작은 화면의 주 경로다.
 * - 옮기기는 재생을 건드리지 않는다 — 큐는 스냅샷이다 (ADR 0030).
 */
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'

import type { DeepReadonly } from 'vue'

import type { Track } from '@/shared/types'
import { MAX_TRACK_TITLE_LENGTH } from '@/stores/library'

/** 손잡이를 이만큼 움직여야 끌기로 친다 — 누르기만 한 것과 가른다. */
const DRAG_THRESHOLD_PX = 4
/** 스크롤 칸의 위 · 아래 이 거리 안에서 끌면 칸을 굴린다. */
const AUTO_SCROLL_EDGE_PX = 40
const AUTO_SCROLL_STEP_PX = 14
/** 방금 옮긴 행을 잠시 표시한다. */
const MOVED_MS = 1400

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
  /** 순서 바꾸기 결과 — 화면에도 보이고 낭독기에도 알린다 (M11-7C). */
  status?: { readonly text: string; readonly tone: 'info' | 'warning' } | null
  /** 공유 아이콘을 보일지 — 공유 대화상자가 없으면(단독 마운트) `false`. */
  canShare?: boolean
}>()

const emit = defineEmits<{
  play: [trackId: string]
  /** 이 트랙을 목록의 `toIndex` 자리(옮긴 뒤의 자리)로 (M11-7C). */
  reorder: [trackId: string, toIndex: number]
  remove: [trackId: string]
  rename: [trackId: string, title: string]
  moments: [videoId: string]
  /** 이 곡의 앨범아트 설정을 연다 (M12-3) — 보관함이 상세 칸 자리에 설정을 띄운다. */
  artwork: [trackId: string]
  share: [trackId: string]
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
  editing.value = false
  revealedId.value = track.id
  if (revealTimer !== null) clearTimeout(revealTimer)
  revealTimer = setTimeout(() => {
    revealedId.value = null
    revealTimer = null
  }, REVEAL_MS)
  void nextTick(() => {
    const row = rowOf(track.id)
    if (typeof row?.scrollIntoView === 'function') row.scrollIntoView({ block: 'nearest' })
    row?.querySelector<HTMLElement>('.track-play')?.focus()
  })
  return true
}

const hasUnsavedInput = computed(
  () =>
    renamingId.value !== null &&
    draftTitle.value !== props.tracks?.find((track) => track.id === renamingId.value)?.title,
)
defineExpose({ reveal, hasUnsavedInput })

function momentCount(videoId: string): number {
  return props.momentCounts?.get(videoId) ?? 0
}

/** 삭제 확인을 받는 행. */
const pendingTrackId = ref<string | null>(null)

const renamingId = ref<string | null>(null)
const draftTitle = ref('')

const root = ref<HTMLElement | null>(null)

/** 순서 모드 — 손잡이 · 한 칸 옮기기가 행마다 드러난다 (M11-7C, ADR 0044). */
const editing = ref(false)
const editToggle = ref<HTMLButtonElement | null>(null)

const lastIndex = computed<number>(() => (props.tracks?.length ?? 0) - 1)

function rowSelector(trackId: string): string {
  return `.track[data-track-id="${trackId}"]`
}

function rowOf(trackId: string): HTMLElement | null {
  return root.value?.querySelector<HTMLElement>(rowSelector(trackId)) ?? null
}

function isCurrent(track: DeepReadonly<Track>): boolean {
  return props.nowPlayingTrackId !== undefined && props.nowPlayingTrackId === track.id
}

function closeForms(): void {
  pendingTrackId.value = null
  cancelRename()
}

function toggleEditing(): void {
  closeForms()
  editing.value = !editing.value
  // 눌림 상태만 바뀐다 — 포커스는 그대로 둔다.
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

/** 폼을 닫은 뒤 그 행의 연필로 돌아간다 — 폼이 사라진 자리에 포커스가 떨어지지 않게. */
function closeRename(): void {
  const trackId = renamingId.value
  cancelRename()
  if (trackId !== null)
    void nextTick(() =>
      root.value?.querySelector<HTMLElement>(`[data-track-rename="${trackId}"]`)?.focus(),
    )
}

function submitRename(): void {
  const trackId = renamingId.value
  if (trackId === null) return

  emit('rename', trackId, draftTitle.value)
  closeRename()
}

/* ---------- 옮기기 (M11-7C) ---------- */

/** 옮긴 뒤 포커스를 돌려줄 곳 — 같은 곡의 같은 단추. 꺼져 있으면(맨 위에 닿음) 그 곡의 손잡이. */
let refocus: { trackId: string; selector: string } | null = null
const movedId = ref<string | null>(null)
let movedTimer: ReturnType<typeof setTimeout> | null = null

function requestReorder(trackId: string, toIndex: number, focusSelector?: string): void {
  const from = props.tracks?.findIndex((track) => track.id === trackId) ?? -1
  if (from === -1 || toIndex < 0 || toIndex > lastIndex.value || toIndex === from) return
  refocus = { trackId, selector: focusSelector ?? `${rowSelector(trackId)} .track-handle` }
  emit('reorder', trackId, toIndex)
}

watch(
  () => props.tracks?.map((track) => track.id).join('\n') ?? '',
  async (now, before) => {
    const target = refocus
    refocus = null
    if (target === null || now === before) return
    movedId.value = target.trackId
    if (movedTimer !== null) clearTimeout(movedTimer)
    movedTimer = setTimeout(() => {
      movedId.value = null
      movedTimer = null
    }, MOVED_MS)
    await nextTick()
    const row = rowOf(target.trackId)
    const preferred = root.value?.querySelector<HTMLButtonElement>(target.selector)
    const fallback = row?.querySelector<HTMLElement>('.track-handle')
    if (preferred != null && !preferred.disabled) preferred.focus()
    else fallback?.focus()
  },
)

/** 손잡이의 키보드 — ↑ · ↓ 한 칸, Home · End 맨 위 · 맨 아래. */
function onHandleKeydown(event: KeyboardEvent, trackId: string, index: number): void {
  if (event.key === 'Escape' && drag.value !== null) {
    event.preventDefault()
    drag.value = null
    return
  }
  const to =
    event.key === 'ArrowUp'
      ? index - 1
      : event.key === 'ArrowDown'
        ? index + 1
        : event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? lastIndex.value
            : null
  if (to === null) return
  // 페이지 · 목록이 함께 굴러가지 않게 — 경계에서도 막는다.
  event.preventDefault()
  requestReorder(trackId, to)
}

/* 끌기 — 포인터 이벤트 하나로 마우스 · 펜 · 손가락. */
interface DragState {
  readonly trackId: string
  readonly from: number
  readonly to: number
  readonly pointerId: number
  readonly startY: number
  readonly active: boolean
}
const drag = ref<DragState | null>(null)

function onHandlePointerDown(event: PointerEvent, trackId: string, index: number): void {
  if (event.button !== 0 || drag.value !== null) return
  closeForms()
  drag.value = {
    trackId,
    from: index,
    to: index,
    pointerId: event.pointerId,
    startY: event.clientY,
    active: false,
  }
  const handle = event.currentTarget as HTMLElement | null
  if (typeof handle?.setPointerCapture === 'function') {
    try {
      handle.setPointerCapture(event.pointerId)
    } catch {
      // 캡처를 못 해도 손잡이 위에서는 이벤트가 온다.
    }
  }
}

/** 끌고 있는 곡을 뺀 행들의 가운데보다 아래에 있는 수 = 놓일 자리. */
function dropIndexAt(clientY: number, trackId: string): number {
  const rows = [...(root.value?.querySelectorAll<HTMLElement>('.track[data-track-id]') ?? [])]
  let to = 0
  for (const row of rows) {
    if (row.dataset.trackId === trackId) continue
    const rect = row.getBoundingClientRect()
    if (clientY > rect.top + rect.height / 2) to += 1
  }
  return to
}

function scrollParent(): HTMLElement | null {
  let node = root.value?.parentElement ?? null
  while (node !== null) {
    const overflow = getComputedStyle(node).overflowY
    if ((overflow === 'auto' || overflow === 'scroll') && node.scrollHeight > node.clientHeight)
      return node
    node = node.parentElement
  }
  return null
}

function autoScroll(clientY: number): void {
  const parent = scrollParent()
  if (parent === null) return
  const rect = parent.getBoundingClientRect()
  if (clientY < rect.top + AUTO_SCROLL_EDGE_PX) parent.scrollTop -= AUTO_SCROLL_STEP_PX
  else if (clientY > rect.bottom - AUTO_SCROLL_EDGE_PX) parent.scrollTop += AUTO_SCROLL_STEP_PX
}

function onHandlePointerMove(event: PointerEvent): void {
  const state = drag.value
  if (state === null || event.pointerId !== state.pointerId) return
  if (!state.active && Math.abs(event.clientY - state.startY) < DRAG_THRESHOLD_PX) return
  event.preventDefault()
  drag.value = { ...state, active: true, to: dropIndexAt(event.clientY, state.trackId) }
  autoScroll(event.clientY)
}

function onHandlePointerUp(event: PointerEvent): void {
  const state = drag.value
  if (state === null || event.pointerId !== state.pointerId) return
  drag.value = null
  if (state.active && state.to !== state.from) requestReorder(state.trackId, state.to)
}

function onHandlePointerCancel(): void {
  drag.value = null
}

/** 놓일 자리의 선 — 위로 옮기면 그 자리 행의 위, 아래로 옮기면 그 자리 행의 아래. */
function dropMark(index: number): 'before' | 'after' | null {
  const state = drag.value
  if (state === null || !state.active || state.to === state.from || index !== state.to) return null
  return state.to < state.from ? 'before' : 'after'
}

const dragAnnouncement = computed<string>(() => {
  const state = drag.value
  if (state === null || !state.active) return ''
  return `${String(state.to + 1)}번째 자리`
})

/* ---------- 삭제 ---------- */

function requestRemove(trackId: string): void {
  // 이름을 고치는 중에 삭제를 누르면 폼을 닫는다. 두 폼이 겹치지 않게 한다.
  cancelRename()
  pendingTrackId.value = trackId
  void nextTick(() =>
    root.value
      ?.querySelector<HTMLElement>(`[data-track-confirm="${trackId}"] .pill--strong`)
      ?.focus(),
  )
}

function cancelRemove(): void {
  const trackId = pendingTrackId.value
  pendingTrackId.value = null
  // 삭제를 누른 단추로 돌아간다.
  if (trackId !== null)
    void nextTick(() =>
      root.value?.querySelector<HTMLElement>(`[data-track-remove="${trackId}"]`)?.focus(),
    )
}

function confirmRemove(): void {
  const trackId = pendingTrackId.value
  if (trackId === null) return

  // 지운 뒤 포커스는 다음 곡(없으면 앞 곡)으로 — 목록 밖으로 떨어지지 않게.
  const list = props.tracks ?? []
  const index = list.findIndex((track) => track.id === trackId)
  const neighbour = list[index + 1] ?? list[index - 1]
  emit('remove', trackId)
  pendingTrackId.value = null
  void nextTick(() => {
    const row = neighbour === undefined ? null : rowOf(neighbour.id)
    const target =
      row?.querySelector<HTMLElement>(editing.value ? '.track-handle' : '.track-play') ??
      editToggle.value
    target?.focus()
  })
}

onBeforeUnmount(() => {
  if (revealTimer !== null) clearTimeout(revealTimer)
  if (movedTimer !== null) clearTimeout(movedTimer)
})
</script>

<template>
  <div ref="root" class="track-list" :class="{ 'is-editing': editing }">
    <p v-if="tracks === null" class="muted">선택한 목록이 없어요.</p>
    <p v-else-if="tracks.length === 0" class="muted">아직 곡이 없어요.</p>

    <!-- 순서 편집 · 결과 알림 (M11-7C). 알림 영역은 늘 있다 — 비면 자리를 차지하지 않는다. -->
    <div v-if="tracks !== null && tracks.length > 0" class="list-tools">
      <p
        class="move-status"
        :class="{ 'is-warning': status?.tone === 'warning' }"
        role="status"
        aria-live="polite"
      >
        {{ status?.text ?? '' }}
      </p>
      <button
        v-if="tracks.length > 1 || editing"
        ref="editToggle"
        type="button"
        class="icon-button edit-toggle"
        :aria-pressed="editing"
        aria-label="순서 바꾸기"
        title="순서 바꾸기"
        @click="toggleEditing"
      >
        <span class="ui-icon ui-icon--reorder" aria-hidden="true"></span>
      </button>
    </div>
    <p id="track-handle-help" class="sr-only">
      위 · 아래 화살표로 한 칸, Home · End 로 맨 위 · 맨 아래로 옮겨요.
    </p>
    <p class="sr-only" aria-live="polite">{{ dragAnnouncement }}</p>

    <!-- :key 는 배열 인덱스가 아니라 트랙 id 를 쓴다. -->
    <template v-for="(track, index) in tracks ?? []" :key="track.id">
      <div
        class="track"
        :data-track-id="track.id"
        :class="{
          'is-current': isCurrent(track),
          'is-revealed': revealedId === track.id,
          'is-moved': movedId === track.id,
          'is-dragging': drag?.active === true && drag.trackId === track.id,
          'drop-before': dropMark(index) === 'before',
          'drop-after': dropMark(index) === 'after',
        }"
        :aria-current="isCurrent(track) ? 'true' : undefined"
      >
        <button
          type="button"
          class="track-handle"
          :aria-label="`${track.title} 순서 옮기기 (${index + 1}번째)`"
          aria-describedby="track-handle-help"
          :title="`끌어서 순서 바꾸기 · 키보드 ↑ ↓ Home End`"
          @keydown="onHandleKeydown($event, track.id, index)"
          @pointerdown="onHandlePointerDown($event, track.id, index)"
          @pointermove="onHandlePointerMove"
          @pointerup="onHandlePointerUp"
          @pointercancel="onHandlePointerCancel"
          @lostpointercapture="onHandlePointerCancel"
        >
          <span aria-hidden="true">⠿</span>
        </button>
        <button
          v-if="!editing"
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
        <template v-if="!editing">
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
          <!-- 행 아이콘 (ADR 0044) — 자주 쓰는 순서대로, 되돌리기 어려운 삭제는 맨 끝. -->
          <span class="row-icons track-icons" role="group" :aria-label="`${track.title} 동작`">
            <button
              type="button"
              class="icon-button track-rename"
              :data-track-rename="track.id"
              :aria-label="`${track.title} 이름 변경`"
              title="이름 바꾸기"
              :aria-expanded="renamingId === track.id"
              @click="renamingId === track.id ? closeRename() : startRename(track)"
            >
              <span class="ui-icon ui-icon--edit" aria-hidden="true"></span>
            </button>
            <button
              type="button"
              class="icon-button track-artwork"
              :aria-label="`${track.title} 앨범아트 설정`"
              title="앨범아트"
              @click="emit('artwork', track.id)"
            >
              <span class="ui-icon ui-icon--image" aria-hidden="true"></span>
            </button>
            <button
              v-if="canShare !== false"
              type="button"
              class="icon-button track-share"
              :aria-label="`${track.title} 공유`"
              title="공유"
              @click="emit('share', track.id)"
            >
              <span class="ui-icon ui-icon--share" aria-hidden="true"></span>
            </button>
            <button
              type="button"
              class="icon-button icon-button--danger track-remove"
              :data-track-remove="track.id"
              :aria-label="`${track.title} 삭제`"
              title="삭제"
              :aria-expanded="pendingTrackId === track.id"
              @click="requestRemove(track.id)"
            >
              <span class="ui-icon ui-icon--trash" aria-hidden="true"></span>
            </button>
          </span>
        </template>
        <!-- 순서 모드 — 한 칸 위 · 아래. -->
        <span
          v-else
          class="row-icons edit-actions"
          role="group"
          :aria-label="`${track.title} 순서`"
        >
          <button
            type="button"
            class="icon-button edit-up"
            :aria-label="`${track.title} 위로`"
            title="위로"
            :disabled="index === 0"
            @click="requestReorder(track.id, index - 1, `${rowSelector(track.id)} .edit-up`)"
          >
            <span class="ui-icon ui-icon--up" aria-hidden="true"></span>
          </button>
          <button
            type="button"
            class="icon-button edit-down"
            :aria-label="`${track.title} 아래로`"
            title="아래로"
            :disabled="index === lastIndex"
            @click="requestReorder(track.id, index + 1, `${rowSelector(track.id)} .edit-down`)"
          >
            <span class="ui-icon ui-icon--down" aria-hidden="true"></span>
          </button>
        </span>
      </div>

      <!-- 삭제 확인 — 지울 행 **바로 아래**. -->
      <div
        v-if="pendingTrackId === track.id"
        class="confirm"
        role="alertdialog"
        aria-label="트랙 삭제 확인"
        :data-track-confirm="track.id"
      >
        <p class="confirm-text">“{{ track.title }}” 을(를) 이 목록에서 제거할까요?</p>
        <div class="row-actions">
          <button type="button" class="pill pill--strong" @click="confirmRemove">삭제</button>
          <button type="button" class="pill" @click="cancelRemove">취소</button>
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
          <button type="button" class="pill" @click="closeRename">취소</button>
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

/*
 * 좁은 목록(휴대폰)에서는 아이콘 묶음이 제목 아래 줄 오른쪽으로 내려간다 — 제목이 아이콘에 밀려
 * 한두 글자 폭으로 줄지 않게 (ADR 0044).
 */
@container (max-width: 520px) {
  .track-list:not(.is-editing) .track {
    flex-wrap: wrap;
  }

  .track-list:not(.is-editing) .track-icons {
    flex-basis: 100%;
    justify-content: flex-end;
  }
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

  .track-moments:hover {
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

/* ---------- 순서 편집 (M11-7C) ---------- */

.list-tools {
  display: flex;
  min-width: 0;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.move-status {
  min-width: 0;
  flex: 1;
  margin: 0;
  color: var(--status-text-color);
  font: 11px/1.5 var(--font-mono);
}

.move-status.is-warning {
  color: var(--status-warning-text-color);
}

.edit-toggle {
  flex: none;
  margin-left: auto;
}

/*
 * 끌기 손잡이 — ▶ · 제목과 떨어진 행 맨 앞. 손잡이에서만 브라우저의 터치 스크롤을 끈다 — 목록의 나머지는
 * 그대로 스크롤된다.
 */
.track-handle {
  width: 32px;
  min-height: 44px;
  flex: none;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--row-meta-text-color);
  cursor: grab;
  font-size: 15px;
  touch-action: none;
  user-select: none;
}

.track-handle:active {
  cursor: grabbing;
}

/* 터치 화면(마우스 없음)에서는 편집 모드에서만 — 평소 행에서 스크롤과 헷갈리지 않게. */
@media (hover: none), (pointer: coarse) {
  .track-list:not(.is-editing) .track-handle {
    display: none;
  }
}

.track-list.is-editing .track-handle {
  width: 44px;
  font-size: 18px;
}

/* 끄는 중 — 끄는 곡은 흐리게, 놓일 자리에는 굵은 선. */
.track.is-dragging {
  opacity: 0.45;
}

.track.drop-before {
  box-shadow: 0 -3px 0 0 var(--accent-strong-color);
}

.track.drop-after {
  box-shadow: 0 3px 0 0 var(--accent-strong-color);
}

/* 방금 옮긴 곡 — 잠시. */
.track.is-moved {
  border-color: var(--accent-strong-color);
}

.sr-only {
  position: absolute;
  overflow: hidden;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  clip-path: inset(50%);
  white-space: nowrap;
}
</style>
