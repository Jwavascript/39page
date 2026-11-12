/**
 * 트랙 행의 "관리" 를 펼친다 (M11-3). 이름 바꾸기 · 위 · 아래 · 삭제는 그 아래에 있다.
 *
 * 이미 펼쳐져 있으면 누르지 않는다 — "관리" 는 토글이고, 옮긴 뒤에도 펼친 채 남는다.
 */
import { nextTick } from 'vue'

interface Findable {
  find(selector: string): {
    exists(): boolean
    attributes(name: string): string | undefined
    trigger(event: string): Promise<void>
  }
}

export async function openTrackManage(wrapper: Findable, title: string): Promise<void> {
  const toggle = wrapper.find(`button.track-manage[aria-label="${title} 관리"]`)
  if (!toggle.exists()) throw new Error(`no manage button for track "${title}"`)
  if (toggle.attributes('aria-expanded') === 'true') return
  await toggle.trigger('click')
  await nextTick()
}
