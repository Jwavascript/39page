<script setup lang="ts">
/**
 * 플레이리스트 타일 하나 (M6-4).
 *
 * 바탕화면의 **폴더 아이콘** 메타포다 (사용자 구상). 표현만 담당하고 상태를
 * 모른다 — 누름을 `play` / `open` 으로 올릴 뿐이고 재생도 선택도 하지 않는다
 * (`AGENTS.md` 규칙 3).
 *
 * 보이는 조작이 **둘**이다.
 *   타일 본문 → 그 목록의 **트랙 편집** 열기
 *   우측 상단 `▶` → 그 목록 전체 재생
 *
 * M7 에서 둘의 역할을 바꿨다. M6-4 에는 본문이 재생이고 `⋯` 가 편집이었는데,
 * 실기기에서 "플레이리스트를 눌렀을 때는 해당 설정 드로어가 올라오게" 로
 * 바뀌었다. 실수로 재생되는 일도 함께 없어진다.
 *
 * 재생은 **없어지지 않았다.** 작은 `▶` 로 남는다 — 전체 재생 경로를 잃으면
 * 타일에서 음악을 시작할 방법이 사라진다. 빈 목록에서는 비활성이고 그 사실을
 * 접근성 이름이 말한다.
 *
 * 롱프레스(`contextmenu`)를 두지 않는다. 본문을 한 번 누르면 편집이 열리므로
 * 길게 누를 이유가 없어졌다.
 */
import { computed } from 'vue'

import type { DeepReadonly } from 'vue'

import type { Playlist } from '@/shared/types'

const props = defineProps<{
  /** store 가 `readonly()` 로 노출하므로 깊은 읽기 전용이다. */
  playlist: DeepReadonly<Playlist>
  /** 지금 편집·재생 대상으로 선택된 목록인지. */
  isSelected: boolean
  /** 지금 재생 중인 곡이 이 목록에 있는지 (M11-3 U14). 색만이 아니라 글로도 알린다. */
  isPlaying?: boolean
}>()

const emit = defineEmits<{ play: []; open: [] }>()

const count = computed<number>(() => props.playlist.tracks.length)
const isEmpty = computed<boolean>(() => count.value === 0)

/** 본문 누름의 접근성 이름. 비어 있으면 그 사실도 말한다. */
const openLabel = computed<string>(() => {
  if (isEmpty.value) return `${props.playlist.name} 보관함에서 편집 — 비어 있음`
  const playing = props.isPlaying === true ? ' · 재생 중' : ''
  return `${props.playlist.name} 보관함에서 편집 (${String(count.value)}곡${playing})`
})

/** 빈 목록은 재생할 수 없다. 이름이 그 사실을 말한다. */
const playLabel = computed<string>(() =>
  isEmpty.value
    ? `${props.playlist.name} 전체 재생 — 비어 있음`
    : `${props.playlist.name} 전체 재생 (${String(count.value)}곡)`,
)
</script>

<template>
  <div
    class="playlist-tile"
    :class="{ 'is-selected': isSelected, 'is-empty': isEmpty, 'is-playing': isPlaying }"
  >
    <!-- 본문 = 트랙 편집 열기. 타일 전체가 하나의 큰 터치 목표다. -->
    <button
      type="button"
      class="playlist-open"
      :aria-label="openLabel"
      :title="openLabel"
      :aria-current="isSelected ? 'true' : undefined"
      @click="emit('open')"
    >
      <span class="pname">{{ playlist.name }}</span>
      <span class="pmeta"
        >{{ isEmpty ? 'EMPTY' : `${count} TRACKS`
        }}<span v-if="isPlaying" class="playing-mark">♪ 재생 중</span></span
      >
    </button>

    <!--
      `playlist-play` 라는 이름을 유지한다. 승인된 디자인의 목록 재생 버튼과
      **같은 동작**이고, 드로어의 목록에서 이 위젯으로 자리만 옮겼다.
    -->
    <button
      type="button"
      class="playlist-play"
      :aria-label="playLabel"
      :title="playLabel"
      :disabled="isEmpty"
      @click="emit('play')"
    >
      ▶
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

.playlist-open {
  display: flex;
  overflow: hidden;
  min-width: 0;
  flex: 1;
  flex-direction: column;
  justify-content: space-between;
  /* 우측 상단 `▶` 자리를 비워 둔다. */
  min-height: 64px;
  padding: 10px 48px 9px 10px;
  border: 1px solid var(--row-border-color);
  border-radius: var(--radius-control);
  background: var(--row-surface-color);
  color: var(--row-text-color);
  gap: 6px;
  text-align: left;
}

/* 터치 뒤 hover 덮개가 남지 않게 — 마우스가 있는 기기에서만 (M11 U18). */
@media (hover: hover) {
  .playlist-open:hover {
    background: var(--row-selected-surface-color);
  }

  .playlist-play:hover:not(:disabled) {
    color: var(--row-action-hover-text-color);
  }
}

.playlist-tile.is-playing .playlist-open {
  border-color: var(--track-current-border-color);
}

.playing-mark {
  display: block;
  margin-top: 2px;
  color: var(--row-text-color);
}

/* 선택 강조. 색에만 의존하지 않도록 aria-current 도 함께 쓴다. */
.playlist-tile.is-selected .playlist-open {
  border-color: var(--row-selected-border-color);
  background: var(--row-selected-surface-color);
}

/* 긴 이름은 두 줄까지 보이고 그다음 말줄임 (M11 U12). 전체는 접근성 이름 · 보관함에서. */
.pname {
  display: -webkit-box;
  overflow: hidden;
  font-size: 13px;
  line-height: 1.3;
  overflow-wrap: anywhere;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  line-clamp: 2;
}

.pmeta {
  display: block;
  color: var(--row-meta-text-color);
  font: 10px var(--font-mono);
  letter-spacing: 0.06em;
}

/*
 * 전체 재생 버튼. 29px 은 드로어의 `.track-controls button` 과 같은 값이다 —
 * 새 치수를 만들지 않고 이웃과 나란해진다 (M5 터치 목표 실측).
 */
.playlist-play {
  position: absolute;
  top: 2px;
  right: 2px;
  /* 터치 목표 44px (M11 U16). */
  width: 44px;
  height: 44px;
  border: 0;
  border-radius: var(--radius-control);
  background: transparent;
  color: var(--playlist-play-text-color);
  font: 13px var(--font-mono);
  line-height: 1;
}

.playlist-play:disabled {
  cursor: not-allowed;
  color: var(--row-meta-text-color);
  opacity: 0.4;
}
</style>
