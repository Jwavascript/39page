<script setup lang="ts">
/**
 * Now Playing 카드 — 지금 곡의 앨범아트 · 제목 · 재생 상태 · 위치 · 재생 조작 · 안내 (M12-2, ADR 0032).
 *
 * 영상 **바로 아래**의 카드다. M11 까지 `PlayerSurface` 안 영상 위아래에 있던 제목 · 부제 · 트랜스포트 · 상태 줄을
 * **옮겨 왔다** — 영상 쪽에는 남지 않는다 (같은 곡 정보와 버튼을 한 화면에 두 번 보이지 않는다). 마스코트
 * 패널(`COMPANION / 01`)의 자리를 이 카드가 쓴다.
 *
 * 로직은 `useTransport` · `usePlaybackPosition` 에 있고 이 컴포넌트는 놓기만 한다 (규칙 3). 플레이어 어댑터를
 * 부르지 않는다 — 명령은 코디네이터로 간다 (ADR 0009). 테마를 모른다 — 색은 토큰, 기본 그림은 `ArtworkImage`
 * 안에서 CSS 로 고른다 (ADR 0001).
 *
 * **플레이어 위젯(`PlayerSurface`) 안**, 영상 상자의 형제로 선다 — 따로 된 그리드 칸이면 세 열이 행 높이를 나눠 써서
 * 영상과 카드 사이가 벌어진다 (ADR 0032 결과 절). 보관함이 열리면 같은 인스턴스가 재생 띠에 작게 선다 (조상의
 * `data-archive-layout`, 맨 아래 비스코프 스타일).
 */
import { computed, inject } from 'vue'

import ArtworkImage from '@/features/artwork/ArtworkImage.vue'
import { formatTimestamp } from '@/shared/utils/time'
import { usePlaybackStore } from '@/stores/playback'

import { PLAYER_ADAPTER_FACTORY } from './PlayerAdapter'
import PlayerTransport from './PlayerTransport.vue'
import { usePlaybackPosition } from './usePlaybackPosition'
import { useTransport } from './useTransport'

/** 어댑터 팩토리가 없을 때. 실제 실패 상태이므로 경고로 알린다 (M3 의 `PlayerSurface` 문구 그대로). */
const NO_ADAPTER_STATUS = '플레이어를 연결하지 못했습니다.'

const transport = useTransport()
const playback = usePlaybackStore()
const { position } = usePlaybackPosition()
const createAdapter = inject(PLAYER_ADAPTER_FACTORY, null)

const videoId = computed<string | null>(() => playback.currentTrack?.videoId ?? null)

/** 지금 초. 길이(duration)는 플레이어 계약에 없다 — 추정해 적지 않는다. 위치를 모르면 적지 않는다. */
const positionText = computed<string | null>(() => {
  const at = position.value
  if (at === null || at.videoId !== videoId.value) return null
  return formatTimestamp(at.seconds)
})

/**
 * 라이브 리전 문구. 의도적으로 띄운 안내만 담는다 — 재생 상태는 부제에 적는다 (ADR 0010).
 * 같은 문구가 유지되면 DOM 이 바뀌지 않아 다시 읽히지 않는다.
 */
const statusText = computed<string>(() =>
  createAdapter === null ? NO_ADAPTER_STATUS : transport.statusText.value,
)
const statusIsWarning = computed<boolean>(() => createAdapter === null || transport.isWarning.value)
</script>

<template>
  <section class="now-playing-card" aria-label="지금 재생">
    <div class="np-body">
      <div class="np-art">
        <ArtworkImage :video-id="videoId" />
      </div>

      <div class="np-info">
        <p class="eyebrow">NOW PLAYING · YOUTUBE</p>
        <p class="now-title" :title="transport.title.value">{{ transport.title.value }}</p>
        <p class="now-sub">
          {{ transport.subtitle.value
          }}<span v-if="positionText !== null" class="now-position"> · {{ positionText }}</span>
        </p>

        <PlayerTransport
          :shows-pause="transport.showsPause.value"
          :can-toggle="transport.canToggle.value"
          :can-previous="transport.canPrevious.value"
          :can-next="transport.canNext.value"
          :toggle-label="transport.toggleLabel.value"
          :youtube-url="transport.youtubeUrl.value"
          @previous="transport.previous"
          @toggle="transport.toggle"
          @next="transport.next"
        />

        <p
          class="status"
          :class="{ 'is-warning': statusIsWarning, 'is-empty': statusText === '' }"
          role="status"
          aria-live="polite"
        >
          {{ statusText }}
        </p>

        <!-- 승인된 디자인의 `.mute-note` (영상 아래에서 카드로 옮겼다). -->
        <p class="mute-note">YouTube 공식 영상·컨트롤은 그대로 표시됩니다.</p>
      </div>
    </div>
  </section>
</template>

<style scoped>
/*
 * 카드 폭에 따라 그림 크기를 정한다 — 컨테이너 쿼리. 같은 카드가 3열의 가운데(약 470px) · 2열의 전체 폭 ·
 * 320px 폰(약 286px) · 보관함 띠에 선다. 화면 폭이 아니라 **카드가 받은 폭**으로 정해야 어느 배치에서도 맞다.
 */
.now-playing-card {
  min-width: 0;
  margin-top: 14px;
  container: now-playing / inline-size;
}

.np-body {
  --np-art-size: 148px;

  display: grid;
  align-items: start;
  padding: 14px;
  border: 1px solid var(--artwork-card-border-color);
  background: var(--artwork-card-background);
  box-shadow: var(--artwork-card-shadow);
  gap: 16px;
  grid-template-columns: var(--np-art-size) minmax(0, 1fr);
}

