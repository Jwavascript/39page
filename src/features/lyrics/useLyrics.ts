/**
 * 지금 곡의 가사 (ADR 0046) — 곡이 바뀌면 LRCLIB 에서 찾고, 재생 위치에 맞춰 지금 줄을 고른다.
 *
 * - 찾기: 직접 고른 가사(영상별 id)가 있으면 그것, 없으면 제목 검색어(`lyricsQueries`)로 찾아 곡 길이 · 제목으로
 *   고른다(`pickLyrics`). 결과는 이 탭에서 영상별로 기억한다 — 같은 곡을 다시 틀어도 다시 묻지 않는다.
 * - 곡을 빠르게 넘기는 동안에는 묻지 않는다(잠깐 기다린 뒤 한 번). 곡이 바뀌면 진행 중인 요청을 거둔다.
 * - 위치: 재생 중에만 0.25초마다 코디네이터에게 묻는다(`captureClock`). 표시용이다.
 * - LRCLIB 가 쉬라고 하면(429) 그 시간이 지난 뒤 한 번 다시 찾는다.
 *
 * 재생을 바꾸지 않는다 — 읽기만 한다 (AGENTS 규칙 4).
 */
import { computed, inject, onScopeDispose, ref, shallowRef, watch, type InjectionKey } from 'vue'

import { PLAYBACK_COORDINATOR } from '@/features/playback/playbackCoordinator'
import { usePlaybackStore } from '@/stores/playback'

import { activeLineIndex, parseSyncedLyrics, plainLyricLines, type LyricLine } from './lrc'
import { createLrclibClient, type LrclibClient, type LyricsRecord } from './lrclibClient'
import { lyricsChoicesStorage, withPick, withoutPick } from './lyricsChoices'
import { hasLyrics, lyricsQueries, matchScore, pickLyrics } from './matchLyrics'

/** 시험이 가짜 클라이언트를 넣는다. 없으면 앱 전체가 함께 쓰는 하나(요청 간격 · 쉬기를 함께 지킨다). */
export const LYRICS_CLIENT: InjectionKey<LrclibClient> = Symbol('39page.lyrics-client')

/** 곡이 바뀐 뒤 묻기까지 기다리는 시간 — 빠르게 넘기는 동안 요청을 보내지 않는다. */
export const LYRICS_SETTLE_MS = 700
/** 곡 길이를 기다리는 한도. 넘으면 길이 없이 찾는다. */
export const DURATION_WAIT_MS = 4000
export const CLOCK_POLL_MS = 250
/** 줄을 조금 일찍 밝힌다 — 읽기 시작할 틈. */
const LEAD_SECONDS = 0.25

export type LyricsStatus = 'idle' | 'searching' | 'ready' | 'not-found' | 'rate-limited' | 'error'

let sharedClient: LrclibClient | null = null
/** 영상별 찾은 결과 (이 탭에서만). `null` 은 "찾아봤지만 없음". */
const found = new Map<string, LyricsRecord | null>()

/** 시험용 — 탭 기억을 비운다. */
export function resetLyricsCache(): void {
  found.clear()
  sharedClient = null
}

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms)
    signal.addEventListener('abort', () => {
      clearTimeout(timer)
      resolve()
    })
  })

