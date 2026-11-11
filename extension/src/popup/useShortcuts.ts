/**
 * 팝업에 보여 줄 단축키 (M10-5). 사용자가 바꿀 수 있고 다른 단축키와 겹치면 지정되지
 * 않으므로 manifest 의 제안값이 아니라 **지금 지정된 값**을 보여 준다.
 */
import { onMounted, ref, type Ref } from 'vue'

import type { PopupBridge, ShortcutCommand } from './bridge'

export function useShortcuts(bridge: PopupBridge): {
  shortcuts: Ref<Partial<Record<ShortcutCommand, string>> | null>
  openSettings: () => Promise<void>
} {
  const shortcuts = ref<Partial<Record<ShortcutCommand, string>> | null>(null)
  onMounted(async () => {
    shortcuts.value = await bridge.shortcuts()
  })
  return { shortcuts, openSettings: () => bridge.openShortcutSettings() }
}
