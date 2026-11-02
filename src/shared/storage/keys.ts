/**
 * 고정 저장 키.
 *
 * 키에 버전을 넣지 않는다. 스키마 버전은 저장 객체 안의 `version` 필드로
 * 관리한다 (`defineStorage`의 `StorageEnvelope`). 키를 버전과 함께 바꾸면
 * 이전 데이터를 찾을 수 없어 마이그레이션이 불가능해진다.
 *
 * 용도별로 분리한다. 테마 전환이 라이브러리 쓰기를 유발하지 않게 하려는 것이다
 * (`docs/architecture/SYSTEM_DESIGN.md` §7).
 */
export const STORAGE_KEYS = {
  /** 플레이리스트·트랙·선택 목록·현재 트랙. 구체 스키마는 M2에서 확정한다. */
  library: '39page.library',
  /** 선택한 테마 키. 구체 스키마는 M1-3에서 확정한다. */
  theme: '39page.theme',
} as const

export type StorageKey = (typeof STORAGE_KEYS)[keyof typeof STORAGE_KEYS]
