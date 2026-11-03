# 무인 연속 실행 로그

> 이 파일은 **작업 로그**다. 실행이 중단됐다가 다시 시작해도 이 로그와
> `git log` 를 읽으면 이어서 진행할 수 있도록 적는다.
>
> 지시: M3-4 → M3-5 → M4 → M5 를 중간 승인 없이 순서대로 진행한다.
> 기준 커밋: `8c8efe8` (M3-3 완료, 테스트 617개 통과).

## 진행 현황

| 단계 | 범위                               | 상태    | 커밋   |
| ---- | ---------------------------------- | ------- | ------ |
| M3-4 | 가시성 가드와 드로어 연동          | 완료    | (아래) |
| M3-5 | 오류·예외 처리와 재생 안정화       | 진행 중 | —      |
| M4   | 시계·날씨·데크·마스코트 애니메이션 | 대기    | —      |
| M5   | 반응형·접근성·통합 검증·안정화     | 대기    | —      |

## 공통 제약 (매 단계에서 지킨다)

- 테마 전환·드로어 여닫기에서 `PlayerSurface` 재생성 금지, iframe 노드 동일성 유지
- `PlayerAdapter` 인스턴스와 DOM 노드를 Pinia state 에 넣지 않는다
- `library` store 와 `playback` store 는 서로를 import 하지 않는다
- `design/references/` 는 읽기 전용
- 손상·미지원 저장 데이터를 자동 삭제하거나 조용히 덮어쓰지 않는다 (ADR 0007)
- 가려진 iframe 으로 오디오만 재생하지 않는다 (개발자 정책 III.I.9)
- 검증 명령 5종(`type-check` `test` `lint` `format:check` `build`)을 단계마다 실행한다

## 단계별 기록

### M3-4 — 가시성 가드와 드로어 연동 (완료)

기준 문서: `IMPLEMENTATION_PLAN.md` M3-4, `SYSTEM_DESIGN.md` §4.5 · §8.1,
`MVP_SPEC.md` F3, 프로토타입 `syncVisibility()` / `toggleDrawer()`.

**설계**: ADR 0011. 판정은 순수 함수(`measurePlayerVisibility`), 재평가는
`IntersectionObserver` + `resize`, 가리기 직전 통지는 `DashboardShell` 이
한다. 거절된 재생 요청은 큐를 바꾸지 않는다.

**추가 파일**

- `src/features/playback/playerVisibility.ts`
- `docs/decisions/0011-player-visibility-guard.md`
- `tests/unit/player-visibility.spec.ts` (57)
- `tests/support/playerLayout.ts` (jsdom 레이아웃 보정)

**수정 파일**: `playbackCoordinator.ts` · `createPlaybackCoordinator.ts` ·
`PlayerSurface.vue` · `DashboardShell.vue` · `RecordLibraryDrawer.vue` ·
`vitest.config.ts`(타임아웃) · 기존 spec 3개(레이아웃 보정 설치) · 문서 5종.

**브라우저 검증에서 발견해 고친 문제**: 1100px 이하 단일 열 배치에서
플레이어가 화면 한참 아래(top 1247px)에 놓여 **모든 재생이 거절**됐다.
`reveal()` (재생 요청 시 1회 `scrollIntoView`)로 해결. 레이아웃은 그대로.

**검증**: type-check / test / lint / format:check / build 전부 통과.
테스트 674개 (M3-3 종료 시 617 → +57). 돌연변이 20종 전부 검출.

**브라우저 실측** (headless Chromium, 실제 YouTube):
1440×813 드로어 닫힘 536×301 · 열림 420×236 · 1000×713 닫힘 871×490
(top 1247) · 열림 0×0(`display:none`). 사전 통지·관찰자 중단·드로어 거절
안내·iframe 동일성 모두 확인. **`PLAYING` 은 여전히 관측 못 함** — 헤드리스
에서 임베드가 `불러오는 중` 을 넘지 못한다.

**남긴 문제**: 거절·중단 안내가 상황이 해소된 뒤에도 `.status` 에 남는다.
문구 정리는 M5 5.5 에서 함께 한다.

### M3-5 — 오류·예외 처리와 재생 안정화 (진행 중)

TODO: 구현 후 결과 기록
