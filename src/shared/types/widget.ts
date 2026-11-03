/**
 * 위젯 시스템의 데이터 모델.
 *
 * 위젯 **종류**(`WidgetType`)와 화면에 배치된 **인스턴스**(`WidgetInstance`)를
 * 구분한다. `clock`은 종류이고, 실제로 배치된 시계는 고유한 `instanceId`를
 * 갖는 인스턴스다.
 *
 * 컴포넌트를 들고 있는 `WidgetDefinition`은 `src/widgets/registry.ts`에 있다.
 * 이 파일은 순수 데이터만 둔다.
 */

/** 앱이 지원하는 위젯 종류. */
export type WidgetType = 'deck' | 'clock' | 'weather' | 'player' | 'mascot'

/** 런타임 검증과 순회를 위한 목록. */
export const WIDGET_TYPES = [
  'deck',
  'clock',
  'weather',
  'player',
  'mascot',
] as const satisfies readonly WidgetType[]

/** 저장된 레이아웃처럼 신뢰할 수 없는 값이 위젯 종류인지 확인한다. */
export function isWidgetType(value: unknown): value is WidgetType {
  return typeof value === 'string' && (WIDGET_TYPES as readonly string[]).includes(value)
}

/**
 * CSS Grid의 이름 있는 배치 영역.
 *
 * **고정 픽셀 좌표나 행·열 번호를 인스턴스에 저장하지 않는다.** 실제 위치는
 * `WidgetHost`의 `grid-template-areas`가 정의하고, 인스턴스는 "어느 영역에
 * 들어가는가"만 갖는다. 반응형 재배치는 미디어 쿼리에서 템플릿만 바꾸면 되므로
 * 데이터는 그대로 유지된다.
 *
 * 근거: `docs/decisions/0005-grid-area-layout-model.md`
 */
export type GridArea = 'deck' | 'mascot' | 'clock' | 'weather' | 'player'

/** 레이아웃에 배치된 위젯 하나. */
export interface WidgetInstance {
  /**
   * 인스턴스의 영속적 식별자.
   *
   * Vue의 `:key`로 쓰는 **유일한** 값이다. 테마나 배열 인덱스를 키에 섞으면
   * 재마운트가 일어나고 플레이어가 재생 상태를 잃는다
   * (`docs/decisions/0002-persistent-player-host.md`).
   */
  instanceId: string
  widgetType: WidgetType
  area: GridArea
}

/** 대시보드 레이아웃. MVP에서는 모듈 상수이며 사용자가 편집할 수 없다. */
export interface DashboardLayout {
  version: number
  items: readonly WidgetInstance[]
}
