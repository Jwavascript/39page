<script setup lang="ts">
/**
 * 곡 하나의 앨범아트 설정 (M12-3, `docs/product/M12_CUSTOM_ARTWORK.md` §3).
 *
 * 입구: 보관함 → 음악 → 곡 "관리" → 🖼 앨범아트, 그리고 Now Playing 카드의 그림. 보관함의 상세 칸 자리에 선다 —
 * 모달이 아니라 영상을 덮지 않는다.
 *
 * 고르기만으로는 바뀌지 않는다. **저장**이 저장소 트랜잭션을 마친 뒤에야 "저장했습니다" 를 보이고 카드가 바뀐다.
 * 실패하면 이전 그림이 그대로이고 이유를 여기 적는다. 다른 곡의 재생 · 큐 · 위치에 닿지 않는다.
 *
 * 다른 탭이 그 사이 이 곡의 그림을 바꿨으면(수정 번호가 다르면) 저장을 거절하고 지금 것을 보인다.
 */
import {
  computed,
  inject,
  onBeforeUnmount,
  onMounted,
  ref,
  shallowRef,
  useTemplateRef,
  watch,
} from 'vue'

import { formatBytes } from '@/shared/utils/bytes'
import { DEFAULT_ARTWORK_DISPLAY, type ArtworkDisplay, type TrackKey } from '@/shared/types/artwork'
import { ARTWORK_FAILURE_MESSAGE, useArtworkStore, type StorageEstimate } from '@/stores/artwork'
import { useLibraryStore } from '@/stores/library'

import ArtworkEditorPreview from '@/features/artwork/ArtworkEditorPreview.vue'
import ArtworkDisplayControls from './ArtworkDisplayControls.vue'
import {
  ARTWORK_IMAGE_TOOLS,
  ARTWORK_LIMITS,
  REJECT_MESSAGE,
  browserImageTools,
  validateArtwork,
  type ValidatedArtwork,
} from './imageValidation'
import { useObjectUrls, useTrackArtwork, type TrackArtworkView } from './useTrackArtwork'

const props = withDefaults(
  defineProps<{ playlistId: string; trackId: string; active?: boolean }>(),
  { active: true },
)
const emit = defineEmits<{ close: [] }>()

const store = useArtworkStore()
const library = useLibraryStore()
const tools = inject(ARTWORK_IMAGE_TOOLS, null) ?? browserImageTools()
const urls = useObjectUrls()

const key = computed<TrackKey>(() => ({ playlistId: props.playlistId, trackId: props.trackId }))
const track = computed(
  () =>
    library.getPlaylist(props.playlistId)?.tracks.find((item) => item.id === props.trackId) ?? null,
)
const videoId = computed(() => track.value?.videoId ?? null)

/** 비교 버튼이 보여 줄 현재 저장된 그림. */
const { view: current } = useTrackArtwork(
  computed(() => key.value),
  urls,
)

type Choice = 'auto' | 'default' | 'custom'
const choice = ref<Choice>('auto')
/** 이 화면을 연(또는 마지막으로 저장한) 때의 수정 번호 — 탭 간 충돌 판정. */
const revision = ref(0)

const pending = shallowRef<ValidatedArtwork | null>(null)
const pendingUrl = ref<string | null>(null)
const pendingPosterUrl = ref<string | null>(null)
const display = ref<ArtworkDisplay>({ ...DEFAULT_ARTWORK_DISPLAY })
const savedDisplay = computed(() => store.displayFor(key.value))
const displayChanged = computed(
  () => JSON.stringify(display.value) !== JSON.stringify(savedDisplay.value),
)
const dimensions = computed(() => pending.value ?? store.assetFor(current.value.assetId ?? ''))
const draftArtwork = computed<TrackArtworkView>(() => {
  const sameAsset = pending.value?.id === current.value.assetId
  return {
    mode: choice.value,
    src:
      choice.value === 'custom'
        ? ((sameAsset ? current.value.src : pendingUrl.value) ?? current.value.src)
        : null,
    posterSrc:
      pendingUrl.value !== null && !sameAsset ? pendingPosterUrl.value : current.value.posterSrc,
    animated: choice.value === 'custom' && (pending.value?.animated ?? current.value.animated),
    assetId: pending.value?.id ?? current.value.assetId,
  }
})
let fileSequence = 0
const hasUnsavedInput = computed(
  () => pending.value !== null || checking.value || displayChanged.value,
)
const checking = ref(false)
const saving = ref(false)
defineExpose({ hasUnsavedInput, busy: saving })
const message = ref('')
const failed = ref(false)
const estimate = ref<StorageEstimate | null>(null)
const persistNote = ref('')
const fileInput = useTemplateRef<HTMLInputElement>('fileInput')
const heading = useTemplateRef<HTMLElement>('heading')

