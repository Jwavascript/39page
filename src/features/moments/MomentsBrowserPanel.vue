<script setup lang="ts">
/**
 * 보관함 "Moments" 탭 — Moments 보관함 (M11-2 골격 → M11-4 완성, `M11_UX_DESIGN.md` §5-2).
 *
 * 무엇을 보일지는 `useMomentsArchive` 가 정한다 (검색 · 보기 · 접기 · 점진 표시 · 목록으로 가기).
 * 이 컴포넌트는 두 칸과 그 안의 배치만 맡는다.
 *
 * ADR 0044 — **음악 탭처럼 두 칸**이다. 전에는 검색 · 보기 칩 · 머리가 목록 위에 붙어 있어 순간이 보이는 칸이
 * 낮았다.
 * - 왼쪽 칸: 검색, 보기(이 곡 · 전체 · 최근), 그리고 순간이 있는 **곡 목록**(곡 이름 · 개수). 곡을 누르면
 *   오른쪽에 그 곡의 순간만 보인다.
 * - 오른쪽 칸: 고른 것의 머리(곡 이름 · 개수 · 그 곡이 든 목록) 아래로 순간 목록이 칸 높이를 다 쓴다. 이 곡
 *   보기에서는 머리 아래에 ＋ 이 순간 저장이 있다.
 * - 두 칸은 각자 스크롤한다. 보관함이 좁으면(640px 이하) 한 번에 한 칸 — 오른쪽 칸의 ‹ 로 왼쪽 칸에 간다.
 * - 끝에 닿으면 다음 묶음을 그린다(`IntersectionObserver`). 같은 일을 하는 단추도 늘 있다 — 키보드 · 화면
 *   낭독기 사용자를 위해서, 그리고 관찰자가 없는 환경을 위해서.
 */
