<script setup lang="ts">
/**
 * 대시보드 전체 화면 구조.
 *
 * 책임: 셸 여백·최대 폭, 헤더 통합, 워크스페이스 영역 제공.
 * 위젯을 직접 알지 않는다 — 레이아웃을 받아 `WidgetHost`에 넘길 뿐이다.
 *
 * 테마를 참조하지 않는다. 외형은 CSS 토큰이 결정하므로 두 테마가 **같은**
 * 셸 인스턴스를 공유한다. 테마별 셸을 따로 마운트하지 않는다
 * (`docs/decisions/0001-theme-switching-mechanism.md`).
 *
 * M2에서 Record Library 드로어가 `.workspace`의 형제 열로 들어온다.
 * 지금은 동작하지 않는 버튼을 만들지 않으므로 헤더에 액션이 없다.
 *
 * M6-2 에서 드로어를 **오버레이**로 바꿨다.
 *
 * M7-1 에서 좁은 화면의 드로어가 **화면을 가리는 하단 시트**가 됐다 (사용자
 * 요청). 그래서 이 컴포넌트가 다시 재생 계약을 안다 — 가리는 쪽만 **얼마나
 * 가리는지** 알 수 있기 때문이다.
 *
 * 가리는 높이를 숫자로 알리고(`setBottomObstruction`), 판단은 재생 쪽이 한다.
 * 이 컴포넌트는 "덮으면 멈춰야 한다" 는 정책도, 200×200 이라는 숫자도 모른다.
 *
 * | 시점 | 방식                          | 왜                                         |
 * | ---- | ----------------------------- | ------------------------------------------ |
 * | M3-4 | `playerWillHide()` 사전 통지  | 스테이지를 `display: none` 으로 대체했다   |
 * | M6-2 | 통지 없음                     | 겹치지 않는 구조라 가려질 일이 없었다      |
 * | M7-1 | `setBottomObstruction(px)`    | 겹치게 됐다. **얼마나** 가리는지가 필요하다 |
 */
import { computed, inject, nextTick, onBeforeUnmount, onMounted, provide, readonly, ref } from 'vue'

import AppFooter from '@/components/layout/AppFooter.vue'
import AppHeader from '@/components/layout/AppHeader.vue'
import WidgetHost from '@/components/layout/WidgetHost.vue'
import RecordLibraryDrawer from '@/features/library/RecordLibraryDrawer.vue'
import { LIBRARY_DRAWER, type LibraryDrawerController } from '@/features/library/drawerController'
import {
  PLAYLIST_SHELF,
  type PlaylistShelfController,
} from '@/features/library/playlistShelfController'
import { PLAYBACK_COORDINATOR } from '@/features/playback/playbackCoordinator'
import type { DashboardLayout } from '@/shared/types'

defineProps<{
  brand: string
  layout: DashboardLayout
}>()

/**
 * 드로어 열림 상태.
 *
 * 화면 하나의 UI 상태이고 영속화 대상이 아니므로 전역 store 를 만들지 않는다.
 * 트리거(`DeckWidget`)는 `WidgetHost` 너머에 있어 props 로 닿지 않으므로
 * 주입으로 전달한다 (`features/library/drawerController.ts`).
 */
const DRAWER_ID = 'record-library-drawer'
const isDrawerOpen = ref(false)

/** 닫을 때 포커스를 되돌릴 트리거. */
let lastTrigger: HTMLElement | null = null

/**
 * 재생 쪽에 가림 높이를 알리는 통로 (M7-1).
 *
 * **계약 파일만** 가져온다. 주입되지 않으면 알리지 않는다 — 셸을 단독으로
 * 마운트하는 테스트를 위한 기본값이다.
 */
const playback = inject(PLAYBACK_COORDINATOR, null)

