/**
 * 보관함 Moments 탭의 뷰 모델 (M11-4, `M11_UX_DESIGN.md` §5-2 · §5-3 · §5-4).
 *
 * `useMomentsBrowser`(재생 · 메모 수정 · 삭제 · 안내)를 그대로 쓰고, 그 위에 **보관함에만 있는 것**을
 * 더한다 — 검색, 보기(전체 · 최근 · 이 곡 · 한 곡), 묶음 접기, 점진 표시, 라이브러리로 가기.
 *
 * 성능 원칙 (M9-6 실측: 데이터 처리는 병목이 아니고 **행 배치가 병목**이다)
 * - 그리는 줄 수를 데이터 크기와 떼어 놓는다: 묶음 30개씩 · 접힌 묶음은 머리만 · 펼친 묶음도
 *   한 번에 50줄 · 검색 결과는 200줄까지 · 최근 보기는 50줄씩.
 * - 줄(`MomentRow`)에는 Moment 객체와 제목 문자열만 넘긴다. store 는 고친 Moment 만 새 객체로
 *   바꾸므로 나머지 줄은 다시 그려지지 않는다.
 *
 * 저장하지 않는다 — 검색어 · 보기 · 접힘은 화면 상태다. 데이터 · 저장 키 변경 없음.
 *
 * M11-7C (ADR 0030 · UAT) — 보기는 **이 곡 → 전체 → 최근** 순이다.
 * - 사용자가 고르기 전의 보기는 **자동**이다: 지금 재생 중인 곡이 있으면 "이 곡", 없으면 "전체". 사용자가
 *   한 번 고르면(또는 한 곡 보기로 들어오면) 그 보기를 이 화면이 살아 있는 동안 기억한다 — 다른 탭에 갔다
 *   와도 되돌리지 않는다.
 * - "이 곡" 은 **묶음이 아니라 한 목록**이다 — 곡 제목 · 목록 이름을 되풀이하지 않는다(그 곡을 듣고 있다).
 *   전체 · 최근 · 한 곡 보기는 곡을 알아봐야 하므로 제목 · 목록을 그대로 둔다.
 */
import {
  computed,
  inject,
  onScopeDispose,
  reactive,
  ref,
  watch,
  type ComputedRef,
  type Ref,
} from 'vue'

import { ARCHIVE } from '@/features/archive/archiveController'
import type { Moment } from '@/shared/types'
import { useLibraryStore } from '@/stores/library'
import { useMomentsStore } from '@/stores/moments'

import {
  buildSearchIndex,
  defaultExpanded,
  GROUP_PAGE_SIZE,
  GROUP_ROW_PAGE_SIZE,
  playlistsByVideo,
  RECENT_PAGE_SIZE,
  recentMoments,
  SEARCH_ROW_LIMIT,
  searchMoments,
  searchTerms,
  type MomentsArchiveView,
  type PlaylistRef,
} from './momentsSearch'
import type { MomentTitleSource } from './momentsView'
import { useMomentsBrowser, type MomentsBrowserModel } from './useMomentsBrowser'

/** 입력이 멈춘 뒤 이만큼 기다렸다가 검색한다 (§5-2). */
export const SEARCH_DEBOUNCE_MS = 150

/** 묶음 머리가 그릴 것. */
export interface ArchiveGroupHead {
  videoId: string
  title: string
  titleSource: MomentTitleSource
  /** 그 곡의 Moment 수 (검색과 무관). */
  total: number
  /** 지금 보기 · 검색에 맞는 수. */
  matched: number
  isCurrent: boolean
  /** 그 영상이 든 목록. 비어 있으면 "목록에 없음". */
  playlists: PlaylistRef[]
  expanded: boolean
}

export interface ArchiveRow {
  moment: Readonly<Moment>
  /** 그 곡의 표시 제목 — 줄의 이름(aria) · 최근 보기의 제목 줄. */
  songTitle: string
}

