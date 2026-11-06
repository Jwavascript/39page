# 결정 기록 (ADR)

중요한 기술 결정을 하나의 파일로 기록한다.

- 파일명: `NNNN-short-title.md` (예: `0001-theme-token-strategy.md`)
- 새 라이브러리 추가, 아키텍처 변경, 외부 API 선택은 기록 대상이다
  (`AGENTS.md` 규칙 8).

## 틀

```markdown
# NNNN. 제목

- 상태: 제안 | 채택 | 폐기 | 대체됨
- 날짜: YYYY-MM-DD

## 배경

## 결정

## 대안

## 결과
```

## 기록된 결정

| #                                             | 제목                                                                                 | 상태              |
| --------------------------------------------- | ------------------------------------------------------------------------------------ | ----------------- |
| [0001](0001-theme-switching-mechanism.md)     | 테마 전환은 루트 속성 교체로 한다                                                    | 채택              |
| [0002](0002-persistent-player-host.md)        | 플레이어 iframe은 부모를 고정하고 Vue 재조정 대상에서 제외한다                       | 채택              |
| [0003](0003-widget-registry-host.md)          | 최소 Widget Registry / Widget Host를 M1에 도입한다                                   | 채택              |
| [0004](0004-unapplied-reference-rules.md)     | 승인된 레퍼런스에서 적용되지 않는 규칙은 작성된 의도를 따른다                        | 채택              |
| [0005](0005-grid-area-layout-model.md)        | 레이아웃은 이름 있는 Grid 영역으로 표현하고 좌표를 저장하지 않는다                   | 채택              |
| [0006](0006-player-adapter-ownership.md)      | 플레이어 어댑터는 PlayerSurface가 비반응형으로 보유하고 팩토리로 주입한다            | 채택              |
| [0007](0007-library-data-protection.md)       | 읽지 못한 라이브러리 원본은 보호 상태로 두고 덮어쓰지 않는다                         | 채택              |
| [0008](0008-player-adapter-event-contract.md) | 플레이어 어댑터 이벤트는 mount 시 넘기는 핸들러 묶음으로 전달한다                    | 채택              |
| [0009](0009-playback-coordinator.md)          | 라이브러리와 재생은 Playback Coordinator 가 잇고, 어댑터는 PlayerSurface 가 등록한다 | 채택              |
| [0010](0010-transport-state-announcements.md) | 재생 상태는 라이브 리전이 아니라 부제에 적고, 토글 버튼은 상태에 맞는 이름을 쓴다    | 채택              |
| [0011](0011-player-visibility-guard.md)       | 가시성은 순수 측정으로 판정하고, 가리는 쪽이 미리 통지한다                           | 채택 (M6·M7 개정) |
| [0012](0012-playback-failure-handling.md)     | 재생 실패는 종류별로 설명하고, 늦은 사건보다 조용한 실패를 더 경계한다               | 채택              |
| [0013](0013-weather-provider.md)              | 날씨는 Open-Meteo 에서 키 없이 받고, 위치는 서울로 고정한다                          | 채택              |
| [0014](0014-layout-finishing.md)              | 레이아웃 마무리는 DOM 래퍼 없이 하고, 실측으로 검증한다                              | 채택              |
| [0015](0015-deployment-target.md)             | 배포는 Cloudflare Workers Static Assets 로 하고 표준 origin 을 apex 하나로 고정한다  | 채택              |
| [0016](0016-playlist-surface-split.md)        | 플레이리스트와 트랙을 두 표면으로 나누고, 플레이리스트는 위젯으로 꺼낸다             | 채택 (M7 개정)    |
| [0017](0017-deck-transport.md)                | 데크에 그려진 트랜스포트를 네이티브 버튼으로 덮어 동작하게 한다                      | 채택              |
| [0018](0018-json-backup-restore.md)           | JSON 백업 파일은 저장 봉투를 품고, 가져오기는 승인 전까지 읽기 전용이다              | 채택 (설계)       |

나머지 선행 결정 사항은 `docs/development/IMPLEMENTATION_PLAN.md`의
"선행 결정 사항" 표를 참조한다.
