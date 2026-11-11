<script setup lang="ts">
/**
 * 팝업 조립 — 상태(`useActiveVideo`)를 받아 화면 하나를 고른다.
 * 탭·메시지는 bridge 가, 문구는 `copy.ts` 가, 모양은 하위 컴포넌트가 맡는다.
 */
import { inject } from 'vue'

import BrandHeader from './components/BrandHeader.vue'
import MomentCapturePanel from './components/MomentCapturePanel.vue'
import QuickAddPanel from './components/QuickAddPanel.vue'
import StatusNotice from './components/StatusNotice.vue'
import VideoCard from './components/VideoCard.vue'
import { BRIDGE_KEY } from './bridge'
import { errorCopy, LOADING_COPY, UNSUPPORTED_COPY } from './copy'
import { useActiveVideo } from './useActiveVideo'
import { useMomentCapture } from './useMomentCapture'
import { useQuickAdd } from './useQuickAdd'
import { useShortcuts } from './useShortcuts'

const bridge = inject(BRIDGE_KEY)
if (bridge === undefined) throw new Error('PopupBridge 가 제공되지 않았다')

const { view, retry, currentTabId } = useActiveVideo(bridge)
const quickAdd = useQuickAdd(bridge, { view, currentTabId, refresh: retry })
const moment = useMomentCapture(bridge, { view, currentTabId, refresh: retry })
const { shortcuts, openSettings } = useShortcuts(bridge)
</script>

<template>
  <BrandHeader />
  <main class="content" aria-live="polite" :aria-busy="view.phase === 'loading'">
    <StatusNotice
      v-if="view.phase === 'loading'"
      tone="info"
      :title="LOADING_COPY.title"
      :body="LOADING_COPY.body"
    />

    <template v-else-if="view.phase === 'video'">
      <VideoCard :video-id="view.videoId" :page-kind="view.pageKind" :title="view.title" />
      <QuickAddPanel
        :state="quickAdd.state.value"
        :shortcut="shortcuts?.['quick-add']"
        @add="quickAdd.add"
      />
      <MomentCapturePanel
        :state="moment.state.value"
        :disabled-reason="moment.disabledReason.value"
        :shortcut="shortcuts?.['capture-moment']"
        @capture="moment.capture"
      />
      <button v-if="shortcuts !== null" type="button" class="settings" @click="openSettings">
        단축키 바꾸기
      </button>
    </template>

    <StatusNotice
      v-else-if="view.phase === 'unsupported'"
      tone="info"
      :title="UNSUPPORTED_COPY[view.reason].title"
      :body="UNSUPPORTED_COPY[view.reason].body"
    />

    <StatusNotice
      v-else
      tone="error"
      :title="errorCopy(view.code).title"
      :body="errorCopy(view.code).body"
    >
      <button type="button" class="retry" @click="retry">다시 시도</button>
    </StatusNotice>
  </main>
</template>

<style scoped>
.content {
  display: grid;
  gap: 10px;
  padding: 14px 16px 16px;
}

/* 보조 링크 모양의 버튼 — 단축키 설정 화면을 연다 (M10-5). */
.settings {
  justify-self: start;
  padding: 2px 0;
  border: 0;
  background: none;
  color: var(--text-dim-color);
  font: inherit;
  font-size: 11px;
  text-decoration: underline;
  cursor: pointer;
}

.settings:hover {
  color: var(--text-muted-color);
}

/* 웹앱의 quiet-btn 과 같은 토큰. */
.retry {
  justify-self: start;
  margin-top: 4px;
  padding: 5px 12px;
  border: 1px solid var(--button-border-color);
  border-radius: var(--radius-control);
  background: var(--button-surface-color);
  color: var(--button-text-color);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}

.retry:hover {
  background: var(--button-surface-hover-color);
}
</style>
