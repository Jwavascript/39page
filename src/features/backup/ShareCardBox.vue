<script setup lang="ts">
/**
 * 공유 카드 이미지 (ADR 0041) — "링크로 공유" 칸 안.
 *
 * 링크와 같은 대상 · 같은 선택(Moments · 메모)으로 그린 카드를 미리 보이고, 복사하거나 PNG 로 저장한다. 게시판 글에 이
 * 이미지를 올리고 위의 링크를 이미지에 건다. 카드 안에는 QR · 링크 안내 문구를 넣지 않는다 (사용자 결정).
 *
 * 판단은 `useShareCard` 가, 표현은 이 컴포넌트가 한다 (규칙 3).
 */
import { computed, toRef } from 'vue'

import type { ShareLinkContent } from './shareLink'
import { useShareCard } from './useShareCard'

const props = defineProps<{ content: ShareLinkContent | null }>()

const card = useShareCard(toRef(props, 'content'))

const TEMPLATE_LABEL = {
  jcard: '카세트 J카드',
  lp: 'LP 뒷면',
  single: '싱글',
  receipt: '영수증',
} as const

/** 보이는 정보는 그려진 카드의 것 — 다시 그리는 동안 새 틀 이름에 지난 크기가 붙지 않게. */
const meta = computed<string>(() => {
  const current = card.rendered.value
  if (current === null) return ''
  const { model, image } = current
  return `${TEMPLATE_LABEL[model.template]} · ${String(image.width)}×${String(image.height)} PNG`
})

const alt = computed<string>(() => {
  const current = card.rendered.value
  return current === null ? '' : `공유 카드 미리보기 — ${current.model.heading}`
})

const placeholder = computed<string>(() => {
  switch (card.state.value) {
    case 'rendering':
      return '카드를 그리는 중…'
    case 'unsupported':
      return '이 브라우저에서는 이미지를 만들 수 없어요.'
    case 'failed':
      return '이미지를 만들지 못했어요. 대상을 다시 골라 보세요.'
    default:
      return ''
  }
})

const ready = computed(() => card.rendered.value !== null && card.state.value === 'ready')
</script>

<template>
  <section class="card-share" aria-labelledby="card-share-title">
    <h5 id="card-share-title" class="sub-title">이미지 카드</h5>
    <p class="lead">게시판 글에 이 이미지를 올리고, 위의 링크를 이미지에 걸어 주세요.</p>

    <div class="card-preview" :data-state="card.state.value">
      <img
        v-if="card.previewUrl.value !== null"
        class="card-preview-image"
        :src="card.previewUrl.value"
        :alt="alt"
      />
      <p v-if="placeholder !== ''" class="placeholder">{{ placeholder }}</p>
    </div>
    <p v-if="meta !== ''" class="meta">{{ meta }}</p>

    <div class="actions">
      <button type="button" class="pill pill--strong" :disabled="!ready" @click="card.copyImage()">
        이미지 복사
      </button>
      <button type="button" class="pill" :disabled="!ready" @click="card.saveImage()">
        이미지 저장
      </button>
    </div>
    <p class="status" :class="{ 'is-failed': card.failed.value }" role="status" aria-live="polite">
      {{ card.notice.value }}
    </p>
  </section>
</template>

<style scoped>
.card-share {
  margin-top: 14px;
  padding-top: 12px;
  border-top: 1px dashed var(--drawer-head-border-color);
}

.sub-title {
  margin: 0 0 6px;
  color: var(--drawer-title-text-color);
  font: 12px var(--font-mono);
  font-weight: 400;
  letter-spacing: 0.08em;
}

.lead,
.meta,
.status {
  margin: 4px 0;
  font: 11px/1.6 var(--font-mono);
}

.lead,
.meta {
  color: var(--drawer-sub-text-color);
}

.status:empty {
  display: none;
}

.status.is-failed {
  color: var(--status-warning-text-color);
}

.card-preview {
  display: grid;
  min-height: 120px;
  margin: 8px 0 4px;
  padding: 8px;
  border: 1px solid var(--field-border-color);
  background: var(--field-surface-color);
  place-items: center;
}

/* 다시 그리는 동안 안내를 지난 카드 위에 겹친다 — 칸 높이가 들썩이지 않게. */
.card-preview > * {
  grid-area: 1 / 1;
}

/* 카드가 길어도(영수증) 대화상자 안에서 한눈에 — 높이를 묶고 비율은 지킨다. */
.card-preview-image {
  display: block;
  max-width: 100%;
  max-height: 340px;
  object-fit: contain;
}

.card-preview[data-state='rendering'] .card-preview-image {
  opacity: 0.35;
}

.placeholder {
  margin: 0;
  padding: 2px 8px;
  background: var(--field-surface-color);
  color: var(--drawer-muted-text-color);
  font-size: 12px;
}

.actions {
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
  opacity: 0.45;
}

.pill--strong {
  border-color: var(--accent-strong-color);
  background: var(--accent-strong-color);
  color: var(--accent-strong-text-color);
}
</style>
