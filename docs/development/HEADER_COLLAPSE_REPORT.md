# M12-6 후속 패치 — 헤더 접기·펼치기 (2026-11-15)

- 시작: `m12-6-artwork-editor-ux`, `f2b290f`, 작업 트리 깨끗함.
- 작업 브랜치: `m12-6-header-collapse`. 로컬 구현·검증·문서·커밋만 수행한다.
- 정책 근거: [ADR 0036](../decisions/0036-collapsible-dashboard-header.md).

## 구현

기존 헤더에 헤더 접기 버튼을 추가했다. 접으면 사이트명·전역 메뉴·테마 선택을 숨기고 상단의 헤더 펼치기 버튼만 남는다.
펼치면 기존 DOM과 메뉴 상태를 복원한다. 네이티브 버튼의 Enter/Space, aria-expanded·aria-controls·동적 이름, 44px 목표를 제공한다.
메뉴는 hidden으로 접근성 트리·Tab 순서에서 제외하고 전환 후 포커스가 숨긴 메뉴에 남지 않게 한다.

상태는 현재 페이지 메모리에만 둔다. 테마·보관함 전환에는 유지하고 새로고침하면 기본 펼침이다.
기존 저장 설정에 헤더 선택을 섞지 않았으며 새 저장 필드·키·의존성은 없다.

접힌 상태에서는 헤더 높이와 상단 여백·워크스페이스 간격을 줄여 실제 대시보드 시작 위치를 올린다.
대시보드 열·위젯 순서·플레이어/카드 상대 위치·Artwork Editor·테마 원본·데이터 모델·ZIP은 수정하지 않았다.
F11이나 Fullscreen API를 호출하지 않는다.

## 스크롤과 재생

헤더가 보이는 상태에서 접기·펼치기는 scrollY를 유지한다. 헤더가 이미 화면 위로 나갔을 때는 보고 있던 콘텐츠의
viewport 위치를 유지하도록 scrollY를 보정한다. 첫 페인트 동안만 자동 scroll anchoring을 막고 원래 스타일을 복원한다.
보관함이 열려 있으면 경계와 높이만 재측정하며 보관함을 다시 열거나 자동 스크롤하지 않는다.

## 실행한 검증

| 명령                                                             | 결과                                              |
| ---------------------------------------------------------------- | ------------------------------------------------- |
| `npm run type-check`                                             | 통과                                              |
| `npm run lint`                                                   | oxlint·ESLint 통과                                |
| `npm run format:check`                                           | 통과                                              |
| `npm test`                                                       | 67파일 / 2,127 통과 (기준 66파일 / 2,124 대비 +3) |
| `npm run build`                                                  | 타입·production build 통과                        |
| `node docs/development/header-collapse-results/check/header.mjs` | 새 격리 Chrome 실행 43/43 통과                    |

확장 소스는 변경하지 않았고 이번 패치에서는 확장 프로젝트의 별도 명령을 실행하지 않았다.

Chrome 157.0.8103.51 headless, 로컬 production build, 격리 임시 프로필, 실제 YouTube 영상으로 검증했다.
두 테마 × 5개 화면 크기에서 각각 접기·펼치기 3회를 반복했다. 펼치기는 Enter·Space·포인터로 각각 검사했다.
같은 iframe 노드·진행하는 재생 시간·일시정지되지 않음, 위젯의 x/width 유지, 가로 넘침 0, scrollY 유지와 메뉴 복원을 확인했다.

| 화면     | 접기 전 workspace y | 접은 뒤 y | 확보한 높이 |
| -------- | ------------------: | --------: | ----------: |
| 1440×900 |            130.4375 |        60 |   70.4375px |
| 1024×768 |          119.609375 |        60 | 59.609375px |
| 390×844  |                 211 |        60 |       151px |
| 360×780  |                 211 |        60 |       151px |
| 844×390  |                 116 |        60 |        56px |

화면 아래로 스크롤한 상황의 콘텐츠 위치 유지와 새로고침 시 펼침도 별도로 확인했다.
브라우저 창을 CDP로 fullscreen/normal 전환해도 헤더 선택이 유지되고 document.fullscreenElement는 null이었다.
이 검증을 실제 F11 키 입력으로 보고하지 않는다.

결과: [real-chrome-header.json](header-collapse-results/real-chrome-header.json).
스크린샷: [데스크톱](header-collapse-results/cassette-1440x900-collapsed.png) ·
[모바일](header-collapse-results/cassette-390x844-collapsed.png) ·
[Mono](header-collapse-results/mono-1440x900-collapsed.png).

첫 하네스 실행은 Enter 문자 이벤트 누락과 비어 있는 기록 상세 처리 문제로 중단됐다. 하네스를 수정한 뒤 전체를 다시 실행했다.
실패 실행은 `real-chrome-header-run1.json`에 보존하고 통과로 합산하지 않았다.

## 변경 파일과 커밋

- 소스: AppHeader.vue, DashboardShell.vue, useHeaderCollapse.ts (모두 `src/components/layout/`).
- 테스트: tests/unit/header-collapse.spec.ts 추가, tests/unit/dashboard-shell.spec.ts의 헤더 버튼 기대값 갱신.
- 문서: 이 보고서, ADR 0036 및 결정 색인, ROADMAP, IMPLEMENTATION_PLAN.
- 검증 자료: header-collapse-results/의 하네스·JSON·두 테마별 스크린샷.
- 전체 경로: [변경 파일 목록](header-collapse-results/changed-files.md).
- 추가 의존성·삭제 파일 없음. 최종 로컬 커밋은 `git log -1 --oneline`로 확인한다.

## TODO·제한

- 사용자 최종 UAT, 실제 F11 키·브라우저 UI, Android/iOS 터치, 화면 낭독기 확인.
- 숨긴 메뉴는 헤더 펼치기로 복원한다. 펼치기 버튼은 페이지 헤더의 정상 흐름 안에 있으며 플레이어 위의 떠 있는 버튼이 아니다.
- 운영 배포·Git push·main 통합·Web Store 업로드는 하지 않았다.
