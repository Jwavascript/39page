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
 * M6-2 에서 드로어를 **오버레이**로 바꿨고, 그 결과 이 컴포넌트는 재생 계약을
 * 다시 모르게 됐다.
 *
 * M3-4 에서는 좁은 화면에서 드로어가 스테이지를 `display: none` 으로 대체했기
 * 때문에, 가려지기 전에 멈추라고 재생 쪽에 통지해야 했다
 * (`playerWillHide()`). 지금은 **플레이어를 숨기지 않는다** — 좁은 화면에서도
 * 플레이어만 남기고 드로어는 아래 행을 쓴다. 가려질 일이 없으므로 통지하지
 * 않는다. 그래서 세로 화면에서도 재생이 끊기지 않는다.
 *
 * 겹침이 **구조적으로 불가능**하다는 점이 근거다. 아래 CSS 주석 참조.
 * 혹시 레이아웃이 깨져 플레이어가 화면 밖으로 밀리면
 * `PlayerSurface` 의 `IntersectionObserver` 가 안전망으로 잡는다.
 */
import { computed, nextTick, onBeforeUnmount, onMounted, provide, readonly, ref } from 'vue'

import AppFooter from '@/components/layout/AppFooter.vue'
import AppHeader from '@/components/layout/AppHeader.vue'
import WidgetHost from '@/components/layout/WidgetHost.vue'
import RecordLibraryDrawer from '@/features/library/RecordLibraryDrawer.vue'
import { LIBRARY_DRAWER, type LibraryDrawerController } from '@/features/library/drawerController'
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
}

async function closeDrawer(): Promise<void> {
  if (!isDrawerOpen.value) return

  isDrawerOpen.value = false
  await nextTick()
  // 트리거가 아직 화면에 있으면 포커스를 되돌린다.
  if (lastTrigger !== null && document.contains(lastTrigger)) lastTrigger.focus()
  lastTrigger = null
}

const controller: LibraryDrawerController = {
  isOpen: readonly(isDrawerOpen),
  drawerId: DRAWER_ID,
  open: openDrawer,
  close: () => void closeDrawer(),
}
provide(LIBRARY_DRAWER, controller)

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape' && isDrawerOpen.value) void closeDrawer()
}

onMounted(() => document.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => document.removeEventListener('keydown', onKeydown))

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
 */
.workspace.is-drawer-open > :last-child {
  grid-area: 1 / 1;
  justify-self: end;
  width: var(--size-drawer-width);
  /* `.workspace` 에 `isolation: isolate` 가 있어 쌓임 맥락이 갇힌다. */
  z-index: 1;
}

/*
 * 1100px 이하: 나란히 둘 공간이 없다. 드로어를 **아래 행**에 둔다.
 *
 * 이전에는 스테이지를 `display: none` 으로 대체했다. 그래서 세로 화면에서
 * 플레이어가 0×0 이 되고 가드가 재생을 거절했다 — 실기기에서 "세로에서는
 * 음악 재생이 불가능하다" 로 보고된 문제다.
 *
 * 지금은 **플레이어만 남기고** 나머지 위젯을 숨긴다. 플레이어가 계속 보이므로
 * 재생이 끊기지 않고, 드로어가 아래 행을 쓰므로 겹칠 수 없다. 겹침이 구조적으로
 * 불가능하다는 점이 중요하다 — 픽셀 비율로 맞추면 화면 크기마다 깨진다.
 *
 * 숨기는 것은 위젯의 `display` 뿐이고 언마운트가 아니다. 플레이어는 숨기지
 * 않으므로 iframe 과 그 부모는 그대로다 (ADR 0002).
 */
@media (max-width: 1100px) {
  .workspace.is-drawer-open {
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: auto minmax(0, 1fr);
    gap: clamp(14px, 2vw, 24px);
  }

  .workspace.is-drawer-open > :last-child {
    grid-area: 2 / 1;
    justify-self: stretch;
    width: auto;
  }

  /* 플레이어만 남긴다. 플레이어는 계속 보여야 한다 (III.I.9). */
  .workspace.is-drawer-open :deep(.widget-host) {
    grid-template-areas: 'player';
    grid-template-columns: minmax(0, 1fr);
  }

  .workspace.is-drawer-open :deep(.widget-host > *:not([data-widget='player'])) {
    display: none;
  }

  /* 의사 요소 구분선도 숨긴다. 열이 하나뿐이라 그을 자리가 없다. */
  .workspace.is-drawer-open :deep(.widget-host::before) {
    display: none;
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
