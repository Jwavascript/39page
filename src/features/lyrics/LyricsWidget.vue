<script setup lang="ts">
/**
 * 가사 위젯 (ADR 0046) — 지금 곡의 가사를 LRCLIB 에서 받아, 싱크 가사면 지금 줄을 밝히고 칸 안에서 따라 내린다.
 *
 * 넓은 화면은 영상 · 재생 카드 **아래**, 두 열은 데크 **아래**(`WidgetHost`). 칸의 높이는 배치가 정하고 이 위젯은
 * 그 안에서만 스크롤한다 — 가사 길이가 대시보드 높이를 바꾸지 않는다.
 *
 * 자동으로 못 찾으면(일본어 · 한국어 제목은 LRCLIB 검색이 못 맞춘다) 돋보기로 직접 찾아 고른다. 고른 것은 그 곡에
 * 기억된다. 가사 글자는 텍스트로만 넣는다(`{{ }}`).
 */
import { computed, nextTick, ref, watch } from 'vue'

import { usePlaybackStore } from '@/stores/playback'

import { LRCLIB_ORIGIN, type LyricsRecord } from './lrclibClient'
import { cleanTitle } from './matchLyrics'
import { useLyrics } from './useLyrics'

const playback = usePlaybackStore()
const lyrics = useLyrics()

const body = ref<HTMLElement | null>(null)
const searchOpen = ref(false)
const query = ref('')
const queryInput = ref<HTMLInputElement | null>(null)

const source = computed(() => {
  const record = lyrics.record.value
  if (record === null) return ''
  return [record.trackName, record.artistName].filter((part) => part !== '').join(' · ')
})

const message = computed(() => {
  switch (lyrics.status.value) {
    case 'idle':
      return '재생 중인 곡이 없어요.'
    case 'searching':
      return '가사를 찾는 중…'
    case 'not-found':
      return '가사를 찾지 못했어요.'
    case 'rate-limited':
      return '잠시 뒤 다시 찾아볼게요.'
    case 'error':
      return '가사를 불러오지 못했어요.'
    case 'ready':
      return lyrics.instrumental.value ? '연주곡이에요.' : ''
  }
  return ''
})

const formatDuration = (seconds: number) =>
  `${String(Math.floor(seconds / 60))}:${String(Math.round(seconds % 60)).padStart(2, '0')}`

function resultLabel(record: LyricsRecord): string {
  const kind = record.syncedLyrics !== null ? '싱크' : record.instrumental ? '연주곡' : '가사'
  return `${record.artistName} · ${formatDuration(record.duration)} · ${kind}`
}

async function toggleSearch(): Promise<void> {
  searchOpen.value = !searchOpen.value
  if (!searchOpen.value) return
  if (query.value === '') query.value = cleanTitle(playback.currentTrack?.title ?? '')
  await nextTick()
  queryInput.value?.focus()
  queryInput.value?.select()
}

function choose(record: LyricsRecord): void {
  lyrics.choose(record)
  searchOpen.value = false
}

/* 지금 줄을 칸 가운데로 — 사용자가 방금 손으로 내렸으면 잠시 두고 본다. */
let userScrolledAt = 0
function onUserScroll(): void {
  userScrolledAt = Date.now()
}

watch(
  () => lyrics.active.value,
  async (index) => {
    if (index < 0 || Date.now() - userScrolledAt < 4000) return
    await nextTick()
    const box = body.value
    const line = box?.querySelector<HTMLElement>(`[data-line="${String(index)}"]`)
    if (box === null || box === undefined || line === null || line === undefined) return
    const reduce =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const top = line.offsetTop - box.clientHeight / 2 + line.offsetHeight / 2
    if (typeof box.scrollTo === 'function') {
      box.scrollTo({ top: Math.max(0, top), behavior: reduce ? 'auto' : 'smooth' })
    } else {
      box.scrollTop = Math.max(0, top)
    }
  },
)

// 곡이 바뀌면 맨 위로, 검색 칸은 닫는다.
watch(
  () => playback.currentTrack?.videoId ?? null,
  () => {
    searchOpen.value = false
    query.value = ''
    if (body.value !== null) body.value.scrollTop = 0
    userScrolledAt = 0
  },
)
</script>

