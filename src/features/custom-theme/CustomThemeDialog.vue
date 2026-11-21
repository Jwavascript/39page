<script setup lang="ts">
/**
 * 커스텀 테마 설정 창 (ADR 0045) — 데크 그림 · 다섯 색.
 *
 * 헤더의 팔레트 단추(커스텀 테마일 때)와 빈 데크의 "이미지 넣기" 가 연다. 연 동안만 마운트된다. 모달이다: 셸이
 * 뒤쪽을 `inert` 로 막고 Escape 를 받는다. 고르는 색은 저장 전에 화면 전체에 미리 보인다 — 닫으면 되돌아간다.
 */
import { nextTick, onMounted, ref } from 'vue'

import { useFocusTrap } from '@/components/ui/useFocusTrap'
import ArtworkDisplayControls from '@/features/artwork/ArtworkDisplayControls.vue'
import { useArtworkDisplayDrag } from '@/features/artwork/useArtworkDisplayDrag'
import { CUSTOM_COLOR_FIELDS } from '@/shared/types/customTheme'
import { DEFAULT_ARTWORK_DISPLAY, readArtworkDisplay } from '@/shared/types/artwork'

import { useCustomThemeEditor } from './useCustomThemeEditor'

const emit = defineEmits<{ close: [] }>()

const editor = useCustomThemeEditor()
const dialog = ref<HTMLElement | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)
const onKeydown = useFocusTrap(dialog)
const drag = useArtworkDisplayDrag(editor.display, editor.dimensions)

onMounted(async () => {
  await nextTick()
  dialog.value?.focus()
})

function imageStyle() {
  const display = readArtworkDisplay(editor.display.value) ?? DEFAULT_ARTWORK_DISPLAY
  const position = `${String(display.positionX)}% ${String(display.positionY)}%`
  return {
    objectFit: display.fit,
    objectPosition: position,
    transform: `scale(${String(display.zoom)})`,
    transformOrigin: position,
  }
}

async function onFile(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (file !== undefined) await editor.chooseFile(file)
}

async function save(): Promise<void> {
  if (await editor.save()) emit('close')
}
</script>

<template>
  <div class="custom-backdrop" @click.self="emit('close')">
    <div
      ref="dialog"
      class="custom-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="custom-theme-title"
      tabindex="-1"
      @keydown="onKeydown"
    >
      <div class="dialog-head">
        <h2 id="custom-theme-title" class="dialog-title">CUSTOM THEME</h2>
        <button
          type="button"
          class="icon-button"
          aria-label="커스텀 테마 닫기"
          title="닫기"
          @click="emit('close')"
        >
          <span class="ui-icon ui-icon--close" aria-hidden="true"></span>
        </button>
      </div>

      <section class="part" aria-labelledby="custom-deck-title">
        <h3 id="custom-deck-title" class="part-title">데크 그림</h3>
        <div
          class="deck-preview"
          :class="{ 'is-adjustable': editor.preview.value !== null }"
          data-custom-preview
          @pointerdown="drag.down"
          @pointermove="drag.move"
          @pointerup="drag.end"
          @pointercancel="drag.end"
          @lostpointercapture="drag.end"
        >
          <img
            v-if="editor.preview.value !== null && editor.preview.value.src !== null"
            :src="editor.preview.value.src"
            :style="imageStyle()"
            alt=""
            draggable="false"
          />
          <span v-else class="deck-preview-empty">PNG · JPG · GIF</span>
        </div>
        <div class="row-actions">
          <button
            type="button"
            class="pill"
            :disabled="editor.reading.value || editor.saving.value"
            @click="fileInput?.click()"
          >
            {{ editor.hasImage.value ? '다른 이미지' : '이미지 고르기' }}
          </button>
          <button
            v-if="editor.hasImage.value"
            type="button"
            class="icon-button icon-button--danger"
            aria-label="데크 그림 빼기"
            title="그림 빼기"
            :disabled="editor.saving.value"
            data-custom-remove
            @click="editor.removeImage()"
          >
            <span class="ui-icon ui-icon--trash" aria-hidden="true"></span>
          </button>
          <input
            ref="fileInput"
            class="file-input"
            type="file"
            accept="image/png,image/jpeg,image/gif,image/webp"
            tabindex="-1"
            aria-hidden="true"
            @change="onFile"
          />
        </div>
        <ArtworkDisplayControls
          v-if="editor.hasImage.value"
          v-model="editor.display.value"
          :disabled="editor.saving.value"
        />
      </section>

      <section class="part" aria-labelledby="custom-colors-title">
        <div class="part-head">
          <h3 id="custom-colors-title" class="part-title">색</h3>
          <button type="button" class="text-button" data-custom-reset @click="editor.resetColors()">
            기본 색
          </button>
        </div>
        <div class="colors">
          <label v-for="field in CUSTOM_COLOR_FIELDS" :key="field.key" class="color-field">
            <input
              type="color"
              :value="editor.colors.value[field.key]"
              :data-custom-color="field.key"
              @input="editor.setColor(field.key, ($event.target as HTMLInputElement).value)"
            />
            <span class="color-name">{{ field.label }}</span>
            <span class="color-hex">{{ editor.colors.value[field.key] }}</span>
          </label>
        </div>
        <ul v-if="editor.warnings.value.length > 0" class="warnings" role="status">
          <li v-for="warning in editor.warnings.value" :key="warning.id">{{ warning.message }}</li>
        </ul>
      </section>

      <p v-if="editor.error.value !== ''" class="error" role="alert">{{ editor.error.value }}</p>

      <div class="dialog-foot">
        <button type="button" class="pill" @click="emit('close')">취소</button>
        <button
          type="button"
          class="pill pill--primary"
          :disabled="editor.reading.value || editor.saving.value"
          data-custom-save
          @click="save"
        >
          저장
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.custom-backdrop {
  position: fixed;
  inset: 0;
  z-index: 10;
  display: grid;
  padding: 16px;
  overflow-y: auto;
  background: rgb(0 0 0 / 45%);
  place-items: center;
}

