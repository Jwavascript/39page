# M12-6 후속 패치 — Artwork Editor UX (2026-11-15)

시작 브랜치 `m12-6-ux-polish`, HEAD `325226d`, 작업 트리 깨끗함을 확인하고
`m12-6-artwork-editor-ux`에서 작업했다. 변경 범위는 Artwork 편집기 UI·시험·문서다.

## A. 변경된 UI

- 넓은 편집 칸(560px 이상)은 왼쪽 미리보기 / 오른쪽 표시 컨트롤의 2열이다. 기준은 대시보드가 아닌 편집 칸의 실제 폭이다.
- 좁은 편집 칸은 작은 미리보기·비교 단추가 위에, 컨트롤이 아래에 오는 1열이다.
- 미리보기는 편집 본문 안에서 sticky다. 헤더와 저장·취소는 본문의 형제라 스크롤해도 남는다.
- 편집 칸 높이에 따라 미리보기를 조절한다. 280px 이하의 짧은 칸은 64px 미리보기와 줄인 본문 여백을 사용한다.
- 기존의 작은 미리보기 두 개 대신 편집 결과 하나를 보여 준다. `변경 전 보기`와 `편집 미리보기로`로 비교하며,
  `저장 전 미리보기` / `현재 저장된 이미지`를 명확히 구분한다.
- 저장 공간·백업 안내는 펼칠 수 있는 보조 영역으로 옮겼다. 기존 파일 선택·이미지 형식·용량 안내는 유지한다.
- 대시보드·영상·보관함 전체 배치와 진입 정책은 수정하지 않았다.

## B. 사용성 개선과 실제 좌표

가로·세로·확대율 각각을 실제 Chrome 키보드 이벤트로 조절하고 이미지·입력·스크롤·클릭 가능 여부를 측정했다.
컨트롤을 보기 위해 본문을 스크롤해도 미리보기는 남으며, 값을 바꾸는 동안 스크롤 위치는 변하지 않는다.
마우스 포인터로 미리보기를 끌면 같은 draft가 갱신되어 슬라이더와 이미지 스타일에 즉시 반영된다.

320×640의 짧은 칸에서도 수정 후 미리보기는 y=459–523px, 조절 중인 행은 y=531.1875–575.1875px,
본문은 y=455–579px 안에 보인다. 가로·세로·확대율을 조절할 때 본문 scrollTop은 각각 88/144/200px이며
각 조절 전후 값은 동일했다. 미리보기를 보기 위한 별도의 스크롤 왕복이 필요하지 않다.

저장 전/후 비교는 draft나 assignment에 쓰지 않는다. 같은 GIF를 비교할 때 img 노드와 src를 유지하고 표시 구도만 바꾸며,
GIF 멈춤 선택도 보존한다. 비교 중 슬라이더를 움직이면 자동으로 편집 결과로 돌아온다.

스크린샷은 현재 패치의 새 실행에서 생성했다:
[데스크톱](artwork-editor-results/cassette-1440x900.png) ·
[1024](artwork-editor-results/cassette-1024x768.png) ·
[320](artwork-editor-results/cassette-320x640.png) ·
[가로](artwork-editor-results/cassette-844x390.png).

## C. 기술 변경과 유지한 계약

- `ArtworkSettings.vue`: 헤더 / 단일 스크롤 본문 / 하단 작업 영역의 grid, 본문 내 2열·1열 컨테이너 쿼리.
- `ArtworkEditorPreview.vue`: 메인 미리보기·비교 UI·포인터 이벤트. 기존 `ArtworkPreview`와 `useArtworkDisplayDrag`를 사용한다.
- 같은 `display` draft를 `v-model`로 전달한다. 비교 여부만 컴포넌트의 임시 UI 상태다. 구도 복사본을 별도로 편집하지 않는다.
- 원본 Blob·포스터·GIF 움직임/모션 감소·Object URL 정리는 기존 구현을 사용한다. 저장 실패 시 draft·파일·구도가 남는다.
- IndexedDB v1, ArtworkAssignment/ArtworkDisplay, SHA-256 ID, ZIP·공유 v1/v2, Library/재생/Moments 계약은 변경하지 않았다.
- CSS는 두 Artwork 컴포넌트의 scoped 스타일이다. 공용 토큰을 사용하며 전역 CSS·대시보드·플레이어 코드는 변경하지 않았다.

## D. 검증

