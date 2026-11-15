<script setup lang="ts">
/**
 * 앨범아트 저장 공간 (M12-3/4, ARTWORK_DESIGN §3-5) — 데이터 · 백업 대화상자 안.
 *
 * 사용량 · 브라우저 여유 · 연결은 있는데 그림이 없는 곡 · 쓰지 않는 그림 정리 · "오래 보관 요청"(사용자가 누를 때만
 * `navigator.storage.persist()`).
 */
import { onMounted, ref } from 'vue'

import { formatBytes } from '@/shared/utils/bytes'
import { useArtworkStore, type StorageEstimate } from '@/stores/artwork'

const store = useArtworkStore()
const estimate = ref<StorageEstimate | null>(null)
const note = ref('')
const busy = ref(false)

onMounted(async () => {
  estimate.value = await store.estimate()
})

async function cleanUp(): Promise<void> {
  busy.value = true
  try {
    const result = await store.cleanUp()
    note.value = result.ok
      ? result.removedAssignments + result.removedAssets === 0
        ? '정리할 것이 없습니다.'
        : `목록에 없는 곡의 연결 ${String(result.removedAssignments)}개 · 쓰지 않는 그림 ${String(result.removedAssets)}개를 지웠습니다.`
      : result.reason === 'library-unreadable'
        ? '라이브러리를 온전히 읽을 수 없어 정리하지 않았습니다 (지우면 안 되는 것을 지울 수 있어서).'
        : '정리하지 못했습니다.'
    estimate.value = await store.estimate()
  } finally {
    busy.value = false
  }
}

async function persist(): Promise<void> {
  const granted = await store.requestPersist()
  note.value =
    granted === true
      ? '이 브라우저가 39page 데이터를 오래 보관하기로 했습니다.'
      : granted === false
        ? '브라우저가 요청을 받아들이지 않았습니다. 전체 백업(ZIP)으로 보관해 주세요.'
        : '이 브라우저는 보관 요청을 지원하지 않습니다.'
  estimate.value = await store.estimate()
}
</script>

<template>
  <section class="artwork-storage" aria-labelledby="artwork-storage-title">
    <h3 id="artwork-storage-title" class="storage-title">ARTWORK · 앨범아트 저장 공간</h3>
    <p v-if="store.status === 'unavailable'" class="storage-warning">
      이 브라우저에서 앨범아트 저장소를 열 수 없습니다 — 썸네일 · 기본 그림만 보입니다.
    </p>
    <template v-else>
      <p class="storage-line">
        이미지 {{ store.usage.assets }}개 · {{ formatBytes(store.usage.bytes) }}
        <template v-if="estimate?.quota != null">
          · 브라우저 전체 사용 {{ formatBytes(estimate.usage ?? 0) }} / 약
          {{ formatBytes(estimate.quota) }}
        </template>
      </p>
      <p v-if="store.missing.length > 0" class="storage-warning">
        그림을 찾지 못한 곡 {{ store.missing.length }}개 — 기본 그림으로 보입니다. 곡의 앨범아트
        설정에서 다시 고르세요.
      </p>
      <div class="storage-actions">
        <button type="button" class="pill" :disabled="busy" @click="cleanUp">
          쓰지 않는 그림 정리
        </button>
        <button v-if="estimate?.persisted === false" type="button" class="pill" @click="persist">
          이 브라우저에 오래 보관 요청
        </button>
      </div>
    </template>
    <p v-if="note !== ''" class="storage-line" role="status">{{ note }}</p>
  </section>
</template>

<style scoped>
.artwork-storage {
  margin-top: 18px;
}

.storage-title {
  margin: 0 0 8px;
  color: var(--drawer-section-title-text-color);
  font: 10px var(--font-mono);
  letter-spacing: 0.12em;
}

.storage-line,
.storage-warning {
  margin: 4px 0;
  font: 11px/1.6 var(--font-mono);
}

.storage-warning {
  color: var(--status-warning-text-color);
}

.storage-actions {
  display: flex;
  flex-wrap: wrap;
  margin: 8px 0;
  gap: 8px;
}

.pill {
  min-height: 44px;
  padding: 7px 12px;
  border: 1px solid var(--pill-border-color);
  border-radius: var(--radius-control);
  background: var(--pill-surface-color);
  color: var(--pill-text-color);
  font: 11px var(--font-mono);
}

.pill:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}
</style>
