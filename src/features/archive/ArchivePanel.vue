<script setup lang="ts">
/**
 * 통합 보관함 — 음악 · Moments 두 탭 (M11-2, ADR 0027 C안).
 *
 * 화면 구조(어디에 놓이는지 · 플레이어를 어떻게 피하는지)는 `DashboardShell` 이 정한다. 이
 * 컴포넌트는 **보관함 안**만 안다 — 탭, 닫기, 포커스.
 *
 * - 탭은 WAI-ARIA 탭 패턴이다: `role="tablist"` · 화살표 ←/→ · Home/End 로 옮기고 바로 바꾼다.
 * - 두 탭 본문은 **늘 마운트**되어 있고 `hidden` 으로만 숨긴다. 탭을 오가도 쓰던 양식이 남는다.
 * - 열리면 고른 탭 단추로 포커스가 온다. 닫으면 셸이 연 버튼으로 되돌린다.
 * - 포커스 가둠이 없는 비모달 영역이다 — 플레이어 · 헤더를 계속 쓸 수 있다. 그래서 `aria-modal`
 *   을 선언하지 않는다 (M2 드로어와 같은 판단).
 *
 * ## 음악 탭의 배치 (M11-7B, ADR 0030 · UAT U3)
 *
 * | 보관함의 폭        | 배치                                                                   |
 * | ------------------ | ---------------------------------------------------------------------- |
 * | 넓다 (641px 이상)  | **두 칸** — 왼쪽 목록 칸(`ArchivePlaylistNav`) · 오른쪽 상세 칸(`PlaylistEditor`) |
 * | 좁다               | **두 단계** — 목록 → 상세. 상세에 "목록으로" 와 위치 표시가 있다         |
 *
 * 두 칸은 **각자** 스크롤한다 — 목록이 50개여도 상세 칸의 곡은 그 자리다. 음악 탭의 본문 자체는
 * 스크롤하지 않는다 (스크롤이 겹치지 않게). 폭은 화면이 아니라 **보관함 자신의 폭**으로 본다
 * (컨테이너 쿼리) — 보관함이 화면의 일부만 쓰는 배치가 있기 때문이다.
 */
import { nextTick, ref, watch } from 'vue'

import ArchivePlaylistNav from '@/features/library/ArchivePlaylistNav.vue'
import PlaylistEditor from '@/features/library/PlaylistEditor.vue'
import MomentsBrowserPanel from '@/features/moments/MomentsBrowserPanel.vue'
import { useMomentsStore } from '@/stores/moments'

import type { ArchiveTab } from './archiveController'

const props = defineProps<{
  open: boolean
  tab: ArchiveTab
  panelId: string
  /** 바뀔 때마다 고른 목록의 링크 입력을 연다 (`ArchiveOpenOptions.addLink`). */
  addLinkRequest?: number
  /** Moments 탭을 한 영상으로 거른다 (`ArchiveOpenOptions.videoId`). */
  momentsFocusRequest?: { videoId: string; seq: number } | null
  /** 음악 탭에서 그 영상의 곡 줄을 보인다 (`ArchiveOpenOptions.revealVideoId`). */
  revealRequest?: { videoId: string; seq: number } | null
  /** 바뀔 때마다 음악 탭을 고른 목록의 상세 단계로 맞춘다 (`ArchiveOpenOptions.showDetail`). */
  detailRequest?: number
}>()

const emit = defineEmits<{
  close: []
  'select-tab': [tab: ArchiveTab]
}>()

const moments = useMomentsStore()

const TABS: readonly { key: ArchiveTab; label: string }[] = [
  { key: 'music', label: '♪ 음악' },
  { key: 'moments', label: '◆ Moments' },
]

const tabButtons = ref<Record<ArchiveTab, HTMLButtonElement | null>>({ music: null, moments: null })

function focusTab(tab: ArchiveTab): void {
  void nextTick(() => tabButtons.value[tab]?.focus())
}

