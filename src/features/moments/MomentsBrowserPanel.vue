<script setup lang="ts">
/**
 * 보관함 "Moments" 탭 — 전체 Moments 관리 (M11-2, ADR 0027).
 *
 * M9 의 Moments 위젯이 가진 **목록 · 거르기 · 재생 · 메모 수정 · 삭제**를 보관함에 그대로 잇는다
 * (`useMomentsBrowser` · `MomentList` 재사용). 검색 · 대량 목록(점진 표시) · 목록 연결은 M11-4 다.
 *
 * 저장(이 순간 저장)은 여기 없다 — 지금 재생 중인 곡을 보며 누르는 일이라 대시보드에 남는다.
 * 데이터 모델은 그대로다: Moment 는 플레이리스트와 독립이고 `videoId` 로만 곡과 이어진다 (ADR 0019).
 */
import { computed } from 'vue'

import { MAX_MOMENT_NOTE_LENGTH } from '@/stores/moments'

import MomentList from './MomentList.vue'
import MomentsStatusBanner from './MomentsStatusBanner.vue'
import { useMomentsBrowser, type MomentsFilter } from './useMomentsBrowser'

const props = defineProps<{
  /** 처음 보일 거르기. 대시보드의 "모두 보기" 는 전체, "이 곡" 은 지금 곡. */
  initialFilter?: MomentsFilter
}>()

const browser = useMomentsBrowser()
if (props.initialFilter !== undefined) browser.filter.value = props.initialFilter

const emptyMessage = computed<string>(() => {
  if (browser.total.value === 0) return ''
  return browser.currentVideoId.value === null
    ? '지금 재생 중인 곡이 없어요.'
    : '이 곡에 저장한 순간이 없어요.'
})

defineExpose({ browser })
</script>

<template>
  <section class="moments-browser" aria-labelledby="archive-moments-title">
    <h3 id="archive-moments-title" class="section-title">
      MOMENTS <span class="count">{{ browser.total.value }}개</span>
    </h3>

    <MomentsStatusBanner />

    <div v-if="browser.total.value > 0" class="filter" role="group" aria-label="보여줄 순간">
      <button
        type="button"
        class="pill chip"
        :class="{ 'pill--strong': browser.filter.value === 'all' }"
        :aria-pressed="browser.filter.value === 'all'"
        @click="browser.filter.value = 'all'"
      >
        전체 {{ browser.total.value }}
      </button>
      <button
        type="button"
        class="pill chip"
        :class="{ 'pill--strong': browser.filter.value === 'current' }"
        :aria-pressed="browser.filter.value === 'current'"
        :disabled="browser.currentVideoId.value === null"
        @click="browser.filter.value = 'current'"
      >
        이 곡 {{ browser.currentCount.value }}
      </button>
    </div>

    <p
      class="feedback"
      :class="{ 'is-warning': browser.feedback.value?.tone === 'warning' }"
      role="status"
      aria-live="polite"
    >
      {{ browser.feedback.value?.text ?? '' }}
    </p>

    <p v-if="browser.total.value === 0" class="empty">
      아직 저장한 순간이 없어요.<br />곡을 듣다가 대시보드의 ＋ 이 순간 저장을 눌러보세요.
    </p>
    <p v-else-if="browser.groups.value.length === 0" class="empty">{{ emptyMessage }}</p>
    <MomentList
      v-else
      id-prefix="archive-moment"
      :groups="browser.groups.value"
      :current-video-id="browser.currentVideoId.value"
      :max-note-length="MAX_MOMENT_NOTE_LENGTH"
      :save-note="browser.saveNote"
      @play="(id) => void browser.play(id)"
      @remove="(id) => void browser.remove(id)"
    />
  </section>
</template>

<style scoped>
.moments-browser {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 10px;
}

.section-title {
  margin: 0;
  color: var(--drawer-section-title-text-color);
  font: 11px var(--font-mono);
  font-weight: 400;
  letter-spacing: 0.12em;
}

.count {
  margin-left: 6px;
  color: var(--drawer-sub-text-color);
}

.filter {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.pill {
  min-height: 44px;
  padding: 7px 14px;
  border: 1px solid var(--pill-border-color);
  border-radius: var(--radius-control);
  background: var(--pill-surface-color);
  color: var(--pill-text-color);
  font: 12px var(--font-mono);
}

.pill:disabled {
  cursor: not-allowed;
  opacity: 0.4;
}

.pill--strong {
  border-color: var(--accent-strong-color);
  background: var(--accent-strong-color);
  color: var(--accent-strong-text-color);
}

.feedback {
  min-height: 0;
  margin: 0;
  color: var(--drawer-sub-text-color);
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
  line-height: 1.7;
}
</style>
