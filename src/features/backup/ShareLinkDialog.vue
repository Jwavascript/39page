<script setup lang="ts">
/**
 * 링크로 받은 공유 — 대화상자 (ADR 0040).
 *
 * 누군가 `https://39page.com/#share?v=1&d=…` 를 열면 셸이 조각을 읽어 이 대화상자를 띄운다. 처음 온 사람이어도
 * 대시보드 위에 무엇이 공유됐는지 먼저 보인다. 읽지 못한 링크는 이유와 할 일을 말한다.
 *
 * 모달이다 — 셸이 뒤쪽을 `inert` 로 막고 Escape 를 받는다. 이 안에서 Tab 이 돈다. 닫을 때 할 일(재생 등)은
 * `close` 에 실어 셸에 넘긴다 — 셸이 대화상자를 내린 **뒤에** 한다.
 */
import { nextTick, onMounted, ref } from 'vue'

import { useFocusTrap } from '@/components/ui/useFocusTrap'

import { SHARE_LINK_PROBLEM_MESSAGE, type ShareLinkParse } from './shareLink'
import ShareLinkPreview from './ShareLinkPreview.vue'

defineProps<{ link: ShareLinkParse }>()
const emit = defineEmits<{ close: [after?: () => void] }>()

const dialog = ref<HTMLElement | null>(null)
const onKeydown = useFocusTrap(dialog)
const TITLE_ID = 'share-link-title'

onMounted(async () => {
  await nextTick()
  // 제목이 읽히도록 대화상자 자체에 먼저 둔다. Tab 한 번이면 첫 단추다.
  dialog.value?.focus()
})
</script>

<template>
  <div class="share-link-backdrop" @click.self="emit('close')">
    <div
      ref="dialog"
      class="share-link-dialog"
      role="dialog"
      aria-modal="true"
      :aria-labelledby="TITLE_ID"
      tabindex="-1"
      @keydown="onKeydown"
    >
      <div class="dialog-head">
        <p class="dialog-kicker">39PAGE · 공유 링크</p>
        <button type="button" class="close" aria-label="공유 미리보기 닫기" @click="emit('close')">
          ×
        </button>
      </div>

      <ShareLinkPreview
        v-if="link.ok"
        :content="link.content"
        :title-id="TITLE_ID"
        @close="(after) => emit('close', after)"
      />
      <template v-else>
        <h2 :id="TITLE_ID" class="error-title">공유 링크를 열 수 없어요</h2>
        <p class="error-text" role="alert">{{ SHARE_LINK_PROBLEM_MESSAGE[link.problem] }}</p>
        <div class="actions">
          <button type="button" class="pill" @click="emit('close')">닫기</button>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
/* 데이터 대화상자(`DataDialog`)와 같은 모양 — 같은 토큰. */
.share-link-backdrop {
  position: fixed;
  inset: 0;
  z-index: 11;
  display: grid;
  padding: 16px;
  overflow-y: auto;
  background: rgb(0 0 0 / 55%);
  place-items: center;
}

.share-link-dialog {
  width: min(520px, 100%);
  max-height: calc(100dvh - 32px);
  padding: 16px 20px 18px;
  overflow-y: auto;
  overscroll-behavior: contain;
  border: 1px solid var(--drawer-border-color);
  border-radius: var(--radius-modal);
  background: var(--drawer-surface-color);
  color: var(--row-text-color);
}

.share-link-dialog:focus-visible {
  outline: var(--focus-ring-width) solid var(--focus-ring-color);
  outline-offset: 2px;
}

.dialog-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.dialog-kicker {
  margin: 0;
  color: var(--drawer-title-text-color);
  font: 12px var(--font-mono);
  letter-spacing: 0.1em;
}

.close {
  width: 44px;
  height: 44px;
  flex: none;
  border: 0;
  background: transparent;
  color: var(--close-button-text-color);
  font-size: 24px;
  line-height: 1;
}

.error-title {
  margin: 6px 0 0;
  color: var(--drawer-title-text-color);
  font-size: 18px;
  font-weight: 500;
}

.error-text {
  margin: 10px 0 0;
  font-size: 13px;
  line-height: 1.6;
}

.actions {
  display: flex;
  justify-content: flex-end;
  margin-top: 14px;
}

.pill {
  min-height: 44px;
  padding: 7px 16px;
  border: 1px solid var(--pill-border-color);
  border-radius: var(--radius-control);
  background: var(--pill-surface-color);
  color: var(--pill-text-color);
  font: 12px var(--font-mono);
}
</style>
