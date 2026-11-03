# 구현 계획

> 상태: 개정 (M2-1 완료, M2-2 이후 미착수).
>
> 기준 문서: [`design/references/README.md`](../../design/references/README.md)
> MVP 외 확장 항목: [`../product/BACKLOG.md`](../product/BACKLOG.md)

## 마일스톤 개요

| 마일스톤 | 범위                                                                       | 상태      |
| -------- | -------------------------------------------------------------------------- | --------- |
| M0       | 프로젝트 초기화                                                            | 완료      |
| M1 준비  | 디자인 레퍼런스 반영, 아키텍처 확정                                        | 완료      |
| **M1**   | 앱 셸, 두 테마, 테마 전환, 최소 Widget Registry/Host, 플레이어 영속성 구조 | M1-0 완료 |
| M2       | Record Library와 플레이리스트 관리                                         | 미착수    |
| M3       | YouTube 실제 재생과 연속 재생                                              | 미착수    |
| M4       | 날씨 위젯 및 마스코트 상태별 애니메이션                                    | 미착수    |
| M5       | UX, 반응형, 접근성, 통합 테스트 및 안정화                                  | 미착수    |

MVP는 M5까지다. 위젯 자유 이동·크기 변경, 위젯 추가·삭제·개별 스킨 선택,
테마·위젯 스토어, Chrome 확장, AI 음악 추천·작곡 지원은 **MVP 범위 밖**이며
[`../product/BACKLOG.md`](../product/BACKLOG.md)로 분리했다.
단, 장기 확장성을 고려한 M1의 Widget System 아키텍처는 유지한다.

## M0 — 프로젝트 초기화 (완료)

- [x] `create-vue` 스캐폴딩 (Vue 3 + TS + Vite + Pinia + Vitest + ESLint + Prettier)
- [x] 디렉터리 구조 생성
- [x] `AGENTS.md`, `CLAUDE.md` 작성
- [x] 문서 틀 생성
- [x] `npm install` / `build` / `type-check` / 테스트 / 린트 검증
- [x] Git 저장소 초기화

## M1 준비 — 디자인 레퍼런스 반영 (완료)

- [x] `design/references/` 프로토타입 2종 검토
- [x] `design/references/README.md` — 역할·우선순위·프로토타입 고유 요소 명시
- [x] `docs/product/MVP_SPEC.md` 갱신 — 확정 사항 반영, 미확정 `TODO` 정리
- [x] `docs/architecture/SYSTEM_DESIGN.md` 갱신 — Widget Registry/Host, 플레이어 영속성
- [x] `docs/architecture/THEME_SYSTEM.md` 갱신 — 토큰 추출, 전환 방식 확정
- [x] ADR 3건 기록
- [x] Git 초기 기준점 커밋 (기본 브랜치 `main`)
- [x] MVP 범위 정정 및 확장 백로그 분리

---

## M1 — 앱 셸 · 두 테마 · 테마 전환 · Widget Host · 플레이어 영속성 구조

**목표**: 테마를 전환해도 플레이어 인스턴스와 DOM 구조가 유지되는 **구조**를
세우고 검증한다.

**왜 이것이 먼저인가**: 플레이어 iframe은 부모가 바뀌기만 해도 재로드된다
(`SYSTEM_DESIGN.md` §4). 이 제약을 만족하는 DOM 골격을 먼저 확정하지 않으면
테마와 재생을 나중에 양쪽 다 다시 써야 한다.

**M1에 포함하지 않는 것**

| 제외 항목                                        | 이동한 마일스톤 |
| ------------------------------------------------ | --------------- |
| 실제 YouTube IFrame API 동작, 연속 재생, 큐 진행 | M3              |
| 플레이리스트 CRUD, Record Library 내용           | M2              |
| 시계 위젯, 날씨 위젯, 마스코트 상태별 애니메이션 | M4              |
| 반응형 정교화, 접근성 감사, 종합 통합 테스트     | M5              |
| 위젯 편집 UI (추가·삭제·이동·크기·스킨)          | 백로그          |

