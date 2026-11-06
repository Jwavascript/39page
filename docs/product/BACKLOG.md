# 확장 백로그 (MVP 이후)

> 상태: 백로그. **MVP 범위에 포함되지 않는다.**
> 여기 있는 항목은 M1–M5 어느 마일스톤에도 속하지 않는다.
>
> 관련: [`ROADMAP.md`](ROADMAP.md), [`MVP_SPEC.md`](MVP_SPEC.md) §3

MVP(M1–M5)를 완료한 뒤에 검토한다. 지금은 구현하지 않으며,
일정·순서·범위를 확정하지 않는다.

## 1. 위젯 시스템 확장

| 항목                | 설명                                       | 선행 조건          |
| ------------------- | ------------------------------------------ | ------------------ |
| 위젯 자유 이동      | 드래그로 위젯 위치 변경                    | 아래 ⚠️ 제약 참조  |
| 위젯 크기 변경      | 리사이즈 핸들로 그리드 범위 변경           | 동일               |
| 위젯 추가·삭제      | 사용 가능한 위젯 목록에서 선택해 배치/제거 | 레이아웃 영속화    |
| 개별 위젯 스킨 선택 | 테마와 독립적으로 위젯별 스킨 지정         | 스킨 2종 이상 존재 |

> ⚠️ **이미 확정된 구조 제약**: 플레이어 iframe은 DOM에서 부모가 바뀌면 재로드된다.
> 따라서 레이아웃 엔진은 **DOM 노드를 재배치하지 않고 CSS로만 배치**해야 한다
> (`grid-area` 등). DOM 노드를 옮기는 드래그 라이브러리는 사용할 수 없다.
> 상세: [`../decisions/0002-persistent-player-host.md`](../decisions/0002-persistent-player-host.md),
> [`../architecture/SYSTEM_DESIGN.md`](../architecture/SYSTEM_DESIGN.md) §4.4

**M1에서 미리 마련하는 확장 지점** (`../decisions/0003-widget-registry-host.md`)

M1의 Widget Registry / Widget Host 아키텍처는 이 백로그를 염두에 두고 설계한다.
백로그 항목을 구현하지는 않지만, 나중에 컴포넌트 트리를 다시 쓰지 않도록
다음 자리만 비워둔다.

- `WidgetDefinition.movable` / `.resizable` / `.removable` / `.skins`
- `WidgetInstance.area` / `.skin`
- `DashboardLayout` (M1–M5에서는 모듈 상수, 사용자 편집 불가)

즉 **아키텍처는 유지하고, 편집 기능만 백로그로 미룬다.**

## 2. 테마·위젯 스토어

사용자가 테마와 위젯을 탐색·설치·공유하는 스토어.

TODO: 배포 모델 확정 (내장 목록 / 원격 레지스트리 / 사용자 업로드)
TODO: 서버 필요 여부 — 현재 39page는 클라이언트 전용 구조다
(`../architecture/SYSTEM_DESIGN.md` §1)
TODO: 서드파티 테마의 보안 경계 (임의 CSS·JS 실행 범위)
TODO: 위젯 스킨 패키지 형식

## 3. Chrome 확장 프로그램

브라우저 새 탭 또는 팝업으로 39page를 띄우는 확장.

TODO: 형태 확정 (새 탭 대체 / 팝업 / 사이드 패널)
TODO: 확장 환경에서의 YouTube IFrame API 제약 확인 — CSP, 자동재생 정책,
가시성 가드(`../architecture/SYSTEM_DESIGN.md` §4.5)와의 상호작용
TODO: 저장 매체 — `localStorage` 대신 `chrome.storage` 필요 여부.
`src/shared/storage/` 추상화가 이 교체를 흡수할 수 있는지 확인
TODO: 웹 버전과의 코드 공유 범위

## 4. AI 음악 추천 및 작곡 지원

