/**
 * Moments 목록의 뷰 모델 (M9-4, F14 · F15 · F16).
 *
 * 세 곳을 읽고 두 곳에 명령한다.
 *
 *   읽기   Moments store (목록) · Library store (현재 제목) · Playback store (지금 곡)
 *   명령   Moments store (메모 수정 · 삭제) · Playback Coordinator (Moment 재생)
 *
 * **라이브러리를 고치지 않는다.** 제목을 빌려 읽기만 한다. Moment 를 지워도
 * 트랙은 그대로이고, 트랙을 지워도 Moment 는 그대로다 (ADR 0019).
 *
 * Moment 재생은 다른 재생 표면과 **같은 길**을 쓴다 (`MUSIC_MOMENTS.md` F15).
 * 세로 화면의 시트가 플레이어를 덮고 있으면 먼저 비켜달라고 하고
 * (`stepAside`, M7-2), 그래도 가려져 있으면 코디네이터의 가시성 가드가
 * 거절한다 (ADR 0011). 가드를 건너뛰는 경로를 만들지 않는다.
 */
import { computed, inject, readonly, ref, type ComputedRef, type Ref } from 'vue'

import { LIBRARY_DRAWER } from '@/features/library/drawerController'
import {
  PLAYBACK_COORDINATOR,
  PLAY_REFUSED_HIDDEN_MESSAGE,
  type MomentPlayFailure,
} from '@/features/playback/playbackCoordinator'
import { useLibraryStore } from '@/stores/library'
import { MAX_MOMENT_NOTE_LENGTH, useMomentsStore } from '@/stores/moments'
import { usePlaybackStore } from '@/stores/playback'

import { info, unsavedReason, warning, type MomentFeedback } from './momentFeedback'
import { groupMoments, libraryTitleIndex, type MomentGroup } from './momentsView'

/** `전체` 또는 `이 곡`. 저장하지 않는 화면 상태다. */
export type MomentsFilter = 'all' | 'current'

/**
 * 재생 거절 안내.
 *
 * `player-hidden` 은 드로어·플레이리스트 위젯·데크와 **같은 문구**다 (M7-1).
 * 같은 사정을 다른 말로 하면 사용자가 두 가지 문제로 읽는다.
 *
 * 목록·트랙 관련 이유는 `playMoment` 가 돌려주지 않지만, 유니온에 들어 있으므로
 * 표가 비지 않게 채운다.
 */
const PLAY_REFUSED: Readonly<Record<MomentPlayFailure, string>> = {
  'player-hidden': PLAY_REFUSED_HIDDEN_MESSAGE,
  'invalid-moment': '이 순간의 정보가 올바르지 않아 재생할 수 없어요.',
  'player-unavailable': '플레이어가 아직 준비되지 않았어요. 잠시 뒤 다시 눌러주세요.',
  'playlist-not-found': '재생할 대상을 찾을 수 없어요.',
  'empty-playlist': '재생할 대상을 찾을 수 없어요.',
  'track-not-found': '재생할 대상을 찾을 수 없어요.',
}

const NOT_FOUND = '이 순간을 찾을 수 없어요. 이미 지워졌을 수 있어요.'

export interface MomentsBrowserModel {
  total: ComputedRef<number>
  /** 지금 재생 중인 영상. 없으면 `null`. */
  currentVideoId: ComputedRef<string | null>
  /** 지금 영상의 Moment 수. */
  currentCount: ComputedRef<number>

  filter: Ref<MomentsFilter>
  /** 필터를 적용한 묶음. */
  groups: ComputedRef<MomentGroup[]>

  feedback: Readonly<Ref<MomentFeedback | null>>

  /** Moment 의 지점부터 재생한다. 시트를 비켜준 뒤 요청하므로 비동기다. */
  play(momentId: string): Promise<void>
  /** 메모를 고친다. 폼을 닫아도 되면 `true`. */
  saveNote(momentId: string, note: string): boolean
  /** 한 건을 지운다. **확인은 화면이 먼저 받는다.** */
  remove(momentId: string): void
  clearFeedback(): void
}

export function useMomentsBrowser(): MomentsBrowserModel {
  const moments = useMomentsStore()
  const library = useLibraryStore()
  const playback = usePlaybackStore()

  /** 주입되지 않으면 재생을 요청하지 않는다 (단독 마운트 테스트). */
  const coordinator = inject(PLAYBACK_COORDINATOR, null)
  /** 주입되지 않으면 비켜달라고 하지 않는다. */
  const drawer = inject(LIBRARY_DRAWER, null)

  const filter = ref<MomentsFilter>('all')
  const feedback = ref<MomentFeedback | null>(null)

  const total = computed<number>(() => moments.count)
  const currentVideoId = computed<string | null>(() => playback.currentTrack?.videoId ?? null)
  const currentCount = computed<number>(
    () => moments.moments.filter((moment) => moment.videoId === currentVideoId.value).length,
  )

  const titles = computed(() => libraryTitleIndex(library.playlists, library.selectedPlaylistId))
  const allGroups = computed<MomentGroup[]>(() => groupMoments(moments.moments, titles.value))

  const groups = computed<MomentGroup[]>(() =>
    filter.value === 'current'
      ? allGroups.value.filter((group) => group.videoId === currentVideoId.value)
      : allGroups.value,
  )

  async function play(momentId: string): Promise<void> {
    feedback.value = null

    const moment = moments.getMoment(momentId)
    if (moment === undefined) {
      feedback.value = warning(NOT_FOUND)
      return
    }
    // 기다리는 동안 무엇이 바뀌어도 누른 Moment 의 값으로 요청한다.
    const target = { videoId: moment.videoId, atSeconds: moment.atSeconds, title: moment.title }

    // 세로 화면의 시트가 플레이어를 덮고 있으면 먼저 비켜준다 (M7-2).
    await drawer?.stepAside()

    if (coordinator === null) {
      feedback.value = warning('플레이어가 연결되지 않아 재생할 수 없어요.')
      return
    }

    const result = coordinator.playMoment(target)
    feedback.value = result.ok ? null : warning(PLAY_REFUSED[result.reason])
  }

  function saveNote(momentId: string, note: string): boolean {
    if (note.length > MAX_MOMENT_NOTE_LENGTH) {
      feedback.value = warning(`메모는 ${String(MAX_MOMENT_NOTE_LENGTH)}자까지 쓸 수 있어요.`)
      return false
    }

    const result = moments.updateNote(momentId, note)
    if (!result.ok) {
      feedback.value = warning(NOT_FOUND)
      return true
    }

    feedback.value = result.persisted
      ? info('메모를 고쳤어요.')
      : warning(
          `메모를 고쳤지만 이 브라우저에 저장하지 못했어요. ${unsavedReason(moments)} 새로고침하면 이전 메모로 돌아갑니다.`,
        )
    return true
  }

  function remove(momentId: string): void {
    const result = moments.remove(momentId)
    if (!result.ok) {
      feedback.value = warning(NOT_FOUND)
      return
    }

    feedback.value = result.persisted
      ? info('순간을 지웠어요.')
      : warning(
          `목록에서 지웠지만 이 브라우저에 저장하지 못했어요. ${unsavedReason(moments)} 새로고침하면 다시 나타납니다.`,
        )
  }

  function clearFeedback(): void {
    feedback.value = null
  }

  return {
    total,
    currentVideoId,
    currentCount,
    filter,
    groups,
    feedback: readonly(feedback) as Readonly<Ref<MomentFeedback | null>>,
    play,
    saveNote,
    remove,
    clearFeedback,
  }
}
