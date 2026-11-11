/**
 * "지금 이 순간 저장" 의 뷰 모델 (M9-4, F13).
 *
 * 두 계층을 **조립만** 한다 (`AGENTS.md` 규칙 2·4).
 *
 *   Playback Coordinator   지금 몇 초인가 — `capturePosition()`
 *   Moments store          그것을 저장한다 — `add()`
 *
 * 코디네이터는 저장을 모르고, store 는 재생을 모른다. 둘을 잇는 것이 여기다.
 * `PlayerAdapter` 도 YouTube API 도 부르지 않는다.
 *
 * 핵심은 **시점을 누를 때 고정하는 것**이다 (ADR 0020 결정 4). 메모를 쓰는
 * 동안 재생은 흘러가고, 곡이 바뀔 수도 있다. 누른 순간의 `{ videoId,
 * atSeconds, title }` 을 그대로 들고 있다가 저장한다 — 저장할 때 다시 읽지
 * 않는다. 곡이 바뀌면 **바뀌었다고 알리되** 대상은 바꾸지 않는다.
 */
import { computed, inject, readonly, ref, type ComputedRef, type Ref } from 'vue'

import { PLAYBACK_COORDINATOR, type MomentCapture } from '@/features/playback/playbackCoordinator'
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
    '다른 탭에서 Moments 가 바뀌어 최신 목록을 불러왔어요. 저장하지 않았으니 메모를 확인하고 다시 저장해 주세요.',
  busy: '다른 39page 탭이 저장하는 중이라 저장하지 않았어요. 잠시 뒤 다시 저장해 주세요.',
}

export interface MomentCaptureModel {
  /**
   * 지금 저장 버튼을 켤 수 있는지.
   *
   * 재생이 **실제로 시작된 뒤에만** 켠다 (`playback.isPositionReliable`).
   * 새 영상을 적재한 직후 플레이어는 약 200ms 동안 `0` 을 보고한다 (M9-3
   * 실측) — 그때 켜 두면 0초짜리 Moment 가 생긴다. 코디네이터의
   * `capturePosition()` 도 **같은 판정**을 쓰므로 둘이 어긋나지 않는다.
   */
  canCapture: ComputedRef<boolean>

  /** 저장 버튼 아래 한 줄 안내. 왜 꺼져 있는지 말한다. */
  hint: ComputedRef<string>

  /** 누른 순간 고정한 대상. 폼이 닫혀 있으면 `null`. */
  target: Readonly<Ref<MomentCapture | null>>
  targetTime: ComputedRef<string>

  /** 폼을 연 뒤 재생 중인 곡이 바뀌었는지. 바뀌어도 **대상은 그대로다.** */
  isTargetStale: ComputedRef<boolean>

  draftNote: Ref<string>
  noteLength: ComputedRef<number>
  isNoteTooLong: ComputedRef<boolean>

  feedback: Readonly<Ref<MomentFeedback | null>>

  /** 저장 중 — 탭 간 잠금을 기다리거나 쓰는 중이다 (ADR 0025). */
  saving: Readonly<Ref<boolean>>

  /** 지금 시점을 찍고 폼을 연다. 찍지 못하면 `false` 와 안내. */
  begin(): boolean
  /**
   * 고정한 대상에 저장한다. 저장이 **끝난 뒤** 이행한다. 저장했으면(메모리라도)
   * `true` 이고 폼이 닫힌다. 거절되면 `false` — 폼과 메모가 그대로 남는다.
   */
  submit(): Promise<boolean>
  /** 폼을 닫는다. 아무것도 저장하지 않는다. */
  cancel(): void
}

