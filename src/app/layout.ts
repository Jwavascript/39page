/**
 * MVP 고정 대시보드 레이아웃.
 *
 * **모듈 상수다.** 사용자가 편집할 수 없고 저장하지도 않는다. 위젯 추가·삭제·
 * 이동·크기 변경은 MVP 범위 밖이다 (`docs/product/BACKLOG.md` §1).
 *
 * 배치는 승인된 프로토타입을 따른다.
 *   왼쪽  상단: 데크(LP/카세트), 하단: 마스코트
 *   가운데: YouTube 재생 영역, 그 아래 플레이리스트 (M6)
 *   오른쪽 위에서 아래로: 시계, 날씨
 *
 * 실제 좌표는 `WidgetHost`의 `grid-template-areas`가 정의한다. 여기서는
 * "어느 이름 영역에 들어가는가"만 선언한다
 * (`docs/decisions/0005-grid-area-layout-model.md`).
 */
import type { DashboardLayout } from '@/shared/types'

/** 레이아웃 스키마 버전. 사용자 레이아웃 저장을 도입할 때 쓴다. */
export const DASHBOARD_LAYOUT_VERSION = 1

export const MVP_DASHBOARD_LAYOUT: DashboardLayout = {
  version: DASHBOARD_LAYOUT_VERSION,
  items: [
    { instanceId: 'deck-main', widgetType: 'deck', area: 'deck' },
    { instanceId: 'mascot-main', widgetType: 'mascot', area: 'mascot' },
    { instanceId: 'clock-main', widgetType: 'clock', area: 'clock' },
    { instanceId: 'weather-main', widgetType: 'weather', area: 'weather' },
    { instanceId: 'player-main', widgetType: 'player', area: 'player' },
    // M6-4 에서 추가. 플레이리스트를 드로어에서 꺼내 독립 표면으로 만들었다.
    { instanceId: 'playlist-main', widgetType: 'playlist', area: 'playlist' },
  ],
}
