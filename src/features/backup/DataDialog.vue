<script setup lang="ts">
/**
 * 데이터 대화상자 — JSON 백업 · 복원의 전역 입구 (M11-2, ADR 0027 결정 7).
 *
 * M8 부터 M10 까지 백업은 **어느 한 플레이리스트의 편집 드로어 맨 아래**에만 있었다 (M11 U1). 백업은
 * 한 목록의 기능이 아니라 앱 전체 데이터 관리이므로 헤더의 "⇩ 데이터" 에서 연다 — 메인 화면에서
 * 2번(데이터 → 내보내기) 만에 닿는다.
 *
 * - `BackupPanel` 을 **그대로** 쓴다. 내보내기 · 가져오기 · 미리보기 · 승인 · 보호 정책은 바뀌지 않는다
 *   (ADR 0018 · 0025).
 * - 닫혀 있어도 마운트를 유지하고 `hidden` 으로만 숨긴다 — 가져오기 미리보기를 보다가 닫았다 열어도
 *   승인 전 상태가 남는다(승인 전에는 아무것도 쓰지 않는다).
 * - 모달이다: 열린 동안 셸이 뒤쪽을 `inert` 로 막고, 이 안에서 Tab 이 돈다. Escape 는 셸이 받는다.
 *   jsdom 에 `<dialog>` 의 `showModal` 이 없어 시험할 수 없으므로 직접 구현한다.
 */
import { computed, nextTick, ref, watch } from 'vue'

import ArtworkStoragePanel from '@/features/artwork/ArtworkStoragePanel.vue'
import BackupPanel from '@/features/backup/BackupPanel.vue'
import SharePanel from '@/features/backup/SharePanel.vue'
import { useLibraryStore, type LibraryStatus } from '@/stores/library'
import { useMomentsStore, type MomentsStatus } from '@/stores/moments'
import type { ShareRequest } from '@/shared/types/share'

const props = defineProps<{ open: boolean; dialogId: string; shareRequest?: ShareRequest | null }>()
const sharePanel = ref<InstanceType<typeof SharePanel> | null>(null)
const emit = defineEmits<{ close: [] }>()

const library = useLibraryStore()
const moments = useMomentsStore()

const dialog = ref<HTMLElement | null>(null)

const STATUS_TEXT: Readonly<Record<LibraryStatus | MomentsStatus, string>> = {
  ready: '정상 — 이 브라우저에 저장되고 있어요',
  protected:
    '보호 중 — 읽지 못한 원본을 덮어쓰지 않고 지키고 있어요. 백업 가져오기로 되살릴 수 있어요',
  unavailable: '이 브라우저에서 저장할 수 없어요 — 지금 바뀐 내용은 새로고침하면 사라져요',
}

const statusRows = computed(() => [
  { label: '라이브러리', status: library.status, text: STATUS_TEXT[library.status] },
  { label: 'Moments', status: moments.status, text: STATUS_TEXT[moments.status] },
])

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

function focusables(): HTMLElement[] {
  if (dialog.value === null) return []
  return [...dialog.value.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (element) => !element.closest('[hidden]'),
  )
}

/** Tab 이 대화상자 밖으로 나가지 않게 처음 ↔ 끝을 잇는다. */
function onKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Tab') return
  const items = focusables()
  const first = items[0]
  const last = items[items.length - 1]
  if (first === undefined || last === undefined) {
    event.preventDefault()
    return
  }
  const active = document.activeElement
  if (event.shiftKey && (active === first || active === dialog.value)) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && active === last) {
    event.preventDefault()
    first.focus()
  }
}

watch(
  () => props.open,
  async (isOpen) => {
    if (!isOpen) return
    await nextTick()
    // 제목이 읽히도록 대화상자 자체에 먼저 둔다. Tab 한 번이면 첫 단추다.
    if (props.shareRequest != null) sharePanel.value?.focusExport()
    else dialog.value?.focus()
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
      aria-describedby="data-dialog-scope"
      tabindex="-1"
      @keydown="onKeydown"
    >
      <div class="dialog-head">
        <h2 id="data-dialog-title" class="dialog-title">데이터 · 백업</h2>
        <button type="button" class="close" aria-label="데이터 닫기" @click="emit('close')">
          ×
        </button>
      </div>

      <p id="data-dialog-scope" class="scope">
        <strong>전체 백업(ZIP)</strong>에는 이 브라우저의 39page 데이터가
        <strong>모두</strong> 들어가요 — 플레이리스트와 곡, Moments, 테마, 앨범아트. JSON 백업에는
        앨범아트가 빠져요.
      </p>

      <dl class="status-list">
        <template v-for="row in statusRows" :key="row.label">
          <dt>{{ row.label }}</dt>
          <dd :class="{ 'is-warning': row.status !== 'ready' }">{{ row.text }}</dd>
        </template>
      </dl>

      <BackupPanel />

      <ArtworkStoragePanel />

      <SharePanel ref="sharePanel" :request="shareRequest" />

      <ul class="help">
        <li>
          데이터는 서버가 아니라 이 브라우저에만 있어요. 사이트 데이터를 지우면 함께 사라져요.
        </li>
        <li>
          다른 브라우저 · 기기로 옮길 때: 여기서 내보내고, 그쪽 39page 의 데이터에서 가져오세요.
        </li>
        <li>
          가져오기는 미리보기로 바뀌는 내용을 먼저 보여 주고, 승인하기 전에는 아무것도 바꾸지
          않아요.
        </li>
      </ul>

      <div class="dialog-foot">
        <button type="button" class="pill" @click="emit('close')">닫기</button>
      </div>
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

.scope {
  margin: 10px 0 12px;
  font-size: 13px;
  line-height: 1.6;
}

.scope strong {
  color: var(--drawer-title-text-color);
}

.status-list {
  display: grid;
  margin: 0 0 4px;
  padding: 10px 12px;
  border: 1px solid var(--row-selected-border-color);
  background: var(--row-surface-color);
  font: 11px/1.6 var(--font-mono);
  gap: 4px 12px;
  grid-template-columns: max-content minmax(0, 1fr);
}

.status-list dt {
  color: var(--drawer-sub-text-color);
}

.status-list dd {
  margin: 0;
}

.status-list dd.is-warning {
  color: var(--status-warning-text-color);
}

.help {
  margin: 14px 0 0;
  padding-left: 18px;
  color: var(--drawer-muted-text-color);
  font-size: 12px;
  line-height: 1.7;
}

.dialog-foot {
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
