<script setup lang="ts">
/**
 * YouTube 에서 찾기 — 검색 결과 페이지를 새 탭으로 연다 (API 키 없음, 사용자 결정 2026-11-20).
 *
 * 링크를 따로 구해 오기 번거롭다는 피드백에 대한 답이다. 39page 는 검색을 **하지 않는다** — 검색어로 YouTube 검색
 * 결과 주소를 만들어 브라우저가 새 탭에서 열게 할 뿐이다. 검색어는 39page 서버나 다른 곳으로 가지 않고, 저장하지 않는다.
 * 찾은 영상은 YouTube 화면에서 39page 확장 프로그램으로 바로 담거나, 주소를 복사해 링크 칸에 붙여 넣는다.
 *
 * 링크 추가 양식과 **따로 된 `<form>`** 이다 — 검색 칸에서 Enter 를 눌러 링크 추가가 제출되지 않게.
 * 검색어는 부모가 `v-model:query` 로 채울 수 있다 (링크 칸에 곡 이름을 적었을 때).
 */
import { youtubeSearchUrl, YOUTUBE_SEARCH_MAX_LENGTH } from '@/shared/utils/youtube'

const query = defineModel<string>('query', { default: '' })

function openSearch(): void {
  // 사용자의 누름(클릭 · Enter) 안에서 연다 — 팝업 차단에 걸리지 않는다. 새 탭이 이 페이지를 건드리지 못하게.
  window.open(youtubeSearchUrl(query.value), '_blank', 'noopener,noreferrer')
}
</script>

<template>
  <form class="yt-search" role="search" @submit.prevent="openSearch">
    <label class="label" for="yt-search-query">링크가 없으면 — YouTube에서 찾기</label>
    <div class="search-row">
      <input
        id="yt-search-query"
        v-model="query"
        class="field"
        type="search"
        enterkeyhint="search"
        autocomplete="off"
        :maxlength="YOUTUBE_SEARCH_MAX_LENGTH"
        placeholder="곡 이름 · 가수"
      />
      <button type="submit" class="pill search-go" title="새 탭에서 YouTube 검색 결과를 열어요">
        YouTube에서 검색 <span aria-hidden="true">↗</span><span class="sr-only">(새 탭)</span>
      </button>
    </div>
  </form>
</template>

<style scoped>
/* 링크 양식 아래의 작은 묶음 — 같은 글꼴 · 칸 · 단추 모양(PlaylistEditor 의 `.label` · `.field` · `.pill`)을 쓴다. */
.yt-search {
  margin: 0 0 14px;
  padding-top: 12px;
  border-top: 1px dashed var(--drawer-head-border-color);
}

.label {
  display: block;
  margin: 0 0 7px;
  color: var(--label-text-color);
  font: 11px var(--font-mono);
}

.search-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.field {
  display: block;
  min-width: 0;
  height: 46px;
  flex: 1 1 160px;
  padding: 10px;
  border: 1px solid var(--field-border-color);
  border-radius: var(--radius-field);
  background: var(--field-surface-color);
  color: var(--field-text-color);
}

/* 승인된 디자인의 `.pill` 값을 따른다. 터치 목표 44px (M11 U16). */
.pill {
  min-height: 44px;
  flex: none;
  padding: 7px 12px;
  border: 1px solid var(--pill-border-color);
  border-radius: var(--radius-control);
  background: var(--pill-surface-color);
  color: var(--pill-text-color);
  font: 11px var(--font-mono);
}

@media (hover: hover) {
  .pill:hover {
    background: var(--pill-surface-hover-color);
  }
}

.sr-only {
  position: absolute;
  overflow: hidden;
  width: 1px;
  height: 1px;
  clip-path: inset(50%);
  white-space: nowrap;
}
</style>
