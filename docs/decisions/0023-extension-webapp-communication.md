# 0023. 확장 → 웹앱은 "수집 화면 URL" 로 넘기고, 저장은 웹앱이 사용자 승인 뒤에 한다

- 상태: 채택 — **M10-1 (2026-11-11)**. 수집 화면은 M10-3 에서 구현
- 관련: **ADR 0022** (저장소·빌드), **ADR 0019** (Moment 도메인),
  **ADR 0007** (라이브러리 데이터 보호), **ADR 0018** 결정 12 (백업 파일은 동기화
  수단이 아니다), `docs/architecture/EXTENSION_DESIGN.md` §4 ~ §9

## 배경

확장은 YouTube 탭에서 `videoId`·제목을 얻는다. 그것을 39page 의 라이브러리에
넣어야 한다. 원칙(Batch 1 지시):

- 웹앱의 Library/Moments store 가 실제 저장을 맡는다
- 확장은 사용자 데이터를 직접 고치지 않는다
- 서로 다른 origin 의 `localStorage` 가 공유된다고 가정하지 않는다
- 출처·입력 검증은 웹앱에서도 한다
- 명시적인 사용자 조작 없이 등록하지 않는다
- 외부 웹페이지가 위조한 메시지를 믿지 않는다

### 공식 API 로 확인한 사실 (developer.chrome.com, 2026-11-11)

| 사실                                                                                                                                | 출처                   |
| ----------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| "It is not possible to send a message from an extension to a web page."                                                             | Messaging              |
| 웹페이지 → 확장은 `externally_connectable` 을 선언할 때만. 선언이 없으면 "no web pages can connect"                                 | externally_connectable |
| `runtime.sendMessage` 로는 content script 에 보낼 수 없다 — `tabs.sendMessage` 를 쓴다                                              | runtime 레퍼런스       |
| content script 와 페이지는 DOM 을 공유하고 JS 변수는 공유하지 않는다(격리된 세계). `postMessage` 수신 쪽은 `event.source` 를 거른다 | Content scripts        |
| "Content scripts are less trustworthy" — 받은 메시지를 공격자가 만든 것으로 가정하고 검증하라                                       | Messaging              |
| `activeTab`: 사용자가 확장을 실행한 탭에 임시 호스트 권한 + url·title. 다른 사이트로 이동하면 회수. 설치 경고 없음                  | activeTab              |
| `tabs.create` 등 대부분의 탭 기능은 권한이 필요 없다. url·title 은 `tabs` 또는 호스트 권한이 있을 때만 보인다                       | tabs 레퍼런스          |

즉 `runtime.sendMessage` · `tabs.sendMessage` · `window.postMessage` ·
`externally_connectable` 은 **방향이 서로 다른 별개의 길**이다.

## 결정

### 1. MVP 는 A — 39page 의 수집 화면을 URL 로 연다

확장 Background 가 새 탭으로
`https://39page.com/#collect?v=1&kind=track&videoId=…&title=…&req=…` 를 연다.
웹앱이 값을 검증해 보여 주고, **사용자가 플레이리스트를 고르고 "추가" 를
눌러야** 기존 store API(`addTrack`)로 저장한다. 계약 상세는
`EXTENSION_DESIGN.md` §5-1.

| 기준   | A. 수집 화면 URL                                          | B. 열린 탭에 메시지                                                 | C. 저장소 직접                      |
| ------ | --------------------------------------------------------- | ------------------------------------------------------------------- | ----------------------------------- |
| 저장   | 웹앱 store                                                | 웹앱 store                                                          | ✖ 확장이 `localStorage` 를 쓴다     |
| 보안   | 입력은 주소 조각 하나. 위조 링크는 **승인 단계**가 막는다 | 39page 호스트 권한 + `postMessage` 중계. 페이지 안 코드가 위조 가능 | store 검증·손상 보호·백업 규칙 우회 |
| 권한   | 추가 없음                                                 | `https://39page.com/*` (설치 경고)                                  | 같음                                |
| 난이도 | 낮음                                                      | 중간 (요청·응답 짝, 시간 초과, 탭 여럿·없음)                        | 높음                                |
| UX     | 탭 하나가 열린다                                          | YouTube 를 떠나지 않는다 — 39page 탭이 열려 있을 때만               | —                                   |

