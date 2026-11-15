/**
 * 보관함 닫기 단추 (M11-7C UAT) — 띠 배치(가로 화면)는 영상 띠 오른쪽 위의 `.strip-close`, 쌓기 · 옆 배치는
 * 보관함 머리말의 `.close`. 지금 배치에서 보이는 쪽을 고른다.
 */
import type { VueWrapper } from '@vue/test-utils'

export function archiveCloseButton(wrapper: Pick<VueWrapper, 'find' | 'get'>) {
  const inHead = wrapper.find('#archive-panel .archive-head .close')
  return inHead.exists() ? inHead : wrapper.get('.strip-close')
}
