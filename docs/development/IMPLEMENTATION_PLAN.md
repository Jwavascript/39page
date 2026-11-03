# 구현 계획

> 상태: 개정 (M4 완료 — M5 진행 중).
>
> 기준 문서: [`design/references/README.md`](../../design/references/README.md)
> MVP 외 확장 항목: [`../product/BACKLOG.md`](../product/BACKLOG.md)

## 마일스톤 개요

| 마일스톤 | 범위                                                                       | 상태   |
| -------- | -------------------------------------------------------------------------- | ------ |
| M0       | 프로젝트 초기화                                                            | 완료   |
| M1 준비  | 디자인 레퍼런스 반영, 아키텍처 확정                                        | 완료   |
| **M1**   | 앱 셸, 두 테마, 테마 전환, 최소 Widget Registry/Host, 플레이어 영속성 구조 | 완료   |
| M2       | Record Library와 플레이리스트 관리                                         | 완료   |
| M3       | YouTube 실제 재생과 연속 재생                                              | 완료   |
| M4       | 날씨 위젯 및 마스코트 상태별 애니메이션                                    | 미착수 |
| M5       | UX, 반응형, 접근성, 통합 테스트 및 안정화                                  | 미착수 |

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

### M2-2. Record Library 드로어 — 완료

| #     | 작업                                                  | 산출물                                     | 상태 |
| ----- | ----------------------------------------------------- | ------------------------------------------ | ---- |
| 2.2.1 | 드로어 셸 (340px 그리드 형제 열, 오버레이 아님)       | `features/library/RecordLibraryDrawer.vue` | 완료 |
| 2.2.2 | 데크 클릭 → 열기, `ESC`·`×` 닫기, 포커스 이동·복귀    | `DeckWidget.vue`, `DashboardShell.vue`     | 완료 |
| 2.2.3 | 플레이리스트 목록·선택 UI                             | `features/library/PlaylistList.vue`        | 완료 |
| 2.2.4 | 생성·이름 변경·삭제 UI (인라인 폼·확인)               | `RecordLibraryDrawer.vue`                  | 완료 |
| 2.2.5 | 최초 실행 기본 목록, 마지막 목록 삭제 비활성화        | `library.ts`, `main.ts`                    | 완료 |
| 2.2.6 | `protected` / `unavailable` / `persisted: false` 안내 | `features/library/LibraryStatusBanner.vue` | 완료 |
| 2.2.7 | 마운트 전 `library.restore()`                         | `src/main.ts`                              | 완료 |
| 2.2.8 | 트랙 목록 읽기 전용 표시                              | `RecordLibraryDrawer.vue`                  | 완료 |

- 드로어 열림 상태는 `DashboardShell` 의 지역 `ref` 다. 전역 store 를 만들지
  않았다. 트리거까지는 주입으로 전달한다 (ADR 0006 과 같은 방식).
- **`WidgetHost` 를 수정하지 않았다.** 드로어는 그 형제이고 `v-if` 가 아니라
  `hidden` 으로 숨긴다.
- 최초 실행 기본 목록은 `seedFirstRunPlaylist()` 로 분리했다.
  `restore()` 가 저장소를 건드리지 않는다는 보장을 지킨다.
- 동작하지 않는 버튼을 만들지 않았다: `YouTube 링크 추가`(M2-3),
  `목록 전체 재생`·행 `▶`(M3), 보호 데이터 `복구`·`초기화`.

**M2-3 / M3 로 넘긴 항목**: YouTube 링크 추가, 트랙 삭제·순서 변경,
플레이리스트 재생 버튼과 큐 연결.

### M2-3. 트랙 등록과 편집 — 완료

| #     | 작업                                            | 산출물                    | 상태 |
| ----- | ----------------------------------------------- | ------------------------- | ---- |
| 2.3.1 | `addTrack` · `removeTrack` · `moveTrack`        | `src/stores/library.ts`   | 완료 |
| 2.3.2 | 트랙 추가 폼 (YouTube URL + 이름 선택)          | `RecordLibraryDrawer.vue` | 완료 |
| 2.3.3 | `parseYouTubeVideoId` 연결, 실패 시 인라인 오류 | `RecordLibraryDrawer.vue` | 완료 |
| 2.3.4 | 트랙 순서 변경(↑/↓)·삭제 UI                     | `RecordLibraryDrawer.vue` | 완료 |

- 액션 계약과 트랙 id / videoId 구분은 `SYSTEM_DESIGN.md` §7.2 에 기록했다.
- `videoId` 검증을 복원의 `normalizeTrack` 과 **같은 기준**으로 맞췄다.
  추가한 트랙이 다음 복원에서 버려지지 않는다.
