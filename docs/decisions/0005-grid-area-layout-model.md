# 0005. 레이아웃은 이름 있는 Grid 영역으로 표현하고 좌표를 저장하지 않는다

- 상태: 채택
- 날짜: 2026-11-03
- 관련: `docs/architecture/SYSTEM_DESIGN.md` §5,
  `docs/decisions/0002-persistent-player-host.md`,
  `docs/decisions/0003-widget-registry-host.md`

## 배경

M1-4에서 위젯 인스턴스의 배치를 어떤 모델로 표현할지 정해야 했다.
`SYSTEM_DESIGN.md` §5.2는 `area: GridArea`와 `minSize?: GridSize`를 초안으로
두고, 두 타입의 구체적 표현을 TODO로 남겨두었다.

후보는 세 가지였다.

| 후보 | 표현                                                               |
| ---- | ------------------------------------------------------------------ |
| A    | 이름 있는 영역 (`'deck'`, `'clock'` …) + CSS `grid-template-areas` |
| B    | 행·열 좌표와 span (`{ row: 1, column: 2, rowSpan: 2 }`)            |
| C    | 12열 그리드의 열 인덱스와 폭                                       |

MVP의 레이아웃은 고정이고 사용자가 편집할 수 없다. 반면 백로그에는 위젯
이동·크기 변경이 있다.

## 결정

**A를 채택한다.** 인스턴스는 이름 있는 영역만 갖는다.

```ts
type GridArea = 'deck' | 'mascot' | 'clock' | 'weather' | 'player'

interface WidgetInstance {
  instanceId: string
  widgetType: WidgetType
  area: GridArea
}
```

- 실제 위치는 `WidgetHost`의 `grid-template-areas`가 정의한다.
- 인스턴스에 **고정 픽셀 좌표나 행·열 번호를 저장하지 않는다.**
- **별도의 영속 `GridSize` 모델을 만들지 않는다.** 사용자가 크기를 바꿀 수
  없으므로 저장할 크기가 없다. 최소 너비·높이·비율 같은 제약은 CSS
  (`--size-video-min`, `--ratio-deck` 등)나 필요한 최소 메타데이터로 표현한다.

## 대안

| 후보                  | 탈락 이유                                                                                                                       |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| B (행·열 좌표 + span) | 저장할 좌표가 아직 없다. MVP에서 쓰지 않는 모델을 미리 만들면 반응형 재배치마다 데이터를 다시 계산해야 한다 (규칙 9)            |
| C (12열 인덱스)       | 동일한 문제에 더해, 승인된 디자인의 `minmax(0, 1.13fr) minmax(420px, 0.87fr)` 비율을 12열로 근사하면 디자인이 달라진다 (규칙 6) |

## 결과

**얻는 것**

- **반응형이 데이터를 건드리지 않는다.** 1100px 이하에서 단일 열로 바뀔 때
  미디어 쿼리가 `grid-template-areas`만 교체한다. `WidgetInstance`는 그대로다.
  따라서 반응형 전환이 DOM 재배치나 언마운트를 유발하지 않는다 (ADR 0002).
- 레이아웃 선언이 읽기 쉽다. `area: 'clock'`이 "시계 자리"를 그대로 뜻한다.
- 승인된 디자인의 `fr` 비율을 그대로 쓸 수 있다.

**비용과 제약**

- 영역 이름이 CSS와 TypeScript 양쪽에 존재한다. CSS의
  `grid-template-areas`에 없는 이름을 쓰면 해당 위젯은 자동 배치된다.
  `GridArea` 유니온과 CSS 템플릿이 어긋나지 않게 유지해야 한다.
- 영역 이름이 유한하므로 **같은 종류의 위젯을 두 개 배치할 수 없다**
  (시계 2개 등). MVP 범위에서는 필요하지 않다.
- 위젯 편집을 구현할 때 이 모델은 충분하지 않다. 그때 행·열 좌표와 span을
  포함한 확장 모델을 다시 검토한다. `WidgetInstance`에 좌표 필드를 더하거나
  `area`를 유니온에서 문자열로 넓히는 방향이 될 것이다.

TODO: 위젯 편집 착수 시 확장 모델 재검토 (`docs/product/BACKLOG.md` §1)