/**
 * 좁은 화면에서만 드로어가 하단 시트다.
 *
 * 승인된 브레이크포인트를 그대로 쓴다. CSS 변수는 `@media` 조건에 쓸 수 없어
 * 토큰으로 둘 수 없고, 그래서 `tokens.css` 가 값을 주석으로 적어 두었다.
 * 여기서도 같은 값을 쓴다.
 */
const SHEET_QUERY = '(max-width: 1100px)'

function isSheetLayout(): boolean {
  // jsdom 에는 matchMedia 가 없다. 없으면 시트가 아닌 것으로 본다.
  return typeof window.matchMedia === 'function' && window.matchMedia(SHEET_QUERY).matches
}

/**
 * 시트가 뷰포트 하단을 덮은 높이를 재서 알린다.
 *
 * 시트의 **위쪽 테두리**에서 화면 바닥까지다. 높이를 직접 읽지 않는 이유:
 * 시트가 화면 밖으로 조금 넘어가거나 안전 영역(safe-area) 여백이 붙으면
 * 높이와 실제로 가리는 양이 달라진다. 위치를 재면 그 차이가 사라진다.
 */
function reportObstruction(): void {
  if (playback === null) return

  if (!isDrawerOpen.value || !isSheetLayout()) {
    playback.setBottomObstruction(0)
    return
  }

  const element = document.getElementById(DRAWER_ID)
  if (element === null) {
    playback.setBottomObstruction(0)
    return
  }

  const top = element.getBoundingClientRect().top
  playback.setBottomObstruction(Math.max(0, window.innerHeight - top))
}

function openDrawer(): void {
  /*
   * 재생을 멈추지 않는다 (M6-2).
   *
   * 드로어는 플레이어를 가리지 않는다. 넓은 화면에서는 정보 열 안에서 끝나고,
   * 좁은 화면에서는 아래 행을 쓴다. 가려지지 않으므로 III.I.9 가 금지하는
   * 상태가 되지 않는다.
   */
  const active = document.activeElement
  lastTrigger = active instanceof HTMLElement ? active : null
  isDrawerOpen.value = true

  /*
   * 시트가 자리를 잡은 **뒤에** 재야 한다. 같은 틱에 재면 아직 그리드 셀에
   * 있는 사각형을 읽는다.
   */
  void nextTick(reportObstruction)
}

async function closeDrawer(): Promise<void> {
  if (!isDrawerOpen.value) return

  isDrawerOpen.value = false
  await nextTick()
  reportObstruction()
  // 트리거가 아직 화면에 있으면 포커스를 되돌린다.
  if (lastTrigger !== null && document.contains(lastTrigger)) lastTrigger.focus()
  lastTrigger = null
}

/**
 * 재생 전에 시트를 비켜준다 (M7-2).
 *
 * 가리고 있을 때만 닫는다. 넓은 화면에서는 드로어가 플레이어를 가리지 않으므로
 * 편집 맥락을 유지한다.
 *
 * `closeDrawer()` 가 닫은 뒤 가림을 0 으로 다시 알리므로, 이 함수를 기다린
 * 호출부는 **가림이 걷힌 상태에서** 재생을 요청하게 된다.
 */
async function stepAside(): Promise<void> {
  if (!isDrawerOpen.value || !isSheetLayout()) return

  await closeDrawer()
}

const controller: LibraryDrawerController = {
  isOpen: readonly(isDrawerOpen),
  drawerId: DRAWER_ID,
  open: openDrawer,
  close: () => void closeDrawer(),
  stepAside,
}
provide(LIBRARY_DRAWER, controller)

/**
 * 플레이리스트 위젯의 펼침 상태 (M7 요청 1).
 *
 * 데크를 누르면 토글한다. 기본은 접힘이다 — 위젯이 타일 한 줄만 보이다가
 * 펼쳐지면 더 많이 보인다. 접힌 상태에서도 타일이 보이므로 플레이리스트를
 * 찾지 못하는 일은 없다.
 */
const SHELF_ID = 'playlist-shelf'
const isShelfExpanded = ref(false)