import { computed, inject, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

import { SHARE_DIALOG } from '@/shared/types/share'

import { useMomentDraftStore } from '@/stores/momentDraft'
import { MAX_MOMENT_NOTE_LENGTH } from '@/stores/moments'

import MomentCapture from './MomentCapture.vue'
import MomentList from './MomentList.vue'
import MomentsStatusBanner from './MomentsStatusBanner.vue'
import { GROUP_PAGE_SIZE, highlight, RECENT_PAGE_SIZE, SEARCH_ROW_LIMIT } from './momentsSearch'
import { useMomentsArchive } from './useMomentsArchive'

/** 공유 대화상자 (ADR 0040) — 셸이 내려 준다. 없으면(단독 마운트) 공유 아이콘을 보이지 않는다. */
const shareDialog = inject(SHARE_DIALOG, null)

const props = defineProps<{
  /** 바뀔 때마다 그 영상의 Moments 만 보인다 (음악 탭 곡 행의 ◆ 배지 · 대시보드 "이 곡 모두 보기"). */
  focusRequest?: { videoId?: string; view?: 'all'; seq: number } | null
}>()

const archive = useMomentsArchive()
const browser = archive.browser
/** 저장 전 초안 — 대시보드와 같은 하나 (M11-7C). 있으면 곡이 없어도 이 곡 보기에서 이어 쓸 수 있다. */
const draftStore = useMomentDraftStore()
const hasDraft = computed<boolean>(() => draftStore.draft !== null)
const archiveCapture = ref<InstanceType<typeof MomentCapture> | null>(null)

/** 좁은 보관함의 단계 — 왼쪽 칸(`nav`) 또는 오른쪽 칸(`detail`). 넓으면 둘 다 보인다. */
const step = ref<'nav' | 'detail'>('detail')

watch(
  () => props.focusRequest?.seq,
  () => {
    const request = props.focusRequest
    if (request?.view === 'all') {
      archive.clearQuery()
      archive.setView('all')
      step.value = 'detail'
    } else if (request?.videoId !== undefined) {
      archive.focusVideo(request.videoId)
      step.value = 'detail'
    }
  },
  { immediate: true },
)

/** 왼쪽 칸의 보기 — 이 곡 → 전체 → 최근 (M11-7C). 이 곡은 곡이 재생 중이거나 초안이 있을 때만. */
const VIEWS = [
  { key: 'current', label: '이 곡' },
  { key: 'all', label: '전체' },
  { key: 'recent', label: '최근' },
] as const

const canCurrent = computed<boolean>(() => browser.currentVideoId.value !== null || hasDraft.value)

function viewCount(key: (typeof VIEWS)[number]['key']): string {
  if (key === 'all') return String(browser.total.value)
  if (key === 'current') return String(browser.currentCount.value)
  return ''
}

/* ── 왼쪽 칸: 곡 목록 (점진 표시) ─────────────────────────────────── */
const SONG_PAGE_SIZE = 100
const songLimit = ref(SONG_PAGE_SIZE)
watch(
  () => archive.terms.value.join(' '),
  () => {
    songLimit.value = SONG_PAGE_SIZE
  },
)
const shownSongs = computed(() => archive.songs.value.slice(0, songLimit.value))
const hiddenSongs = computed<number>(() =>
  Math.max(0, archive.songs.value.length - songLimit.value),
)

/** 이 곡을 오른쪽 칸에서 보고 있는가 — 지금 곡이면 이 곡 보기도 그 곡이다. */
function isSongSelected(videoId: string): boolean {
  const view = archive.view.value
  if (view === 'video') return archive.focusVideoId.value === videoId
  return view === 'current' && browser.currentVideoId.value === videoId
}

const navRoot = ref<HTMLElement | null>(null)
const backButton = ref<HTMLButtonElement | null>(null)

/** 좁은 보관함(한 번에 한 칸)인가 — ‹ 단추가 보일 때다. */
function isStacked(): boolean {
  const el = backButton.value
  return el !== null && getComputedStyle(el).display !== 'none'
}

/** 오른쪽 칸으로 — 좁으면 단계를 바꾸고 ‹ 로 포커스를 옮긴다. 넓으면 누른 자리에 포커스를 둔다. */
function showDetail(): void {
  step.value = 'detail'
  void nextTick(() => {
    if (isStacked()) backButton.value?.focus()
  })
}

function selectView(key: (typeof VIEWS)[number]['key']): void {
  archive.setView(key)
  showDetail()
}

function selectSong(videoId: string): void {
  archive.focusVideo(videoId, { keepQuery: true })
  showDetail()
}

function showNav(): void {
  step.value = 'nav'
  void nextTick(() =>
    (
      navRoot.value?.querySelector<HTMLElement>('[aria-current="true"]') ??
      navRoot.value?.querySelector<HTMLElement>('.nav-item')
    )?.focus(),
  )
}

/* ── 오른쪽 칸 ────────────────────────────────────────────────────── */

/** 이 곡 보기에서 방금 저장한 순간 — 그 줄을 강조하고 보이게 한다. 보기 · 곡이 바뀌면 거둔다. */
const highlightId = ref<string | null>(null)
watch([() => archive.view.value, () => browser.currentVideoId.value], () => {
  highlightId.value = null
})

const detail = ref<HTMLElement | null>(null)

function onSaved(momentId: string): void {
  browser.clearFeedback()
  highlightId.value = momentId
  void nextTick(() => {
    const row = detail.value?.querySelector<HTMLElement>(`[data-moment-id="${momentId}"]`)
    // 칸 안에서만 — 줄이 칸 밖일 때만 옮긴다.
    if (typeof row?.scrollIntoView === 'function') row.scrollIntoView({ block: 'nearest' })
  })
}

/** 이 곡 보기 — 곡이 재생 중이어야 저장 · 관리할 수 있다. 저장 전 초안이 있으면 그것을 이어 쓴다. */
const showCurrentHead = computed<boolean>(
  () =>
    archive.view.value === 'current' && (browser.currentVideoId.value !== null || hasDraft.value),
)

/** 오른쪽 칸의 제목 — 곡이면 곡 이름, 아니면 보기 이름. */
const detailTitle = computed<string>(() => {
  const head = archive.songHead.value
  if (head !== null) return head.title
  if (archive.view.value === 'current') return draftStore.draft?.title ?? '이 곡'
  return archive.view.value === 'recent' ? '최근' : '전체'
})

/** 오른쪽 칸의 개수 줄 — 검색 중이면 맞는 수 / 전체 수. */
const detailMeta = computed<string>(() => {
  const head = archive.songHead.value
  if (head !== null) {
    const count =
      archive.searching.value && head.matched !== head.total
        ? `${String(head.matched)} / ${String(head.total)}개`
        : `${String(head.total)}개`
    return head.isCurrent ? `${count} · ♪ 재생 중` : count
  }
  if (archive.view.value === 'current') return ''
  const moments = archive.matchedMoments.value
  return archive.searching.value
    ? `${String(moments)}개 · 곡 ${String(archive.matchedSongs.value)}개`
    : `${String(moments)}개`
})

/** 결과 한 줄 — 검색할 때만. 화면 낭독기에 알린다(polite). */
const summary = computed<string>(() => {
  if (browser.total.value === 0 || !archive.searching.value) return ''
  if (archive.songs.value.length === 0) return '맞는 순간이 없어요.'
  const moments = archive.songs.value.reduce((sum, song) => sum + song.matched, 0)
  const base = `순간 ${String(moments)}개 · 곡 ${String(archive.songs.value.length)}개`
  return archive.truncated.value ? `${base} — 앞의 ${String(SEARCH_ROW_LIMIT)}개만 보여요.` : base
})

const emptyMessage = computed<string>(() => {
  if (browser.total.value === 0 && !showCurrentHead.value) return '아직 저장한 순간이 없어요.'
  if (archive.searching.value) return '맞는 순간이 없어요.'
  if (archive.view.value === 'current' && !showCurrentHead.value) return '재생 중인 곡이 없어요.'
  if (archive.view.value === 'current' || archive.view.value === 'video')
    return '저장한 순간이 없어요.'
  return ''
})

/*
 * 영상 띠의 "이 곡에서 이어 쓰기" (M11-7C) — 이 곡 보기로 와서 초안의 메모 입력란으로 간다. 보관함이
 * 이 패널을 처음 그리는 경우에도 받도록 즉시 본다.
 */
watch(
  () => draftStore.resumeRequest,
  (seq, before) => {
    if (seq === 0 || seq === before || !hasDraft.value) return
    archive.setView('current')
    step.value = 'detail'
    void nextTick(() => archiveCapture.value?.focusNote())
  },
  { immediate: true },
)

const moreLabel = computed<string>(() => {
  const left = archive.remaining.value
  if (archive.view.value === 'all')
    return `곡 ${String(Math.min(GROUP_PAGE_SIZE, left))}개 더 보기 · 남은 ${String(left)}곡`
  return `순간 ${String(Math.min(RECENT_PAGE_SIZE, left))}개 더 보기 · 남은 ${String(left)}개`
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

/** 지운 뒤 갈 곳이 없으면 — 좁으면 ‹, 넓으면 검색란(없으면 첫 보기). */
function focusOut(): void {
  if (isStacked()) {
    backButton.value?.focus()
    return
  }
  ;(searchInput.value ?? navRoot.value?.querySelector<HTMLElement>('.nav-item'))?.focus()
}

/* ── 더 보기 ─────────────────────────────────────────────────────── */

/** 단추로 더 그렸으면 새로 나타난 첫 항목으로 포커스를 옮긴다 — 키보드로 이어서 읽게. */
function showMoreByButton(): void {
  const selector = archive.view.value === 'all' ? '.group-toggle' : '.moment-play'
  const before = detail.value?.querySelectorAll(selector).length ?? 0
  if (archive.showMore() === 0) return
  void nextTick(() => detail.value?.querySelectorAll<HTMLElement>(selector)[before]?.focus())
}

function showMoreSongs(): void {
  const before = navRoot.value?.querySelectorAll('.song-item').length ?? 0
  songLimit.value += SONG_PAGE_SIZE
  void nextTick(() => navRoot.value?.querySelectorAll<HTMLElement>('.song-item')[before]?.focus())
}

/* 끝에 닿으면 자동으로 — 오른쪽 칸 스크롤 안의 표지(sentinel)를 본다. */
const sentinel = ref<HTMLElement | null>(null)
let observer: IntersectionObserver | null = null

function observe(): void {
  if (observer === null || sentinel.value === null) return
  // 다시 관찰하면 관찰자가 지금 상태를 한 번 알려 준다 — 더 그린 뒤에도 끝이 보이면 이어서 그린다.
  observer.unobserve(sentinel.value)
  observer.observe(sentinel.value)
}

onMounted(() => {
  if (typeof IntersectionObserver !== 'function') return
  observer = new IntersectionObserver(
    (entries) => {
      if (entries.some((entry) => entry.isIntersecting) && archive.showMore() > 0) {
        void nextTick(observe)
      }
    },
    { root: detail.value, rootMargin: '0px 0px 600px 0px' },
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
})

function openList(listId: string): void {
  const head = archive.songHead.value
  if (head !== null) void archive.openInLibrary(listId, head.videoId)
}

defineExpose({ archive, step })
</script>

<template>
  <section class="moments-browser" :data-step="step" aria-labelledby="archive-moments-title">
    <!-- ── 왼쪽 칸: 검색 · 보기 · 곡 ─────────────────────────────────── -->
    <div ref="navRoot" class="moments-nav">
      <h3 id="archive-moments-title" class="section-title">
        MOMENTS <span class="count">{{ browser.total.value }}</span>
      </h3>

      <input
        v-if="browser.total.value > 0"
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
      <p
        id="archive-moments-summary"
        class="summary"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {{ summary }}
      </p>

      <ul class="nav-list" aria-label="보기">
        <template v-for="item in VIEWS" :key="item.key">
          <li v-if="item.key !== 'current' || canCurrent">
            <button
              type="button"
              class="nav-item view-item"
              :data-view="item.key"
              :aria-current="archive.view.value === item.key ? 'true' : undefined"
              @click="selectView(item.key)"
            >
              <span class="nav-name">{{ item.label }}</span>
              <span class="nav-meta">{{ viewCount(item.key) }}</span>
            </button>
          </li>
        </template>
      </ul>

      <template v-if="archive.songs.value.length > 0">
        <h4 class="nav-sub">
          곡 <span class="count">{{ archive.songs.value.length }}</span>
        </h4>
        <ul class="nav-list song-list" aria-label="순간이 있는 곡">
          <li v-for="song in shownSongs" :key="song.videoId">
            <button
              type="button"
              class="nav-item song-item"
              :data-song="song.videoId"
              :aria-current="isSongSelected(song.videoId) ? 'true' : undefined"
              @click="selectSong(song.videoId)"
            >
              <span class="nav-name"
                ><template v-for="(part, i) in highlight(song.title, archive.terms.value)" :key="i"
                  ><mark v-if="part.match">{{ part.text }}</mark
                  ><template v-else>{{ part.text }}</template></template
                ></span
              >
              <span class="nav-meta"
                >{{ song.matched === song.total ? song.total : `${song.matched}/${song.total}`
                }}<template v-if="song.isCurrent"> ♪</template></span
              >
            </button>
          </li>
        </ul>
        <button v-if="hiddenSongs > 0" type="button" class="pill more-songs" @click="showMoreSongs">
          곡 {{ Math.min(SONG_PAGE_SIZE, hiddenSongs) }}개 더 보기
        </button>
      </template>
    </div>

    <!-- ── 오른쪽 칸: 고른 것의 순간 ─────────────────────────────────── -->
    <div ref="detail" class="moments-detail">
      <div class="detail-head">
        <button
          ref="backButton"
          type="button"
          class="icon-button back-to-nav"
          aria-label="곡 목록으로"
          title="곡 목록으로"
          @click="showNav"
        >
          <span class="ui-icon ui-icon--back" aria-hidden="true"></span>
        </button>
        <div class="detail-text">
          <h4 class="detail-title">{{ detailTitle }}</h4>
          <p v-if="detailMeta !== ''" class="detail-meta">{{ detailMeta }}</p>
          <p
            v-if="archive.songHead.value !== null && archive.songHead.value.playlists.length > 0"
            class="detail-lists"
          >
            <span class="lists-label">목록</span>
            <button
              v-for="list in archive.songHead.value.playlists.slice(0, 3)"
              :key="list.id"
              type="button"
              class="list-link"
              :data-open-list="list.id"
              :aria-label="`음악 보관함의 ${list.name} 목록에서 ${archive.songHead.value.title} 보기`"
              @click="openList(list.id)"
            >
              {{ list.name }}
            </button>
            <span v-if="archive.songHead.value.playlists.length > 3" class="lists-more">
              외 {{ archive.songHead.value.playlists.length - 3 }}
            </span>
          </p>
        </div>
      </div>

      <MomentsStatusBanner />

      <!-- 이 곡 — 저장은 여기서 한다. 보관함이 열린 영상 띠에는 저장이 없다 (M11-7C). -->
      <div v-if="showCurrentHead" class="current-head">
        <MomentCapture ref="archiveCapture" id-prefix="archive-moment" @saved="onSaved" />
      </div>

      <MomentList
        v-if="archive.sections.value.length > 0"
        id-prefix="archive-moment"
        :sections="archive.sections.value"
        :terms="archive.terms.value"
        :max-note-length="MAX_MOMENT_NOTE_LENGTH"
        :save-note="browser.saveNote"
        :highlight-id="highlightId"
        :can-share="shareDialog !== null"
        @share="(id) => shareDialog?.open({ momentId: id })"
        @play="(id) => void browser.play(id)"
        @remove="(id) => void browser.remove(id)"
        @toggle="archive.toggleGroup"
        @more-rows="archive.showMoreRows"
        @open-list="(listId, videoId) => void archive.openInLibrary(listId, videoId)"
        @focus-out="focusOut"
      />
      <p v-else-if="emptyMessage !== ''" class="empty">{{ emptyMessage }}</p>

      <div v-if="archive.remaining.value > 0" ref="sentinel" class="more">
        <button type="button" class="pill" @click="showMoreByButton">{{ moreLabel }}</button>
      </div>

      <!-- 수정 · 삭제 결과 — 오른쪽 칸 스크롤의 **아래 끝에 붙는다** (M11-6). 어느 크기에서도 보이는 자리다. -->
      <p
        class="feedback"
        :class="{ 'is-warning': browser.feedback.value?.tone === 'warning' }"
        role="status"
        aria-live="polite"
      >
        {{ browser.feedback.value?.text ?? '' }}
      </p>
    </div>
  </section>
</template>

<style scoped>
/* 음악 탭의 두 칸(`ArchivePanel` 의 `.music-layout`)과 같은 비율 · 여백이다. */
.moments-browser {
  display: grid;
  min-width: 0;
  min-height: 0;
  flex: 1 1 auto;
  grid-template-columns: minmax(220px, 0.8fr) minmax(0, 1.6fr);
  grid-template-rows: minmax(0, 1fr);
}

.moments-nav,
.moments-detail {
  display: flex;
  min-width: 0;
  min-height: 0;
  flex-direction: column;
  gap: 10px;
  padding: 14px 12px 14px 16px;
  overflow-y: auto;
  overscroll-behavior: contain;
  /* 스크롤바 자리를 늘 비워 둔다 — 줄이 바뀔 때 목록 전체를 다시 배치하지 않게 (M9-6 성능). */
  scrollbar-gutter: stable;
}

.moments-nav {
  border-right: 1px solid var(--drawer-head-border-color);
}

.section-title,
.nav-sub {
  margin: 0;
  color: var(--drawer-section-title-text-color);
  font: 11px var(--font-mono);
  font-weight: 400;
  letter-spacing: 0.12em;
}

.nav-sub {
  margin-top: 4px;
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
  flex: none;
  padding: 10px;
  border: 1px solid var(--field-border-color);
  border-radius: var(--radius-field);
  background: var(--field-surface-color);
  color: var(--field-text-color);
  font-size: 13px;
}

.nav-list {
  display: grid;
  margin: 0;
  padding: 0;
  gap: 4px;
  list-style: none;
}

/* 음악 탭 목록 칸의 행(`.list-select`)과 같은 모양이다. */
.nav-item {
  display: flex;
  width: 100%;
  min-height: 44px;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 6px 12px;
  border: 1px solid transparent;
  border-radius: var(--radius-control);
  background: var(--row-surface-color);
  color: var(--row-text-color);
  text-align: left;
}

.nav-item[aria-current='true'] {
  border-color: var(--row-selected-border-color);
  background: var(--row-selected-surface-color);
}

/* 긴 곡 이름은 두 줄까지. */
.nav-name {
  display: -webkit-box;
  overflow: hidden;
  min-width: 0;
  font-size: 12px;
  line-height: 1.35;
  overflow-wrap: anywhere;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  line-clamp: 2;
}

.view-item .nav-name {
  font: 12px var(--font-mono);
}

.nav-meta {
  flex: none;
  color: var(--row-meta-text-color);
  font: 11px var(--font-mono);
  font-variant-numeric: tabular-nums;
}

/* ── 오른쪽 칸 ── */
.detail-head {
  display: flex;
  min-width: 0;
  flex: none;
  align-items: flex-start;
  gap: 8px;
  padding-bottom: 10px;
  border-bottom: 1px solid var(--drawer-head-border-color);
}

/* 넓으면 왼쪽 칸이 옆에 있다 — ‹ 는 좁을 때만. */
.back-to-nav {
  display: none;
}

.detail-text {
  min-width: 0;
  flex: 1;
}

.detail-title {
  margin: 0;
  color: var(--drawer-title-text-color);
  font-size: 14px;
  font-weight: 400;
  line-height: 1.4;
  overflow-wrap: anywhere;
}

.detail-meta {
  margin: 2px 0 0;
  color: var(--drawer-sub-text-color);
  font: 11px var(--font-mono);
}

.detail-lists {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  margin: 0;
  color: var(--row-meta-text-color);
  font: 10px var(--font-mono);
  gap: 0 4px;
}

.lists-label {
  margin-right: 2px;
}

.list-link {
  min-width: 44px;
  min-height: 36px;
  padding: 0 6px;
  border: 0;
  background: transparent;
  color: var(--drawer-action-text-color);
  font: 11px var(--font-mono);
  overflow-wrap: anywhere;
  text-decoration: underline;
  text-underline-offset: 3px;
}

.current-head {
  display: flex;
  min-width: 0;
  flex: none;
  flex-direction: column;
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

.more-songs {
  flex: none;
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

/* 아래 끝에 붙는 결과 줄 — 칸의 안쪽 여백만큼 내려 붙인다. 배경은 보관함 표면색. */
.feedback {
  position: sticky;
  z-index: 1;
  bottom: -14px;
  margin: auto -12px -14px -16px;
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
  flex: none;
  justify-content: center;
  padding: 4px 0 8px;
}

/* 검색 강조 — `MomentRow` 와 같다. */
mark {
  background: transparent;
  color: inherit;
  font-weight: 700;
  text-decoration: underline;
  text-decoration-color: var(--accent-color);
  text-decoration-thickness: 2px;
  text-underline-offset: 2px;
}

/* 좁은 보관함 — **두 단계** (음악 탭과 같다). 화면 폭이 아니라 보관함의 폭으로 판단한다. */
@container archive-moments (max-width: 640px) {
  .moments-browser {
    grid-template-columns: minmax(0, 1fr);
  }

  .moments-nav {
    border-right: 0;
  }

  .moments-browser[data-step='nav'] > .moments-detail,
  .moments-browser[data-step='detail'] > .moments-nav {
    display: none;
  }

  .back-to-nav {
    display: inline-grid;
  }
}
</style>
