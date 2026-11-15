# 출시 전 Chrome 확장 Cassette 디자인 정리 (2026-11-15)

## 시작과 범위

- 시작 브랜치 `m12-6-header-collapse`, HEAD `80a4cd3`, 작업 트리 깨끗함. 이 변경을 보존하고 `extension-cassette-design`을 만들었다.
- AGENTS.md·CLAUDE.md·THEME_SYSTEM.md, ADR 0022·0023·0028·0031, 확장 코드, 현재 Cassette 토큰/데크 및 승인된 v09 레퍼런스를 검토했다.
- 결정: [ADR 0037](../decisions/0037-extension-cassette-design.md). 디자인 표현만 변경했다.

## 바뀐 화면

팝업과 패널은 첫 HTML부터 Cassette 테마 속성을 가지며 웹앱의 공통·Cassette 토큰 CSS를 직접 사용한다.
민트 배경/선택 표시, 핑크 주요 버튼·제목, 기존 카드 질감, 도트, 모노스페이스 브랜드·라벨을 재사용한다.
웹앱 Vue 컴포넌트·store를 확장으로 가져오지 않으며 웹앱 테마 설정과 자동 동기화하지 않는다.

공통 브랜드와 툴바 16/32/48/128 아이콘은 승인된 카세트 내부 도형을 그대로 잘라 크기를 맞췄다.
원본은 `extension/src/ui/cassette.svg`다. 동적 레이블 foreignObject만 기존 기본 레이블을 나타내는 정적 text로 바꿨다.
이전 `design/assets/extension-icon.svg` LP 초안은 과거 자료이며 현재 아이콘 원본은 새 SVG다.
승인된 `design/references/` 및 웹앱 테마 소스는 수정하지 않았다.

플레이리스트 이름과 메타데이터를 두 줄 영역으로 나눠 긴 이름·중복 위치를 읽는다.
제목은 기존 3줄 말줄임과 전체 텍스트를 유지하고 title 힌트를 제공한다. 메모는 기존 500자 한도 그대로다.
콘텐츠 내부 스크롤, 44px 조작 영역, 보이는 포커스 링, 탭의 좌우 방향키, Esc 닫기를 유지한다.
극단적인 좁은 폭에서는 브랜드 장식을 줄여 이름과 닫기 버튼을 보존한다.

저장 완료는 민트 바탕과 체크·제목·status, 실패는 오류 선과 제목·alert,
불확실/부분 성공은 별도 제목·alert로 구별한다. 확인되지 않은 저장을 성공으로 표시하지 않는다.
권한 안내는 별도 영역과 제목을 가지며 요청 중에는 `권한 요청 중…`·aria-busy·비활성 상태를 표시한다.
거부하면 안내·Collect 폴백이 유지되고, 승인하면 기존 목록/저장 경로로 진행한다.

## 유지한 계약

Manifest 원본, 권한·호스트 범위·ID·개발 키, background·content·offscreen·메시지/브리지 계약,
저장 composable, 데이터 모델·저장소·스키마·ZIP은 변경하지 않았다. 웹앱 `src/`도 변경하지 않았다.
음악 추가·즉석 목록·Moment·중복 확인·불확실 응답 조회·재시도·보호 상태·단축키·권한 철회는 기존 경로를 쓴다.
추가 의존성·원격 글꼴·원격 이미지 없음.

## 실행한 검사

| 위치      | 실제 실행 명령                                                  | 결과                                                                                   |
| --------- | --------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| extension | `npm test`                                                      | 26파일 / 420 통과                                                                      |
| extension | `npm run build`                                                 | type-check·두 Vite 빌드·Manifest 검사 통과, 20파일·기존 권한 3개·단축키 2개·아이콘 4개 |
| extension | `npm run lint`                                                  | 통과                                                                                   |
| extension | `npm run format:check`                                          | 통과                                                                                   |
| root      | `npm test`                                                      | 67파일 / 2,127 통과 (웹앱·브리지 포함)                                                 |
| root      | `npm run build`                                                 | type-check·production build 통과                                                       |
| root      | `npm run lint`                                                  | 통과                                                                                   |
| root      | `npm run format:check`                                          | 통과                                                                                   |
| root      | `node extension/integration/cassette-design.mjs`                | 실제 Chrome 12/12 통과                                                                 |
| root      | `node extension/integration/cassette-design.mjs --render-icons` | 같은 SVG에서 PNG 4개 생성                                                              |
| root      | `git diff --check`                                              | 통과                                                                                   |

