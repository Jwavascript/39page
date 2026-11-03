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
 * M3-4 에서 재생 쪽에 **통지 하나**를 보내게 됐다. 좁은 화면에서 드로어를
 * 열면 이 컴포넌트의 CSS 가 스테이지를 `display: none` 으로 만든다. 그
 * 사실을 아는 곳은 여기뿐이므로, 가려지기 **전에** 알려줄 책임도 여기다
 * (`features/playback/playbackCoordinator.ts` 의 `PlaybackVisibility`).
 * 재생 상태를 읽거나 플레이어를 직접 부르지는 않는다.
 */
import { computed, inject, nextTick, onBeforeUnmount, onMounted, provide, readonly, ref } from 'vue'

import AppHeader from '@/components/layout/AppHeader.vue'
import WidgetHost from '@/components/layout/WidgetHost.vue'
import RecordLibraryDrawer from '@/features/library/RecordLibraryDrawer.vue'
import { LIBRARY_DRAWER, type LibraryDrawerController } from '@/features/library/drawerController'
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

/**
 * 스테이지가 드로어로 **대체되는** 화면 폭.
 *
 * 아래 `@media (max-width: 1100px)` 규칙과 같은 값이어야 한다. CSS 변수는
 * 미디어 쿼리 조건에 쓸 수 없어 중복이 불가피하다 (`src/styles/tokens.css`
 * 주석). 승인된 프로토타입도 같은 값을 `matchMedia` 로 중복한다
 * (`shouldUseCompact()`). 같은 파일 안에 두어 어긋날 여지를 줄였다.
 */
const STAGE_REPLACED_QUERY = '(max-width: 1100px)'

/**
 * 가시성 통지 대상 (M3-4).
 *
 * 계약 파일만 가져온다. 주입되지 않으면 통지하지 않는다 — 셸을 단독으로
 * 마운트하는 테스트를 위한 기본값이다.
 */
const playbackVisibility = inject(PLAYBACK_COORDINATOR, null)

/**
 * 드로어를 열면 스테이지가 가려지는지.
 *
 * `matchMedia` 가 없는 환경에서는 **가려지지 않는다고 본다.** 없다는 이유로
 * 멈추면 실제로 보이는 플레이어를 멈추게 된다. 실제로 가려지는 경우는
 * `PlayerSurface` 의 가시성 감시가 한 틱 뒤에 잡는다.
 */
function stageWillBeHidden(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia(STAGE_REPLACED_QUERY).matches
}

/** 닫을 때 포커스를 되돌릴 트리거. */
let lastTrigger: HTMLElement | null = null

function openDrawer(): void {
  /*
   * 가려지기 **전에** 멈춘다. 열고 나서 멈추면 그 사이 가려진 채로 소리가
   * 난다 — 개발자 정책 III.I.9 가 금지하는 상태다.
   */
  if (stageWillBeHidden()) playbackVisibility?.playerWillHide()

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

.workspace.is-drawer-open {
  grid-template-columns: minmax(0, 1fr) var(--size-drawer-width);
  gap: clamp(20px, 2.3vw, 39px);
}

/*
 * 1100px 이하에서는 나란히 둘 공간이 없다. 레퍼런스와 같이 드로어가
 * 스테이지를 대체한다. **언마운트가 아니라 `display: none`** 이므로
 * PlayerSurface 의 DOM 노드와 부모는 그대로 유지된다.
 *
 * 이 값은 위의 `STAGE_REPLACED_QUERY` 와 같아야 한다. 가려지기 전에
 * 일시정지하는 통지가 그 상수를 쓴다 (M3-4).
 */
@media (max-width: 1100px) {
  .workspace.is-drawer-open {
    grid-template-columns: minmax(0, 1fr);
    gap: 0;
  }

  .workspace.is-drawer-open > :first-child {
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