- 영상 중복 등록을 막지 않는다. `track.id` 만 서로 다르면 된다.
- 링크 폼은 **열릴 때 정한 대상**에만 등록한다. 선택이 다른 경로로 바뀌어도
  엉뚱한 목록에 들어가지 않는다.
- 보호 정책(ADR 0007)과 `reportResult()` 를 그대로 재사용했다.
  `protected` / `unavailable` 에서는 메모리만 바뀌고 저장되지 않는다.
- Playback store 를 import 하지 않는다. 트랙을 추가·삭제·정렬해도
  재생 큐·인덱스·현재 트랙이 바뀌지 않는다.

**M3 로 넘긴 항목**: 개별 트랙 재생, 목록 전체 재생, 재생 큐 연결,
실제 YouTube 재생과 연속 재생.

## M3 — YouTube 실제 재생과 연속 재생

기준: `MVP_SPEC.md` F3, `SYSTEM_DESIGN.md` §4.5~§4.6, §8.1.

**재사용한다. 새로 만들지 않는다.**

| 기존 자산                                | M3 에서의 역할                                                                       |
| ---------------------------------------- | ------------------------------------------------------------------------------------ |
| `PlayerAdapter` (M1-5)                   | 인터페이스를 가급적 **바꾸지 않는다.** `FakePlayerAdapter` 옆에 실제 구현체를 더한다 |
| `PLAYER_ADAPTER_FACTORY` 주입 (ADR 0006) | `main.ts` 한 줄로 실제 어댑터를 넣는다                                               |
| `PlayerSurface` (M1-5)                   | DOM 소유 구조를 그대로 둔다. 어댑터만 바뀐다                                         |
| `playback` store (M1-5)                  | 큐·인덱스·상태·메시지가 이미 있다. 진행 액션만 더한다                                |
| `library` store (M2)                     | **읽기만 한다.** 재생이 라이브러리를 바꾸지 않는다                                   |
| `RecordLibraryDrawer` (M2)               | 재생 버튼을 더한다. 드로어가 큐를 직접 만들지 않는다                                 |

**연결 지점**: 두 store 는 서로를 import 하지 않는다. 라이브러리 → 큐 복사는
**상위 UI·애플리케이션 계층**이 한다 (`SYSTEM_DESIGN.md` §6.1). 구체 위치는
M3-0 의 선행 결정이다.

---

### M3-0. 선행 결정과 정책 확인 — 완료 (2026-11-03)

**작업 범위** — 코드를 쓰기 전에 미확정 사항을 닫는다. 잘못 정하면 M3-1 이후를
다시 써야 하는 것들이다.

| #   | 결정할 것                              | 결정                                                                                | 기록                    |
| --- | -------------------------------------- | ----------------------------------------------------------------------------------- | ----------------------- |
| 0.1 | 반복(loop) 정책                        | **MVP 제외.** 큐 끝에서 정지하고 안내한다. 플래그를 저장하지도 읽지도 않는다        | `MVP_SPEC.md` F3        |
| 0.2 | 라이브러리 → 큐 연결 계층의 위치       | `src/features/playback/` 의 composable. **애플리케이션 계층(`src/app`)이 주입**한다 | `SYSTEM_DESIGN.md` §6.1 |
| 0.3 | 셔플 지원 여부                         | **MVP 제외.** 큐는 플레이리스트 순서를 따른다                                       | `BACKLOG.md` §5         |
| 0.4 | 볼륨 UI 제공 여부                      | **제공하지 않는다.** YouTube 기본 컨트롤에 위임한다                                 | `BACKLOG.md` §5         |
| 0.5 | `origin` 파라미터 사용 여부            | **사용한다.** 값은 `window.location.origin` — 런타임에 읽는다                       | `SYSTEM_DESIGN.md` §8.2 |
| 0.6 | 가시성 임계값과 근거                   | 200×200 은 공식 요구로 **고정**, 50% 는 자체 휴리스틱으로 **조정 가능**             | `SYSTEM_DESIGN.md` §4.5 |
| 0.7 | 재생 불가 영상에서 다음 곡으로 넘길지  | **넘기지 않는다.** 정지·안내하고 외부 링크를 띄운다. 다음 곡은 사용자가 고른다      | `MVP_SPEC.md` F3        |
| 0.8 | `index.html` 에 referrer 메타를 넣을지 | **넣는다.** `strict-origin-when-cross-origin` — 선언은 M3-1 커밋에서 적용한다       | `SYSTEM_DESIGN.md` §8.2 |
| 0.9 | `PlayerAdapter` 이벤트 전달 수단       | **`mount()` 의 두 번째 인자로 핸들러 묶음을 받는다.** 구독/해지 API 를 두지 않는다  | **ADR 0008**            |

0.9 는 원래 M3-1 의 선행 결정이었다. 계약을 고치는 일이라 M3-0 에서 함께
닫았다. ADR 0008 이 `load(videoId, { autoplay })` 와 `YT.Player` 생성 시점
(첫 `load()`)까지 같이 정한다.