- **B 는 보류**: UX 이득이 크지만 39page 탭이 없을 때 결국 A 가 필요하고, 탭이
  여럿이면 어느 탭에 보낼지와 탭 간 덮어쓰기(4번)를 함께 풀어야 한다. M10-5 에서
  A 위에 얹을 수 있는지 다시 본다.
- **C 는 기각**: 저장 주체 원칙에 어긋난다.

### 2. 주소 **조각**에 싣는다

`#` 뒤는 서버로 가지 않는다. 영상 정보가 Cloudflare 요청 로그에 남지 않고,
앱이 라우터를 쓰지 않으므로(SPA 폴백) 경로 설계가 필요 없다.

### 3. 재생 중인 39page 탭을 이동시키지 않는다

이동은 새로고침이고 재생이 끊긴다. 항상 새 탭을 YouTube 탭 옆에 연다
(`openerTabId`).

### 4. M10-3 의 선행 조건 — 탭 간 덮어쓰기

라이브러리 store 의 `persist()` 는 메모리 상태 전체를 쓰고 다른 탭의 변경을
확인하지 않는다(코드 확인). 대시보드 탭이 열린 채 수집 탭이 트랙을 추가하면
대시보드 탭의 다음 변경이 그 트랙을 **조용히 지운다.** 이는 39page 를 두 탭에
열 때 지금도 있는 문제이지만 Quick Add 가 일상 경로로 만든다.
**M10-3 은 수집 화면보다 이것을 먼저 고친다.** 방식(`storage` 이벤트로 다시
읽기 / 쓰기 직전 비교로 거절)은 M10-3 에서 정한다.

### 5. 확장 내부 메시지 계약 v1

봉투 `{ v: 1, type, … }`, 응답 `{ v: 1, ok: true, data } | { v: 1, ok: false,
error: { code, message } }`. 오류 코드 8개(`bad-request` · `unsupported-type` ·
`unsupported-version` · `forbidden-sender` · `no-tab` · `no-receiver` ·
`timeout` · `internal`). 모든 수신 지점이 같은 검증 함수를 쓴다. "지원하지 않는
페이지" 는 오류가 아니라 정상 결과(`status: 'unsupported'`)다.
(`EXTENSION_DESIGN.md` §6)

### 6. 권한 — `activeTab` · `scripting` (M10-3 에서 `storage` 추가)

- YouTube 호스트 권한을 요청하지 않는다. content script 는 사용자가 아이콘을
  누른 뒤 그 탭에만 주입한다.
- `tabs` · `<all_urls>` · 선언형 `content_scripts` · `externally_connectable` ·
  `web_accessible_resources` 를 쓰지 않는다.
- 확장은 네트워크 요청을 하지 않는다. 비밀 값을 번들에 넣지 않는다.

### 7. 지원 범위

`youtube.com`(`www.` · `m.`) 의 watch · shorts · live · embed. YouTube Music 은
M10 범위 밖(TODO). Shorts 는 Moment 캡처에서 뺀다. 판정은 웹앱
`parseYouTubeVideoId` 가 성공하는 주소의 **부분집합**이다.

## 대안

- **B 만 쓰기** — 39page 탭이 없으면 아무것도 못 한다.
- **`externally_connectable` 로 페이지가 확장에 연결** — 페이지가 확장 ID 를
  알아야 하고(압축해제 개발판·스토어판이 다르다) 페이지가 먼저 연결을 열어
  두어야 한다. 확장 → 페이지 방향이 없다는 사실은 그대로다.
- **백업 JSON 으로 넘기기** — ADR 0018 결정 12 에서 이미 기각(동기화 수단이 아니다).
- **확장이 저장 결과를 돌려받기** — 단방향 URL 로는 불가능하고 필요도 없다.
  결과는 웹앱이 사용자에게 직접 보인다.

