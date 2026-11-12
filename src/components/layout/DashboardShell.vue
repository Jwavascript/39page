<script setup lang="ts">
/**
 * 대시보드 전체 화면 구조.
 *
 * 책임: 셸 여백 · 최대 폭, 헤더 통합, 워크스페이스 영역, **통합 보관함과 데이터 대화상자의 자리**.
 * 위젯을 직접 알지 않는다 — 레이아웃을 받아 `WidgetHost` 에 넘길 뿐이다.
 *
 * 테마를 참조하지 않는다. 외형은 CSS 토큰이 결정하므로 두 테마가 **같은** 셸 인스턴스를 공유한다
 * (`docs/decisions/0001-theme-switching-mechanism.md`).
 *
 * ## M11-2 — 통합 보관함 (ADR 0027 C안)
 *
 * M2 ~ M10 의 오른쪽 드로어(한 플레이리스트 편집)가 **보관함**(음악 · Moments 두 탭)이 됐다. 헤더에
 * 이름 있는 입구 셋(음악 · Moments · 데이터)을 둔다.
 *
 * **보관함은 플레이어를 가리지 않는다 — 레이아웃이 그것을 보장한다.** 가시성 측정은 다른 요소에
 * 덮인 것을 감지하지 못하므로(`playerVisibility.ts`), 덮을 수 있는 배치를 만들지 않는다.
 *
 * | 배치          | 조건                            | 플레이어와의 관계                                                  |
 * | ------------- | ------------------------------- | ------------------------------------------------------------------ |
 * | 나란히 (split) | 넓은 화면                       | 워크스페이스 그리드가 [플레이어 | 보관함] 두 열이 된다. 겹침 없음   |
 * | 쌓기 (stack)  | 세로 화면 · 폭 900px 이하       | 영상이 화면 위에 오게 스크롤하고, 보관함 시트는 **영상 아래**에서 시작 |
 * | 옆 (side)     | 낮은 가로 화면 (높이 560px 이하) | 영상이 화면 위에 오게 스크롤하고, 보관함은 **영상 오른쪽**에서 시작   |
 *
 * 두 배치 모두 **CSS 로만** 다른 위젯을 접는다(`display: none`, 마운트 유지). 플레이어의 DOM 부모 ·
 * 순서 · 인스턴스는 바뀌지 않는다 (ADR 0002). 쌓기에서는 시트가 덮는 높이를 재생 쪽에 알린다
 * (`setBottomObstruction`) — 시트가 영상 아래에서 시작하므로 영상은 덮이지 않고, 측정도 그렇게 본다.
 *
 * M7 에서 "플레이어를 sticky 로 시트 위에 붙이기" 를 시도했다가 되돌린 적이 있다 (짧은 화면에서 남는
 * 띠가 플레이어보다 얇았다). 쌓기 배치는 sticky 를 쓰지 않는다: 영상을 화면 위로 스크롤한 뒤 그
 * **실제 아래 끝**(`getBoundingClientRect`)에 시트를 맞추고, 열려 있는 동안 페이지 스크롤을 잠근다.
 */
import { computed, inject, nextTick, onBeforeUnmount, onMounted, provide, readonly, ref } from 'vue'

import AppFooter from '@/components/layout/AppFooter.vue'
import AppHeader from '@/components/layout/AppHeader.vue'
import AppNav from '@/components/layout/AppNav.vue'
import WidgetHost from '@/components/layout/WidgetHost.vue'
import ArchivePanel from '@/features/archive/ArchivePanel.vue'
import {
  ARCHIVE,
  type ArchiveController,
  type ArchiveOpenOptions,
  type ArchiveTab,
} from '@/features/archive/archiveController'
import DataDialog from '@/features/backup/DataDialog.vue'
import { PLAYBACK_COORDINATOR } from '@/features/playback/playbackCoordinator'
import type { DashboardLayout } from '@/shared/types'

defineProps<{
  brand: string
  layout: DashboardLayout
}>()

/* ------------------------------------------------------------------ *
 * 통합 보관함
 * ------------------------------------------------------------------ */

const ARCHIVE_ID = 'archive-panel'
const isArchiveOpen = ref(false)
const archiveTab = ref<ArchiveTab>('music')

