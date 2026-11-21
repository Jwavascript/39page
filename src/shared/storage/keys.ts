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
  /**
   * Music Moments (M9). 라이브러리와 **다른 키**다.
   *
   * 같은 키에 넣지 않는 이유: 백업 가져오기는 라이브러리를 통째로
   * 교체하므로, 한 키에 있으면 복원이 Moment 를 함께 날린다. 키가
   * 다르면 그 교체가 Moment 에 닿지 않는다 (ADR 0019 결정 3).
   */
  moments: '39page.moments',
  /**
   * 커스텀 테마의 색 (ADR 0045). 테마 키와 **다른 키**다 — 테마를 바꿔도 고른 색이 남고, 색을 바꿔도
   * 테마 선택을 다시 쓰지 않는다. 데크 그림은 크기 때문에 IndexedDB `39page-theme` 에 있다.
   */
  customTheme: '39page.customTheme',
  /**
   * 직접 고른 가사 (ADR 0046) — 영상마다 LRCLIB 레코드 id. 가사 글자는 넣지 않는다. 백업에 아직 넣지 않는다.
   */
  lyrics: '39page.lyrics',
} as const

export type StorageKey = (typeof STORAGE_KEYS)[keyof typeof STORAGE_KEYS]

/**
 * 수정 번호 키 (M10-3 안정화, ADR 0025).
 *
 * 사용자 데이터가 아니다. 탭 간 쓰기 잠금의 **영수증**이 가리키는 번호를 둔다 —
 * 라이브러리·Moments 를 쓸 때마다 1 씩 오른다. 위 키와 스키마는 그대로이고, 이 키는
 * 백업에 넣지 않는다. 없거나 망가졌으면 0 으로 본다. 이 키를 모르는 옛 버전은 무시한다.
 */
export const REVISION_KEYS = {
  library: '39page.library.rev',
  moments: '39page.moments.rev',
} as const