.custom-dialog {
  display: grid;
  width: min(520px, 100%);
  max-height: calc(100dvh - 32px);
  padding: 18px 20px;
  overflow-y: auto;
  overscroll-behavior: contain;
  gap: 16px;
  border: 1px solid var(--drawer-border-color);
  border-radius: var(--radius-modal);
  background: var(--drawer-surface-color);
  color: var(--row-text-color);
}

.custom-dialog:focus-visible {
  outline: var(--focus-ring-width) solid var(--focus-ring-color);
  outline-offset: 2px;
}

.dialog-head,
.part-head {
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

.part {
  display: grid;
  gap: 10px;
}

.part-title {
  margin: 0;
  color: var(--drawer-section-title-text-color);
  font: 12px var(--font-mono);
  font-weight: 400;
  letter-spacing: 0.08em;
}

/* 데크와 같은 900 × 570 틀. */
.deck-preview {
  position: relative;
  display: grid;
  overflow: hidden;
  aspect-ratio: 900 / 570;
  border: 2px solid var(--line-color);
  border-radius: var(--radius-modal);
  background: var(--artwork-frame-surface-color);
  place-items: center;
  touch-action: none;
}

.deck-preview.is-adjustable {
  cursor: grab;
}

.deck-preview img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  user-select: none;
}

.deck-preview-empty {
  color: var(--text-dim-color);
  font: 12px var(--font-mono);
  letter-spacing: 0.08em;
}

.row-actions,
.dialog-foot {
  display: flex;
  align-items: center;
  gap: 8px;
}

.dialog-foot {
  justify-content: flex-end;
}

.file-input {
  display: none;
}

.pill,
.text-button {
  min-height: 44px;
  padding: 0 16px;
  border: 1px solid var(--pill-border-color);
  border-radius: var(--radius-control);
  background: var(--pill-surface-color);
  color: var(--pill-text-color);
  font: 13px var(--font-body);
}

.text-button {
  min-height: 36px;
  padding: 0 12px;
  font-size: 12px;
}

.pill--primary {
  border-color: var(--accent-color);
  background: var(--accent-color);
  color: var(--accent-text-color);
}

.pill:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

.colors {
  display: grid;
  gap: 6px;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
}

.color-field {
  display: grid;
  align-items: center;
  min-height: 44px;
  padding: 4px 8px;
  border: 1px solid var(--row-border-color);
  border-radius: var(--radius-control);
  background: var(--row-surface-color);
  gap: 0 8px;
  grid-template-columns: 36px minmax(0, 1fr);
}

.color-field input {
  width: 36px;
  height: 36px;
  padding: 0;
  border: 0;
  background: transparent;
  grid-row: 1 / span 2;
}

.color-name {
  font-size: 13px;
}

.color-hex {
  color: var(--row-meta-text-color);
  font: 11px var(--font-mono);
}

.warnings {
  display: grid;
  margin: 0;
  padding: 0;
  gap: 4px;
  color: var(--status-warning-text-color);
  font: 12px/1.5 var(--font-body);
  list-style: none;
}

.error {
  margin: 0;
  color: var(--error-text-color);
  font: 12px/1.6 var(--font-body);
}
</style>