**산출물**: `MVP_SPEC.md` F3 (TODO 해소), `BACKLOG.md` §5,
`SYSTEM_DESIGN.md` §4.5 · §6.1 · §8.2, ADR 0008, 이 표.

**완료 기준**: 9개 항목에 결정과 근거가 적혀 있다. ✔

**테스트**: 없음 (문서 단계).

**남은 TODO**: 오프라인 / API 로드 실패 시 안내 문구와 복구 동작 (M3-5),
`ResizeObserver` / `IntersectionObserver` 사용 여부 (M3-4).
둘 다 M3-1 을 막지 않는다.

---

### M3-1. YouTubeIFramePlayerAdapter — 완료 (2026-11-03)

**작업 범위** — `PlayerAdapter` 를 실제 IFrame API 로 구현한다. 비동기 준비와
상태 매핑을 **이 파일 안에서만** 처리한다.

| #   | 작업                                                                                                                       |
| --- | -------------------------------------------------------------------------------------------------------------------------- |
| 1.1 | API 스크립트 싱글턴 로드 (`https://www.youtube.com/iframe_api`)                                                            |
| 1.2 | `window.onYouTubeIframeAPIReady` **단일 등록.** 어댑터가 여러 번 생겨도 한 번만                                            |
| 1.3 | 준비 전 요청 보류 — `load` / `play` 를 담아뒀다가 `onReady` 후 실행 (`wantsPlay` 패턴)                                     |
| 1.4 | `YT.Player` 생성 (첫 `load()` 에서 — ADR 0008). `playerVars: { controls: 1, playsinline: 1, rel: 0, autoplay: 0, origin }` |
| 1.5 | 숫자 상태 → `PlayerState` 매핑 (−1 idle · 0 ended · 1 playing · 2 paused · 3 loading · 5 idle)                             |
| 1.6 | 곡 전환은 `loadVideoById`(즉시) / `cueVideoById`(대기). **어댑터를 재생성하지 않는다**                                     |
| 1.7 | 이벤트 전달 — `onReady` · `onStateChange` · `onError` · `onAutoplayBlocked`                                                |
| 1.8 | `destroy()` 에서 `player.destroy()` 와 리스너 해제                                                                         |
| 1.9 | `main.ts` 에서 `app.provide(PLAYER_ADAPTER_FACTORY, …)`                                                                    |

> **인터페이스 변경**: M3-0.9 에서 확정했다 (ADR 0008). `mount()` 가 두 번째
> 인자로 핸들러 묶음을 받고, `load()` 가 `{ autoplay }` 를 받는다.
> **계약이 바뀌므로 M1-5 의 수명주기 테스트를 함께 고친다**
> (`AGENTS.md` 규칙 7). 어댑터가 store 를 직접 바꾸지 않고 `PlayerSurface` 가
> 콜백을 받아 store 에 반영하는 단방향을 지킨다 (ADR 0006).
>
> M3-1 에서 store 에 반영하는 것은 `stateChange` 뿐이다. `ready` · `error` ·
> `autoplayBlocked` 의 **화면 처리는 M3-3 · M3-5** 다. 어댑터가 넷 모두를
> 전달하는 것은 M3-1 의 테스트로 검증한다.

**산출물**: `src/features/playback/YouTubeIFramePlayerAdapter.ts`,
`src/features/playback/PlayerAdapter.ts` (계약 개정),
`src/features/playback/FakePlayerAdapter.ts` (같은 계약 유지),
`src/features/playback/PlayerSurface.vue` (구독), `src/main.ts` (주입),
`index.html` (M3-0.8 의 referrer 메타).

**완료 기준** — 전부 충족 ✔

- 스크립트가 한 번만 로드된다. 어댑터를 여러 번 만들어도 마찬가지다. ✔
- 준비 전에 부른 `load`/`play` 가 준비 후 **한 번** 실행된다. ✔
- `state()` 가 숫자를 노출하지 않는다. ✔
- 테마 전환·드로어·반응형에서 `mount()` 가 여전히 1회다. ✔

**테스트** — `tests/unit/youtube-adapter.spec.ts` (44) ·
`tests/unit/player-surface.spec.ts` (27)

- `window.YT` 를 가짜로 세워 스크립트 로드·콜백 등록을 검증한다.
  **실제 네트워크에 접속하지 않는다.** 가짜 `YT.Player` 는 실제 API 처럼
  넘겨받은 요소를 iframe 으로 교체한다