레이아웃은 모듈 상수다. 사용자가 편집할 수 없다.

### M1-0. 선행 정리 — 완료

| #   | 작업                                                                     | 산출물         | 상태 |
| --- | ------------------------------------------------------------------------ | -------------- | ---- |
| 0.1 | `src/themes/kawaii-cassette/` → `src/themes/kawaii-synth-cassette/` 개명 | 디렉터리       | 완료 |
| 0.2 | 테마 키를 `mono-vinyl`, `kawaii-synth-cassette`로 통일                   | 문서·경로 일치 | 완료 |

테마 키는 승인된 디자인 `two-themes-v09.html`의 값을 따른다.
프로토타입은 수정하지 않았다 (`AGENTS.md` 규칙 6).

### M1-1. 공유 타입과 저장 계층 — 완료

| #   | 작업                                                               | 산출물                        | 상태 |
| --- | ------------------------------------------------------------------ | ----------------------------- | ---- |
| 1.1 | `ThemeKey`, `TrackSource`, `Track`, `Playlist`, `PlayerState` 정의 | `src/shared/types/`           | 완료 |
| 1.2 | YouTube URL → videoId 파서 (+ 단위 테스트)                         | `src/shared/utils/youtube.ts` | 완료 |
| 1.3 | `defineStorage<T>` — 방어적 읽기, 안전한 쓰기, 버전 봉투           | `src/shared/storage/`         | 완료 |
| 1.4 | 손상 데이터·마이그레이션·저장소 예외 테스트                        | `tests/unit/`                 | 완료 |

- 파서는 `MVP_SPEC.md` F4의 호스트·경로 목록을 모두 처리하고, 실패를
  예외가 아닌 `{ ok: false, reason }`으로 돌려준다.
- 저장 계층 계약은 `SYSTEM_DESIGN.md` §7.1에 기록했다.
- `PlayerState`는 YouTube의 숫자 상태값을 도메인에 노출하지 않는다.
  숫자 → 유니온 변환은 M3의 어댑터 안에서만 일어난다.
- 구체 저장 인스턴스(`themeStorage`, `libraryStorage`)는 각 store와 함께
  만든다 (M1-3 / M2). M1-1은 `defineStorage`와 키 상수까지다.

### M1-2. 테마 토큰 체계 — 완료

| #   | 작업                                                  | 산출물                                        | 상태 |
| --- | ----------------------------------------------------- | --------------------------------------------- | ---- |
| 2.1 | 공통 토큰 (서체·반경·기하·모션·포커스 기본값)         | `src/styles/tokens.css`                       | 완료 |
| 2.2 | 리셋 + body 기본 + `prefers-reduced-motion` 전역 처리 | `src/styles/base.css`                         | 완료 |
| 2.3 | `mono-vinyl` 토큰 124개                               | `src/themes/mono-vinyl/tokens.css`            | 완료 |
| 2.4 | `kawaii-synth-cassette` 토큰 124개                    | `src/themes/kawaii-synth-cassette/tokens.css` | 완료 |
| 2.5 | 테마 레지스트리 (키 → 메타데이터)                     | `src/themes/index.ts`                         | 완료 |
| 2.6 | 스타일 정적 import, 기본 `data-theme`                 | `src/main.ts`, `index.html`                   | 완료 |

- 토큰 계약과 네이밍 규칙은 `THEME_SYSTEM.md` §4에 기록했다.
- 경계선 농도, 버튼/Pill, 날씨 4색 등 승인된 디자인의 미세한 차이를
  **합치지 않았다** (§4.4).
- 레퍼런스에서 적용되지 않는 kawaii 규칙 2건은 작성된 의도를 따랐다
  (§4.6, ADR 0004).
- 레퍼런스와의 일치는 `tests/unit/theme-tokens.spec.ts`가 정적으로 검증하고,
  실제 적용은 Chromium으로 확인했다.

### M1-3. 테마 store와 전환 — 완료

