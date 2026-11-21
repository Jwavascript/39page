/**
 * 커스텀 테마 설정 창의 편집 상태 (ADR 0045).
 *
 * 연 순간의 저장 값을 복사해 **초안**으로 고친다. 고르는 색은 저장 전에 화면 전체에 미리 보인다
 * (`customTheme.previewColors`) — 닫거나 취소하면 저장된 색으로 돌아간다.
 *
 * 저장 순서: 그림(IndexedDB) → 색(localStorage). 그림 저장이 실패하면 아무것도 저장하지 않고 창을 그대로 둔다.
 * 그림은 연 순간의 수정 번호로 저장한다 — 그 사이 다른 탭이 바꿨으면 `conflict`.
 */
import { computed, inject, onBeforeUnmount, ref, shallowRef, watch, type Ref } from 'vue'

import {
  ARTWORK_IMAGE_TOOLS,
  REJECT_MESSAGE,
  browserImageTools,
  validateArtwork,
} from '@/features/artwork/imageValidation'
import { DEFAULT_ARTWORK_DISPLAY, type ArtworkDisplay } from '@/shared/types/artwork'
import {
  DEFAULT_CUSTOM_COLORS,
  type CustomColorKey,
  type CustomThemeColors,
} from '@/shared/types/customTheme'
import { normalizeHexColor } from '@/shared/utils/color'
import { customThemeWarnings } from '@/themes/custom/palette'
import {
  DECK_FAILURE_MESSAGE,
  deckWriteFromArtwork,
  useCustomThemeStore,
} from '@/stores/customTheme'
import type { DeckImageWrite } from '@/features/custom-theme/deckImageRepository'

/** 초안의 그림 — 그대로 · 새 파일 · 빼기. */
type DraftImage =
  | { readonly kind: 'keep' }
  | {
      readonly kind: 'new'
      readonly write: DeckImageWrite
      readonly src: string | null
      readonly posterSrc: string | null
    }
  | { readonly kind: 'remove' }

function objectUrl(blob: Blob | null): string | null {
  if (blob === null || typeof URL.createObjectURL !== 'function') return null
  return URL.createObjectURL(blob)
}

function revoke(url: string | null): void {
  if (url !== null && typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(url)
}

export function useCustomThemeEditor() {
  const store = useCustomThemeStore()
  const tools = inject(ARTWORK_IMAGE_TOOLS, null) ?? browserImageTools()

  const colors = ref<CustomThemeColors>({ ...store.saved })
  const image = shallowRef<DraftImage>({ kind: 'keep' })
  const display = ref<ArtworkDisplay>({ ...(store.deck?.display ?? DEFAULT_ARTWORK_DISPLAY) })
  /** 연 순간의 데크 그림 수정 번호. */
  const revision = store.deckRevision
  const initialDisplay = JSON.stringify(display.value)

  const reading = ref(false)
  const saving = ref(false)
  /** 그림 · 저장 문제 — `role="alert"` 로 읽힌다. */
  const error = ref('')

  watch(colors, (next) => store.previewColors(next), { deep: true, immediate: true })

  /** 지금 초안에서 보일 그림. */
  const preview = computed(() => {
    const current = image.value
    if (current.kind === 'remove') return null
    if (current.kind === 'new') {
      return {
        src: current.src,
        posterSrc: current.posterSrc,
        animated: current.write.animated,
        width: current.write.width,
        height: current.write.height,
      }
    }
    const deck = store.deck
    if (deck === null) return null
    return {
      src: store.deckSrc,
      posterSrc: store.deckPosterSrc,
      animated: deck.animated,
      width: deck.width,
      height: deck.height,
    }
  })

  const dimensions = computed(() =>
    preview.value === null ? null : { width: preview.value.width, height: preview.value.height },
  )

  const warnings = computed(() => customThemeWarnings(colors.value))

  function setImage(next: DraftImage): void {
    const previous = image.value
    if (previous.kind === 'new') {
      revoke(previous.src)
      revoke(previous.posterSrc)
    }
    image.value = next
  }

  async function chooseFile(file: File): Promise<void> {
    error.value = ''
    reading.value = true
    try {
      const result = await validateArtwork(file, tools)
      if (!result.ok) {
        error.value = REJECT_MESSAGE[result.reason]
        return
      }
      display.value = { ...DEFAULT_ARTWORK_DISPLAY }
      setImage({
        kind: 'new',
        write: deckWriteFromArtwork(result.artwork),
        src: objectUrl(result.artwork.blob),
        posterSrc: objectUrl(result.artwork.poster),
      })
    } catch {
      error.value = REJECT_MESSAGE['read-failed']
    } finally {
      reading.value = false
    }
  }

  function removeImage(): void {
    error.value = ''
    setImage({ kind: 'remove' })
  }

  function setColor(key: CustomColorKey, value: string): void {
    const hex = normalizeHexColor(value)
    if (hex !== null) colors.value = { ...colors.value, [key]: hex }
  }

  function resetColors(): void {
    colors.value = { ...DEFAULT_CUSTOM_COLORS }
  }

  /** 그림에서 저장할 것 — 바뀐 것이 없으면 `undefined`. */
  function deckChange(): DeckImageWrite | null | undefined {
    const current = image.value
    if (current.kind === 'remove') return store.deck === null ? undefined : null
    if (current.kind === 'new') return { ...current.write, display: { ...display.value } }
    const deck = store.deck
    if (deck === null || JSON.stringify(display.value) === initialDisplay) return undefined
    const { id: _id, revision: _revision, updatedAt: _updatedAt, ...rest } = deck
    return { ...rest, display: { ...display.value } }
  }

  /**
   * 저장한다. 끝나면 `true` — 창을 닫아도 된다. 그림 저장이 실패하면 `false` 이고 아무것도 바꾸지 않았다.
   * 색 저장이 실패하면(저장소 막힘) 이번 창에서는 적용하고 알린다.
   */
  async function save(): Promise<boolean> {
    if (saving.value || reading.value) return false
    saving.value = true
    error.value = ''
    try {
      const change = deckChange()
      if (change !== undefined) {
        const result = await store.writeDeck(change, revision)
        if (!result.ok) {
          error.value = DECK_FAILURE_MESSAGE[result.reason]
          return false
        }
      }
      if (!store.setColors(colors.value)) {
        error.value = '색을 저장하지 못했어요. 이 창을 닫기 전까지만 보여요.'
        return false
      }
      setImage({ kind: 'keep' })
      return true
    } finally {
      saving.value = false
    }
  }

  /** 창이 닫힐 때 — 저장하지 않은 미리보기를 거둔다. */
  function dispose(): void {
    store.previewColors(null)
    setImage({ kind: 'keep' })
  }

  onBeforeUnmount(dispose)

  return {
    colors: colors as Ref<CustomThemeColors>,
    display,
    preview,
    dimensions,
    warnings,
    reading,
    saving,
    error,
    hasImage: computed(() => preview.value !== null),
    chooseFile,
    removeImage,
    setColor,
    resetColors,
    save,
  }
}