- 중복 `mount()` / `destroy()` 계약 유지
- 준비 전 요청 보류 후 1회 실행 · `pause()` 가 보류한 재생을 취소
- 숫자 → `PlayerState` 매핑 전수, 문서에 없는 코드는 무시
- 오류 코드 → 도메인 종류 전수 (2 · 5 · 100 · 101 · 150 · 153 · 그 외)
- 언마운트 후 도착한 비동기 콜백이 사건을 올리지 않음
- M1-5 의 수명주기·DOM 동일성 테스트 전부 통과

**결정과 달라진 구현 세부**

- 로더를 `youtubeIframeApi.ts` 로 분리했다. 상태가 **모듈 싱글턴**이라 수명이
  어댑터 인스턴스보다 길다. YouTube 특이사항은 여전히 이 두 파일 밖으로
  나가지 않는다 (`SYSTEM_DESIGN.md` §4.6).
- 어댑터 소유 영역을 **두 겹**으로 만들었다. `YT.Player` 가 넘겨받은 요소를
  iframe 으로 **교체**하기 때문이다. 안정 노드를 직접 넘기면 그 노드를 잃는다.

---

### M3-2. 재생 큐 진행과 라이브러리 연결 — 완료 (2026-11-03)

**작업 범위** — 라이브러리에서 큐를 만들고 큐를 따라 진행한다.
**두 store 를 직접 잇지 않는다.**

| #   | 작업                                                                                   |
| --- | -------------------------------------------------------------------------------------- |
| 2.1 | 상위 계층(M3-0.2): `library` 에서 트랙을 읽어 `playback.setQueue()` 로 **스냅샷** 복사 |
| 2.2 | `playback` 에 진행 액션 추가 (`advance` / `back`). 큐 경계를 다룬다                    |
| 2.3 | `ENDED` → 다음 곡 자동 전환                                                            |
| 2.4 | 큐 끝 처리 — 반복 정책(M3-0.1)에 따라 정지하거나 처음으로                              |
| 2.5 | 드로어 재생 버튼: 목록 전체 재생(`.playlist-play`), 트랙 개별 재생(`.track-play`)      |

**산출물**: `src/features/playback/playbackCoordinator.ts` (계약) ·
`createPlaybackCoordinator.ts` (구현), `src/app/App.vue` (주입),
`src/features/playback/PlayerSurface.vue` (어댑터 등록),
`src/stores/playback.ts` (`advance` / `back`),
`RecordLibraryDrawer.vue` · `PlaylistList.vue` 재생 버튼, **ADR 0009**.

**완료 기준** — 전부 충족 ✔

- `library` 와 `playback` 이 서로를 import 하지 않는다 (기존 테스트 유지). ✔
- 재생 시작 후 라이브러리를 편집해도 큐가 흔들리지 않는다 (스냅샷). ✔
- 큐 끝에서 정한 정책대로 동작한다 — 멈추고 알린다. ✔

**테스트** — `playback-coordinator.spec.ts` (34) ·
`playback-queue-flow.spec.ts` (14) · `playback-api-readiness.spec.ts` (1)

- 목록 전체 재생 / 선택 트랙부터 재생 → 큐가 **목록 전체**의 스냅샷인지
- 큐의 트랙이 라이브러리와 **다른 객체**인지 (얕은 복사면 보장이 깨진다)
- 재생 중 라이브러리 편집·이름 변경·삭제·선택 변경 → 큐 불변
- `ENDED` → 인덱스 +1, 마지막에서 정지하고 안내
- 재생된 적 없는 트랙의 늦은 `ENDED` 를 무시 (빠른 연속 선택)
- 오류·자동재생 차단에서 **자동 건너뛰기 없음**, 새 요청으로 복귀
- API 준비 전 재생 요청이 유실되지 않고 준비 후 **한 번** 실행
- 테마 전환·드로어 여닫기에서 `YT.Player` 1개, `destroy()` 0회, iframe 동일
- 어댑터와 DOM 노드가 Pinia state 에 없음
- 두 store 간 직접 import 없음 (정적 검사 유지)

**M3-2 가 하지 않은 것**: 트랜스포트 버튼(M3-3), 지금 재생 중인 트랙 강조
(M3-3), 가시성 가드(M3-4), 오류 코드별 상세 안내·외부 링크(M3-5),
재생 중 트랙 삭제 정책(M3-5). `playback.back()` 은 M3-3 에서 쓴다.

---

### M3-3. 트랜스포트 UI와 상태 메시지 — 완료 (2026-11-03)

**작업 범위** — 승인된 디자인의 컨트롤 3개와 상태 영역.

| #   | 작업                                                                                         |
| --- | -------------------------------------------------------------------------------------------- |
| 3.1 | 이전 / 재생·일시정지 / 다음 (`.round`, 메인 51px). **자체 탐색 바·볼륨 UI 를 만들지 않는다** |
| 3.2 | 큐가 비었거나 경계면 버튼 비활성화                                                           |
| 3.3 | 상태 메시지 — `role="status"` `aria-live="polite"`, 경고는 `--status-warning-text-color`     |
| 3.4 | `NOW PLAYING` · 제목 · 부제 영역                                                             |
| 3.5 | `PlayerSurface` 의 `NOT CONNECTED` 안내를 실제 상태 표시로 교체                              |

