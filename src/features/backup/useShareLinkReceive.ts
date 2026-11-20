/**
 * 링크로 받은 공유 — 미리보기 · 보관함에 넣기 (ADR 0040).
 *
 * 링크를 연 사람(받는 사람)의 브라우저에서 돈다. **누르기 전에는 아무것도 쓰지 않는다.**
 *
 * - 곡 이름이 없는 링크(보낸 사람이 짧게 만들었다)면 YouTube oEmbed 로 제목을 찾는다 — 링크로 곡을 추가할 때와 같은
 *   조회다 (ADR 0029: 영상 주소만 보내고 쿠키 · 리퍼러를 보내지 않는다). 동시에 4개, 최대 200곡. 미리보기를 닫으면 멈춘다.
 * - 넣기는 기존 store 액션만 쓴다 (잠금 · 개정 번호 · 저장 실패 경고 그대로). 새 목록 이름이 겹치면 "(2)" 를 붙인다
 *   (파일 공유 가져오기와 같은 규칙). 같은 영상은 기본으로 건너뛴다.
 * - Moments 는 고를 때만, 같은 (영상 · 초 · 메모) 는 건너뛴다.
 */
import { computed, onScopeDispose, ref, shallowRef, type ComputedRef, type Ref } from 'vue'

import { fetchYouTubeTitle, type TitleLookupResult } from '@/features/library/youtubeTitle'
import { createId } from '@/shared/utils/id'
import { useLibraryStore } from '@/stores/library'
import { createMoment, useMomentsStore } from '@/stores/moments'

import { MAX_SHARE_TITLE_LENGTH, type ShareLinkContent, type ShareLinkTrack } from './shareLink'
import { uniquePlaylistName } from './playlistName'

/** 제목을 찾는 곡 수의 상한 — 그보다 많으면 나머지는 기본 이름(`YouTube · <id>`)이다. */
export const SHARE_TITLE_LOOKUP_LIMIT = 200
const LOOKUP_CONCURRENCY = 4

/** 곡 구성이 같은 기존 목록 — 이름만 알린다. */
export interface SameList {
  readonly id: string
  readonly name: string
}

export interface ShareLinkImported {
  readonly playlistId: string
  /** 링크의 첫 곡이 그 목록에서 차지한 곡 — 새로 넣었거나(같은 영상을 건너뛰었으면) 원래 있던 곡. */
  readonly firstTrackId: string | null
}

export interface ShareLinkReceiveModel {
  readonly content: ShareLinkContent
  /** 화면에 보일 곡 이름 — 보낸 사람의 이름 → 찾은 YouTube 제목 → `YouTube · <id>`. */
  displayTitle(track: ShareLinkTrack): string
  readonly lookupTotal: Readonly<Ref<number>>
  readonly lookupDone: Readonly<Ref<number>>
  /** `'new'` = 새 목록, 아니면 기존 목록 id. */
  readonly target: Ref<string>
  readonly newListName: ComputedRef<string>
  readonly duplicates: Ref<'skip' | 'add'>
  readonly duplicateCount: ComputedRef<number>
  readonly includeMoments: Ref<boolean>
  /** 보관함에 곡 구성(영상 순서)이 똑같은 목록이 이미 있으면 그 목록. */
  readonly sameList: ComputedRef<SameList | null>
  readonly busy: Readonly<Ref<boolean>>
  readonly failed: Readonly<Ref<boolean>>
  readonly lines: Readonly<Ref<readonly string[]>>
  readonly imported: Readonly<Ref<ShareLinkImported | null>>
  /** 곡을 고른 목록에 넣는다 (Moments 는 켰을 때). 실패하면 `null` 이고 `lines` 가 이유를 말한다. */
  addTracks(): Promise<ShareLinkImported | null>
  /** Moments 만 저장한다 (Moment 하나를 받았을 때). */
  saveMoments(): Promise<boolean>
}

type TitleLookup = (
  videoId: string,
  options: { signal?: AbortSignal },
) => Promise<TitleLookupResult>