기존 도구의 Node localStorage ExperimentalWarning 및 Vite configLoader 향후 변경 안내가 출력됐으며 명령은 통과했다.
실행하지 않은 Chrome 116·장시간 lifecycle 시험을 이번 결과에 포함하지 않았다.
초기 lint는 추가한 테스트의 조건부 expect 규칙 위반을 잡아 무조건 실행되는 검증으로 고쳤다.
확장 전체 포맷 검사가 기존 `integration/bridge.mjs`의 한 줄에서 실패해 그 줄의 포맷만 정리했다(동작 변경 없음).
이후 양쪽 lint·포맷과 확장 전체 테스트를 다시 통과했다.

## 실제 Chrome

설치된 Chrome 157.0.8103.51, 새 임시 프로필, 헤드풀, CDP로 로드한 개발 확장, 로컬 웹앱만 사용했다.
사용자의 평소 브라우저 프로필·데이터·운영 사이트는 사용하지 않았다.
실제 YouTube `aqz-KE-bpKQ`와 시험용 플레이리스트로 검증했다.

- 실제 툴바 팝업: 지원하지 않는 페이지의 안내, Cassette 브랜드, 360px 폭, 가로 넘침 0.
  YouTube에서는 기존대로 팝업이 패널을 열고 닫힌다. 영상이 있는 팝업 폴백 조작은 자동 단위 테스트로 검증했다.
- 실제 권한 프롬프트의 **Deny / Allow**를 해당 격리 Chrome 프로세스의 Windows UI Automation으로 눌렀다.
  요청 중 aria-busy, 거부 후 안내와 쓰기 없음, 승인 후 원래 브리지의 플레이리스트 조회를 확인했다.
- 음악 담기·즉석 목록 생성·Moment 시점 캡처·500자 메모 저장 후 대시보드 저장소에서 결과를 읽었다.
  메모를 쓰는 동안 고정 시점, 대시보드 선택 목록과 같은 iframe 노드도 유지됐다.
- offscreen 안 웹앱의 library 쓰기에 QuotaExceededError를 주입했다. 실제 저장 실패 UI·기존 데이터 유지·성공 오표시 없음을 확인하고 원래 함수를 복원했다.
- 긴 제목 **표현만** DOM 시험 데이터로 치환해 레이아웃을 확인했다. 실제 영상/저장 데이터는 변경하지 않았다.
- 방향키로 탭 전환·포커스 링, Esc 닫기, 3회 재개방/닫기 누적 없음, YouTube 재생 계속을 확인했다.
- API 권한 철회 후 offscreen 0개, 재개방 시 권한 안내 복원을 확인했다. Collect는 직접 누를 때 기존 URL로 열린다.

| YouTube 시험 viewport | 탭 확대 | 실제 패널 내부 폭×높이 | 가로 넘침 | 헤더 제목 경계 |
| --------------------- | ------- | ---------------------- | --------- | -------------- |
| 1440×900              | 100%    | 380×620                | 0         | 정상           |
| 390×844               | 100%    | 343×620                | 0         | 정상           |
| 360×780               | 100%    | 313×620                | 0         | 정상           |
| 844×390               | 100%    | 380×358                | 0         | 정상           |
| 720×780               | 200%    | 320×350                | 0         | 정상           |
| 360×780               | 200%    | 140×350                | 0         | 정상           |

패널의 CSS를 검사한 것이며 배경 YouTube 페이지 자체의 좁은 화면 가로 스크롤과는 구별한다.
계산된 토큰 색 조합 8개(본문·보조·주요 버튼·선택 탭·성공·오류·경고·입력)는 모두 4.5:1 이상이었다.
그라디언트의 가장 밝은 색 기준 보조 텍스트가 최소 **4.79:1**, 주요 버튼 **7.04:1**, 성공 **10.59:1**이다.
화면 전체에 대한 접근성 인증을 의미하지는 않는다.

