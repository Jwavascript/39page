/**
 * 커스텀 테마 (ADR 0045) — 사용자가 고른 다섯 색과 데크 그림.
 *
 * - 색: `localStorage` `39page.customTheme` (작다). 문서 루트에 CSS 변수(`--custom-*`)로 건다. 테마가 무엇이든 늘
 *   걸어 둔다 — `custom` 토큰만 그 변수를 읽으므로, 테마 전환은 여전히 `data-theme` 교체 하나다 (ADR 0001).
 * - 데크 그림: IndexedDB `39page-theme` (`features/custom-theme/deckImageRepository.ts`). 바이트는 반응형 상태에
 *   넣지 않고 `blob:` 주소만 둔다.
 *
 * 테마 선택(`stores/theme.ts`)과 **따로**다 — 테마를 바꿔도 고른 색 · 그림이 남는다. 재생 · 라이브러리를 모른다.
 */
import { computed, ref, shallowRef, watch } from 'vue'
import { defineStore } from 'pinia'

import {
  createDeckImageRepository,
  openThemeDb,
  type DeckImageRecord,
  type DeckImageRepository,
  type DeckImageWrite,
  type DeckWriteFailure,
} from '@/features/custom-theme/deckImageRepository'
import type { ValidatedArtwork } from '@/features/artwork/imageValidation'
import {
  STORAGE_KEYS,
  defineStorage,
  type ReadOutcome,
  type WriteFailureReason,
} from '@/shared/storage'
import { DEFAULT_ARTWORK_DISPLAY, type ArtworkDisplay } from '@/shared/types/artwork'
import {
  customThemeVariables,
  defaultCustomThemeSettings,
  readCustomThemeSettings,
  type CustomThemeColors,
  type CustomThemeSettings,
} from '@/shared/types/customTheme'

/** 저장 · 백업 섹션 버전. 형태는 `{ version, data: { colors } }`. */
export const CUSTOM_THEME_STORAGE_VERSION = 1

export const customThemeStorage = defineStorage<CustomThemeSettings>({
  key: STORAGE_KEYS.customTheme,
  version: CUSTOM_THEME_STORAGE_VERSION,
  fallback: defaultCustomThemeSettings,
  validate: readCustomThemeSettings,
})

/** 데크 그림이 바뀌었다고 다른 탭에 알리는 채널. */
export const THEME_CHANNEL = '39page-theme'

export const DECK_FAILURE_MESSAGE: Readonly<Record<DeckWriteFailure, string>> = {
  conflict: '다른 탭에서 데크 그림이 바뀌었어요. 지금 것을 보고 다시 골라 주세요.',
  quota: '저장 공간이 부족해 그림을 저장하지 못했어요. 더 작은 파일을 골라 주세요.',
  unavailable: '이 브라우저에서는 그림을 저장할 수 없어요 (비공개 창 · 저장소 차단 등).',
  failed: '그림을 저장하지 못했어요. 다시 시도해 주세요.',
}

export type DeckStatus = 'idle' | 'loading' | 'ready' | 'unavailable'

export interface CustomThemeInitOptions {
  readonly factory?: IDBFactory
  /** 탭 간 알림. 시험이 바꿔 끼운다. 없으면 브라우저의 `BroadcastChannel`. */
  readonly channel?: {
    postMessage(message: unknown): void
    onmessage: ((event: MessageEvent) => void) | null
  } | null
}

/** 검증한 파일 → 저장할 데크 그림. */
export function deckWriteFromArtwork(
  artwork: ValidatedArtwork,
  display: ArtworkDisplay = DEFAULT_ARTWORK_DISPLAY,
): DeckImageWrite {
  return {
    assetId: artwork.id,
    mimeType: artwork.mimeType,
    byteSize: artwork.byteSize,
    width: artwork.width,
    height: artwork.height,
    animated: artwork.animated,
    blob: artwork.blob,
    poster: artwork.poster,
    display: { ...display },
  }
}

function objectUrl(blob: Blob | null): string | null {
  if (blob === null || typeof URL.createObjectURL !== 'function') return null
  return URL.createObjectURL(blob)
}