export function useShareLinkReceive(
  content: ShareLinkContent,
  options: { lookup?: TitleLookup } = {},
): ShareLinkReceiveModel {
  const library = useLibraryStore()
  const moments = useMomentsStore()
  const lookup = options.lookup ?? fetchYouTubeTitle

  /* ---------- 빠진 곡 이름 찾기 ---------- */

  const found = shallowRef<ReadonlyMap<string, string>>(new Map())
  const missing = [
    ...new Set(content.tracks.filter((track) => track.title === '').map((track) => track.videoId)),
  ].slice(0, SHARE_TITLE_LOOKUP_LIMIT)
  const lookupTotal = ref(missing.length)
  const lookupDone = ref(0)
  const controller = new AbortController()
  onScopeDispose(() => controller.abort())

  async function runLookups(): Promise<void> {
    let next = 0
    const worker = async (): Promise<void> => {
      while (next < missing.length && !controller.signal.aborted) {
        const videoId = missing[next] ?? ''
        next += 1
        const result = await lookup(videoId, { signal: controller.signal })
        if (controller.signal.aborted) return
        lookupDone.value += 1
        if (result.ok) {
          const title = [...result.title].slice(0, MAX_SHARE_TITLE_LENGTH).join('')
          found.value = new Map(found.value).set(videoId, title)
        }
      }
    }
    await Promise.all(
      Array.from({ length: Math.min(LOOKUP_CONCURRENCY, missing.length) }, () => worker()),
    )
  }
  if (missing.length > 0) void runLookups()

  /** 넣을 때의 이름 — 비면 라이브러리가 기본 이름을 쓴다. */
  function importTitle(track: ShareLinkTrack): string {
    return track.title !== '' ? track.title : (found.value.get(track.videoId) ?? '')
  }

  function displayTitle(track: ShareLinkTrack): string {
    const title = importTitle(track)
    return title === '' ? `YouTube · ${track.videoId}` : title
  }

  /* ---------- 넣을 곳 ---------- */

  const target = ref<string>(
    content.kind === 'playlist'
      ? 'new'
      : (library.selectedPlaylistId ?? library.playlists[0]?.id ?? 'new'),
  )
  const newListName = computed<string>(() =>
    content.kind === 'playlist'
      ? content.name.trim() === ''
        ? '공유받은 목록'
        : content.name
      : '공유받은 곡',
  )
  const duplicates = ref<'skip' | 'add'>('skip')
  const includeMoments = ref(content.kind === 'moment')

  const duplicateCount = computed<number>(() => {
    if (target.value === 'new') return 0
    const existing = new Set(
      library.getPlaylist(target.value)?.tracks.map((track) => track.videoId) ?? [],
    )
    return content.tracks.filter((track) => existing.has(track.videoId)).length
  })

  const sameList = computed<SameList | null>(() => {
    if (content.kind !== 'playlist') return null
    const match = library.playlists.find(
      (playlist) =>
        playlist.tracks.length === content.tracks.length &&
        playlist.tracks.every((track, index) => track.videoId === content.tracks[index]?.videoId),
    )
    return match === undefined ? null : { id: match.id, name: match.name }
  })

  /* ---------- 넣기 ---------- */

  const busy = ref(false)
  const failed = ref(false)
  const lines = ref<readonly string[]>([])
  const imported = shallowRef<ShareLinkImported | null>(null)

  /** Moment 를 저장할 때의 곡 제목 스냅샷. */
  function snapshotTitle(videoId: string): string {
    const track = content.tracks.find((item) => item.videoId === videoId)
    return track === undefined ? '' : importTitle(track)
  }

  async function momentLines(): Promise<string[]> {
    const have = new Set(
      moments.moments.map((m) => `${m.videoId}|${String(m.atSeconds)}|${m.note}`),
    )
    const fresh = content.moments
      .filter((m) => !have.has(`${m.videoId}|${String(m.atSeconds)}|${m.note}`))
      .map((m) =>
        createMoment({
          videoId: m.videoId,
          atSeconds: m.atSeconds,
          note: m.note,
          title: snapshotTitle(m.videoId),
          now: new Date(),
          id: createId(),
        }),
      )
    if (fresh.length === 0) return ['Moment 는 이미 모두 저장돼 있어요.']
    const result = await moments.addMoments(fresh)
    if (!result.ok) {
      failed.value = true
      return ['Moment 를 저장하지 못했어요 (다른 탭이 저장 중이에요). 잠시 뒤 다시 눌러 주세요.']
    }
    const skipped = content.moments.length - fresh.length
    const out = [
      `Moment ${String(result.added)}개를 저장했어요${skipped > 0 ? ` · 같은 Moment ${String(skipped)}개는 건너뜀` : ''}.`,
    ]
    if (!result.persisted) {
      failed.value = true
      out.push(
        'Moments 를 저장하지 못했어요 — 새로고침하면 사라져요. 데이터 · 백업에서 확인해 주세요.',
      )
    }
    return out
  }

  async function addTracks(): Promise<ShareLinkImported | null> {
    if (busy.value) return null
    busy.value = true
    failed.value = false
    const out: string[] = []
    try {
      let playlistId = target.value
      if (playlistId === 'new') {
        const name = uniquePlaylistName(
          library.playlists.map((playlist) => playlist.name),
          newListName.value,
        )
        const created = await library.createPlaylist(name)
        if (!created.ok) {
          failed.value = true
          out.push(`목록을 만들지 못했어요 (${created.reason}). 아무것도 추가하지 않았어요.`)
          return null
        }
        playlistId = created.playlistId
        out.push(`새 목록 “${library.getPlaylist(playlistId)?.name ?? name}” 을 만들었어요.`)
      } else if (library.getPlaylist(playlistId) === undefined) {
        failed.value = true
        out.push('고른 목록이 없어졌어요. 넣을 곳을 다시 골라 주세요.')
        return null
      }

      const existing = new Map(
        (library.getPlaylist(playlistId)?.tracks ?? []).map((track) => [track.videoId, track.id]),
      )
      let added = 0
      let skipped = 0
      let unsaved = false
      let firstTrackId: string | null = null
      for (const track of content.tracks) {
        const already = existing.get(track.videoId)
        if (duplicates.value === 'skip' && already !== undefined) {
          skipped += 1
          firstTrackId ??= already
          continue
        }
        const result = await library.addTrack(playlistId, {
          videoId: track.videoId,
          title: importTitle(track),
        })
        if (!result.ok || result.trackId === undefined) {
          failed.value = true
          out.push(
            `곡 ${String(added)}개를 추가한 뒤 멈췄어요 (${result.ok ? 'unknown' : result.reason}).`,
          )
          break
        }
        if (!result.persisted) unsaved = true
        added += 1
        firstTrackId ??= result.trackId
      }
      out.push(
        `곡 ${String(added)}개를 추가했어요${skipped > 0 ? ` · 이미 있는 같은 영상 ${String(skipped)}곡은 건너뜀` : ''}.`,
      )
      if (unsaved) {
        failed.value = true
        out.push(
          '보관함을 저장하지 못했어요 — 새로고침하면 사라져요. 데이터 · 백업에서 확인해 주세요.',
        )
      }
      if (includeMoments.value && content.moments.length > 0) out.push(...(await momentLines()))

      const result = { playlistId, firstTrackId }
      imported.value = result
      return result
    } finally {
      lines.value = out
      busy.value = false
    }
  }

  async function saveMoments(): Promise<boolean> {
    if (busy.value || content.moments.length === 0) return false
    busy.value = true
    failed.value = false
    try {
      lines.value = await momentLines()
      return !failed.value
    } finally {
      busy.value = false
    }
  }

  return {
    content,
    displayTitle,
    lookupTotal,
    lookupDone,
    target,
    newListName,
    duplicates,
    duplicateCount,
    includeMoments,
    sameList,
    busy,
    failed,
    lines,
    imported,
    addTracks,
    saveMoments,
  }
}
