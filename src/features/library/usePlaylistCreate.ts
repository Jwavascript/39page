/**
 * "＋ 새 목록" 양식의 상태 (M6-4 에서 `PlaylistWidget` 안에 있던 것을 M11-2 에서 꺼냈다).
 *
 * 대시보드의 플레이리스트 위젯과 보관함의 목록이 **같은 규칙**으로 목록을 만든다 — 공백 이름 거절,
 * 실패해도 입력 유지, 저장되지 않았으면 그 자리에서 알림, 저장 중 다시 제출 금지(ADR 0025).
 * 저장은 store 의 `createPlaylist` 로만 한다.
 */
import { nextTick, readonly, ref, type Ref } from 'vue'

import { LIBRARY_BUSY_MESSAGE, LIBRARY_CONFLICT_MESSAGE } from '@/features/library/libraryFeedback'
import { useLibraryStore } from '@/stores/library'

const FAILURE_MESSAGE: Readonly<Record<string, string>> = {
  'empty-name': '이름을 입력해주세요.',
  'not-found': '대상을 찾을 수 없습니다.',
  conflict: LIBRARY_CONFLICT_MESSAGE,
  busy: LIBRARY_BUSY_MESSAGE,
}

export const UNSAVED_NOTICE = '이 변경은 저장되지 않았습니다. 현재 세션에서만 유지됩니다.'

export interface PlaylistCreateModel {
  readonly isCreating: Readonly<Ref<boolean>>
  readonly draftName: Ref<string>
  readonly formError: Readonly<Ref<string>>
  readonly isSubmitting: Readonly<Ref<boolean>>
  /** 저장되지 않았을 때의 안내. 성공하면 빈 문자열. */
  readonly notice: Readonly<Ref<string>>
  /** 이름 입력란. 템플릿이 `ref` 로 묶는다 — 열면 이리로 포커스가 간다. */
  readonly nameInput: Ref<HTMLInputElement | null>
  start(): Promise<void>
  cancel(): void
  /** 만들었으면 새 목록의 id, 아니면 `null`. 저장이 끝난 뒤 이행한다. */
  submit(): Promise<string | null>
  clearNotice(): void
}

export function usePlaylistCreate(): PlaylistCreateModel {
  const library = useLibraryStore()

  const isCreating = ref(false)
  const draftName = ref('')
  const formError = ref('')
  const isSubmitting = ref(false)
  const notice = ref('')
  const nameInput = ref<HTMLInputElement | null>(null)

  async function start(): Promise<void> {
    notice.value = ''
    formError.value = ''
    draftName.value = ''
    isCreating.value = true
    await nextTick()
    nameInput.value?.focus()
  }

  function cancel(): void {
    isCreating.value = false
    draftName.value = ''
    formError.value = ''
  }

  async function submit(): Promise<string | null> {
    if (isSubmitting.value) return null
    isSubmitting.value = true
    let result
    try {
      result = await library.createPlaylist(draftName.value)
    } finally {
      isSubmitting.value = false
    }

    if (!result.ok) {
      // 실패해도 입력값을 지우지 않는다. 사용자가 고쳐 쓸 수 있어야 한다.
      formError.value = FAILURE_MESSAGE[result.reason] ?? '요청을 처리하지 못했습니다.'
      return null
    }

    notice.value = result.persisted ? '' : UNSAVED_NOTICE
    isCreating.value = false
    draftName.value = ''
    formError.value = ''
    return result.playlistId
  }

  return {
    isCreating: readonly(isCreating),
    draftName,
    formError: readonly(formError),
    isSubmitting: readonly(isSubmitting),
    notice: readonly(notice),
    nameInput,
    start,
    cancel,
    submit,
    clearNotice: () => {
      notice.value = ''
    },
  }
}