/**
 * 보관함의 배치. 열 때 · 창 크기 · 방향이 바뀔 때 다시 정한다.
 *
 * - `split` — 넓은 화면: 워크스페이스 그리드가 [플레이어 | 보관함] 두 열.
 * - `stack` — 세로 화면: 영상을 화면 위로 올리고, 시트가 영상 **아래**에서 시작한다.
 * - `side`  — 낮은 가로 화면(폰 가로): 영상을 화면 위로 올리고, 보관함이 영상 **오른쪽**에서 화면
 *   높이 전체를 쓴다. 나란히 배치로는 영상 위의 제목 줄 때문에 영상 아래쪽이 화면 밖으로 밀렸다
 *   (667×375 실측에서 200px 중 165px 만 보임 — M11-2 실제 Chromium 측정).
 */
type ArchiveLayout = 'split' | 'stack' | 'side'
const layoutMode = ref<ArchiveLayout>('split')
const isStacked = computed<boolean>(() => layoutMode.value === 'stack')
/** 쌓기 배치에서 시트의 위쪽 끝 (뷰포트 기준 px). 영상의 실제 아래 끝 + 여백. */
const sheetTop = ref<number | null>(null)
/** 옆 배치에서 보관함의 왼쪽 끝 (뷰포트 기준 px). 영상의 실제 오른쪽 끝 + 여백. */
const sheetLeft = ref<number | null>(null)

/** 닫을 때 포커스를 되돌릴 버튼. */
let archiveTrigger: HTMLElement | null = null

/**
 * 재생 쪽에 가림 높이를 알리는 통로 (M7-1). **계약 파일만** 가져온다. 주입되지 않으면 알리지 않는다
 * — 셸을 단독으로 마운트하는 시험을 위한 기본값이다.
 */
const playback = inject(PLAYBACK_COORDINATOR, null)

/**
 * 쌓기 배치의 조건. 세로 화면이고 폭이 900px 이하 — 폰 세로 · 태블릿 세로. 가로 화면은 높이가 낮아
 * 영상 아래에 시트를 둘 자리가 없으므로(예: 740×360) 나란히 배치를 쓴다.
 */
const STACK_QUERY = '(max-width: 900px) and (orientation: portrait)'
/** 옆 배치의 조건 — 가로이고 높이가 낮다 (폰 가로). 영상 위 제목 줄까지 한 화면에 담을 수 없다. */
const SIDE_QUERY = '(max-height: 560px) and (orientation: landscape)'
/** 영상과 시트 사이 · 화면 위와 영상 사이의 여백. */
const SHEET_GAP_PX = 8

function matches(query: string): boolean {
  // jsdom 에는 matchMedia 가 없다. 없으면 나란히 배치로 본다.
  return typeof window.matchMedia === 'function' && window.matchMedia(query).matches
}

/** 영상 상자. 쌓기 배치에서 시트를 이 아래 끝에 맞춘다 (CSS 부모가 아니라 실제 상자를 잰다). */
function videoHolder(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-widget="player"] .video-holder')
}

function lockPageScroll(locked: boolean): void {
  document.documentElement.style.overflow = locked ? 'hidden' : ''
}

/** 시트가 뷰포트 아래를 덮은 높이를 알린다. 쌓기 배치가 아니면 덮는 것이 없다. */
function reportObstruction(): void {
  if (playback === null) return
  const covered =
    isArchiveOpen.value && isStacked.value && sheetTop.value !== null
      ? Math.max(0, window.innerHeight - sheetTop.value)
      : 0
  playback.setBottomObstruction(covered)
}

/**
 * 보관함의 배치를 정한다. 그려진 **뒤에** 불러야 한다 — 같은 틱에 재면 아직 이전 배치를 읽는다.
 */
