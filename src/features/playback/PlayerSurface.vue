<script setup lang="ts">
/**
 * 플레이어를 표시할 **안정적인 DOM 영역**.
 *
 * DOM 소유권이 둘로 나뉜다.
 *   `.player-surface` · `.player-mount` · `.player-notice` → Vue 소유
 *   `.player-mount` 의 **자식** → 어댑터 소유 (Vue가 렌더·패치하지 않는다)
 *
 * `.player-mount` 안에 Vue 템플릿이 자식을 두지 않는 것이 핵심이다.
 * `YT.Player` 가 어댑터의 자식 노드를 iframe으로 교체하는데, Vue가 같은 영역을
 * 패치하면 충돌한다.
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

import { usePlaybackStore } from '@/stores/playback'

import { PLAYER_ADAPTER_FACTORY, type PlayerAdapter } from './PlayerAdapter'

const mountHost = useTemplateRef<HTMLElement>('mountHost')

/**
 * 어댑터 팩토리. 주입되지 않으면 어댑터를 만들지 않는다.
 *
 * 앱에서는 `main.ts` 가 `YouTubeIFramePlayerAdapter` 팩토리를 주입하고,
 * 테스트는 `FakePlayerAdapter` 팩토리를 주입한다.
 */
const createAdapter = inject(PLAYER_ADAPTER_FACTORY, null)

const playback = usePlaybackStore()

/**
 * 어댑터 인스턴스를 **반응형 state에 두지 않는다.**
 *
 * Pinia state나 `ref`에 넣으면 Vue가 프록시로 감싸고 의존성 추적 대상이 되어,
 * 외부 플레이어와 DOM 노드가 반응형 그래프에 끌려들어간다.
 */
let adapter: PlayerAdapter | null = null

onMounted(() => {
  if (createAdapter === null) return

  const container = mountHost.value
  if (container === null) return

  adapter = createAdapter()

  /*
   * 어댑터가 store 를 직접 바꾸지 않는다. 사건을 여기서 받아 store 에
   * 반영하는 단방향을 지킨다 (ADR 0006, ADR 0008).
   *
   * M3-1 에서 반영하는 것은 상태뿐이다. `ready` · `error` ·
   * `autoplayBlocked` 의 화면 처리(상태 메시지, 외부 링크, 자동재생 안내)는
   * M3-3 · M3-5 다. 아직 동작하지 않는 UI 를 미리 만들지 않는다.
   */
  adapter.mount(container, {
    stateChange: (state) => {
      playback.setPlayerState(state)
    },
  })
})

onUnmounted(() => {
  // 실제 언마운트에서만 불린다. 테마 전환은 여기에 닿지 않는다.
  adapter?.destroy()
  adapter = null
})

/**
 * 개발 단계 표시.
 *
 * 어댑터가 주입됐으면 **실제 플레이어 상태**를 적는다. 어댑터가 붙어 있는데도
 * "NOT CONNECTED" 라고 적으면 화면이 거짓을 말한다. 재생 컨트롤과 사용자용
 * 상태 메시지는 M3-3 이다.
 */
const notice = computed<string>(() =>
  createAdapter === null
    ? 'YOUTUBE PLAYER / NOT CONNECTED'
    : `YOUTUBE PLAYER / ${playback.playerState.toUpperCase()}`,
)
</script>

<template>
  <section class="player-surface">
    <!--
      어댑터 소유 영역. Vue 템플릿은 이 안에 자식을 두지 않는다.
      어댑터가 자신의 자식 노드를 만들고, 그 안의 노드가 iframe 이 된다.
    -->
    <div ref="mountHost" class="player-mount" />

    <!--
      어댑터 소유 영역 **밖**의 형제로 둔다.
      동작하지 않는 재생 컨트롤을 만들지 않는다.
    -->
    <p class="player-notice">{{ notice }}</p>
  </section>
</template>

<style scoped>
.player-surface {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 8px;
}

/*
 * 승인된 디자인의 .video-holder 값을 따른다.
 *
 * 16:9 를 유지하고 최소 200x200 을 확보한다. 부모 Grid 가 높이를 눌러
 * 이 영역이 찌그러지지 않도록 min-height 를 함께 둔다. 실제 가시성 준수는
 * M3-4 의 가시성 가드에서 다시 확인한다.
 */
.player-mount {
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

.player-notice {
  margin: 0;
  color: var(--text-dim-color);
  font: 10px var(--font-mono);
  letter-spacing: 0.12em;
  text-align: center;
}
</style>