**산출물**: `src/features/playback/useTransport.ts` (뷰 모델) ·
`PlayerTransport.vue` (버튼 3개) · `PlayerSurface.vue` (조립),
`playbackCoordinator.ts` 에 `PlaybackTransport`
(`togglePlay` / `next` / `previous`), **ADR 0010**.

**완료 기준** — 전부 충족 ✔

- 키보드만으로 조작 가능 — 네이티브 `<button>` 3개, 비활성은 `disabled`. ✔
- 상태 변화가 보조기기에 전달된다 — `role="status"` `aria-live="polite"`. ✔
- `playback.statusMessage` / `statusTone` 을 쓰고 새 상태를 만들지 않았다. ✔

**버튼별 상태 전이** (ADR 0010)

| 상태      | 토글 | 누르면                      | 이전             | 다음          |
| --------- | ---- | --------------------------- | ---------------- | ------------- |
| 큐 없음   | ▶    | 비활성                      | 비활성           | 비활성        |
| `idle`    | ▶    | `play()`                    | 첫 곡이면 비활성 | 끝이면 비활성 |
| `loading` | Ⅱ    | `pause()` — 시작 취소       | 〃               | 〃            |
| `playing` | Ⅱ    | `pause()`                   | 〃               | 〃            |
| `paused`  | ▶    | `play()`                    | 〃               | 〃            |
| `ended`   | ▶    | `play()` — 그 자리에서 재생 | 〃               | 〃            |
| `error`   | ▶    | **다시 적재** (재시도)      | 〃               | 〃            |

마지막 곡에서 다음은 비활성이고, 코디네이터의 `next()` 도 `false` 를
돌려준다. 처음으로 돌아가지 않는다 (M3-0.1).

**테스트** — `player-transport.spec.ts` (29) + 기존 spec 보강

- 버튼 활성/비활성 (큐 없음 · 첫 곡 · 가운데 · 마지막 · 1곡)
- 토글 7개 상태, 이전/다음 이동과 경계
- 제목 · 큐 위치 · 상태 라벨 표시
- 라이브 리전 속성과 **재생 중 비움**(반복 알림 방지)
- 빠른 연속 클릭, 늦게 도착한 `ENDED`
- 테마 전환·드로어 여닫기 후 컨트롤·재생 상태·어댑터 DOM 유지

**M3-3 이 하지 않은 것**: 가시성 가드(M3-4), 오류 상세·외부 링크·재시도와
`.video-placeholder`(M3-5).

---

### M3-4. 가시성 가드와 드로어 연동 — 완료 (2026-11-03)

**작업 범위** — 플레이어가 보이지 않거나 너무 작을 때 재생을 멈춘다.

| #   | 작업                                                                                        | 상태 |
| --- | ------------------------------------------------------------------------------------------- | ---- |
| 4.1 | 가시성 측정 — 순수 함수 + `IntersectionObserver` 통지 (ADR 0011)                            | 완료 |
| 4.2 | 200×200 미만이면 재생을 시작하지 않는다 — **공식 요구사항** (§8.1)                          | 완료 |
| 4.3 | 노출 비율이 임계값 아래면 일시정지 — 우리 휴리스틱 (§8.1)                                   | 완료 |
| 4.4 | 1100px 이하에서 드로어를 열면 위젯 호스트가 `display: none` 이 된다. **열기 전에 일시정지** | 완료 |
| 4.5 | 재평가 시점: 드로어 열기, 창 크기 변경, 스크롤, 재생 시도 직전                              | 완료 |

**산출물**: `src/features/playback/playerVisibility.ts`,
`playbackCoordinator.ts` 에 `PlaybackVisibility` 와 `player-hidden` 사유,
`createPlaybackCoordinator.ts` 의 가드, `PlayerSurface.vue` (감시 등록),
`DashboardShell.vue` (가리기 직전 통지), `RecordLibraryDrawer.vue`
(거절 안내), `tests/support/playerLayout.ts`, **ADR 0011**.

**완료 기준** — 전부 충족 ✔

- 플레이어가 가려지면 재생이 멈추고 사유가 전달된다. ✔
- **DOM 은 그대로다.** 가시성 처리가 언마운트를 유발하지 않는다. ✔
- 복귀해도 자동으로 재생하지 않는다. 사용자가 ▶ 를 눌러야 한다. ✔