const shelf: PlaylistShelfController = {
  isExpanded: readonly(isShelfExpanded),
  shelfId: SHELF_ID,
  toggle: () => {
    isShelfExpanded.value = !isShelfExpanded.value
  },
}
provide(PLAYLIST_SHELF, shelf)

/**
 * Escape 는 **가장 바깥 것부터** 닫는다.
 *
 * 드로어가 열려 있으면 드로어를, 아니면 펼쳐진 선반을 접는다. 한 번에 둘을
 * 닫으면 사용자가 무엇을 닫았는지 알 수 없다.
 */
function onKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Escape') return

  if (isDrawerOpen.value) {
    void closeDrawer()
    return
  }
  if (isShelfExpanded.value) isShelfExpanded.value = false
}

/*
 * 시트 높이는 `vh` 기반이므로 창 크기가 바뀌면 가리는 양도 바뀐다. 브레이크
 * 포인트를 넘나들면 시트였던 것이 측면 열이 되기도 한다. 둘 다 `resize` 로
 * 잡는다.
 */
onMounted(() => {
  document.addEventListener('keydown', onKeydown)
  window.addEventListener('resize', reportObstruction, { passive: true })
})

onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKeydown)
  window.removeEventListener('resize', reportObstruction)
  // 셸이 사라지면 가리는 것도 없다. 멈춘 이유를 남겨두지 않는다.
  playback?.setBottomObstruction(0)
})

const workspaceClass = computed(() => ({ 'is-drawer-open': isDrawerOpen.value }))
</script>

<template>
  <div class="dashboard-shell">
    <AppHeader :brand="brand">
      <!-- M2에서 라이브러리·링크 추가 버튼이 들어온다. -->
      <template #actions><slot name="header-actions" /></template>
    </AppHeader>

    <!--
      드로어는 WidgetHost 의 **형제**다. 열고 닫아도 WidgetHost 와
      그 안의 PlayerSurface 는 같은 부모에 그대로 있다.
      v-if 를 쓰지 않는다 (ADR 0002).
    -->
    <div class="workspace" :class="workspaceClass">
      <WidgetHost :layout="layout" />
      <RecordLibraryDrawer :open="isDrawerOpen" :drawer-id="DRAWER_ID" @close="closeDrawer" />
    </div>

    <!--
      승인된 디자인의 `.footer`. 테마 문구를 쓰므로 별도 컴포넌트다 —
      이 셸은 테마를 모르는 상태로 남아야 한다 (ADR 0001).
    -->
    <AppFooter />
  </div>
</template>

<style scoped>
/* 승인된 디자인의 .shell 값을 따른다. */
.dashboard-shell {
  max-width: var(--size-shell-max-width);
  margin: auto;
  padding: 22px clamp(12px, 3vw, 46px) 44px;
}

/*
 * 승인된 디자인의 .workspace 값을 따른다. 복합 배경을 그대로 쓴다.
 * 드로어가 열리면 340px 열이 생긴다. 레퍼런스와 같은 방식이다.
 */
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
 * 드로어는 **오버레이**다 (M6-2).
 *
 * 이전에는 340px 열을 만들어 스테이지를 좁혔다. 실기기 검증에서 "나머지
 * 요소가 조절되지 않고 위에 덮이면 좋겠다" 는 요청이 왔다.
 *
 * 구현은 **같은 그리드 셀에 겹쳐 놓는 것**이다. 절대 위치를 쓰지 않는다 —
 * 스테이지와 드로어가 같은 셀(1/1)에 들어가면 스테이지의 트랙 크기가 바뀌지
 * 않으므로 위젯이 재배치되지 않는다. DOM 부모·순서도 그대로다 (ADR 0002).
 *
 * ⚠ **드로어가 플레이어를 가리지 않는다는 보장은 레이아웃이 진다.**
 * 가시성 측정은 다른 요소에 덮인 것을 감지하지 못한다
 * (`features/playback/playerVisibility.ts`). 그래서 `WidgetHost` 의 정보 열
 * 최소 폭을 `--size-drawer-width` 자체로 묶어 두었다. 우측 드로어가 그 열
 * 안에서 끝나므로 플레이어(2열)에 닿지 않는다.
 *
 * ⚠ **스테이지에도 셀을 명시해야 한다** (M7 에서 고친 버그).
 * 드로어만 `grid-area: 1 / 1` 을 가지면, 자동 배치되는 스테이지가 **이미 찬
 * 셀을 피해 2 행으로 밀린다.** 실기기에서 "드로어가 위쪽에 별도 공간으로
 * 생긴다" 로 보고된 것이 이 증상이다. jsdom 은 그리드를 계산하지 않으므로
 * 단위 테스트가 잡지 못했다.
 */
