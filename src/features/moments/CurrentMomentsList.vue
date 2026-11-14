<script setup lang="ts">
/**
 * "이 곡의 Moments" — 지금 재생 중인 곡의 순간을 **시점 순으로 모두** 보인다 (M11-7C, ADR 0030).
 *
 * 표현 컴포넌트다. 무엇을 보일지(그 곡의 순간 · 지금 위치 · 방금 저장한 것)는 부모가 준다. 누르면 그 시점
 * 부터 재생하라고 올린다. 고치기 · 지우기는 없다 — 보관함 Moments › 이 곡의 일이다.
 *
 * - "몇 개만 보이고 모두 보기" 를 하지 않는다. 넓은 화면에서는 **이 칸 안에서** 스크롤하고(높이 고정 ·
 *   페이지로 새지 않음), 더 있음을 흐림과 글로 알린다.
 * - 대시보드의 한 열(700px 이하)은 페이지 스크롤과 겹치지 않게 안쪽 스크롤을 쓰지 않는다 — 앞의 몇 개와
 *   "펼치기". 보관함이 열린 영상 띠(`compact`)는 페이지가 잠기거나 띠가 화면 위라 늘 작은 안쪽 스크롤이다.
 * - **지금** 선: 지금 재생 위치가 순간들 사이 어디인지 시점 순 목록 안에 선을 긋는다 (장식 — 낭독기에는
 *   버튼 이름이 시점을 말한다).
 * - 방금 저장한 순간은 강조하고, 그 줄이 칸 안에 보이게 한다 (페이지는 움직이지 않는다).
 */
import { computed, nextTick, onMounted, ref, watch } from 'vue'

import type { Moment } from '@/shared/types'

import { firstLine, formatMomentTime } from './momentsView'

/** 좁은 대시보드에서 접혀 있을 때 보이는 수. */
const COLLAPSED_MOMENT_COUNT = 4

const props = defineProps<{
  /** 그 곡의 순간 — 시점 순. */
  moments: readonly Readonly<Moment>[]
  /** 지금 재생 위치(초). 모르면 `null` — 선을 긋지 않는다. */
  positionSeconds: number | null
  /** 방금 저장한 순간. */
  highlightId?: string | null
  /** 보관함이 열린 영상 띠 안 — 늘 작은 안쪽 스크롤, 펼치기 없음. */
  compact?: boolean
  /** 단추 이름 앞의 곡 이름 (낭독기용). */
  songTitle?: string
}>()

const emit = defineEmits<{ play: [momentId: string] }>()

const expanded = ref(false)

/** 지금 선이 들어갈 자리 — 이 줄 **앞**. 모든 순간보다 뒤면 목록 끝(`moments.length`). */
const markerIndex = computed<number | null>(() => {
  const seconds = props.positionSeconds
  if (seconds === null || props.moments.length === 0) return null
  const index = props.moments.findIndex((moment) => moment.atSeconds > seconds)
  return index === -1 ? props.moments.length : index
})

const markerLabel = computed<string>(() =>
  props.positionSeconds === null ? '' : `지금 ${formatMomentTime(props.positionSeconds)}`,
)

/* ---------- 안쪽 스크롤: 더 있음 표시 · 방금 저장한 줄을 칸 안에서만 보이게 ---------- */

const list = ref<HTMLElement | null>(null)
const moreAbove = ref(false)
const moreBelow = ref(false)
const hiddenBelow = ref(0)

function updateHints(): void {
  const el = list.value
  if (el === null) return
  moreAbove.value = el.scrollTop > 2
  moreBelow.value = el.scrollTop + el.clientHeight < el.scrollHeight - 2
  if (!moreBelow.value) {
    hiddenBelow.value = 0
    return
  }
  const bottom = el.getBoundingClientRect().bottom
  hiddenBelow.value = [...el.querySelectorAll('.moment-row')].filter(
    (row) => row.getBoundingClientRect().top >= bottom - 4,
  ).length
}