| #   | 작업                                                     | 산출물                                | 상태 |
| --- | -------------------------------------------------------- | ------------------------------------- | ---- |
| 3.1 | `theme` store — 키 보유, 전환, 영속화, 복원              | `src/stores/theme.ts`                 | 완료 |
| 3.2 | 루트 `data-theme` 속성 동기화 (`watch`, `flush: 'sync'`) | `src/stores/theme.ts`                 | 완료 |
| 3.3 | 테마 전환 UI (2버튼, `aria-pressed`, `role="group"`)     | `src/components/ui/ThemeSwitcher.vue` | 완료 |
| 3.4 | 알 수 없는 저장값 → 기본 테마 복구 테스트                | `tests/unit/theme-store.spec.ts`      | 완료 |
| 3.5 | 최소 제품 헤더 (M1-4에서 재사용)                         | `src/components/layout/AppHeader.vue` | 완료 |
| 3.6 | 첫 페인트 전 테마 적용 (FOUC 제거)                       | `index.html` 인라인 스크립트          | 완료 |

- `theme` store는 `playback`·`library`·플레이어를 **import하지 않는다.**
  정적 import 검사와 pinia 등록 store 검사로 강제한다.
- 저장은 M1-1의 `defineStorage`를 쓴다. 키는 `39page.theme`,
  형태는 `{ version: 1, data: <테마 키> }`다.
- **복원은 저장소에 쓰지 않는다.** 손상·미래 버전 데이터를 보존한다.
- 저장 실패(용량 초과, 접근 불가) 시에도 이번 세션의 전환은 적용된다.
- FOUC: 모듈 스크립트가 `first-paint` 이후에 실행되는 것을 측정으로 확인하고,
  `index.html`에 인라인 스크립트를 넣어 첫 페인트 전에 속성을 적용한다.
  **검증은 중복하지 않는다** — 알 수 없는 값은 CSS가 기본 테마로 되돌리고
  마운트 시 store가 검증된 값으로 덮어쓴다 (`THEME_SYSTEM.md` §3.3).

### M1-4. 안정 셸과 Widget Host — 완료

| #   | 작업                                                          | 산출물                                     | 상태 |
| --- | ------------------------------------------------------------- | ------------------------------------------ | ---- |
| 4.1 | `DashboardShell` — 셸 여백·헤더 통합·워크스페이스             | `src/components/layout/DashboardShell.vue` | 완료 |
| 4.2 | `WidgetHost` — 레이아웃 순회, `instanceId` 키, CSS 배치       | `src/components/layout/WidgetHost.vue`     | 완료 |
| 4.3 | Widget Registry (`WidgetDefinition` 등록·조회)                | `src/widgets/registry.ts`                  | 완료 |
| 4.4 | MVP 고정 레이아웃 상수                                        | `src/app/layout.ts`                        | 완료 |
| 4.5 | 단일 열 전환 브레이크포인트(1100px)                           | `WidgetHost.vue`                           | 완료 |
| 4.6 | 위젯 데이터 모델 (`WidgetType`, `GridArea`, `WidgetInstance`) | `src/shared/types/widget.ts`               | 완료 |
| 4.7 | 개발용 플레이스홀더 5종                                       | `src/widgets/placeholders/`                | 완료 |

- `GridArea`는 **이름 있는 영역**이다. 고정 좌표를 저장하지 않고, 별도 영속
  `GridSize` 모델을 만들지 않았다 (ADR 0005).
- 위젯 루트 DOM 노드가 그리드 컨테이너의 **직계 자식**이다. 래퍼가 없다.
- `:key`는 `instanceId`만 쓴다. 테마 전환 후 DOM 노드 동일성을 테스트와
  브라우저에서 모두 확인했다.
- `WidgetHost`·`DashboardShell`·레이아웃은 Theme Store를 참조하지 않는다.
- 위젯 5종은 모두 **플레이스홀더**다. 실제 컴포넌트는 M1-5(플레이어),
  M1-6(데크·마스코트), M4(시계·날씨)에서 들어온다. 교체는 레지스트리의
  `component` 한 줄이다.

