import { nextTick, onScopeDispose, readonly, ref, type Ref } from 'vue'

/** 페이지 안의 UI 상태. 저장소·Fullscreen API·플레이어를 변경하지 않는다. */
export function useHeaderCollapse(shell: Ref<HTMLElement | null>, afterLayout: () => void) {
  const expanded = ref(true)
  let frame: number | null = null
  let restoreAnchor: (() => void) | null = null
  let sequence = 0

  function finish(): void {
    if (frame !== null) window.cancelAnimationFrame(frame)
    frame = null
    restoreAnchor?.()
    restoreAnchor = null
  }

  async function toggle(): Promise<void> {
    finish()
    const element = shell.value
    const header = element?.querySelector<HTMLElement>('.app-header')
    const workspace = element?.querySelector<HTMLElement>('.workspace')
    if (element == null || header == null || workspace == null) return
    const mine = ++sequence
    const x = window.scrollX
    const y = window.scrollY
    const before = workspace.getBoundingClientRect().top
    // 헤더가 이미 화면 위로 나갔으면 보고 있던 콘텐츠의 위치를 지킨다.
    const keepContent = y > 0 && header.getBoundingClientRect().bottom <= 0
    const anchor = element.style.overflowAnchor
    element.style.overflowAnchor = 'none'
    restoreAnchor = () => {
      element.style.overflowAnchor = anchor
    }
    expanded.value = !expanded.value
    await nextTick()
    if (mine !== sequence) return
    const after = workspace.getBoundingClientRect().top
    const top = Math.max(0, y + (keepContent ? after - before : 0))
    if (window.scrollX !== x || window.scrollY !== top) {
      window.scrollTo({ left: x, top, behavior: 'instant' })
    }
    afterLayout()
    element.querySelector<HTMLButtonElement>('.header-toggle')?.focus({ preventScroll: true })
    // 브라우저의 자동 스크롤 앵커 보정과 중복되지 않게 첫 페인트까지 유지한다.
    frame = window.requestAnimationFrame(finish)
  }

  onScopeDispose(() => {
    sequence += 1
    finish()
  })
  return { expanded: readonly(expanded), toggle }
}
