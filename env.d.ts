/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * 확장 저장 브리지를 부를 수 있는 Chrome 확장 ID — 쉼표로 나눈다 (M11-5 · ADR 0028).
   * 비어 있으면 `bridge.html` 은 아무 요청도 받지 않는다.
   */
  readonly VITE_BRIDGE_EXTENSION_IDS?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
