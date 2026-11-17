# Chrome Web Store Private 준비·BUG-001 구현 및 검증

2026-11-17 KST. 시작 HEAD `562f8c1`, 브랜치 `release/cws-private-bug-001`.
최종 로컬 소스 커밋은 `git log -1 --oneline` 및 ZIP `.provenance.json`의 commit으로 확인한다.

## 판정과 산출물

**최초 업로드용 패키지·자료 준비. 공식 ID 확보와 운영 BUG-001 해결은 미완료.**
`extension/release/39page-extension-1.0.0.zip`은 production 빌드이며 78,486바이트, ZIP 루트 manifest.json 포함 20개 파일이다.

SHA-256:

```text
0cbe04f1a29d3ef3d83c2b944e6059ffca8c077707a6e7588edb03d3ddb2018e
```

같은 경로의 `.sha256`와 `.provenance.json`에 버전·출처 commit·branch·작업 트리·ZIP/파일별 해시를 기록한다. ZIP과 sidecar는 기존 규칙에 따라 Git에서 제외한다. 소스 확정 후 같은 명령으로 재생성해 해시 일치를 확인한다. 기존 미추적 BUG 진단 문서는 이 작업의 커밋에 포함하지 않으며 provenance 작업 트리에 나타날 수 있다.

자료 위치와 다음 절차는 [출시 실행 안내](CWS_PRIVATE_RELEASE.md), 등록 문구는 [Store Listing](../product/EXTENSION_STORE_LISTING.md), 개인정보 근거는 [Privacy](../product/EXTENSION_PRIVACY.md)에 있다. 아이콘과 등록용 이미지 두 종류를 준비하고 육안 확인했다. 선택 홍보 타일은 생략했다.

## 구현 변경

- 플레이리스트 실패 원인을 UI까지 전달한다. 권한 없음, 명시적인 확장 거부, 시간 초과, 연결 실패, 데이터 조회 실패를 구별하며 재시도와 기존 Collect를 유지한다.
- 준비/읽기 시간 초과를 내부 unavailable/timeout으로 전달한다. 쓰기 결과 불확실 정책과 동일 요청 ID 재시도는 유지한다. CSP 차단과 네트워크 단절은 제한된 증거만으로 확정하지 않는다.
- offscreen iframe 메시지의 namespace뿐 아니라 프로토콜 버전도 검사한다. 누락/타 버전 ready는 무시한다. origin/source·세대·응답 ID 검증은 유지한다.
- 알려진 개발 ID와 BUG-001의 경로 기반 로컬 ID를 운영 빌드에서 거부한다. 기본 빈 allowlist·기본 CSP none은 유지한다.
- 공식 ID 한 개를 받아 격리된 경로에 로컬 운영 후보를 만드는 스크립트를 추가했다. 두 bridge 경로 CSP와 bridge JS ID 반영을 검사하고 배포하지 않는다. 공식 ID가 없어 긍정 경로 실행은 TODO다.
- 패키지 검사에 Git 출처·파일별 해시 sidecar를 추가했다. Manifest 버전·권한·minimum Chrome 116·호스트·ID/key 필드는 바꾸지 않았다. 기존 기능을 제거하지 않았다.
- 오래된 M10 Listing/Privacy를 직접 저장·메모·로컬 데이터·원격 iframe·외부 서비스 요청·Cloudflare NEL을 포함하도록 수정했다. 공개 HTML 후보는 정적이고 별도 추적 스크립트를 포함하지 않는다.

## 실행한 검증

| 위치             | 명령                                                     | 최종 결과                                                        |
| ---------------- | -------------------------------------------------------- | ---------------------------------------------------------------- |
| root             | npm test                                                 | 67파일, 2,127개 통과                                             |
| extension        | npm test                                                 | 26파일, 426개 통과 (기존 420 + 조회 오류/복구 5 + 메시지 버전 1) |
| root             | npm run build                                            | type-check 및 production build 통과                              |
| extension        | npm run build                                            | type-check·두 production build·manifest 검사 통과                |
| extension        | npm run package                                          | 빌드·20파일 검사·ZIP 재읽기 바이트 비교·SHA-256 생성 통과        |
| root / extension | npm run lint                                             | 양쪽 통과                                                        |
| root / extension | npm run format:check                                     | 최종 양쪽 통과                                                   |
| root             | node extension/integration/cws-package-smoke.mjs         | ZIP을 격리 경로에 풀어 설치한 Chrome 157.0.8103.79, 3/3 통과     |
| root             | prepare-production-bridge.mjs 거부 검사 (Node spawnSync) | 잘못된 ID·개발 고정 ID·기존 로컬 ID 3개 모두 nonzero 거부 확인   |
| root             | curl.exe -f -sS -L -D ... https://39page.com/bridge.html | 307 → 200, 양쪽 frame-ancestors none 재확인                      |
| root             | curl.exe -f -sS -D ... https://39page.com/               | 루트 200, 읽기 전용 확인                                         |
| root             | git diff --check                                         | 통과                                                             |

