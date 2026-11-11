<script setup lang="ts">
/**
 * 수집 화면 — 요청 종류를 가른다 (M10-4).
 *
 * - `kind=moment` 이고 계약을 통과했으면 Moment 저장 화면 (`CollectMomentView`)
 * - 그 밖(곡 담기 · 거절)은 곡 담기 화면 (`CollectTrackView`) — 거절 안내도 그쪽이 그린다
 *
 * 조각은 한 번만 읽는다. 열린 뒤 주소 조각이 바뀌어도(같은 탭에 다른 요청) 지금 화면과
 * 쓰던 메모를 바꾸지 않는다 — 새 요청은 새 탭에서 연다 (`main.ts` 가 처음 조각만 넘긴다).
 */
import { computed } from 'vue'

import CollectMomentView from './CollectMomentView.vue'
import CollectTrackView from './CollectTrackView.vue'
import { parseCollectRequest } from './collectRequest'
import type { CollectOptions } from './useCollect'

const props = defineProps<{
  hash: string
  options?: CollectOptions
}>()

const momentRequest = computed(() => {
  const parsed = parseCollectRequest(props.hash)
  return parsed.ok && parsed.request.kind === 'moment' ? parsed.request : null
})
</script>

<template>
  <CollectMomentView v-if="momentRequest !== null" :request="momentRequest" :options="options" />
  <CollectTrackView v-else :hash="hash" :options="options" />
</template>
