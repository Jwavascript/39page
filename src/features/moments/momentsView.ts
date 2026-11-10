/**
 * Moments 화면을 위한 **순수** 계층 (M9-4).
 *
 * store 도 DOM 도 모른다. 저장된 Moment 와 라이브러리의 제목 표를 받아
 * 화면이 그릴 모양을 돌려준다. 그래서 테스트가 고정값으로 전부 확인할 수 있다.
 *
 * 정한 것 (`MOMENTS_DESIGN.md` §1-1 · ADR 0019 결정 2·5 · ADR 0021):
 *
 * - **표시 제목 3단** — 라이브러리의 현재 제목 → 저장 당시 스냅샷 →
 *   `YouTube · <videoId>`. 마지막 줄은 트랙과 **같은** 대체 표기다.
 * - **영상별로 묶는다.** 영상은 가장 최근에 만든 Moment 순, 영상 안에서는
 *   시점 오름차순. 저장 배열은 추가 순서 그대로다 — 정렬은 여기서만 한다.
 * - 같은 영상 · 같은 시점의 Moment 를 **합치지 않는다.** 메모가 다를 수 있다.
 */
import type { Moment } from '@/shared/types'
import { defaultTrackTitle } from '@/stores/library'

/** 시간 표기. YouTube 플레이어와 같은 모양이다 — `0:42` · `12:05` · `1:02:03`. */
export function formatMomentTime(seconds: number): string {
  // store 를 지난 값은 이미 0 이상 정수다. 그래도 표시가 거짓말을 하지 않게 막는다.
  if (!Number.isFinite(seconds) || seconds < 0) return '--:--'

  const total = Math.floor(seconds)
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const secs = String(total % 60).padStart(2, '0')

  return hours > 0
    ? `${String(hours)}:${String(minutes).padStart(2, '0')}:${secs}`
    : `${String(minutes)}:${secs}`
}

/** 라이브러리에서 제목을 찾는 데 필요한 모양만 받는다. */
export interface TitleSourcePlaylist {
  readonly id: string
  readonly tracks: ReadonlyArray<{ readonly videoId: string; readonly title: string }>
}

/**
 * 영상 ID → 라이브러리의 **현재** 제목.
 *
 * 같은 영상이 여러 목록에 이름을 달리해 들어 있을 수 있다. **선택된 목록을
 * 먼저**, 그다음 라이브러리 순서로 보고 처음 만난 제목을 쓴다. Moment 재생이
 * 큐를 고르는 순서(`MOMENTS_DESIGN.md` §4-5)와 같다 — 목록에 보이는 이름과
 * 눌러서 재생되는 트랙의 이름이 같아진다.
 */
export function libraryTitleIndex(
  playlists: ReadonlyArray<TitleSourcePlaylist>,
  selectedPlaylistId: string | null,
): Map<string, string> {
  const selected = playlists.find((playlist) => playlist.id === selectedPlaylistId)
  const ordered =
    selected === undefined ? playlists : [selected, ...playlists.filter((p) => p !== selected)]

  const titles = new Map<string, string>()
  for (const playlist of ordered) {
    for (const track of playlist.tracks) {
      if (!titles.has(track.videoId)) titles.set(track.videoId, track.title)
    }
  }
  return titles
}

/** 제목이 어디서 왔는지. 화면이 "목록에 없음" 을 알릴 때 쓴다. */
export type MomentTitleSource = 'library' | 'snapshot' | 'fallback'

export interface ResolvedMomentTitle {
  title: string
  source: MomentTitleSource
}

/**
 * 표시 제목 3단 (`MOMENTS_DESIGN.md` §1-1).
 *
 * 조회는 **표시 시점의 파생값**이고 저장하지 않는다. 저장하면 라이브러리를
 * 고칠 때마다 Moments 키를 다시 써야 한다 — 두 키가 서로를 쓰게 된다.
 */
