# Chrome Web Store Private 출시와 BUG-001 — 실행 안내

작성일 2026-11-17 KST. 시작 HEAD `562f8c1`, 작업 브랜치 `release/cws-private-bug-001`.
기존 Cassette `e371fb5`와 후속 운영 배포 기록을 포함한다. 기존 미추적 `UAT_BUG_001_BRIDGE_DIAGNOSIS.md`는 사용자 자료로 보존했다.

## 현재 게이트

**최초 ZIP 업로드 준비 단계. 운영 BUG-001 해결·스토어 심사 통과·정식 출시 완료가 아니다.**

- ZIP 최초 업로드 → 공식 Item ID 확보 → 단일 ID 로컬 빌드 → 보안/통합 검증 → 운영 변경안 승인 → 제한된 브리지 배포 → Private 심사 제출 → Store 설치본 UAT 순서다.
- 스토어 업로드·결제·심사 제출·공개 게시를 수행하지 않았다. 운영 설정 변경·push·main 통합·데이터 삭제·확장 제거/재설치도 하지 않았다.
- 정식 ID는 미확인이다. 두 알려진 개발/로컬 ID를 공식 ID로 제안하거나 운영 허용하지 않는다.

## 1. 사용자 최초 업로드

1. [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole)에 사용자가 직접 로그인한다. 계정 등록·결제·2단계 인증이 필요하면 직접 진행한다. 비밀번호·인증 코드를 전달하지 않는다.
2. Add new item → Choose file → `extension/release/39page-extension-1.0.0.zip` → Upload. ZIP의 manifest.json은 루트에 있다.
3. 생성된 항목의 **Item ID** 32자를 Dashboard에서 복사해 전달한다. 압축해제 설치 화면의 ID가 아니다. 이 업로드는 심사 제출·게시와 다르다.
4. Distribution은 Private → Only trusted testers로 설정하고 테스트 계정을 등록한다. 아직 Submit for review는 누르지 않는다.
5. [Store Listing](../product/EXTENSION_STORE_LISTING.md)과 이미지 자료를 입력한다. 지원 연락처는 `jwavascript@gmail.com`으로 확정했다(2026-11-18). 개인정보 URL은 게시 후 실제 값으로 채운다. 개인정보 페이지가 실제 공개된 후 응답과 내용을 확인한다.