/** 화살표 · Home · End — 옮기면서 바로 그 탭을 연다 (자동 활성화). */
function onTabKeydown(event: KeyboardEvent): void {
  const index = TABS.findIndex((item) => item.key === props.tab)
  let next = index
  if (event.key === 'ArrowRight') next = (index + 1) % TABS.length
  else if (event.key === 'ArrowLeft') next = (index - 1 + TABS.length) % TABS.length
  else if (event.key === 'Home') next = 0
  else if (event.key === 'End') next = TABS.length - 1
  else return
  event.preventDefault()
  const target = TABS[next]
  if (target === undefined) return
  emit('select-tab', target.key)
  focusTab(target.key)
}

/* ---------- 음악 탭: 목록 → 상세 (좁은 화면의 두 단계) ---------- */

/**
 * 좁은 화면에서 지금 보이는 단계. 넓은 화면에서는 두 칸이 함께 보이므로 쓰이지 않는다 — 그래도 값은
 * 늘 유지한다 (창을 줄이면 그 단계가 보인다). 화면 하나의 UI 상태라 저장하지 않는다.
 */
type MusicStep = 'lists' | 'detail'
const musicStep = ref<MusicStep>('lists')

const lists = ref<InstanceType<typeof ArchivePlaylistNav> | null>(null)
const editor = ref<InstanceType<typeof PlaylistEditor> | null>(null)

/** 포커스가 화면에 없는 요소(가려진 단계)에 남았는지. 넓은 화면에서는 늘 `false` 다. */
function focusIsHidden(): boolean {
  const active = document.activeElement
  if (!(active instanceof HTMLElement) || active === document.body) return true
  return active.offsetParent === null
}

/**
 * 단계를 바꾼다. 좁은 화면에서는 누른 단추가 사라지므로(`display: none`) 포커스를 새 단계로 옮긴다 —
 * 넓은 화면에서는 단추가 그대로 보이므로 포커스를 건드리지 않는다.
 */
async function showStep(step: MusicStep): Promise<void> {
  musicStep.value = step
  await nextTick()
  if (!props.open || props.tab !== 'music' || !focusIsHidden()) return
  if (step === 'detail') editor.value?.focusHead()
  else lists.value?.focusSelected()
}

/** 목록을 골랐다 — 그 목록의 곡이 곧바로 보인다. */
function onPlaylistSelected(): void {
  void showStep('detail')
}

/** 새 목록을 만들면 곡 추가로 바로 이어 준다 — 상세 칸의 "링크 추가" 로 포커스 (M11 U15). */
function onPlaylistCreated(): void {
  musicStep.value = 'detail'
  void nextTick(() => editor.value?.startAddLink())
}

watch(
  () => props.addLinkRequest,
  (now, before) => {
    if (now !== undefined && now !== before && now > 0) {
      musicStep.value = 'detail'
      void nextTick(() => editor.value?.startAddLink())
    }
  },
)

watch(
  () => props.revealRequest?.seq,
  () => {
    const request = props.revealRequest
    if (request == null) return
    musicStep.value = 'detail'
    void nextTick(() => editor.value?.revealVideo(request.videoId))
  },
)

watch(
  () => props.detailRequest,
  (now, before) => {
    if (now !== undefined && now !== before && now > 0) musicStep.value = 'detail'
  },
)

/** Moments 탭을 한 번이라도 열었는지 — 열었으면 그 뒤로 마운트를 유지한다. */
const momentsVisited = ref(false)
watch(
  () => props.open && props.tab === 'moments',
  (visible) => {
    if (visible) momentsVisited.value = true
  },
  { immediate: true },
)

watch(
  () => [props.open, props.tab] as const,
  ([isOpen], previous) => {
    // 열릴 때만 옮긴다. 열린 채 탭을 바꾸는 것은 사용자가 탭을 눌렀거나 화살표를 쓴 것이다.
    if (isOpen && previous?.[0] !== true) focusTab(props.tab)
  },
)
</script>

