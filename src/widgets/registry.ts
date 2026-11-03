/**
 * Widget Registry.
 *
 * 앱이 제공하는 위젯 **종류**를 선언적으로 등록하고 조회한다.
 * 프로젝트 내부의 정적 위젯만 다룬다. 동적 모듈 로더, 플러그인 시스템,
 * 외부 위젯 실행은 두지 않는다.
 *
 * **테마에 종속되지 않는다.** 테마 전환으로 레지스트리를 다시 만들거나
 * 컴포넌트를 교체하지 않는다. 테마별로 외형이 완전히 다른 데크 아트도
 * 컴포넌트 교체가 아니라 **CSS 표시 전환**으로 처리한다
 * (`docs/decisions/0001-theme-switching-mechanism.md`).
 * 그래서 정의는 `resolve(theme)` 함수가 아니라 정적 `component`를 갖는다.
 */
import type { Component } from 'vue'

import { WIDGET_TYPES, isWidgetType, type GridArea, type WidgetType } from '@/shared/types'
import DeckWidget from '@/features/deck/DeckWidget.vue'
import MascotPanel from '@/features/mascot/MascotPanel.vue'
import PlayerSurface from '@/features/playback/PlayerSurface.vue'
import WidgetPlaceholder from '@/widgets/placeholders/WidgetPlaceholder.vue'

export interface WidgetDefinition {
  /** 위젯 종류를 식별한다. */
  type: WidgetType
  /** 사람이 읽는 표시 이름. */
  title: string
  /**
   * 렌더링할 컴포넌트.
   *
   * 현재는 모두 개발용 플레이스홀더다. 실제 컴포넌트가 준비되면 이 값만
   * 바꾼다. `DashboardShell` / `WidgetHost`는 수정하지 않는다.
   */
  component: Component
  /** 컴포넌트에 넘길 props. 플레이스홀더에 영역 이름을 알려주는 데 쓴다. */
  componentProps?: Readonly<Record<string, unknown>>
  /** 레이아웃을 선언할 때 쓰는 기본 배치 영역. */
  defaultArea: GridArea
  /** 아래 세 값은 편집 기능(백로그)을 위한 메타데이터다. MVP에서는 모두 false다. */
  movable: boolean
  resizable: boolean
  removable: boolean
  /**
   * 재마운트가 금지되는 위젯.
   *
   * 플레이어 iframe은 언마운트는 물론 **부모가 바뀌기만 해도 재로드된다.**
   * `docs/decisions/0002-persistent-player-host.md`
   */
  persistent?: boolean
  /**
   * 위젯 단위 스킨 키 목록. 테마와 독립적인 축이다.
   *
   * 스킨 선택은 백로그이고 아직 스킨이 하나도 없으므로 현재 모두 미지정이다.
   * 확장 지점으로만 열어둔다 (`docs/product/BACKLOG.md` §1).
   */
  skins?: readonly string[]
}

/**
 * MVP에서는 편집 기능이 없으므로 이동·크기 변경·삭제를 모두 막는다.
 * 백로그 단계에서 위젯별로 열어준다.
 */
const NOT_EDITABLE = { movable: false, resizable: false, removable: false } as const

const DEFINITIONS: Record<WidgetType, WidgetDefinition> = {
  deck: {
    type: 'deck',
    title: 'LP · 카세트 데크',
    // M1-6에서 플레이스홀더를 실제 데크 아트로 교체했다.
    // 두 테마의 아트를 모두 품은 단일 컴포넌트다 (ADR 0001).
    component: DeckWidget,
    defaultArea: 'deck',
    ...NOT_EDITABLE,
  },
  mascot: {
    type: 'mascot',
    title: '마스코트',
    // M1-6에서 정적 도트 마스코트로 교체했다. 애니메이션은 M4 다.
    component: MascotPanel,
    defaultArea: 'mascot',
    ...NOT_EDITABLE,
  },
  clock: {
    type: 'clock',
    title: '시계',
    component: WidgetPlaceholder,
    componentProps: { label: 'CLOCK', plannedIn: 'M4' },
    defaultArea: 'clock',
    ...NOT_EDITABLE,
  },
  weather: {
    type: 'weather',
    title: '날씨',
    component: WidgetPlaceholder,
    componentProps: { label: 'WEATHER', plannedIn: 'M4' },
    defaultArea: 'weather',
    ...NOT_EDITABLE,
  },
  player: {
    type: 'player',
    title: 'YouTube 플레이어',
    // M1-5에서 플레이스홀더를 PlayerSurface 로 교체했다.
    // 실제 YouTube 어댑터는 M3에서 주입한다.
    component: PlayerSurface,
    defaultArea: 'player',
    ...NOT_EDITABLE,
    // 재마운트가 금지된다. iframe 은 부모가 바뀌기만 해도 재로드된다.
    persistent: true,
  },
}

/** 등록된 위젯 종류 목록. 선언 순서를 따른다. */
export const REGISTERED_WIDGET_TYPES: readonly WidgetType[] = WIDGET_TYPES

/** 등록된 정의를 돌려준다. 알려진 종류만 받는다. */
export function getWidgetDefinition(type: WidgetType): WidgetDefinition {
  return DEFINITIONS[type]
}

/**
 * 신뢰할 수 없는 값으로 정의를 찾는다.
 *
 * 알 수 없는 종류면 `undefined`를 돌려준다. 던지지 않는다.
 * 저장된 레이아웃이 구버전일 수 있기 때문이다.
 */
export function findWidgetDefinition(type: unknown): WidgetDefinition | undefined {
  // `in` 이나 직접 인덱싱을 쓰지 않는다. 프로토타입 체인 때문에
  // 'toString' 같은 값이 통과해 함수가 정의로 반환된다.
  return isWidgetType(type) ? DEFINITIONS[type] : undefined
}

/** 모든 정의를 선언 순서대로 돌려준다. */
export function listWidgetDefinitions(): readonly WidgetDefinition[] {
  return REGISTERED_WIDGET_TYPES.map((type) => DEFINITIONS[type])
}
