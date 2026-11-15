# M11·M12 웹앱 운영 배포 완료 — 2026-11-16 KST

## 결과

**https://39page.com 반영 및 운영 smoke 완료.** 사용자의 명시적 운영 배포 승인 후 기존 Git 연동 경로로 진행했다.
운영 전 Gate의 CONDITIONAL 판정과 실제 실행 결과는 구별한다.

| 항목                                | 값                                                                             |
| ----------------------------------- | ------------------------------------------------------------------------------ |
| 배포 커밋                           | **`cac19d56a5a4c4986fbead4cbf3156f2b7274e99`**                                 |
| 브랜치                              | 로컬 main 및 origin/main 모두 위 커밋                                          |
| 기존 main                           | `2bc8fd2af9ac2609ce2f565a19c6ab185253d497`                                     |
| 코드 기준                           | 검증한 `e371fb5`와 제품·빌드·확장 파일 동일                                    |
| Workers Builds                      | [성공한 GitHub check](https://github.com/Jwavascript/39page/runs/132860759257) |
| 새 Worker Version ID (CI 보고)      | **`0c291394-e72a-4830-b09d-c083a5d143cf`**                                     |
| 이전 성공 Version ID (이전 CI 보고) | `712b48f1-eedb-4ea4-8f12-c566b0efab78`                                         |
| CI 성공 확인                        | 2026-11-16 **00:30:27 KST** (조회 시각)                                        |
| 운영 HTTP/브라우저 검증             | 같은 날 00:31~00:34 KST, 아래 원시 결과 참조                                   |
| 결과                                | HTTP **11/11**, 실제 운영 Chrome **58/58**                                     |

## 승인·통합·데이터 보호

- 사용자가 운영 배포를 승인했고, **운영 프로필에 데이터가 없다**고 직접 확인했다. 사전 백업 파일이 있다고 가정하지 않았다.
- Cloudflare 상세 설정은 사용자가 이전 Git 배포 반영을 근거로 설정되어 있다고 답했다. 관리 화면/API를 읽었다고 보고하지 않는다.
- 추가로 GitHub check의 output summary를 읽어 기존 성공 배포의 Worker Version ID를 확인했다.
  이전 Gate 조사에서 읽은 Build ID와 이 Version ID는 서로 다르다.
- `origin/main`은 조사 때의 2bc8fd2 그대로였다. 통합 브랜치 `release/m11-m12`를 원격 main에서 만들고
  `release-gate-2026-11-15`를 병합했다. 충돌 없었고 양쪽 이력을 보존했다.
- 통합 커밋 cac19d5에서 아래 검사를 재실행했다. main을 fast-forward한 뒤 **`git push origin main`을 실행했고 성공했다**.
  force push는 하지 않았다.
- 사용자 평소 프로필·사이트 데이터는 열거나 지우지 않았다. 운영 검증은 새 임시 Chrome 프로필에서 합성 데이터로만 했다.
  이 앱의 저장은 해당 테스트 프로필의 localStorage/IndexedDB이며 서버 공용 데이터를 수정하지 않는다.

## 최종 통합 커밋의 검사

| 검사                                             | 결과                                            |
| ------------------------------------------------ | ----------------------------------------------- |
| root `npm run type-check`                        | 통과                                            |
| root `npm run lint`, `npm run format:check`      | 통과                                            |
| root `npm test`                                  | 67파일 / **2,127 통과**                         |
| root `npm run build`                             | 통과                                            |
| extension `npm test`                             | 26파일 / **420 통과**                           |
| extension `npm run build`                        | type-check·빌드·Manifest 검사 통과              |
| extension `npm run lint`, `npm run format:check` | 통과                                            |
| `git diff --exit-code e371fb5 cac19d5 -- ...`    | 제품 소스·빌드 설정·확장 동일                   |
| ancestry                                         | 2bc8fd2, e371fb5, f28ad71 모두 배포 커밋에 포함 |

Node Web Storage ExperimentalWarning 및 Vite configLoader 향후 변경 안내가 있었으며 검사 명령은 통과했다.
Cloudflare의 구체적인 Node 버전·변수 목록은 미열람이다. 실제 CI 성공과 공개 배포 바이트/정책을 검증했다.

## 운영에서 확인한 것

원본: [배포 메타데이터](production-release-results/deployment.json) ·
[CI 결과](production-release-results/ci.json) · [이전 CI](production-release-results/previous-ci.json) ·
[HTTP](production-release-results/http.json) · [브라우저 집계](production-release-results/live-summary.json).

1. index, favicon, CSS, main/bridge/Moments JS, bridge HTML의 **7개 공개 자산이 로컬 빌드와 SHA-256까지 일치**했다.
   `_headers`는 배포 설정 파일이므로 공개 자산 비교에서 제외하고 실제 응답으로 검사했다.
2. `/bridge` 및 `/bridge.html` 최종 응답은 CSP `frame-ancestors 'none'`, nosniff, no-referrer다.
   직접 방문 시 bridge JS도 `refused`이며 저장소를 바꾸지 않았다. **운영 직접 저장은 비활성**이다.
3. http와 www는 apex HTTPS로 301 이동한다. 메인 웹앱의 referrer meta를 유지한 상태에서 실제 YouTube 재생이 됐다.
4. 실제 운영 smoke **9/9**: 재생·NOW PLAYLIST·다음/이전, 같은 iframe, 헤더 접기/복원,
   테마 전환, Moment 시점·메모 저장, 생성한 ZIP에 Moment 포함, 브리지 거부, Collect의 확인 전 무저장/확인 후 저장.
5. 실제 운영 UX/Artwork/ZIP 검사 **49/49**: 보관함·제목·Moment 경고·두 테마·좁은/가로 화면,
   GIF 업로드·구도·취소/저장, 원본 해시, ZIP을 다른 새 프로필에서 복원, 공유 파일 구도 복원.
6. 합성 ZIP 다운로드는 브라우저가 생성한 blob 바이트를 테스트에서 가로채 검증했다. 사용자의 실제 다운로드 폴더/파일은 건드리지 않았다.
7. 운영 CSP는 의도적으로 bridge iframe을 막으므로 로컬 Gate의 iframe probe는 운영 검사에서 top-level 거부 검사로 바꿨다.
   헤더 검사는 별도 HTTP 검사로 수행했다. 제품 코드를 바꾼 것이 아니다.

스크린샷: [Cassette](production-release-results/cassette.png) · [Mono](production-release-results/dashboard.png).
재현 하네스는 production-release-results/check에 있으며 매번 새 프로필을 사용한다.
이번 작업에서 Chrome Web Store 업로드·확장 ID/권한·저장 계약 변경은 하지 않았다.

## 준비된 롤백 — 실행하지 않음

로컬 `rollback/m11-m12` = **`4fb96cde2c6a1669fe3a816e80c7cf93c8c5f0c5`**를 준비했다.
부모가 배포 커밋 cac19d5이고 tree는 이전 main 2bc8fd2와 완전히 같다. `git diff --exit-code 2bc8fd2 rollback/m11-m12`로 확인했다.
현재 운영은 정상이라 롤백을 실행하거나 이 브랜치를 push하지 않았다.

문제 발생 시 원격 main이 여전히 cac19d5인지 먼저 확인한다. 달라졌다면 이 명령을 그대로 적용하지 않는다.

```powershell
# 별도 장애 대응에서만 실행한다. main에 추가 변경이 없는지 먼저 확인.
git ls-remote origin refs/heads/main
git push origin rollback/m11-m12:main
# fast-forward이며 force push가 아니다. 기존 Workers Builds가 이전 코드 tree를 다시 배포한다.
```

Cloudflare에 로그인한 담당자는 이전 성공 Version ID `712b48f1-eedb-4ea4-8f12-c566b0efab78`로 직접 rollback할 수도 있다.
이 세션에는 관리 인증이 없어 직접 Wrangler rollback은 수행하지 않았다.
코드 롤백은 사용자 데이터를 과거로 되돌리지 않는다. Artwork/ZIP을 지원하지 않는 M10으로 돌아갈 수 있으므로
문제 확인 전 저장소를 지우거나 복원을 덮어쓰지 않는다. Gate의 로컬 데이터 왕복 검증은 그대로 유효하다.

## 운영 사용 시작

- 평소 열린 39page 탭을 새로고침한다. 사이트 데이터/IndexedDB를 삭제하지 않는다.
- 기존 테마 선택이 있으면 그 선택을 유지한다. 빈 프로필의 기본값은 Cassette다.
- 사용 데이터를 만들기 시작하면 **데이터·백업 → 전체 백업(ZIP)**을 외부에 보관한다.
- [3~7일 피드백](POST_RELEASE_FEEDBACK.md)은 2026-11-16을 Day 0으로 시작한다. 11월 19~23일 사이 안정화 판단을 한다.
- P0/P1은 즉시 대응하고 일반 UX는 다음 안정화 묶음으로 기록한다.

남은 사람 확인: 실제 F11·확장 단축키, 화면 낭독기·고대비·Safari/실기기·Chrome 116,
평소 프로필에서의 장시간 사용. 일반 프로필의 데이터 보존을 자동 검사했다고 보고하지 않는다.

이 배포 후 문서/검증 기록은 **별도 로컬 `release-record/m11-m12` 브랜치**에 남긴다.
추가 CI/운영 배포를 유발하지 않도록 기록용 브랜치는 push하지 않았다. main/origin/main의 배포 커밋은 cac19d5다.
제품 코드·의존성 추가 없음. 변경 파일은 [목록](production-release-results/changed-files.md) 참조.