<template>
  <!--
    `drawer` 클래스는 M2 드로어의 표면 토큰(`--drawer-*`)을 그대로 쓰기 위한 것이다.
    닫혀 있으면 `hidden` — 안쪽 단추가 Tab 순서에 남지 않는다.
  -->
  <aside :id="panelId" class="archive drawer" :hidden="!open" aria-labelledby="archive-title">
    <div class="archive-head">
      <h2 id="archive-title" class="archive-title">보관함</h2>
      <div class="tabs" role="tablist" aria-label="보관함 보기">
        <button
          v-for="item in TABS"
          :id="`archive-tab-${item.key}`"
          :key="item.key"
          :ref="(el) => (tabButtons[item.key] = el as HTMLButtonElement | null)"
          type="button"
          role="tab"
          class="tab"
          :aria-selected="tab === item.key"
          :aria-controls="`archive-panel-${item.key}`"
          :tabindex="tab === item.key ? 0 : -1"
          @click="emit('select-tab', item.key)"
          @keydown="onTabKeydown"
        >
          {{ item.label }}
          <span v-if="item.key === 'moments'" class="tab-count">{{ moments.count }}</span>
        </button>
      </div>
      <button type="button" class="close" aria-label="보관함 닫기" @click="emit('close')">×</button>
    </div>

    <div
      id="archive-panel-music"
      class="archive-body archive-body--music"
      role="tabpanel"
      aria-labelledby="archive-tab-music"
      :hidden="tab !== 'music'"
    >
      <!--
        두 칸 / 두 단계. 두 컴포넌트는 **늘 마운트**되어 있다 — 단계를 바꿔도 쓰던 양식이 남는다.
      -->
      <div class="music-layout" :data-step="musicStep">
        <ArchivePlaylistNav
          ref="lists"
          class="music-lists"
          :active="open"
          @created="onPlaylistCreated"
          @selected="onPlaylistSelected"
        />
        <PlaylistEditor
          ref="editor"
          class="music-detail"
          :active="open"
          @back="showStep('lists')"
        />
      </div>
    </div>

    <div
      id="archive-panel-moments"
      class="archive-body"
      role="tabpanel"
      aria-labelledby="archive-tab-moments"
      :hidden="tab !== 'moments'"
    >
      <!--
        처음 이 탭을 열 때 마운트한다 (그 뒤로는 유지). 열어 보지도 않은 수백 · 수천 행을 미리 그리지
        않고, 대시보드 위젯과 같은 목록이 화면 밖에 한 벌 더 생기지 않게 한다.
      -->
      <MomentsBrowserPanel v-if="momentsVisited" :focus-request="momentsFocusRequest ?? null" />
    </div>

    <p class="archive-foot">
      Esc 또는 × 로 닫아요. 보관함을 열어도 음악은 계속 재생돼요.<br />
      JSON 백업은 맨 위의 <strong>⇩ 데이터 · 백업</strong> 에서 할 수 있어요.
    </p>
  </aside>
</template>

<style scoped>
/* 승인된 디자인의 `.drawer` 표면 (M2) 을 잇는다. */
.archive {
  display: flex;
  min-width: 0;
  min-height: 0;
  flex-direction: column;
  border: 1px solid var(--drawer-border-color);
  background: var(--drawer-surface-color);
}

.archive[hidden] {
  display: none;
}

.archive-head {
  display: flex;
  flex: none;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 12px;
  padding: 12px 12px 12px 16px;
  border-bottom: 1px solid var(--drawer-head-border-color);
}

.archive-title {
  margin: 0;
  color: var(--drawer-title-text-color);
  font: 13px var(--font-mono);
  font-weight: 400;
  letter-spacing: 0.1em;
}

.tabs {
  display: flex;
  min-width: 0;
  flex: 1;
  gap: 4px;
}

.tab {
  min-width: 0;
  min-height: 44px;
  flex: 1 1 0;
  padding: 6px 12px;
  border: 1px solid var(--pill-border-color);
  border-radius: var(--radius-control);
  background: var(--pill-surface-color);
  color: var(--pill-text-color);
  font: 12px var(--font-mono);
  white-space: nowrap;
}

.tab[aria-selected='true'] {
  border-color: var(--accent-strong-color);
  background: var(--accent-strong-color);
  color: var(--accent-strong-text-color);
}

