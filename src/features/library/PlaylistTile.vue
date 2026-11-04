<script setup lang="ts">
/**
 * 플레이리스트 타일 하나 (M6-4).
 *
 * 바탕화면의 **폴더 아이콘** 메타포다 (사용자 구상). 표현만 담당하고 상태를
 * 모른다 — 누름을 `play` / `open` 으로 올릴 뿐이고 재생도 선택도 하지 않는다
 * (`AGENTS.md` 규칙 3).
 *
 * 보이는 조작이 **둘**이다.
 *   타일 본문 → 그 목록 전체 재생
 *   우측 상단 `⋯` → 편집 오버레이 열기
 *
 * 롱프레스만으로 열게 하지 않는다. 키보드·스크린리더에 대응되는 동작이 없어
 * M5 접근성 기준을 통과하지 못한다 (`M6_PLAN.md` §3). 그래서 `⋯` 가 본체이고
 * 롱프레스·우클릭(`contextmenu`)은 **추가 경로**다 — 안드로이드 Chrome 은
 * 길게 누르면 `contextmenu` 를 보내므로 같은 핸들러로 둘을 함께 얻는다.
 *
 * **빈 목록의 타일은 재생이 아니라 열기다.** 누를 수 있어 보이는데 아무 일도
 * 하지 않는 것을 만들지 않기 위해서다 (보고 6a 와 같은 이유). 그림도 `▶` 가
 * 아니라 `＋` 이고, 접근성 이름도 "열기" 라고 말한다.
 */
import { computed } from 'vue'

import type { DeepReadonly } from 'vue'

import type { Playlist } from '@/shared/types'

const props = defineProps<{
  /** store 가 `readonly()` 로 노출하므로 깊은 읽기 전용이다. */
  playlist: DeepReadonly<Playlist>
  /** 지금 편집·재생 대상으로 선택된 목록인지. */
  isSelected: boolean
}>()

const emit = defineEmits<{ play: []; open: [] }>()

const count = computed<number>(() => props.playlist.tracks.length)
const isEmpty = computed<boolean>(() => count.value === 0)

/** 본문 누름의 접근성 이름. 비어 있으면 하는 일이 다르므로 이름도 다르다. */
const bodyLabel = computed<string>(() =>
  isEmpty.value
    ? `${props.playlist.name} 열기 — 비어 있음`
    : `${props.playlist.name} 전체 재생 (${String(count.value)}곡)`,
)

function pressBody(): void {
  // 유니온을 한 번에 넘기면 오버로드가 갈리지 않는다. 분기해서 부른다.
  if (isEmpty.value) {
    emit('open')
    return
  }
  emit('play')
}
</script>

<template>
  <div
    class="playlist-tile"
    :class="{ 'is-selected': isSelected, 'is-empty': isEmpty }"
    @contextmenu.prevent="emit('open')"
  >
    <!--
      `playlist-play` 라는 이름을 유지한다. 승인된 디자인의 목록 재생 버튼과
      **같은 동작**이고, 드로어의 목록에서 이 위젯으로 자리만 옮겼다.
    -->
    <button
      type="button"
      class="playlist-play"
      :aria-label="bodyLabel"
      :title="bodyLabel"
      :aria-current="isSelected ? 'true' : undefined"
      @click="pressBody"
    >
      <span class="tile-mark" aria-hidden="true">{{ isEmpty ? '＋' : '▶' }}</span>
      <span class="pname">{{ playlist.name }}</span>
      <span class="pmeta">{{ isEmpty ? 'EMPTY' : `${count} TRACKS` }}</span>
    </button>

    <button
      type="button"
      class="playlist-open"
      :aria-label="`${playlist.name} 편집`"
      :title="`${playlist.name} 편집`"
      @click="emit('open')"
    >
      ⋯
    </button>
  </div>
</template>

<style scoped>
/*
 * 색은 모두 승인된 디자인의 행(`.playlist-row`) 토큰을 재사용한다. 새 색을
 * 만들지 않는다 — 라이브러리의 행과 타일은 같은 물건의 다른 배치다.
 */
.playlist-tile {
  position: relative;
  display: flex;
  min-width: 0;
}

.playlist-play {
  display: flex;
  overflow: hidden;
  min-width: 0;
  flex: 1;
  flex-direction: column;
  justify-content: space-between;
  /* 우측 상단 `⋯` 자리를 비워 둔다. */
  padding: 10px 34px 9px 10px;
  border: 1px solid var(--row-border-color);
  border-radius: var(--radius-control);
  background: var(--row-surface-color);
  color: var(--row-text-color);
  gap: 6px;
  text-align: left;
}

.playlist-play:hover {
  background: var(--row-selected-surface-color);
}

/* 선택 강조. 색에만 의존하지 않도록 aria-current 도 함께 쓴다. */
.playlist-tile.is-selected .playlist-play {
  border-color: var(--row-selected-border-color);
  background: var(--row-selected-surface-color);
}

/* 비어 있으면 `＋` 가 하는 일이 재생이 아니므로 재생 색을 쓰지 않는다. */
.tile-mark {
  display: block;
  color: var(--playlist-play-text-color);
  font: 13px var(--font-mono);
  line-height: 1;
}

.playlist-tile.is-empty .tile-mark {
  color: var(--row-meta-text-color);
}

.pname {
  display: block;
  overflow: hidden;
  font-size: 13px;
  line-height: 1.3;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pmeta {
  display: block;
  color: var(--row-meta-text-color);
  font: 10px var(--font-mono);
  letter-spacing: 0.06em;
}

/*
 * 편집 버튼. 29px 은 드로어의 `.track-controls button` 과 같은 값이다 —
 * 새 치수를 만들지 않고 이웃과 나란해진다 (M5 터치 목표 실측).
 */
.playlist-open {
  position: absolute;
  top: 4px;
  right: 4px;
  min-width: 28px;
  height: 29px;
  border: 0;
  border-radius: var(--radius-control);
  background: transparent;
  color: var(--row-action-text-color);
  font: 15px var(--font-mono);
  line-height: 1;
}

.playlist-open:hover {
  color: var(--row-action-hover-text-color);
}
</style>
