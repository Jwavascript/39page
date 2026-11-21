<script setup lang="ts">
/**
 * NOW PLAYLIST — 대시보드의 **지금 재생목록** (M11-7B, ADR 0030).
 *
 * M6-4 ~ M11-6 의 PLAYLISTS 카드 위젯을 대신한다. 카드는 "목록을 고르는 일" 만 했고, 사용자가 자주
 * 하는 일 — 듣고 있는 목록에서 다른 곡을 고르기 — 은 대시보드 어디에도 없었다 (UAT U2).
 *
 * - 재생 큐가 있으면 **큐**(실제 재생 순서)를, 없으면 보관함에서 고른 목록을 **"재생 대기"** 로 보인다.
 *   둘을 섞어 보이지 않는다 — 판단은 `useNowPlaylist` 가 한다 (`AGENTS.md` 규칙 3).
 * - 줄을 누르면 그 곡을 재생한다. 목록 이름 바꾸기 · 삭제 · 곡 정렬 같은 **관리는 없다** — 보관함의 일이다.
 * - 큐는 출처 목록을 따라간다 — 곡 추가 · 삭제 · 순서 변경에 안내 상자를 띄우지 않는다 (ADR 0038).
 * - "목록 바꾸기" 로 고르면 재생 중일 때는 그 목록을 바로 처음부터 재생한다 (ADR 0038).
 * - "목록 바꾸기" 는 위젯 **안에서** 펼친다. 떠 있는 팝오버를 쓰지 않는다 — 좁은 배치에서 이 위젯
 *   아래가 영상이고, 가시성 측정은 우리 UI 가 영상을 덮은 것을 알지 못한다 (`playerVisibility.ts`).
 * - 곡이 많으면 넓은 화면은 **위젯 안에서** 스크롤하고(높이 고정 · 페이지로 새지 않음 · 더 있음 표시),
 *   좁은 화면(한 열)은 지금 곡 주변만 보이고 "펼치기" 로 늘린다 — 페이지 스크롤과 겹치지 않게 (M11-3 U19).
 *
 * 단일 루트를 유지한다. `WidgetHost` 가 `grid-area` 를 루트에 적용한다.
 */
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

import { useNowPlaylist } from '@/features/library/useNowPlaylist'

const model = useNowPlaylist()

/* ---------- 안쪽 스크롤: 더 있음 표시 · 지금 곡을 칸 안에서만 보이게 ---------- */

const list = ref<HTMLElement | null>(null)
const moreAbove = ref(false)
const moreBelow = ref(false)

function updateScrollHints(): void {
  const el = list.value
  if (el === null) return
  moreAbove.value = el.scrollTop > 2
  moreBelow.value = el.scrollTop + el.clientHeight < el.scrollHeight - 2
}

/**
 * 지금 곡이 칸 밖에 있으면 **그 칸만** 스크롤해 보이게 한다. `scrollIntoView` 를 쓰지 않는다 —
 * 그것은 페이지까지 움직인다.
 */
function revealCurrent(): void {
  const el = list.value
  if (el === null || el.scrollHeight <= el.clientHeight) return
  const row = el.querySelector<HTMLElement>('.track-row.is-current')
  if (row === null) return
  const top = row.offsetTop
  if (top < el.scrollTop || top + row.offsetHeight > el.scrollTop + el.clientHeight) {
    el.scrollTop = Math.max(0, top - el.clientHeight / 3)
  }
}

async function refreshList(): Promise<void> {
  await nextTick()
  revealCurrent()
  updateScrollHints()
}

watch(
  () => [model.view.value, model.position.value, model.trackCount.value, model.isPickerOpen.value],
  () => void refreshList(),
)

onMounted(() => {
  void refreshList()
  window.addEventListener('resize', updateScrollHints, { passive: true })
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', updateScrollHints)
})
</script>