function syncFromStore(): void {
  const preference = store.preferenceFor(key.value)
  choice.value = preference.mode
  display.value = { ...store.displayFor(key.value) }
  revision.value = store.revisionFor(key.value)
}

function dropPending(): void {
  if (pendingUrl.value !== null) urls.revoke(pendingUrl.value)
  if (pendingPosterUrl.value !== null) urls.revoke(pendingPosterUrl.value)
  pendingUrl.value = null
  pendingPosterUrl.value = null
  pending.value = null
}

onMounted(async () => {
  syncFromStore()
  heading.value?.focus()
  estimate.value = await store.estimate()
})

onBeforeUnmount(() => {
  fileSequence += 1
  dropPending()
})

// 다른 곡을 열면 처음부터.
watch(key, () => {
  fileSequence += 1
  dropPending()
  message.value = ''
  failed.value = false
  syncFromStore()
})

const unavailable = computed(() => store.status === 'unavailable')
const currentLabel = computed(() => {
  switch (current.value.mode) {
    case 'custom':
    case 'loading':
      return current.value.animated ? '내 이미지 (움직이는 GIF)' : '내 이미지'
    case 'default':
      return '39page 기본 그림'
    case 'missing':
      return '연결된 이미지를 찾지 못함 — 기본 그림으로 보입니다'
    default:
      return 'YouTube 썸네일 (없으면 기본 그림)'
  }
})

async function onFile(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (file === undefined) return
  message.value = ''
  failed.value = false
  checking.value = true
  const sequence = ++fileSequence
  try {
    const result = await validateArtwork(file, tools)
    if (sequence !== fileSequence) return
    if (!result.ok) {
      failed.value = true
      message.value = REJECT_MESSAGE[result.reason]
      return
    }
    dropPending()
    pending.value = result.artwork
    pendingUrl.value = urls.create(result.artwork.blob)
    pendingPosterUrl.value =
      result.artwork.poster === null ? null : urls.create(result.artwork.poster)
    display.value = { ...DEFAULT_ARTWORK_DISPLAY }
    choice.value = 'custom'
  } finally {
    if (sequence === fileSequence) checking.value = false
  }
}

const pendingInfo = computed(() => {
  const artwork = pending.value
  if (artwork === null) return ''
  const kind = artwork.animated
    ? 'GIF (움직임)'
    : artwork.mimeType.replace('image/', '').toUpperCase()
  return `${String(artwork.width)}×${String(artwork.height)} · ${formatBytes(artwork.byteSize)} · ${kind}`
})

/** 저장할 것이 있는가 — 지금과 같으면 저장 단추를 끈다. */
const canSave = computed(() => {
  if (saving.value || checking.value || unavailable.value || track.value === null) return false
  const now = store.preferenceFor(key.value).mode
  if (choice.value === 'custom')
    return pending.value !== null || (now === 'custom' && displayChanged.value)
  return choice.value !== now
})

async function save(): Promise<void> {
  const id = videoId.value
  if (!canSave.value || id === null) return
  saving.value = true
  message.value = ''
  failed.value = false
  try {
    const result =
      choice.value === 'custom' && pending.value !== null
        ? await store.setCustom(key.value, id, pending.value, revision.value, display.value)
        : choice.value === 'custom'
          ? await store.setDisplay(key.value, id, display.value, revision.value)
          : choice.value === 'default'
            ? await store.useDefault(key.value, id, revision.value)
            : await store.useAuto(key.value, id, revision.value)
    if (!result.ok) {
      failed.value = true
      message.value = ARTWORK_FAILURE_MESSAGE[result.reason]
      // 충돌이면 지금 것을 기준으로 다시 고를 수 있게 수정 번호만 새로 받는다 (고른 파일은 그대로 둔다).
      if (result.reason === 'conflict') revision.value = store.revisionFor(key.value)
      return
    }
    dropPending()
    syncFromStore()
    message.value = '저장했습니다.'
    estimate.value = await store.estimate()
  } finally {
    saving.value = false
  }
}