### M1-5. 플레이어 영속성 구조 — 완료 ★ M1의 핵심

**M1-5는 구조 검증만 했다.** `FakePlayerAdapter`로 "테마 전환 시 플레이어
인스턴스와 DOM 구조가 유지되는가"를 증명했다. 실제 YouTube IFrame API 동작은
M3이다.

| #   | 작업                                                                              | 산출물                                       | 상태 |
| --- | --------------------------------------------------------------------------------- | -------------------------------------------- | ---- |
| 5.1 | `PlayerAdapter` 최소 인터페이스 (`mount`/`destroy`/`load`/`play`/`pause`/`state`) | `src/features/playback/PlayerAdapter.ts`     | 완료 |
| 5.2 | `FakePlayerAdapter` — 계약을 실제로 구현하고 호출을 기록                          | `src/features/playback/FakePlayerAdapter.ts` | 완료 |
| 5.3 | `PlayerSurface.vue` — 안정 래퍼 + 어댑터 소유 자식 노드                           | `src/features/playback/PlayerSurface.vue`    | 완료 |
| 5.4 | `playback` store — 상태 **형태**와 기본 불변조건                                  | `src/stores/playback.ts`                     | 완료 |
| 5.5 | 어댑터 팩토리 주입 지점 (`provide`/`inject`)                                      | `PlayerAdapter.ts`                           | 완료 |
| 5.6 | Widget Registry 의 player 를 `PlayerSurface` 로 교체                              | `src/widgets/registry.ts`                    | 완료 |
| 5.7 | 플레이어 영역 16:9 · 최소 200×200 공간 확보                                       | `PlayerSurface.vue`                          | 완료 |

**통합 테스트 (완료)**

| #    | 검증                                                         | 결과 |
| ---- | ------------------------------------------------------------ | ---- |
| 5.8  | 테마 전환 후 `playback` 상태 동일 (트랙·큐·인덱스·재생 상태) | 통과 |
| 5.9  | 테마 전환 후 플레이어 호스트 DOM 노드가 **동일 인스턴스**    | 통과 |
| 5.10 | 테마 전환 시 `PlayerAdapter.mount` **재호출 없음**           | 통과 |

- 어댑터 수명주기: 최초 마운트 `mount()` 1회, 테마 전환·재렌더·반응형 변경에서
  **0회**, 실제 언마운트에서 `destroy()` 1회. 테마 전환으로 `destroy()`가
  불리지 않는다.
- 어댑터는 `PlayerSurface`의 비반응형 지역 변수다. Pinia state·`ref`에 넣지
  않는다 (ADR 0006).
- `WidgetHost`·`DashboardShell`·`src/app/layout.ts`를 **수정하지 않았다.**
  주입을 쓴 덕분이다. 다섯 위젯의 `instanceId`와 `GridArea`도 그대로다.
- 돌연변이 검증으로 테스트가 회귀를 실제로 잡는지 확인했다: player `:key`에
  테마 포함 / 테마 전환 시 재생성 / Vue 가 어댑터 영역 안을 렌더 — 세 경우 모두
  관련 테스트가 실패하고 원복 후 통과했다.

**M3로 넘긴 항목**: `YouTubeIFramePlayerAdapter` 본구현, API 스크립트 싱글턴
로드, `wantsPlay` 지연, 가시성 가드의 실제 동작, 큐 진행과 `ENDED` 자동 전환,
오류·자동재생 차단 처리, 트랜스포트 UI, 플레이리스트와 큐 연동.

### M1-6. 데크 아트와 마스코트 — 완료