function revoke(url: string | null): void {
  if (url !== null && typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(url)
}

export const useCustomThemeStore = defineStore('customTheme', () => {
  /* ---------------------------------------------------------------- *
   * 색
   * ---------------------------------------------------------------- */

  const saved = ref<CustomThemeColors>(defaultCustomThemeSettings().colors)
  /** 설정 창에서 고르는 중인 색 — 저장 전에 화면 전체에 미리 보인다. 닫으면 `null`. */
  const preview = ref<CustomThemeColors | null>(null)
  const colors = computed<CustomThemeColors>(() => preview.value ?? saved.value)
  const restoreOutcome = ref<ReadOutcome | null>(null)
  const lastWriteFailure = ref<WriteFailureReason | null>(null)

  function applyToDocument(next: CustomThemeColors): void {
    if (typeof document === 'undefined') return
    const style = document.documentElement.style
    for (const [name, value] of Object.entries(customThemeVariables(next))) {
      style.setProperty(name, value)
    }
  }

  watch(colors, applyToDocument, { immediate: true, flush: 'sync', deep: true })

  /** 저장된 색을 읽는다. **읽기만 한다** — 손상 · 미래 버전을 덮어쓰지 않는다. */
  function restore(): ReadOutcome {
    const { value, outcome } = customThemeStorage.read()
    restoreOutcome.value = outcome
    saved.value = value.colors
    return outcome
  }

  /** 색을 저장한다. 적용은 저장 성공과 무관하게 먼저 된다 (테마 전환과 같은 정책). */
  function setColors(next: CustomThemeColors): boolean {
    const settings = readCustomThemeSettings({ colors: next })
    if (settings === null) return false
    saved.value = settings.colors
    preview.value = null
    const result = customThemeStorage.write(settings)
    lastWriteFailure.value = result.ok ? null : result.reason
    return result.ok
  }

  function previewColors(next: CustomThemeColors | null): void {
    preview.value = next === null ? null : { ...next }
  }

  /** 다른 탭이 색을 저장하면 따라간다. 미리보기 중이면 미리보기를 그대로 둔다. */
  function onStorage(event: StorageEvent): void {
    if (event.key === STORAGE_KEYS.customTheme) restore()
  }

  /* ---------------------------------------------------------------- *
   * 데크 그림
   * ---------------------------------------------------------------- */

  const deckStatus = ref<DeckStatus>('idle')
  const deck = shallowRef<DeckImageRecord | null>(null)
  const deckSrc = ref<string | null>(null)
  const deckPosterSrc = ref<string | null>(null)
  const deckRevision = computed(() => deck.value?.revision ?? 0)

  let repository: DeckImageRepository | null = null
  let channel: CustomThemeInitOptions['channel'] = null
  let initPromise: Promise<void> | null = null

  function show(record: DeckImageRecord | null): void {
    const sameBytes =
      record !== null && deck.value !== null && record.assetId === deck.value.assetId
    deck.value = record
    if (sameBytes) return
    revoke(deckSrc.value)
    revoke(deckPosterSrc.value)
    deckSrc.value = record === null ? null : objectUrl(record.blob)
    deckPosterSrc.value = record === null ? null : objectUrl(record.poster)
  }

  async function reloadDeck(): Promise<void> {
    if (repository === null) return
    try {
      show(await repository.read())
    } catch {
      deckStatus.value = 'unavailable'
    }
  }

  function onVisible(): void {
    if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
      void reloadDeck()
    }
  }

  /** 데크 그림 저장소를 열고 읽는다. 여러 번 불러도 한 번만 연다. */
  function initDeck(options: CustomThemeInitOptions = {}): Promise<void> {
    if (initPromise !== null) return initPromise
    deckStatus.value = 'loading'
    if (typeof window !== 'undefined') window.addEventListener('storage', onStorage)
    initPromise = (async () => {
      try {
        const db = await openThemeDb(options.factory)
        db.onversionchange = () => {
          db.close()
          repository = null
          deckStatus.value = 'unavailable'
        }
        repository = createDeckImageRepository(db)
      } catch {
        deckStatus.value = 'unavailable'
        return
      }
      await reloadDeck()
      if (deckStatus.value === 'loading') deckStatus.value = 'ready'
      channel =
        options.channel !== undefined
          ? options.channel
          : typeof BroadcastChannel === 'function'
            ? new BroadcastChannel(THEME_CHANNEL)
            : null
      if (channel !== null) channel.onmessage = () => void reloadDeck()
      if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisible)
    })()
    return initPromise
  }

  /**
   * 데크 그림을 바꾸거나(`next`) 지운다(`null`). `expectedRevision` 은 설정 창을 연 순간의 번호 — 그 사이 다른 탭이
   * 바꿨으면 `conflict` 로 거절하고 지금 것을 다시 읽는다.
   */
  async function writeDeck(
    next: DeckImageWrite | null,
    expectedRevision: number = deckRevision.value,
  ): Promise<{ ok: true } | { ok: false; reason: DeckWriteFailure }> {
    if (repository === null) return { ok: false, reason: 'unavailable' }
    const result = await repository.write(next, expectedRevision, new Date())
    if (!result.ok) {
      if (result.reason === 'conflict') await reloadDeck()
      return result
    }
    show(result.record)
    try {
      channel?.postMessage({ type: 'changed' })
    } catch {
      /* 알림은 보조다 — 다른 탭은 창이 다시 보일 때 읽는다 */
    }
    return { ok: true }
  }

  return {
    saved,
    preview,
    colors,
    restoreOutcome,
    lastWriteFailure,
    restore,
    setColors,
    previewColors,
    deckStatus,
    deck,
    deckSrc,
    deckPosterSrc,
    deckRevision,
    initDeck,
    reloadDeck,
    writeDeck,
  }
})
