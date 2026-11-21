<script setup lang="ts">
/**
 * 대시보드의 Music Moments — **이 곡의 Moments** (M9-4 → M11-3 → M11-7C · ADR 0030).
 *
 * 한 인스턴스가 두 자리에 놓인다 (위젯 노드는 하나 — 보관함을 열어도 다시 만들지 않는다).
 *
 * | 자리                          | 하는 일                                                                  |
 * | ----------------------------- | ------------------------------------------------------------------------ |
 * | 대시보드                      | **빠른 저장 · 빠른 재생** — ＋ 이 순간 저장, 이 곡의 순간 모두, 모두 보기  |
 * | 보관함이 열린 영상 띠 (M11-7C) | **보기 · 재생 전용** — 이 곡의 순간 모두. 저장 · 모두 보기 · 관리 없음     |
 *
 * 영상 띠에서 저장 · 모두 보기를 뺀 것은 사용자 요청이다 — 바로 아래 보관함 Moments › 이 곡에 같은 일이
 * 있다. 띠에서 저장하던 사용자를 위해, 저장하지 않은 초안이 있으면 그 사실과 이어 쓰는 길만 남긴다.
 *
 * "이 곡" 은 **실제로 재생 중인 영상**이다(코디네이터의 `nowPlaying`) — 보관함에서 고른 목록이 아니다.
 * 재생 중인 곡이 없으면 어느 목록의 곡도 "이 곡" 으로 치지 않는다.
 *
 * "몇 개만 보이고 모두 보기" 를 하지 않는다 — 이 곡의 순간은 `CurrentMomentsList` 가 모두 보인다(넓으면
 * 칸 안 스크롤, 좁으면 펼치기). 저장 · 재생 · 메모의 판단은 composable 이 한다 (`AGENTS.md` 규칙 3).
 */
import { computed, inject, ref, watch } from 'vue'

import { ARCHIVE } from '@/features/archive/archiveController'
import { PLAYBACK_COORDINATOR } from '@/features/playback/playbackCoordinator'
import { useMomentDraftStore } from '@/stores/momentDraft'
import { useMomentsStore } from '@/stores/moments'

import CurrentMomentsList from './CurrentMomentsList.vue'
import MomentCapture from './MomentCapture.vue'
import MomentsStatusBanner from './MomentsStatusBanner.vue'
import { formatMomentTime } from './momentsView'
import { useMomentsBrowser } from './useMomentsBrowser'
import { usePlaybackPosition } from '@/features/playback/usePlaybackPosition'

const browser = useMomentsBrowser()
const moments = useMomentsStore()
const draftStore = useMomentDraftStore()
const archive = inject(ARCHIVE, null)
const coordinator = inject(PLAYBACK_COORDINATOR, null)
const { position } = usePlaybackPosition()

/** 보관함이 열려 있으면 영상 띠의 보기 전용이다. */
const readonlyMode = computed<boolean>(() => archive?.isOpen.value ?? false)

/** 실제로 재생 중인 영상 — 보관함에서 고른 목록과 무관하다. */
const currentVideoId = computed<string | null>(() => coordinator?.nowPlaying.value?.videoId ?? null)

/** 지금 곡의 Moments — 시점 순. */
const currentMoments = computed(() => {
  const videoId = currentVideoId.value
  return videoId === null ? [] : moments.momentsForVideo(videoId)
})

const currentTitle = computed<string>(() => currentMoments.value[0]?.title ?? '')

/** 지금 선 — 지금 곡의 위치일 때만. */
const positionSeconds = computed<number | null>(() =>
  position.value !== null && position.value.videoId === currentVideoId.value
    ? position.value.seconds
    : null,
)

/** 방금 저장한 순간 — 그 줄을 강조한다. 곡이 바뀌면 거둔다. */
const highlightId = ref<string | null>(null)
watch(currentVideoId, () => {
  highlightId.value = null
})

function onSaved(momentId: string): void {
  browser.clearFeedback()
  highlightId.value = momentId
}

function openAll(): void {
  archive?.open('moments', { momentsView: 'all' })
}

/** 영상 띠의 초안 알림 — 저장 전 초안이 있다(대시보드에서 잡고 보관함을 열었다). */
const draftTime = computed<string>(() =>
  draftStore.draft === null ? '' : formatMomentTime(draftStore.draft.atSeconds),
)

