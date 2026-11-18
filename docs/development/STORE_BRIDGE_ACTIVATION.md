# Store 브리지 활성화 후보 — BUG-001

2026-11-19 KST. **로컬 후보 검증 완료, 운영 미적용.**

## 확인된 원인과 범위

사용자가 제공한 Store 항목과 실제 Store 설치본의 ID가 모두
`aaihanclknbboaehbjpmlcefkbgdeima`임을 확인했다. 항목 URL은
https://chromewebstore.google.com/detail/39page/aaihanclknbboaehbjpmlcefkbgdeima 이다.
Store 페이지를 도구로 직접 조회하지는 못했으며 ID의 근거는 사용자 확인이다.

운영 `/bridge.html`은 `/bridge`로 이동하며 최종 응답은 HTTP 200,
`Content-Security-Policy: frame-ancestors 'none'`이다. 따라서 현재는 공식
설치본도 iframe을 띄울 수 없으며 ready 신호를 받지 못한다. 반복 재시도나
시간 제한 연장으로 이 차단을 해소할 수 없다. 이 설정은 보고된 연결 시간 초과를
설명하지만, 활성화 뒤 실제 Store 저장 성공까지 입증한 것은 아니다.

기존 작업 폴더의 미커밋 아이콘·문서·privacy 변경은 보존했다. 별도 worktree
`C:/Users/phoria/39page-store-bridge`, 브랜치 `fix/store-bridge-aaihan`에서
운영 소스 `c75410014f275718a5bd735c7348121ffcbd4eda`를 검증했다.
앱 코드·확장 권한·Manifest·저장 스키마·브리지 계약 변경은 없다.

## 검토할 운영 변경

| 항목                | 현재 확인                                    | 제안                                                             |
| ------------------- | -------------------------------------------- | ---------------------------------------------------------------- |
| 배포 소스           | origin/main `c754100`                        | 동일 커밋 재빌드; 이 보고서 커밋은 배포 불필요                   |
| 빌드 allowlist      | 산출물상 비어 있음; Dashboard 원본 값 미조회 | `VITE_BRIDGE_EXTENSION_IDS=aaihanclknbboaehbjpmlcefkbgdeima`     |
| 개발 빌드 변수      | Dashboard 원본 값 미조회                     | `VITE_BRIDGE_DEV_BUILD` 미설정                                   |
| 두 bridge 경로 CSP  | `frame-ancestors 'none'`                     | 공식 `chrome-extension://aaihanclknbboaehbjpmlcefkbgdeima` 한 개 |
| 마지막 성공 CI 버전 | `e7e5b98f-ddd8-475e-8018-109350e8b140`       | 실행 직전 현재 Active 버전 및 원복 가능 여부 확인 필요           |
| 원복 대상           | 위 버전이 이전 정상 운영 버전 후보           | Dashboard에서 실제 사용 가능함을 확인하고 고정                   |

CI 결과는 마지막 성공 빌드를 보여주며 현재 Active 버전을 증명하지 않는다.
관리 API 토큰·Wrangler 인증·사용 가능한 Cloudflare 연결이 없어 설정 변경과
현재 Active 버전 조회를 수행하지 않았다. Git push도 하지 않았다.

공식 ID 허용은 해당 확장에 기존 플레이리스트·Moment 조회와 곡·목록·Moment
추가 기능을 여는 변경이다. 기존 조상 전체 검사, 부모 source/origin 검사,
입력·deadline·중복 요청 검증은 유지된다. 일반 웹사이트나 다른 확장 ID를
허용하지 않는다. Collect 폴백을 유지하며 사용자 데이터를 삭제하지 않는다.

기존 작업 문서 `C:/Users/phoria/39page/docs/development/CWS_PRIVATE_RELEASE.md`
§5의 “배포 대상 commit·전체 파일 diff·후보 SHA-256·활성 Worker 버전·환경변수
전후·원복 대상 버전을 표로 제시한 뒤 승인을 요청한다”에 따라 이 후보 생성은
운영 활성화 승인이 아니다. 활성 버전 확인과 승인 후 아래 절차를 실행한다.

## 산출물과 전체 차이

동일 소스를 환경변수 없이 `dist/closed`, 공식 ID 한 개로 `dist/store`에 빌드했다.
전체 파일 SHA-256은 [candidate.json](store-bridge-results/candidate.json)에 있다.
현재 HTTP 응답과 마지막 성공 CI 정보는 [live-before.json](store-bridge-results/live-before.json)에 있다.

