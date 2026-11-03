<script setup lang="ts">
/**
 * 플레이어 영역 — `NOW PLAYING` · 영상 · 트랜스포트 · 상태.
 *
 * 승인된 디자인의 `.music` 블록 구조를 따른다.
 *
 * DOM 소유권이 둘로 나뉜다.
 *   `.player-surface` 와 그 자식들 → Vue 소유
 *   `.player-mount` 의 **자식** → 어댑터 소유 (Vue가 렌더·패치하지 않는다)
 *
 * `.player-mount` 안에 Vue 템플릿이 자식을 두지 않는 것이 핵심이다.
 * `YT.Player` 가 어댑터의 자식 노드를 iframe으로 교체하는데, Vue가 같은 영역을
 * 패치하면 충돌한다. 트랜스포트 컨트롤도 **그 영역 밖의 형제**다 — 영상을
 * 가리지 않는다 (개발자 정책 III.I.6).
 *
 * 그래서 영상 로딩 전 안내(`.video-placeholder`, M3-5)도 `.player-mount` 안이
 * 아니라 **그 형제**다. 둘을 Vue 소유의 `.video-holder` 가 감싸고, 안내는 그
 * 안에서 절대 위치로 겹친다. 승인된 레퍼런스도 `.video-holder` 안에
 * `.video-placeholder` 와 `.yt-host` 를 형제로 둔다.
 *
 * 왜 이렇게까지 하는가: 플레이어 iframe은 언마운트는 물론 **부모가 바뀌기만
 * 해도 재로드된다.** 따라서 이 컴포넌트는 테마 전환·재렌더·반응형 변경에서
 * 절대 재마운트되지 않아야 한다
 * (`docs/decisions/0002-persistent-player-host.md`).
 *
 * 금지: 테마별 PlayerSurface 생성, 테마 전환 시 `v-if` 제거, `:key`에 테마
 * 포함, `<Teleport>`로 이동, 마운트된 노드의 부모 변경.
 *
 * 단일 루트 요소를 유지한다. `WidgetHost`가 `grid-area`를 루트에 적용한다.
 */
import { computed, inject, onMounted, onUnmounted, useTemplateRef } from 'vue'

import { PLAYER_ADAPTER_FACTORY, type PlayerAdapter } from './PlayerAdapter'
import PlayerTransport from './PlayerTransport.vue'
import { PLAYBACK_COORDINATOR, type PlayerAttachment } from './playbackCoordinator'
import { watchPlayerVisibility, type PlayerVisibilityWatcher } from './playerVisibility'
import { useTransport } from './useTransport'

/** 어댑터 팩토리가 없을 때. 실제 실패 상태이므로 경고로 알린다. */
const NO_ADAPTER_STATUS = '플레이어를 연결하지 못했습니다.'

const mountHost = useTemplateRef<HTMLElement>('mountHost')

/**
 * 어댑터 팩토리. 주입되지 않으면 어댑터를 만들지 않는다.
 *
 * 앱에서는 `main.ts` 가 `YouTubeIFramePlayerAdapter` 팩토리를 주입하고,
 * 테스트는 `FakePlayerAdapter` 팩토리를 주입한다.
 */
const createAdapter = inject(PLAYER_ADAPTER_FACTORY, null)

/**
 * 재생 조립을 맡는 코디네이터 (M3-2).
 *
 * 이 컴포넌트는 **어댑터의 수명만** 책임진다. 큐·라이브러리·오류 정책은
 * 모르고, 어댑터를 등록해 코디네이터가 명령을 보낼 수 있게 할 뿐이다.
 * 주입되지 않으면 등록하지 않는다 — 단독 마운트 테스트를 위한 기본값이다.
 */
const coordinator = inject(PLAYBACK_COORDINATOR, null)

/** 화면에 보일 값과 버튼 명령. 로직은 composable 에 있다 (규칙 3). */
const transport = useTransport()

/**
 * 어댑터 인스턴스를 **반응형 state에 두지 않는다.**
 *
 * Pinia state나 `ref`에 넣으면 Vue가 프록시로 감싸고 의존성 추적 대상이 되어,
 * 외부 플레이어와 DOM 노드가 반응형 그래프에 끌려들어간다.
 */
let adapter: PlayerAdapter | null = null
let attachment: PlayerAttachment | null = null

