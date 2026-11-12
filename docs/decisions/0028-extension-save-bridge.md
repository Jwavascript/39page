# 0028. 확장 저장은 offscreen 문서 안의 39page 브리지 페이지가 기존 store 로 하고, 새 탭 수집 화면은 대체 경로로 남긴다

- 상태: **채택 — M11-5 (2026-11-12, 로컬 브랜치).** 조건부 채택(M11 Batch A) 뒤 정식 구현했다. 남은 조건:
  Chrome 웹 스토어 심사(`IFRAME_SCRIPTING` · 선택 호스트 권한) · 브랜드 Chrome 실사용 · 운영 확장 ID 확정(그 전까지 운영
  `bridge.html` 은 꺼져 있다 — 결정 14). (제안 — M11-1 · 조건부 채택 — M11 Batch A)
- 관련: **ADR 0023** (수집 화면 URL — 이 결정이 주 경로를 바꾸고 그것을 대체 경로로 남긴다), **ADR 0025** (탭 간 잠금),
  **ADR 0007** (보호 상태), **ADR 0026** (Moment 캡처), `docs/architecture/M11_BRIDGE_POC.md`, `poc/m11-bridge/`

## 배경

M10 확장은 담기 · Moment 마다 39page 새 탭을 연다(ADR 0023 결정 1 — 탭 하나가 열리는 UX 비용을 받아들였다).
사용자는 YouTube 를 떠나지 않고 작은 패널에서 끝내기를 원한다. 39page 데이터는 `https://39page.com` 의
localStorage 에 있고 확장 · YouTube 는 다른 origin 이다. 서버 · 계정은 범위 밖이다.

ADR 0023 은 "열린 39page 탭에 메시지(B)" 를 보류했다 — 탭이 없으면 결국 새 탭이 필요하기 때문이다. M11-1 은 탭이
**없어도** 되는 길을 찾았다.

## 실측 근거 (Chrome for Testing 157, 실제 YouTube — `M11_BRIDGE_POC.md`)

- 확장에 39page **호스트 권한이 있으면** offscreen 문서 안의 39page iframe 이 사용자의 39page 탭과 같은 localStorage ·
  Web Locks 잠금 관리자 · `storage` 이벤트를 쓴다 (P0a · P0b). 공식 문서의 규칙과 같다.
- 권한이 없으면 같은 iframe 은 분할된 빈 저장소를 본다 (P0d). YouTube 위 확장 iframe 안에 넣은 39page 는 권한이 있어도
  분할된다 (P0c).
- 그 브리지로 39page 탭 없이 조회 · 목록 생성 + 곡 추가 · Moment 저장을 했고(S2 · S3 · S4), 워커 재시작 · 응답 중단 ·
  중복 요청 · 손상 상태 · 위조 · 서버 중단 · 부분 성공에서 성공을 지어내지 않았다. offscreen 브리지와 39page 탭이 같은
  순간 저장한 30쌍 × 3회에서 조용한 손실 0 (S5-race).

## 결정 (제안)

1. **주 경로 = 후보 B.** 확장이 offscreen 문서(`IFRAME_SCRIPTING`)를 만들고 그 안에 39page 의 화면 없는 `bridge.html` 을
   iframe 으로 띄운다. 브리지는 **기존 Library · Moments store 명령으로만** 쓴다 — 검증 · 보호 상태 · 잠금 + 영수증이
   그대로다.
2. **통신 성공 ≠ 저장 성공.** 브리지는 저장소를 다시 읽어 항목이 있을 때만 `ok` 를 돌려준다. 응답을 잃으면 패널은 같은
   쓰기를 다시 보내지 않고 **먼저 조회**한다(`track/find` · `moment/find`). 조회도 못 하면 "확인하지 못했다" 고 말한다.
3. **보호 · 사용 불가 상태면 store 를 부르지 않는다** (`blocked`).
4. **웹페이지에서 확장으로 들어오는 문을 열지 않는다** — `externally_connectable` 을 쓰지 않는다 (후보 A 기각).
5. **브리지는 조상 전체가 허용한 확장 origin 일 때만 일한다.** 허용 ID 는 웹앱 빌드에 박는다. 운영에서는
   `frame-ancestors` 헤더를 더한다.
6. **호스트 권한은 `optional_host_permissions` 로 두고 첫 사용 때 묻는다** — 설치 경고를 늘리지 않고, 거절하면 새 탭
   수집 화면. 실행 중에 받은 권한으로도 **새로 만든** offscreen iframe 은 최상위 파티션을 쓴다 (실측 — 아래).