<template>
  <section class="lyrics-widget" aria-labelledby="lyrics-widget-title">
    <div class="widget-head">
      <div class="head-text">
        <h2 id="lyrics-widget-title" class="widget-title">
          LYRICS
          <a class="credit" :href="LRCLIB_ORIGIN" target="_blank" rel="noopener noreferrer"
            >LRCLIB</a
          >
        </h2>
        <p v-if="source !== ''" class="widget-sub" :title="source">
          {{ source }}<template v-if="lyrics.picked.value"> · 직접 고름</template>
        </p>
      </div>
      <button
        type="button"
        class="icon-button"
        :aria-expanded="searchOpen"
        aria-controls="lyrics-search"
        aria-label="가사 직접 찾기"
        title="가사 직접 찾기"
        :disabled="playback.currentTrack === null"
        data-lyrics-search
        @click="toggleSearch"
      >
        <span class="ui-icon ui-icon--search" aria-hidden="true"></span>
      </button>
    </div>

    <div v-if="searchOpen" id="lyrics-search" class="search">
      <form class="search-form" role="search" @submit.prevent="lyrics.searchManually(query)">
        <input
          ref="queryInput"
          v-model="query"
          class="search-input"
          type="search"
          aria-label="가사 검색어 (영어 제목 · 가수)"
          placeholder="영어 제목 · 가수"
          maxlength="120"
        />
        <button
          type="submit"
          class="pill"
          :disabled="query.trim() === '' || lyrics.searchStatus.value === 'searching'"
        >
          찾기
        </button>
      </form>
      <p v-if="lyrics.searchStatus.value === 'searching'" class="note" role="status">찾는 중…</p>
      <p
        v-else-if="lyrics.searchStatus.value === 'done' && lyrics.results.value.length === 0"
        class="note"
        role="status"
      >
        결과가 없어요. 영어 제목으로 찾아 보세요.
      </p>
      <p v-else-if="lyrics.searchStatus.value === 'rate-limited'" class="note" role="status">
        잠시 뒤 다시 찾아 주세요.
      </p>
      <p v-else-if="lyrics.searchStatus.value === 'error'" class="note" role="status">
        찾지 못했어요.
      </p>
      <ul v-if="lyrics.results.value.length > 0" class="results">
        <li v-for="result in lyrics.results.value" :key="result.id">
          <button
            type="button"
            class="result"
            :data-lyrics-result="result.id"
            @click="choose(result)"
          >
            <span class="result-name">{{ result.trackName }}</span>
            <span class="result-meta">{{ resultLabel(result) }}</span>
          </button>
        </li>
      </ul>
      <button
        v-if="lyrics.picked.value"
        type="button"
        class="text-button"
        data-lyrics-auto
        @click="(lyrics.clearChoice(), (searchOpen = false))"
      >
        자동으로 찾기
      </button>
    </div>

    <div
      ref="body"
      class="lyrics-body"
      tabindex="0"
      aria-label="가사"
      @wheel.passive="onUserScroll"
      @touchmove.passive="onUserScroll"
      @keydown="onUserScroll"
    >
      <ol v-if="lyrics.lines.value.length > 0" class="lines">
        <li
          v-for="(line, index) in lyrics.lines.value"
          :key="`${String(index)}-${String(line.time)}`"
          class="line"
          :class="{
            'is-active': index === lyrics.active.value,
            'is-past': index < lyrics.active.value,
          }"
          :aria-current="index === lyrics.active.value ? 'true' : undefined"
          :data-line="index"
        >
          {{ line.text === '' ? '♪' : line.text }}
        </li>
      </ol>
      <p v-else-if="lyrics.plain.value.length > 0" class="plain">
        {{ lyrics.plain.value.join('\n') }}
      </p>
      <p v-if="message !== ''" class="message" role="status" aria-live="polite">
        {{ message }}
        <button
          v-if="lyrics.status.value === 'error'"
          type="button"
          class="text-button"
          @click="lyrics.retry()"
        >
          다시
        </button>
      </p>
    </div>
  </section>
</template>

