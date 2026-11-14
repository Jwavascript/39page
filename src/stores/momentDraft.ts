/**
 * Moment 초안 — "＋ 이 순간 저장" 의 **공유 상태** (M11-7C · 저장 모델 B, ADR 0030).
 *
 * 저장은 세 걸음이다.
 *
 *   1. **잡기** — 누른 순간의 영상 · 시점을 고정한다. 음악은 멈추지 않는다. 아직 아무것도 만들지 않는다.
 *   2. **메모** — 선택. 쓰는 동안 곡이 바뀌어도 초안은 처음 잡은 영상 · 시점 그대로다.
 *   3. **Moment 저장** — 이때 처음으로 Moments store 에 더한다. 취소하면 아무것도 남지 않는다.
 *
 * 초안은 **하나**다. 대시보드 위젯과 보관함 Moments › 이 곡이 같은 초안을 본다 — 한쪽에서 잡고 다른
 * 쪽에서 이어 쓸 수 있고, 두 입구가 다른 정책을 갖지 않는다. 그래서 컴포넌트 · composable 이 아니라
 * store 에 둔다 (`AGENTS.md` 규칙 2). 보관함을 닫아도 초안은 남는다. 저장소에는 쓰지 않는다(화면 상태 —
 * 새로고침하면 사라진다). 저장 키 · 백업 형식은 그대로다.
 *
 * **한 번만 저장.** 초안마다 요청 id 를 하나 만들어 `moments.add({ id })` 에 넘긴다 — store 의 호출자 id
 * 계약(M11-5, `isCallerMomentId`)이 같은 id 를 두 번 넣지 않는다. 저장 중에는 다시 저장하지 않는다.
 * 실패(충돌 · 잠금 대기 · 보호 · 쓸 수 없음)하면 초안 · 메모를 그대로 두고 성공으로 보이지 않는다.
 *
 * 재생은 모른다 — 지금 시점은 부르는 쪽(composable)이 코디네이터에게 물어 넘긴다 (`AGENTS.md` 규칙 4).
 * 안내 문구도 부르는 쪽이 만든다. 이 store 는 상태와 결과만 다룬다.
 */
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

import { createId } from '@/shared/utils/id'

import { MAX_MOMENT_NOTE_LENGTH, useMomentsStore, type MomentMutationFailure } from './moments'

/** 잡아 둔 순간 — 아직 저장하지 않았다. */
export interface MomentDraft {
  readonly videoId: string
  readonly atSeconds: number
  /** 잡을 때의 곡 제목 (스냅샷). */
  readonly title: string
  /** 이 초안의 저장 요청 id — 같은 초안을 여러 번 저장해도 한 번만 들어간다. */
  readonly requestId: string
}

/** 화면에 보일 결과 한 줄. 문구는 부르는 쪽이 정한다. */
export interface DraftFeedback {
  readonly tone: 'info' | 'warning'
  readonly text: string
}

/** 방금 저장한 Moment. */
export interface SavedDraft {
  readonly id: string
  readonly videoId: string
  readonly atSeconds: number
  readonly title: string
}

export type DraftSaveResult =
  | {
      readonly ok: true
      readonly momentId: string
      /** 브라우저 저장소에 남았는가. `false` 면 메모리에만 있다 — 새로고침하면 사라진다. */
      readonly persisted: boolean
      readonly saved: SavedDraft
    }
  | {
      readonly ok: false
      readonly reason: MomentMutationFailure | 'no-draft' | 'saving' | 'too-long'
    }

/**
 * 웹앱 초안의 요청 id. store 의 호출자 id 형식(`ext-` + 16~80자)을 따른다 — 앱이 만드는 id 와 겹치지
 * 않고, 확장 브리지가 만드는 id(`ext-` + UUID)와는 `web-` 으로 갈린다.
 */
export function createDraftRequestId(): string {
  return `ext-web-${createId().replace(/[^A-Za-z0-9]/g, '')}`
}

export const useMomentDraftStore = defineStore('momentDraft', () => {
  const moments = useMomentsStore()

  const draft = ref<MomentDraft | null>(null)
  const note = ref('')
  const saving = ref(false)
  const feedback = ref<DraftFeedback | null>(null)
  const lastSaved = ref<SavedDraft | null>(null)
  /** 보관함 Moments › 이 곡에서 초안을 이어 쓰라는 요청 — 늘어나면 그 화면이 열고 메모로 간다. */
  const resumeRequest = ref(0)

  const noteLength = computed<number>(() => note.value.length)
  const isNoteTooLong = computed<boolean>(() => noteLength.value > MAX_MOMENT_NOTE_LENGTH)

  /**
   * 순간을 잡는다. 초안이 이미 있으면 **시점만** 새로 잡고 쓰던 메모는 지킨다(명시적인 "다시 잡기").
   * 저장 중에는 바꾸지 않는다 — 저장되는 것과 보이는 것이 달라지면 안 된다.
   */
  function capture(at: { videoId: string; atSeconds: number; title: string }): boolean {
    if (saving.value) return false
    draft.value = { ...at, requestId: createDraftRequestId() }
    lastSaved.value = null
    return true
  }

  /** 초안을 버린다 — 아무것도 저장하지 않는다. */
  function discard(): void {
    if (saving.value) return
    draft.value = null
    note.value = ''
  }

  async function save(): Promise<DraftSaveResult> {
    const target = draft.value
    if (target === null) return { ok: false, reason: 'no-draft' }
    if (saving.value) return { ok: false, reason: 'saving' }
    // 입력란의 maxlength 가 1차 방어선이다. 스크립트 · 붙여넣기 경로를 여기서 막는다.
    if (isNoteTooLong.value) return { ok: false, reason: 'too-long' }

    saving.value = true
    let result
    try {
      result = await moments.add({
        id: target.requestId,
        videoId: target.videoId,
        atSeconds: target.atSeconds,
        title: target.title,
        note: note.value,
      })
    } finally {
      saving.value = false
    }

    // 실패 — 초안과 메모를 그대로 둔다. 같은 요청 id 로 다시 저장할 수 있다.
    if (!result.ok) return { ok: false, reason: result.reason }

    const saved: SavedDraft = {
      id: result.momentId,
      videoId: target.videoId,
      atSeconds: target.atSeconds,
      title: target.title,
    }
    // 저장하는 사이 다시 잡지 않았다(저장 중에는 잡기를 막는다) — 이 초안이 끝났다.
    if (draft.value?.requestId === target.requestId) {
      draft.value = null
      note.value = ''
    }
    lastSaved.value = saved
    return { ok: true, momentId: result.momentId, persisted: result.persisted, saved }
  }

  function setFeedback(next: DraftFeedback | null): void {
    feedback.value = next
  }

  function requestResume(): void {
    resumeRequest.value += 1
  }

  return {
    draft,
    note,
    saving,
    feedback,
    lastSaved,
    resumeRequest,
    noteLength,
    isNoteTooLong,
    capture,
    discard,
    save,
    setFeedback,
    requestResume,
  }
})