**발견해 고친 문제** — 브라우저 검증에서 드러났다. 1100px 이하의 단일 열
배치에서 플레이어가 화면 한참 아래(1000×713 실측 top 1247px)에 놓여,
가시성 가드가 **모든 재생을 거절**했다. 재생 요청 시 영역을 한 번 끌어오는
`reveal()` 을 더해 해결했다 (ADR 0011 §5). 승인된 레퍼런스의 배치는 그대로다.

**테스트** — `player-visibility.spec.ts` (57)

- 측정 전수: 정확히 200×200 허용 · 199 거절 · 면적 0 은 `covered` ·
  정확히 절반 거절 · 절반 초과 허용 · 네 방향으로 밀려난 경우
- 감시: 관찰자 유무에 따른 리스너 배선, `stop()` 해제, `measure()` 무캐시,
  `reveal()` 의 즉시 스크롤과 구현 없는 환경
- 가드: 가려진 상태의 목록·트랙 재생·토글·이전·다음·`ENDED` 거절,
  **일시정지는 막지 않음**, 큐 불변, 측정 함수 없으면 가드하지 않음,
  화면 밖이면 끌어온 뒤 재생 · 보이면 끌어오지 않음 · `too-small` 에는
  끌어오지 않음
- 중단: 가려짐 알림 → 일시정지, 이미 멈췄으면 무동작, `loading` 도 취소,
  복귀 후 자동 재생 **없음**, 늦은 `ENDED` 무시
- 통지: 재생 중이면 측정하지 않고 멈춤, 멈춰 있으면 무동작
- 연동: 좁은 화면 드로어 열기가 **DOM 갱신 전에** 멈춤, 넓은 화면은 멈추지
  않음, `matchMedia` 없으면 통지 안 함, 드로어 거절 안내, 여닫기 3회 후
  `mount()` 1회 · `destroy()` 0회 · `.player-mount` 동일 노드, 테마 전환 후에도
  감시 생존, 언마운트 시 감시 해제

돌연변이 20종 전부 검출됐다.

> **브라우저 확인 필요 (M5 로 넘김)**: 1440px 에서 드로어를 열면 플레이어가
> 420×236 이 된다. 공식 **요구**(200×200)는 넘지만 **권장**(480×270)에는 못
> 미친다. 500px 화면에서는 433×244 다. 실제 재생 품질과 컨트롤 표시는 M5 의
> 반응형 검증에서 눈으로 확인한다.

---

### M3-5. 오류·예외 처리와 안정화 — 완료 (2026-11-03)

**작업 범위** — 재생이 안 되는 경우를 전부 사용자에게 설명한다.

| #   | 작업                                                                                                                      | 상태 |
| --- | ------------------------------------------------------------------------------------------------------------------------- | ---- |
| 5.1 | `onError` 코드별 안내 — 2 / 5 / 100 / 101 · 150 / 153 (§8.1 표)                                                           | 완료 |
| 5.2 | `onAutoplayBlocked` — 토글을 ▶ 로 되돌리고 다시 누르라고 안내                                                             | 완료 |
| 5.3 | API 스크립트 로드 실패 — 안내 + 재시도 + `YOUTUBE에서 열기 ↗` (`rel="noopener noreferrer"`)                               | 완료 |
| 5.4 | **재생 중 트랙 삭제** — 큐는 스냅샷이라 자동으로 끊기지 않는다. 상위 계층이 명시적으로 멈추고 안내한다 (`MVP_SPEC.md` F4) | 완료 |
| 5.5 | 오프라인 · 네트워크 실패 — `api-unavailable` 안내와 재시도 경로                                                           | 완료 |
| 5.6 | 재생 불가 영상에서 멈춘다 (M3-0.7). 자동 건너뛰기 없음                                                                    | 완료 |
| 5.7 | 영상 로딩 전 안내 `.video-placeholder` — 어댑터 소유 영역의 **형제**로                                                    | 완료 |

**산출물**: `createPlaybackCoordinator.ts` (종류별 문구 · `trackRemoved` ·
연결별 핸들러), `youtubeIframeApi.ts` (실패 시도 폐기와 재시도),
`YouTubeIFramePlayerAdapter.ts` (`apiRequested` 해제 · 자동재생 차단 시
낙관적 `loading` 되돌림), `useTransport.ts` (`youtubeUrl` ·
`showsPlaceholder`), `PlayerTransport.vue` (외부 링크),
`PlayerSurface.vue` (`.video-holder` + `.video-placeholder`),
`RecordLibraryDrawer.vue` (삭제 통지), `shared/utils/youtube.ts`
(`youtubeWatchUrl`), **ADR 0012**.

**완료 기준** — 전부 충족 ✔

- 위 경우에 조용히 실패하지 않는다. ✔
- 사용자가 다음에 무엇을 할 수 있는지 안다 — 안내마다 행동이 적혀 있다. ✔
- ADR 0010 의 접근성 결정을 유지했다. 상태 전이는 부제에, 의도적 안내만
  라이브 리전에. ✔