공식 [업로드 안내](https://developer.chrome.com/docs/webstore/publish), [배포 범위 안내](https://developer.chrome.com/docs/webstore/cws-dashboard-distribution)를 2026-11-17 확인했다. 실제 Dashboard 문구가 바뀌면 해당 화면을 우선한다.

## 2. 제출 파일과 이미지

| 자료                                            | 경로                                                       |
| ----------------------------------------------- | ---------------------------------------------------------- |
| 업로드 ZIP                                      | `extension/release/39page-extension-1.0.0.zip`             |
| SHA-256                                         | ZIP과 같은 경로의 `.sha256`                                |
| 빌드 출처·파일별 해시                           | ZIP과 같은 경로의 `.provenance.json`                       |
| 승인 Cassette 128px 아이콘                      | `design/assets/cws-private/icon-128.png`                   |
| 1280×800 등록용 이미지                          | `design/assets/cws-private/screenshot-1.png`               |
| 현재 production 패키지의 실제 YouTube 패널 캡처 | `cws-private-results/youtube-permission-1280x800.png`      |
| Listing·권한·Privacy Practices                  | `docs/product/EXTENSION_STORE_LISTING.md`                  |
| 개인정보 초안·공개 HTML 후보                    | `docs/product/EXTENSION_PRIVACY.md`, `public/privacy.html` |

등록용 이미지는 승인 Cassette 적용 후 2026-11-15 격리 Chrome에서 촬영한 실제 popup-toolbar.png·panel-music.png를 HTML 배치 후 1280×800으로 캡처한 것이다. 팝업은 미지원 페이지 안내, 패널은 합성 플레이리스트를 사용한 실제 UI다. 성공 화면의 표현은 현재 패키지와 동일하다. 새 직접 캡처는 2026-11-17의 production 빌드를 경로 기반 압축해제로 설치한 권한 미승인 상태다. Store 설치·운영 직접 저장 성공을 입증하는 이미지로 사용하지 않는다. 허위 평점·사용자 수는 없다. 선택 홍보 타일은 만들지 않았다.

## 3. 공식 ID를 받은 뒤 로컬 후보 생성

운영은 Pages가 아니라 `wrangler.toml`의 **Cloudflare Workers Static Assets**다. `_headers`는 Vite가 빌드 시 생성한다. 별도의 `_redirects`는 없으며 `/bridge.html` → `/bridge`는 호스팅의 HTML 정규화다.

루트 PowerShell에서 실행한다. 아래 변수의 문자열은 실제 Dashboard Item ID로 바꾼다. 예시 ID를 제공하지 않는다.

```powershell
$storeItemId = 'Dashboard에서 확인한 공식 Item ID'
npm run type-check
node extension/scripts/prepare-production-bridge.mjs $storeItemId
```

스크립트는 입력 형식·단일 값·두 알려진 로컬 ID 금지, 두 경로의 단일 origin CSP와 JS의 ID 반영을 검사한다. `node_modules/.tmp/cws-production-bridge`에만 후보를 만들며 배포하지 않는다. 입력 자체가 Store 발급 증명은 아니므로 Dashboard 근거를 사람이 먼저 확인해야 한다.

운영 CI Build 환경에 `VITE_BRIDGE_EXTENSION_IDS=<확인한 공식 ID 한 개>`를 설정하고 `VITE_BRIDGE_DEV_BUILD`는 제거한다. 런타임 환경변수만 바꾸면 이미 빌드된 JS에는 반영되지 않는다. 공식 ID 후보의 `bridge.html`, bridge JS, `_headers`와 전체 파일 해시를 보관한다.

목표 헤더는 `/bridge.html`과 `/bridge` 각각 `Content-Security-Policy: frame-ancestors chrome-extension://<공식 ID>`다. 다른 경로의 CSP를 변경하거나 와일드카드를 추가하지 않는다. 기본 미설정 빌드는 계속 `'none'`이다.

## 4. 신뢰 경계와 검증 결과 해석

- 웹 브리지는 허용된 확장 origin으로만 구성된 조상 체인을 검사한 뒤 store를 복원한다. 최상위 직접 열기·웹사이트 조상은 거절한다. event.source는 부모, origin은 허용 부모와 일치해야 한다.
- 확장 offscreen은 iframe source·정확한 39page origin·namespace·프로토콜 버전을 검사한다. 응답 ID와 요청 ID가 맞아야 한다. 워커는 자신의 확장 sender와 묶인 panel document/tab을 검사한다.
- 명령은 hello, library/list, moment/list-for-video, request/status, track/add, playlist/create-and-add, moment/add로 제한한다. 영상 ID·메모 길이·시점·목록 이름·deadline·중복 요청을 검증한다.
- 쓰기는 UI의 저장 동작에서 시작한다. 읽기는 패널 개방/영상 변경/재시도에서 시작한다. 확장 origin 허용은 사용자 인증이나 클릭의 암호학적 증명이 아니다. 승인된 확장 코드 또는 39page origin이 침해되면 이 브리지 권한도 악용될 수 있다. 일반 웹사이트에는 이 메시지 API를 개방하지 않는다.
- 호스트 권한은 offscreen 생성 전·후·요청 직전에 확인한다. 권한 변경 시 문서를 닫고 세대를 바꾼다. 워커 재시작 시 남아 있는 문서를 재사용하지 않는다. 철회 중 이미 보낸 쓰기는 결과 불확실로 취급할 수 있다.
- 재시도는 같은 요청 ID와 저장 항목의 파생 ID를 사용해 중복 쓰기를 막는다. 불확실한 쓰기를 성공으로 표시하지 않는다.
- 새 timeout 사유는 준비/읽기 시간 초과를 전달한다. CSP 차단은 페이지 JS 실행 전에 일어나므로 명시적인 not-allowed 응답이 오지 않을 수 있다. timeout을 브리지 미지원으로 단정하지 않는다. Collect는 명시적 클릭으로 열고 메모를 URL에 넣지 않는다.

자동 검증은 각 모듈·가짜 Chrome port·DOM 수준의 계약을 확인한다. 실제 Store 설치본의 저장소 분할과 서버 헤더는 자동 단위 테스트만으로 증명할 수 없다.

## 5. 운영 변경안과 원복 — 실행 전 승인 필수

현재 유효 운영 기준은 `cac19d5` 소스의 배포 기록이다. 이전 Worker 버전은 [deployment.json](production-release-results/deployment.json)에 기록돼 있으나, 실행 직전 현재 active 버전을 다시 조회해 원복 기준으로 고정한다.

변경 예정:

1. 사용자 확인 공식 ID 한 개를 운영 **빌드** 변수에 추가하고 다시 빌드한다.
2. 웹 브리지 JS의 허용 목록 및 두 bridge 경로의 CSP만 해당 origin에 개방한다. 프라이버시 초안은 연락처·시행일·호스팅 로그 확인을 마친 버전을 포함한다.
3. 사용자 데이터 스키마·키·재생 어댑터·큐·테마는 바꾸지 않는다. 현재 작업의 웹앱 기능 코드는 건드리지 않았다.
4. 배포 대상 commit·전체 파일 diff·후보 SHA-256·활성 Worker 버전·환경변수 전후·원복 대상 버전을 표로 제시한 뒤 승인을 요청한다. 이 문서 자체는 배포 승인이 아니다.

원복:

1. 급하면 공식 ID allowlist를 비우고 재빌드/승인된 원복 배포해 두 경로를 `'none'`으로 되돌린다. 변수 삭제만으로 기존 정적 파일이 바뀌지는 않는다.
2. 또는 Cloudflare의 이전 검증된 Worker **정적 자산 포함 배포 버전**으로 rollback한다. 실행 전 실제 사용 가능한 버전을 확인한다.
3. 운영 build 변수도 이전 값으로 돌려 후속 자동 빌드가 다시 개방하지 않게 한다.
4. 웹앱·Collect는 유지하고 확장은 폴백을 제공한다. 이미 정상 저장한 곡·Moment를 삭제하거나 백업 파일을 덮지 않는다. 확장을 제거하지 않는다.
5. 두 bridge 경로의 최종 CSP, 루트 앱, 기존 데이터·재생을 다시 확인한다. Store 심사 중이면 영향 내용을 수정하고, 이미 배포된 확장은 상위 버전 업데이트로 복구한다.

운영 응답 확인 명령:

```powershell
curl.exe -sS -L -D - -o NUL https://39page.com/bridge.html
curl.exe -sS -D - -o NUL https://39page.com/bridge
curl.exe -sS -D - -o NUL https://39page.com/
```

## 6. 심사자 테스트 안내 — 붙여넣기

별도 39page 계정·로그인이 필요하지 않습니다. 새 Chrome 테스트 프로필과 테스트용 플레이리스트로 확인해 주세요. 권한 없이 시작해도 기본 Collect 기능을 쓸 수 있습니다. 직접 저장은 공식 확장 ID의 운영 브리지가 활성화된 상태에서만 시험해 주세요.

1. 확장을 설치하고 https://39page.com을 엽니다. 비어 있는 프로필의 기본 목록 이름을 테스트용으로 바꿉니다.
2. https://www.youtube.com/watch?v=aqz-KE-bpKQ 를 열고 재생합니다.
3. 도구 모음의 39page 아이콘이나 Alt+Shift+Y를 누릅니다. 카세트 패널이 나타납니다.
4. 39page 접근 허용을 누르고 사이트 권한을 승인합니다. 웹앱에서 만든 동일 목록과 곡 수가 보이는지 확인합니다.
5. 목록을 선택하고 이 플레이리스트에 담기를 누릅니다. 웹앱에서 해당 영상이 추가됐는지 확인합니다. 같은 영상을 다시 담을 때 중복 위치와 한 번 더 담기 선택을 확인합니다.
6. 새 플레이리스트 만들기를 선택하고 시험 이름을 입력해 만들기+담기를 실행합니다. 목록과 곡이 함께 생기는지 확인합니다.
7. Moment 저장 탭 또는 Alt+Shift+M을 사용합니다. 고정 시점을 확인하고 합성 메모를 입력해 저장합니다. 웹앱 Moments에서 같은 영상·초·메모를 확인합니다.
8. 확장 사이트 권한을 철회하고 패널을 다시 엽니다. 목록을 읽거나 직접 쓰지 않고 권한 안내가 복원되는지 확인합니다. 거부 후 수집 화면으로 열기를 눌러 새 탭에서 저장합니다. 저장 버튼 전에는 데이터가 추가되지 않아야 합니다.
9. 네트워크를 끊거나 브리지를 차단한 시험 환경에서는 연결 안내·재시도·Collect가 나타나야 합니다. 저장 결과를 잃으면 확인/같은 요청 재시도를 사용합니다.

지원 연락처·게시된 개인정보처리방침은 Store 항목에 기재해야 합니다. 제출 직전 원격 iframe 설명과 Privacy Practices가 일치하는지 확인합니다.

## 7. Store 설치본 UAT — 아직 TODO

공식 ID 제한 운영 배포 뒤 격리 프로필에 Trusted tester Store 설치본으로 시험한다. 압축해제 ID를 운영에 허용해서 대체하지 않는다.

- 팝업/YouTube 패널 개방, 권한 승인·거부·철회, 동일한 운영 localStorage의 합성 목록 조회.
- 곡·Moment·새 목록 저장, 중복 확인, 입력 중 고정 시점, 저장 전/후 실제 데이터 비교.
- 서비스 워커 중지·재시작, offscreen 종료·재생성, 타임아웃·오프라인, 결과 확인 및 동일 ID 재시도.
- 다른 origin/source·payload·버전·요청 ID 거부, 다른 확장/웹사이트 조상 거부. 실제 Store ID 단일 CSP와 리다이렉트 최종 응답 확인.
- 기존 대시보드 재생·위치·큐·볼륨·테마 전환, 데이터 보존과 ZIP/JSON 백업 왕복.
- 최신 Chrome과 최소 Chrome 116 정책 검증. 승인 후 Private 사용자의 검증을 거쳐 Public 전환을 별도 판단.

공식 ID 전에는 위 운영 직접 저장 결과를 통과로 기록하지 않는다. 실제 실행한 검증은 [구현·검증 보고](CWS_PRIVATE_RELEASE_REPORT.md)에 구분해서 기록한다.
