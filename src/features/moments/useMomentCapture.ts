/**
 * "＋ 이 순간 저장" 의 뷰 모델 — **저장 모델 B: 잡기 → 메모 → Moment 저장** (M11-7C, ADR 0030).
 *
 * M9 는 누르면 메모 폼을 먼저 열었고, M11-3 은 누르면 바로 저장한 뒤 메모를 붙였다(빠른 저장). 사용자
 * 시험(UAT)에서 "메모를 쓰기 전에 이미 저장돼 버린다 · 메모 고치기와 새 저장이 헷갈린다" 가 나와 M11-7C
 * 는 이렇게 바꿨다.
 *
 *   1. 누르면 **시점을 잡는다** — 그 순간의 영상 · 초를 고정한다. 음악은 계속 흐른다. 아직 저장하지 않는다.
 *   2. 메모(선택)를 쓴다.
 *   3. **Moment 저장** 을 눌러야 처음으로 저장된다. 취소하면 아무것도 남지 않는다.
 *
 * 세 계층을 **조립만** 한다 (`AGENTS.md` 규칙 2·4).
 *
 *   Playback Coordinator   지금 몇 초인가 — `capturePosition()`
 *   Moment 초안 store      잡아 둔 순간 · 메모 · 저장 중 · 결과 (대시보드와 보관함이 함께 본다)
 *   Moments store          저장한다 — `add({ id })` (요청 id 로 한 번만)
 *
 * - 시점은 **누른 순간** 고정한다 (ADR 0020 결정 4). 저장할 때 다시 읽지 않는다. 메모를 쓰는 사이 곡이
 *   바뀌어도 초안은 처음 곡 · 시점 그대로이고, 바뀌었다고 보인다. 지금으로 바꾸는 것은 "다시 잡기" 뿐이다.
 * - 시점을 믿을 수 없으면(재생 전 · 곡을 바꾸는 중의 가짜 0초) 잡지 않는다 — 판정은 코디네이터의
 *   `capturePosition()` 과 버튼의 `isPositionReliable` 이 같은 값을 본다.
 * - **영속 저장이 확인된 뒤에만** "저장했어요". 메모리에만 들어갔으면(보호 · 사용 불가 · 용량) 경고다.
 *   거절(충돌 · 잠금 대기 등)이면 초안과 메모를 그대로 두고 다시 저장할 수 있다.
 * - 곡이 바뀌면 지난 곡의 안내를 지운다 — 다음 곡에서 헷갈리지 않게. 초안이 있으면 지우지 않는다.
 */
import { computed, inject, watch, type ComputedRef, type WritableComputedRef } from 'vue'

import { PLAYBACK_COORDINATOR } from '@/features/playback/playbackCoordinator'
import { useMomentDraftStore, type MomentDraft, type SavedDraft } from '@/stores/momentDraft'
import {
  MAX_MOMENT_NOTE_LENGTH,
  useMomentsStore,
  type MomentMutationFailure,
} from '@/stores/moments'
import { usePlaybackStore } from '@/stores/playback'

import { info, unsavedReason, warning, type MomentFeedback } from './momentFeedback'
import { formatMomentTime } from './momentsView'

/** 저장을 거절한 이유. 초안과 메모는 남아 있다 — 문구가 그것을 말한다. */
const SAVE_REFUSED: Readonly<Record<MomentMutationFailure, string>> = {
  'invalid-video-id': '이 영상의 순간은 저장할 수 없어요.',
  'invalid-time': '재생 위치가 올바르지 않아 저장하지 않았어요.',
  'not-found': '저장할 대상을 찾을 수 없어요.',
  conflict:
    '다른 탭에서 Moments 가 바뀌어 최신 목록을 불러왔어요. 저장하지 않았어요 — 초안과 메모는 그대로 있으니 다시 저장해 주세요.',
  busy: '다른 39page 탭이 저장하는 중이라 저장하지 않았어요. 초안과 메모는 그대로 있어요 — 잠시 뒤 다시 저장해 주세요.',
  // 초안의 요청 id 가 다른 순간에 쓰였다 — 정상 흐름으로는 닿지 않는다. 다시 잡으면 새 id 다.
  'duplicate-id':
    '이 초안을 저장하지 못했어요. ↻ 지금 시점으로 다시 잡거나 취소한 뒤 다시 시도해 주세요.',
}

export interface MomentCaptureModel {
  /** 지금 시점을 잡을 수 있는가 — 재생 위치를 믿을 수 있고 저장 중이 아니다. */
  canCapture: ComputedRef<boolean>
  /** 버튼 옆 안내 — 왜 꺼졌는지, 누르면 무엇이 되는지. */
  hint: ComputedRef<string>
  /** 잡아 둔 순간 (저장 전). 대시보드와 보관함이 같은 초안을 본다. */
  draft: ComputedRef<MomentDraft | null>
  draftTime: ComputedRef<string>
  /** 초안이 지금 재생 중인 곡의 것이 아니다 (메모를 쓰는 사이 곡이 바뀌었다). */
  isDraftStale: ComputedRef<boolean>
  note: WritableComputedRef<string>
  noteLength: ComputedRef<number>
  isNoteTooLong: ComputedRef<boolean>
  /** 저장 중 — 잠금을 기다리거나 쓰는 중이다 (ADR 0025). */
  saving: ComputedRef<boolean>
  /** 잡기 · 저장 · 취소 결과. 곡이 바뀌면(초안이 없을 때) 지워진다. */
  feedback: ComputedRef<MomentFeedback | null>
  lastSaved: ComputedRef<SavedDraft | null>