## 결과

- 확장은 사용자 데이터에 닿는 권한이 0 이다. 39page origin 의 저장소를 읽거나
  쓸 수단이 없다.
- 어떤 사이트도 수집 링크를 만들 수 있다 — 웹앱 승인 화면이 유일한 관문이므로
  M10-3 테스트가 "승인 없이 저장 0" 을 고정해야 한다.
- 탭이 하나 더 열리는 UX 비용을 받아들인다.
- M10-4(Moment)는 같은 길에 `kind=moment` 를 더한다.

### 보완 (M10-2 실측, 2026-11-11)

- **제목 출처** — 실제 YouTube 의 SPA 이동에서 `document.title` 은 주소보다
  약 1초 늦었고, 그 사이 팝업이 새 ID 에 이전 제목을 붙였다. ID 와 제목을 한
  객체로 주는 플레이어 `getVideoData()` 를 **메인 세계에서** 읽는다
  (`scripting.executeScript({ world: 'MAIN' })`). 같은 `activeTab` 부여로 되며
  **권한은 늘지 않았다.** 결과는 신뢰하지 않는 입력으로 다시 검증한다
  (`EXTENSION_DESIGN.md` §3-2 · §7).
- **툴바 클릭 검증** — CDP `Extensions.triggerAction` 이 `activeTab` 을 실제로
  부여해, 운영 manifest 그대로 실제 Chromium 에서 확인했다. 사람의 클릭과
  실기기는 미검증이다.

### 보완 (M10-3, 2026-11-11)

- **구현했다.** 웹앱 `#collect?…` 수집 화면(`CollectApp`, 플레이어 없음)과 확장
  `collect/open` · 팝업 "39page 에 추가". 저장은 수집 화면에서 사용자가 누를 때만
  `addTrack` 으로 한다.
- **결정 4 (탭 간 덮어쓰기)** 는 ADR 0024 로 풀었다 — 쓰기 직전 비교 + `storage`
  이벤트.
- **`storage` 권한을 더하지 않았다** (결정 6 은 M10-3 에 더한다고 적었다). 중복
  방지 기록을 서비스 워커 메모리에 둔다 — 워커가 5초 창 안에 다시 시작되면 수집
  탭이 하나 더 열릴 수 있지만, 저장은 수집 화면의 명시적 클릭으로만 일어나므로
  데이터가 두 번 들어가지 않는다. 권한은 그대로 `activeTab` · `scripting`.
- **`page-changed`** — Background 가 탭을 다시 확인해 팝업이 보여 준 영상과 다르면
  거절한다. 수집 URL 의 ID 와 제목은 같은 확인에서 읽는다.
- **수집 origin** — 운영 빌드는 `https://39page.com` 고정. 개발 빌드만 허용 목록의
  localhost(5173 · 4173). 그 밖은 빌드가 멈추고, 실행 중 검사도 운영 번들에서는
  운영 origin 만 받는다.
- **제목 규칙을 좁혔다** — 수집 URL 의 `title` 에 제어 문자·양방향 재정의 문자가
  있거나 100자를 넘으면 요청 전체를 거절한다 (확장은 이미 그런 제목을 만들지
  않는다 — 위조 링크만 걸린다).

### 보완 (M11-1, 2026-11-12)

- **ADR 0028 (제안)** 이 주 경로를 "offscreen 문서 안의 39page 브리지 페이지" 로 바꾸자고 한다. 확장에 39page 호스트
  권한이 있으면 그 iframe 이 사용자의 39page 저장소 · 잠금 관리자를 그대로 쓴다는 것을 실제 Chrome 157 에서 확인했다
  (`docs/architecture/M11_BRIDGE_POC.md`). 승인되면 이 ADR 의 결정 1(수집 화면 URL)은 **대체 경로**가 되고, 결정 2–7 은
  그대로 유효하다. 승인 전까지 이 ADR 의 상태는 바뀌지 않는다.