export function resolveMomentTitle(
  videoId: string,
  libraryTitle: string | undefined,
  snapshot: string,
): ResolvedMomentTitle {
  if (libraryTitle !== undefined && libraryTitle.trim() !== '') {
    return { title: libraryTitle, source: 'library' }
  }
  const trimmed = snapshot.trim()
  if (trimmed !== '') return { title: trimmed, source: 'snapshot' }

  // 트랙의 `normalizeTitle` 과 같은 대체 표기다. 새 규칙을 만들지 않는다.
  return { title: defaultTrackTitle(videoId), source: 'fallback' }
}

/** 한 영상의 Moment 묶음. */
export interface MomentGroup {
  videoId: string
  title: string
  titleSource: MomentTitleSource
  /** 시점 오름차순. */
  moments: ReadonlyArray<Readonly<Moment>>
}

interface Ranked {
  moment: Readonly<Moment>
  index: number
  created: number
}

/** 해석하지 못하는 날짜는 가장 오래된 것으로 본다. 버리지 않는다 (ADR 0019 결정 9). */
function createdKey(createdAt: string): number {
  const parsed = Date.parse(createdAt)
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY
}

/** 큰 것이 앞. `-Infinity` 끼리 빼면 `NaN` 이 되므로 직접 비교한다. */
function descending(a: number, b: number): number {
  if (a === b) return 0
  return a > b ? -1 : 1
}

function ascending(a: number, b: number): number {
  return -descending(a, b)
}

/** 더 최근인가. 만든 시각이 같거나 둘 다 해석 불가면 **나중에 추가된** 쪽이다. */
function isNewer(a: Ranked, b: Ranked): boolean {
  if (a.created !== b.created) return a.created > b.created
  return a.index > b.index
}

/**
 * 영상별로 묶고 정렬한다.
 *
 * - 영상 순서: 그 영상의 **가장 최근에 만든** Moment 가 최근인 순. 메모를
 *   고쳐도(`updatedAt`) 순서가 바뀌지 않는다 — 고치는 동안 줄이 튀지 않게 한다
 * - 영상 안: `atSeconds` 오름차순. 같은 시점이면 먼저 만든 것이 앞
 * - 같은 시점의 Moment 를 **합치지 않는다**
 */
export function groupMoments(
  moments: ReadonlyArray<Readonly<Moment>>,
  libraryTitles: ReadonlyMap<string, string>,
): MomentGroup[] {
  const byVideo = new Map<string, { items: Ranked[]; latest: Ranked }>()

  moments.forEach((moment, index) => {
    const ranked: Ranked = { moment, index, created: createdKey(moment.createdAt) }
    const entry = byVideo.get(moment.videoId)
    if (entry === undefined) {
      byVideo.set(moment.videoId, { items: [ranked], latest: ranked })
      return
    }
    entry.items.push(ranked)
    if (isNewer(ranked, entry.latest)) entry.latest = ranked
  })

  const entries = [...byVideo.entries()].sort(
    ([, a], [, b]) =>
      descending(a.latest.created, b.latest.created) || descending(a.latest.index, b.latest.index),
  )

  return entries.map(([videoId, { items }]) => {
    const sorted = [...items].sort(
      (a, b) =>
        ascending(a.moment.atSeconds, b.moment.atSeconds) ||
        ascending(a.created, b.created) ||
        ascending(a.index, b.index),
    )

    // 스냅샷은 **가장 최근에 만든** Moment 의 것을 쓴다 — 마지막으로 알던 이름이다.
    const newestFirst = [...items].sort((a, b) => (isNewer(a, b) ? -1 : isNewer(b, a) ? 1 : 0))
    const snapshot = newestFirst.find((item) => item.moment.title.trim() !== '')?.moment.title ?? ''

    const resolved = resolveMomentTitle(videoId, libraryTitles.get(videoId), snapshot)
    return {
      videoId,
      title: resolved.title,
      titleSource: resolved.source,
      moments: sorted.map((item) => item.moment),
    }
  })
}

/** 메모의 첫 줄. 목록 한 줄에는 첫 줄만 보인다 (F14). */
export function firstLine(note: string): string {
  return note.split(/\r?\n/, 1)[0]?.trim() ?? ''
}