<style scoped>
.lyrics-widget {
  position: relative;
  display: flex;
  min-width: 0;
  /* 높이는 배치(그리드 칸)가 준다 — 넓은 화면 · 두 열은 늘이기(stretch), 한 열은 고정 높이. */
  min-height: 0;
  flex-direction: column;
  gap: 8px;
}

.widget-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
}

.head-text {
  min-width: 0;
  flex: 1 1 0;
}

.widget-title {
  margin: 0;
  color: var(--drawer-title-text-color);
  font: 13px var(--font-mono);
  font-weight: 400;
  letter-spacing: 0.1em;
}

.widget-sub {
  margin: 6px 0 0;
  overflow: hidden;
  color: var(--drawer-sub-text-color);
  font: 11px var(--font-mono);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.search {
  display: grid;
  gap: 6px;
}

.search-form {
  display: flex;
  gap: 6px;
}

.search-input {
  min-width: 0;
  min-height: 40px;
  flex: 1;
  padding: 0 10px;
  border: 1px solid var(--field-border-color);
  border-radius: var(--radius-control);
  background: var(--field-surface-color);
  color: var(--field-text-color);
  font-size: 13px;
}

.pill {
  min-height: 40px;
  flex: none;
  padding: 0 14px;
  border: 1px solid var(--pill-border-color);
  border-radius: var(--radius-control);
  background: var(--pill-surface-color);
  color: var(--pill-text-color);
  font: 12px var(--font-mono);
}

.pill:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

.results {
  display: grid;
  max-height: 180px;
  margin: 0;
  padding: 0;
  overflow-y: auto;
  gap: 4px;
  list-style: none;
  overscroll-behavior: contain;
}

.result {
  display: grid;
  width: 100%;
  min-height: 44px;
  padding: 6px 10px;
  border: 1px solid var(--row-border-color);
  border-radius: var(--radius-control);
  background: var(--row-surface-color);
  color: var(--row-text-color);
  gap: 2px;
  text-align: left;
}

@media (hover: hover) {
  .result:hover {
    border-color: var(--row-selected-border-color);
  }
}

.result-name {
  overflow: hidden;
  font-size: 13px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.result-meta {
  color: var(--row-meta-text-color);
  font: 11px var(--font-mono);
}

.text-button {
  min-height: 32px;
  padding: 0 4px;
  border: 0;
  background: none;
  color: var(--accent-color);
  font: 12px var(--font-mono);
  text-decoration: underline;
  text-underline-offset: 3px;
  justify-self: start;
}

.note {
  margin: 0;
  color: var(--drawer-sub-text-color);
  font: 11px/1.6 var(--font-mono);
}

/* 가사 칸 — 배치가 준 높이 안에서만 스크롤한다. */
.lyrics-body {
  position: relative;
  min-height: 0;
  flex: 1 1 0;
  padding: 2px 6px 2px 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-color: var(--line-color) transparent;
  scrollbar-width: thin;
}

.lyrics-body:focus-visible {
  outline: var(--focus-ring-width) solid var(--focus-ring-color);
  outline-offset: 2px;
}

.lines {
  display: grid;
  margin: 0;
  padding: 0;
  gap: 6px;
  list-style: none;
}

.line {
  color: var(--text-muted-color);
  font-size: 15px;
  line-height: 1.5;
  overflow-wrap: anywhere;
  transition: color 0.2s ease;
}

.line.is-past {
  color: var(--text-dim-color);
}

.line.is-active {
  color: var(--now-title-text-color);
  font-weight: 600;
}

.plain {
  margin: 0;
  color: var(--text-muted-color);
  font-size: 14px;
  line-height: 1.7;
  overflow-wrap: anywhere;
  white-space: pre-line;
}

.message {
  margin: 0;
  color: var(--drawer-muted-text-color);
  font: 12px/1.6 var(--font-mono);
}

/* 가사 출처 — 제목 옆 작은 링크. */
.credit {
  margin-left: 8px;
  color: var(--text-dim-color);
  font: 10px var(--font-mono);
  letter-spacing: 0.06em;
  text-decoration: none;
}

@media (prefers-reduced-motion: reduce) {
  .line {
    transition: none;
  }
}
</style>