.np-art {
  width: var(--np-art-size);
  aspect-ratio: 1;
  border: 1px solid var(--artwork-frame-border-color);
  background: var(--artwork-frame-surface-color);
  box-shadow: var(--artwork-frame-shadow);
  overflow: hidden;
}

.np-info {
  display: flex;
  min-width: 0;
  flex-direction: column;
}

/* 승인된 디자인의 `.eyebrow` 값을 따른다 (영상 위에서 옮겨 왔다). */
.eyebrow {
  margin: 0;
  color: var(--artwork-label-text-color);
  font: 11px var(--font-mono);
  letter-spacing: 0.12em;
}

/* 승인된 디자인의 `.now-title` 값 — 카드 안에서는 두 줄까지 (긴 제목이 잘려 무엇인지 모르는 일을 줄인다). */
.now-title {
  display: -webkit-box;
  margin: 8px 0 0;
  color: var(--now-title-text-color);
  font-size: clamp(17px, 1.5vw, 21px);
  font-weight: 500;
  line-height: 1.3;
  overflow: hidden;
  overflow-wrap: anywhere;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  line-clamp: 2;
}

/* 승인된 디자인의 `.now-sub` 값. */
.now-sub {
  margin: 6px 0 0;
  color: var(--now-sub-text-color);
  font: 12px/1.5 var(--font-mono);
  overflow-wrap: anywhere;
}

.np-info :deep(.action-row) {
  flex-wrap: wrap;
  padding-top: 10px;
}

/* 승인된 디자인의 `.status` 값 — 비어 있으면 자리를 차지하지 않는다 (영상은 카드 위라 흔들리지 않는다). */
.status {
  margin: 0;
  padding-top: 8px;
  color: var(--status-text-color);
  font: 12px/1.5 var(--font-mono);
}

.status.is-empty {
  display: none;
}

/* 승인된 디자인의 `.mute-note` 값. */
.mute-note {
  margin: 0;
  padding-top: 8px;
  color: var(--mute-note-text-color);
  font: 10px var(--font-mono);
}

.status.is-warning {
  color: var(--status-warning-text-color);
}

/* 카드가 좁으면 그림을 줄인다 — 제목 칸이 너무 좁아지지 않게. */
@container now-playing (max-width: 440px) {
  .np-body {
    --np-art-size: 112px;

    padding: 12px;
    gap: 12px;
  }
}

/* 320px 폰(카드 약 286px) — 그림 88px, 제목 칸 약 160px. */
@container now-playing (max-width: 330px) {
  .np-body {
    --np-art-size: 88px;

    padding: 10px;
    gap: 10px;
  }

  .now-title {
    font-size: 16px;
  }
}
</style>

<!--
  보관함이 열렸을 때의 작은 배치 (M12-2 — M11-7B 의 재생 띠 C 안을 잇는다). 같은 인스턴스를 CSS 로만 다시 놓는다.
  비스코프다 — 조상(`DashboardShell` 워크스페이스)의 `data-archive-layout` 을 봐야 한다. 이 카드의 클래스만 겨냥한다.
-->
<style>
/* 띠 (넓은 화면): 작은 그림 · 제목 · 조작. "YOUTUBE에서 열기" 는 닫으면 그대로 있다. */
[data-archive-layout='strip'] .now-playing-card .np-body {
  --np-art-size: 72px;

  padding: 10px;
  gap: 12px;
}

[data-archive-layout='strip'] .now-playing-card .eyebrow,
[data-archive-layout='strip'] .now-playing-card .mute-note {
  display: none;
}

[data-archive-layout='strip'] .now-playing-card .now-title {
  margin-top: 0;
  font-size: 16px;
}

[data-archive-layout='strip'] .now-playing-card .action-row {
  padding-top: 6px;
}

/* 쌓기 · 옆 (좁은 화면): 그림 없이 한 줄 — 제목 | 조작. 보관함에 높이를 준다. */
[data-archive-layout='stack'] .now-playing-card .np-body,
[data-archive-layout='side'] .now-playing-card .np-body {
  padding: 0;
  border: 0;
  background: none;
  box-shadow: none;
  grid-template-columns: minmax(0, 1fr);
}

[data-archive-layout='stack'] .now-playing-card .np-art,
[data-archive-layout='side'] .now-playing-card .np-art,
[data-archive-layout='stack'] .now-playing-card .eyebrow,
[data-archive-layout='side'] .now-playing-card .eyebrow,
[data-archive-layout='stack'] .now-playing-card .now-sub,
[data-archive-layout='side'] .now-playing-card .now-sub,
[data-archive-layout='stack'] .now-playing-card .external,
[data-archive-layout='side'] .now-playing-card .external,
[data-archive-layout='stack'] .now-playing-card .mute-note,
[data-archive-layout='side'] .now-playing-card .mute-note {
  display: none;
}

[data-archive-layout='stack'] .now-playing-card .np-info,
[data-archive-layout='side'] .now-playing-card .np-info {
  display: grid;
  align-items: center;
  column-gap: 10px;
  grid-template-areas:
    'title controls'
    'status status';
  grid-template-columns: minmax(0, 1fr) auto;
}

[data-archive-layout='stack'] .now-playing-card .now-title,
[data-archive-layout='side'] .now-playing-card .now-title {
  grid-area: title;
  margin: 0;
  font-size: 14px;
  -webkit-line-clamp: 1;
  line-clamp: 1;
}

[data-archive-layout='stack'] .now-playing-card .action-row,
[data-archive-layout='side'] .now-playing-card .action-row {
  grid-area: controls;
  padding-top: 0;
}

[data-archive-layout='stack'] .now-playing-card .status,
[data-archive-layout='side'] .now-playing-card .status {
  grid-area: status;
  padding-top: 4px;
}
</style>