**테스트** — `playback-errors.spec.ts` (39) · `youtube-adapter.spec.ts` (+7) ·
`youtube-url.spec.ts` (+4)

- 코드 6종 × (분류 · 문구 조각 · 번호 · 경고 어조), 101/150 동일 문장,
  알 수 없는 코드, 번호 없는 `api-unavailable`
- 자동재생 차단: 경고 문구 · `error` 아님 · ▶ 로 되돌림 · 다시 누르면 재생 ·
  차단 뒤 `ENDED` 무시 · 큐 비었을 때 무동작
- 늦은 사건: 연결 끊긴 어댑터의 사건 폐기(`destroy()` 없이도), 큐 빈 상태,
  재생된 적 없는 트랙의 `ENDED`, **재생 중 오류는 버리지 않음**, 자기 교정
- API 로드 실패: 매달리지 않음 · 실패 요소 제거 · 같은/다른 어댑터의 재시도 ·
  재시도 성공 · 재시도 실패 · 스크립트는 언제나 1개
- 재생 중 트랙 삭제: 정지·안내·큐 불변·자동 전환 없음·늦은 `ENDED` 무시 ·
  다른 곡 삭제는 무영향 · 드로어 통합 경로
- 외부 링크: 트랙 없으면 없음 · href · `target` · `rel` · 오류에도 유지 ·
  곡 전환 시 갱신 · 잘못된 영상 ID 면 `null`
- 로딩 전 안내: 어댑터 영역의 형제 · 승인된 문구 · 클래스로만 숨김

돌연변이 19종 중 18종 검출. 남은 1종(`encodeURIComponent` 제거)은 **무효
변이**다 — 검증을 통과한 11자 ID 는 전부 `[A-Za-z0-9_-]` 라서 인코딩이
바꾸는 글자가 없다. 의도된 중복 방어로 두고 코드에 근거를 적었다.

---

### M3 완료 기준

- [x] 곡이 끝나면 다음으로 넘어간다 (단위 테스트) — **실제 YouTube 재생은
      헤드리스에서 `PLAYING` 을 관측하지 못했다. M5 에서 재확인한다**
- [x] 테마 전환·드로어·반응형에서 재생이 끊기지 않는다 (M1-5 보장 유지)
- [x] `PlayerAdapter.mount()` 가 세션당 1회다
- [x] 라이브러리 편집이 재생 중인 큐를 흔들지 않는다
- [x] 재생 불가·차단·오류가 모두 사용자에게 설명된다
- [x] `npm run type-check` / `test` / `lint` / `format:check` / `build` 통과
- [x] 승인된 디자인의 컨트롤 구성을 바꾸지 않았다 (규칙 6)

## M4 — 시계·날씨 위젯과 상태별 애니메이션 — 완료 (2026-11-03)

| #   | 작업                                                                           | 상태      |
| --- | ------------------------------------------------------------------------------ | --------- |
| 4.1 | 시계 위젯 — 도트 매트릭스 글리프, SVG 렌더러, `Asia/Seoul` 12시간제, 15초 갱신 | 완료      |
| 4.2 | 날씨 위젯 — Open-Meteo 연동, 로딩·오류·데이터 없음 표시 (ADR 0013)             | 완료      |
| 4.3 | 데크 회전 애니메이션 (재생 중 `paused` → `running`), 톤암·전원 램프            | 완료      |
| 4.4 | 마스코트 호흡 애니메이션 (재생 중) + 상태별 표정                               | 완료      |
| 4.5 | 테마별·상태별 마스코트 메시지 전환                                             | 완료      |
| 4.6 | `prefers-reduced-motion` 시 모든 애니메이션 비활성 검증                        | 완료      |
| 4.7 | 설정 영속화 확장                                                               | 해당 없음 |

기준: `MVP_SPEC.md` F6, F7, F8.

**산출물**

| 파일                                | 역할                                 |
| ----------------------------------- | ------------------------------------ |
| `widgets/clock/dotGlyphs.ts`        | 글리프 비트맵 + **순수** 배치 계산   |
| `widgets/clock/clockFormat.ts`      | `Asia/Seoul` 표시값, 보조기기 이름   |
| `widgets/clock/DotClock.vue`        | SVG 렌더러. 시간을 모른다            |
| `widgets/clock/ClockWidget.vue`     | 타이머와 조립                        |
| `widgets/weather/weatherCodes.ts`   | WMO 코드 → 아이콘·설명               |
| `widgets/weather/weatherApi.ts`     | 요청과 **방어적** 파싱               |
| `widgets/weather/useWeather.ts`     | 상태·타이머·캐시                     |
| `widgets/weather/WeatherWidget.vue` | 세 상태 표시                         |
| `features/mascot/moods.ts`          | `PlayerState` → 기분 → 표정·문구     |
| `features/mascot/patterns.ts`       | 표정 변형 2종 추가                   |
| `themes/*/deck.css`                 | LP 회전 · 릴 회전 · 톤암 · 전원 램프 |
| `stores/playback.ts`                | `isPlaying` 파생값                   |
| `widgets/registry.ts`               | 시계·날씨 플레이스홀더 교체          |
| **ADR 0013**                        | 날씨 제공자 선택                     |

