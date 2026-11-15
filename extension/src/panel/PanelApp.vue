<script setup lang="ts">
/**
 * YouTube 위 플로팅 패널 (M11-5B, ADR 0028).
 *
 * 구성: 브랜드 · 닫기 / 지금 영상 / [음악 담기 · Moment 저장] 탭 / 입력 · 저장 / 결과 / 수집 화면(대체 경로).
 * 저장은 39page 의 기존 store 가 하고, 39page 가 저장소에서 확인한 뒤에만 성공을 보인다. 새 탭은 사용자가
 * "39page 수집 화면으로 열기" 를 고를 때만 연다. 패널을 닫아도 YouTube 재생은 그대로다.
 *
 * 키보드: Esc 로 닫는다. 탭은 ←/→ 로 옮긴다. 결과는 `status`(성공) · `alert`(실패 · 불확실) 로 읽힌다.
 */
import { computed, inject, nextTick, onMounted, ref, watch } from 'vue'

import BrandHeader from '@/popup/components/BrandHeader.vue'
import VideoCard from '@/popup/components/VideoCard.vue'
import type { PanelMode } from '@/shared/panelMessages'

import MomentTab from './components/MomentTab.vue'
import MusicTab from './components/MusicTab.vue'
import { ACCESS_COPY } from './panelCopy'
import { PANEL_BRIDGE } from './panelBridge'
import { usePanel } from './usePanel'
import { useSaves } from './useSaves'

const bridge = inject(PANEL_BRIDGE)
if (bridge === undefined) throw new Error('PanelBridge 가 제공되지 않았다')

const panel = usePanel(bridge)
const saves = useSaves(bridge, panel)
const notice = ref('')

const TABS: readonly { key: PanelMode; label: string }[] = [
  { key: 'music', label: '음악 담기' },
  { key: 'moment', label: 'Moment 저장' },
]
const tabRefs = ref<Record<PanelMode, HTMLButtonElement | null>>({ music: null, moment: null })

function onTabKey(event: KeyboardEvent): void {
  if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
  event.preventDefault()
  const next: PanelMode = panel.mode.value === 'music' ? 'moment' : 'music'
  panel.mode.value = next
  void nextTick(() => tabRefs.value[next]?.focus())
}

const granted = computed<boolean>(() => saves.access.value?.permission === 'granted')
const locked = computed<boolean>(
  () => panel.connection.value === 'lost' || panel.video.value === null,
)

async function collect(): Promise<void> {
  notice.value = await panel.collect(panel.mode.value === 'moment' ? 'moment' : 'track')
}

async function goMoment(): Promise<void> {
  panel.mode.value = 'moment'
  if (panel.capture.value?.status !== 'captured') await panel.recapture()
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    event.preventDefault()
    void panel.close()
  }
}

onMounted(async () => {
  await saves.refreshAccess()
  await saves.loadLists()
  document.getElementById('panel-title')?.focus()
})

// 접근 권한이 생기면(다른 패널 · 확장 관리 화면에서) 목록을 읽는다.
watch(granted, (now) => {
  if (now) void saves.loadLists()
})
</script>

<template>
  <div class="panel" @keydown="onKeydown">
    <div class="panel-head">
      <BrandHeader />
      <button type="button" class="close" aria-label="패널 닫기" @click="panel.close()">×</button>
    </div>
    <main class="content">
      <h2 id="panel-title" class="visually-hidden" tabindex="-1">39page 에 담기</h2>

      <p v-if="panel.connection.value === 'lost'" class="feedback warn" role="alert">
        이 패널의 연결이 끊겼어요. 39page 아이콘이나 단축키를 다시 눌러 주세요.
      </p>

      <template v-if="panel.video.value">
        <VideoCard
          :video-id="panel.video.value.videoId"
          :page-kind="panel.video.value.pageKind"
          :title="panel.video.value.title"
        />
        <div v-if="panel.pageChanged.value" class="banner" role="status">
          <p>페이지의 영상이 바뀌었어요. 저장은 위 카드의 영상으로 해요.</p>
          <button type="button" class="btn" @click="panel.switchToCurrent()">
            새 영상으로 바꾸기
          </button>
        </div>
      </template>
      <p v-else-if="panel.page.value?.status === 'unsupported'" class="muted" role="status">
        YouTube 영상 페이지에서 써 주세요.
      </p>
      <p v-else class="muted" role="status">영상을 확인하는 중…</p>

      <section v-if="saves.access.value && !granted" class="access" aria-labelledby="access-title">
        <p class="access-label"><span aria-hidden="true">◇</span> 접근 권한 필요</p>
        <h3 id="access-title">{{ ACCESS_COPY.title }}</h3>
        <p>{{ ACCESS_COPY.body }}</p>
        <div class="actions">
          <button
            type="button"
            class="btn primary"
            :disabled="saves.granting.value"
            :aria-busy="saves.granting.value"
            @click="saves.grant()"
          >
            {{ saves.granting.value ? '권한 요청 중…' : ACCESS_COPY.grant }}
          </button>
        </div>
        <p class="muted">{{ ACCESS_COPY.denied }}</p>
      </section>

      <div class="tabs" role="tablist" aria-label="무엇을 담을까요">
        <button
          v-for="tab in TABS"
          :id="`panel-tab-${tab.key}`"
          :key="tab.key"
          :ref="(el) => (tabRefs[tab.key] = el as HTMLButtonElement | null)"
          type="button"
          role="tab"
          class="tab"
          :aria-selected="panel.mode.value === tab.key"
          :aria-controls="`panel-body-${tab.key}`"
          :tabindex="panel.mode.value === tab.key ? 0 : -1"
          @click="panel.mode.value = tab.key"
          @keydown="onTabKey"
        >
          {{ tab.label }}
        </button>
      </div>

      <div
        id="panel-body-music"
        role="tabpanel"
        aria-labelledby="panel-tab-music"
        :hidden="panel.mode.value !== 'music'"
      >
        <MusicTab
          :saves="saves"
          :disabled="locked || !granted"
          @collect="collect"
          @moment="goMoment"
        />
      </div>
      <div
        id="panel-body-moment"
        role="tabpanel"
        aria-labelledby="panel-tab-moment"
        :hidden="panel.mode.value !== 'moment'"
      >
        <MomentTab
          :panel="panel"
          :saves="saves"
          :disabled="locked || !granted"
          @collect="collect"
          @music="panel.mode.value = 'music'"
        />
      </div>

      <footer class="foot">
        <button type="button" class="link" :disabled="panel.video.value === null" @click="collect">
          39page 수집 화면으로 열기
        </button>
        <p v-if="notice !== ''" class="muted" role="status">{{ notice }}</p>
      </footer>
    </main>
  </div>
</template>