export function useLyrics() {
  const playback = usePlaybackStore()
  const coordinator = inject(PLAYBACK_COORDINATOR, null)
  const client = inject(LYRICS_CLIENT, null) ?? (sharedClient ??= createLrclibClient())

  const status = ref<LyricsStatus>('idle')
  const record = shallowRef<LyricsRecord | null>(null)
  /** 지금 가사가 사용자가 고른 것인가. */
  const picked = ref(false)
  const seconds = ref<number | null>(null)

  const lines = computed<LyricLine[]>(() =>
    record.value?.syncedLyrics == null ? [] : parseSyncedLyrics(record.value.syncedLyrics),
  )
  const plain = computed<string[]>(() =>
    lines.value.length > 0 || record.value?.plainLyrics == null
      ? []
      : plainLyricLines(record.value.plainLyrics),
  )
  const instrumental = computed(
    () => record.value !== null && record.value.instrumental && lines.value.length === 0,
  )
  const active = computed(() =>
    seconds.value === null ? -1 : activeLineIndex(lines.value, seconds.value + LEAD_SECONDS),
  )

  let controller: AbortController | null = null
  let settleTimer: ReturnType<typeof setTimeout> | null = null
  let retryTimer: ReturnType<typeof setTimeout> | null = null

  async function waitForDuration(videoId: string, signal: AbortSignal): Promise<number | null> {
    const until = Date.now() + DURATION_WAIT_MS
    while (!signal.aborted) {
      const clock = coordinator?.captureClock() ?? null
      if (clock !== null && clock.videoId === videoId && clock.duration !== null)
        return clock.duration
      if (coordinator === null || Date.now() >= until) return null
      await sleep(500, signal)
    }
    return null
  }

  function failed(reason: 'not-found' | 'rate-limited' | 'network' | 'bad-response'): void {
    if (reason === 'rate-limited') {
      status.value = 'rate-limited'
      const until = client.blockedUntil()
      if (retryTimer !== null) clearTimeout(retryTimer)
      retryTimer = setTimeout(() => void lookup(), Math.max(1000, until - Date.now() + 500))
      return
    }
    status.value = reason === 'not-found' ? 'not-found' : 'error'
  }

  /** 지금 곡의 가사를 찾는다. */
  async function lookup(): Promise<void> {
    controller?.abort()
    if (retryTimer !== null) clearTimeout(retryTimer)
    retryTimer = null
    const track = playback.currentTrack
    record.value = null
    picked.value = false
    if (track === null) {
      status.value = 'idle'
      return
    }
    const own = new AbortController()
    controller = own
    const { videoId, title } = track
    status.value = 'searching'

    const pick = lyricsChoicesStorage.read().value.picks[videoId]
    if (pick !== undefined) {
      const result = await client.get(pick.id, own.signal)
      if (own.signal.aborted) return
      if (!result.ok) {
        failed(result.reason)
        return
      }
      record.value = result.value
      picked.value = true
      status.value = 'ready'
      return
    }

    if (found.has(videoId)) {
      const known = found.get(videoId) ?? null
      record.value = known
      status.value = known === null ? 'not-found' : 'ready'
      return
    }

    const duration = await waitForDuration(videoId, own.signal)
    if (own.signal.aborted) return
    let best: LyricsRecord | null = null
    for (const q of lyricsQueries(title)) {
      const result = await client.search({ q }, own.signal)
      if (own.signal.aborted) return
      if (!result.ok) {
        failed(result.reason)
        return
      }
      best = pickLyrics(result.value, { title, duration })
      if (best !== null) break
    }
    found.set(videoId, best)
    record.value = best
    status.value = best === null ? 'not-found' : 'ready'
  }

  watch(
    () => playback.currentTrack?.videoId ?? null,
    () => {
      controller?.abort()
      if (settleTimer !== null) clearTimeout(settleTimer)
      seconds.value = null
      record.value = null
      status.value = playback.currentTrack === null ? 'idle' : 'searching'
      if (playback.currentTrack === null) return
      settleTimer = setTimeout(() => void lookup(), LYRICS_SETTLE_MS)
    },
    { immediate: true },
  )

  /* ---------------------------------------------------------------- *
   * 위치
   * ---------------------------------------------------------------- */

  let clockTimer: ReturnType<typeof setInterval> | null = null
  function readClock(): void {
    const clock = coordinator?.captureClock() ?? null
    const videoId = playback.currentTrack?.videoId ?? null
    seconds.value = clock !== null && clock.videoId === videoId ? clock.seconds : seconds.value
  }
  watch(
    () => [playback.isPlaying, lines.value.length > 0] as const,
    ([playing, hasLines]) => {
      if (clockTimer !== null) clearInterval(clockTimer)
      clockTimer = null
      if (!hasLines) return
      readClock()
      if (playing && coordinator !== null) clockTimer = setInterval(readClock, CLOCK_POLL_MS)
    },
    { immediate: true },
  )

  /* ---------------------------------------------------------------- *
   * 직접 찾기
   * ---------------------------------------------------------------- */

  const results = shallowRef<LyricsRecord[]>([])
  const searchStatus = ref<'idle' | 'searching' | 'done' | 'rate-limited' | 'error'>('idle')

  async function searchManually(query: string): Promise<void> {
    const q = query.trim()
    if (q === '') return
    searchStatus.value = 'searching'
    const result = await client.search({ q })
    if (!result.ok) {
      results.value = []
      searchStatus.value = result.reason === 'rate-limited' ? 'rate-limited' : 'error'
      return
    }
    const track = playback.currentTrack
    const duration = coordinator?.captureClock()?.duration ?? null
    const target = { title: track?.title ?? '', duration }
    // 쓸 가사가 있는 것만, 이 곡과 맞아 보이는 것 먼저.
    results.value = result.value
      .filter(hasLyrics)
      .map((item, index) => ({ item, index, score: matchScore(item, target) ?? -1000 }))
      .sort((a, b) => b.score - a.score || a.index - b.index)
      .slice(0, 12)
      .map(({ item }) => item)
    searchStatus.value = 'done'
  }

  function choose(choice: LyricsRecord): boolean {
    const track = playback.currentTrack
    if (track === null) return false
    controller?.abort()
    const label = [choice.trackName, choice.artistName].filter((part) => part !== '').join(' · ')
    const write = lyricsChoicesStorage.write(
      withPick(lyricsChoicesStorage.read().value, track.videoId, { id: choice.id, label }),
    )
    found.set(track.videoId, choice)
    record.value = choice
    picked.value = true
    status.value = 'ready'
    results.value = []
    searchStatus.value = 'idle'
    return write.ok
  }

  /** 고른 것을 지우고 자동으로 다시 찾는다. */
  function clearChoice(): void {
    const track = playback.currentTrack
    if (track === null) return
    lyricsChoicesStorage.write(withoutPick(lyricsChoicesStorage.read().value, track.videoId))
    found.delete(track.videoId)
    void lookup()
  }

  onScopeDispose(() => {
    controller?.abort()
    if (settleTimer !== null) clearTimeout(settleTimer)
    if (retryTimer !== null) clearTimeout(retryTimer)
    if (clockTimer !== null) clearInterval(clockTimer)
  })

  return {
    status,
    record,
    picked,
    lines,
    plain,
    instrumental,
    active,
    seconds,
    results,
    searchStatus,
    retry: () => void lookup(),
    searchManually,
    choose,
    clearChoice,
  }
}
