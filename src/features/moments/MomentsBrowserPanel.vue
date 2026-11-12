<script setup lang="ts">
/**
 * 보관함 "Moments" 탭 — Moments 보관함 (M11-2 골격 → M11-4 완성, `M11_UX_DESIGN.md` §5-2).
 *
 * 무엇을 보일지는 `useMomentsArchive` 가 정한다 (검색 · 보기 · 접기 · 점진 표시 · 목록으로 가기).
 * 이 컴포넌트는 도구 줄(검색 · 보기 · 결과 수 · 안내)과 목록, 그리고 "더 보기" 를 배치한다.
 *
 * - 도구 줄은 보관함 스크롤 안에서 **위에 붙어 있다**(sticky) — 긴 목록 아래에서 메모를 고쳐도 성공 ·
 *   실패 안내가 화면에 보인다. 스크롤은 여전히 보관함 하나뿐이다.
 * - 끝에 닿으면 다음 묶음 30개를 그린다(`IntersectionObserver`). 같은 일을 하는 단추도 늘 있다 —
 *   키보드 · 화면 낭독기 사용자를 위해서, 그리고 관찰자가 없는 환경을 위해서.
 *
 * 저장(이 순간 저장)은 여기 없다 — 지금 재생 중인 곡을 보며 누르는 일이라 대시보드에 남는다.
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

import { MAX_MOMENT_NOTE_LENGTH } from '@/stores/moments'

import MomentList from './MomentList.vue'
import MomentsStatusBanner from './MomentsStatusBanner.vue'
import { GROUP_PAGE_SIZE, RECENT_PAGE_SIZE, SEARCH_ROW_LIMIT } from './momentsSearch'
import { useMomentsArchive } from './useMomentsArchive'

const props = defineProps<{
  /** 바뀔 때마다 그 영상의 Moments 만 보인다 (음악 탭 곡 행의 ◆ 배지 · 대시보드 "이 곡 모두 보기"). */
  focusRequest?: { videoId: string; seq: number } | null
}>()

const archive = useMomentsArchive()
const browser = archive.browser

watch(
  () => props.focusRequest?.seq,
  () => {
    if (props.focusRequest != null) archive.focusVideo(props.focusRequest.videoId)
  },
  { immediate: true },
)

const VIEWS = [
  { key: 'all', label: '전체' },
  { key: 'recent', label: '최근' },
  { key: 'current', label: '이 곡' },
] as const

function chipLabel(key: (typeof VIEWS)[number]['key']): string {
  if (key === 'all') return `전체 ${String(browser.total.value)}`
  if (key === 'current') return `이 곡 ${String(browser.currentCount.value)}`
  return '최근'
}

/** 결과 한 줄 — 검색 · 한 곡 보기일 때만. 화면 낭독기에 알린다(polite). */
const summary = computed<string>(() => {
  if (browser.total.value === 0) return ''
  const moments = archive.matchedMoments.value
  const songs = archive.matchedSongs.value
  if (archive.searching.value) {
    if (moments === 0) return '맞는 순간이 없어요. 제목이나 메모의 다른 낱말로 찾아보세요.'
    const base = `순간 ${String(moments)}개 · 곡 ${String(songs)}개`
    return archive.truncated.value
      ? `${base} — 앞의 ${String(SEARCH_ROW_LIMIT)}개만 보여요. 검색어를 좁혀 주세요.`
      : base
  }
  return ''
})

const emptyMessage = computed<string>(() => {
  if (browser.total.value === 0 || archive.searching.value) return ''
  if (archive.view.value === 'current' && browser.currentVideoId.value === null)
    return '지금 재생 중인 곡이 없어요.'
  if (archive.view.value === 'current' || archive.view.value === 'video')
    return '이 곡에 저장한 순간이 없어요.'
  return ''
})

const moreLabel = computed<string>(() => {
  const left = archive.remaining.value
  if (archive.view.value === 'recent')
    return `순간 ${String(Math.min(RECENT_PAGE_SIZE, left))}개 더 보기 · 남은 ${String(left)}개`
  return `곡 ${String(Math.min(GROUP_PAGE_SIZE, left))}개 더 보기 · 남은 ${String(left)}곡`
})

/* ── 검색란 ──────────────────────────────────────────────────────── */
const searchInput = ref<HTMLInputElement | null>(null)

/** Esc — 검색어가 있으면 지우기만 한다 (보관함을 닫지 않는다). 없으면 셸이 보관함을 닫는다. */
function onSearchKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape' && archive.query.value !== '') {
    event.preventDefault()
    archive.clearQuery()
  } else if (event.key === 'Enter') {
    event.preventDefault()
    archive.applyQueryNow()
  }
}

function focusSearch(): void {
  searchInput.value?.focus()
}

/* ── 더 보기 ─────────────────────────────────────────────────────── */
const listRoot = ref<HTMLElement | null>(null)