<template>
  <section class="now-playlist" aria-labelledby="now-playlist-title" :data-view="model.view.value">
    <div class="widget-head">
      <div class="head-text">
        <h2 id="now-playlist-title" class="widget-title">
          NOW PLAYLIST
          <span v-if="model.view.value === 'queue'" class="state-chip is-playing">
            {{ model.isSounding.value ? '재생 중' : '일시정지' }}
          </span>
          <span v-else-if="model.view.value === 'standby'" class="state-chip">재생 대기</span>
        </h2>
        <p v-if="model.view.value !== 'none'" class="list-name" :title="model.name.value">
          {{ model.name.value }}
        </p>
        <p v-if="model.view.value === 'queue'" class="widget-sub">
          {{ model.position.value }} / {{ model.trackCount.value }}곡
          <span v-if="model.modesText.value !== null" class="modes"
            >· {{ model.modesText.value }}</span
          >
          <template v-if="model.otherSelectedName.value !== null">
            · 보관함에서 보는 목록: {{ model.otherSelectedName.value }}
          </template>
        </p>
        <p v-else-if="model.view.value === 'standby'" class="widget-sub">
          {{ model.trackCount.value === 0 ? '비어 있음' : `${model.trackCount.value}곡` }}
          <template v-if="model.playingElsewhereName.value !== null">
            · 지금 재생: {{ model.playingElsewhereName.value }}
          </template>
        </p>
      </div>
      <button
        v-if="model.choices.value.length > 0"
        type="button"
        class="pill switch-list"
        aria-controls="now-playlist-picker"
        :aria-expanded="model.isPickerOpen.value"
        @click="model.togglePicker()"
      >
        목록 바꾸기 {{ model.isPickerOpen.value ? '▴' : '▾' }}
      </button>
    </div>

    <p v-if="model.notice.value !== ''" class="widget-notice" role="status" aria-live="polite">
      {{ model.notice.value }}
    </p>

    <!-- 목록 바꾸기 — 위젯 안에서 곡 줄 대신 펼친다. 재생 중이면 고른 목록을 바로 처음부터 재생한다. -->
    <div v-if="model.isPickerOpen.value" id="now-playlist-picker" class="picker">
      <ul class="picker-rows">
        <li v-for="choice in model.choices.value" :key="choice.id">
          <button
            type="button"
            class="picker-row"
            :class="{ 'is-selected': choice.isSelected }"
            :aria-current="choice.isSelected ? 'true' : undefined"
            @click="model.pick(choice.id)"
          >
            <span class="picker-name">{{ choice.name }}</span>
            <span class="picker-meta">
              {{ choice.trackCount === 0 ? '비어 있음' : `${choice.trackCount}곡` }}
              <template v-if="choice.isPlaying"> · ♪ 재생 중인 목록</template>
            </span>
          </button>
        </li>
      </ul>
    </div>

    <template v-else>
      <!--
        큐 보기: 곡 추가 · 삭제 · 순서 변경은 큐가 바로 따라가므로 알리지 않는다 (ADR 0038). 출처 목록 자체가
        지워진 경우만 알린다 — 따라갈 목록이 없어 큐가 그대로 끝까지 재생된다.
      -->
      <p v-if="model.sourceState.value === 'deleted'" class="source-notice" role="status">
        이 목록은 보관함에서 지워졌어요. 지금 큐는 끝까지 재생할 수 있어요.
      </p>

      <!-- 빈 목록은 부제("비어 있음")와 아래 ＋ 링크 추가가 말한다 — 같은 말을 두 번 하지 않는다 (ADR 0044). -->
      <p v-if="model.view.value === 'none'" class="empty">아직 플레이리스트가 없어요.</p>

      <div
        v-else-if="model.trackCount.value > 0"
        class="rows-shell"
        :class="{ 'has-more-above': moreAbove, 'has-more-below': moreBelow }"
      >
        <ol
          ref="list"
          class="track-rows"
          :class="{ 'is-expanded': model.isExpanded.value }"
          :aria-label="model.view.value === 'queue' ? '재생 큐의 곡' : '재생 대기 목록의 곡'"
          @scroll.passive="updateScrollHints"
        >
          <!-- :key 는 자리다 — 같은 트랙 id 가 큐에 두 번 있을 수는 없지만, 누른 **자리**가 곧 재생할 항목이다. -->
          <li
            v-for="row in model.rows.value"
            :key="`${row.index}:${row.track.id}`"
            class="track-item"
            :class="{ 'is-outside': !row.inWindow }"
          >
            <button
              type="button"
              class="track-row"
              :class="{ 'is-current': row.isCurrent }"
              :aria-current="row.isCurrent ? 'true' : undefined"
              :title="row.track.title"
              @click="model.playRow(row)"
            >
              <span class="track-no" aria-hidden="true">{{
                String(row.index + 1).padStart(2, '0')
              }}</span>
              <span class="track-title">{{ row.track.title }}</span>
              <span v-if="row.isCurrent" class="track-state">
                {{ model.isSounding.value ? '♪ 재생 중' : 'Ⅱ 멈춤' }}
              </span>
            </button>
          </li>
        </ol>
        <p class="more-hint" aria-hidden="true">
          <template v-if="moreBelow">아래에 곡이 더 있어요 ↓</template>
          <template v-else-if="moreAbove">↑ 위에 곡이 더 있어요</template>
        </p>
        <button
          v-if="model.trackCount.value > 5"
          type="button"
          class="pill expand"
          :aria-expanded="model.isExpanded.value"
          @click="model.isExpanded.value = !model.isExpanded.value"
        >
          {{ model.isExpanded.value ? '접기 ▴' : `전체 ${model.trackCount.value}곡 펼치기 ▾` }}
        </button>
      </div>
    </template>

    <div class="widget-foot">
      <button
        v-if="model.view.value === 'standby' && model.trackCount.value > 0"
        type="button"
        class="pill pill--strong play-all"
        :aria-label="`${model.name.value} 처음부터 재생 (${model.trackCount.value}곡)`"
        @click="model.playStandbyFromStart()"
      >
        ▶ 처음부터 재생
      </button>
      <button
        v-if="model.view.value === 'standby' && model.trackCount.value === 0"
        type="button"
        class="pill pill--strong add-link"
        @click="model.addLink()"
      >
        ＋ YouTube 링크 추가
      </button>
      <button
        v-if="model.view.value === 'none'"
        type="button"
        class="pill pill--strong"
        @click="model.openArchive()"
      >
        보관함에서 목록 만들기
      </button>
    </div>
  </section>
