/**
 * Music Moments 도메인 타입 (M9).
 *
 * 설계: `docs/architecture/MOMENTS_DESIGN.md` §1 / **ADR 0019**
 *
 * `Track` 과 모양이 닮았지만 **참조하지 않는다.** Moment 는 플레이리스트의
 * 부속물이 아니라 영상에 대한 사용자의 기록이므로, 트랙·플레이리스트를 지워도
 * 남아야 한다 (ADR 0019 결정 1).
 */

/**
 * Moment 의 출처.
 *
 * `TrackSource` 와 값이 같지만 **별도 타입이다.** 재생 소스를 넓히는 것과
 * Moment 의 출처를 넓히는 것은 다른 결정이고, 한쪽을 넓혔을 때 다른 쪽이
 * 조용히 함께 넓어지면 검증이 의도 없이 느슨해진다.
 */
export type MomentSource = 'youtube'

/** 영상의 한 순간에 대한 사용자의 기록. */
export interface Moment {
  /** 앱 내부 식별자. `videoId` 와 다르다. */
  id: string
  source: MomentSource
  /** YouTube 영상 ID (11자). Moment 의 **유일한 외부 참조**다. */
  videoId: string
  /** 영상 시작점부터의 초. 0 이상 정수. */
  atSeconds: number
  /** 사용자 메모. 빈 문자열 허용. */
  note: string
  /**
   * 저장 당시 보이던 제목 (스냅샷).
   *
   * **빈 문자열이 유효한 값이다.** 표시 제목은 세 단계로 고른다 —
   * 라이브러리의 현재 제목 → 이 스냅샷 → `YouTube · <videoId>`
   * (`MOMENTS_DESIGN.md` §1-1). 비어 있다는 것이 "스냅샷이 없다" 를 뜻하므로,
   * 저장 시점에 대체 표기로 채우지 않는다. 채우면 2단계와 3단계가 구별되지
   * 않는다.
   */
  title: string
  /** ISO 8601 UTC. */
  createdAt: string
  /** ISO 8601 UTC. 메모를 고치면 갱신한다. */
  updatedAt: string
}

/** Moment 의 저장 형태. 순서는 **추가된 순서**이며 정렬은 화면이 한다. */
export type MomentsData = Moment[]