/** 단추로 더 그렸으면 새로 나타난 첫 항목으로 포커스를 옮긴다 — 키보드로 이어서 읽게. */
function showMoreByButton(): void {
  const selector = archive.view.value === 'recent' ? '.moment-play' : '.group-toggle'
  const before = listRoot.value?.querySelectorAll(selector).length ?? 0
  if (archive.showMore() === 0) return
  void nextTick(() => listRoot.value?.querySelectorAll<HTMLElement>(selector)[before]?.focus())
}

/* 끝에 닿으면 자동으로 — 스크롤 안의 표지(sentinel)를 본다. */
const sentinel = ref<HTMLElement | null>(null)
let observer: IntersectionObserver | null = null

function observe(): void {
  if (observer === null || sentinel.value === null) return
  // 다시 관찰하면 관찰자가 지금 상태를 한 번 알려 준다 — 더 그린 뒤에도 끝이 보이면 이어서 그린다.
  observer.unobserve(sentinel.value)
  observer.observe(sentinel.value)
}

/*
 * 도구 줄이 붙어 있으면(넓고 높은 화면) 보관함 스크롤의 위 여백을 그 높이로 — 키보드 포커스와
 * `scrollIntoView` 가 도구 줄 아래로 숨지 않게 한다. 붙지 않으면 여백을 두지 않는다.
 */
const tools = ref<HTMLElement | null>(null)
let toolsObserver: ResizeObserver | null = null

function syncScrollPadding(): void {
  const scroller = listRoot.value?.closest<HTMLElement>('.archive-body') ?? null
  const el = tools.value
  if (scroller === null || el === null) return
  const stuck = getComputedStyle(el).position === 'sticky'
  scroller.style.scrollPaddingTop = stuck
    ? `${String(Math.ceil(el.getBoundingClientRect().height))}px`
    : ''
}

onMounted(() => {
  if (typeof ResizeObserver === 'function' && tools.value !== null) {
    toolsObserver = new ResizeObserver(syncScrollPadding)
    toolsObserver.observe(tools.value)
  }
  window.addEventListener('resize', syncScrollPadding)
})

onMounted(() => {
  if (typeof IntersectionObserver !== 'function') return
  const scroller = listRoot.value?.closest<HTMLElement>('.archive-body') ?? null
  observer = new IntersectionObserver(
    (entries) => {
      if (entries.some((entry) => entry.isIntersecting) && archive.showMore() > 0) {
        void nextTick(observe)
      }
    },
    { root: scroller, rootMargin: '0px 0px 600px 0px' },
  )
  void nextTick(observe)
})

watch(sentinel, (_now, before) => {
  if (before != null) observer?.unobserve(before)
  void nextTick(observe)
})

onBeforeUnmount(() => {
  observer?.disconnect()
  observer = null
  toolsObserver?.disconnect()
  toolsObserver = null
  window.removeEventListener('resize', syncScrollPadding)
  const scroller = listRoot.value?.closest<HTMLElement>('.archive-body') ?? null
  if (scroller !== null) scroller.style.scrollPaddingTop = ''
})

defineExpose({ archive })
</script>

<template>
  <section ref="listRoot" class="moments-browser" aria-labelledby="archive-moments-title">
    <div ref="tools" class="tools">
      <h3 id="archive-moments-title" class="section-title">
        MOMENTS <span class="count">{{ browser.total.value }}개</span>
      </h3>

      <MomentsStatusBanner />

      <template v-if="browser.total.value > 0">
        <input
          id="archive-moments-search"
          ref="searchInput"
          v-model="archive.query.value"
          class="search"
          type="search"
          enterkeyhint="search"
          autocomplete="off"
          placeholder="제목 · 메모 검색"
          aria-label="Moments 검색 — 제목 · 메모"
          aria-describedby="archive-moments-summary"
          @keydown="onSearchKeydown"
        />

        <div class="filter" role="group" aria-label="보여줄 순간">
          <button
            v-for="item in VIEWS"
            :key="item.key"
            type="button"
            class="pill chip"
            :class="{ 'pill--strong': archive.view.value === item.key }"
            :aria-pressed="archive.view.value === item.key"
            :disabled="item.key === 'current' && browser.currentVideoId.value === null"
            @click="archive.setView(item.key)"
          >
            {{ chipLabel(item.key) }}
          </button>
        </div>

        <p v-if="archive.view.value === 'video'" class="focus-line">
          <span
            >‘{{ archive.focusTitle.value ?? archive.focusVideoId.value }}’ 의 순간만 보는 중</span
          >
          <button type="button" class="link" @click="archive.setView('all')">전체 보기</button>
        </p>
      </template>

      <p
        id="archive-moments-summary"
        class="summary"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {{ summary }}
      </p>
    </div>

    <p v-if="browser.total.value === 0" class="empty">
      아직 저장한 순간이 없어요.<br />곡을 듣다가 대시보드의 ＋ 이 순간 저장을 눌러보세요.
    </p>
    <p v-else-if="archive.sections.value.length === 0 && emptyMessage !== ''" class="empty">
      {{ emptyMessage }}
    </p>
    <MomentList
      v-else-if="archive.sections.value.length > 0"
      id-prefix="archive-moment"
      :sections="archive.sections.value"
      :terms="archive.terms.value"
      :max-note-length="MAX_MOMENT_NOTE_LENGTH"
      :save-note="browser.saveNote"
      @play="(id) => void browser.play(id)"
      @remove="(id) => void browser.remove(id)"
      @toggle="archive.toggleGroup"
      @more-rows="archive.showMoreRows"
      @open-list="(listId, videoId) => void archive.openInLibrary(listId, videoId)"
      @focus-out="focusSearch"
    />

    <div v-if="archive.remaining.value > 0" ref="sentinel" class="more">
      <button type="button" class="pill" @click="showMoreByButton">{{ moreLabel }}</button>
    </div>

    <!--
      수정 · 삭제 결과 — 보관함 스크롤의 **아래 끝에 붙는다** (M11-6). 모바일에서는 도구 줄이 붙지 않아, 목록
      아래쪽에서 지우면 위쪽의 안내가 화면 밖에 있었다(M11-4 남은 위험). 어느 크기에서도 보이는 자리다.
    -->
    <p
      class="feedback"
      :class="{ 'is-warning': browser.feedback.value?.tone === 'warning' }"
      role="status"
      aria-live="polite"
    >
      {{ browser.feedback.value?.text ?? '' }}
    </p>
  </section>
