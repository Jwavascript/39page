# Chrome 확장 설계 (M10)

> 상태: **M10-1 설계 확정 (2026-11-11). M10-2 골격 구현·실측 (2026-11-11)** —
> 실측으로 바꾼 곳은 "(M10-2 실측)" 으로 표시했다 (§2 · §3-2 · §6 · §8 · §11).
> 결정 기록: [ADR 0022](../decisions/0022-extension-repository-and-build.md) (저장소·빌드),
> [ADR 0023](../decisions/0023-extension-webapp-communication.md) (웹앱 통신·권한·보안)
> 작업 분해: [`../development/IMPLEMENTATION_PLAN.md`](../development/IMPLEMENTATION_PLAN.md) M10

## 0. 풀려는 문제

YouTube 에서 음악을 찾으면 지금은 링크를 복사해 39page 드로어에 붙여 넣어야
한다. M10 의 첫 목표는 **Quick Add** 다.

```
YouTube 영상 → 확장 아이콘 → 플레이리스트 선택 → 39page 에 추가
```

두 번째는 **Moment 캡처**(M10-4) — 지금 보는 영상의 시점과 메모를 Moment 로
남긴다. 데이터 모델은 M9 가 이미 재사용할 수 있게 만들어 두었다
(`MOMENTS_DESIGN.md` §6).

범위 밖: 서버 계정 · 클라우드 동기화 · 새 데이터베이스 · Chrome Web Store 게시
(M10-6 에서 따로) · 39page 자체를 확장 안에서 띄우는 것(`BACKLOG.md` §3 의
"새 탭 대체" 안 — 다른 문제다).

## 1. 저장소 구조

```
39page/
├── src/                  # 웹앱 (그대로)
├── tests/                # 웹앱 테스트 (그대로)
├── extension/            # Chrome 확장 — 독립 npm 프로젝트
│   ├── package.json      # 자체 의존성 · 자체 package-lock.json
│   ├── manifest.json     # 원본. 빌드가 검증 뒤 dist/ 로 내보낸다
│   ├── src/
│   │   ├── popup/        # Vue 3 팝업
│   │   ├── background/   # 서비스 워커 — 메시지 라우터 · 탭 조작
│   │   ├── content/      # YouTube 페이지에서 읽기만 하는 스크립트
│   │   └── shared/       # 메시지 계약 · 검증 · YouTube 페이지 판정
│   ├── tests/
│   └── dist/             # 빌드 산출물 (Git 제외) — "압축해제된 확장" 으로 로드
├── docs/
└── package.json          # 웹앱 (그대로)
```

- `extension/` 은 루트 `package.json` 과 **이어지지 않는다.** npm workspaces 를
  쓰지 않는다 — 루트의 설치·빌드·배포(Workers Builds)가 확장을 전혀 모른다
  (ADR 0022).
- **웹앱 코드 재사용은 한 파일**: `src/shared/utils/youtube.ts` 를 별칭
  `@web/` 으로 직접 가져온다. import 가 하나도 없는 순수 모듈이라 공용 패키지를
  만들 필요가 없다. 그 밖의 웹앱 코드(Vue 컴포넌트 · store · storage)는
  가져오지 않는다 — 테스트가 막는다.

## 2. 실행 영역과 책임 (Manifest V3)

| 영역               | 위치              | 맡는 것                                                                                                                                                              | 하지 않는 것                                               |
| ------------------ | ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| **Popup**          | `src/popup/`      | 현재 탭의 영상 정보 표시 · 사용자 조작                                                                                                                               | 탭·페이지 직접 접근 · 저장                                 |
| **Background**     | `src/background/` | 메시지 라우터 · 탭 조회 · content script 주입과 질의 · 플레이어 정보 읽기(메인 세계, M10-2 실측) · (M10-3) 수집 화면 열기 · (M10-4) 재생 시점 캡처(메인 세계)        | 사용자 데이터 보관 · 네트워크 요청 · 전역 변수에 상태 두기 |
| **Content script** | `src/content/`    | YouTube 페이지의 주소·제목 줄 읽기 (격리된 세계). 재생 시점은 읽지 않는다 — 플레이어 메서드가 격리된 세계에서 보이지 않아 Background 가 메인 세계에서 읽는다 (M10-4) | 페이지 수정 · 페이지 스크립트와 통신 · 확장에 먼저 말 걸기 |
| **Shared**         | `src/shared/`     | 메시지 계약과 검증 · YouTube 페이지 판정 · 제목 정리                                                                                                                 | `chrome.*` 호출                                            |

- **Content script 는 manifest 에 선언하지 않는다.** 사용자가 아이콘을 누른 뒤
  `scripting.executeScript` 로 그 탭에만 주입한다. 그래서 YouTube 상시 호스트
  권한이 필요 없다 (§7).
- **Popup ↔ Content 는 Background 를 거친다.** 같은 조회를 M10-5 의
  키보드 단축키(팝업 없음)에서도 써야 하므로 탭 조작을 한 곳에 모은다.
- **Background 는 상태를 메모리에 두지 않는다.** 서비스 워커는 30초 유휴 뒤
  종료되고 "전역 변수는 잃는다" (공식 수명 주기 문서). 리스너는 최상위에서
  동기로 등록하고, 필요한 상태(M10-3 의 중복 방지)는 `chrome.storage.session`
  에 둔다.

```
[사용자가 아이콘 클릭 — activeTab 부여]
Popup ── runtime.sendMessage {tab/inspect, tabId} ──▶ Background
                                                      │ tabs.get(tabId)        → url (activeTab 이 없으면 안 보인다)
                                                      │ executeScript {world: MAIN} → 플레이어 videoId·제목
                                                      │ tabs.sendMessage {page/read} ──▶ Content
                                                      │   (수신자 없음 → executeScript 로 주입 → 1회 재시도)
Popup ◀───────────── Result<PageInspection> ──────────┘
```