async function askPersist(): Promise<void> {
  const granted = await store.requestPersist()
  persistNote.value =
    granted === true
      ? '이 브라우저가 오래 보관하기로 했습니다 (공간이 모자라도 먼저 지우지 않음).'
      : granted === false
        ? '브라우저가 요청을 받아들이지 않았습니다. 전체 백업(ZIP)으로 보관해 주세요.'
        : '이 브라우저는 보관 요청을 지원하지 않습니다.'
  estimate.value = await store.estimate()
}

const stillLimit = formatBytes(ARTWORK_LIMITS.stillBytes)
const gifLimit = formatBytes(ARTWORK_LIMITS.gifBytes)
</script>

<template>
  <section class="artwork-settings" aria-labelledby="artwork-settings-title">
    <div class="settings-head">
      <h3 id="artwork-settings-title" ref="heading" class="settings-title" tabindex="-1">
        앨범아트 편집
        <span class="settings-track" :title="track?.title">{{
          track?.title ?? '(지워진 곡)'
        }}</span>
      </h3>
      <button type="button" class="pill" aria-label="앨범아트 설정 닫기" @click="emit('close')">
        ← 곡 목록으로
      </button>
    </div>

    <div class="settings-scroll">
      <p v-if="unavailable" class="settings-warning" role="alert">
        {{ ARTWORK_FAILURE_MESSAGE.unavailable }} 썸네일 · 기본 그림만 보입니다.
      </p>
      <p v-if="track === null" class="settings-warning" role="alert">
        {{ ARTWORK_FAILURE_MESSAGE['track-missing'] }}
      </p>

      <div class="settings-workspace">
        <ArtworkEditorPreview
          v-model="display"
          :video-id="videoId"
          :saved="current"
          :draft="draftArtwork"
          :saved-display="savedDisplay"
          :saved-label="currentLabel"
          :dimensions="dimensions"
          :active="active"
          :disabled="saving || checking || unavailable"
        />

        <div class="settings-tools">
          <ArtworkDisplayControls
            v-if="choice === 'custom'"
            v-model="display"
            :disabled="saving || checking || unavailable"
          />

          <fieldset class="settings-choices" :disabled="saving || unavailable || track === null">
            <legend class="sr-only">앨범아트 고르기</legend>
            <label class="choice">
              <input v-model="choice" type="radio" name="artwork-choice" value="auto" />
              YouTube 썸네일 사용
            </label>
            <label class="choice">
              <input v-model="choice" type="radio" name="artwork-choice" value="default" />
              39page 기본 그림 사용
            </label>
            <label class="choice">
              <input
                v-model="choice"
                type="radio"
                name="artwork-choice"
                value="custom"
                :disabled="pending === null && current.mode !== 'custom'"
              />
              내 이미지 · GIF
            </label>
            <div class="file-row">
              <button type="button" class="pill" :disabled="checking" @click="fileInput?.click()">
                {{ checking ? '확인하는 중…' : '파일 고르기' }}
              </button>
              <span class="file-hint"
                >PNG · JPEG · WebP {{ stillLimit }}, GIF {{ gifLimit }} 까지</span
              >
              <span v-if="pendingInfo" class="file-hint">{{ pendingInfo }}</span>
              <input
                ref="fileInput"
                class="sr-only"
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                tabindex="-1"
                aria-label="앨범아트 이미지 파일"
                @change="onFile"
              />
            </div>
          </fieldset>
        </div>
      </div>

      <details class="settings-storage">
        <summary>저장 공간 및 백업 안내</summary>
        <p>
          앨범아트 {{ store.usage.assets }}개 · {{ formatBytes(store.usage.bytes) }}
          <template v-if="estimate?.quota != null">
            · 브라우저 여유 약
            {{ formatBytes(Math.max(0, estimate.quota - (estimate.usage ?? 0))) }}
          </template>
        </p>
        <p class="storage-note">
          앨범아트는 이 브라우저에만 저장됩니다. 브라우저 데이터를 지우면 함께 사라집니다 — 데이터 ·
          백업의 전체 백업(ZIP)으로 보관하세요.
        </p>
        <button v-if="estimate?.persisted === false" type="button" class="pill" @click="askPersist">
          이 브라우저에 오래 보관 요청
        </button>
        <p v-if="persistNote !== ''" class="storage-note" role="status">{{ persistNote }}</p>
      </details>
    </div>

    <div class="settings-foot">
      <p class="settings-status" :class="{ 'is-warning': failed }" role="status" aria-live="polite">
        {{ message }}
      </p>
      <div class="settings-actions">
        <button type="button" class="pill" :disabled="saving" @click="emit('close')">취소</button>
        <button type="button" class="pill pill--primary" :disabled="!canSave" @click="save">
          {{ saving ? '저장하는 중…' : '변경사항 저장' }}
        </button>
      </div>
    </div>
  </section>