7. **분할 판단 · 권한 수명은 확장이 맡는다** (선택 권한 사전 검증에서 더함): 브리지 iframe 은 자신이 분할됐는지 알 수
   없다. offscreen 을 만들기 전과 쓰기 전마다 `permissions.contains`, `onAdded` 면 offscreen 을 다시 만들고,
   `onRemoved` 면 즉시 닫는다. `minimum_chrome_version` 은 116 으로 올린다(제안 — offscreen 109 · 분할 115 ·
   `getContexts` 116).
8. **M10 새 탭 수집 화면(ADR 0023)을 지우지 않는다** — 권한 거절 · 브리지 실패 · 보호 상태 · 미지원 환경의 대체 경로.
9. 패널은 YouTube 위에 **확장 페이지 iframe** 으로 띄운다 — YouTube 가 목록 · 메모를 읽거나 버튼을 대신 누르지 못한다.
10. 메시지 계약 v1 (`M11_BRIDGE_POC.md` §7): 버전 · 요청 ID 중복 실행 방지 · 마감(8초 시작 창, 30초 상한) · 송신자 검증 ·
    입력 검증 · 부분 성공(`partial` + 만든 목록 ID).

## 대안

| 대안                                             | 판단                                                                                                                    |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| A. 39page 탭이 연 포트(`externally_connectable`) | 동작한다(A1) — 그러나 39page 탭이 있어야 하고, 워커가 죽으면 다시 연결해야 하며, 웹페이지 → 확장의 문을 연다. 기각      |
| 사이드 패널 + 39page iframe                      | 저장소 조건은 B 와 같다(P0b 로 대신 측정). 떠 있는 패널이 아니라 화면 옆을 차지한다. 사용자가 원하면 같은 브리지를 쓴다 |
| YouTube 페이지 안에 39page iframe                | 분할된 저장소 (P0c). 기각                                                                                               |
| 확장이 저장소를 직접 (offscreen localStorage)    | 확장 origin 의 저장소다 — 39page 데이터가 아니다. store 보호를 우회. 기각 (ADR 0023 의 C 와 같음)                       |
| 새 탭 수집 화면만 유지                           | 가장 안전하고 검증됐지만 목표 UX 가 아니다. 대체 경로로 남긴다                                                          |

## 결과

- 확장 권한: `activeTab` · `scripting` + **`offscreen`**(경고 없음) + **39page 호스트 권한**(선택 권한, 처음 쓸 때 묻는다).
  `web_accessible_resources` 에 패널 페이지(YouTube 한정).
- 웹앱: 운영 `bridge.html` 입구와 `src/features/bridge/` 가 생긴다. 저장 키 · 스키마 · 백업 형식은 그대로.
- ADR 0023 결정 1 은 "주 경로" 에서 "대체 경로" 로 바뀐다. 결정 2–7 (조각 URL · 승인 · 계약 v1) 은 그대로 유효하다.
- `createPlaylist` 가 새 목록을 선택하는 기존 동작 때문에 확장에서 만든 목록이 대시보드 선택을 바꾼다 — 옵션 추가를
  제안한다 (`M11_UX_DESIGN.md` §10 D4).
- PoC 폴더 `poc/m11-bridge/` 는 단일 `src` 규칙의 임시 예외이며 M11 구현 뒤 지운다.

## 선택 권한 사전 검증 (M11 Batch A, 2026-11-12 — `M11_BRIDGE_POC.md` §12)

실제 Chrome API 로 잰 것 (Chrome for Testing 157 헤드풀, 실제 권한 프롬프트 단추를 UI Automation 으로 누름):

- 거부 → `request()` `false`, 바뀌는 것 없음. 허용 → `true` · `onAdded`. **부여 뒤 새로 만든** iframe 은 대시보드와 같은
  저장소 · 잠금, 브리지 조회 결과가 대시보드와 같다. **부여 전에 떠 있던** iframe 은 계속 분할.
- `permissions.remove()` · 확장 관리 화면의 사이트 액세스 제거 모두 `onRemoved` · 새 iframe 분할. 그러나 **권한이 있을 때 뜬
  문서는 철회 뒤에도 사용자 저장소를 읽는다**, 철회 뒤 새로 만든 브리지는 분할된 빈 저장소를 `ready` 로 보인다.
  `document.hasStorageAccess()` 는 두 경우 모두 `true` — 브리지가 스스로 판별할 수 없다 → 결정 10.
- 철회 뒤 재요청은 프롬프트 없이 다시 부여된다. 철회 상태에서도 새 탭 수집 화면은 그대로 동작한다.