최종 원시 결과: [real-chrome.json](extension-cassette-results/real-chrome.json).
스크린샷은 최종 구현으로 다시 촬영했으며 실제 툴바 팝업과 실제 YouTube 위 패널이다.

| 화면             | 스크린샷                                                                              |
| ---------------- | ------------------------------------------------------------------------------------- |
| 툴바 팝업        | [popup-toolbar.png](extension-cassette-results/popup-toolbar.png)                     |
| 음악·긴 목록     | [panel-music.png](extension-cassette-results/panel-music.png)                         |
| 권한 거부        | [panel-permission-denied.png](extension-cassette-results/panel-permission-denied.png) |
| 500자 메모       | [panel-moment-note.png](extension-cassette-results/panel-moment-note.png)             |
| Moment 저장 완료 | [panel-moment-saved.png](extension-cassette-results/panel-moment-saved.png)           |
| 저장 실패        | [panel-save-error.png](extension-cassette-results/panel-save-error.png)               |
| 360×780          | [panel-360x780-zoom1.png](extension-cassette-results/panel-360x780-zoom1.png)         |
| 360×780·200%     | [panel-360x780-zoom2.png](extension-cassette-results/panel-360x780-zoom2.png)         |

검증 도중 SVG 추출이 주석의 `<defs>`까지 포함한 오류를 수정하고 유효 XML 회귀 검사를 추가했다.
첫 Chrome 실행(run1)은 과거 웹앱 선택자 때문에 준비 단계에서 실패했다.
run2는 테스트가 500자 한도를 넘긴 메모를 넣어 저장 버튼이 정상 비활성화된 결과였다. 500자로 교정했다.
run3는 11개를 통과했으나 스크린샷 검토로 팝업의 viewport 기반 폭 순환 문제와 좁은 헤더의 scoped CSS 우선순위를 찾아 고쳤다.
최종 실행은 폭·헤더 경계·대비 검사까지 추가해 **12/12** 통과했다. 앞선 JSON은 별도 보존하고 최종 통과에 합산하지 않았다.

## 재현

저장소 루트 PowerShell에서 실행한다. 개발용 origin·고정 ID는 기존 개발 빌드 설정을 사용한다.
운영 Manifest·허용 확장 ID를 수정하는 명령이 아니다.

```powershell
$env:VITE_BRIDGE_EXTENSION_IDS='pkagnijdhfmkodpdfgdehfdghcgbfpoa'
$env:VITE_BRIDGE_DEV_BUILD='1'
npx vite build --outDir node_modules/.tmp/cassette-web
Remove-Item Env:VITE_BRIDGE_EXTENSION_IDS, Env:VITE_BRIDGE_DEV_BUILD

$env:VITE_COLLECT_ORIGIN='http://127.0.0.1:4173'
npm --prefix extension run build:dev
Remove-Item Env:VITE_COLLECT_ORIGIN

$env:POC_CHROME='C:/Program Files/Google/Chrome/Application/chrome.exe'
node extension/integration/cassette-design.mjs
# SVG가 바뀌었을 때만 아이콘을 다시 생성한 뒤 확장을 다시 빌드한다.
# node extension/integration/cassette-design.mjs --render-icons
```

## 파일·커밋·TODO

- 변경 범주: 확장 팝업/패널 표현·공통 Cassette CSS/SVG·기존 PNG 아이콘, 관련 테스트, Chrome 하네스, ADR·테마 문서·README·이 보고서와 검증 자료.
- 모든 경로: [변경 파일 목록](extension-cassette-results/changed-files.md). 의존성 추가·삭제 파일 없음.
- 최종 로컬 커밋은 `git log -1 --oneline`로 확인한다. push·main 통합·운영 배포·Web Store 업로드는 하지 않았다.
- TODO: 사용자의 디자인 UAT, 실제 Alt+Shift+Y/M 단축키 입력, 화면 낭독기·OS 고대비 모드, Chrome 116/타 OS 실기기 확인.
  기존 단축키 핸들러·권한·데이터 보호 회귀는 자동 테스트에 포함되며, 이번 작업에서 해당 기능 코드는 수정하지 않았다.
