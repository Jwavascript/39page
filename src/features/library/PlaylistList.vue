<script setup lang="ts">
/**
 * 플레이리스트 목록, 선택, 목록 전체 재생.
 *
 * 승인된 디자인의 `.playlist-row` / `.playlist-select` / `.playlist-play`
 * 구조를 따른다. 행은 **선택 버튼 + ▶ 재생 버튼** 두 개다.
 *
 * 여기서 재생을 **하지 않는다.** `play` 를 올릴 뿐이고, 큐를 만드는 일은
 * 상위 계층(Playback Coordinator)이 한다. 이 컴포넌트는 재생 상태를 모른다.
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

const emit = defineEmits<{ select: [id: string]; play: [id: string] }>()
</script>

<template>
  <div class="playlists">
    <p v-if="playlists.length === 0" class="empty">
      아직 플레이리스트가 없습니다.<br />＋ 새 목록으로 시작하세요.
    </p>

    <div v-for="playlist in playlists" :key="playlist.id" class="playlist-row">
      <button
        type="button"
        class="playlist-select"
        :class="{ 'is-active': playlist.id === selectedId }"
        :aria-current="playlist.id === selectedId ? 'true' : undefined"
        @click="emit('select', playlist.id)"
      >
        <span class="pname">{{ playlist.name }}</span>
        <span class="pmeta">{{ playlist.tracks.length }} TRACKS</span>
      </button>

      <!-- 빈 목록은 재생할 수 없다. 레퍼런스와 같이 버튼을 비활성화한다. -->
      <button
        type="button"
        class="playlist-play"
        :aria-label="`${playlist.name} 재생`"
        :title="`${playlist.name} 재생`"
        :disabled="playlist.tracks.length === 0"
        @click="emit('play', playlist.id)"
      >
        ▶
      </button>
    </div>
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

/* 승인된 디자인의 `.playlist-row` 값을 따른다. */
.playlist-row {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 6px;
}

/* 승인된 디자인의 `.playlist-select` 값을 따른다. */
.playlist-select {
  min-width: 0;
  flex: 1;
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

/* 승인된 디자인의 `.playlist-play` 값을 따른다. */
.playlist-play {
  min-width: 42px;
  height: 42px;
  flex: none;
  border: 1px solid var(--playlist-play-border-color);
  border-radius: var(--radius-control);
  background: var(--playlist-play-surface-color);
  color: var(--playlist-play-text-color);
}

.playlist-play:hover:not(:disabled) {
  background: var(--playlist-play-surface-hover-color);
}

.playlist-play:disabled {
  cursor: not-allowed;
  opacity: 0.4;
}
</style>
