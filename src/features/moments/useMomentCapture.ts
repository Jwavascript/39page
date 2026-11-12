/**
 * "＋ 이 순간 저장" 의 뷰 모델 — **빠른 저장** (M9-4 F13, M11-3 에서 바꿨다 · D2 결정).
 *
 * 두 계층을 **조립만** 한다 (`AGENTS.md` 규칙 2·4).
 *
 *   Playback Coordinator   지금 몇 초인가 — `capturePosition()`
 *   Moments store          그것을 저장한다 — `add()` · `updateNote()`
 *
 * 코디네이터는 저장을 모르고, store 는 재생을 모른다. 둘을 잇는 것이 여기다.
 * `PlayerAdapter` 도 YouTube API 도 부르지 않는다.
 *
 * M9 는 누르면 메모 폼을 먼저 열었다. M11-3 은 **누르면 바로 저장**하고, 그 뒤에 메모를 붙인다.
 *
 * - 시점은 **누른 순간** 고정한다 (ADR 0020 결정 4). 저장할 때 다시 읽지 않는다.
 * - 시점을 믿을 수 없으면(재생 전 · 곡을 바꾸는 중의 가짜 0초) 저장하지 않는다 — 판정은 코디네이터의
 *   `capturePosition()` 과 버튼의 `isPositionReliable` 이 같은 값을 본다.
 * - **영속 저장이 확인된 뒤에만** "저장했어요". 메모리에만 들어갔으면(보호 · 사용 불가 · 용량) 경고다.
 * - 저장 중에는 다시 누를 수 없다. 방금 저장한 것과 **같은 영상 · 같은 초**를 또 누르면 두 번 넣지 않고
 *   이미 저장했다고 알린다 — 같은 시점에 메모가 다른 Moment 를 여러 개 두는 것은 보관함에서 할 수 있다
 *   (ADR 0019 는 같은 시점을 합치지 않는다).
 * - 곡이 바뀌면 지난 곡의 안내를 지운다 — 다음 곡에서 헷갈리지 않게. 쓰던 메모가 있으면 지우지 않고,
 *   어느 곡 · 몇 초의 메모인지 함께 보인다.
 */
import { computed, inject, readonly, ref, watch, type ComputedRef, type Ref } from 'vue'

import { PLAYBACK_COORDINATOR } from '@/features/playback/playbackCoordinator'
import {
  MAX_MOMENT_NOTE_LENGTH,
  useMomentsStore,
  type MomentMutationFailure,
} from '@/stores/moments'
import { usePlaybackStore } from '@/stores/playback'

import { info, unsavedReason, warning, type MomentFeedback } from './momentFeedback'
import { formatMomentTime } from './momentsView'

/** store 가 저장을 거절한 이유. 정상 캡처로는 닿지 않지만 경계에서 막는다. */
const ADD_REFUSED: Readonly<Record<MomentMutationFailure, string>> = {
  'invalid-video-id': '이 영상의 순간은 저장할 수 없어요.',
  'invalid-time': '재생 위치가 올바르지 않아 저장하지 않았어요.',
  'not-found': '저장할 대상을 찾을 수 없어요.',
  conflict:
    '다른 탭에서 Moments 가 바뀌어 최신 목록을 불러왔어요. 저장하지 않았으니 다시 눌러 주세요.',
  busy: '다른 39page 탭이 저장하는 중이라 저장하지 않았어요. 잠시 뒤 다시 눌러 주세요.',
  // 대시보드는 id 를 정하지 않으므로 닿지 않는다 (확장 브리지 전용, M11-5).
  'duplicate-id': '저장할 대상을 찾을 수 없어요.',
}

const NOTE_REFUSED_CONFLICT =
  '다른 탭에서 Moments 가 바뀌어 최신 목록을 불러왔어요. 메모는 저장하지 않았으니 확인하고 다시 저장해 주세요.'
const NOTE_REFUSED_BUSY =
  '다른 39page 탭이 저장하는 중이라 메모를 저장하지 않았어요. 잠시 뒤 다시 저장해 주세요.'

/** 방금 이 화면에서 저장한 Moment. 메모를 바로 붙일 수 있게 들고 있다. */
export interface SavedMoment {
  readonly id: string
  readonly videoId: string
  readonly atSeconds: number
  readonly title: string
}