async function placeArchive(): Promise<void> {
  if (!isArchiveOpen.value) return
  layoutMode.value = matches(STACK_QUERY) ? 'stack' : matches(SIDE_QUERY) ? 'side' : 'split'
  sheetTop.value = null
  sheetLeft.value = null
  await nextTick()

  const holder = videoHolder()

  if (layoutMode.value === 'split') {
    lockPageScroll(false)
    // 플레이어가 화면 밖에 걸쳐 있으면 보이게 한다. 이미 보이면 움직이지 않는다.
    if (typeof holder?.scrollIntoView === 'function') holder.scrollIntoView({ block: 'nearest' })
    reportObstruction()
    return
  }

  if (holder !== null) {
    // 영상의 위 끝이 화면 위에서 여백만큼 아래에 오게 한다. 잠그기 전에 옮긴다.
    // (jsdom 에는 스크롤이 없다 — 있을 때만 옮기고, 시트 위치는 어느 쪽이든 실제 상자로 잰다.)
    lockPageScroll(false)
    if (typeof holder.scrollIntoView === 'function') {
      holder.scrollIntoView({ block: 'start' })
      window.scrollBy(0, -SHEET_GAP_PX)
    }
    const box = holder.getBoundingClientRect()
    if (layoutMode.value === 'stack') sheetTop.value = Math.ceil(box.bottom + SHEET_GAP_PX)
    else sheetLeft.value = Math.ceil(box.right + SHEET_GAP_PX)
  }
  lockPageScroll(true)
  reportObstruction()
}

/** "링크 추가로 바로" 요청 — 숫자가 바뀔 때마다 보관함이 한 번 링크 입력을 연다. */
const addLinkRequest = ref(0)
/** "이 영상의 Moments 만" · "음악 탭의 그 곡" 요청 (M11-4). `seq` 가 바뀔 때마다 한 번 적용된다. */
const momentsFocusRequest = ref<{ videoId: string; seq: number } | null>(null)
const revealRequest = ref<{ videoId: string; seq: number } | null>(null)
let requestSeq = 0

function openArchive(tab?: ArchiveTab, options: ArchiveOpenOptions = {}): void {
  if (tab !== undefined) archiveTab.value = tab
  if (options.addLink === true) {
    archiveTab.value = 'music'
    addLinkRequest.value += 1
  }
  if (options.videoId !== undefined) {
    archiveTab.value = 'moments'
    requestSeq += 1
    momentsFocusRequest.value = { videoId: options.videoId, seq: requestSeq }
  }
  if (options.revealVideoId !== undefined) {
    archiveTab.value = 'music'
    requestSeq += 1
    revealRequest.value = { videoId: options.revealVideoId, seq: requestSeq }
  }
  if (isArchiveOpen.value) return

  const active = document.activeElement
  archiveTrigger = active instanceof HTMLElement ? active : null
  isArchiveOpen.value = true
  void placeArchive()
}

async function closeArchive(): Promise<void> {
  if (!isArchiveOpen.value) return

  isArchiveOpen.value = false
  layoutMode.value = 'split'
  sheetTop.value = null
  sheetLeft.value = null
  lockPageScroll(false)
  await nextTick()
  reportObstruction()
  // 연 버튼이 아직 화면에 있으면 포커스를 되돌린다.
  if (archiveTrigger !== null && document.contains(archiveTrigger)) archiveTrigger.focus()
  archiveTrigger = null
}

/** 헤더 입구: 같은 탭이 열려 있으면 닫고, 아니면 그 탭으로 연다. */
function toggleArchive(tab: ArchiveTab): void {
  if (isArchiveOpen.value && archiveTab.value === tab) {
    void closeArchive()
    return
  }
  openArchive(tab)
}

/**
 * 재생 전에 비켜준다 (M7-2 계약). M11 의 배치는 플레이어를 덮지 않으므로 대개 할 일이 없다 —
 * 그래도 **덮고 있다고 측정되면** 닫는다. 숫자로 판단하지 않고 사실(가림 높이)로 판단한다.
 */
async function stepAside(): Promise<void> {
  if (!isArchiveOpen.value || layoutMode.value === 'split') return
  const holder = videoHolder()
  if (holder === null) return
  const box = holder.getBoundingClientRect()
  const coveredBelow = sheetTop.value !== null && box.bottom > sheetTop.value
  const coveredRight = sheetLeft.value !== null && box.right > sheetLeft.value
  if (coveredBelow || coveredRight) await closeArchive()
}

const archive: ArchiveController = {
  isOpen: readonly(isArchiveOpen),
  tab: readonly(archiveTab),
  panelId: ARCHIVE_ID,
  open: openArchive,
  close: () => void closeArchive(),
  stepAside,
}
provide(ARCHIVE, archive)

/* ------------------------------------------------------------------ *
 * 데이터 대화상자
 * ------------------------------------------------------------------ */

const DATA_DIALOG_ID = 'data-dialog'
const isDataOpen = ref(false)
let dataTrigger: HTMLElement | null = null