export function useMomentCapture(): MomentCaptureModel {
  const playback = usePlaybackStore()
  const moments = useMomentsStore()

  /** 주입되지 않으면 저장할 수 없다 — 위젯을 단독으로 마운트하는 테스트의 기본값. */
  const coordinator = inject(PLAYBACK_COORDINATOR, null)

  const target = ref<MomentCapture | null>(null)
  const draftNote = ref('')
  const feedback = ref<MomentFeedback | null>(null)
  const saving = ref(false)

  const canCapture = computed<boolean>(() => coordinator !== null && playback.isPositionReliable)

  const hint = computed<string>(() => {
    if (coordinator === null) return '플레이어가 연결되지 않았어요.'
    if (playback.currentTrack === null) return '곡을 재생하면 지금 이 순간을 저장할 수 있어요.'
    if (playback.playerState === 'error') return '재생할 수 없는 영상이라 지금은 저장할 수 없어요.'
    if (!playback.isPositionReliable) return '재생이 시작되면 저장할 수 있어요.'
    return '누른 순간의 재생 위치가 고정돼요.'
  })

  const targetTime = computed<string>(() =>
    target.value === null ? '' : formatMomentTime(target.value.atSeconds),
  )

  const isTargetStale = computed<boolean>(
    () => target.value !== null && playback.currentTrack?.videoId !== target.value.videoId,
  )

  const noteLength = computed<number>(() => draftNote.value.length)
  const isNoteTooLong = computed<boolean>(() => noteLength.value > MAX_MOMENT_NOTE_LENGTH)

  function begin(): boolean {
    feedback.value = null

    if (coordinator === null) {
      feedback.value = warning('플레이어가 연결되지 않아 저장할 수 없어요.')
      return false
    }

    /*
     * 버튼이 켜져 있어도 **이 순간의 판정이 진짜다.** 버튼을 그린 뒤 누르기
     * 전에 곡이 바뀌었을 수 있다. 코디네이터가 `null` 이면 0 으로 바꾸지 않고
     * 그대로 거절한다.
     */
    const captured = coordinator.capturePosition()
    if (captured === null) {
      feedback.value = warning(
        '지금 재생 위치를 확인하지 못했어요. 재생이 시작된 뒤 다시 눌러주세요.',
      )
      return false
    }

    // 복사해 둔다. 이후에 무엇이 바뀌어도 이 값은 그대로다.
    target.value = { ...captured }
    draftNote.value = ''
    return true
  }

  async function submit(): Promise<boolean> {
    const fixed = target.value
    if (fixed === null || saving.value) return false

    // 입력란의 maxlength 가 1차 방어선이다. 스크립트·붙여넣기 경로를 여기서 막는다.
    if (isNoteTooLong.value) {
      feedback.value = warning(`메모는 ${String(MAX_MOMENT_NOTE_LENGTH)}자까지 쓸 수 있어요.`)
      return false
    }

    saving.value = true
    let result
    try {
      result = await moments.add({
        videoId: fixed.videoId,
        atSeconds: fixed.atSeconds,
        title: fixed.title,
        note: draftNote.value,
      })
    } finally {
      saving.value = false
    }

    if (!result.ok) {
      // 폼을 닫지 않는다. 쓴 메모를 잃지 않게 한다.
      feedback.value = warning(ADD_REFUSED[result.reason])
      return false
    }

    const label = `${fixed.title} · ${formatMomentTime(fixed.atSeconds)}`
    feedback.value = result.persisted
      ? info(`저장했어요 — ${label}`)
      : warning(
          `목록에 넣었지만 이 브라우저에 저장하지 못했어요 — ${label}. ${unsavedReason(moments)} 새로고침하면 사라집니다.`,
        )

    target.value = null
    draftNote.value = ''
    return true
  }

  function cancel(): void {
    target.value = null
    draftNote.value = ''
    feedback.value = null
  }

  return {
    canCapture,
    hint,
    target: readonly(target) as Readonly<Ref<MomentCapture | null>>,
    targetTime,
    isTargetStale,
    draftNote,
    noteLength,
    isNoteTooLong,
    feedback: readonly(feedback) as Readonly<Ref<MomentFeedback | null>>,
    saving: readonly(saving),
    begin,
    submit,
    cancel,
  }
}
