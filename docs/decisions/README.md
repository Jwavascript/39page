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

| #                                         | 제목                                                           | 상태 |
| ----------------------------------------- | -------------------------------------------------------------- | ---- |
| [0001](0001-theme-switching-mechanism.md) | 테마 전환은 루트 속성 교체로 한다                              | 채택 |
| [0002](0002-persistent-player-host.md)    | 플레이어 iframe은 부모를 고정하고 Vue 재조정 대상에서 제외한다 | 채택 |
| [0003](0003-widget-registry-host.md)      | 최소 Widget Registry / Widget Host를 M1에 도입한다             | 채택 |
| [0004](0004-unapplied-reference-rules.md) | 승인된 레퍼런스에서 적용되지 않는 규칙은 작성된 의도를 따른다  | 채택 |

나머지 선행 결정 사항은 `docs/development/IMPLEMENTATION_PLAN.md`의
"선행 결정 사항" 표를 참조한다.