function openData(): void {
  const active = document.activeElement
  dataTrigger = active instanceof HTMLElement ? active : null
  isDataOpen.value = true
}

async function closeData(): Promise<void> {
  if (!isDataOpen.value) return
  isDataOpen.value = false
  await nextTick()
  if (dataTrigger !== null && document.contains(dataTrigger)) dataTrigger.focus()
  dataTrigger = null
}

/**
 * Escape 는 **가장 바깥 것부터** 닫는다 — 데이터 대화상자 → 보관함. 한 번에 둘을 닫으면 사용자가
 * 무엇을 닫았는지 알 수 없다. (M7 의 플레이리스트 선반은 M11-3 에서 없어졌다 — 데크가 보관함을 연다.)
 */
function onKeydown(event: KeyboardEvent): void {
  // 안쪽이 Esc 를 이미 썼으면(검색어 지우기 등) 닫지 않는다.
  if (event.key !== 'Escape' || event.defaultPrevented) return

  if (isDataOpen.value) {
    void closeData()
    return
  }
  if (isArchiveOpen.value) void closeArchive()
}

/** 창 크기 · 방향이 바뀌면 배치를 다시 정한다 (세로 ↔ 가로). */
function onResize(): void {
  if (isArchiveOpen.value) void placeArchive()
  else reportObstruction()
}

onMounted(() => {
  document.addEventListener('keydown', onKeydown)
  window.addEventListener('resize', onResize, { passive: true })
})

onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKeydown)
  window.removeEventListener('resize', onResize)
  lockPageScroll(false)
  // 셸이 사라지면 가리는 것도 없다. 멈춘 이유를 남겨두지 않는다.
  playback?.setBottomObstruction(0)
})

const workspaceClass = computed(() => ({
  'is-archive-open': isArchiveOpen.value,
  'is-stacked': isArchiveOpen.value && layoutMode.value === 'stack',
  'is-side': isArchiveOpen.value && layoutMode.value === 'side',
}))

const workspaceStyle = computed(() => {
  const style: Record<string, string> = {}
  if (sheetTop.value !== null) style['--archive-sheet-top'] = `${String(sheetTop.value)}px`
  if (sheetLeft.value !== null) style['--archive-sheet-left'] = `${String(sheetLeft.value)}px`
  return Object.keys(style).length === 0 ? undefined : style
})

/** 대화상자가 열려 있는 동안 뒤쪽을 조작할 수 없게 한다 (보조기기 포함). */
const behindDialog = computed(() => (isDataOpen.value ? true : undefined))
</script>

<template>
  <div class="dashboard-shell">
    <AppHeader :brand="brand" :inert="behindDialog">
      <template #actions>
        <AppNav
          :archive-id="ARCHIVE_ID"
          :archive-open="isArchiveOpen"
          :archive-tab="archiveTab"
          :data-dialog-id="DATA_DIALOG_ID"
          :data-open="isDataOpen"
          @archive="toggleArchive"
          @data="openData"
        />
        <slot name="header-actions" />
      </template>
    </AppHeader>

    <!--
      보관함은 WidgetHost 의 **형제**다. 열고 닫아도 WidgetHost 와 그 안의 PlayerSurface 는 같은
      부모에 그대로 있다. v-if 를 쓰지 않는다 (ADR 0002).
    -->
    <div class="workspace" :class="workspaceClass" :style="workspaceStyle" :inert="behindDialog">
      <WidgetHost :layout="layout" />
      <ArchivePanel
        :open="isArchiveOpen"
        :tab="archiveTab"
        :panel-id="ARCHIVE_ID"
        :add-link-request="addLinkRequest"
        :moments-focus-request="momentsFocusRequest"
        :reveal-request="revealRequest"
        @close="closeArchive"
        @select-tab="(tab) => (archiveTab = tab)"
      />
    </div>

    <!--
      승인된 디자인의 `.footer`. 테마 문구를 쓰므로 별도 컴포넌트다 — 이 셸은 테마를 모르는 상태로
      남아야 한다 (ADR 0001).
    -->
    <AppFooter :inert="behindDialog" />

    <DataDialog :open="isDataOpen" :dialog-id="DATA_DIALOG_ID" @close="closeData" />
  </div>
</template>