export interface MomentCaptureModel {
  /** 지금 누를 수 있는가 — 재생 위치를 믿을 수 있고 저장 중이 아니다. */
  canCapture: ComputedRef<boolean>
  /** 버튼 옆 안내 — 왜 꺼졌는지, 누르면 무엇이 되는지. */
  hint: ComputedRef<string>
  /** 저장 중 — 잠금을 기다리거나 쓰는 중이다 (ADR 0025). */
  saving: Readonly<Ref<boolean>>
  /** 저장 · 메모 결과. 곡이 바뀌면 지워진다. */
  feedback: Readonly<Ref<MomentFeedback | null>>
  lastSaved: Readonly<Ref<SavedMoment | null>>
  lastSavedTime: ComputedRef<string>
  /** 방금 저장한 Moment 가 지금 곡의 것이 아니다 (메모를 쓰는 사이 곡이 바뀌었다). */
  isLastSavedStale: ComputedRef<boolean>

  noteOpen: Readonly<Ref<boolean>>
  draftNote: Ref<string>
  noteLength: ComputedRef<number>
  isNoteTooLong: ComputedRef<boolean>
  noteSaving: Readonly<Ref<boolean>>

  /** 지금 순간을 저장한다. 새로 저장했으면 `true`. */
  save(): Promise<boolean>
  /** 방금 저장한 Moment 에 메모를 쓴다. */
  startNote(): void
  /** 메모를 저장한다. 폼을 닫아도 되면 `true` — 거절되면 쓴 메모를 지킨다. */
  submitNote(): Promise<boolean>
  cancelNote(): void
}

