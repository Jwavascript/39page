/**
 * 링크로 공유 — 만들기 (ADR 0040).
 *
 * 고른 대상(목록 · 곡 · Moment)과 선택(곡 이름 · Moments · 메모)으로 링크를 **바로바로** 만든다 — 선택을 바꾸면 링크와
 * 길이가 따라 바뀐다. 압축은 수 밀리초다. 저장하지 않고, 서버로 보내지 않는다 — 링크는 이 브라우저에서만 만들어진다.
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
  type ShareLinkOptions,
} from './shareLink'

export type ShareLinkTarget =
  | { readonly kind: 'playlist'; readonly playlist: Playlist }
  | { readonly kind: 'track'; readonly playlist: Playlist; readonly track: Track }
  | { readonly kind: 'moment'; readonly moment: Moment; readonly title: string }

/** 링크 길이의 상태 — `long` 은 일부 게시판에서 잘릴 수 있다, `too-long` 은 만들지 않는다. */
export type ShareLinkLevel = 'ok' | 'long' | 'too-long'

export interface ShareLinkBuilder {
  /** 곡 이름 넣기 (기본 켬). */
  titles: Ref<boolean>
  /** 이 곡들의 Moments 넣기 (목록 · 곡일 때, 기본 끔). Moment 하나를 공유할 때는 늘 그 Moment 다. */
  includeMoments: Ref<boolean>
  /** Moment 메모 넣기 (기본 끔 — 링크를 가진 누구나 읽는다). */
  notes: Ref<boolean>
  /** 넣을 수 있는 Moments 수 (목록 · 곡). */
  availableMoments: ComputedRef<number>
  /** 복사할 링크. 너무 길면 `null`. */
  url: ComputedRef<string | null>
  /** 링크 길이(글자). 너무 길어 만들지 않았을 때도 그 길이를 말한다. */
  length: ComputedRef<number>
  /** 곡 이름을 빼면 몇 글자인지 — 길 때만 (`level !== 'ok'` 이고 곡 이름이 켜져 있을 때). */
  lengthWithoutTitles: ComputedRef<number | null>
  level: ComputedRef<ShareLinkLevel>
  trackCount: ComputedRef<number>
  momentCount: ComputedRef<number>
  copyState: Readonly<Ref<'idle' | 'copied' | 'manual'>>
  copy(): Promise<void>
}

/** 39page 의 주소(조각 없이). 개발 · 미리보기 · 운영 어디서 만들든 그 주소로 돌아온다. */
function baseUrl(): string {
  const { origin, pathname } = globalThis.location
  return `${origin}${pathname}`
}

export function useShareLink(target: Readonly<Ref<ShareLinkTarget | null>>): ShareLinkBuilder {
  const moments = useMomentsStore()
  const titles = ref(true)
  const includeMoments = ref(false)
  const notes = ref(false)
  const copyState = ref<'idle' | 'copied' | 'manual'>('idle')

  // 대상이 **바뀌면** 선택을 기본값으로 — 앞 대상의 "Moments 넣기" 가 다음 대상에 몰래 남지 않게. 같은 대상의 내용이
  // 바뀌는 것(곡 추가 등)은 대상이 바뀐 것이 아니다 — id 로 견준다.
  watch(
    () => {
      const current = target.value
      if (current === null) return ''
      if (current.kind === 'moment') return `m:${current.moment.id}`
      return current.kind === 'track'
        ? `t:${current.playlist.id}:${current.track.id}`
        : `p:${current.playlist.id}`
    },
    () => {
      titles.value = true
      includeMoments.value = false
      notes.value = false
    },
  )

  const videoIds = computed<Set<string>>(() => {
    const current = target.value
    if (current === null || current.kind === 'moment') return new Set()
    return new Set(
      (current.kind === 'track' ? [current.track] : current.playlist.tracks).map(
        (track) => track.videoId,
      ),
    )
  })

  const availableMoments = computed<number>(
    () => moments.moments.filter((moment) => videoIds.value.has(moment.videoId)).length,
  )

  function contentWith(options: ShareLinkOptions): ShareLinkContent | null {
    const current = target.value
    if (current === null) return null
    if (current.kind === 'moment') return momentLinkContent(current.moment, current.title, options)
    const chosen = includeMoments.value ? moments.moments : null
    return current.kind === 'track'
      ? trackLinkContent(current.track, chosen, options)
      : playlistLinkContent(current.playlist, chosen, options)
  }

  const content = computed(() => contentWith({ titles: titles.value, notes: notes.value }))
  const fullUrl = computed<string | null>(() =>
    content.value === null ? null : shareLinkUrl(baseUrl(), content.value),
  )

  const tooBig = computed<boolean>(() => {
    const url = fullUrl.value
    if (url === null || content.value === null) return false
    const data = url.slice(url.indexOf('&d=') + 3)
    return (
      data.length > MAX_SHARE_DATA_LENGTH || content.value.tracks.length > MAX_SHARE_LINK_TRACKS
    )
  })

  const url = computed<string | null>(() => (tooBig.value ? null : fullUrl.value))
  const length = computed<number>(() => fullUrl.value?.length ?? 0)
  const level = computed<ShareLinkLevel>(() =>
    tooBig.value ? 'too-long' : length.value > SHARE_LINK_SOFT_LIMIT ? 'long' : 'ok',
  )
  const lengthWithoutTitles = computed<number | null>(() => {
    if (level.value === 'ok' || !titles.value) return null
    const shorter = contentWith({ titles: false, notes: notes.value })
    return shorter === null ? null : shareLinkUrl(baseUrl(), shorter).length
  })
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
    titles,
    includeMoments,
    notes,
    availableMoments,
    url,
    length,
    lengthWithoutTitles,
    level,
    trackCount,
    momentCount,
    copyState,
    copy,
  }
}
