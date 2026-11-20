/**
 * 링크로 공유 — 만들기 (ADR 0040 → ADR 0043).
 *
 * 대상(목록 · 곡 · Moment)으로 링크를 바로 만든다. ADR 0043 에서 고르는 칸(곡 이름 · Moments · 메모 넣기)을 없앴다 —
 * 무엇이 들어가는지는 대상이 정한다.
 *
 * | 대상   | 곡 이름 | Moments              | 메모   |
 * | ------ | ------- | -------------------- | ------ |
 * | 목록   | 넣는다  | 넣지 않는다          | —      |
 * | 곡     | 넣는다  | 그 곡의 Moments 모두 | 넣는다 |
 * | Moment | 넣는다  | 그 Moment            | 넣는다 |
 *
 * 곡이 많아 링크가 담을 수 있는 길이를 넘으면 **링크에서만** 곡 이름을 뺀다(받는 쪽이 YouTube 에서 제목을 찾는다). 그래도
 * 넘으면 링크를 만들지 않는다. 카드에는 늘 곡 이름이 있다. 저장하지 않고, 서버로 보내지 않는다 — 링크는 이 브라우저에서만
 * 만들어진다.
 *
 * 복사는 사용자가 누를 때만 한다 (`navigator.clipboard.writeText`). 막히면 링크 칸을 골라 두고 직접 복사하라고 말한다.
 */
import { computed, ref, watch, type ComputedRef, type Ref } from 'vue'

import type { Moment, Playlist, Track } from '@/shared/types'
import { useMomentsStore } from '@/stores/moments'

import {
  MAX_SHARE_DATA_LENGTH,
  MAX_SHARE_LINK_TRACKS,
  momentLinkContent,
  playlistLinkContent,
  SHARE_LINK_SOFT_LIMIT,
  shareLinkUrl,
  trackLinkContent,
  type ShareLinkContent,
} from './shareLink'

export type ShareLinkTarget =
  | { readonly kind: 'playlist'; readonly playlist: Playlist }
  | { readonly kind: 'track'; readonly playlist: Playlist; readonly track: Track }
  | { readonly kind: 'moment'; readonly moment: Moment; readonly title: string }

/** 링크 길이의 상태 — `long` 은 일부 게시판에서 잘릴 수 있다, `too-long` 은 만들지 않는다. */
export type ShareLinkLevel = 'ok' | 'long' | 'too-long'

export interface ShareLinkBuilder {
  /** 복사할 링크. 너무 길면 `null`. */
  url: ComputedRef<string | null>
  /** 링크 길이(글자). 너무 길어 만들지 않았을 때도 그 길이를 말한다. */
  length: ComputedRef<number>
  level: ComputedRef<ShareLinkLevel>
  /** 길이 때문에 링크에서 곡 이름을 뺐는가. */
  titlesDropped: ComputedRef<boolean>
  trackCount: ComputedRef<number>
  momentCount: ComputedRef<number>
  copyState: Readonly<Ref<'idle' | 'copied' | 'manual'>>
  /** 공유 카드 이미지에 그릴 내용 (ADR 0041) — 링크와 같은 대상 · Moments · 메모, 곡 이름은 **늘** 넣는다. */
  cardContent: ComputedRef<ShareLinkContent | null>
  copy(): Promise<void>
}

/** 39page 의 주소(조각 없이). 개발 · 미리보기 · 운영 어디서 만들든 그 주소로 돌아온다. */
function baseUrl(): string {
  const { origin, pathname } = globalThis.location
  return `${origin}${pathname}`
}

/** 링크가 담을 수 있는 길이 · 곡 수를 넘는가. */
function tooBig(content: ShareLinkContent): boolean {
  const url = shareLinkUrl(baseUrl(), content)
  const data = url.slice(url.indexOf('&d=') + 3)
  return data.length > MAX_SHARE_DATA_LENGTH || content.tracks.length > MAX_SHARE_LINK_TRACKS
}

export function useShareLink(target: Readonly<Ref<ShareLinkTarget | null>>): ShareLinkBuilder {
  const moments = useMomentsStore()
  const copyState = ref<'idle' | 'copied' | 'manual'>('idle')

  function contentWith(titles: boolean): ShareLinkContent | null {
    const current = target.value
    if (current === null) return null
    if (current.kind === 'moment') {
      return momentLinkContent(current.moment, current.title, { titles, notes: true })
    }
    return current.kind === 'track'
      ? trackLinkContent(current.track, moments.moments, { titles, notes: true })
      : playlistLinkContent(current.playlist, null, { titles, notes: false })
  }

  const cardContent = computed(() => contentWith(true))

  const titlesDropped = computed<boolean>(() => {
    const full = cardContent.value
    if (full === null || !tooBig(full)) return false
    const shorter = contentWith(false)
    return shorter !== null && !tooBig(shorter)
  })

  const content = computed(() => (titlesDropped.value ? contentWith(false) : cardContent.value))
  const fullUrl = computed<string | null>(() =>
    content.value === null ? null : shareLinkUrl(baseUrl(), content.value),
  )
  const isTooBig = computed<boolean>(() => content.value !== null && tooBig(content.value))

  const url = computed<string | null>(() => (isTooBig.value ? null : fullUrl.value))
  const length = computed<number>(() => fullUrl.value?.length ?? 0)
  const level = computed<ShareLinkLevel>(() =>
    isTooBig.value ? 'too-long' : length.value > SHARE_LINK_SOFT_LIMIT ? 'long' : 'ok',
  )
  const trackCount = computed<number>(() => content.value?.tracks.length ?? 0)
  const momentCount = computed<number>(() => content.value?.moments.length ?? 0)

  // 링크가 바뀌면 "복사했어요" 는 더 이상 사실이 아니다.
  watch(url, () => {
    copyState.value = 'idle'
  })

  async function copy(): Promise<void> {
    const text = url.value
    if (text === null) return
    try {
      if (typeof navigator.clipboard?.writeText !== 'function') throw new Error('no clipboard')
      await navigator.clipboard.writeText(text)
      copyState.value = 'copied'
    } catch {
      copyState.value = 'manual'
    }
  }

  return {
    url,
    length,
    level,
    titlesDropped,
    trackCount,
    momentCount,
    copyState,
    cardContent,
    copy,
  }
}