/** 그 줄이 칸 밖이면 **이 칸만** 스크롤한다 (`scrollIntoView` 는 페이지까지 움직인다). */
function revealRow(selector: string): void {
  const el = list.value
  if (el === null || el.scrollHeight <= el.clientHeight) return
  const row = el.querySelector<HTMLElement>(selector)
  if (row === null) return
  const top = row.offsetTop
  if (top < el.scrollTop || top + row.offsetHeight > el.scrollTop + el.clientHeight) {
    el.scrollTop = Math.max(0, top - el.clientHeight / 3)
  }
}

watch(
  () => props.highlightId,
  async (id) => {
    if (id == null) return
    // 접혀 있으면 펼쳐서라도 보이게 한다 — 방금 저장한 것이 안 보이면 저장됐는지 알 수 없다.
    const index = props.moments.findIndex((moment) => moment.id === id)
    if (index >= COLLAPSED_MOMENT_COUNT) expanded.value = true
    await nextTick()
    revealRow(`[data-moment-row="${id}"]`)
    updateHints()
  },
)

watch(
  () => props.moments.length,
  async () => {
    await nextTick()
    updateHints()
  },
)

onMounted(() => {
  void nextTick(() => {
    if (props.highlightId != null) revealRow(`[data-moment-row="${props.highlightId}"]`)
    updateHints()
  })
})

const canExpand = computed<boolean>(
  () => props.compact !== true && props.moments.length > COLLAPSED_MOMENT_COUNT,
)

function label(moment: Readonly<Moment>): string {
  const note = firstLine(moment.note)
  const time = formatMomentTime(moment.atSeconds)
  const song = props.songTitle === undefined || props.songTitle === '' ? '' : `${props.songTitle} `
  return `${song}${time} 부터 재생${note === '' ? '' : ` — ${note}`}`
}
</script>

<template>
  <div
    class="current-moments"
    :class="{
      'is-compact': compact === true,
      'is-expanded': expanded,
      'has-more-above': moreAbove,
      'has-more-below': moreBelow,
    }"
  >
    <ol
      ref="list"
      class="moment-rows"
      aria-label="이 곡의 Moments — 시점 순"
      @scroll.passive="updateHints"
    >
      <template v-for="(moment, index) in moments" :key="moment.id">
        <li
          v-if="markerIndex === index"
          class="now-marker"
          :class="{ 'is-outside': index >= COLLAPSED_MOMENT_COUNT }"
          aria-hidden="true"
        >
          {{ markerLabel }}
        </li>
        <li
          class="moment-row"
          :class="{
            'is-new': moment.id === highlightId,
            'is-outside': index >= COLLAPSED_MOMENT_COUNT,
          }"
          :data-moment-row="moment.id"
        >
          <button
            type="button"
            class="moment-play"
            :data-moment-play="moment.id"
            :aria-label="label(moment)"
            :title="moment.note === '' ? undefined : moment.note"
            @click="emit('play', moment.id)"
          >
            <span class="moment-time">▶ {{ formatMomentTime(moment.atSeconds) }}</span>
            <span class="moment-note" :class="{ 'is-empty': firstLine(moment.note) === '' }">{{
              firstLine(moment.note) === '' ? '—' : firstLine(moment.note)
            }}</span>
            <span v-if="moment.id === highlightId" class="new-badge">방금 저장</span>
          </button>
        </li>
      </template>
      <li
        v-if="markerIndex === moments.length"
        class="now-marker"
        :class="{ 'is-outside': moments.length > COLLAPSED_MOMENT_COUNT }"
        aria-hidden="true"
      >
        {{ markerLabel }}
      </li>
    </ol>
    <p class="more-hint" aria-hidden="true">
      <template v-if="moreBelow"
        >아래에 {{ hiddenBelow > 0 ? `${hiddenBelow}개 ` : '' }}더 ↓</template
      >
      <template v-else-if="moreAbove">↑ 위에 더 있어요</template>
    </p>
    <button
      v-if="canExpand"
      type="button"
      class="expand"
      :aria-expanded="expanded"
      @click="expanded = !expanded"
    >
      {{ expanded ? '접기 ▴' : `이 곡의 Moments ${moments.length}개 모두 펼치기 ▾` }}
    </button>
  </div>
</template>