- 변경: `_headers`, `bridge.html`.
- 교체: `assets/bridge-C4cijQlM.js` → `assets/bridge-_-fyh6TX.js`.
- 바이트 동일: main JS·CSS, moments JS, index.html, privacy.html, favicon.ico.
- 후보 bridge JS SHA-256: `0c2a248928f5137b18db741e07e7b4cdd05f48c40f1ec8cfed20afca47690b81`.
- 자동 산출물 검사: 두 경로에 공식 ID 한 개, 와일드카드 없음, JS에 공식 ID 포함,
  알려진 개발·로컬 ID 없음, 예상 파일 외 변경 없음 — 통과.

## 검증

| 위치                | 실제 실행                                    | 결과                                                      |
| ------------------- | -------------------------------------------- | --------------------------------------------------------- |
| 별도 worktree       | `npm run type-check`                         | 통과                                                      |
| 별도 worktree       | `npm test`                                   | 67파일, 2,127개 통과; bridge 신뢰 경계·저장 계약 포함     |
| 별도 worktree       | `npm run build-only -- --outDir dist/closed` | 통과; allowlist 미설정                                    |
| 별도 worktree       | `npm run build-only -- --outDir dist/store`  | 통과; 공식 ID 설정, 개발 변수 미설정                      |
| 별도 worktree       | `npm run lint`                               | 통과; 추적 소스 변경 없음                                 |
| 별도 worktree       | `npm run format:check`                       | 통과; 보고서 추가 후 재확인                               |
| 원래 extension 폴더 | `npm test`                                   | 현재 로컬 소스 26파일, 426개 통과                         |
| 원래 extension 폴더 | `npm run type-check`                         | 통과                                                      |
| 원래 extension 폴더 | `npm run check:manifest`                     | 기존 dist 20파일 검사 통과; Store 패키지 자체 검사는 아님 |

테스트는 Vitest의 격리 저장소를 사용했다. 평소 사용하는 운영 프로필을
초기화하거나 저장 내용을 읽지 않았다. Node localStorage ExperimentalWarning은
발생했으며 테스트 실패는 없었다. 새로운 의존성은 추가하지 않았다.

## 승인 후 적용

Cloudflare → Workers & Pages → **39page** → Settings → Build →
**Build variables and secrets**에서 production 빌드 변수를 설정한다.
런타임 Variables and Secrets와 구분한다. 빌드 변수와 런타임 변수의 구분은
[Cloudflare 공식 문서](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/)를 따른다.

```text
VITE_BRIDGE_EXTENSION_IDS=aaihanclknbboaehbjpmlcefkbgdeima
VITE_BRIDGE_DEV_BUILD는 제거
```

현재 Active 버전과 기존 변수 값을 기록한 뒤 저장하고, c754100의 production
빌드를 새 변수로 다시 실행한다. 캐시된 기존 자산만 다시 배포하면 안 된다.
프로젝트에 문서화된 Build command는 `npm run build`, Deploy command는
`npx wrangler deploy`다. Dashboard의 실제 설정과 재빌드 대상 커밋을 확인한다.
Git 소스 수정이나 빈 커밋 push는 필요하지 않다.

배포 후 다음 명령으로 두 경로의 **최종** 응답을 확인한다.

```powershell
curl.exe -sS -L -D - -o NUL https://39page.com/bridge.html
curl.exe -sS -L -D - -o NUL https://39page.com/bridge
```

두 응답 모두 공식 ID 한 개만 허용해야 한다. 새 bridge HTML이 참조하는 JS에도
공식 ID가 있어야 한다. JS·HTML·헤더는 동일 빌드로 함께 반영해야 한다.

## 배포 후 TODO와 원복

아래는 아직 미검증이다. 설치본의 기능 정상화 완료로 보고하지 않는다.

1. 격리 Chrome 프로필에 공식 Store 설치본을 설치하고 합성 목록을 만든다.
2. YouTube 패널을 열고 사이트 권한 승인 후 목록 조회 및 다시 불러오기를 확인한다.
3. 곡 저장, 즉석 목록 생성, Moment 메모 저장과 웹앱 반영을 확인한다.
4. 중복 저장 방지, 권한 거부·철회, 워커 재시작, Collect 폴백을 확인한다.
5. 실제 Chrome의 제3자 저장소 분할 여부를 확인한다. 목록 불일치가 있으면
   저장을 반복하지 말고 별도 조사한다.
6. 웹앱 재생·큐·보관함·테마·헤더·Artwork·ZIP 백업을 smoke test한다.

원복은 allowlist를 이전 값으로 돌리고 **다시 빌드·배포**하여 두 경로가
`frame-ancestors 'none'`인지 확인한다. 또는 실행 전 확인한 이전 안정 Worker
버전(정적 자산 포함)으로 롤백하고 빌드 변수도 복원한다. 변수만 지우면 이미
배포된 JS와 헤더는 바뀌지 않는다. 기존 곡·Moment·Artwork는 삭제하지 않는다.

추가 파일은 이 보고서와 위 두 JSON 증거뿐이며 앱 소스 변경·의존성 추가는 없다.