.tab-count {
  margin-left: 4px;
  opacity: 0.8;
}

.close {
  width: 44px;
  height: 44px;
  flex: none;
  border: 0;
  background: transparent;
  color: var(--close-button-text-color);
  font-size: 24px;
  line-height: 1;
}

/* 보관함 안에서 스크롤은 **이 한 곳**이다 — 중첩 스크롤을 만들지 않는다. */
.archive-body {
  min-height: 0;
  flex: 1 1 auto;
  padding: 16px;
  overflow-y: auto;
  overscroll-behavior: contain;
  /*
   * 스크롤바 자리를 늘 비워 둔다 (M9-6 성능). 스크롤바가 폭을 차지하는 환경에서 `overflow-y: auto` 는
   * 내용이 바뀔 때마다 목록 전체를 다시 배치했다 — Moments 1000개에서 한 줄만 바뀌어도 550~700ms.
   * 고정하면 바뀐 줄만 다시 배치한다(같은 조건 10ms). M11-2 부터 Moments 목록의 스크롤이 여기다.
   */
  scrollbar-gutter: stable;
}

.archive-body[hidden] {
  display: none;
}

/*
 * 음악 탭 (M11-7B) — 본문은 스크롤하지 않고 **두 칸이 각자** 스크롤한다. 본문이 함께 스크롤하면
 * 목록 칸을 내릴 때 상세 칸의 머리말(목록 이름 · 전체 재생)이 화면 밖으로 나간다.
 */
.archive-body--music {
  display: flex;
  padding: 0;
  overflow: hidden;
  container: archive-music / inline-size;
}

.music-layout {
  display: grid;
  min-width: 0;
  min-height: 0;
  flex: 1 1 auto;
  /* 목록 칸은 이름 두 줄이 읽히는 폭, 상세 칸이 나머지를 쓴다. */
  grid-template-columns: minmax(220px, 0.8fr) minmax(0, 1.6fr);
  grid-template-rows: minmax(0, 1fr);
}

.music-lists,
.music-detail {
  padding: 14px 12px 14px 16px;
}

.music-lists {
  border-right: 1px solid var(--drawer-head-border-color);
}

/*
 * 좁은 보관함 — **두 단계.** 두 칸을 나란히 두면 곡 제목이 몇 글자 폭으로 눌린다. 한 번에 한 단계만
 * 보이고, 상세 단계의 "목록으로" 로 돌아온다. 화면 폭이 아니라 보관함의 폭으로 판단한다.
 */
@container archive-music (max-width: 640px) {
  .music-layout {
    grid-template-columns: minmax(0, 1fr);
  }

  .music-lists {
    border-right: 0;
  }

  .music-layout[data-step='lists'] > .music-detail,
  .music-layout[data-step='detail'] > .music-lists {
    display: none;
  }

  .music-detail :deep(.step-nav) {
    display: flex;
  }
}

.archive-foot {
  flex: none;
  margin: 0;
  padding: 10px 16px;
  border-top: 1px solid var(--drawer-foot-border-color);
  color: var(--drawer-foot-text-color);
  font: 10px/1.6 var(--font-mono);
}

.archive-foot strong {
  color: var(--drawer-title-text-color);
  font-weight: 400;
}

/*
 * 작은 화면에서는 바닥 안내를 접는다 (M11-7B) — 재생 띠가 위를 쓰므로 보관함의 높이가 귀하다. 닫기(×)와
 * 탭은 머리말에 그대로 있고, 백업 입구는 헤더에 이름으로 있다.
 */
@media (max-height: 720px), (max-width: 700px) {
  .archive-foot {
    display: none;
  }
}

/* 아주 좁은 화면: 탭 둘이 한 줄에 들어가게 "보관함" 제목을 접고(이름은 `aria-labelledby` 로 남는다) 여백을 줄인다. */
@media (max-width: 360px) {
  .archive-title {
    display: none;
  }

  .archive-head {
    padding-left: 12px;
  }

  .tab {
    padding: 6px 4px;
  }
}
</style>