초기 root format:check는 수집한 원본 production-bridge.html 때문에 실패했다. 원문을 변형하지 않고 해당 HTTP 증거 파일만 `.prettierignore`에 추가해 해결했다. 이후 최종 검사를 다시 실행했다. Node localStorage ExperimentalWarning과 Vite configLoader 향후 변경 안내는 출력됐으나 해당 명령들은 성공했다.

ZIP 검사기는 소스맵·개발 주소·예상 밖 파일·eval/new Function·버전 불일치를 거부하고 manifest가 가리키는 자원을 확인한다. 이것만으로 Store 정책 적합성을 보증하지는 않는다. 원격 iframe의 JS 실행은 Listing에 공개했고 검토 가능한 고정 메시지 프로토콜로 제한돼 있다.

## 실제 Chrome와 운영 증거의 범위

[package-smoke.json](cws-private-results/package-smoke.json)은 새 임시 프로필과 ZIP 압축해제 설치본을 사용했다. 이때 발급된 로컬 ID는 공식 Store ID가 아니고 운영 allowlist에 추가하지 않았다.
실제 YouTube 영상과 패키지의 패널을 실행하고 권한 미승인 안내·Collect 버튼을 확인했다. Collect를 눌렀을 때만 HTTPS fragment URL로 새 탭이 열리며 메모가 URL에 없음을 확인했다. 사이트 접근 권한 승인·사용자 데이터 쓰기는 수행하지 않았다. 이 시험은 Store 설치본 시험이 아니다.

현재 공개 운영 응답은 [원본 헤더](cws-private-results/production-bridge-headers.txt)와 [HTML](cws-private-results/production-bridge.html)에 보관했다. 최종 /bridge에도 frame-ancestors none이다. HTTP Date는 2026-11-17 14:25:21 UTC, KST 23:25:21이다. 기존 진단과 일치하며 운영 차단은 아직 남아 있다. 루트 응답은 [별도 헤더](cws-private-results/production-root-headers.txt)에 있다. 운영 설정이나 저장 데이터를 변경하지 않았다.

권한 변경·워커/offscreen 재시작·중복 쓰기·잘못된 source/origin·payload·deadline·저장 실패·기존 웹앱 재생 회귀는 전체 자동 테스트에 포함된 기존 검사와 새 검사로 확인했다. 이번 실제 Chrome 3개 검사에서 모든 lifecycle/직접 저장을 다시 실측했다고 주장하지 않는다.

## 의존성·파일·미완료

추가/삭제 의존성 없음. 기존 Vue·Vite·Vitest와 Node/Python 표준 라이브러리, 설치된 Chrome을 사용했다. 패키징 도구를 새로 설치하지 않았다. 변경/추가 파일 전체는 [파일 목록](cws-private-results/changed-files.md)에 있다. 삭제한 파일은 없다. design/references는 수정하지 않았다.

TODO:

- 사용자의 최초 ZIP 업로드, Dashboard의 정식 Item ID 전달, Private/Trusted testers 설정.
- 지원 연락처·시행일·Cloudflare 로그 설정 확인, 개인정보 HTML의 검토·게시 승인·공개 URL HTTP 확인.
- 정식 ID로 후보 빌드·보안/통합 검사, 구체적 변경 diff·원복 버전 확인 후 운영 배포 승인.
- 운영 반영 뒤 최종 두 bridge 경로의 단일 ID CSP·JS 일치 확인. 다른 경로 및 다른 origin 거부 확인.
- Private 심사 제출과 승인 후 실제 Store 설치본으로 직접 조회·곡/Moment/새 목록 저장, 권한 승인/거부/철회, storage partitioning·lifecycle·기존 데이터/재생 보존 UAT.
- Chrome 116 실측, 사람 UAT 및 Private 사용자 검증 후 Public 전환 결정.

이 작업은 push·main 변경·운영 배포·심사 제출·결제를 수행하지 않았다. 다음 사용자 작업은 [출시 안내 1절](CWS_PRIVATE_RELEASE.md)의 최초 업로드와 공식 Item ID 전달이다.
