<script setup lang="ts">
/**
 * 플레이리스트 목록과 선택.
 *
 * 승인된 디자인의 `.playlists` / `.playlist-select` 구조를 따른다.
 * 레퍼런스의 행 오른쪽 `▶` 재생 버튼은 만들지 않는다. 재생 기능이 아직
 * 없으므로 동작하지 않는 버튼이 된다 (M3 에서 추가한다).
 *
 * 선택만 바꾼다. 재생 큐를 건드리지 않는다.
 */
import type { DeepReadonly } from 'vue'

import type { Playlist } from '@/shared/types'

/**
 * store 가 `readonly()` 로 노출하므로 깊은 읽기 전용 타입이다.
 * 목록을 여기서 변형할 수 없다는 뜻이고, 그것이 의도다.
 */
defineProps<{
  playlists: DeepReadonly<Playlist[]>
  selectedId: string | null
}>()

const emit = defineEmits<{ select: [id: string] }>()
</script>

<template>
  <div class="playlists">
    <p v-if="playlists.length === 0" class="empty">
      아직 플레이리스트가 없습니다.<br />＋ 새 목록으로 시작하세요.
    </p>

    <button
      v-for="playlist in playlists"
      :key="playlist.id"
      type="button"
      class="playlist-select"
      :class="{ 'is-active': playlist.id === selectedId }"
      :aria-current="playlist.id === selectedId ? 'true' : undefined"
      @click="emit('select', playlist.id)"
    >
      <span class="pname">{{ playlist.name }}</span>
      <span class="pmeta">{{ playlist.tracks.length }} TRACKS</span>
    </button>
  </div>
</template>

<style scoped>
/* 승인된 디자인의 `.playlists` 값을 따른다. */
.playlists {
  display: grid;
  margin: 15px 0 18px;
  gap: 7px;
}

.empty {
  margin: 0;
  color: var(--drawer-muted-text-color);
  font-size: 11px;
  line-height: 1.6;
}

/* 승인된 디자인의 `.playlist-select` 값을 따른다. */
.playlist-select {
  display: block;
  width: 100%;
  min-width: 0;
  padding: 11px 10px;
  border: 1px solid var(--row-border-color);
  border-radius: var(--radius-control);
  background: var(--row-surface-color);
  color: var(--row-text-color);
  text-align: left;
}

.playlist-select:hover {
  background: var(--row-selected-surface-color);
}

/* 선택 강조. 색에만 의존하지 않도록 aria-current 도 함께 쓴다. */
.playlist-select.is-active {
  border-color: var(--row-selected-border-color);
  background: var(--row-selected-surface-color);
}

.pname {
  display: block;
  overflow: hidden;
  font-size: 13px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pmeta {
  display: block;
  margin-top: 5px;
  color: var(--row-meta-text-color);
  font: 10px var(--font-mono);
}
</style>