## 3. 지원 범위

| 페이지                                         | 인식 (M10-2)           | Quick Add (M10-3) | Moment 캡처 (M10-4)  |
| ---------------------------------------------- | ---------------------- | ----------------- | -------------------- |
| `youtube.com/watch?v=` (`www.` · `m.` 포함)    | ✔                      | ✔                 | ✔ (라이브 방송 제외) |
| `youtube.com/shorts/<id>`                      | ✔                      | ✔                 | ✖ 범위 밖 (버튼 끔)  |
| `youtube.com/live/<id>`                        | ✔                      | ✔                 | ✖ 범위 밖 (버튼 끔)  |
| `youtube.com/embed/<id>` (탭으로 직접 연 경우) | ✔                      | ✔                 | ✖ (버튼 끔)          |
| `music.youtube.com`                            | ✖ "아직 지원하지 않음" | ✖                 | ✖                    |
| `youtu.be/…` · `youtube-nocookie.com`          | ✖                      | ✖                 | ✖                    |
| 그 밖 (`chrome://`, 다른 사이트, 새 탭)        | ✖ 안내                 | ✖                 | ✖                    |

- **판정 규칙** = 웹앱 `parseYouTubeVideoId(url)` 가 성공 **그리고** 호스트가
  `youtube.com` · `www.youtube.com` · `m.youtube.com` 중 하나. 그래서 확장이
  받아들인 주소는 웹앱도 반드시 받아들이고, 두 쪽의 `videoId` 가 같다 —
  호환성 테스트가 고정한다.
- **YouTube Music 을 뺀 이유**: 제목과 DOM 이 일반 YouTube 와 다르고 이
  환경에서 실측하지 않았다. `activeTab` 방식이라 권한을 바꾸지 않고 나중에
  넣을 수 있다 (TODO).
- `youtu.be` 는 열면 `youtube.com/watch` 로 바뀌어 탭 주소로 남지 않는다.
  `youtube-nocookie.com` 은 다른 사이트의 임베드용이다.
- **Shorts 를 캡처에서 뺀 이유**: 짧게 반복 재생되는 화면이라 "시점" 의 뜻이
  약하고, 플레이어 DOM 이 다르다.
- **라이브를 캡처에서 뺀 이유 (M10-4)**: 시점이 계속 움직이고, 다시 볼 때(다시보기)
  같은 지점이 아닐 수 있다. `/live/` 주소는 버튼을 끄고, `watch?v=` 로 연 라이브는
  플레이어가 라이브라고 하면(`getVideoData().isLive` · 라이브 표시) 거절한다.

### 3-1. YouTube 의 SPA 이동

YouTube 는 문서를 바꾸지 않고 주소만 바꾼다(History API). 따라서

- content script 는 같은 문서에 **남는다** → 결과를 캐시하지 않고 매번 묻는다.
- 새로고침·교차 문서 이동이면 content script 가 **사라진다** → Background 가
  "수신자 없음" 을 받고 다시 주입한다.
- Popup 은 열려 있는 동안 자기 탭의 `tabs.onUpdated`(url · title · 로드 완료)를
  듣고 다시 조회한다. 다른 탭의 이벤트는 무시한다.