| #   | 작업                                               | 산출물                                         | 상태 |
| --- | -------------------------------------------------- | ---------------------------------------------- | ---- |
| 6.1 | 턴테이블 SVG 이식 (좌표·색 보존)                   | `src/themes/mono-vinyl/DeckArt.vue`            | 완료 |
| 6.2 | 카세트 SVG 이식 (좌표·색 보존)                     | `src/themes/kawaii-synth-cassette/DeckArt.vue` | 완료 |
| 6.3 | SVG `<defs>` id 접두사 (`mv-` / `ksc-`)            | 위 2개                                         | 완료 |
| 6.4 | 두 아트 동시 DOM 존재 + CSS `display` 전환         | `DeckWidget.vue`, 테마별 `deck.css`            | 완료 |
| 6.5 | 마스코트 패널 + 16×12 도트 스크린 (정적)           | `src/features/mascot/`                         | 완료 |
| 6.6 | 레지스트리의 deck · mascot 을 실제 컴포넌트로 교체 | `src/widgets/registry.ts`                      | 완료 |

- 이식 결과를 레퍼런스와 **문자 단위로** 비교하는 테스트를 두었다. 좌표 한
  자리나 색 한 글자만 달라져도 실패한다 (`THEME_SYSTEM.md` §8.1).
- 원본과의 의도적 차이는 세 가지뿐이다: id 접두사, 스크립트 전용 id 제거,
  동작하지 않는 컨트롤의 인터랙션 속성 제거.
- 마스코트는 **정적**이다. 패턴 데이터와 렌더러를 분리해 두었다
  (`THEME_SYSTEM.md` §6.1).
- `WidgetHost`·`DashboardShell`·`src/app/layout.ts`·`PlayerSurface`·
  `playback` store 를 **수정하지 않았다.**

**M2 / M4 로 넘긴 항목**: 데크 클릭 → Record Library 열기와 "LP 를 누르면 …"
안내 문구는 M2. LP 회전·테이프 릴 회전·톤암 하강·마스코트 애니메이션과
상태별 문구 전환은 M4.

### M1 완료 기준

- [x] 두 테마가 전환되고 토큰이 올바르게 적용된다
- [x] 선택한 테마가 재시작 후 복원된다
- [x] 통합 테스트 5.8 / 5.9 / 5.10 통과
- [x] 데크 아트 2종이 테마에 따라 전환된다
- [x] `npm run type-check` / `test` / `lint` / `build` 전부 통과
- [x] 승인된 디자인의 색·좌표를 변경하지 않았다 (규칙 6)

### M1-5 범위 조정 근거

M1의 핵심 질문은 "테마 전환 시 플레이어 인스턴스와 DOM 구조가 유지되는가"다.
이 질문은 **실제 재생 없이 답할 수 있다.** 필요한 것은 어댑터 인터페이스,
안정 래퍼, 그리고 `mount` 호출 횟수를 기록하는 가짜 구현체뿐이다.

실제 IFrame API를 M1에 넣으면 다음이 섞여 들어온다.

- jsdom에서 iframe·외부 스크립트를 다룰 수 없어 테스트가 불안정해진다
- API 준비 타이밍, 자동재생 차단, 임베드 오류 등 재생 **동작**의 문제가
  구조 검증과 뒤섞인다
- 가시성 가드는 실제 레이아웃 측정에 의존하므로 M5의 반응형 작업과 맞물린다

따라서 M1은 구조, M3는 동작으로 나눈다. 인터페이스를 M1에서 고정하므로
M3의 실제 구현은 `FakePlayerAdapter`를 교체하는 작업이 된다.

---

## M2 — Record Library와 플레이리스트 관리

### M2-1. Library Store와 영속화 — 완료

| #     | 작업                                            | 산출물                      | 상태 |
| ----- | ----------------------------------------------- | --------------------------- | ---- |
| 2.1.1 | `LibraryData` 타입                              | `src/shared/types/music.ts` | 완료 |
| 2.1.2 | `createId()` (randomUUID + 대체 경로)           | `src/shared/utils/id.ts`    | 완료 |
| 2.1.3 | `normalizeLibraryData()` 검증·정규화            | `src/stores/library.ts`     | 완료 |
| 2.1.4 | `library` store — 생성·이름 변경·삭제·선택·복원 | `src/stores/library.ts`     | 완료 |
| 2.1.5 | `39page.library` 영속화 + 보호 상태             | `src/stores/library.ts`     | 완료 |

