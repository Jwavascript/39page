/**
 * 저장하지 않은 입력이 있으면 떠나기 전에 묻는다 (M10-5).
 *
 * 수집 화면에서 쓰던 메모가 탭 닫기 · 새로고침 · 다른 주소로 이동으로 조용히 사라지지
 * 않게, 브라우저의 "이 사이트에서 나가시겠습니까?" 확인을 띄운다. 문구는 브라우저가
 * 정한다 (임의 문구는 무시된다). 저장했거나 비어 있으면 묻지 않는다.
 */
import { onBeforeUnmount, onMounted } from 'vue'

export function useUnsavedGuard(
  isDirty: () => boolean,
  target: Pick<
    Window,
    'addEventListener' | 'removeEventListener'
  > = globalThis as unknown as Window,
): void {
  const onBeforeUnload = (event: BeforeUnloadEvent): void => {
    if (!isDirty()) return
    event.preventDefault()
    // 표준 이전의 Chrome 은 비어 있지 않은 returnValue 가 있어야 묻는다 (빈 문자열은 묻지 않는다).
    // 문구는 브라우저가 정하므로 내용은 보이지 않는다.
    event.returnValue = 'unsaved'
  }
  onMounted(() => target.addEventListener('beforeunload', onBeforeUnload))
  onBeforeUnmount(() => target.removeEventListener('beforeunload', onBeforeUnload))
}