- 다른 사이트로 이동하면 `activeTab` 이 회수된다 (공식: "navigates to
  https://chromium.org, access is revoked"). 그때는 "아이콘을 다시 눌러
  주세요" 로 안내한다. 같은 사이트 안 이동은 권한이 유지된다.

### 3-2. 제목은 신뢰하지 않는 입력이다 — 출처는 M10-2 실측으로 정했다

웹페이지가 정한 문자열이다. M10-1 은 "제목 줄 → `document.title` → 탭 제목"
순서를 적었는데, **실제 YouTube 에서 이 순서가 틀린 제목을 보였다** — 19초
영상이 자동 재생으로 다음 영상에 넘어가는 순간 팝업이 새 영상 ID 에 이전 영상의
제목을 붙였다.

실측 (Chromium 155, 실제 YouTube, "다음 영상" SPA 이동 3회, 10ms 간격 표본):

| 이동 뒤 | 주소 | `document.title` | 플레이어 제목 링크      | `getVideoData()`      | flexy `video-id` · 제목 줄 |
| ------- | ---- | ---------------- | ----------------------- | --------------------- | -------------------------- |
| ~80ms   | 새   | 이전             | **ID 만 새, 글자 이전** | 이전 (ID·제목 함께)   | 이전                       |
| ~0.7s   | 새   | 이전             | 새                      | **새 (ID·제목 함께)** | 이전                       |
| ~1.1s   | 새   | 새               | 새                      | 새                    | 이전                       |
| ~3.1s   | 새   | 새               | 새                      | 새                    | **새 (같은 순간)**         |

- `document.title`(= 탭 제목)은 주소보다 **약 1초 늦다** → 출처에서 뺐다.
- 플레이어 제목 링크는 ID 와 글자가 따로 바뀐다 → 쓰지 않는다.
- **ID 와 제목을 한 객체로 주는 것은 플레이어의 `getVideoData()` 뿐**이었다.
  페이지 스크립트가 붙인 메서드라 격리된 세계(content script)에서는 보이지
  않으므로, Background 가 `scripting.executeScript({ world: 'MAIN', func })` 로
  읽는다. 같은 `activeTab` 부여로 되고 권한이 늘지 않는다. Shorts 는
  `#shorts-player` 가 같은 메서드를 준다 (실측).

그래서:

1. 플레이어(`#movie_player` · `#shorts-player`)의 `getVideoData()` 가 **주소의
   영상**일 때 그 제목
2. `ytd-watch-flexy[video-id]` 가 주소의 영상일 때 시청 페이지 제목 줄 — 실측에서
   둘은 같은 순간에 바뀌었다
3. 그 밖에는 **`null`** — 틀린 제목보다 빈 제목이 낫다

제목이 비면 Popup 이 1.5초 간격으로 **두 번까지** 다시 묻는다 (이동 직후 제목
줄이 바뀌는 순간에는 탭 이벤트가 오지 않는다).

정리: 앞의 알림 수 `(3) `, 뒤의 ` - YouTube` 를 떼고, 제어 문자를 지우고,
공백을 하나로 줄이고, **100자**(웹앱 `MAX_TRACK_TITLE_LENGTH`)로 자른다.
비면 `null` — 화면은 "제목을 읽지 못했습니다" 를 보이고 `videoId` 만 쓴다.
Popup 은 **텍스트로만** 그린다 (`v-html` 금지).

메인 세계의 함수는 페이지가 바꿔치기할 수 있다 — 반환값은 문자열·`null` 만
받고 Background 가 같은 검증을 다시 한다. 확장 API 는 메인 세계에 노출되지
않는다 (§7). 최종 확인은 웹앱 화면에서 사용자가 한다 (§5).

## 4. 메시지 전달 — 공식 API 의 방향

**같은 역할이라고 가정하지 않는다.** 공식 문서(developer.chrome.com, 2026-11-11
확인) 기준이다.

| 경로                    | API                                                                            | 방향                     | 근거 (공식 문구)                                                                                                |
| ----------------------- | ------------------------------------------------------------------------------ | ------------------------ | --------------------------------------------------------------------------------------------------------------- |
| Popup ↔ Background      | `runtime.sendMessage` → `runtime.onMessage`                                    | 확장 내부                | `onMessage` 는 확장의 모든 프레임에서 발생한다 (보낸 프레임 제외) — runtime 레퍼런스                            |
| 확장 → content script   | **`tabs.sendMessage(tabId)`**                                                  | 확장 → 탭                | "extensions cannot send messages to content scripts using this method" (`runtime.sendMessage` 항목)             |
| content script → 확장   | `runtime.sendMessage`                                                          | 탭 → 확장                | messaging 문서. "Content scripts are less trustworthy" — 입력을 검증하라                                        |
| content script ↔ 페이지 | `window.postMessage` · DOM                                                     | 같은 창, **격리된 세계** | DOM 은 공유하고 JS 변수는 공유하지 않는다. 받는 쪽은 `event.source !== window` 를 거른다 — content-scripts 문서 |
| 웹페이지 → 확장         | `externally_connectable` + `runtime.sendMessage(확장ID)` → `onMessageExternal` | **페이지가 시작**        | "This exposes the messaging API to any page that matches" — 확장 ID 가 필요하다                                 |
| 확장 → 웹페이지         | **없다**                                                                       | —                        | "It is not possible to send a message from an extension to a web page." — messaging 문서                        |

정리하면:

- `externally_connectable` 을 선언하지 않으면 "no web pages can connect" —
  웹페이지는 확장에 아무것도 보낼 수 없다. 다른 확장은 연결할 수 있지만
  우리가 `onMessageExternal` 을 등록하지 않으므로 받을 곳이 없다.
- 확장이 39page 탭에 **먼저** 데이터를 넘기는 길은 (1) 그 탭을 특정 주소로
  여는 것, (2) 39page 에 content script 를 넣고 `window.postMessage` 로
  중계하는 것, (3) 페이지가 `externally_connectable` 로 먼저 연결해 둔 포트로
  답하는 것뿐이다. §5 의 A·B 가 (1)·(2) 다.
- 비동기 응답은 `sendResponse` + 리스너에서 `true` 반환을 쓴다. 공식 문서는
  "From Chrome 148" 에 promise 반환을 허용한다고 적고, 지원하지 않는 브라우저를
  처리하라고 한다 — 그래서 promise 반환에 기대지 않는다.

## 5. 웹앱 통신 방식 — 비교와 결정 (ADR 0023)

| 기준      | **A. 수집 화면을 URL 로 연다**                                                          | B. 열린 39page 탭에 메시지                                                                  | C. 확장이 웹앱 저장소를 직접                                         |
| --------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| 저장 주체 | **웹앱 store** ✔                                                                        | 웹앱 store ✔                                                                                | ✖ 확장이 `localStorage` 를 쓴다 — store 의 검증·보호를 우회          |
| 보안      | 받는 것은 주소 조각 하나. 어떤 사이트도 같은 링크를 만들 수 있으므로 **웹앱 승인 필수** | 39page 에 content script(호스트 권한 경고) + `postMessage` 중계. 페이지 안 코드는 위조 가능 | 39page 호스트 권한 + 저장 형식 결합. 손상 보호·백업 규칙을 다시 구현 |
| 권한      | **추가 없음** (`tabs.create` 는 권한이 필요 없다)                                       | `https://39page.com/*` 호스트 권한                                                          | 같음                                                                 |
| 난이도    | **낮음** — 단방향, 확장 ID 결합 없음                                                    | 중간 — 요청/응답 짝 맞추기, 시간 초과, 탭이 여럿일 때 선택, 탭이 없을 때 대체 경로          | 높음                                                                 |
| 확장성    | `kind=moment` 로 M10-4 를 같은 길에 얹는다                                              | 팝업 안 플레이리스트 선택 · 탭 전환 없는 추가                                               | —                                                                    |
| UX        | 탭이 하나 열린다 (재생 중인 39page 탭은 건드리지 않는다)                                | **YouTube 를 떠나지 않는다.** 단, 39page 탭이 열려 있어야 한다                              | —                                                                    |

**결정: MVP 는 A.** B 는 M10-5 에서 A 위에 얹을 수 있는지 다시 본다. C 는
기각한다 — "웹앱 store 가 저장한다" 원칙에 어긋난다.

- 재생 중인 39page 탭을 그 주소로 **이동시키지 않는다.** 이동은 새로고침이라
  재생이 끊긴다 (`AGENTS.md` 규칙 5 의 정신). 항상 **새 탭**을 YouTube 탭
  바로 옆에 연다.
- 확장은 저장 결과를 돌려받지 않는다. 결과는 웹앱 화면이 사용자에게 직접
  보인다 — 저장의 주체가 웹앱이기 때문이다.

### 5-1. 수집 URL 계약 v1 — M10-3 · M10-4 구현

```
https://39page.com/#collect?v=1&kind=track&videoId=<11자>&title=<선택>&req=<요청 ID>
https://39page.com/#collect?v=1&kind=moment&videoId=<11자>&atSeconds=<정수>&title=<선택>&req=<요청 ID>
```

- **주소 조각(`#`)에 싣는다.** 조각은 서버로 가지 않는다 — 영상 정보가
  Cloudflare 요청 로그에 남지 않는다. 앱은 라우터를 쓰지 않으므로 경로가
  아니라 조각으로 구분한다.

| 필드        | 필수   | 규칙 (웹앱이 다시 검증)                                                                                                                                         | 실패 시                             |
| ----------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| `v`         | ✔      | 정확히 `1`                                                                                                                                                      | "버전이 맞지 않습니다" · 저장 0     |
| `kind`      | ✔      | `track` (M10-3) · `moment` (M10-4)                                                                                                                              | 알 수 없는 요청 · 저장 0            |
| `videoId`   | ✔      | `isYouTubeVideoId` — 웹앱의 기존 함수                                                                                                                           | 잘못된 요청 · 저장 0                |
| `title`     | –      | 앞뒤 공백을 떼고 **100자 이하**, C0·C1 제어 문자와 양방향 재정의 문자 **없음** (M10-3 에서 확정 — 넘거나 있으면 거절). 없거나 비면 `YouTube · <id>`             | 잘못된 요청 · 저장 0 / 기본 제목    |
| `req`       | ✔      | `^[A-Za-z0-9_-]{16,64}$`                                                                                                                                        | 잘못된 요청 · 저장 0                |
| `atSeconds` | moment | `^(0\|[1-9][0-9]{0,5})$` — 0 이상 정수 초, 6자리(999999) 이하. 부호 · 소수점 · 지수 · 공백 · 앞자리 0 거절. **0 은 받는다**(확인된 0초). `track` 에 있으면 거절 | `invalid-time` · `unexpected-field` |

- 같은 이름이 두 번 나오면 거부한다(모호함). 모르는 필드는 무시한다.
- 조각 전체가 2048자를 넘으면 거부한다.
- **메모(`note` · `memo`)는 주소에 싣지 않는다 (M10-4 확정).** 주소에 있으면 어느
  종류든 `unexpected-field` 로 거절한다 — 다른 사이트가 메모를 미리 채운 링크로 사용자를
  속이지 못하게. 메모는 수집 화면에서 쓴다.
- 확장은 읽지 못한 시점을 0 으로 싣지 않는다 — `buildMomentCollectUrl` 이 0 이상 정수가
  아니면 던진다.
- **두 쪽이 한 표를 읽는다 (M10-3)** — `tests/fixtures/collect-v1.json` 의 `build`
  는 확장이 만드는 주소와 웹앱이 읽는 필드를, `reject` 는 웹앱이 거절하는 경우를
  고정한다 (M10-4 에 `buildMoment` 4줄 · 거절 21줄을 더해 42줄). 웹앱 `collect-request.spec.ts` 와 확장 `collectUrl.spec.ts` 가 같은
  파일을 읽는다.
- 구현: 웹앱 `src/features/collect/collectRequest.ts` · 확장
  `src/shared/collectUrl.ts`.

### 5-2. 웹앱이 지킬 것 — M10-3 구현

1. **명시적 승인 없이 저장하지 않는다.** 수집 화면은 받은 값을 보여 주고,
   사용자가 플레이리스트를 고르고 "추가" 를 눌러야 `addTrack` 을 부른다.
   어떤 사이트도 같은 링크를 만들 수 있으므로 이 단계가 위조 방어다.
2. 제목은 텍스트로만 그린다. 기존 store API 로만 쓴다 (`localStorage` 직접 금지).
3. 성공하면 `history.replaceState` 로 조각을 지운다 → 새로고침이 다시 묻지
   않는다. 같은 화면에서의 연속 클릭은 단일 실행으로 막는다.
4. 수집 화면은 **플레이어를 띄우지 않는다** — 두 번째 iframe·자동 재생이
   생기지 않게.
5. **선행 조건 — 탭 간 덮어쓰기.** 실측(코드 확인, 2026-11-11): 라이브러리
   store 의 `persist()` 는 메모리 상태 전체를 쓴다. 다른 탭의 변경을 확인하지
   않는다. 그래서 대시보드 탭이 열린 채 수집 탭이 트랙을 추가하면, 대시보드
   탭의 **다음 변경(플레이리스트 선택 포함)이 그 트랙을 조용히 지운다.**
   지금도 39page 를 두 탭에 열면 같은 문제가 있다(M9-6 TODO "다른 탭의 변경
   반영"). Quick Add 는 이 경로를 일상적으로 만들므로 **M10-3 은 이것부터
   고친다** — **M10-3A 에서 고쳤다: 쓰기 직전 비교 + `storage` 이벤트
   (ADR 0024).**
6. **수집 화면은 별도 화면이다 (M10-3B).** `main.ts` 가 조각이 `#collect` 면
   대시보드 대신 `CollectApp` 만 마운트한다 — 플레이어·위젯·Moments 를 띄우지
   않는다. 수집 화면에서 목록을 골라도 라이브러리의 선택(저장값)은 바꾸지 않는다.
7. **같은 영상이 이미 있으면** "이미 있습니다 (N번째)" 로 알리고 버튼이
   "한 번 더 추가" 가 된다. 막지는 않는다 — 누를 때만 한 번 더 들어간다.
8. **저장 뒤 탭을 자동으로 닫지 않는다.** 완료를 알리고 "대시보드로 이동" 링크를
   둔다. 열려 있는 대시보드 탭은 `storage` 이벤트로 새 곡을 바로 보인다.
9. 저장이 실패하면(용량 등) 성공이라 하지 않고 메모리도 저장소 상태로 되돌린다
   — 다시 눌러도 두 곡이 들어가지 않는다.
10. **저장한 곡이 목록에서 없어지면 "추가했습니다" 를 내린다 (M10-3C).** 두 탭이 약
    5ms 안에 함께 저장하면 한쪽이 덮인다 (ADR 0024 실측). 수집 화면은 저장한 곡의
    id 를 지켜보다 없어지면 "방금 추가한 곡이 목록에서 없어졌습니다" 로 되돌려 다시
    추가하게 한다.
11. **수집 화면과 대시보드는 같은 쓰기 잠금을 지난다 (M10-3 안정화, ADR 0025).**
    Web Locks 배타 잠금 + 수정 번호 영수증으로 협력하는 탭 사이의 동시 저장은 한쪽이
    `conflict` 로 거절되고 알린다 — 조용히 덮이지 않는다. 저장이 끝나기 전에는 버튼이
    "저장 중…" 이고 성공을 보이지 않는다. 잠금을 5초 안에 얻지 못하면 `busy` 로 알리고
    다시 누르게 한다. 10번의 감지는 잠금 밖의 탭(이전 버전 · Web Locks 없음)을 위해 남긴다.

### 5-3. 확장이 지킬 것

- 사용자 데이터를 읽지도 쓰지도 않는다. 39page origin 에 접근 권한이 없다.
- 수집 URL 은 Background 한 곳에서만 만든다 — 탭을 **다시** 확인해 팝업이
  보여 준 영상과 같을 때만 그 영상의 ID 와 (같은 확인에서 읽은) 제목으로 만든다.
  다르면 `page-changed` 로 거절한다 (M10-3).
- 수집 origin 은 빌드 때 정한다 — 운영 `https://39page.com` 고정, 개발 빌드만
  허용 목록의 localhost (`src/shared/collectOrigin.ts`). 그 밖은 빌드가 멈추고
  실행 중에도 거절한다. 운영 번들에 localhost 가 있으면 manifest 검사가 실패한다.
- 아무 데이터도 외부 서버로 보내지 않는다. 확장 코드에 `fetch` 가 없다.

## 6. 내부 메시지 계약 v1

```ts
// 요청 — 모두 같은 봉투
type ExtensionRequest =
  | { v: 1; type: 'tab/inspect'; tabId: number } // Popup → Background (M10-2)
  | { v: 1; type: 'collect/open'; tabId: number; videoId: string } // Popup → Background (M10-3)
  | { v: 1; type: 'moment/capture'; tabId: number; videoId: string } // Popup → Background (M10-4)
type ContentRequest = { v: 1; type: 'page/read' } // Background → Content (M10-2)
// 재생 시점은 content 가 아니라 Background 가 메인 세계에서 읽는다 (§13). `player/position` 은 만들지 않았다.

// 응답 — 성공과 실패를 같은 모양으로
type Result<T> =
  { v: 1; ok: true; data: T } | { v: 1; ok: false; error: { code: ErrorCode; message: string } }
```

| `ErrorCode`           | 뜻                                                                            |
| --------------------- | ----------------------------------------------------------------------------- |
| `bad-request`         | 봉투는 맞지만 필드가 틀렸다 (`tabId` 가 정수가 아님 등)                       |
| `unsupported-type`    | 모르는 `type`                                                                 |
| `unsupported-version` | `v` 가 1 이 아니다                                                            |
| `forbidden-sender`    | 우리 확장의 페이지가 보낸 것이 아니다                                         |
| `no-tab`              | 탭이 닫혔거나 없다                                                            |
| `no-receiver`         | 주입 뒤에도 content script 가 답하지 않는다                                   |
| `timeout`             | 정해진 시간 안에 답이 없다                                                    |
| `internal`            | 예상하지 못한 예외 — 메시지에 내부 정보를 싣지 않는다                         |
| `page-changed`        | 팝업이 보여 준 영상과 지금 탭의 영상이 다르다 (M10-3) — 다른 곡을 담지 않는다 |

- **모든 수신 지점이 검증한다.** 객체인지, `v`, `type`, 필드 타입. 검증 함수는
  `src/shared/` 에 하나만 둔다.
- Background 는 `sender.id === chrome.runtime.id` 이고 `sender.url` 이 우리
  확장 페이지일 때만 `tab/inspect` 를 받는다. content script 가 보낸 메시지는
  받지 않는다 (content script 는 먼저 말하지 않는다).
- "지원하지 않는 페이지" 는 **오류가 아니라 정상 결과**다:

```ts
type PageInspection =
  | {
      status: 'video'
      videoId
      pageKind: 'watch' | 'shorts' | 'live' | 'embed'
      title: string | null
      titleSource: 'player' | 'heading' | null // M10-2 실측 (§3-2)
    }
  | {
      status: 'unsupported'
      reason: 'not-youtube' | 'not-video-page' | 'youtube-music' | 'no-access' | 'restricted'
    }
```

- 시간 초과: content 질의 3초, Popup → Background 10초 (주입 · 재시도 포함).

## 7. 권한과 보안 정책

| 권한          | 단계  | 왜                                                                  | 설치 경고   |
| ------------- | ----- | ------------------------------------------------------------------- | ----------- |
| `activeTab`   | M10-2 | 사용자가 누른 그 탭의 주소·제목, 주입 권한 (임시)                   | 없음 (공식) |
| `scripting`   | M10-2 | content script 를 그때 주입                                         | —           |
| ~~`storage`~~ | M10-3 | **더하지 않았다** — 중복 방지 기록은 서비스 워커 메모리에 둔다 (§9) | —           |

**요청하지 않는 것**: `host_permissions` (YouTube 상시 접근), `tabs`
("방문 기록 읽기" 경고), `<all_urls>`, 선언형 `content_scripts`,
`externally_connectable`, `web_accessible_resources`, `contextMenus`
(M10-5 에서 필요하면 검토).

정책:

- 기본 CSP 를 느슨하게 하지 않는다. 원격 코드·`eval`·외부 스크립트 없음.
- API 키·토큰·비밀번호를 번들에 넣지 않는다 (넣을 것도 없다).
- 페이지에서 온 값(주소·제목)은 신뢰하지 않는 입력으로 처리한다 (§3-2).
- 메인 세계 실행(`world: 'MAIN'`)은 **플레이어 정보 읽기 하나**뿐이다 (§3-2).
  함수는 자기 완결이고 문자열·`null` 만 돌려주며, 결과는 Background 가 다시
  검증한다. 페이지가 그 함수의 결과를 조작할 수 있다는 것을 전제로 한다.
- content script 는 페이지를 바꾸지 않고, 페이지의 `postMessage` 를 듣지
  않는다.
- 확장은 네트워크 요청을 하지 않는다.

## 8. 실패 처리

| 상황                                           | 결과                                                                                                                   | Popup 화면                                                        |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| YouTube 가 아닌 페이지                         | `unsupported / not-youtube`                                                                                            | "YouTube 영상 페이지에서 눌러 주세요"                             |
| YouTube 지만 영상이 아님 (홈 · 검색 · 채널)    | `unsupported / not-video-page`                                                                                         | 같은 안내 + "영상을 연 뒤"                                        |
| YouTube Music                                  | `unsupported / youtube-music`                                                                                          | "YouTube Music 은 아직 지원하지 않습니다"                         |
| `chrome://` 등 제한 페이지                     | `unsupported / no-access` — activeTab 이 부여되지 않아 주소가 안 보인다 (M10-2 실측). `restricted` 는 주소가 보일 때만 | "이 페이지를 읽을 수 없습니다"                                    |
| 주소를 볼 권한이 없음 (activeTab 회수 등)      | `unsupported / no-access`                                                                                              | "아이콘을 다시 눌러 주세요"                                       |
| content script 없음                            | 주입 → 1회 재시도                                                                                                      | (사용자에게 보이지 않음)                                          |
| 주입 실패 · 플레이어 읽기 실패 · SPA 이동 직후 | 제목 `null` — 이전 영상의 제목을 붙이지 않는다 (M10-2 실측)                                                            | ID 는 보이고 "제목을 읽지 못했습니다". 1.5초 간격 2번 다시 묻는다 |
| Background 무응답 · 예외                       | `timeout` · `internal`                                                                                                 | "확장 내부 오류 — 다시 시도"                                      |
| 탭이 닫힘                                      | `no-tab`                                                                                                               | "탭을 찾을 수 없습니다"                                           |

## 9. 중복 전송 · 연속 클릭

| 지점                                | 동작                                                                                                                                                                                                                                                                                                                                                            |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Popup 버튼 (M10-3)                  | 첫 클릭에 비활성화, 응답까지 단일 실행                                                                                                                                                                                                                                                                                                                          |
| Background `collect/open`           | 같은 영상의 요청이 진행 중이면 그 결과를 같이 쓰고(동시 클릭), 5초 안에 연 수집 탭이 살아 있으면 **그 탭을 앞으로** 가져온다. 기록은 **서비스 워커 메모리** (M10-3) — `storage` 권한을 더하지 않으려는 선택. 워커는 메시지 뒤 30초는 깨어 있어 5초 창은 대개 지켜지고, 그 사이 다시 시작되면 탭이 하나 더 열릴 수 있지만 저장은 수집 화면의 클릭으로만 일어난다 |
| 웹앱 수집 화면                      | 추가 버튼 단일 실행. 성공 뒤 조각 삭제. 같은 영상이 이미 그 플레이리스트에 있으면 알린다 — 같은 영상을 여러 번 넣는 것은 기존 허용 동작이므로 막지는 않는다 (M10-3 에서 확정)                                                                                                                                                                                   |
| Background `moment/capture` (M10-4) | 같은 탭 · 같은 영상의 캡처가 진행 중이면 결과를 같이 쓰고, 5초 안 같은 영상 · 같은 시점이면 열어 둔 탭을 앞으로. 팝업과 단축키가 **같은 기록**을 쓴다 (M10-5)                                                                                                                                                                                                   |
| 조회 (`tab/inspect`)                | 부작용이 없으므로 중복을 막지 않는다. Popup 은 이벤트를 150ms 로 묶어 한 번만 묻는다                                                                                                                                                                                                                                                                            |

### 9-1. 열린 수집 탭을 다시 쓰지 않는다 (M10-5 결정)

다른 요청을 이미 열린 수집 탭에 넣지 않는다 — **요청마다 새 탭**, 같은 요청이 5초 안에
다시 오면 그 탭을 앞으로 가져온다.

- 확장은 39page origin 에 권한이 없어 그 탭에 **쓰던 메모가 있는지 볼 수 없다**. 보려면
  호스트 권한이 필요하다 — 권한을 늘리지 않는다.
- 수집 화면은 주소 조각을 **처음 한 번만** 읽는다. 조각만 바꾸면 화면이 바뀌지 않고, 바꾸려면
  새로 고쳐야 한다 — 그러면 쓰던 메모가 사라진다. 데이터를 잃을 수 있으면 새 탭을 연다는
  지시대로 한다.
- 워커가 다시 시작되면 중복 기록(메모리)이 사라져 탭이 하나 더 열릴 수 있다. 저장은 수집
  화면의 클릭으로만 일어나고, 같은 곡 · 같은 시점은 그 화면이 알리므로 조용히 두 번 저장되지
  않는다. `storage.session` 으로 기록을 옮기려면 `storage` 권한이 필요하다 — 더하지 않는다.
- 수집 화면은 저장하지 않은 메모가 있으면 탭을 닫거나 새로 고치거나 다른 주소로 갈 때
  브라우저가 묻는다 (`beforeunload`). 저장했거나 비었으면 묻지 않는다.

## 10. 빌드 · 배포 격리 (ADR 0022)

- 확장 빌드는 `extension/` 안에서 `npm run build` — 산출물 `extension/dist/`.
- 루트의 `npm run build` · Workers Builds(`wrangler.toml` 의 `assets.directory =
"./dist"`)는 `extension/` 을 읽지 않는다. 루트 `.gitignore` 의 `dist` ·
  `node_modules` 규칙이 `extension/` 아래에도 걸린다.
- 루트 린트·포맷(`oxlint .` · `eslint .` · `prettier --check .`)은 저장소 전체를
  훑으므로 `extension/` 을 뺀다 — ESLint `globalIgnores` · `.prettierignore` ·
  oxlint 는 `--ignore-pattern` (설정 파일의 `ignorePatterns` 는 하위 폴더의 자체
  설정에 막혀 듣지 않았다, M10-2 실측). 확장은 자기 관문을 갖는다.
- 실측 (M10-2): 루트 `dist/` 의 파일별 SHA-256 이 M9(`8d8a7d5`) 빌드와 **같다**.
- 검증: M10-2 전후 루트 `dist/` 의 파일별 SHA-256 이 같아야 한다.

## 11. 테스트 전략

| 층            | 무엇을                                                                                                       |
| ------------- | ------------------------------------------------------------------------------------------------------------ |
| 단위 (Vitest) | 메시지 검증 · 페이지 판정 · 제목 정리 · Background 라우터(가짜 `chrome`) · content 응답 · Popup 상태 화면    |
| 호환성        | 같은 주소 표를 웹앱 `parseYouTubeVideoId` 와 확장 판정에 넣어, 확장이 받은 것은 웹앱도 같은 ID 로 받는다     |
| 정적 검사     | manifest 검증 스크립트 — 권한 허용 목록, 파일 존재, CSP, 금지 키                                             |
| 실제 Chromium | 압축해제 로드 → 팝업 · YouTube 인식 · 지원하지 않는 페이지 · 탭 이동 · 메시지 실패 · 워커 재시작 · 오류 로그 |

**툴바 클릭 (M10-2 실측으로 정정)** — M10-1 은 "헤드리스에서는 아이콘을 누를
수 없다" 고 적었다. Chromium 155 의 CDP `Extensions.triggerAction(id, 탭 대상)`
이 기본 동작(팝업)을 실행하고 **`activeTab` 을 실제로 부여했다** — 호스트
권한이 없는 운영 manifest 그대로 주소가 보였다. 그래서 테스트 전용 manifest 를
만들지 않았다.

하네스 관찰: 탭을 만들거나 이동한 **직후 약 2초 안**의 `triggerAction` 은
`activeTab` 을 부여하지 않았다 (같은 탭에서 2–3초 뒤에는 부여). 실제 클릭에도
있는 지연인지는 **확인하지 못했다** — 그때 팝업은 "읽을 수 없습니다 — 다시
눌러 주세요" 로 안전하게 실패한다. 실제 Chrome 의 사람 클릭은 미검증이다.

## 12. M10-3 에서 정한 것

M10-3 에서 모두 정했다 (Batch 2 지시).

- [x] 탭 간 덮어쓰기 — 쓰기 직전 비교 **와** `storage` 이벤트 둘 다 (ADR 0024)
- [x] 수집 화면 — 별도 화면, 플레이어 없음 (§5-2 의 6)
- [x] 같은 영상 — 알리고 "한 번 더 추가" 로만 (§5-2 의 7)
- [x] origin — 운영 고정, 개발 빌드만 허용 목록의 localhost (§5-3)
- [x] 저장 뒤 — 자동으로 닫지 않고 대시보드 링크 (§5-2 의 8)

## 13. Music Moment 캡처 — M10-4 구현

YouTube 영상 → 확장 아이콘 → **현재 Moment 저장** → 39page 수집 화면(새 탭)에서
메모(선택, 500자)를 쓰고 **Moment 저장**.

**누른 순간을 고정한다.** `moment/capture` 를 받은 Background 가

1. 탭 주소를 다시 확인한다 — 팝업이 본 영상과 다르면 `page-changed`. Shorts · `/live/` ·
   임베드는 `refused`.
2. 메인 세계에서 `capturePlaybackInPage` 를 **한 번** 실행한다. `#movie_player` 의
   `getVideoData()` · `getCurrentTime()` · `getPlayerState()` · `getDuration()` · 광고 클래스
   · 라이브 표시를 같은 동기 실행 안에서 읽는다 — 영상 ID 와 시점이 같은 순간 같은
   객체에서 온다. 유한하지 않은 수는 `null`.
3. `decideCapture` (순수 함수)가 판정한다.

| 플레이어                                                  | 결과                         |
| --------------------------------------------------------- | ---------------------------- |
| 다른 영상(자동 다음 영상 · SPA 이동 중)                   | `page-changed` — 담지 않는다 |
| 광고(`ad-showing` · `ad-interrupting`)                    | `refused: ad`                |
| 라이브                                                    | `refused: live`              |
| 시작 전(-1) · 대기(5) · 불러오는 중(3 이고 1초 미만)      | `refused: not-started`       |
| 시점·상태를 못 읽음 · 음수 · 길이보다 한참 뒤 · 상한 초과 | `refused: unreadable`        |
| 재생(1) · 일시정지(2) · 버퍼링(3, 1초 이상) · 끝(0)       | `atSeconds = floor(시점)`    |

**지어낸 0초를 만들지 않는다.** 재생·일시정지 중의 0초는 확인된 0 이고, 시작 전·불러오는
중의 0 은 "모름" 이라 거절한다.

4. 수집 주소(`kind=moment`, 메모 없음)를 YouTube 탭 옆에 연다. 같은 탭 · 같은 영상의 캡처가
   진행 중이면 그 결과를 같이 쓰고, 5초 안 같은 영상 · 같은 시점이면 열어 둔 탭을 앞으로
   가져온다 (§9 와 같은 워커 메모리).

**팝업** — "플레이리스트에 추가"(주된 동작) · "현재 Moment 저장"(보조 동작) 두 버튼.
쓸 수 없는 페이지(Shorts · 라이브 주소 · 임베드)에서는 Moment 버튼을 끄고 이유를 적는다
(`aria-describedby`). 결과: "1:23 을 고정했습니다…" · 거절 이유 · page-changed 면 팝업을
다시 확인한다.

**웹앱 수집 화면** — `CollectView` 가 `kind` 로 가른다. Moment 화면은 제목 · "1:23 지점" ·
그 지점 링크(`&t=83s`) · 메모 입력란(500자, 넘기면 저장하지 않음 — 자르지 않는다) ·
같은 시점 Moment 안내(막지 않음) · "Moment 저장". 저장은 Moments store 의 `add` —
대시보드와 같은 검증 · 같은 탭 간 잠금(ADR 0025). 저장 중에는 "저장 중…", 거절이면
메모를 지킨다. 화면을 연 것만으로 저장하지 않는다. `main.ts` 는 대시보드와 수집 화면
모두 갈림길 전에 Moments 를 복원하고 다른 탭의 저장을 듣는다.

**권한은 그대로다** — `activeTab` · `scripting`. 메인 세계 실행은 사용자가 아이콘을 누른
탭에만 한다.

## 14. 단축키 · 사용성 — M10-5 구현

**단축키** (manifest `commands`, 공식 규칙: Ctrl 또는 Alt 포함 · Ctrl+Alt 금지 · 제안 최대 4개 —
`check-manifest.mjs` 가 확인한다)

| 명령             | 제안 키       | 하는 일                                         |
| ---------------- | ------------- | ----------------------------------------------- |
| `quick-add`      | `Alt+Shift+Y` | 지금 영상을 담는 수집 화면을 연다 (YouTube)     |
| `capture-moment` | `Alt+Shift+M` | 지금 재생 시점을 고정해 Moment 수집 화면을 연다 |

- Chrome 기본 단축키 중 Alt+Shift 조합은 T · I · A · N 뿐이다 (공식 도움말). **그런데 실측에서
  `Alt+Shift+P` 는 지정되지 않았다** (Chromium 155 헤드리스, `commands.getAll()` 이 빈 값) — 도움말에
  없는 예약 조합이다. 후보 Y · K · L · U 를 따로 띄워 모두 지정되는 것을 확인하고 `Alt+Shift+Y` 로
  바꿨다. OS 단축키와의 충돌은 확인하지 못했다 — 겹치면 OS · Chrome 이 이기고 지정되지 않으며,
  팝업이 "단축키 지정되지 않음" 으로 보인다.
- **단축키 실행은 그 탭에 `activeTab` 을 준다** (공식 activeTab 문서). 권한이 늘지 않는다.
- 팝업과 **같은 경로** — `inspectTab` 으로 확인한 영상으로 `openCollect` · `captureMoment`.
  같은 중복 기록을 쓴다.
- 알림: 성공하면 수집 화면이 열린다. 담지 못하면 그 탭 아이콘에 `!` 배지와 이유(툴팁)를 단다 —
  6초 뒤 지운다. `chrome.action` 은 권한이 필요 없다. 알림(`notifications`) 권한을 더하지 않는다.
- 팝업은 manifest 의 제안값이 아니라 **지금 지정된 단축키**(`commands.getAll()`)를 각 동작
  아래에 보이고, "단축키 바꾸기" 로 `chrome://extensions/shortcuts` 를 연다.

**YouTube 범위 다시 보기**

| 페이지                          | Quick Add | Moment | 비고                                                        |
| ------------------------------- | --------- | ------ | ----------------------------------------------------------- |
| 일반 시청 (`watch?v=`)          | ✔         | ✔      |                                                             |
| 재생목록 안 (`watch?v=&list=`)  | ✔         | ✔      | 그 영상으로 담는다 (목록은 담지 않는다)                     |
| SPA 이동 뒤                     | ✔         | ✔      | 팝업이 본 영상과 다르면 `page-changed` (M10-3 · M10-4 실측) |
| Shorts                          | ✔         | ✖      | Moment 버튼 꺼짐 · 단축키는 아이콘으로 이유                 |
| 라이브 (`/live/` · 라이브 방송) | ✔         | ✖      |                                                             |
| YouTube Music                   | ✖         | ✖      | 그대로 — DOM 이 다르고 실측하지 않았다 (TODO)               |

**키보드 · 접근성** — 팝업의 초점은 버튼 셋(플레이리스트에 추가 · 현재 Moment 저장 · 단축키
바꾸기)뿐이고 화면 순서와 같다. 꺼진 버튼은 이유를 `aria-describedby` 로 잇는다. 결과는
`status` · 실패는 `alert`. 초점 링은 `:focus-visible` (웹앱과 같은 토큰).