- M1-1의 `defineStorage` 와 기존 `Track`·`Playlist` 를 재사용했다.
  중복 모델이나 저장 유틸리티를 만들지 않았다.
- **`playback` store 와 완전히 분리**된다. 서로 import 하지 않으며,
  라이브러리 조작이 큐·인덱스·현재 트랙을 바꾸지 않는다
  (`SYSTEM_DESIGN.md` §6.1).
- 원본을 읽지 못했거나 일부만 복구한 경우 쓰기를 막는다 (ADR 0007).
- **화면 변경 없음.** 앱이 아직 이 store 를 쓰지 않으므로 번들 크기도
  M1-6과 같다.

### M2-2. Record Library 드로어 (미착수)

| #     | 작업                                                      |
| ----- | --------------------------------------------------------- |
| 2.2.1 | 드로어 셸 (340px 그리드 형제 열, 오버레이 아님)           |
| 2.2.2 | 데크 클릭 → 드로어 열기, `ESC`·`×` 닫기, 포커스 이동      |
| 2.2.3 | 플레이리스트 목록·선택 UI (`library` store 연결)          |
| 2.2.4 | 생성·이름 변경·삭제 UI (`prompt()`·`confirm()` 대체)      |
| 2.2.5 | 첫 실행 시 기본 목록 생성, 마지막 목록 삭제 버튼 비활성화 |
| 2.2.6 | `status === 'protected'` 안내와 명시적 초기화             |
| 2.2.7 | `main.ts` 에서 마운트 전 `library.restore()` 호출         |
| 2.2.8 | 토스트 알림                                               |

**선행 결정**: `prompt()`·`confirm()` 대체 UI, 보호 상태 안내 문구.

### M2-3. 트랙 등록과 편집 (미착수)

| #     | 작업                                                             |
| ----- | ---------------------------------------------------------------- |
| 2.3.1 | `library` store 에 `addTrack` · `removeTrack` · `moveTrack` 추가 |
| 2.3.2 | 트랙 추가 모달 (YouTube URL + 이름 선택)                         |
| 2.3.3 | `parseYouTubeVideoId` 연결, 실패 시 인라인 오류                  |
| 2.3.4 | 트랙 순서 변경(위/아래)·삭제 UI                                  |

기준: `MVP_SPEC.md` F4, F5.

## M3 — YouTube 실제 재생과 연속 재생

| #   | 작업                                                            |
| --- | --------------------------------------------------------------- |
| 3.1 | `YouTubeIFramePlayerAdapter` — IFrame API 래핑                  |
| 3.2 | API 스크립트 싱글턴 로드, `onYouTubeIframeAPIReady` 단일 등록   |
| 3.3 | API 준비 전 재생 요청 지연 (`wantsPlay` 패턴)                   |
| 3.4 | 곡 전환 — `loadVideoById` / `cueVideoById` (어댑터 재생성 금지) |
| 3.5 | 큐 진행과 `ENDED` 자동 전환, 큐 끝 처리                         |
| 3.6 | 트랜스포트 UI (이전 / 재생·일시정지 / 다음)                     |
| 3.7 | 가시성 가드 (200×200, 50% 초과)                                 |
| 3.8 | `onError`·`onAutoplayBlocked` 처리, 외부 링크 대체              |
| 3.9 | 상태 메시지 (`role="status"`, `aria-live="polite"`)             |

기준: `MVP_SPEC.md` F3. M1-5의 `PlayerAdapter` 인터페이스를 구현하며,
**인터페이스를 바꾸지 않는다.** 바꿔야 한다면 M1의 통합 테스트를 함께 수정한다
(`AGENTS.md` 규칙 7).

**선행 결정**: 반복(loop) 동작 — 프로토타입은 `loop:true`를 저장하지만 읽지 않는다
(`MVP_SPEC.md` F3).

