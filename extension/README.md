# 39page Chrome 확장 (M10)

YouTube 에서 보고 있는 영상과 Moment를 39page 로 담는 확장이다.

1. YouTube 영상 페이지에서 툴바의 39page 아이콘을 누른다
2. 작은 패널에서 플레이리스트를 고르거나 새로 만들어 음악을 담고, 지금 시점과 메모를 Moment로 저장한다
3. 39page 접근 권한을 허용하지 않거나 패널을 사용할 수 없으면 **수집 화면**을 직접 열어 저장한다

확장은 데이터를 보관하지 않는다. 실제 저장은 offscreen 브리지 또는 수집 화면의 39page 웹앱 store가 담당한다 (ADR 0028).
기본 외형은 웹앱과 같은 Kawaii Synth Cassette다. 웹앱의 테마 선택과 자동 동기화하지 않는다.
디자인·스크린샷·검증: [출시 전 확장 테마 보고서](../docs/development/EXTENSION_CASSETTE_REPORT.md), [ADR 0037](../docs/decisions/0037-extension-cassette-design.md).

- 설계: [`../docs/architecture/EXTENSION_DESIGN.md`](../docs/architecture/EXTENSION_DESIGN.md)
- 결정: ADR [0022](../docs/decisions/0022-extension-repository-and-build.md) (저장소·빌드),
  [0023](../docs/decisions/0023-extension-webapp-communication.md) (웹앱 통신·권한)

웹앱과 **독립된 npm 프로젝트**다. 루트의 설치·빌드·배포(Cloudflare Workers Builds)는 이
폴더를 읽지 않는다.

## 명령 (이 폴더에서)

| 명령                     | 용도                                                                                     |
| ------------------------ | ---------------------------------------------------------------------------------------- |
| `npm install`            | 의존성 설치 (루트와 따로)                                                                |
| `npm run build`          | 타입 검사 + 빌드 + manifest 검사 → `dist/` (수집 화면: `https://39page.com`)             |
| `npm run build:dev`      | 개발 빌드 → `dist-dev/` (수집 화면: `VITE_COLLECT_ORIGIN`, 기본 `http://localhost:5173`) |
| `npm run type-check`     | 타입 검사만                                                                              |
| `npm test`               | 단위 테스트 1회                                                                          |
| `npm run lint`           | oxlint + ESLint (`--fix` 포함)                                                           |
| `npm run format:check`   | Prettier 검사                                                                            |
| `npm run check:manifest` | `dist/manifest.json` 과 산출물 검사 (빌드 뒤)                                            |

## Chrome 에 올려 보기

1. `npm run build`
2. `chrome://extensions` → 오른쪽 위 **개발자 모드** 켜기
3. **압축해제된 확장 프로그램을 로드합니다** → `extension/dist` 폴더 선택
4. YouTube 영상 페이지에서 툴바의 39page 아이콘을 누른다

웹앱을 로컬에서 함께 볼 때는 `npm run build:dev` 의 `dist-dev` 를 올린다. 수집 화면 주소는
허용 목록(`http://localhost:5173`, `http://127.0.0.1:5173`, `http://localhost:4173`,
`http://127.0.0.1:4173`)만 쓸 수 있고, 그 밖의 값이면 빌드가 멈춘다.

데스크톱 Chrome 을 기준으로 한다. 모바일 브라우저에서의 동작은 확인하지 않았다 (TODO, M10-6).

## 권한

| 권한                          | 왜                                                              |
| ----------------------------- | --------------------------------------------------------------- |
| `activeTab`                   | 아이콘을 누른 **그 탭**의 주소를 보고 스크립트를 넣는다         |
| `scripting`                   | 그 탭에 페이지를 읽는 스크립트 · 패널 iframe 을 넣는다          |
| `offscreen`                   | 39page 저장 페이지를 띄울 보이지 않는 문서 (M11-5, 경고 없음)   |
| `https://39page.com/*` (선택) | 패널에서 바로 저장 — 처음 쓸 때 묻는다. 없으면 수집 화면(새 탭) |

YouTube 상시 접근 권한·방문 기록 권한(`tabs`)은 요청하지 않는다. 확장은 데이터를 갖지 않는다 — 저장은 39page 의 기존
store 가 39page origin 에서 한다 (ADR 0028). Chrome 116 이상.

## 실제 Chrome 통합 하네스 (M11-5)

`integration/` — Chrome for Testing · 격리 프로필 · 로컬 빌드(127.0.0.1:4173)만. 실제 권한 프롬프트는 헤드풀 + Windows UI
Automation(`permissions-prompt.ps1`, 그 Chrome 프로세스의 창만)으로 누른다.

```sh
# 39page (루트): 개발 확장 ID 를 허용한 빌드
VITE_BRIDGE_EXTENSION_IDS=pkagnijdhfmkodpdfgdehfdghcgbfpoa VITE_BRIDGE_DEV_BUILD=1 npx vite build --outDir <WEB_DIST>
# 확장: 개발 빌드(고정 ID · 개발 origin)
VITE_COLLECT_ORIGIN=http://127.0.0.1:4173 npm run build:dev
POC_CHROME=<chrome.exe> WEB_DIST=<…> EXT_DIST=<…/dist-dev> OUT=<…> node integration/bridge.mjs   # 브리지 15
POC_CHROME=<chrome.exe> WEB_DIST=<…> EXT_DIST=<…/dist-dev> OUT=<…> node integration/panel.mjs    # 패널 12 (실제 YouTube)
# M11-6
POC_CHROME=<chrome.exe> WEB_DIST=<…> OUT=<…> node integration/webapp.mjs                           # 웹앱 시나리오 (확장 없음)
POC_CHROME=<chrome.exe> WEB_DIST=<…> EXT_DIST=<…/dist-dev> OUT=<…> node integration/lifecycle.mjs  # offscreen 생명주기 · 속도 · 메모리
POC_CHROME=<chrome.exe> EXT_DIST=<…/dist-dev> EXT_PROD=<…/dist> OUT=<…> node integration/fixedId.mjs # 개발 고정 ID
LOAD_VIA_FLAG=1 POC_CHROME=<Chrome for Testing 116> … node integration/bridge.mjs                  # 최소 버전 (명령줄로 확장 로드)
```

## 구조

```
src/
├── panel/        Vue 3 YouTube 위 패널 — 음악 담기 · Moment · 결과 (M11-5)
├── offscreen/    39page 저장 페이지를 띄우는 offscreen 문서 (M11-5)
├── popup/        Vue 3 팝업 — YouTube 영상이면 패널을 열고 닫힌다, 아니면 안내 · 수집 화면
├── background/   서비스 워커 — 메시지 라우터 · 탭 조회 · 스크립트 주입 · 플레이어 읽기
├── content/      YouTube 페이지에서 읽기만 하는 스크립트 (아이콘을 누를 때 주입)
├── ui/           팝업·패널 공통 Cassette 표현·아이콘 원본
└── shared/       메시지 계약 v1 · 검증 · YouTube 페이지 판정 · 제목 정리
```

웹앱 코드는 `@web/` 별칭으로 **허용 목록**(youtube·time 순수 유틸리티, 공통·Cassette 토큰
CSS 두 파일)만 가져온다. `tests/boundaries.spec.ts` 가 고정한다.