공식 문서로만 확인한 것: offscreen 109+ · `getContexts` 116+ · 분할 규칙 115+, `IFRAME_SCRIPTING` 문구, 웹 스토어 정책의
"확장 API 와 격리된 맥락(iframe)의 코드는 원격 코드 예외". 판단: **재검토 불필요 — 조건부 채택 유지.**

## M11-5 정식 구현에서 더한 결정

11. **정확히 한 번 — 저장 항목 id 를 요청 ID 에서 정한다.** Moment `ext-<요청>`, 곡 `ext-<요청>`, 새 목록
    `ext-<요청>-list`. store 의 선택 `id` 옵션(`createPlaylist(name, { select, id })` · `addTrack(…, { id })` ·
    `moments.add({ id })`)으로 넘기고, store 는 **탭 간 잠금 안에서** 그 id 가 있으면 쓰지 않고 `existed` 로 성공한다.
    그래서 같은 요청 ID 를 다시 보내면 — 워커 · offscreen 이 다시 떴어도, 응답만 잃었어도 — 한 번만 저장된다. 메모리
    기록(같은 순간의 재전송)은 덧붙인 것이다. 응답을 잃으면 자동 재시도하지 않고 사용자가 "저장됐는지 확인"
    (`request/status` — 저장소 원문에서 그 id 를 찾는다) 또는 "다시 시도"(같은 ID)를 고른다. 부분 성공(목록 O · 곡 X)도
    같은 ID 재시도로 곡만 담는다 — 같은 이름의 목록이 또 생기지 않는다. **저장 키 · 스키마 · 백업 형식은 그대로**다
    (id 는 원래 문자열이고 앱이 만드는 id 와 앞머리가 다르다).
12. **패널 신뢰 경계.** 패널은 확장 origin iframe(`web_accessible_resources` — YouTube 한정, `use_dynamic_url`)이고
    content script 가 **닫힌 shadow root** 안에 하나만 띄운다. 패널의 요청은 대상 탭을 메시지가 아니라 보낸 쪽 탭
    (`sender.tab.id`)으로 정하고, 워커가 패널을 연 직후 처음 동기화한 문서(`sender.documentId`)에 묶인다 — 같은 탭에서
    다른 문서(페이지 스크립트가 따로 띄운 패널 iframe)의 요청은 거절한다. 패널 판별은 경로로 한다 — 실측으로
    `use_dynamic_url` 자원은 워커의 `getURL()` 이 동적 주소를 주지만 `sender.url` 은 확장 ID 주소였다.
13. **권한 수명 (결정 10 의 구현).** 워커 메모리의 세대(`gen`) — `onAdded` · `onRemoved` 에 올리고 offscreen 을 닫는다.
    offscreen 주소에 세대를 적고 offscreen 은 다른 세대의 요청을 거절한다. 워커가 시작하면 내력을 모르는 문서를
    닫는다. 준비했던 문서가 사라지면(브라우저가 닫음 · 충돌) 다음 요청이 다시 띄운다. 권한은 생성 전 · 후 · 모든
    요청 직전 `contains`.
14. **운영 브리지의 허용 확장 ID 는 빌드 값**(`VITE_BRIDGE_EXTENSION_IDS`)이다. 비어 있으면 `bridge.html` 은 아무
    요청도 받지 않는다 — 운영 확장 ID 는 스토어 등록 뒤에 정해지므로 **지금 운영 빌드에서 브리지는 꺼져 있고** 패널은
    "아직 바로 저장을 받지 않아요" 와 수집 화면을 보인다. 개발 빌드는 고정 공개 키(`extension/vite.config.ts`, PoC 와
    같은 ID)로 압축해제 설치의 ID 를 고정한다 — 운영 manifest 에는 `key` 를 넣지 않는다(검사기).
15. **아이콘 · 단축키 = 패널.** 팝업은 남는다 — YouTube 영상 페이지면 패널을 열고 닫히고, 열지 못하면 기존 화면(수집
    화면 버튼)이 대체 경로다. 단축키는 패널(음악 · Moment)을 연다. Moment 단축키는 누른 순간의 시점을 잡아 넘긴다.
    수집 화면(새 탭)은 패널에서 사용자가 고를 때만 연다 — 오류가 나도 자동으로 열지 않는다.

## M11-5 실측 (Chrome for Testing 157 · 헤드풀 · 실제 권한 프롬프트 · 격리 프로필 · 로컬 빌드)