<style scoped>
/* 승인된 디자인의 .shell 값을 따른다. */
.dashboard-shell {
  max-width: var(--size-shell-max-width);
  margin: auto;
  padding: 22px clamp(12px, 3vw, 46px) 44px;
}

/* 승인된 디자인의 .workspace 값을 따른다. 복합 배경을 그대로 쓴다. */
.workspace {
  display: grid;
  min-height: var(--size-workspace-min-height);
  margin-top: clamp(23px, 2.6vw, 39px);
  padding: clamp(18px, 2.6vw, 36px);
  border: 1px solid var(--workspace-border-color);
  background: var(--workspace-background);
  grid-template-columns: minmax(0, 1fr);
  /* 내부 요소가 워크스페이스 밖으로 넘치지 않게 한다. */
  overflow: hidden;
  isolation: isolate;
}

/*
 * 보관함이 열리면 — **나란히** 배치 (기본).
 *
 * 워크스페이스가 [플레이어 | 보관함] 두 열이 된다. 플레이어 열의 최소값 360px 은 `WidgetHost` 의
 * 그것과 같은 근거다: `.video-holder` 가 min-height 202px 과 16:9 를 함께 가지므로 그 아래에서는
 * 16:9 를 지킬 수 없다.
 */
.workspace.is-archive-open {
  align-items: start;
  column-gap: clamp(16px, 2vw, 32px);
  grid-template-columns: minmax(360px, 0.9fr) minmax(0, 1.1fr);
}

/*
 * 보관함이 열린 동안 위젯 호스트는 **플레이어 하나**만 보인다. 나머지 위젯은 `display: none` 이지만
 * 마운트된 채다 — 닫으면 그대로 돌아온다. 플레이어 노드는 움직이지 않는다 (ADR 0002).
 */
.workspace.is-archive-open > :deep(.widget-host) {
  grid-template-areas: 'player';
  grid-template-columns: minmax(0, 1fr);
  grid-template-rows: auto;
}

.workspace.is-archive-open > :deep(.widget-host > :not([data-widget='player'])),
.workspace.is-archive-open > :deep(.widget-host::before) {
  display: none;
}

/* 보관함은 화면 높이 안에서 끝나고, 스크롤은 그 안에서만 한다. */
.workspace.is-archive-open > .archive {
  height: min(calc(100dvh - 32px), 900px);
}

/*
 * **쌓기** 배치 — 세로 화면.
 *
 * 영상을 화면 위로 스크롤한 뒤(셸의 `placeArchive`) 시트를 영상의 실제 아래 끝에 맞춘다
 * (`--archive-sheet-top`). 아래 여백을 화면 높이만큼 주는 것은, 페이지가 짧아도 영상을 화면 위까지
 * 올릴 수 있게 하기 위해서다. 열린 동안 페이지 스크롤은 잠기고 스크롤은 보관함 안에서만 한다.
 */
.workspace.is-archive-open.is-stacked {
  position: relative;
  /* 시트가 푸터보다 위에 그려지도록 워크스페이스를 올린다. */
  z-index: 2;
  padding-bottom: 100dvh;
  grid-template-columns: minmax(0, 1fr);
}

.workspace.is-archive-open.is-stacked > .archive {
  position: fixed;
  z-index: 3;
  inset: var(--archive-sheet-top, 50dvh) 0 0;
  height: auto;
  border-right: 0;
  border-bottom: 0;
  border-left: 0;
}

/*
 * **옆** 배치 — 낮은 가로 화면 (폰 가로).
 *
 * 그리드는 나란히 배치와 같지만, 보관함이 영상의 실제 오른쪽 끝(`--archive-sheet-left`)부터 화면
 * 높이 전체를 쓰는 고정 패널이 된다. 영상은 화면 위에 오고 페이지 스크롤은 잠긴다.
 */
.workspace.is-archive-open.is-side {
  position: relative;
  z-index: 2;
  padding-bottom: 100dvh;
}

.workspace.is-archive-open.is-side > .archive {
  position: fixed;
  z-index: 3;
  inset: 0 0 0 var(--archive-sheet-left, 50vw);
  height: auto;
  border-top: 0;
  border-right: 0;
  border-bottom: 0;
}

@media (max-width: 650px) {
  .dashboard-shell {
    padding: 10px 8px 35px;
  }

  .workspace {
    padding: 17px;
  }
}
</style>
