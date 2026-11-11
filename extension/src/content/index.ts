/**
 * content script 진입점. Background 가 `scripting.executeScript({ files })` 로
 * 사용자가 아이콘을 누른 탭에만 주입한다 (manifest 에 선언하지 않는다).
 */
import { createContentListener, installContentListener, type ContentListener } from './listener'
import { readPageSnapshot } from './readPage'

installContentListener(
  chrome.runtime.onMessage as unknown as {
    addListener(listener: ContentListener): void
    removeListener(listener: ContentListener): void
  },
  globalThis as unknown as Record<string, unknown>,
  createContentListener({
    extensionId: chrome.runtime.id,
    read: () => readPageSnapshot(document, location.href),
  }),
)