</template>

<style scoped>
.now-playlist {
  /* 넓은 화면에서 곡 줄이 쓰는 높이. 이 안에서만 스크롤한다. */
  --now-playlist-rows-height: clamp(196px, 34vh, 340px);

  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 10px;
}

.widget-head {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
}

.head-text {
  min-width: 0;
  flex: 1 1 0;
}

/* 보관함의 머리말과 같은 조판이다. */
.widget-title {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin: 0;
  color: var(--drawer-title-text-color);
  font: 13px var(--font-mono);
  font-weight: 400;
  letter-spacing: 0.1em;
}

/* 상태는 색만이 아니라 **글**로 말한다 — "재생 중" 과 "재생 대기" 를 헷갈리지 않게. */
.state-chip {
  padding: 1px 7px;
  border: 1px solid var(--pill-border-color);
  border-radius: 999px;
  color: var(--drawer-sub-text-color);
  font: 10px var(--font-mono);
  letter-spacing: 0.04em;
}

.state-chip.is-playing {
  border-color: var(--track-current-border-color);
  color: var(--drawer-title-text-color);
}

.list-name {
  display: -webkit-box;
  overflow: hidden;
  margin: 7px 0 0;
  color: var(--now-title-text-color);
  font-size: 15px;
  font-weight: 500;
  line-height: 1.35;
  overflow-wrap: anywhere;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  line-clamp: 2;
}

.widget-sub {
  margin: 5px 0 0;
  color: var(--drawer-sub-text-color);
  font: 11px/1.5 var(--font-mono);
  overflow-wrap: anywhere;
}

/* 승인된 디자인의 `.pill` 값을 따른다. 터치 목표 44px (M11 U16). */
.pill {
  min-height: 44px;
  flex: none;
  padding: 7px 14px;
  border: 1px solid var(--pill-border-color);
  border-radius: var(--radius-control);
  background: var(--pill-surface-color);
  color: var(--pill-text-color);
  font: 12px var(--font-mono);
}

.pill--strong {
  border-color: var(--accent-strong-color);
  background: var(--accent-strong-color);
  color: var(--accent-strong-text-color);
}

/* 터치 뒤 hover 색이 남지 않게 (M11 U18). */
@media (hover: hover) {
  .pill:hover:not(:disabled):not(.pill--strong) {
    background: var(--pill-surface-hover-color);
  }

  .track-row:hover,
  .picker-row:hover {
    border-color: var(--row-border-color);
  }
}

.widget-notice {
  margin: 0;
  color: var(--status-warning-text-color);
  font: 11px/1.6 var(--font-mono);
}

.source-notice {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin: 0;
  padding: 8px 10px;
  border-left: 3px solid var(--status-warning-text-color);
  background: var(--row-surface-color);
  color: var(--drawer-body-text-color);
  font-size: 12px;
  line-height: 1.55;
}

/* 셔플 · 반복 — 번호가 재생 순서라는 것을 함께 알린다. */
.modes {
  color: var(--drawer-title-text-color);
}