/**
 * 가시성 감시 (M3-4). 어댑터와 같은 수명이고 같은 이유로 비반응형이다.
 *
 * 영상 영역을 **소유한 쪽**이 재는 것이 맞다. 코디네이터는 DOM 을 모르고,
 * store 에는 노드를 넣지 않는다.
 */
let visibilityWatcher: PlayerVisibilityWatcher | null = null

onMounted(() => {
  if (createAdapter === null) return

  const container = mountHost.value
  if (container === null) return

  adapter = createAdapter()

  /*
   * 영역이 보이지 않게 되면 코디네이터에 알린다. 멈출지 말지는 코디네이터가
   * 정한다 — 여기는 "얼마나 보이는가" 만 안다.
   */
  visibilityWatcher = watchPlayerVisibility(container, () =>
    coordinator?.revalidatePlayerVisibility(),
  )

  /*
   * 등록을 마운트보다 먼저 한다. 코디네이터가 준 핸들러를 그대로
   * `mount()` 에 넘기므로, 첫 사건이 오기 전에 연결이 서 있어야 한다.
   *
   * 어댑터가 store 를 직접 바꾸지 않는다는 단방향은 그대로다 (ADR 0006).
   * 사건을 store 로 옮기는 일은 코디네이터가 한다 (ADR 0009).
   */
  attachment = coordinator?.attachAdapter(adapter, visibilityWatcher) ?? null
  adapter.mount(container, attachment?.events)
})

onUnmounted(() => {
  // 실제 언마운트에서만 불린다. 테마 전환은 여기에 닿지 않는다.
  visibilityWatcher?.stop()
  visibilityWatcher = null
  attachment?.detach()
  attachment = null
  adapter?.destroy()
  adapter = null
})

/**
 * 라이브 리전에 넣을 문구.
 *
 * 의도적으로 띄운 안내만 담는다. 재생 상태(`재생 중` 등)는 **부제**에 적는다 —
 * 여기 넣으면 상태가 바뀔 때마다 보조기기가 읽어 시끄러워진다.
 * 같은 문구가 유지되면 DOM 이 바뀌지 않아 다시 읽히지도 않는다.
 */
const statusText = computed<string>(() =>
  createAdapter === null ? NO_ADAPTER_STATUS : transport.statusText.value,
)

const statusIsWarning = computed<boolean>(() => createAdapter === null || transport.isWarning.value)
</script>

<template>
  <section class="player-surface">
    <p class="eyebrow">NOW PLAYING · YOUTUBE</p>
    <p class="now-title" :title="transport.title.value">{{ transport.title.value }}</p>
    <p class="now-sub">{{ transport.subtitle.value }}</p>

    <!--
      승인된 디자인의 `.video-holder`. Vue 가 소유한다. 테두리·비율·최소
      크기를 여기서 잡는다.
    -->
    <div class="video-holder">
      <!--
        영상이 들어서기 전 안내. 어댑터 소유 영역 **밖**의 형제다.

        `v-if` 가 아니라 클래스로 숨긴다. 승인된 레퍼런스도 `.hidden` 토글을
        쓴다. 이 컴포넌트에서는 조건부 렌더를 아예 쓰지 않는 쪽이 안전하다 —
        `v-if` 하나가 영상 영역 쪽으로 옮겨 붙기만 해도 iframe 이 재로드된다
        (ADR 0002). 정적 검사도 그 금지를 그대로 지킬 수 있다.
      -->
      <div class="video-placeholder" :class="{ 'is-hidden': !transport.showsPlaceholder.value }">
        <div>
          <strong>YOUTUBE / VIDEO</strong>영상은 이 위치에 16:9로 표시됩니다.<br />플레이리스트에서
          곡을 선택하세요.
        </div>
      </div>

      <!--
        어댑터 소유 영역. Vue 템플릿은 이 안에 자식을 두지 않는다.
        어댑터가 자신의 자식 노드를 만들고, 그 안의 노드가 iframe 이 된다.
      -->
      <div ref="mountHost" class="player-mount" />
    </div>

    <!-- 어댑터 소유 영역 **밖**의 형제다. 영상을 덮지 않는다. -->
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

    <p class="status" :class="{ 'is-warning': statusIsWarning }" role="status" aria-live="polite">
      {{ statusText }}
    </p>

    <p class="mute-note">YouTube 공식 영상·컨트롤은 그대로 표시됩니다.</p>
  </section>