export interface ArchiveSection {
  key: string
  /**
   * 평면 보기에서는 `null` — 머리가 없다. 최근 보기는 줄마다 곡 제목을 적고(`showSongTitle`), 이 곡 보기는
   * 적지 않는다.
   */
  head: ArchiveGroupHead | null
  /** 평면 보기의 줄에 곡 제목을 적는가. 최근 = `true`, 이 곡 = `false`. 묶음 보기에서는 쓰지 않는다. */
  showSongTitle?: boolean
  rows: ArchiveRow[]
  /** 펼친 묶음에서 아직 그리지 않은 줄 (묶음 안 점진 표시). */
  hiddenRows: number
}

export interface MomentsArchiveModel {
  browser: MomentsBrowserModel
  /** 지금 보기 — 사용자가 고른 것, 고르지 않았으면 자동(지금 곡이 있으면 이 곡, 없으면 전체). */
  view: Readonly<Ref<MomentsArchiveView>>
  /** 한 곡만 보는 중이면 그 영상. */
  focusVideoId: Readonly<Ref<string | null>>
  focusTitle: ComputedRef<string | null>
  /** 입력란의 글 (바로 바뀐다). */
  query: Ref<string>
  /** 실제로 적용된 검색 낱말 (150ms 뒤). */
  terms: ComputedRef<string[]>
  searching: ComputedRef<boolean>
  sections: ComputedRef<ArchiveSection[]>
  /** 지금 보기 · 검색에 맞는 Moment 수 / 곡 수 (그리지 않은 것 포함). */
  matchedMoments: ComputedRef<number>
  matchedSongs: ComputedRef<number>
  /** 그린 줄 수. */
  renderedRows: ComputedRef<number>
  /** 아직 그리지 않은 묶음 (전체 · 한 곡) 또는 줄 (최근). 검색 중에는 0 — 대신 `truncated`. */
  remaining: ComputedRef<number>
  /** 검색 결과가 상한(200줄)을 넘어 잘렸다. */
  truncated: ComputedRef<boolean>

  setView(view: Exclude<MomentsArchiveView, 'video'>): void
  /** 한 곡의 Moments 만 본다 (음악 탭의 곡 행 배지 · 대시보드 "이 곡 모두 보기"). 검색어는 지운다. */
  focusVideo(videoId: string): void
  /** 입력을 기다리지 않고 지금 검색한다 (Enter · 지우기). */
  applyQueryNow(): void
  clearQuery(): void
  isExpanded(videoId: string): boolean
  toggleGroup(videoId: string): void
  /** 다음 묶음 30개 (최근 보기는 다음 50줄). 더 그린 수를 돌려준다. */
  showMore(): number
  /** 펼친 묶음 안의 다음 50줄. */
  showMoreRows(videoId: string): void
  /** 음악 탭의 그 목록 · 그 곡으로 간다. 목록을 고르지 못하면 안내만 하고 `false`. */
  openInLibrary(playlistId: string, videoId: string): Promise<boolean>
}

const SELECT_REFUSED = {
  conflict: '다른 탭에서 라이브러리가 바뀌어 최신 목록을 불러왔어요. 다시 눌러 주세요.',
  busy: '다른 39page 탭이 저장하는 중이라 목록을 열지 못했어요. 잠시 뒤 다시 눌러 주세요.',
  missing: '그 목록을 찾을 수 없어요. 이미 지워졌을 수 있어요.',
} as const