.empty,
/* ---------- 곡 줄 ---------- */

.rows-shell {
  position: relative;
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 6px;
}

.track-rows,
.picker-rows {
  /* 줄의 `offsetTop` 이 이 목록 기준이 되게 한다 (`revealCurrent`). */
  position: relative;
  max-height: var(--now-playlist-rows-height);
  margin: 0;
  padding: 0 4px 0 0;
  list-style: none;
  overflow-y: auto;
  /* 끝까지 스크롤해도 페이지로 넘어가지 않는다. */
  overscroll-behavior: contain;
  scrollbar-color: var(--line-color) transparent;
  scrollbar-width: thin;
}

.track-item + .track-item,
.picker-rows li + li {
  margin-top: 4px;
}

.track-row,
.picker-row {
  display: grid;
  width: 100%;
  min-height: 44px;
  align-items: center;
  padding: 6px 10px;
  border: 1px solid transparent;
  border-radius: var(--radius-control);
  background: var(--track-surface-color);
  color: var(--track-name-text-color);
  text-align: left;
  gap: 8px;
}

.track-row {
  grid-template-columns: 24px minmax(0, 1fr) auto;
}

.track-no {
  color: var(--row-meta-text-color);
  font: 11px var(--font-mono);
}

/* 긴 제목은 두 줄까지 — 단추가 잘리거나 줄이 끝없이 길어지지 않게. 전체 제목은 `title` 에 있다. */
.track-title {
  display: -webkit-box;
  overflow: hidden;
  font-size: 13px;
  line-height: 1.35;
  overflow-wrap: anywhere;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  line-clamp: 2;
}

.track-state {
  color: var(--drawer-title-text-color);
  font: 10px var(--font-mono);
  white-space: nowrap;
}

/* 지금 곡 — 테두리 · 배경 · **글**("재생 중") · `aria-current` 로 알린다. */
.track-row.is-current {
  border-color: var(--track-current-border-color);
  background: var(--row-selected-surface-color);
}

.picker-row {
  grid-template-columns: minmax(0, 1fr);
  gap: 2px;
}

.picker-row.is-selected {
  border-color: var(--row-selected-border-color);
  background: var(--row-selected-surface-color);
}

.picker-name {
  font-size: 13px;
  line-height: 1.35;
  overflow-wrap: anywhere;
}

.picker-meta {
  color: var(--row-meta-text-color);
  font: 10px var(--font-mono);
}

/* 더 있음 표시 — 스크롤바가 가늘거나 숨어도 "아래에 더 있다" 를 글과 흐림으로 알린다. */
.more-hint {
  min-height: 14px;
  margin: 0;
  color: var(--drawer-sub-text-color);
  font: 10px var(--font-mono);
  text-align: right;
}

.rows-shell::after {
  position: absolute;
  right: 8px;
  bottom: 20px;
  left: 0;
  height: 26px;
  background: linear-gradient(transparent, var(--surface-base-color));
  content: '';
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.15s;
}

.rows-shell.has-more-below::after {
  opacity: 0.9;
}

/* 넓은 화면에는 펼치기가 없다 — 안쪽 스크롤이 그 일을 한다. */
.expand {
  display: none;
  align-self: flex-start;
}

.widget-foot {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

/* 큐를 재생하는 동안에는 단추가 없다 — 빈 줄이 자리를 차지하지 않게. */
.widget-foot:empty {
  display: none;
}

/*
 * 700px 이하 — 대시보드가 한 열이다 (`WidgetHost`). **안쪽 스크롤을 쓰지 않는다** — 손가락으로 페이지를
 * 내리다가 이 칸에 걸려 멈추는 일이 없게 (M11-3 U19). 지금 곡 주변 5줄만 보이고 "펼치기" 로 늘린다.
 */
@media (max-width: 700px) {
  .track-rows {
    max-height: none;
    padding-right: 0;
    overflow-y: visible;
  }

  .track-rows:not(.is-expanded) .track-item.is-outside {
    display: none;
  }

  /* 숨긴 줄 바로 다음 줄의 위 여백이 남지 않게. */
  .track-rows:not(.is-expanded) .track-item.is-outside + .track-item:not(.is-outside) {
    margin-top: 0;
  }

  .expand {
    display: block;
  }

  .more-hint,
  .rows-shell::after {
    display: none;
  }

  .picker-rows {
    max-height: 264px;
  }
}
</style>