<style scoped>
.current-moments {
  /* 넓은 대시보드에서 줄이 쓰는 높이. 이 안에서만 스크롤한다. */
  --current-moments-height: clamp(150px, 30vh, 280px);

  position: relative;
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 4px;
}

/* 영상 띠 안 — 영상 높이 옆에 맞는 작은 칸. */
.current-moments.is-compact {
  --current-moments-height: 132px;
}

.moment-rows {
  position: relative;
  max-height: var(--current-moments-height);
  margin: 0;
  padding: 0 4px 0 0;
  list-style: none;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-color: var(--line-color) transparent;
  scrollbar-width: thin;
}

.moment-row + .moment-row,
.now-marker + .moment-row,
.moment-row + .now-marker {
  margin-top: 4px;
}

.moment-play {
  display: grid;
  width: 100%;
  min-height: 44px;
  align-items: center;
  padding: 4px 8px;
  border: 1px solid transparent;
  border-radius: var(--radius-control);
  background: var(--track-surface-color);
  color: var(--track-name-text-color);
  text-align: left;
  grid-template-columns: auto minmax(0, 1fr) auto;
  gap: 10px;
}

.moment-time {
  color: var(--track-play-text-color);
  font: 12px var(--font-mono);
  white-space: nowrap;
}

/* 긴 메모는 두 줄까지 — 시점은 늘 보인다. 전체 메모는 title 과 보관함에서. */
.moment-note {
  display: -webkit-box;
  overflow: hidden;
  font-size: 12px;
  line-height: 1.35;
  overflow-wrap: anywhere;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  line-clamp: 2;
}

/* 메모가 없으면 조용하게 — "메모 없음" 을 크게 말하지 않는다. */
.moment-note.is-empty {
  color: var(--row-meta-text-color);
}

.moment-row.is-new .moment-play {
  border-color: var(--accent-strong-color);
}

.new-badge {
  padding: 0 5px;
  border: 1px solid var(--accent-strong-color);
  color: var(--drawer-title-text-color);
  font: 10px/1.6 var(--font-mono);
  white-space: nowrap;
}

@media (hover: hover) {
  .moment-play:hover {
    border-color: var(--row-border-color);
  }
}

/* 지금 재생 위치 — 순간들 사이의 선. */
.now-marker {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--drawer-title-text-color);
  font: 10px var(--font-mono);
}

.now-marker::after {
  height: 1px;
  flex: 1;
  background: var(--track-current-border-color);
  content: '';
}

.more-hint {
  min-height: 14px;
  margin: 0;
  color: var(--drawer-sub-text-color);
  font: 10px var(--font-mono);
  text-align: right;
}

.current-moments::after {
  position: absolute;
  right: 8px;
  bottom: 18px;
  left: 0;
  height: 22px;
  background: linear-gradient(transparent, var(--surface-base-color));
  content: '';
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.15s;
}

.current-moments.has-more-below::after {
  opacity: 0.9;
}

/* 넓은 화면에는 펼치기가 없다 — 안쪽 스크롤이 그 일을 한다. */
.expand {
  display: none;
  min-height: 44px;
  align-self: flex-start;
  padding: 7px 14px;
  border: 1px solid var(--pill-border-color);
  border-radius: var(--radius-control);
  background: var(--pill-surface-color);
  color: var(--pill-text-color);
  font: 12px var(--font-mono);
}

/*
 * 대시보드의 한 열(700px 이하) — 안쪽 스크롤을 쓰지 않는다. 앞의 몇 개만 보이고 "펼치기" 로 늘린다.
 * 영상 띠(`is-compact`)는 그대로 작은 안쪽 스크롤이다.
 */
@media (max-width: 700px) {
  .current-moments:not(.is-compact) .moment-rows {
    max-height: none;
    padding-right: 0;
    overflow-y: visible;
  }

  .current-moments:not(.is-compact, .is-expanded) .moment-row.is-outside,
  .current-moments:not(.is-compact, .is-expanded) .now-marker.is-outside {
    display: none;
  }

  .current-moments:not(.is-compact) .more-hint,
  .current-moments:not(.is-compact)::after {
    display: none;
  }

  .expand {
    display: block;
  }
}
</style>