.workspace.is-drawer-open > :first-child,
.workspace.is-drawer-open > :last-child {
  grid-area: 1 / 1;
}

.workspace.is-drawer-open > :last-child {
  justify-self: end;
  width: var(--size-drawer-width);
  /* `.workspace` 에 `isolation: isolate` 가 있어 쌓임 맥락이 갇힌다. */
  z-index: 1;
}

/*
 * 1100px 이하: 드로어를 **화면 하단에서 올라오는 시트**로 둔다 (M7 요청 5).
 *
 * 세 번 바뀐 자리다. 무엇이 왜 바뀌었는지 남겨 둔다.
 *
 * | 시점 | 배치                        | 왜 바꿨나                                  |
 * | ---- | --------------------------- | ------------------------------------------ |
 * | M3-4 | 스테이지를 `display: none`  | 플레이어가 0×0 → 세로에서 재생이 불가능했다 |
 * | M6-2 | 아래 **행**(별도 공간)      | 다른 위젯이 모두 사라지고 화면이 통째로 바뀌었다 |
 * | M7   | 하단 **고정 시트**(겹침)    | 보던 화면 위로 올라오기를 요청받았다        |
 *
 * 위젯을 숨기지 않는다. 시트는 `position: fixed` 로 뷰포트 하단에 겹쳐
 * **화면을 가린다.**
 *
 * ⚠ **그래서 플레이어가 시트에 덮일 수 있다.** 그것을 레이아웃으로 막지
 * 않는 것이 M7-1 의 결정이다 (사용자 지시). 대신 **가리는 높이를 재생 쪽에
 * 알리고, 규정(200×200) 아래로 덮으면 일시정지한다.**
 *
 * 한동안 `position: sticky` 로 플레이어를 시트 위에 붙여 두었는데 되돌렸다.
 * 짧은 화면에서는 남는 띠가 플레이어보다 얇아 보장이 성립하지 않고, 조상의
 * `overflow` 를 바꿔야 해서 레이아웃이 다른 이유로 깨질 수 있었다. 측정이
 * 사실을 보는 쪽이 낫다 — `setBottomObstruction()` 와 ADR 0011 개정 절.
 *
 * 스테이지에 시트 높이만큼 아래 여백을 준다. 시트에 영구히 묻히는 콘텐츠가
 * 없어야 한다 — 스크롤해서 꺼낼 수 있어야 한다.
 *
 * `display` 도 DOM 부모도 건드리지 않으므로 iframe 은 그대로다 (ADR 0002).
 */
@media (max-width: 1100px) {
  .workspace.is-drawer-open {
    position: relative;
    /* 시트가 푸터보다 위에 그려지도록 워크스페이스를 올린다. */
    z-index: 2;
    padding-bottom: calc(var(--size-sheet-height) + 18px);
  }

  .workspace.is-drawer-open > :last-child {
    position: fixed;
    inset: auto 0 0;
    justify-self: stretch;
    width: auto;
    max-height: var(--size-sheet-height);
    /* 전체 폭이므로 왼쪽 테두리가 아니라 윗 테두리가 시트의 경계다. */
    border-top: 1px solid var(--drawer-border-color);
    border-left: 0;
    z-index: 3;
  }
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
