/**
 * 모달 안에서 Tab 이 밖으로 나가지 않게 처음 ↔ 끝을 잇는다.
 *
 * `DataDialog` 와 같은 방식이다 — jsdom 에 `<dialog>` 의 `showModal` 이 없어 직접 구현한다. 뒤쪽을 막는 `inert` 와
 * Escape 는 셸이 맡는다. 테마와 무관한 UI 도구라 `components/ui` 에 둔다.
 */
import type { Ref } from 'vue'

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/** 대화상자 루트의 `@keydown` 에 건다. */
export function useFocusTrap(
  container: Readonly<Ref<HTMLElement | null>>,
): (event: KeyboardEvent) => void {
  function focusables(): HTMLElement[] {
    if (container.value === null) return []
    return [...container.value.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
      (element) => !element.closest('[hidden]'),
    )
  }

  return (event: KeyboardEvent): void => {
    if (event.key !== 'Tab') return
    const items = focusables()
    const first = items[0]
    const last = items[items.length - 1]
    if (first === undefined || last === undefined) {
      event.preventDefault()
      return
    }
    const active = document.activeElement
    if (event.shiftKey && (active === first || active === container.value)) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && active === last) {
      event.preventDefault()
      first.focus()
    }
  }
}