## M4 — 날씨 위젯 및 마스코트 상태별 애니메이션

| #   | 작업                                                                           |
| --- | ------------------------------------------------------------------------------ |
| 4.1 | 시계 위젯 — 도트 매트릭스 글리프, SVG 렌더러, `Asia/Seoul` 12시간제, 15초 갱신 |
| 4.2 | 날씨 위젯 — 제공자 연동, 실패 시 표시                                          |
| 4.3 | 데크 회전 애니메이션 (재생 중 `paused` → `running`, 33/45 RPM 연출)            |
| 4.4 | 마스코트 호흡 애니메이션 (재생 중)                                             |
| 4.5 | 테마별 마스코트 메시지 전환                                                    |
| 4.6 | `prefers-reduced-motion` 시 모든 애니메이션 비활성 검증                        |
| 4.7 | 설정 영속화 확장                                                               |

기준: `MVP_SPEC.md` F6, F7, F8.

> **시계 위젯 배치에 대한 참고**: 지시받은 M4 범위는 "날씨 위젯 및 마스코트
> 상태별 애니메이션"이었고 시계는 어느 마일스톤에도 명시되지 않았다.
> 위젯끼리 묶는 것이 자연스러워 M4에 넣었다. M1으로 옮기면 Widget Registry를
> 실제 위젯으로 검증할 수 있다는 장점이 있으므로, 원하면 옮긴다.

**선행 결정**: 날씨 API 제공자, 마스코트 도트 패턴을 테마별로 다르게 할지.

## M5 — UX, 반응형, 접근성, 통합 테스트 및 안정화

| #   | 작업                                                            |
| --- | --------------------------------------------------------------- |
| 5.1 | 반응형 정교화 — 브레이크포인트 730 / 650 / 600                  |
| 5.2 | 좁은 화면 드로어 동작 (스테이지 대체, 열기 전 일시정지)         |
| 5.3 | 접근성 감사 — 포커스 링, 터치 타깃, `aria-*`, 키보드 경로       |
| 5.4 | 종합 통합 테스트 (재생 → 테마 전환 → 라이브러리 편집 전체 흐름) |
| 5.5 | 오류·빈 상태 문구 정리                                          |
| 5.6 | 성능 점검 (번들 크기, 두 데크 SVG 동시 포함 비용)               |
| 5.7 | 저장 실패·용량 초과 처리                                        |

기준: `MVP_SPEC.md` §4 비기능 요구사항.

M1의 구조 테스트(5.6–5.8)는 M1에서 작성해 유지한다. M5의 통합 테스트는
기능이 완성된 뒤의 **종합 흐름**을 다룬다.

---

## 선행 결정 사항

해당 단계 전에 확정해야 한다. `docs/decisions/`에 기록한다.

| 항목                                     | 필요 시점 | 문서                   |
| ---------------------------------------- | --------- | ---------------------- |
| 토큰 이름 확정                           | M1-2      | `THEME_SYSTEM.md` §4.2 |
| `prompt()`·`confirm()` 대체 UI           | M2        | `MVP_SPEC.md` F4       |
| 반복(loop) 동작                          | M3        | `MVP_SPEC.md` F3       |
| 날씨 API 제공자                          | M4        | `MVP_SPEC.md` F7       |
| 마스코트 도트 패턴 테마별 차이           | M4        | `THEME_SYSTEM.md` §6   |
| 드래그 라이브러리 (DOM 재배치 금지 제약) | 백로그    | `BACKLOG.md` §1        |

## 작업 방식

- 한 작업 단위는 하나의 M*n*-N 범위를 넘지 않는다.
- 동작 변경 시 테스트를 함께 수정한다 (`AGENTS.md` 규칙 7).
- 작업마다 변경 파일과 검증 결과를 보고한다 (`AGENTS.md` 규칙 10).
- 승인된 디자인 레퍼런스는 수정하지 않는다 (`AGENTS.md` 규칙 6).
