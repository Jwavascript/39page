<script setup lang="ts">
/**
 * 링크로 공유 (ADR 0040) — 공유 묶음(`SharePanel`) 안.
 *
 * 첨부 파일을 올릴 수 없는 곳(커뮤니티 게시판 · 메신저)에 붙여 넣는 링크. 받는 사람이 열면 39page 가 미리보기를 보이고,
 * 누를 때만 그 사람의 보관함에 넣는다. 링크에는 내용이 그대로 들어간다 — 무엇이 들어가는지를 여기서 말한다.
 *
 * 판단은 `useShareLink` 가, 표현은 이 컴포넌트가 한다 (규칙 3).
 */
import { computed, nextTick, ref, toRef } from 'vue'

import { useShareLink, type ShareLinkTarget } from './useShareLink'

const props = defineProps<{ target: ShareLinkTarget | null }>()

const link = useShareLink(toRef(props, 'target'))
const field = ref<HTMLInputElement | null>(null)

const kind = computed(() => props.target?.kind ?? null)

/** 링크에 들어가는 것 — 고른 선택 그대로. */
const contains = computed<string>(() => {
  const parts = ['영상 주소']
  if (link.titles.value) parts.push('곡 이름')
  if (kind.value === 'playlist') parts.push('목록 이름')
  if (link.momentCount.value > 0) parts.push('Moment 시점')
  if (link.momentCount.value > 0 && link.notes.value) parts.push('메모')
  return parts.join(' · ')
})

const showNotes = computed(
  () => kind.value === 'moment' || (link.includeMoments.value && link.availableMoments.value > 0),
)

function selectField(): void {
  field.value?.select()
}

async function copy(): Promise<void> {
  await link.copy()
  if (link.copyState.value === 'manual') {
    // 복사가 막혔다 — 링크를 골라 두면 Ctrl+C(⌘C) 한 번이다.
    await nextTick()
    field.value?.focus()
    selectField()
  }
}
</script>

<template>
  <section class="link-share" aria-labelledby="link-share-title">
    <h4 id="link-share-title" class="sub-title">링크로 공유</h4>
    <p class="lead">
      게시판 · 메신저에 붙여 넣는 링크예요. 받는 사람이 열면 39page 에서 미리 보고 자기 보관함에
      추가할 수 있어요. 파일을 올릴 수 없는 곳에서 쓰세요.
    </p>

    <div v-if="target !== null" class="options">
      <label class="check">
        <input v-model="link.titles.value" type="checkbox" />
        곡 이름 넣기
      </label>
      <label v-if="kind !== 'moment'" class="check">
        <input
          v-model="link.includeMoments.value"
          type="checkbox"
          :disabled="link.availableMoments.value === 0"
        />
        이 곡들의 Moments {{ link.availableMoments.value }}개 넣기
      </label>
      <label v-if="showNotes" class="check">
        <input v-model="link.notes.value" type="checkbox" />
        Moment 메모 넣기
      </label>
    </div>

    <div class="link-row">
      <input
        ref="field"
        class="link-field"
        type="text"
        readonly
        :value="link.url.value ?? ''"
        :placeholder="target === null ? '공유할 목록이나 곡을 고르세요' : ''"
        aria-label="공유 링크"
        @focus="selectField"
      />
      <button
        type="button"
        class="pill pill--strong copy"
        :disabled="link.url.value === null"
        @click="copy"
      >
        링크 복사
      </button>
    </div>

    <p v-if="target !== null" class="meta">
      {{ link.length.value.toLocaleString('ko-KR') }}자 · 곡 {{ link.trackCount.value }}개
      <template v-if="link.momentCount.value > 0">
        · Moment {{ link.momentCount.value }}개
      </template>
    </p>
    <p v-if="link.level.value === 'long'" class="warn">
      링크가 길어서 일부 게시판에서 잘릴 수 있어요.
      <template v-if="link.lengthWithoutTitles.value !== null">
        곡 이름을 빼면 {{ link.lengthWithoutTitles.value.toLocaleString('ko-KR') }}자예요 (받는
        사람이 열 때 YouTube 에서 제목을 찾아요).
      </template>
    </p>
    <p v-else-if="link.level.value === 'too-long'" class="warn">
      링크로 담기엔 너무 많아요.
      <template v-if="link.lengthWithoutTitles.value !== null">곡 이름을 빼 보거나, </template>
      아래 “파일로 공유” 를 써 주세요.
    </p>

    <p class="copy-status" role="status" aria-live="polite">
      <template v-if="link.copyState.value === 'copied'">링크를 복사했어요.</template>
      <template v-else-if="link.copyState.value === 'manual'">
        복사하지 못했어요 — 링크를 골라 두었으니 Ctrl+C(⌘C)로 복사하세요.
      </template>
    </p>

    <p v-if="target !== null" class="note">
      링크에 그대로 들어가는 것: {{ contains }}. 링크를 가진 누구나 볼 수 있어요. 앨범아트는
      들어가지 않아요 (받는 사람에게는 썸네일로 보여요).
    </p>
  </section>
</template>

<style scoped>
.link-share {
  margin: 10px 0 14px;
  padding: 12px;
  border: 1px solid var(--row-selected-border-color);
  background: var(--row-surface-color);
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
.warn,
.note,
.copy-status {
  margin: 4px 0;
  font: 11px/1.6 var(--font-mono);
}

.lead,
.note {
  color: var(--drawer-sub-text-color);
}

.warn {
  color: var(--status-warning-text-color);
}

.copy-status:empty {
  display: none;
}

.options {
  display: flex;
  flex-wrap: wrap;
  column-gap: 14px;
}

.check {
  display: flex;
  min-height: 44px;
  align-items: center;
  font-size: 13px;
  gap: 8px;
}

.link-row {
  display: flex;
  flex-wrap: wrap;
  margin: 4px 0;
  gap: 6px;
}

.link-field {
  min-width: 0;
  height: 44px;
  flex: 1 1 200px;
  padding: 8px 10px;
  border: 1px solid var(--field-border-color);
  border-radius: var(--radius-field);
  background: var(--field-surface-color);
  color: var(--field-text-color);
  font: 12px var(--font-mono);
  text-overflow: ellipsis;
}

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