export function useMomentCapture(): MomentCaptureModel {
  const playback = usePlaybackStore()
  const moments = useMomentsStore()

  const coordinator = inject(PLAYBACK_COORDINATOR, null)

  const saving = ref(false)
  const feedback = ref<MomentFeedback | null>(null)
  const lastSaved = ref<SavedMoment | null>(null)
  const noteOpen = ref(false)
  const draftNote = ref('')
  const noteSaving = ref(false)

  /**
   * 버튼이 켜지는 조건. 캡처(`capturePosition`)와 **같은 판정**(`isPositionReliable`)을 본다 — 켜졌는데
   * 누르면 거절되는 일이 없게. 저장 중에는 꺼진다 (연속 클릭).
   */
  const canCapture = computed<boolean>(
    () => coordinator !== null && playback.isPositionReliable && !saving.value,
  )

  const hint = computed<string>(() => {
    if (coordinator === null) return '플레이어가 연결되지 않았어요.'
    if (playback.currentTrack === null) return '곡을 재생하면 지금 이 순간을 저장할 수 있어요.'
    if (playback.playerState === 'error') return '재생할 수 없는 영상이라 지금은 저장할 수 없어요.'
    if (!playback.isPositionReliable) return '재생이 시작되면 저장할 수 있어요.'
    return '누르면 지금 재생 위치를 바로 저장해요. 메모는 저장한 뒤에 붙일 수 있어요.'
  })

  const lastSavedTime = computed<string>(() =>
    lastSaved.value === null ? '' : formatMomentTime(lastSaved.value.atSeconds),
  )

  const isLastSavedStale = computed<boolean>(
    () => lastSaved.value !== null && playback.currentTrack?.videoId !== lastSaved.value.videoId,
  )

  const noteLength = computed<number>(() => draftNote.value.length)
  const isNoteTooLong = computed<boolean>(() => noteLength.value > MAX_MOMENT_NOTE_LENGTH)

  async function save(): Promise<boolean> {
    if (saving.value) return false
    feedback.value = null

    if (coordinator === null) {
      feedback.value = warning('플레이어가 연결되지 않아 저장할 수 없어요.')
      return false
    }

    /*
     * 버튼이 켜진 뒤 누르기 전에 위치를 잃을 수 있다 (곡을 바꾸는 순간 등). 그때 코디네이터는
     * `null` 을 돌려준다 — 0 으로 바꾸지 않고 거절한다 (ADR 0020).
     */
    const captured = coordinator.capturePosition()
    if (captured === null) {
      feedback.value = warning(
        '지금 재생 위치를 확인하지 못했어요. 재생이 시작된 뒤 다시 눌러주세요.',
      )
      return false
    }
    const fixed = { ...captured }
    const time = formatMomentTime(fixed.atSeconds)

    // 방금 저장한 것과 같은 영상 · 같은 초 — 두 번 넣지 않는다 (연속 클릭).
    const previous = lastSaved.value
    if (
      previous !== null &&
      previous.videoId === fixed.videoId &&
      previous.atSeconds === fixed.atSeconds &&
      moments.getMoment(previous.id) !== undefined
    ) {
      feedback.value = info(`${time} 은 방금 저장했어요 — 같은 순간을 두 번 저장하지 않았어요.`)
      return false
    }

    saving.value = true
    let result
    try {
      result = await moments.add({
        videoId: fixed.videoId,
        atSeconds: fixed.atSeconds,
        title: fixed.title,
        note: '',
      })
    } finally {
      saving.value = false
    }

    if (!result.ok) {
      feedback.value = warning(ADD_REFUSED[result.reason])
      return false
    }

    lastSaved.value = { id: result.momentId, ...fixed }
    noteOpen.value = false
    draftNote.value = ''
    feedback.value = result.persisted
      ? info(`${time} 을 저장했어요 — ${fixed.title}`)
      : warning(
          `${time} 을 목록에 넣었지만 이 브라우저에 저장하지 못했어요. ${unsavedReason(moments)} 새로고침하면 사라집니다.`,
        )
    return true
  }

  function startNote(): void {
    const target = lastSaved.value
    if (target === null) return
    draftNote.value = moments.getMoment(target.id)?.note ?? ''
    noteOpen.value = true
  }

  async function submitNote(): Promise<boolean> {
    const target = lastSaved.value
    if (target === null || noteSaving.value) return false

    // 입력란의 maxlength 가 1차 방어선이다. 스크립트 · 붙여넣기 경로를 여기서 막는다.
    if (isNoteTooLong.value) {
      feedback.value = warning(`메모는 ${String(MAX_MOMENT_NOTE_LENGTH)}자까지 쓸 수 있어요.`)
      return false
    }

    noteSaving.value = true
    let result
    try {
      result = await moments.updateNote(target.id, draftNote.value)
    } finally {
      noteSaving.value = false
    }

    const time = formatMomentTime(target.atSeconds)
    if (!result.ok) {
      if (result.reason === 'conflict' || result.reason === 'busy') {
        // 폼을 닫지 않는다 — 쓴 메모를 잃지 않게.
        feedback.value = warning(
          result.reason === 'conflict' ? NOTE_REFUSED_CONFLICT : NOTE_REFUSED_BUSY,
        )
        return false
      }
      feedback.value = warning('이 순간을 찾을 수 없어요. 이미 지워졌을 수 있어요.')
      noteOpen.value = false
      lastSaved.value = null
      return true
    }

    feedback.value = result.persisted
      ? info(`${time} 에 메모를 붙였어요.`)
      : warning(
          `메모를 붙였지만 이 브라우저에 저장하지 못했어요. ${unsavedReason(moments)} 새로고침하면 이전 메모로 돌아갑니다.`,
        )
    noteOpen.value = false
    draftNote.value = ''
    return true
  }

  function cancelNote(): void {
    noteOpen.value = false
    draftNote.value = ''
  }

  /*
   * 곡이 바뀌면 지난 곡의 안내를 지운다 (M11-3 B). 쓰던 메모가 있으면 지키고 그대로 둔다 — 폼이 어느
   * 곡 · 몇 초의 메모인지 보여 준다 (`isLastSavedStale`).
   */
  watch(
    () => playback.currentTrack?.videoId ?? null,
    (now, before) => {
      if (now === before) return
      if (noteOpen.value && draftNote.value !== '') return
      feedback.value = null
      noteOpen.value = false
      draftNote.value = ''
      lastSaved.value = null
    },
  )

  return {
    canCapture,
    hint,
    saving: readonly(saving),
    feedback: readonly(feedback) as Readonly<Ref<MomentFeedback | null>>,
    lastSaved: readonly(lastSaved) as Readonly<Ref<SavedMoment | null>>,
    lastSavedTime,
    isLastSavedStale,
    noteOpen: readonly(noteOpen),
    draftNote,
    noteLength,
    isNoteTooLong,
    noteSaving: readonly(noteSaving),
    save,
    startNote,
    submitNote,
    cancelNote,
  }
}