| 명령                                                                           | 결과                                     |
| ------------------------------------------------------------------------------ | ---------------------------------------- |
| `npm test -- tests/unit/artwork-ui.spec.ts tests/unit/artwork-display.spec.ts` | 2파일 / 24 통과                          |
| `npm test`                                                                     | 66파일 / 2,124 통과 (기준 2,121 대비 +3) |
| `npm run type-check`                                                           | 통과                                     |
| `npm run build`                                                                | 타입 검사·production build 통과          |
| `npm run lint`                                                                 | oxlint·ESLint 통과                       |
| `npm run format:check`                                                         | 통과                                     |
| `npm test` (extension/)                                                        | 25파일 / 408 통과                        |
| `npm run build` (extension/)                                                   | 타입·빌드·Manifest 검사 통과             |
| `python docs/development/m12-6-results/check/make-fixtures.py`                 | 새 시험용 원본 GIF 생성                  |
| `node docs/development/artwork-editor-results/check/editor.mjs`                | 새 Chrome 실행 98/98 통과                |

추가한 회귀 시험: 미리보기와 컨트롤의 본문 공유·하단 작업 영역 분리, 저장값과 draft 비교 및 GIF 노드·멈춤 유지,
포인터→슬라이더 동기화와 저장 실패 후 draft 보존. 기존 옵션·폐기 확인·저장·구도·ZIP/공유 v1/v2 시험도 전체 실행했다.

실제 Chrome 157.0.8103.51에서 격리 임시 프로필, 로컬 production build, 실제 GIF·IndexedDB·YouTube iframe을 사용했다.
두 테마 × 1440×900·1024×768·768×1024·390×844·360×780·320×640·844×390·720×450(200% 확대 대응 CSS 뷰포트)를 측정한다.
원본 해시, 조절 중 미리보기 가시성, 컬럼 수, 버튼 위치·44px 높이, 가로 넘침, 단일 스크롤 조상,
포인터 드래그, 비교·GIF 노드, Tab 이동, 취소 후 assignment 보존, 저장·새로고침을 검증한다.

결과 원문: [real-chrome-editor.json](artwork-editor-results/real-chrome-editor.json).
원시 좌표와 각 조절 전후 scrollTop을 포함하며 이전 M12-6 Chrome 결과를 재사용하지 않았다.
첫 실행에서 1024px 비교 단추와 320px 입력 행 잘림을 발견해 미리보기 크기·비교 캡션 배치·본문 여백을 수정했다.
첫 실행 결과는 `real-chrome-editor-run1.json`으로 남겼고 통과로 합산하지 않는다.
Cover와 Contain을 각각 검증했으며 최종 저장은 Contain·2배 확대 상태로 새로고침 후 복원했다.
검증 하네스의 전역 const 재선언(run3), 한 JS tick에 여러 입력을 합성한 마지막 저장 시나리오(run4)도 수정했다.
최종 98/98은 전체 시나리오를 다시 실행한 한 회차 결과이며 초기 회차와 합산하지 않았다.

## E. Git·변경 파일·의존성

- Patch 1 `b73c96e`: 편집기 2열/1열·스크롤·하단 작업 영역.
- Patch 2 `e65f8c7`: 메인 미리보기·변경 전 비교·기존 draft와 드래그 연동.
- Patch 3: 이 보고서를 포함한 최종 로컬 커밋. `git log -1 --oneline`로 확인한다.
- 소스: `src/features/artwork/ArtworkSettings.vue`, `src/features/artwork/ArtworkEditorPreview.vue`.
- 테스트: `tests/unit/artwork-ui.spec.ts`.
- 문서: 이 보고서, M12_CUSTOM_ARTWORK, ARTWORK_DESIGN, M12_6_UX_POLISH_REPORT, M12_RELEASE_READINESS, ADR 0035.
- 검증 자료: `docs/development/artwork-editor-results/`의 새 하네스·결과 JSON·두 테마별 스크린샷.
- [전체 변경·추가 파일](artwork-editor-results/changed-files.md) (`325226d` 기준).
- 새 의존성·저장 필드·ZIP 버전·삭제 파일 없음. 기존 커밋 재작성·push·main 통합·배포·스토어 업로드 없음.

## F. 후속 과제

- TODO: 사용자가 실제 화면에서 최종 UAT.
- TODO: Android/iOS의 실제 손가락 드래그·스크롤·파일 선택기·화면 키보드 및 화면 낭독기 확인.
  이번 Chrome 포인터 검증은 마우스 입력이며 실제 모바일 터치로 보고하지 않는다.
- TODO: 큰 GIF의 저사양 기기 성능. 기존 이미지 크기 한도·정지 정책은 유지한다.
- 실제 Chrome 저장 공간 고갈은 재현하지 않았다. 쓰기 실패 후 draft 보호는 단위 시험으로 확인했다.
- 대시보드 공간 재배치·플레이어·데이터 포맷 확장은 이 패치의 범위 밖이다.