  /** 지금 시점을 잡는다(초안이 있으면 시점만 다시 잡고 메모는 지킨다). 잡았으면 `true`. */
  capture(): boolean
  /** 초안을 저장한다. 저장했으면 새 Moment 의 id, 아니면 `null` (초안은 남는다). */
  save(): Promise<string | null>
  /** 초안을 버린다 — 아무것도 저장하지 않는다. */
  cancel(): void
}

export function useMomentCapture(): MomentCaptureModel {
  const playback = usePlaybackStore()
  const moments = useMomentsStore()
  const store = useMomentDraftStore()

  const coordinator = inject(PLAYBACK_COORDINATOR, null)

  /**
   * 잡기 단추가 켜지는 조건. 캡처(`capturePosition`)와 **같은 판정**(`isPositionReliable`)을 본다 — 켜졌는데
   * 누르면 거절되는 일이 없게. 저장 중에는 꺼진다.
   */
  const canCapture = computed<boolean>(
    () => coordinator !== null && playback.isPositionReliable && !store.saving,
  )

  const hint = computed<string>(() => {
    if (coordinator === null) return '플레이어가 연결되지 않았어요.'
    if (playback.currentTrack === null) return '곡을 재생하면 지금 이 순간을 저장할 수 있어요.'
    if (playback.playerState === 'error') return '재생할 수 없는 영상이라 지금은 저장할 수 없어요.'
    if (!playback.isPositionReliable) return '재생이 시작되면 저장할 수 있어요.'
    return '누르면 지금 시점을 잡아요(음악은 계속 흘러요). 메모를 쓰고 Moment 저장을 누르면 저장돼요.'
  })

  const draft = computed<MomentDraft | null>(() => store.draft)
  const draftTime = computed<string>(() =>
    store.draft === null ? '' : formatMomentTime(store.draft.atSeconds),
  )
  const isDraftStale = computed<boolean>(
    () => store.draft !== null && playback.currentTrack?.videoId !== store.draft.videoId,
  )

  const note = computed<string>({
    get: () => store.note,
    set: (value) => {
      store.note = value
    },
  })

  function setFeedback(next: MomentFeedback | null): void {
    store.setFeedback(next)
  }

  function capture(): boolean {
    if (store.saving) return false
    if (coordinator === null) {
      setFeedback(warning('플레이어가 연결되지 않아 저장할 수 없어요.'))
      return false
    }

    /*
     * 단추가 켜진 뒤 누르기 전에 위치를 잃을 수 있다 (곡을 바꾸는 순간 등). 그때 코디네이터는
     * `null` 을 돌려준다 — 0 으로 바꾸지 않고 거절한다 (ADR 0020).
     */
    const captured = coordinator.capturePosition()
    if (captured === null) {
      setFeedback(warning('지금 재생 위치를 확인하지 못했어요. 재생이 시작된 뒤 다시 눌러주세요.'))
      return false
    }

    const recapture = store.draft !== null
    if (!store.capture({ ...captured })) return false
    const time = formatMomentTime(captured.atSeconds)
    setFeedback(
      info(
        recapture
          ? `시점을 ${time} 으로 다시 잡았어요 — 아직 저장하지 않았어요.`
          : `${time} 을 잡았어요 — 메모를 쓰고(선택) Moment 저장을 누르세요.`,
      ),
    )
    return true
  }

  async function save(): Promise<string | null> {
    const result = await store.save()
    if (!result.ok) {
      if (result.reason === 'no-draft' || result.reason === 'saving') return null
      if (result.reason === 'too-long') {
        setFeedback(warning(`메모는 ${String(MAX_MOMENT_NOTE_LENGTH)}자까지 쓸 수 있어요.`))
        return null
      }
      setFeedback(warning(SAVE_REFUSED[result.reason]))
      return null
    }

    const time = formatMomentTime(result.saved.atSeconds)
    const title = result.saved.title === '' ? '' : ` — ${result.saved.title}`
    setFeedback(
      result.persisted
        ? info(`${time} Moment 를 저장했어요${title}`)
        : warning(
            `${time} 을 목록에 넣었지만 이 브라우저에 저장하지 못했어요. ${unsavedReason(moments)} 새로고침하면 사라집니다.`,
          ),
    )
    return result.momentId
  }

  function cancel(): void {
    if (store.draft === null || store.saving) return
    store.discard()
    setFeedback(info('취소했어요 — 저장하지 않았어요.'))
  }

  /*
   * 곡이 바뀌면 지난 곡의 안내를 지운다 (M11-3 B). 초안이 있으면 지키고 그대로 둔다 — 어느 곡 · 몇 초의
   * 초안인지 보여 준다 (`isDraftStale`).
   */
  watch(
    () => playback.currentTrack?.videoId ?? null,
    (now, before) => {
      if (now === before || store.draft !== null) return
      store.setFeedback(null)
      store.lastSaved = null
    },
  )

  return {
    canCapture,
    hint,
    draft,
    draftTime,
    isDraftStale,
    note,
    noteLength: computed(() => store.noteLength),
    isNoteTooLong: computed(() => store.isNoteTooLong),
    saving: computed(() => store.saving),
    feedback: computed(() => store.feedback),
    lastSaved: computed(() => store.lastSaved),
    capture,
    save,
    cancel,
  }
}