TODO: 범위 확정 (추천만 / 플레이리스트 자동 생성 / 작곡 보조)
TODO: 모델·제공자 선정 (`AGENTS.md` 규칙 8에 따라 검토 후 ADR 기록)
TODO: 서버 필요 여부 및 API 키 보호
TODO: MVP에서 제외한 "AI 에이전트"와의 관계 정리 (`MVP_SPEC.md` §3)

## 5. 재생 모드 확장

M3-0 에서 MVP 제외로 확정했다 (`MVP_SPEC.md` F3).

| 항목             | 설명                             | 제외 이유                                             |
| ---------------- | -------------------------------- | ----------------------------------------------------- |
| 반복(loop)       | 한 곡 반복 / 큐 전체 반복        | 승인된 프로토타입에 **UI가 없다.** 큐 끝에서 정지한다 |
| 셔플             | 큐 순서 무작위화                 | 같음. 큐는 플레이리스트 순서를 그대로 따른다          |
| 자체 볼륨 컨트롤 | 앱이 직접 제공하는 볼륨 슬라이더 | YouTube 기본 컨트롤에 위임한다 (`controls: 1`)        |

셋 다 재생 로직만으로 끝나지 않고 **트랜스포트 UI를 늘려야** 한다. 승인된
디자인에 없는 컨트롤을 MVP에서 새로 만들지 않는다 (`AGENTS.md` 규칙 6).
반복·셔플을 넣을 때는 큐 진행 로직(`playback` store)과 컨트롤 디자인을
함께 확정해야 한다.

## 6. 기타 MVP 제외 항목

`MVP_SPEC.md` §3에서 제외한 항목이다. 백로그로 승격할지 미정이다.

- 로컬 음악 파일 재생
- 집중 모드
- 소셜 기능 (공유, 팔로우, 공동 플레이리스트)

TODO: 각 항목을 백로그로 승격할지 폐기할지 결정

## 7. 날씨 도시 선택

ADR 0013 이 미뤄 둔 항목이다. 승인된 디자인에 컨트롤이 없으므로 컨트롤
디자인과 영속화를 함께 확정해야 한다.

기획: [`../development/POST_MVP_PLAN.md`](../development/POST_MVP_PLAN.md) 트랙 A
(지오코딩 제공자·CORS·레이트리밋 실측 확인 완료, 서버 불필요, 새 의존성 0개)

TODO: 컨트롤 디자인 승인 · 시계 연동 여부 결정

## 8-0. JSON 백업·복원 — **M8 로 승격 (설계 완료)**

계정 없이 데이터를 꺼내고 되살리는 최소 기능. `POST_MVP_PLAN.md` §B.12 의
**B-0** 이며, 의존성·서버·계정이 전혀 없다.

설계는 끝났고 구현이 남았다 —
[`BACKUP_RESTORE.md`](BACKUP_RESTORE.md) ·
[`../architecture/BACKUP_FORMAT.md`](../architecture/BACKUP_FORMAT.md) ·
ADR 0018 · `IMPLEMENTATION_PLAN.md` M8.

## 8. 계정과 기기 간 동기화

`MVP_SPEC.md` §3 의 제외 항목(서버 계정 시스템)이다.
`SYSTEM_DESIGN.md` §1 의 **클라이언트 전용 결정을 번복**하는 일이므로
ADR 이 선행한다.

기획: [`../development/POST_MVP_PLAN.md`](../development/POST_MVP_PLAN.md) 트랙 B

- 해결하는 문제는 "새로고침 보존"이 아니라 **기기 간 동기화와 사이트 데이터
  삭제 내구성**이다. 새로고침 보존은 이미 동작한다.
- **배포 origin 확정이 선행 조건**이다. `localStorage` 는 origin 단위이고
  OAuth 리다이렉트 URL 을 미리 등록해야 한다.
- 계정 없이도 앱은 그대로 동작해야 한다 (로컬 우선).

TODO: 제공자·SDK 결정 · 배포 도메인 확정
