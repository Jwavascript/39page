# 확장 음악 담기 후 선택 해제 (2026-11-19)

브랜치 `fix/extension-clear-playlist-after-save`, 시작 커밋 `4f5774d`.
기존 미커밋 아이콘·문서·개인정보 페이지 변경은 보존하고 이 패치의 파일만 커밋한다.

## 동작

음악 저장 성공 뒤 선택이 남아, 새로 읽은 목록의 중복 경고가 저장 완료 안내와
동시에 나타났다. 이제 음악 요청이 `done`으로 바뀌면 플레이리스트 선택,
새 목록 생성 선택·이름, 중복 저장 동의를 초기화하고 목록을 갱신한다.
저장 완료 안내는 그대로 유지한다. 사용자가 다음 목록을 고르면 이전 완료
안내를 지우고 그 목록에 대한 중복 여부를 다시 보여준다.

일반 저장·같은 요청 재시도·저장 여부 확인으로 성공이 확정되는 경우에 공통으로
적용한다. 실패·권한 부족·타임아웃·부분 성공이면 선택과 복구 흐름을 유지한다.
Moment 입력·저장, 브리지 계약, 요청 ID, 저장 스키마, 확장 권한은 변경하지 않았다.

## 변경 파일

- `extension/src/panel/useSaves.ts`: 성공 상태에서 선택 초기화 및 목록 갱신, 완료 안내 보존.
- `extension/tests/panelApp.spec.ts`: 선택 해제, 완료 안내, 중복 재선택, 실패 선택 보존,
  새 목록·부분 성공 재시도·저장 여부 확인 회귀 검증.
- `docs/development/EXTENSION_PLAYLIST_SELECTION_FIX.md`: 이 보고서.

추가·삭제 의존성 없음. 웹앱 소스·Manifest·승인 디자인 원본 변경 없음.

## 실제 검증

| 위치      | 명령                                                                | 결과                                                          |
| --------- | ------------------------------------------------------------------- | ------------------------------------------------------------- |
| extension | `npm test -- tests/panelApp.spec.ts` (구현 전)                      | 5실패·17통과로 재현                                           |
| extension | 같은 명령 (구현 후)                                                 | 22개 통과                                                     |
| extension | `npx oxlint src/panel/useSaves.ts tests/panelApp.spec.ts`           | 최초 테스트의 unsafe optional chaining 3건 실패; 수정 후 통과 |
| extension | `npx eslint src/panel/useSaves.ts tests/panelApp.spec.ts`           | 통과                                                          |
| extension | `npm test`                                                          | 26파일·430개 통과                                             |
| extension | `npm run build`                                                     | 타입 검사·production 빌드·Manifest 20파일 검사 통과           |
| extension | `npx prettier --check src/panel/useSaves.ts tests/panelApp.spec.ts` | 통과                                                          |
| root      | 보고서 Prettier 검사 및 `git diff --check`                          | 통과                                                          |

Vite의 기존 native configLoader 안내와 Node localStorage ExperimentalWarning이
출력됐다. 개인 운영 프로필 데이터는 변경하지 않았다. 실제 Chrome과 Store
설치본에서 이 수정본을 사용한 검증은 수행하지 않았다.

## 배포 관련 TODO

로컬 수정과 빌드까지 완료했다. 현재 설치된 Store 확장에는 아직 반영되지 않는다.
Store 업데이트를 준비할 때 확장 버전 갱신·새 패키지 생성·수동 Chrome 검증이
필요하다. 기존 `extension/release/` ZIP은 덮어쓰지 않았다.
Git push·main 통합·웹 운영 배포·Chrome Web Store 업로드는 하지 않는다.