- 브리지 15/15 (`extension/integration/bridge.mjs`): 권한 거부 · 허용(실제 프롬프트), 부여 직후 목록 = 대시보드 저장소,
  담기 · 새 목록 · Moment 저장 확인, 대시보드 선택 · 재생 · iframe 유지, 같은 ID 재전송 1건, **응답 유실 2종**(처리 중
  워커 강제 종료 → 저장됨 확인 → 재시도 `existed`, 처리 중 offscreen 종료 → `uncertain` → 저장 안 됨 확인 → 재시도 1건),
  API 철회 → offscreen 닫힘 · 쓰기 거절, 재허용(프롬프트 없음), **워커가 멈춘 동안 사이트 액세스에서 철회 → onRemoved 가
  워커를 깨워 offscreen 을 닫음**, 대시보드와 같은 순간 저장 15회 손실 0, 손상 Moments `blocked` · 원본 그대로, 쓰기와 철회
  경합 → 저장 여부와 결과가 일치.
- 패널 12/12 (`extension/integration/panel.mjs`, 실제 YouTube): 툴바 → 오른쪽 아래 패널 · 새 탭 0 · 재생 계속, 권한 거부 →
  수집 화면, 허용 → 담기 · 즉석 목록 · 중복 확인, Moment 0:13 저장 → 대시보드 보관함에서 그 시점부터 재생, SPA 이동 알림 ·
  바꾸기, Esc · 열고 닫기 10번 누적 0, 400px 창, 20번 오래 쓰기(저장 정확히 20 · offscreen 1 · 워커 힙 안정).
- 실측으로 고친 것: 사라진 offscreen 문서를 계속 준비됨으로 여김(B7b) → 다시 띄움. `use_dynamic_url` 로 패널 요청을 패널로
  알아보지 못함 → 경로 비교. 좁은 창에서 `100vw` 가 스크롤 막대를 포함해 패널이 11px 넘침 → `%`.
- 사이트 액세스(확장 관리 화면)로 철회한 뒤의 재요청은 프롬프트가 다시 뜬다(API `remove` 뒤에는 뜨지 않는다).

## M11-6 에서 더한 결정

16. **offscreen 유휴 정리.** 실측(6분 유휴 뒤에도 offscreen 1개 · 프로세스 메모리 약 15MB 상주)에 따라, offscreen 이 5분 동안
    요청이 없고 처리 중인 요청도 없으면 워커에 `offscreen/idle {gen}` 을 알린다. 워커는 **같은 세대 · 처리 중 0 · 마지막 사용 뒤
    시간 경과**를 다시 확인하고 닫는다 — 저장 중인 요청을 끊지 않는다. 알림은 탭이 아닌 offscreen 경로에서 온 것만 받는다.
    다음 요청은 문서를 다시 띄운다(실측 다시 연결 중앙값 약 50ms).
17. **`bridge.html` 응답 헤더는 빌드가 만든다.** `dist/_headers` — `frame-ancestors` 는 허용 확장 origin, 없으면 `'none'`.
    허용 ID 형식 검사, 개발용 고정 ID 는 시험 빌드 표시(`VITE_BRIDGE_DEV_BUILD=1`) 없이 들어가면 빌드 실패.
    HTML meta 로는 `frame-ancestors` 가 동작하지 않으므로 응답 헤더만 쓴다. 운영 응답 헤더 실측은 배포 뒤(미확인).
18. **툴바 클릭의 팝업 깜빡임 제거.** 그 탭에서 패널을 한 번 연 뒤 탭별 팝업을 끄고(`action.setPopup({tabId, popup: ''})`)
    `action.onClicked` 로 바로 패널을 연다. 패널을 열 수 없는 페이지면 그 탭의 팝업을 다시 켠다(Chrome 127+ 는 바로 연다).
    결정 15 의 대체 경로(팝업 → 수집 화면)는 그대로다.

## 미검증 — 승인 전에 알아야 할 위험

- ~~선택 호스트 권한을 실행 중에 받은 경우의 파티션 (결정 6)~~ — 실측 완료. ~~워커가 죽어 있는 동안의 철회~~ — M11-5 실측
  (깨어나 닫는다). 프롬프트 한국어 문구 · 운영 origin(https) · Chrome 116 실제 버전 · 실제 키보드 단축키(CDP 키 입력은
  브라우저 단축키를 실행하지 못했다)는 미측정
- 브랜드 Chrome 안정판 · 사람의 툴바 클릭 · 단축키 키 입력 (측정은 Chrome for Testing + CDP)
- 웹 스토어 심사가 `IFRAME_SCRIPTING` 사유를 받아들이는지
- ~~offscreen + 브리지의 상주 메모리, 유휴 정리 시간~~ — M11-6 실측 · 결정 16