</template>

<style scoped>
/*
 * 승인된 디자인의 `.music` 블록을 따른다. 간격은 각 요소의 margin/padding 이
 * 정한다 (레퍼런스와 같은 방식). 컨테이너에 gap 을 두지 않는다.
 */
.player-surface {
  min-width: 0;
}

/* 승인된 디자인의 `.eyebrow` 값을 따른다. */
.eyebrow {
  margin: 0;
  color: var(--eyebrow-text-color);
  font: 11px var(--font-mono);
  letter-spacing: 0.12em;
}

/* 승인된 디자인의 `.now-title` 값을 따른다. */
.now-title {
  overflow: hidden;
  margin: 10px 0 0;
  color: var(--now-title-text-color);
  font-size: clamp(18px, 1.6vw, 23px);
  font-weight: 500;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 승인된 디자인의 `.now-sub` 값을 따른다. */
.now-sub {
  overflow: hidden;
  margin: 7px 0 14px;
  color: var(--now-sub-text-color);
  font: 12px var(--font-mono);
  text-overflow: ellipsis;
  white-space: nowrap;
}

/*
 * 승인된 디자인의 .video-holder 값을 따른다.
 *
 * 16:9 를 유지하고 최소 200x200 을 확보한다. 부모 Grid 가 높이를 눌러
 * 이 영역이 찌그러지지 않도록 min-height 를 함께 둔다. **이 min-width /
 * min-height 가 공식 요구사항(200×200)을 CSS 로 보장하는 1차 방어선이고**,
 * 실제 측정은 `playerVisibility.ts` 가 한다 (M3-4).
 */
.video-holder {
  position: relative;
  width: 100%;
  min-width: var(--size-video-min);
  min-height: var(--size-video-min);
  aspect-ratio: var(--ratio-video);
  border: 1px solid var(--video-border-color);
  background: var(--video-surface-color);
  box-shadow: var(--video-shadow);
}

/*
 * 어댑터 소유 영역. 홀더를 꽉 채운다.
 *
 * 가시성 측정 대상이 이 요소다 (M3-4). 홀더와 같은 사각형이 되도록
 * `inset: 0` 으로 붙인다.
 */
.player-mount {
  position: absolute;
  inset: 0;
}

/* 승인된 디자인의 `.video-placeholder` 값을 따른다. */
.video-placeholder {
  position: absolute;
  inset: 0;
  display: grid;
  padding: 18px;
  color: var(--video-placeholder-text-color);
  font: 12px/1.8 var(--font-mono);
  place-items: center;
  text-align: center;
}

/* 승인된 디자인의 `.hidden` 과 같은 역할이다. */
.video-placeholder.is-hidden {
  display: none;
}

/* 승인된 디자인의 `.video-placeholder strong` 값을 따른다. */
.video-placeholder strong {
  display: block;
  margin-bottom: 9px;
  color: var(--video-placeholder-strong-text-color);
  font: 20px var(--font-mono);
}

/*
 * 어댑터 소유 서브트리를 영역에 꽉 채운다.
 *
 * 자손까지 내려가는 이유: 어댑터는 자신의 안정적인 노드 안에 교체당할 자식을
 * 하나 더 두고, YT.Player 가 **그 자식**을 iframe 으로 바꾼다. 직계 자식만
 * 겨냥하면 iframe 이 크기를 못 받는다.
 */
.player-mount :deep(*) {
  display: block;
  width: 100%;
  height: 100%;
  border: 0;
}

/*
 * 승인된 디자인의 `.status` 값을 따른다.
 *
 * `min-height` 덕에 문구가 비어도 레이아웃이 흔들리지 않는다. 그래서
 * 재생 중에는 비워둘 수 있다.
 */
.status {
  min-height: 39px;
  margin: 0;
  padding-top: 10px;
  color: var(--status-text-color);
  font: 12px/1.5 var(--font-mono);
}

/* 승인된 디자인의 `.status.warning` 값을 따른다. */
.status.is-warning {
  color: var(--status-warning-text-color);
}

/* 승인된 디자인의 `.mute-note` 값을 따른다. */
.mute-note {
  margin: 0;
  padding-top: 5px;
  color: var(--mute-note-text-color);
  font: 10px var(--font-mono);
}
</style>
