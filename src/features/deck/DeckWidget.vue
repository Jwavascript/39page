<script setup lang="ts">
/**
 * 데크 위젯 — 하나의 안정적인 인스턴스.
 *
 * 두 테마의 데크 아트를 **모두 마운트한 상태로** 두고, 활성 테마의 것만
 * 보여준다. 테마 전환으로 이 위젯이나 자식 아트가 언마운트되지 않는다
 * (`docs/decisions/0001-theme-switching-mechanism.md`).
 *
 * 표시 전환은 두 층에서 일어난다.
 *   시각적 표시 → 각 테마의 `deck.css` 가 `:root[data-theme]` 로 `display` 전환
 *   접근성 트리 → 비활성 아트에 `aria-hidden="true"`
 *
 * `display: none` 만으로도 접근성 트리에서 빠지지만, `aria-hidden` 을 함께
 * 두는 이유가 두 가지다. 외부 CSS 로드 실패 시에도 보조기기에 두 데크가
 * 동시에 읽히지 않고, jsdom 처럼 CSS 계산이 없는 환경에서도 활성 테마를
 * DOM 으로 검증할 수 있다.
 *
 * 단일 루트를 유지한다. `WidgetHost` 가 `grid-area` 를 루트에 적용한다.
 *
 * M2 연결 지점: 데크를 눌러 Record Library 를 여는 동작은 M2 다. 지금은
 * 동작하지 않는 버튼이나 안내 문구를 만들지 않는다. M2 는 이 컴포넌트에
 * 접근 가능한 트리거를 더하면 되고, 아트 컴포넌트는 건드리지 않는다.
 */
import KawaiiCassetteDeckArt from '@/themes/kawaii-synth-cassette/DeckArt.vue'
import MonoVinylDeckArt from '@/themes/mono-vinyl/DeckArt.vue'
import { useThemeStore } from '@/stores/theme'

const theme = useThemeStore()
</script>

<template>
  <div class="deck-widget">
    <!--
      두 아트가 항상 함께 존재한다. v-if 로 교체하지 않는다.
      :key 를 쓰지 않으므로 테마가 바뀌어도 재마운트되지 않는다.
    -->
    <MonoVinylDeckArt :aria-hidden="theme.current !== 'mono-vinyl' || undefined" />
    <KawaiiCassetteDeckArt :aria-hidden="theme.current !== 'kawaii-synth-cassette' || undefined" />
  </div>
</template>

<style scoped>
/*
 * 승인된 디자인의 `.deck-graphic` 값을 따른다.
 * 그림자는 테마 토큰이 결정한다 (mono / kawaii 가 다르다).
 */
.deck-widget {
  position: relative;
  width: 100%;
  min-width: 0;
  filter: var(--deck-shadow);
}
</style>
