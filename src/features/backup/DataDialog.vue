<script setup lang="ts">
/**
 * 데이터 대화상자 — 다른 브라우저 · 기기로 옮길 때 쓰는 백업의 입구 (M11-2, ADR 0027 결정 7 → ADR 0043).
 *
 * ADR 0043 — 여기는 **옮기기 전용**이다. 단추는 "전체 백업 내보내기" · "백업 가져오기" 둘뿐이고 설명 글을 두지 않는다.
 * 공유는 따로 된 공유 대화상자(`ShareDialog`)가 맡는다. 가져오기 미리보기 · 승인 · 결과와 저장 이상 경고는 그때만 보인다.
 *
 * - 닫혀 있어도 마운트를 유지하고 `hidden` 으로만 숨긴다 — 가져오기 미리보기를 보다가 닫았다 열어도
 *   승인 전 상태가 남는다(승인 전에는 아무것도 쓰지 않는다).
 * - 모달이다: 열린 동안 셸이 뒤쪽을 `inert` 로 막고, 이 안에서 Tab 이 돈다. Escape 는 셸이 받는다.
 */
import { nextTick, ref, watch } from 'vue'

import { useFocusTrap } from '@/components/ui/useFocusTrap'
import BackupPanel from '@/features/backup/BackupPanel.vue'

const props = defineProps<{ open: boolean; dialogId: string }>()
const emit = defineEmits<{ close: [] }>()

const dialog = ref<HTMLElement | null>(null)
const onKeydown = useFocusTrap(dialog)

watch(
  () => props.open,
  async (isOpen) => {
    if (!isOpen) return
    await nextTick()
    // 제목이 읽히도록 대화상자 자체에 먼저 둔다. Tab 한 번이면 첫 단추다.
    dialog.value?.focus()
  },
)
</script>

<template>
  <div class="data-backdrop" :hidden="!open" @click.self="emit('close')">
    <div
      :id="dialogId"
      ref="dialog"
      class="data-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="data-dialog-title"
      tabindex="-1"
      @keydown="onKeydown"
    >
      <div class="dialog-head">
        <h2 id="data-dialog-title" class="dialog-title">데이터 · 백업</h2>
        <button type="button" class="close" aria-label="데이터 닫기" @click="emit('close')">
          ×
        </button>
      </div>

      <BackupPanel />
    </div>
  </div>
</template>

<style scoped>
.data-backdrop {
  position: fixed;
  inset: 0;
  z-index: 10;
  display: grid;
  padding: 16px;
  overflow-y: auto;
  background: rgb(0 0 0 / 55%);
  place-items: center;
}

.data-backdrop[hidden] {
  display: none;
}

.data-dialog {
  width: min(560px, 100%);
  max-height: calc(100dvh - 32px);
  padding: 18px 20px;
  overflow-y: auto;
  overscroll-behavior: contain;
  border: 1px solid var(--drawer-border-color);
  border-radius: var(--radius-modal);
  background: var(--drawer-surface-color);
  color: var(--row-text-color);
}

.data-dialog:focus-visible {
  outline: var(--focus-ring-width) solid var(--focus-ring-color);
  outline-offset: 2px;
}

.dialog-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.dialog-title {
  margin: 0;
  color: var(--drawer-title-text-color);
  font: 14px var(--font-mono);
  font-weight: 400;
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
</style>