</template>

<style scoped>
.artwork-settings {
  display: grid;
  min-width: 0;
  min-height: 0;
  grid-template-rows: auto minmax(0, 1fr) auto;
  padding: 0;
  overflow: hidden;
  container: artwork-editor / size;
}

.settings-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  min-width: 0;
  padding: 8px 12px;
  border-bottom: 1px solid var(--drawer-head-border-color);
}

.settings-head > button {
  flex: none;
}

.settings-scroll {
  --preview-size: clamp(64px, 23cqh, 112px);
  min-height: 0;
  min-width: 0;
  padding: 12px;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-gutter: stable;
  scroll-padding-block: calc(var(--preview-size) + 20px) 12px;
}

.settings-workspace {
  display: grid;
  min-width: 0;
  align-items: start;
  gap: 12px;
}
.settings-tools {
  display: grid;
  min-width: 0;
  gap: 12px;
}

.settings-title {
  min-width: 0;
  margin: 0;
  color: var(--drawer-title-text-color);
  font: 12px var(--font-mono);
  letter-spacing: 0.08em;
  overflow-wrap: anywhere;
}

.settings-track {
  display: block;
  margin-top: 4px;
  font: 15px/1.35 var(--font-body);
  letter-spacing: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.settings-warning {
  margin: 0;
  color: var(--status-warning-text-color);
  font: 12px/1.5 var(--font-mono);
}

.settings-choices {
  display: flex;
  flex-direction: column;
  margin: 0;
  padding: 0;
  border: 0;
  gap: 4px;
}

.choice {
  display: flex;
  min-height: 44px;
  align-items: center;
  gap: 10px;
  font-size: 14px;
}

.choice input {
  width: 18px;
  height: 18px;
}

.file-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  padding-left: 28px;
  gap: 10px;
}

.file-hint,
.storage-note {
  margin: 0;
  font: 11px/1.5 var(--font-mono);
  opacity: 0.85;
}

.settings-status {
  margin: 0;
  font: 12px/1.5 var(--font-mono);
}

.settings-foot {
  padding: 8px 12px;
  border-top: 1px solid var(--drawer-head-border-color);
  background: var(--drawer-surface-color);
}
.settings-status:not(:empty) {
  margin-bottom: 6px;
}

.settings-status.is-warning {
  color: var(--status-warning-text-color);
}

.settings-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.settings-storage {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  padding-top: 10px;
  border-top: 1px solid var(--drawer-head-border-color);
  font: 12px/1.5 var(--font-mono);
  gap: 6px;
  margin-top: 16px;
}

.settings-storage summary {
  min-height: 44px;
  cursor: pointer;
}

@container artwork-editor (min-width: 560px) {
  .settings-workspace {
    grid-template-columns: minmax(0, 0.9fr) minmax(0, 1fr);
    gap: 20px;
  }
  .settings-scroll {
    --preview-size: clamp(72px, min(46cqh, calc(100cqh - 208px)), 280px);
    scroll-padding-block-start: 12px;
  }
}

/* 짧은 편집 칸에서도 64px 미리보기 아래에 44px 조절 행이 온전히 남도록 한다. */
@container artwork-editor (max-height: 280px) {
  .settings-scroll {
    --preview-size: 64px;
    padding-block: 4px;
    scroll-padding-block: calc(var(--preview-size) + 12px) 4px;
  }
}

.settings-storage p {
  margin: 0;
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

.pill--primary {
  border-color: var(--accent-strong-color);
  background: var(--accent-strong-color);
  color: var(--accent-strong-text-color);
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}
</style>
