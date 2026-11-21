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
 *
 * M12-2 (ADR 0032) — 영상 위아래에 있던 `NOW PLAYING` 제목 · 부제 · 트랜스포트 · 상태 줄을 영상 **바로 아래**의
 * **Now Playing 카드**(`NowPlayingCard.vue`, 앨범아트 · 제목 · 조작)로 모았다 — 사본을 남기지 않았다. 카드는 영상
 * 상자의 **형제**이고 어댑터 소유 영역 밖이다 (M11 까지의 제목 · 조작과 같은 자리). 어댑터 소유 영역 · 가시성 감시 ·
 * 마운트 순서는 그대로다.
 *
 * 보관함이 열려 있는 동안(조상의 `data-archive-layout`) 이 영역은 **작은 재생 띠**가 된다 — 넓으면 [영상 | 카드],
 * 좁으면 영상 → 한 줄 카드. 같은 노드를 CSS 로 다시 놓을 뿐이다: 조건부 렌더 · 이동 · 복제가 없고, 영상은 숨기지도
 * 덮지도 않으며 200×200 아래로 줄지 않는다. 규칙은 이 파일 맨 아래의 비스코프 스타일에 있다.
 */
import { inject, onMounted, onUnmounted, useTemplateRef } from 'vue'

import NowPlayingCard from './NowPlayingCard.vue'
import { PLAYER_ADAPTER_FACTORY, type PlayerAdapter } from './PlayerAdapter'
import { PLAYBACK_COORDINATOR, type PlayerAttachment } from './playbackCoordinator'
import { watchPlayerVisibility, type PlayerVisibilityWatcher } from './playerVisibility'
import { useTransport } from './useTransport'

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

/** 영상 전 안내를 보일지만 읽는다. 제목 · 조작은 Now Playing 카드가 쓴다 (M12-2). */
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
</script>

<template>
  <section class="player-surface" aria-label="YouTube 영상">
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
          <strong>YOUTUBE / VIDEO</strong>
        </div>
      </div>

      <!--
        어댑터 소유 영역. Vue 템플릿은 이 안에 자식을 두지 않는다.
        어댑터가 자신의 자식 노드를 만들고, 그 안의 노드가 iframe 이 된다.
      -->
      <div ref="mountHost" class="player-mount" />
    </div>

    <!-- 영상 바로 아래의 카드 (M12-2). 어댑터 소유 영역 **밖**의 형제다. 영상을 덮지 않는다. -->
    <NowPlayingCard />
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

/*
 * 승인된 디자인의 .video-holder 값을 따른다.
 *
 * 16:9 를 유지하고 최소 200x200 을 확보한다. 부모 Grid 가 높이를 눌러
 * 이 영역이 찌그러지지 않도록 min-height 를 함께 둔다. **이 min-width /
 * min-height 가 공식 요구사항(200×200)을 CSS 로 보장하는 1차 방어선이고**,
 * 실제 측정은 `playerVisibility.ts` 가 한다 (M3-4).
 */
.video-holder {
  /*
   * 테두리 두께. 최소 크기 계산에 쓰므로 변수로 둔다.
   *
   * 공식 요구는 **플레이어 뷰포트**(iframe)가 200×200 이상이라는 것이다.
   * 테두리는 그 바깥이다. `box-sizing: border-box` 아래에서 최소값에 테두리를
   * 더하지 않으면, 360px 화면에서 iframe 이 198px 이 되어 요구를 어긴다
   * (M5 브라우저 실측에서 발견).
   */
  --video-border-width: 1px;

  position: relative;
  width: 100%;
  min-width: calc(var(--size-video-min) + 2 * var(--video-border-width));
  min-height: calc(var(--size-video-min) + 2 * var(--video-border-width));
  aspect-ratio: var(--ratio-video);
  border: var(--video-border-width) solid var(--video-border-color);
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
</style>

<!--
  보관함이 열렸을 때의 작은 배치 (M11-7B · 배치 C, M12-2 에서 카드로).

  **비스코프**다 — 조상(`DashboardShell` 의 워크스페이스)이 다는 `data-archive-layout` 을 봐야 하는데, 스코프 스타일은
  조상의 속성으로 시작하는 규칙을 쓸 수 없다. 이 컴포넌트의 클래스만 겨냥하고 `.player-surface` 아래로 한정한다.
  카드 안쪽의 작은 모양은 `NowPlayingCard.vue` 의 비스코프 스타일이 정한다.

  영상(`.video-holder`)은 어느 배치에서도 `display` · `visibility` 를 건드리지 않고, 폭은 384px 이상(16:9 → 216px) 또는
  열 전체다. `min-width` / `min-height` 202px 은 그대로 남는다.
-->
<style>
/* 띠 (넓은 화면): 왼쪽 영상, 오른쪽 Now Playing 카드. */
[data-archive-layout='strip'] .player-surface {
  display: grid;
  align-items: start;
  column-gap: clamp(14px, 1.8vw, 24px);
  grid-template-areas: 'video card';
  grid-template-columns: clamp(384px, 34%, 480px) minmax(0, 1fr);
}

/* 영상은 왼쪽 칸 — 크기 · 표시는 건드리지 않는다 (최소 202px 은 스코프 스타일 그대로). */
[data-archive-layout='strip'] .player-surface > .video-holder {
  grid-area: video;
}

[data-archive-layout='strip'] .player-surface > .now-playing-card {
  grid-area: card;
  margin-top: 0;
}

/* 쌓기 · 옆 (좁은 화면): 영상 → 한 줄 카드. 영상과 카드 사이를 좁힌다. */
[data-archive-layout='stack'] .player-surface > .now-playing-card,
[data-archive-layout='side'] .player-surface > .now-playing-card {
  margin-top: 6px;
}
</style>