/** 보관함 Moments › 이 곡으로 가서 이어 쓴다. */
function resumeDraft(): void {
  draftStore.requestResume()
  archive?.open('moments')
}
</script>

<template>
  <section
    class="moments-widget"
    :class="{ 'is-readonly': readonlyMode }"
    aria-labelledby="moments-widget-title"
  >
    <div class="widget-head">
      <div class="head-text">
        <h2 id="moments-widget-title" class="widget-title">
          {{ readonlyMode ? '이 곡의 Moments' : 'MOMENTS · 이 곡' }}
          <span v-if="currentVideoId !== null" class="count">{{ currentMoments.length }}개</span>
        </h2>
        <p v-if="!readonlyMode" class="widget-sub">전체 {{ browser.total.value }}개</p>
      </div>
      <button v-if="!readonlyMode" type="button" class="pill" @click="openAll">
        모두 보기 ({{ browser.total.value }})
      </button>
    </div>

    <MomentsStatusBanner v-if="!readonlyMode" />

    <!--
      영상 띠에는 저장이 없다. 대시보드에서 잡아 둔 초안이 있으면 잃지 않았다는 것과 이어 쓰는 길만
      보인다 (M11-7C 초안 B).
    -->
    <p v-if="readonlyMode && draftStore.draft !== null" class="draft-notice">
      저장 전 초안 <strong>{{ draftTime }}</strong> 이 있어요.
      <button type="button" class="link" @click="resumeDraft">이 곡 탭에서 이어 쓰기</button>
    </p>

    <!-- 빠른 저장 — 대시보드에서만. 영상 띠(보관함이 열림)에서는 보관함 Moments › 이 곡에서 한다. -->
    <MomentCapture v-if="!readonlyMode" id-prefix="dashboard-moment" @saved="onSaved" />

    <CurrentMomentsList
      v-if="currentVideoId !== null && currentMoments.length > 0"
      :moments="currentMoments"
      :position-seconds="positionSeconds"
      :highlight-id="highlightId"
      :compact="readonlyMode"
      :song-title="currentTitle"
      @play="(id) => void browser.play(id)"
    />
    <p v-else-if="currentVideoId === null && readonlyMode" class="empty">재생 중인 곡이 없어요.</p>
    <p v-else-if="currentVideoId !== null" class="empty">이 곡에 저장한 순간이 아직 없어요.</p>

    <!-- 재생 결과 (가려짐 · 플레이어 준비 전 등) -->
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
/* 색 · 치수는 기존 토큰만 쓴다. 머리말은 `NowPlaylistWidget` 과 같은 조판이다. */
.moments-widget {
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

.widget-title {
  margin: 0;
  color: var(--drawer-title-text-color);
  font: 13px var(--font-mono);
  font-weight: 400;
  letter-spacing: 0.1em;
}

.count {
  margin-left: 6px;
  color: var(--drawer-sub-text-color);
  font-size: 11px;
  letter-spacing: 0.04em;
}

.widget-sub {
  margin: 7px 0 0;
  color: var(--drawer-sub-text-color);
  font: 11px var(--font-mono);
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

/* 터치 뒤 hover 색이 남지 않게 (M11 U18). */
@media (hover: hover) {
  .pill:hover:not(:disabled) {
    background: var(--pill-surface-hover-color);
  }
}

.feedback {
  margin: 0;
  color: var(--status-text-color);
  font: 11px/1.6 var(--font-mono);
}

.feedback:empty {
  display: none;
}

.feedback.is-warning {
  color: var(--status-warning-text-color);
}

.empty {
  margin: 0;
  color: var(--drawer-muted-text-color);
  font-size: 12px;
  line-height: 1.6;
}

.draft-notice {
  margin: 0;
  padding: 4px 8px;
  border: 1px dashed var(--accent-strong-color);
  color: var(--drawer-sub-text-color);
  font: 11px/1.6 var(--font-mono);
}

.draft-notice strong {
  color: var(--drawer-title-text-color);
  font-weight: 400;
}

.link {
  min-height: 32px;
  padding: 0 4px;
  border: 0;
  background: none;
  color: var(--accent-color);
  font: inherit;
  text-decoration: underline;
  text-underline-offset: 3px;
}

/* 영상 띠 안(보기 전용) — 머리말과 목록 사이를 좁힌다. */
.moments-widget.is-readonly {
  gap: 6px;
}
</style>