**4.7 이 "해당 없음" 인 이유**: M4 가 더한 사용자 조정 항목이 없다. 시간대는
`Asia/Seoul` 고정이고 날씨 위치는 서울 고정이다(ADR 0013). 새로 저장할 설정이
없으므로 `39page.theme` / `39page.library` 외에 키를 만들지 않았다. 도시 선택
UI 를 도입할 때 함께 확정한다 (백로그).

**45 RPM 을 쓰지 않는 이유**: 승인된 디자인의 속도 키는 M1-6 에서 **동작하지
않는 컨트롤**로 정리했다(인터랙션 속성 제거). 연결할 컨트롤이 없으므로
`--duration-spin-45` 는 아직 쓰이지 않는다. 회전 속도는 연출이고 음악의
템포와 무관하다.

**완료 기준** — 전부 충족 ✔

- 시계가 실제 시각을 보여주고 15초마다 갱신된다. ✔
- 날씨가 **실제 데이터**를 보여주고, 실패를 실패로 보여준다. ✔
- 데크와 마스코트가 **실제 재생 상태**만 따라간다. ✔
- `prefers-reduced-motion` 에서 모든 연출이 멈춘다. ✔
- 연출이 `PlayerSurface` 를 재생성하지 않는다. ✔

**테스트** — `clock-widget.spec.ts` (28) · `weather-widget.spec.ts` (50) ·
`playback-presentation.spec.ts` (36) + 기존 spec 보강

- 글리프·기하 상수를 **레퍼런스와 문자 단위로** 비교, 좌표·viewBox 전수,
  꺼진 도트 포함, 알 수 없는 글자는 자리만
- 서울 기준 시각·날짜 경계·정오·자정, 15초 경계, 언마운트 정리, 재마운트,
  탭 복귀 갱신
- 날씨: 주소·키 없음·위치 권한 미사용(정적), 응답 11종 거절, 코드 매핑 13종,
  세 상태 표시, 캐시·재시도 간격, 언마운트 취소
- 연출: `PlayerState` → 기분 전수, 표정 변형이 승인된 패턴에서 1~2행만
  다름, `loading` 은 재생 아님, 모션 토큰 사용, 셸·호스트는 연출을 모름

돌연변이 23종 전부 검출됐다.

**선행 결정 해소**: 날씨 API 제공자 → ADR 0013. 마스코트 도트 패턴은 테마별로
나누지 않고 **재생 상태별**로 나눴다 — v09 가 두 테마에 같은 패턴을 쓰고 색만
바꾸므로 그 의도를 따랐다 (`MVP_SPEC.md` F8 TODO 해소).

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

해당 단계 전에 확정해야 한다. 중요한 결정은 `docs/decisions/`에 기록한다.
M1-2 의 토큰 이름, M2 의 `prompt()`·`confirm()` 대체 UI, **M3-0 의 9개 항목**은
해당 단계에서 확정해 목록에서 뺐다 (M3-0 표 참조).

| 항목                                                                                                | 필요 시점 | 문서                    |
| --------------------------------------------------------------------------------------------------- | --------- | ----------------------- |
| 오프라인·API 로드 실패 시 안내와 복구                                                               | M3-5      | `MVP_SPEC.md` F3        |
| ~~`ResizeObserver` / `IntersectionObserver`~~ — M3-4 에서 `IntersectionObserver` 로 확정 (ADR 0011) | 완료      | `SYSTEM_DESIGN.md` §4.5 |
| 날씨 API 제공자                                                                                     | M4        | `MVP_SPEC.md` F7        |
| 마스코트 도트 패턴 테마별 차이                                                                      | M4        | `THEME_SYSTEM.md` §6    |
| 드래그 라이브러리 (DOM 재배치 금지 제약)                                                            | 백로그    | `BACKLOG.md` §1         |

## 작업 방식

- 한 작업 단위는 하나의 M*n*-N 범위를 넘지 않는다.
- 동작 변경 시 테스트를 함께 수정한다 (`AGENTS.md` 규칙 7).
- 작업마다 변경 파일과 검증 결과를 보고한다 (`AGENTS.md` 규칙 10).
- 승인된 디자인 레퍼런스는 수정하지 않는다 (`AGENTS.md` 규칙 6).
