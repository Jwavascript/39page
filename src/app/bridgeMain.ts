/**
 * 확장 저장 브리지 입구 (`bridge.html`, M11-5 · ADR 0028).
 *
 * 대시보드를 싣지 않는다 — Vue 앱 · 플레이어 · 위젯이 없다. Pinia 와 라이브러리 · Moments store 만
 * 올리고, 확장의 offscreen 문서 안에서만 요청을 받는다 (`startBridge` 가 자리를 먼저 확인한다).
 *
 * 허용 확장 ID 는 빌드에 박는다 (`VITE_BRIDGE_EXTENSION_IDS`). 비어 있으면 브리지는 켜지지 않는다 —
 * 운영 확장 ID 가 정해지기 전(스토어 등록 전)에는 운영 브리지가 일하지 않는다.
 */
import { createPinia } from 'pinia'

import { createBridgeHandler } from '@/features/bridge/bridgeHandler'
import { startBridge } from '@/features/bridge/bridgeHost'
import { parseAllowedExtensionOrigins } from '@/features/bridge/bridgeProtocol'
import { libraryStorage, useLibraryStore } from '@/stores/library'
import { momentsStorage, useMomentsStore } from '@/stores/moments'

const allowed = parseAllowedExtensionOrigins(import.meta.env.VITE_BRIDGE_EXTENSION_IDS)

const outcome = startBridge(window, allowed, () => {
  const pinia = createPinia()
  const library = useLibraryStore(pinia)
  const moments = useMomentsStore(pinia)
  library.restore()
  moments.restore()
  return createBridgeHandler({
    library,
    moments,
    readLibrary: () => libraryStorage.read(),
    readMoments: () => momentsStorage.read(),
  })
})

document.documentElement.dataset.bridge = outcome