export function useMomentsArchive(): MomentsArchiveModel {
  const browser = useMomentsBrowser()
  const moments = useMomentsStore()
  const library = useLibraryStore()
  const archive = inject(ARCHIVE, null)

  /** 사용자가 고른 보기. `null` 이면 자동. 세션(이 페이지) 동안 탭을 오가도 남는다. */
  const chosenView = ref<MomentsArchiveView | null>(null)
  /**
   * 자동 보기 — **Moments 에 들어올 때** 정한다: 지금 곡이 있으면 이 곡, 없으면 전체.
   * 보는 동안 재생이 시작돼도(전체에서 ▶ 를 눌렀다) 보기를 바꾸지 않는다 — 누르던 목록이 사라지면 안 된다.
   * 재생 중인 곡이 없어지면 이 곡은 비므로 전체로 간다.
   */
  const autoView = ref<'current' | 'all'>(browser.currentVideoId.value !== null ? 'current' : 'all')
  const view = computed<MomentsArchiveView>(() => chosenView.value ?? autoView.value)

  function resolveAutoView(): void {
    autoView.value = browser.currentVideoId.value !== null ? 'current' : 'all'
  }

  watch(
    () => archive !== null && archive.isOpen.value && archive.tab.value === 'moments',
    (entered) => {
      if (entered) resolveAutoView()
    },
  )
  watch(
    () => browser.currentVideoId.value,
    (videoId) => {
      if (videoId === null) autoView.value = 'all'
    },
  )
  const focusVideoId = ref<string | null>(null)

  /* ── 검색 (150ms 뒤 적용) ────────────────────────────────────────── */
  const query = ref('')
  const appliedQuery = ref('')
  let timer: ReturnType<typeof setTimeout> | null = null

  function cancelTimer(): void {
    if (timer !== null) clearTimeout(timer)
    timer = null
  }

  function applyQueryNow(): void {
    cancelTimer()
    appliedQuery.value = query.value
  }

  watch(query, (now) => {
    cancelTimer()
    // 지우면 기다리지 않는다 — 목록이 바로 돌아온다.
    if (now.trim() === '') {
      appliedQuery.value = now
      return
    }
    timer = setTimeout(() => {
      timer = null
      appliedQuery.value = query.value
    }, SEARCH_DEBOUNCE_MS)
  })
  onScopeDispose(cancelTimer)

  function clearQuery(): void {
    query.value = ''
    applyQueryNow()
  }

  const terms = computed<string[]>(() => searchTerms(appliedQuery.value))
  const searching = computed<boolean>(() => terms.value.length > 0)

  /* ── 파생 데이터 (데이터가 바뀔 때만 다시 만든다) ─────────────────── */
  const index = computed(() => buildSearchIndex(browser.allGroups.value))
  const matchedIds = computed(() => searchMoments(index.value, terms.value))
  const playlistIndex = computed(() => playlistsByVideo(library.playlists))
  const titleByVideo = computed(() => {
    const titles = new Map<string, string>()
    for (const group of browser.allGroups.value) titles.set(group.videoId, group.title)
    return titles
  })
  const recent = computed(() => recentMoments(moments.moments))

  const focusTitle = computed<string | null>(() =>
    focusVideoId.value === null ? null : (titleByVideo.value.get(focusVideoId.value) ?? null),
  )

  /* ── 접기 · 점진 표시 (화면 상태) ─────────────────────────────────── */
  /** 사용자가 머리를 눌러 정한 펼침. 둘러보기와 검색 결과를 따로 기억한다. */
  const browseOverrides = reactive(new Map<string, boolean>())
  const searchOverrides = reactive(new Map<string, boolean>())
  const groupLimit = ref(GROUP_PAGE_SIZE)
  const recentLimit = ref(RECENT_PAGE_SIZE)
  /** 이 곡 보기의 줄 상한 — 한 곡에 순간이 많아도 한 번에 다 그리지 않는다. */
  const currentLimit = ref(GROUP_ROW_PAGE_SIZE)
  const rowLimits = reactive(new Map<string, number>())

  watch([view, focusVideoId, appliedQuery, () => browser.currentVideoId.value], () => {
    groupLimit.value = GROUP_PAGE_SIZE
    recentLimit.value = RECENT_PAGE_SIZE
    currentLimit.value = GROUP_ROW_PAGE_SIZE
    rowLimits.clear()
  })

  /** 이 곡 보기의 (검색에 맞는) 순간 — 시점 순. */
  const currentRows = computed(() => {
    const entry = visibleGroups.value[0]
    return view.value === 'current' && entry !== undefined ? entry.moments : []
  })
  watch(appliedQuery, () => searchOverrides.clear())

  /** 보기에 들어가는 묶음과 그 안의 (검색에 맞는) Moment. */
  const visibleGroups = computed(() => {
    const groups = browser.allGroups.value
    const base =
      view.value === 'current'
        ? groups.filter((group) => group.videoId === browser.currentVideoId.value)
        : view.value === 'video'
          ? groups.filter((group) => group.videoId === focusVideoId.value)
          : groups
    const matched = matchedIds.value
    if (matched === null) return base.map((group) => ({ group, moments: group.moments }))
    const out = []
    for (const group of base) {
      const hits = group.moments.filter((moment) => matched.has(moment.id))
      if (hits.length > 0) out.push({ group, moments: hits })
    }
    return out
  })

  const recentRows = computed(() => {
    const matched = matchedIds.value
    return matched === null ? recent.value : recent.value.filter((m) => matched.has(m.id))
  })

  function expandedAt(videoId: string, position: number, groupCount: number): boolean {
    const override = (searching.value ? searchOverrides : browseOverrides).get(videoId)
    if (override !== undefined) return override
    return defaultExpanded({
      view: view.value,
      searching: searching.value,
      groupCount,
      position,
      isCurrent: videoId === browser.currentVideoId.value,
    })
  }

  function isExpanded(videoId: string): boolean {
    const groups = visibleGroups.value
    const position = groups.findIndex((entry) => entry.group.videoId === videoId)
    return position !== -1 && expandedAt(videoId, position, groups.length)
  }

  const sections = computed<ArchiveSection[]>(() => {
    if (view.value === 'recent') {
      const limit = searching.value ? SEARCH_ROW_LIMIT : recentLimit.value
      const titles = titleByVideo.value
      const rows = recentRows.value.slice(0, limit).map((moment) => ({
        moment,
        songTitle: titles.get(moment.videoId) ?? moment.videoId,
      }))
      return rows.length === 0
        ? []
        : [{ key: 'recent', head: null, showSongTitle: true, rows, hiddenRows: 0 }]
    }

    // 이 곡 — 묶음 머리 없이 한 목록, 줄에 곡 제목을 적지 않는다. 제목은 단추 이름(aria)에만 쓴다.
    if (view.value === 'current') {
      const entry = visibleGroups.value[0]
      if (entry === undefined) return []
      const limit = searching.value ? SEARCH_ROW_LIMIT : currentLimit.value
      const rows = entry.moments
        .slice(0, limit)
        .map((moment) => ({ moment, songTitle: entry.group.title }))
      return [{ key: 'current', head: null, showSongTitle: false, rows, hiddenRows: 0 }]
    }

    const groups = visibleGroups.value
    const playlists = playlistIndex.value
    const shownGroups = searching.value ? groups : groups.slice(0, groupLimit.value)
    let budget = searching.value ? SEARCH_ROW_LIMIT : Number.POSITIVE_INFINITY
    const out: ArchiveSection[] = []

    shownGroups.forEach(({ group, moments: hits }, position) => {
      if (budget <= 0) return
      const expanded = expandedAt(group.videoId, position, groups.length)
      let rows: ArchiveRow[] = []
      let hiddenRows = 0
      if (expanded) {
        // 검색 중에는 묶음 안 점진 표시를 하지 않는다 — 결과 전체의 상한(200줄)만 둔다.
        const limit = searching.value
          ? budget
          : (rowLimits.get(group.videoId) ?? GROUP_ROW_PAGE_SIZE)
        rows = hits.slice(0, limit).map((moment) => ({ moment, songTitle: group.title }))
        hiddenRows = hits.length - rows.length
        budget -= rows.length
      }
      out.push({
        key: group.videoId,
        head: {
          videoId: group.videoId,
          title: group.title,
          titleSource: group.titleSource,
          total: group.moments.length,
          matched: hits.length,
          isCurrent: group.videoId === browser.currentVideoId.value,
          playlists: playlists.get(group.videoId) ?? [],
          expanded,
        },
        rows,
        hiddenRows,
      })
    })
    return out
  })

  const matchedMoments = computed<number>(() =>
    view.value === 'recent'
      ? recentRows.value.length
      : visibleGroups.value.reduce((sum, entry) => sum + entry.moments.length, 0),
  )
  const matchedSongs = computed<number>(() =>
    view.value === 'recent'
      ? new Set(recentRows.value.map((m) => m.videoId)).size
      : visibleGroups.value.length,
  )
  const renderedRows = computed<number>(() =>
    sections.value.reduce((sum, section) => sum + section.rows.length, 0),
  )
  const remaining = computed<number>(() => {
    if (searching.value) return 0
    if (view.value === 'recent') return Math.max(0, recentRows.value.length - recentLimit.value)
    if (view.value === 'current') return Math.max(0, currentRows.value.length - currentLimit.value)
    return Math.max(0, visibleGroups.value.length - groupLimit.value)
  })
  const truncated = computed<boolean>(() => {
    if (!searching.value) return false
    // 접어 둔 묶음은 사용자가 고른 것이다 — 상한 때문에 못 그린 줄만 센다.
    const shownOrFolded = sections.value.reduce(
      (sum, section) =>
        sum +
        (section.head === null || section.head.expanded
          ? section.rows.length
          : section.head.matched),
      0,
    )
    return shownOrFolded < matchedMoments.value
  })

  function setView(next: Exclude<MomentsArchiveView, 'video'>): void {
    focusVideoId.value = null
    chosenView.value = next
  }

  /** 지금 곡이면 "이 곡" 보기(관리 화면)로, 다른 곡이면 그 곡만 보는 보기로. 검색어는 지운다. */
  function focusVideo(videoId: string): void {
    clearQuery()
    if (videoId === browser.currentVideoId.value) {
      focusVideoId.value = null
      chosenView.value = 'current'
      return
    }
    focusVideoId.value = videoId
    chosenView.value = 'video'
  }

  function toggleGroup(videoId: string): void {
    const overrides = searching.value ? searchOverrides : browseOverrides
    overrides.set(videoId, !isExpanded(videoId))
  }

  function showMore(): number {
    const before = remaining.value
    if (before === 0) return 0
    if (view.value === 'recent') recentLimit.value += RECENT_PAGE_SIZE
    else if (view.value === 'current') currentLimit.value += GROUP_ROW_PAGE_SIZE
    else groupLimit.value += GROUP_PAGE_SIZE
    return before - remaining.value
  }

  function showMoreRows(videoId: string): void {
    rowLimits.set(videoId, (rowLimits.get(videoId) ?? GROUP_ROW_PAGE_SIZE) + GROUP_ROW_PAGE_SIZE)
  }

  async function openInLibrary(playlistId: string, videoId: string): Promise<boolean> {
    browser.clearFeedback()
    if (library.selectedPlaylistId !== playlistId) {
      const result = await library.selectPlaylist(playlistId)
      if (!result.ok) {
        browser.warn(
          result.reason === 'conflict'
            ? SELECT_REFUSED.conflict
            : result.reason === 'busy'
              ? SELECT_REFUSED.busy
              : SELECT_REFUSED.missing,
        )
        return false
      }
    }
    archive?.open('music', { revealVideoId: videoId })
    return true
  }

  return {
    browser,
    view: view as Readonly<Ref<MomentsArchiveView>>,
    focusVideoId,
    focusTitle,
    query,
    terms,
    searching,
    sections,
    matchedMoments,
    matchedSongs,
    renderedRows,
    remaining,
    truncated,
    setView,
    focusVideo,
    applyQueryNow,
    clearQuery,
    isExpanded,
    toggleGroup,
    showMore,
    showMoreRows,
    openInLibrary,
  }
}