</template>

<style scoped>
.moments-browser {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 10px;
}

.tools {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

/*
 * 도구 줄을 위에 붙이는 것은 **넉넉한 데스크톱에서만**이다. 실측(2026-11-12)에서 도구 줄은 150px —
 * 1440×900 에서 보관함 높이의 20% 지만 390×844 에서 30%, 360×740 에서 38% 였다. 작은 화면에서
 * 붙이면 목록이 볼 자리를 빼앗고 그 아래로 줄이 숨는다. 붙일 때는 스크롤 여백(scroll-padding)을
 * 도구 줄 높이만큼 주어 포커스 · 찾아가기가 도구 줄 아래에 숨지 않게 한다 (스크립트, WCAG 2.4.11).
 * 보관함 본문의 안쪽 여백(16px)만큼 끌어올려 붙이고, 배경은 보관함 표면색이다.
 */
@media (min-width: 901px) and (min-height: 760px) {
  .tools {
    position: sticky;
    z-index: 1;
    top: -16px;
    margin: -16px -16px 0;
    padding: 16px 16px 8px;
    border-bottom: 1px solid var(--drawer-head-border-color);
    background: var(--drawer-surface-color);
  }
}

.section-title {
  margin: 0;
  color: var(--drawer-section-title-text-color);
  font: 11px var(--font-mono);
  font-weight: 400;
  letter-spacing: 0.12em;
}

.count {
  margin-left: 6px;
  color: var(--drawer-sub-text-color);
}

/* 승인된 디자인의 `.field` 값을 따른다. 44px. */
.search {
  display: block;
  width: 100%;
  min-height: 44px;
  padding: 10px;
  border: 1px solid var(--field-border-color);
  border-radius: var(--radius-field);
  background: var(--field-surface-color);
  color: var(--field-text-color);
  font-size: 13px;
}

.filter {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.pill {
  min-height: 44px;
  padding: 7px 14px;
  border: 1px solid var(--pill-border-color);
  border-radius: var(--radius-control);
  background: var(--pill-surface-color);
  color: var(--pill-text-color);
  font: 12px var(--font-mono);
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

.focus-line {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  margin: 0;
  color: var(--drawer-body-text-color);
  font: 11px/1.5 var(--font-mono);
  gap: 0 8px;
  overflow-wrap: anywhere;
}

.link {
  min-height: 44px;
  padding: 0 6px;
  border: 0;
  background: transparent;
  color: var(--drawer-action-text-color);
  font: 11px var(--font-mono);
  text-decoration: underline;
  text-underline-offset: 3px;
}

.summary,
.feedback {
  margin: 0;
  color: var(--drawer-sub-text-color);
  font: 11px/1.6 var(--font-mono);
}

.summary:empty,
.feedback:empty {
  display: none;
}

.feedback.is-warning {
  color: var(--status-warning-text-color);
}

/* 아래 끝에 붙는 결과 줄 — 보관함 본문의 안쪽 여백만큼 내려 붙인다. 배경은 보관함 표면색. */
.feedback {
  position: sticky;
  z-index: 1;
  bottom: -16px;
  margin: 0 -16px -16px;
  padding: 10px 16px;
  border-top: 1px solid var(--drawer-head-border-color);
  background: var(--drawer-surface-color);
}

.empty {
  margin: 0;
  color: var(--drawer-muted-text-color);
  font-size: 12px;
  line-height: 1.7;
}

.more {
  display: flex;
  justify-content: center;
  padding: 4px 0 8px;
}
</style>
