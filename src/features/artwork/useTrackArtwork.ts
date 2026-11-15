/**
 * 한 트랙의 앨범아트를 화면에 그릴 값으로 (M12-3, ARTWORK_DESIGN §2-3 · §5).
 *
 * 선호(`stores/artwork`) → 그릴 것:
 *
 * | 선호     | 자산                | 결과                                               |
 * | -------- | ------------------- | -------------------------------------------------- |
 * | auto     | —                   | `auto` — `ArtworkImage` 가 썸네일 → 기본            |
 * | default  | —                   | `default`                                          |
 * | custom   | 바이트를 읽음       | `custom` — Object URL (움직이는 GIF 면 포스터 URL 도) |
 * | custom   | 없음 (사라짐 · 손상) | `missing` — 기본 그림 + 알림 (숨기지 않는다)        |
 *
 * **Object URL 수명**: 바이트를 받으면 URL 을 만들고, 자산이 바뀌거나 이 범위가 끝나면 **반드시** 지운다
 * (`revokeObjectURL`). 같은 자산을 다시 그리면 다시 만들지 않는다.
 */
import {
  computed,
  inject,
  onScopeDispose,
  ref,
  shallowRef,
  watch,
  type ComputedRef,
  type InjectionKey,
  type Ref,
} from 'vue'

import type { TrackKey } from '@/shared/types/artwork'
import { useArtworkStore } from '@/stores/artwork'

export type TrackArtworkMode = 'auto' | 'default' | 'custom' | 'missing' | 'loading'

export interface TrackArtworkView {
  readonly mode: TrackArtworkMode
  /** custom 일 때 원본 URL. */
  readonly src: string | null
  /** 움직이는 그림의 첫 프레임 URL. 정지 그림이면 `null`. */
  readonly posterSrc: string | null
  readonly animated: boolean
  readonly assetId: string | null
}

/** Object URL 만들기 · 지우기 — 시험이 바꿔 끼운다 (jsdom 에는 없다). */
export interface ObjectUrlApi {
  create(blob: Blob): string
  revoke(url: string): void
}

export const browserObjectUrls: ObjectUrlApi = {
  create: (blob) => URL.createObjectURL(blob),
  revoke: (url) => URL.revokeObjectURL(url),
}

/** 시험이 Object URL 기록기를 주입한다. 없으면 브라우저의 것. */
export const ARTWORK_OBJECT_URLS: InjectionKey<ObjectUrlApi> = Symbol('artwork-object-urls')

/** 컴포넌트 setup 안에서 — 주입된 것 또는 브라우저의 것. */
export function useObjectUrls(): ObjectUrlApi {
  return inject(ARTWORK_OBJECT_URLS, browserObjectUrls)
}

export function useTrackArtwork(
  key: Ref<TrackKey | null> | ComputedRef<TrackKey | null>,
  urls: ObjectUrlApi = useObjectUrls(),
): { view: ComputedRef<TrackArtworkView> } {
  const store = useArtworkStore()

  const assetId = computed<string | null>(() => {
    const current = key.value
    if (current === null) return null
    const preference = store.preferenceFor(current)
    return preference.mode === 'custom' ? preference.assetId : null
  })

  /** 지금 들고 있는 URL — 자산이 바뀌거나 범위가 끝나면 지운다. */
  const held = shallowRef<{ assetId: string; src: string; posterSrc: string | null } | null>(null)
  const failedAssetId = ref<string | null>(null)
  let loadSeq = 0

  function release(): void {
    const current = held.value
    if (current === null) return
    urls.revoke(current.src)
    if (current.posterSrc !== null) urls.revoke(current.posterSrc)
    held.value = null
  }

  watch(
    [assetId, () => store.generation],
    async ([id]) => {
      if (id === held.value?.assetId) return
      release()
      failedAssetId.value = null
      if (id === null) return
      const seq = ++loadSeq
      const record = await store.loadBlob(id)
      // 기다리는 동안 곡이 바뀌었으면 버린다 — 늦게 온 바이트로 URL 을 만들지 않는다.
      if (seq !== loadSeq || assetId.value !== id) return
      if (record === null) {
        failedAssetId.value = id
        return
      }
      held.value = {
        assetId: id,
        src: urls.create(record.blob),
        posterSrc: record.poster === null ? null : urls.create(record.poster),
      }
    },
    { immediate: true },
  )

  onScopeDispose(() => {
    loadSeq += 1
    release()
  })

  const view = computed<TrackArtworkView>(() => {
    const current = key.value
    const preference = current === null ? { mode: 'auto' as const } : store.preferenceFor(current)
    if (preference.mode !== 'custom') {
      return { mode: preference.mode, src: null, posterSrc: null, animated: false, assetId: null }
    }
    const asset = store.assetFor(preference.assetId)
    const holding = held.value?.assetId === preference.assetId ? held.value : null
    if (asset === null || failedAssetId.value === preference.assetId) {
      return {
        mode: 'missing',
        src: null,
        posterSrc: null,
        animated: false,
        assetId: preference.assetId,
      }
    }
    if (holding === null) {
      return {
        mode: 'loading',
        src: null,
        posterSrc: null,
        animated: asset.animated,
        assetId: preference.assetId,
      }
    }
    return {
      mode: 'custom',
      src: holding.src,
      posterSrc: holding.posterSrc,
      animated: asset.animated,
      assetId: preference.assetId,
    }
  })

  return { view }
}
