/**
 * 트랙 행의 동작을 쓸 준비를 한다.
 *
 * M11-3 에서는 행의 "관리" 를 펼쳐야 이름 바꾸기 · 삭제가 보였다. ADR 0044 에서 "관리" 메뉴를 없애고
 * 이름 바꾸기(연필) · 앨범아트 · 공유 · 삭제(휴지통)를 **행 오른쪽의 아이콘**으로 늘 보이게 했다. 이 도우미는
 * 이제 그 행의 아이콘이 있는지만 확인한다 — 부르는 쪽은 그대로 `aria-label` 로 아이콘을 누른다.
 */
import { nextTick } from 'vue'

interface Findable {
  find(selector: string): {
    exists(): boolean
  }
}

export async function openTrackManage(wrapper: Findable, title: string): Promise<void> {
  const icon = wrapper.find(`button.track-rename[aria-label="${title} 이름 변경"]`)
  if (!icon.exists()) throw new Error(`no row icons for track "${title}"`)
  await nextTick()
}

interface Clickable {
  find(selector: string): {
    exists(): boolean
    attributes(name: string): string | undefined
    trigger(event: string): Promise<void>
  }
}

/**
 * 순서 모드(⇅)를 켜거나 끈다 (ADR 0044). 한 칸 위 · 아래 단추는 순서 모드에만 있다 — 맨 위 · 맨 아래는
 * 손잡이의 Home · End 다.
 */
export async function setReorderMode(wrapper: Clickable, on: boolean): Promise<void> {
  const toggle = wrapper.find('button.edit-toggle')
  if (!toggle.exists()) throw new Error('no reorder toggle')
  if ((toggle.attributes('aria-pressed') === 'true') !== on) await toggle.trigger('click')
  await nextTick()
}
