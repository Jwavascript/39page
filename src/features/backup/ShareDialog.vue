<script setup lang="ts">
/**
 * 공유 대화상자 (ADR 0043) — 공유 단추(지금 재생 카드 · 데크 · 보관함의 목록 · 곡 "공유" · Moments)가 연다.
 *
 * 전에는 데이터 · 백업 대화상자의 아래쪽 칸이라 백업이 먼저 보였다. 이제 따로 열고, **무엇을 공유하는지 한 줄** · 이미지
 * 카드 · 링크만 둔다. 대상은 연 곳이 정한다 — 여기서 목록 · 범위를 다시 고르지 않는다.
 *
 * 연 동안만 마운트된다 — 닫으면 그리던 카드도 함께 사라진다. 모달이다: 셸이 뒤쪽을 `inert` 로 막고 Escape 를 받는다.
 */
import { computed, nextTick, onMounted, ref } from 'vue'

import { useFocusTrap } from '@/components/ui/useFocusTrap'
import type { ShareRequest } from '@/shared/types/share'
import { formatTimestamp } from '@/shared/utils/time'
import { useLibraryStore } from '@/stores/library'
import { useMomentsStore } from '@/stores/moments'

import ShareLinkBox from './ShareLinkBox.vue'
import type { ShareLinkTarget } from './useShareLink'

const props = defineProps<{ request: ShareRequest }>()
const emit = defineEmits<{ close: [] }>()

const library = useLibraryStore()
const moments = useMomentsStore()
const dialog = ref<HTMLElement | null>(null)
const onKeydown = useFocusTrap(dialog)

/** Moment 의 곡 이름 — 라이브러리(고른 목록 먼저)의 지금 이름, 없으면 Moment 를 저장할 때의 제목. */
function momentTitle(videoId: string, fallback: string): string {
  for (const list of [library.selectedPlaylist, ...library.playlists]) {
    const found = list?.tracks.find((track) => track.videoId === videoId)
    if (found !== undefined) return found.title
  }
  return fallback === '' ? `YouTube · ${videoId}` : fallback
}

/** 연 곳이 정한 대상 — 지금 라이브러리 · Moments 에서 찾는다(곡 이름이 바뀌면 따라간다). 사라졌으면 `null`. */
const target = computed<ShareLinkTarget | null>(() => {
  const request = props.request
  if ('momentId' in request) {
    const moment = moments.moments.find((item) => item.id === request.momentId)
    return moment === undefined
      ? null
      : { kind: 'moment', moment, title: momentTitle(moment.videoId, moment.title) }
  }
  const playlist = library.getPlaylist(request.playlistId)
  if (playlist === undefined) return null
  if (request.trackId === undefined) return { kind: 'playlist', playlist }
  const track = playlist.tracks.find((item) => item.id === request.trackId)
  return track === undefined ? null : { kind: 'track', playlist, track }
})

/** 무엇을 공유하는지 한 줄 — 종류 · 이름 · 덧말. */
const summary = computed(() => {
  const current = target.value
  if (current === null) return null
  if (current.kind === 'playlist') {
    return {
      kind: '플레이리스트',
      name: current.playlist.name,
      detail: `${String(current.playlist.tracks.length)}곡`,
    }
  }
  if (current.kind === 'track') {
    const count = moments.moments.filter((m) => m.videoId === current.track.videoId).length
    return {
      kind: '곡',
      name: current.track.title,
      detail: count === 0 ? '' : `Moment ${String(count)}개`,
    }
  }
  return {
    kind: 'Moment',
    name: current.title,
    detail: formatTimestamp(current.moment.atSeconds),
  }
})

/** 빈 목록은 공유할 것이 없다. */
const empty = computed(
  () => target.value?.kind === 'playlist' && target.value.playlist.tracks.length === 0,
)

onMounted(async () => {
  await nextTick()
  // 제목이 읽히도록 대화상자 자체에 먼저 둔다. Tab 한 번이면 첫 단추다.
  dialog.value?.focus()
})
</script>

<template>
  <div class="share-backdrop" @click.self="emit('close')">
    <div
      ref="dialog"
      class="share-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="share-dialog-title"
      tabindex="-1"
      @keydown="onKeydown"
    >
      <div class="dialog-head">
        <h2 id="share-dialog-title" class="dialog-title">공유</h2>
        <button type="button" class="close" aria-label="공유 닫기" @click="emit('close')">×</button>
      </div>

      <p v-if="summary === null" class="gone" role="status">공유할 목록이나 곡이 사라졌어요.</p>
      <template v-else>
        <p class="target">
          <span class="target-kind">{{ summary.kind }}</span>
          <strong class="target-name">{{ summary.name }}</strong>
          <span v-if="summary.detail !== ''" class="target-detail">{{ summary.detail }}</span>
        </p>
        <p v-if="empty" class="gone" role="status">빈 목록은 공유할 수 없어요.</p>
        <ShareLinkBox v-else-if="target !== null" :target="target" />
      </template>
    </div>
  </div>
</template>

<style scoped>
.share-backdrop {
  position: fixed;
  inset: 0;
  z-index: 10;
  display: grid;
  padding: 16px;
  overflow-y: auto;
  background: rgb(0 0 0 / 55%);
  place-items: center;
}

.share-dialog {
  width: min(520px, 100%);
  max-height: calc(100dvh - 32px);
  padding: 18px 20px;
  overflow-y: auto;
  overscroll-behavior: contain;
  border: 1px solid var(--drawer-border-color);
  border-radius: var(--radius-modal);
  background: var(--drawer-surface-color);
  color: var(--row-text-color);
}

.share-dialog:focus-visible {
  outline: var(--focus-ring-width) solid var(--focus-ring-color);
  outline-offset: 2px;
}

.dialog-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.dialog-title {
  margin: 0;
  color: var(--drawer-title-text-color);
  font: 14px var(--font-mono);
  font-weight: 400;
  letter-spacing: 0.1em;
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

/* 무엇을 공유하는지 — 종류 · 이름 · 덧말. 이름은 두 줄까지. */
.target {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  margin: 6px 0 0;
  gap: 4px 8px;
}

.target-kind,
.target-detail {
  color: var(--drawer-sub-text-color);
  font: 11px var(--font-mono);
}

.target-name {
  display: -webkit-box;
  overflow: hidden;
  color: var(--drawer-title-text-color);
  font-size: 15px;
  font-weight: 500;
  overflow-wrap: anywhere;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  line-clamp: 2;
}

.gone {
  margin: 12px 0 0;
  color: var(--status-warning-text-color);
  font: 12px/1.6 var(--font-mono);
}
</style>
