/**
 * 수집 화면 — Music Moment 저장 (M10-4, ADR 0023 · 0025).
 *
 * - 시점·영상은 확장이 **누른 순간** 고정해 보낸 값이다. 이 화면은 바꾸지 않는다.
 * - 메모는 여기서만 쓴다 (주소로 받지 않는다). 500자를 넘으면 저장하지 않는다 —
 *   조용히 자르지 않는다.
 * - 화면을 연 것만으로 저장하지 않는다. "Moment 저장" 을 누를 때만 Moments store 의
 *   공식 명령(`add`)을 부른다 — 대시보드와 같은 검증 · 같은 탭 간 잠금이다.
 * - 저장이 끝나기 전에는 `saving` 이고 성공을 말하지 않는다. 거절(`conflict` ·
 *   `busy`)이면 메모를 그대로 두어 다시 누를 수 있다.
 */
import { computed, readonly, ref, watch, type ComputedRef, type Ref } from 'vue'

import { MAX_MOMENT_NOTE_LENGTH, useMomentsStore } from '@/stores/moments'

import type { CollectMomentRequest } from './collectRequest'
import { clearHashFromAddressBar, type CollectOptions } from './useCollect'

export type CollectMomentFailure =
  /** 다른 탭이 먼저 Moments 를 바꿨다. 최신을 다시 읽었다 — 메모는 그대로다. */
  | 'conflict'
  /** 다른 탭이 저장하는 중이라 잠금을 얻지 못했다. 아무것도 바꾸지 않았다. */
  | 'busy'
  /** 저장소에 쓰지 못했다 (용량 부족 등). Moments 는 바뀌지 않았다. */
  | 'write-failed'
  /** 메모가 500자를 넘는다. */
  | 'too-long'
  /** 계약을 통과한 값을 store 가 거절했다 — 일어나면 안 되는 경로. */
  | 'invalid'
  /** 저장했던 Moment 가 없어졌다 (다른 탭에서 지웠거나 잠금 밖의 탭에 덮였다). */
  | 'lost'

export type CollectMomentPhase =
  /** Moments 가 보호·사용 불가 상태라 저장할 수 없다 (ADR 0007). */
  | { readonly kind: 'blocked'; readonly status: 'protected' | 'unavailable' }
  /** 메모를 쓰는 중. */
  | { readonly kind: 'editing'; readonly failure: CollectMomentFailure | null }
  /** 저장했다. */
  | { readonly kind: 'saved' }

export interface CollectMomentState {
  readonly request: CollectMomentRequest
  readonly phase: ComputedRef<CollectMomentPhase>
  readonly note: Ref<string>
  readonly noteLength: ComputedRef<number>
  readonly isNoteTooLong: ComputedRef<boolean>
  /** 같은 영상 · 같은 시점에 이미 저장된 Moment 수. 막지 않고 알린다. */
  readonly sameMoments: ComputedRef<number>
  readonly saving: Readonly<Ref<boolean>>
  readonly canSave: ComputedRef<boolean>
  /** 저장이 끝나면(성공 · 실패 모두) 이행한다. */
  save(): Promise<void>
}

export function useCollectMoment(
  request: CollectMomentRequest,
  options: CollectOptions = {},
): CollectMomentState {
  const moments = useMomentsStore()
  const clearRequest = options.clearRequest ?? clearHashFromAddressBar

  const note = ref('')
  const saving = ref(false)
  const failure = ref<CollectMomentFailure | null>(null)
  const savedId = ref<string | null>(null)

  const noteLength = computed(() => note.value.length)
  const isNoteTooLong = computed(() => note.value.length > MAX_MOMENT_NOTE_LENGTH)

  const sameMoments = computed(
    () =>
      moments.moments.filter(
        (moment) => moment.videoId === request.videoId && moment.atSeconds === request.atSeconds,
      ).length,
  )

  // 저장한 Moment 가 아직 있는지 지켜본다 — 없어지면 성공 안내를 내리고 다시 저장하게 한다.
  watch(
    () => moments.moments,
    () => {
      const id = savedId.value
      if (id === null) return
      if (!moments.moments.some((moment) => moment.id === id)) {
        savedId.value = null
        failure.value = 'lost'
      }
    },
  )

  const phase = computed<CollectMomentPhase>(() => {
    if (savedId.value !== null) return { kind: 'saved' }
    if (moments.status !== 'ready') return { kind: 'blocked', status: moments.status }
    return { kind: 'editing', failure: failure.value }
  })

  const canSave = computed(
    () => phase.value.kind === 'editing' && !saving.value && !isNoteTooLong.value,
  )

  async function save(): Promise<void> {
    // 한 번만 — 저장 중에 다시 눌러도, 저장 뒤 다시 눌러도 하나만 들어간다.
    if (phase.value.kind !== 'editing' || saving.value) return
    if (isNoteTooLong.value) {
      failure.value = 'too-long'
      return
    }

    saving.value = true
    let result
    try {
      result = await moments.add({
        videoId: request.videoId,
        atSeconds: request.atSeconds,
        title: request.title ?? undefined,
        note: note.value,
      })
    } finally {
      saving.value = false
    }

    if (!result.ok) {
      failure.value =
        result.reason === 'conflict' || result.reason === 'busy' ? result.reason : 'invalid'
      return
    }

    if (!result.persisted) {
      // 메모리에만 들어갔다. 저장소의 상태로 되돌려 다시 시도가 두 개를 넣지 않게 한다.
      moments.reload()
      failure.value = 'write-failed'
      return
    }

    failure.value = null
    savedId.value = result.momentId
    clearRequest()
  }

  return {
    request,
    phase,
    note,
    noteLength,
    isNoteTooLong,
    sameMoments,
    saving: readonly(saving),
    canSave,
    save,
  }
}
