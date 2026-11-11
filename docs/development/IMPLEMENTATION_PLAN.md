# 구현 계획

> 상태: 개정 (M5 완료 — MVP 범위 종료. M6·M7 실기기 후속 완료.
> **M8-4 통합 검증 완료 — 실기기 수동 확인만 남았다**).
>
> 기준 문서: [`design/references/README.md`](../../design/references/README.md)
> MVP 외 확장 항목: [`../product/BACKLOG.md`](../product/BACKLOG.md)

## 마일스톤 개요

| 마일스톤 | 범위                                                                       | 상태               |
| -------- | -------------------------------------------------------------------------- | ------------------ |
| M0       | 프로젝트 초기화                                                            | 완료               |
| M1 준비  | 디자인 레퍼런스 반영, 아키텍처 확정                                        | 완료               |
| **M1**   | 앱 셸, 두 테마, 테마 전환, 최소 Widget Registry/Host, 플레이어 영속성 구조 | 완료               |
| M2       | Record Library와 플레이리스트 관리                                         | 완료               |
| M3       | YouTube 실제 재생과 연속 재생                                              | 완료               |
| M4       | 날씨 위젯 및 마스코트 상태별 애니메이션                                    | 완료               |
| M5       | UX, 반응형, 접근성, 통합 테스트 및 안정화                                  | 완료               |
| M6       | 실기기 검증 후속 — 레이아웃·오버레이·플레이리스트 위젯                     | 완료               |
| M7       | 2차 실기기 검증 후속 — 트리거 재배치·하단 시트·가림 측정                   | 완료               |
| **M8**   | **JSON 백업·복원**                                                         | **운영 배포 완료** |
| **M9**   | **Music Moments** — 구현·통합 검증 완료 (M9-1 ~ M9-6)                      | **운영 배포 완료** |
| **M10**  | **Chrome 확장을 통한 음악·Moment 수집** (M10-1 · M10-2 완료, 로컬 브랜치)  | 진행               |

> ⚠ **번호 주의.** Post-MVP 작업 지시서는 백업·복원을 "M6" 로 불렀지만 M6·M7 은
> 이미 실기기 검증 후속에 쓰였다 ([`M6_PLAN.md`](M6_PLAN.md) ·
> [`M7_PLAN.md`](M7_PLAN.md)). 중복을 피해 **M8 / M9 / M10** 으로 옮겼고
> 우선순위와 분해는 지시서와 같다.

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

> ⚠ **M6 에서 이 표의 산출물이 바뀌었다.** 위 기록은 M2 시점의 사실로 남긴다.
> 실기기 검증 뒤 플레이리스트를 드로어에서 **위젯으로 꺼내고**(`features/library/
PlaylistWidget.vue` · `PlaylistTile.vue`) 드로어를 한 목록의 편집 표면으로
> 좁혔다. 그 과정에서 `PlaylistList.vue` 를 지우고 트랙 행을 `TrackList.vue` 로
> 분리했다. 근거는 **ADR 0016** 이다.

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

## M5 — UX, 반응형, 접근성, 통합 테스트 및 안정화 — 완료 (2026-11-04)

| #   | 작업                                                      | 상태                                        |
| --- | --------------------------------------------------------- | ------------------------------------------- |
| 5.1 | 반응형 정교화 — 8개 폭 × 두 테마 실측                     | 완료                                        |
| 5.2 | 좁은 화면 드로어 동작 (스테이지 대체, 열기 전 일시정지)   | 완료 (M3-4)                                 |
| 5.3 | 접근성 감사 — 포커스 링, 터치 타깃, `aria-*`, 키보드 경로 | 완료                                        |
| 5.4 | 종합 통합 테스트 — 지시받은 13개 흐름                     | 완료                                        |
| 5.5 | 오류·빈 상태 문구 정리                                    | 완료                                        |
| 5.6 | 성능 점검 (번들 크기, 타이머·리스너·요청 정리)            | 완료                                        |
| 5.7 | 저장 실패·용량 초과 처리                                  | 완료 (M1-1 · M2-1, 통합 흐름 13으로 재확인) |

기준: `MVP_SPEC.md` §4 비기능 요구사항. 설계 결정은 **ADR 0014**.

**디자인 마무리** — 승인된 HTML 과 스크린샷으로 비교했다.

| 요소                  | 결과                                                              |
| --------------------- | ----------------------------------------------------------------- |
| 정보 열 구분선        | `.widget-host::before` 로 그린다. DOM 래퍼를 만들지 않았다        |
| 푸터                  | `AppFooter.vue`. 테마 문구를 쓰므로 셸에서 분리했다               |
| 마스코트 위치         | 그리드를 3행으로 바꿔 데크 바로 아래로 올렸다 (기존 300px 벌어짐) |
| 상태 문구             | 가시성 안내가 상황이 풀리면 지워진다                              |
| 플레이어 로딩 전 안내 | M3-5 에서 완료                                                    |
| 두 테마 일관성        | 같은 컴포넌트·같은 구조. 색과 데크 아트만 다르다                  |

**브라우저 실측에서 고친 결함 3건**

| 결함                          | 원인                                          | 수정                                |
| ----------------------------- | --------------------------------------------- | ----------------------------------- |
| 360px 에서 영상 뷰포트 198px  | `border-box` 에서 테두리가 최소 높이를 먹었다 | 최소값에 테두리 두께를 더한다       |
| `.track-play` 터치 목표 30×22 | 레퍼런스에 높이 선언이 없어 글자 높이가 됐다  | 이웃 버튼과 같은 `min-height: 29px` |
| 페이지에 `h1` 없음            | 레퍼런스가 브랜드를 `<span>` 으로 둔다        | `<h1>` 으로 올림 (모양 동일)        |

**반응형 실측** (CDP, 두 테마 × 8폭. 360px 은 모바일 에뮬레이션 DPR 3)

| 폭   | 가로 오버플로 | 플레이어 (닫힘) | 드로어 열림      |
| ---- | ------------- | --------------- | ---------------- |
| 1440 | 없음          | 534×299         | 418×234 (나란히) |
| 1100 | 없음          | 958×538         | 스테이지 `none`  |
| 1000 | 없음          | 869×488         | 스테이지 `none`  |
| 730  | 없음          | 629×353         | 스테이지 `none`  |
| 650  | 없음          | 581×326         | 스테이지 `none`  |
| 600  | 없음          | 531×298         | 스테이지 `none`  |
| 500  | 없음          | 431×242         | 스테이지 `none`  |
| 360  | 없음          | **306×200**     | 스테이지 `none`  |

24px 미만 터치 목표: 수정 후 **0개**.

**접근성 실측** (CDP 실제 키 입력)

- Tab 순서(재생 중): 테마 ×2 → 데크 열기 → YouTube iframe 내부 → 재생 →
  다음 곡 → `YOUTUBE에서 열기 ↗`. Shift+Tab 역순 동작
- Enter 로 드로어 열기 → 포커스가 닫기 버튼으로, ESC 로 닫기 → 포커스가
  트리거로 복귀
- 닫힌 드로어의 컨트롤 16개가 전부 Tab 순서에서 빠진다
- 포커스 링: 모든 컨트롤 `solid 2px`, offset 2~3px
- 제목 구조 `h1 → h2 → h3`, 랜드마크 `header` · `footer` · `aside`
- `prefers-reduced-motion` 에서 모든 애니메이션 `0.01ms` · 반복 1회

**테스트** — `shell-design.spec.ts` (15) · `accessibility.spec.ts` (20) ·
`lifecycle-hygiene.spec.ts` (13) · `tests/integration/mvp-flows.spec.ts` (31)

- 기존 spec 보강 (7)

통합 흐름 13개는 지시받은 목록과 1:1 로 대응한다 — 최초 실행 · 목록 생성과
링크 등록 · 개별 트랙 재생 · 다음/이전/일시정지/다시 재생 · `ENDED` 자동 전환 ·
큐 끝 정지 · 재생 중 테마 변경 · 재생 중 드로어 여닫기 · 편집 후 큐 안정성 ·
재생 중 트랙 삭제 · 새로고침 복원 · 임베드 불허/API 오류/자동재생 차단 ·
저장소 손상과 저장 실패.

돌연변이 9종 전부 검출됐다.

**남은 차이 하나**: 1440px 에서 시계와 날씨 사이가 레퍼런스보다 약 35px
넓다. 데크가 두 행을 가로지르며 남는 높이를 나눠 갖기 때문이고, 래퍼 없이
두 열을 각자 흐르게 할 방법이 없다 (ADR 0014 §3).

---

## M8 — JSON 백업·복원

> 기준 문서:
> [`../architecture/BACKUP_FORMAT.md`](../architecture/BACKUP_FORMAT.md) (포맷) ·
> [`../product/BACKUP_RESTORE.md`](../product/BACKUP_RESTORE.md) (기능·정책) ·
> **ADR 0018** (결정과 대안)
>
> 출처: `POST_MVP_PLAN.md` §B.12 가 이것을 **B-0** 으로 추천했다 — 의존성 0,
> 서버 0, 계정 0 이고 "데이터가 날아갈까" 에 즉시 답한다.

| #   | 작업                                          | 상태     |
| --- | --------------------------------------------- | -------- |
| 8.1 | 백업 포맷·버전 정책·검증·데이터 보호 **설계** | **완료** |
| 8.2 | JSON 내보내기                                 | **완료** |
| 8.3 | JSON 가져오기 · 미리보기 · 확인               | **완료** |
| 8.4 | 데이터 보호 · 호환성 · 브라우저 통합 검증     | **완료** |

### M8-1. 설계 — 완료 (2026-11-06)

**산출물**

| 문서                                    | 내용                                         |
| --------------------------------------- | -------------------------------------------- |
| `architecture/BACKUP_FORMAT.md`         | 파일 스키마, 버전 정책, 검증 규칙, 크기 한도 |
| `product/BACKUP_RESTORE.md`             | 사용자 기능(F10–F12)과 정책                  |
| `decisions/0018-json-backup-restore.md` | 12개 결정과 탈락한 대안                      |
| `architecture/SYSTEM_DESIGN.md` §7.4    | 저장 계층과의 책임 분리                      |

**확정한 것**

- 파일 식별자 `format: "39page-backup"`, 파일 버전 `schemaVersion: 1`
- 섹션이 **저장 봉투를 그대로 품는다** → `normalizeLibraryData` 를 그대로 재사용
- 파일 버전과 내부 버전을 **분리**한다. 선택 섹션 추가는 파일 버전을 올리지 않는다
- 승인 전까지 `localStorage` 를 **만지지 않는다**
- 부분 가져오기는 **허용**하되 버리는 항목을 미리보기에 적는다
- `protected` 상태에서도 가져올 수 있다 (새 액션 `replaceAll`)
- 원자성을 약속하지 않는다. **가치 순 쓰기** + 쓰기 후 검증 실패 시에만 되돌린다
- M8 은 **전체 교체만** 지원한다

**완료 기준** — 전부 충족 ✔

- 실제 저장 키·버전·검증기를 코드에서 확인하고 문서 차이를 정리했다 ✔
- 백업 범위에 **코드에 없는 설정을 만들어 넣지 않았다** ✔
- Moments 를 **필수 필드로 요구하지 않는다** ✔
- 기존 검증 규칙을 재사용하며 상충하는 규칙을 만들지 않았다 ✔
- 애플리케이션 코드·저장 키·레퍼런스를 **변경하지 않았다** ✔

### M8-2. JSON 내보내기 — 완료 (2026-11-06)

**UI 자리 결정** — 레코드 편집 시트의 **바닥**에 두었다
(`BACKUP_RESTORE.md` §5 의 두 번째 후보). 헤더를 붐비게 하지 않고 라이브러리
맥락과 가깝다. 레퍼런스에 없는 영역이므로 **승인된 값을 하나도 바꾸지 않는
방식**을 골랐다 — 선(`--rule-color`)으로 끊고 `DATA` 머리말을 붙이며 드로어가
쓰는 토큰만 재사용한다. 새 색도 새 치수도 만들지 않았다.

**편집 버튼과의 구분** 세 가지: ① 선 + 다른 머리말 ② 강조 버튼
(`.pill--strong`)을 쓰지 않는다 ③ 평문 고지를 항상 아래에 둔다.

**스키마 보완 1건** — 선택 필드 `integrity` 를 더했다. 보호·접근 실패 상태의
내보내기를 **온전한 전체 백업으로 오인하지 않게** 하려는 것이다. 선택 필드
이므로 `schemaVersion` 은 1 그대로이고, 온전할 때는 필드를 넣지 않으므로
평범한 백업의 모양이 M8-1 예시와 같다. 상세: `BACKUP_FORMAT.md` §2-4.

**실측 (Chromium 155, headless)** — 빌드 산출물을 `vite preview` 로 띄우고 CDP
로 실제 내려받아 파일을 읽었다. **27개 항목 전부 통과.** 파일 1,137바이트,
이름 `39page-backup-20261106-1649.json`, 버튼 높이 36px.

실측 과정에서 **내 검증 스크립트의 측정 오류 2건**을 잡았다 — 타일을 열면 그
목록이 선택되고 저장되는 것이 M6-4 의 정상 동작인데, 기준값을 그 전에 떠서
내보내기가 바꾼 것으로 보였다. 기준값을 내보내기 직전으로 옮겨 해소했다.
제품 결함이 아니다.

**선행 결정 (해소됨)** — UI 자리.

**범위**

| 항목                                                           | 비고                                    |
| -------------------------------------------------------------- | --------------------------------------- |
| `src/features/backup/createBackup.ts` — **순수 함수**          | store 값 → 백업 객체. DOM·파일 API 없음 |
| `src/features/backup/downloadBackup.ts` — Blob · `a[download]` | 브라우저 경계. 순수 로직과 분리한다     |
| 파일 이름 생성 `39page-backup-<YYYYMMDD>-<HHmm>.json`          | 로컬 시각, 콜론 금지                    |
| 내보내기 트리거 UI                                             | 자리는 선행 결정                        |
| 보호 상태에서도 내보낼 수 있다                                 | 메모리 값을 꺼낸다                      |

**하지 않는 것**: 가져오기, 자동 백업, 압축, 암호화.

**산출물**

| 파일                                     | 성격      |
| ---------------------------------------- | --------- |
| `src/features/backup/backupSchema.ts`    | 타입·상수 |
| `src/features/backup/createBackup.ts`    | **순수**  |
| `src/features/backup/downloadBackup.ts`  | 브라우저  |
| `src/features/backup/useBackupExport.ts` | 뷰 모델   |
| `src/features/backup/BackupPanel.vue`    | 표현      |

**테스트**

| 테스트                                                    | 확인                          |
| --------------------------------------------------------- | ----------------------------- |
| 스냅샷 — 빈 라이브러리 / 트랙 있는 라이브러리             | 필드 구성과 값                |
| `format` · `schemaVersion` · `exportedAt` 형식            | ISO 8601 UTC                  |
| 섹션 봉투가 **저장 봉투와 같은 모양**                     | `version` + `data`            |
| 내보낸 `data.library.data` 가 `normalizeLibraryData` 통과 | 왕복 가능성                   |
| 세션 상태가 **들어가지 않는다**                           | 큐·현재 트랙·상태 메시지 부재 |
| 파일 이름에 콜론이 없다                                   | Windows 호환                  |
| 보호 상태에서도 객체를 만든다                             | `status === 'protected'`      |
| 내보내기가 `localStorage` 에 **쓰지 않는다**              | `setItem` 호출 0              |

**완료 기준** — 전부 충족 ✔

- 내려받은 파일을 `JSON.parse` 하면 포맷 문서의 구조와 일치한다 ✔ (실측)
- 내보내기 전후로 저장된 원문이 **바이트 단위로 같다** ✔ (단위 + 실측)
- 보호·접근 실패 상태를 전체 백업으로 오인하지 않는다 ✔ (`integrity` + 확인 단계)
- 플레이어 DOM·어댑터가 유지된다 ✔
- 두 테마에서 버튼이 보이고 새 색을 만들지 않았다 ✔

**테스트** — `tests/unit/backup-export.spec.ts` (53)

### M8-3. JSON 가져오기 · 미리보기 · 확인 — 완료 (2026-11-06)

**설계에서 더 정한 것 (문서에 없던 항목)**

| 항목                 | 결정                                                               |
| -------------------- | ------------------------------------------------------------------ |
| 재생 큐              | **라이브러리 교체 성공 시 멈추고 비운다.** 실패 시 건드리지 않는다 |
| 미리보기 이후의 변경 | **지문**(store + 저장소 원문)으로 잡고 다시 확인시킨다             |
| 안전 보장 불가       | 보호 상태 + 저장소 접근 불가 → **차단**하고 이유를 적는다          |
| 저장 계층            | 읽기 전용 `raw()` · `available()` 두 메서드를 더했다               |
| 코디네이터 계약      | `libraryReplaced()` 를 더했다 (사실만 알린다, 규칙 4)              |

저장 스키마·Storage 키·레퍼런스는 변경하지 않았다. 새 의존성도 없다.

**범위**

| 항목                                                                 | 비고                                         |
| -------------------------------------------------------------------- | -------------------------------------------- |
| `src/features/backup/readBackup.ts` — **순수 함수**                  | `unknown` → `{ sections, warnings, errors }` |
| 섹션 검증에 `normalizeLibraryData` · `isThemeKey` **재사용**         | 새 규칙 금지                                 |
| 미리보기 모델 (가져올 개수, 버리는 개수와 이유, 지금 데이터 개수)    | `report` 를 그대로 쓴다                      |
| 확인 UI — 교체 사실 명시, **"먼저 내보내기"** 버튼                   | `BACKUP_RESTORE.md` F12                      |
| `library.replaceAll(data)` — 보호 상태에서도 교체 가능한 **새 액션** | ADR 0018 결정 8                              |
| 보호 상태일 때 **원본 원문 내려받기**                                | `39page-raw-library-<…>.txt`                 |
| 적용 순서 — 라이브러리 먼저, 테마는 최선 노력                        | ADR 0018 결정 9                              |
| 설정 적용 켜고 끄기                                                  | ADR 0018 결정 11                             |

**하지 않는 것**: 병합, 되돌리기 버퍼, 새 저장 키, 자동 가져오기.

**산출물**

| 파일                                     | 성격                     |
| ---------------------------------------- | ------------------------ |
| `src/features/backup/readBackup.ts`      | **순수**                 |
| `src/features/backup/useBackupImport.ts` | 뷰 모델                  |
| `src/features/backup/BackupPanel.vue`    | 표현(증분)               |
| `src/stores/library.ts`                  | `replaceAll` (보호 우회) |
| `src/shared/storage/defineStorage.ts`    | `raw()` · `available()`  |
| `src/features/playback/*Coordinator*`    | `libraryReplaced()`      |

**테스트** — 포맷 문서 §7-1 의 **13개 상황을 1:1 로** 덮는다.

| 테스트 묶음                 | 확인                                                                                                           |
| --------------------------- | -------------------------------------------------------------------------------------------------------------- |
| 거부 7종                    | 크기 초과 · 잘못된 JSON · `format` 불일치 · 미래 파일 버전 · 필수 필드 누락 · 미래 섹션 버전 · 알 수 없는 섹션 |
| 정규화 4종                  | 중복 플레이리스트 id · 중복 트랙 id · 잘못된 `videoId` · 없는 `selectedPlaylistId`                             |
| **미리보기 중 저장소 불변** | 모든 거부·경고 경로에서 `setItem` 호출 0                                                                       |
| 승인 후 교체                | 라이브러리가 파일의 것으로 바뀐다                                                                              |
| 부분 가져오기               | 버리는 개수가 미리보기에 뜨고, 승인하면 나머지가 들어온다                                                      |
| 보호 상태                   | `protected` 에서도 교체되고 `status` 가 `ready` 로 바뀐다                                                      |
| 쓰기 실패                   | `quota-exceeded` 에서 **기존 데이터가 그대로다**                                                               |
| 부분 성공                   | 라이브러리 성공 · 테마 실패를 구분해 알린다                                                                    |
| 재생 안정성                 | 가져오기 중 iframe 이 재생성되지 않는다 (ADR 0002)                                                             |
| 경계                        | `replaceAll` 을 가져오기 외에서 부르지 않는다 (소스 단정)                                                      |

**완료 기준** — 전부 충족 ✔

- 승인 전 어떤 경로에서도 `localStorage` 쓰기가 **0** 이다 ✔ (단위 + 실측)
- 모든 거부·경고 경로에서 기존 데이터가 보존된다 ✔
- 내보낸 파일을 그대로 가져오면 **같은 상태로 돌아온다** ✔ (왕복, 실측 9단계)
- 버린 항목이 있으면 사용자에게 개수와 이유가 보인다 ✔
- `replaceAll` 이 **가져오기 경로에서만** 불린다 ✔ (소스 단정)
- 저장 실패를 성공으로 표시하지 않는다 ✔ (부분 성공을 구분해 알린다)

**테스트** — `tests/unit/backup-import.spec.ts` (70)

**실측 (Chromium 155, headless)** — 지시받은 9단계를 그대로 밟았다.
목록 생성 → 내보내기 → 라이브러리 변경 → 파일 선택 → 미리보기 비교 →
취소 후 유지 → 다시 선택 → 승인 → 새로고침. **25개 항목 전부 통과.**
`DOM.setFileInputFiles` 로 실제 파일을 입력에 넣었다 — 업로드 경로까지 실측했다.

### M8-4. 데이터 보호 · 호환성 · 브라우저 통합 검증 — 완료 (2026-11-06)

새 기능을 더하지 않는 **검증 단계**다. 찾은 것과 고친 것만 적는다.

#### 문서가 보장하지 못하던 표현 세 곳을 바로잡았다

| 문서                            | 주장했던 것                                  | 실제                                           |
| ------------------------------- | -------------------------------------------- | ---------------------------------------------- |
| `BACKUP_FORMAT.md` §8-4 · ADR 9 | "쓰기 뒤 검증이 실패하면 원문을 되돌려 쓴다" | **구현 없음.** 되돌리지 않기로 확정            |
| `BACKUP_FORMAT.md` §3-1         | "`< SUPPORTED` 는 하위 호환을 유지한다"      | 지금은 1 뿐이라 **해당 파일이 없다**           |
| `BACKUP_RESTORE.md` §3-5        | "저장이 실패하면 기존 데이터는 그대로입니다" | 저장소는 그대로지만 **화면은 복원된 모습**이다 |

세 번째가 가장 위험했다. 사용자가 화면을 보고 영구 복원 성공으로 오인하면
새로고침에서 잃는다.

#### 그래서 고친 구현 두 가지

| 변경                             | 왜                                                            |
| -------------------------------- | ------------------------------------------------------------- |
| `replaceAll` 에 **쓰기 후 검증** | 쓰기 결과만 믿으면 삼키는 저장소에서 "복원했습니다" 가 나간다 |
| **저장 안 됨 전용 안내 + 행동**  | 화면과 저장소의 어긋남을 사용자가 알고 대응할 수 있어야 한다  |

```
⚠ 지금 화면은 복원됐지만 저장되지 않았습니다. 새로고침하면 되돌아갑니다.
   [다시 저장 시도]  [지금 화면을 JSON으로 내보내기]
```

되돌리기는 **구현하지 않았다.** 저장 계층에 원문 쓰기 경로를 열어야 하고,
그것은 "쓰기는 봉투를 거친다" 는 보장을 깬다. 대신 정직하게 알린다.

#### 호환성 회귀를 고정 파일로 묶었다

`tests/fixtures/backup-v1.json` — 과거에 실제로 내보낸 `schemaVersion: 1` 파일.
**수정하지 않는다.** `tests/unit/backup-compat.spec.ts` (28) 가 이 파일을 읽어
지금 코드가 여전히 읽는지 본다.

왜 따로 두는가: 기존 두 spec 은 **지금 코드가 만든 파일**로 자기를 검사한다.
양쪽을 같이 바꾸면 둘 다 통과하면서 구형 파일이 조용히 안 읽히게 될 수 있다.

**이전 섹션 버전의 실제 지원 범위는 0 개다.** 마이그레이션 함수가 없으므로
추측해서 올리지 않고 건너뛴다. 내부 스키마를 2 로 올릴 때 마이그레이션을
**순수 함수로 따로 내보내** 저장 계층과 가져오기가 같은 것을 쓰게 해야 한다
(ADR 0018 결정 6). 그 제약을 `'이전 섹션 버전은 지원하지 않는다'` 테스트가
고정하므로, 마이그레이션을 붙이는 작업에서 그 테스트가 먼저 깨진다.

#### 성능 — 실측값 (Chromium 155 headless, 8코어, 힙 한도 1,508 MB)

**실제 UI 경로** (파일 입력 → `readBackup` → 미리보기 → `replaceAll` → 화면)

| 시나리오             | 파일    | 선택→미리보기 | 승인→화면   | 내보내기 | 힙    |
| -------------------- | ------- | ------------- | ----------- | -------- | ----- |
| 소규모 (30곡)        | 0.01 MB | 177ms         | 122ms       | 21.5ms   | 3 MB  |
| **1,000곡**          | 0.25 MB | 100ms         | **331ms**   | 19.4ms   | 7 MB  |
| 한도 근처 (30,000곡) | 7.68 MB | 235ms         | **2,346ms** | 398.1ms  | 29 MB |
| 한도 초과            | 8.96 MB | **거부**      | —           | —        | —     |

측정 방식의 한계를 밝힌다: 미리보기·적용 시간은 **50ms 폴링 + CDP 왕복**을
포함하므로 작은 입력에서는 상한에 가깝다. 단계별 순수 비용은 아래 표가 더
정확하다 (같은 작업량을 페이지 안에서 `performance.now()` 로 잰 값).

| 시나리오      | 크기    | 파싱   | 정규화 | 미리보기 | 적용    | 내보내기 | 합계    |
| ------------- | ------- | ------ | ------ | -------- | ------- | -------- | ------- |
| 빈 라이브러리 | 345 B   | 0.2ms  | 0.7ms  | 0.3ms    | 0.4ms   | 1.3ms    | 2.9ms   |
| 소규모        | 8 KB    | 0.2ms  | 1.0ms  | 0.2ms    | 0.8ms   | 2.1ms    | 4.3ms   |
| 1,000곡       | 260 KB  | 4.1ms  | 3.6ms  | 0.2ms    | 20.8ms  | 18.5ms   | 47.2ms  |
| 20,000곡      | 5.12 MB | 41.6ms | 45.4ms | 0.1ms    | 108.5ms | 140.8ms  | 336.4ms |

읽은 것:

- **1,000곡까지는 사람이 기다림을 느끼지 않는다** (합계 47ms)
- **30,000곡에서 적용이 2.3초 멈춘다.** 쪼개거나 워커로 보내지 **않았다** —
  M8-4 는 검증 단계이고, 그 규모는 손으로 영상을 3만 개 넣은 경우다. 대신
  4 MiB 이상 파일의 경고 문구에 **"가져오는 데 몇 초 걸릴 수 있다"** 를 더했다
  (측정에서 나온 말이고 추정이 아니다)
- **5.12 MB 백업이 `localStorage` 에 저장됐다.** 용량 초과가 나지 않았다 —
  실제 저장은 들여쓰기 없는 형태라 파일보다 작다
- 한도 초과 파일은 **파싱 전에** 거부된다 (748ms 는 CDP 왕복 포함)

#### 브라우저·반응형 — 5폭 × 2테마 전부 통과

360 · 390 · 500 · 768 · 1440px × mono-vinyl · kawaii-synth-cassette.
각 조합에서 16개 항목, **총 160개 통과 · 실패 0.**

| 확인                                      | 결과 |
| ----------------------------------------- | ---- |
| 가로 스크롤 없음                          | ✔    |
| DATA 패널이 뷰포트를 넘지 않음            | ✔    |
| 모든 버튼 24px 이상                       | ✔    |
| 버튼 글자 잘림 없음                       | ✔    |
| 미리보기 안 가로 넘침 없음 (비교 표 포함) | ✔    |
| 시트 세로 스크롤 동작                     | ✔    |
| 최종 버튼에 포커스가 간다                 | ✔    |
| ESC 로 시트가 닫힌다                      | ✔    |
| 플레이어 마운트가 하나로 유지된다         | ✔    |

##### ⚠ 정정 (2026-11-06, 운영 배포 검증) — 위 "가로 스크롤 없음" 의 범위

위 표의 "가로 스크롤 없음" 은 **문서 루트와 DATA 패널·미리보기만** 잰
결과다. 그 셋은 실제로 넘치지 않았다. 그러나 **드로어 본문
(`.drawer-body`) 은 재지 않았고, 거기에 가로 스크롤바가 있었다.**

운영 배포 뒤 스크린샷에서 발견했다. 1440px 가로 화면에서 드로어는 339px
짜리 좁은 열인데, 트랙 행이 목록보다 31px 넓어 `.drawer-body` 에
스크롤바가 섰다. 원인은 영상 ID 를 접는 기준이 **뷰포트** 질의였다는 것 —
세로 화면에서는 드로어가 화면 폭을 다 써서 둘이 같은 답을 내지만, 가로
화면에서는 뷰포트가 "넓다"고 답한다. `.track-list` 를 인라인 크기
컨테이너로 선언하고 `@container` 질의를 더해 고쳤다 (뷰포트 질의는 보루로
남겼다). 상세는 `ROADMAP.md` M8 배포 기록.

**교훈은 M8-4 의 그리드 교훈과 같다.** 레이아웃 보장을 재려면 보장이
걸린 **그 상자**를 재야 한다. 문서 루트가 넘치지 않는다는 것은 내부
스크롤 컨테이너가 넘치지 않는다는 뜻이 아니다. 이후 반응형 점검은 모든
요소의 `scrollWidth - clientWidth` 를 훑는다.

#### ⚠ 실기기에서 확인하지 못한 것

**Android Chrome · iOS Safari 실기기에 접근하지 못했다.** 헤드리스 Chromium
뷰포트 에뮬레이션은 실기기가 아니다. 남은 항목:

- 실기기 파일 선택 UI (iOS 의 파일 앱 경유, Android 의 저장소 권한)
- 실기기 다운로드 동작과 받은 파일 재선택
- 모바일 Safari 의 `<a download>` 동작 (버전에 따라 다르다)
- 터치로 미리보기 시트를 스크롤하는 느낌

### M8 완료 기준 — 전부 충족 ✔ (실기기 확인 제외)

- 사용자가 **계정 없이** 데이터를 꺼내고 되살릴 수 있다 ✔
- 가져오기 실패가 기존 데이터를 손상시키지 않는다 ✔ (모든 실패 경로 테스트)
- 가져오기 전용 검증 규칙이 **하나도 없다** ✔ (전부 M2 의 것을 재사용)
- Moments(M9)와 레이아웃 저장이 **파일 버전을 올리지 않고** 들어올 수 있다 ✔
  (`backup-compat.spec.ts` 가 `data.moments` 공존을 고정한다)
- **남은 것: Android Chrome · iOS Safari 실기기 수동 확인**

---

## M9 — Music Moments

명세: [`../product/MUSIC_MOMENTS.md`](../product/MUSIC_MOMENTS.md) ·
설계: [`../architecture/MOMENTS_DESIGN.md`](../architecture/MOMENTS_DESIGN.md) ·
결정: **ADR 0019** (도메인·저장) · **ADR 0020** (시점 조회·이동)

### M9-1. 설계 — 완료 (2026-11-07)

문서만 만들었다. **코드는 한 줄도 없다.**

| 산출물                                       | 내용                                         |
| -------------------------------------------- | -------------------------------------------- |
| `product/MUSIC_MOMENTS.md`                   | F13~F17 기능 명세 · 정책 · 범위 밖           |
| `architecture/MOMENTS_DESIGN.md`             | 도메인 · 검증 · 저장 · 재생 연동 · 백업 통합 |
| `decisions/0019-music-moments-domain.md`     | `videoId` 참조 · 전용 저장 키                |
| `decisions/0020-player-position-and-seek.md` | 어댑터에 `position`/`seek`, 코디네이터 중계  |
| `architecture/BACKUP_FORMAT.md` §6           | 권고 → 결정. "없음 ≠ 비었음" 추가            |

핵심 결정 넷.

1. Moment 는 **`videoId`** 를 가리킨다 — 트랙을 지워도 남는다
2. **전용 저장 키** `39page.moments` — 라이브러리 교체가 지우지 않는다
3. 시점 조회·이동은 **어댑터 계약**에 넣고 코디네이터가 중계한다
4. 백업에서 **섹션 없음 ≠ 빈 섹션** — 이것이 M9 호환성의 전부다

### M9-2. 도메인과 저장 — 완료 (2026-11-07)

| #   | 작업                                                                                     | 결과 |
| --- | ---------------------------------------------------------------------------------------- | ---- |
| 2.1 | `shared/types/moments.ts` — `Moment` · `MomentSource` · `MomentsData`                    | ✔    |
| 2.2 | `normalizeMoment` · `normalizeMomentsData` — 순수. 버린 개수 보고. `videoId` 패턴 재사용 | ✔    |
| 2.3 | `createMoment({ videoId, atSeconds, note, title, now, id })` — 순수. 시계·난수 밖에서    | ✔    |
| 2.4 | `STORAGE_KEYS.moments` **추가** (기존 둘은 그대로)                                       | ✔    |
| 2.5 | `stores/moments.ts` — `defineStorage` 로 영속. `MOMENTS_STORAGE_VERSION = 1`             | ✔    |
| 2.6 | `add` · `updateNote` · `remove` · `addMoments(list)` · `replaceAllMoments`               | ✔    |
| 2.7 | ADR 0007 보호 경로를 라이브러리와 **같은 구현**으로 적용                                 | ✔    |

조회도 함께 넣었다 — `getMoment(id)` · `momentsForVideo(videoId)` (시점
오름차순 **파생값**. 저장 배열은 추가 순서를 유지한다) · `count`.

M9-1 이 비워 둔 세 가지를 확정했다 (**ADR 0019 결정 7·8·9**).

| 질문              | 확정                                                   |
| ----------------- | ------------------------------------------------------ |
| 메모 길이         | 입력 500자. **읽기는 길이를 보지 않는다**              |
| 빈 제목 스냅샷    | 대체 표기로 채우지 않는다 (표시 3단계를 구별하기 위해) |
| 해석 안 되는 날짜 | Moment 를 버리지 않는다 — 메모와 시점까지 잃는다       |

**테스트 기준 — 실행 결과**

| 기준                                                            | 결과                            |
| --------------------------------------------------------------- | ------------------------------- |
| `normalizeMomentsData` 가 항목별로 버리고 개수를 센다 (표 전부) | ✔ 19개 무효 입력 + 보고 개수    |
| `atSeconds` 가 소수·문자열이면 **살리지 않고 버린다**           | ✔                               |
| `atSeconds` 0 은 유효하다                                       | ✔                               |
| 중복 `id` 는 처음 것만 남는다                                   | ✔ (일부 복구 → 보호 상태)       |
| 키가 없으면 빈 목록이고 **오류가 아니다**                       | ✔ `empty` · `status: 'ready'`   |
| 라이브러리 쓰기가 `39page.moments` 를 건드리지 않는다 (반대도)  | ✔ 원문 비교                     |
| 트랙·플레이리스트 삭제에도 Moment 가 남는다                     | ✔ 삭제·교체·새로고침 네 경로    |
| `replaceAllMoments` 의 호출처를 소스로 고정한다                 | ✔ **호출처가 아직 없다** (M9-5) |
| 미래 Storage 버전 · 손상 데이터 · 부분 복구 보호                | ✔ 원문 불변                     |
| `localStorage` 접근 불가 · 쓰기 실패                            | ✔ 메모리 유지 + 이유 보고       |
| 잘못된 입력에서 기존 데이터 불변                                | ✔ 메모리·원문 모두              |

**변이 검사.** 데이터 보호 조건이 테스트로 실제 고정됐는지 9건을 심어 확인
했다. 전부 실패로 잡혔다 (기준 155개 통과).

| 심은 변이                         | 잡힌 테스트 수 |
| --------------------------------- | -------------- |
| 보호 중 쓰기 차단 제거            | 7              |
| `atSeconds` 정수 검사 제거        | 6              |
| `atSeconds` 음수 허용             | 5              |
| 부분 복구 보호 제거               | 7              |
| 배열 아닌 입력을 빈 목록으로 승격 | 4              |
| 중복 `id` 를 나중 것으로 덮어씀   | 2              |
| 교체 실패 시에도 보호 해제        | 1              |
| 삭제가 같은 영상 전체를 지움      | 4              |
| 빈 제목을 대체 표기로 채움        | 2              |

**M9-2 가 하지 않은 것** — 중요하다.

- `main.ts` 를 건드리지 않았다. 앱은 `39page.moments` 를 **읽지도 쓰지도
  않는다.** 읽어도 쓸 곳이 없는 동안 시작 경로에 키 읽기를 더하지 않는다.
  프로덕션 번들에서 store 가 **tree-shaking 으로 빠져 있다** (실측)
- ⚠ **백업에 Moments 가 들어가지 않는다.** 통합은 M9-5 다. M9-2 를
  "사용자 데이터 백업까지 준비된 기능" 으로 보지 않는다. 이 상태를 소스
  수준 테스트로 고정했다 (`moments-store.spec.ts` G)
- `PlayerAdapter` · `PlaybackStore` · UI 는 전혀 바뀌지 않았다

### M9-3. 재생 연동 — 완료 (2026-11-10)

| #   | 작업                                                                   | 결과                                   |
| --- | ---------------------------------------------------------------------- | -------------------------------------- |
| 3.1 | `PlayerAdapter` 에 `position()` · `seek()` 추가 (ADR 0020)             | ✔                                      |
| 3.2 | `PlayerLoadOptions.startSeconds` 추가 (선택 필드)                      | ✔                                      |
| 3.3 | `YouTubeIFramePlayerAdapter` 구현 — 준비 전 `position()` 은 **`null`** | ✔ + 영상 식별 판정 (`getVideoUrl`)     |
| 3.4 | `FakePlayerAdapter` 에 **같은 계약을 실제로** 구현                     | ✔ `emitPosition()` 으로 보고를 재현    |
| 3.5 | `PlaybackMoments` 면 — `capturePosition()` · `playMoment()`            | ✔                                      |
| 3.6 | 큐 규칙 (`MOMENTS_DESIGN.md` §4-2) — 선택 목록 → 다른 목록 → 단일 곡   | ✔ + **현재 큐 유지** 규칙을 맨 앞에    |
| 3.7 | `main.ts` 가 `moments.restore()` 를 부른다 (M9-2 의 TODO)              | ✔ 테마 → 라이브러리 → Moments → 마운트 |

설계가 답하지 않은 것 8가지를 정했다 — **ADR 0020 결정 7~14**. 요점: 영상 식별
판정 · 준비 전/오류 시 재적재 · 현재 큐 유지 · `seek` 뒤 오래된 `ENDED` ·
`seek` 뒤 `play` · 첫 영상의 `start` 파라미터 · `MomentPlayResult` 상위 집합 ·
`MomentTarget.title`.

**테스트 기준 — 실행 결과**

| 기준                                                                         | 결과                                              |
| ---------------------------------------------------------------------------- | ------------------------------------------------- |
| 준비 전 `position()` 이 `null` 이고 **`0` 이 아니다**                        | ✔ 마운트만 · API 전 · onReady 전 세 단계          |
| 준비 후 0초 보고는 `0`, 소수는 그대로, NaN·Infinity·음수·undefined 는 `null` | ✔                                                 |
| 영상 전환 직후 이전 영상의 위치가 새 영상의 것으로 나가지 않는다             | ✔ 어댑터(`getVideoUrl`) + 코디네이터 두 층        |
| 같은 영상이면 `load` 를 **부르지 않고** `seek` 만 부른다                     | ✔ + 준비 전·오류면 시점 실어 재적재               |
| 다른 영상이면 `load(videoId, { startSeconds })` — 별도 `seek` 없음           | ✔ 0초 Moment 도 `startSeconds: 0` 으로            |
| 보류 요청에 `startSeconds` 보존 · 마지막 요청만 남음 · pause 취소            | ✔ 생성자 경로는 `start` 파라미터                  |
| 잘못된 `seek` · `startSeconds` 는 조용히 적용하지 않음                       | ✔                                                 |
| `playMoment` 가 가려진 플레이어에서 **다른 재생과 같은 이유로 거절**         | ✔ `player-hidden`, 큐 불변                        |
| 라이브러리에 없는 `videoId` 의 Moment 가 **단일 곡 큐**로 재생               | ✔ 이전·다음 비활성, `trackRemoved` 에 걸리지 않음 |
| 재생 불가 영상에서 기존 오류 안내가 뜨고 **Moment 저장소 불변**              | ✔                                                 |
| 자동재생 차단 · 늦은 `ENDED` · 빠른 연속 요청                                | ✔ 마지막 요청이 이긴다                            |
| 일반 재생 큐·다음·이전·ENDED 자동 전환에 `startSeconds` 가 섞이지 않음       | ✔                                                 |
| `playMoment` 전후로 어댑터 DOM 노드가 같다 (ADR 0002)                        | ✔ Fake 호스트 · 실제 `YT.Player`/iframe 1개       |
| Fake 와 실제 어댑터의 계약 일치                                              | ✔ 7개 시나리오를 둘에 같이 돌림                   |
| 앱 시작 복원 · 첫 실행 무쓰기 · 손상/미래 버전 보호 · 라이브러리 독립        | ✔ `tests/integration/moments-boot.spec.ts`        |

**변이 검사.** 18건을 심어 전부 실패로 잡혔다 (기준 194개 통과,
`youtube-adapter` + `playback-coordinator`).

| 심은 변이                              | 잡힌 테스트 |
| -------------------------------------- | ----------- |
| `position()` 영상 식별 판정 제거       | 4           |
| 준비 전 `position()` 이 `0`            | 5           |
| `seek` 이 잘못된 값도 적용             | 6           |
| 보류 요청의 `startSeconds` 유실        | 2           |
| 첫 영상의 `start` 파라미터 누락        | 1           |
| 준비 전 `seek` 을 플레이어에 보냄      | 2           |
| 유효하지 않은 `startSeconds` 를 그대로 | 4           |
| 같은 영상도 `seek` 대신 재적재         | 7           |
| Moment 재생의 가시성 가드 제거         | 2           |
| 현재 큐 안의 영상도 큐를 갈아치움      | 1           |
| 내림 제거                              | 2           |
| 유효하지 않은 위치를 그대로 캡처       | 3           |
| `seek` 뒤 오래된 `ENDED` 가드 제거     | 1           |
| 잘못된 Moment 검증 제거                | 6           |
| 플레이어 없음을 성공으로 보고          | 2           |
| 선택 목록 우선 제거                    | 1           |
| `seek` 뒤 `play` 생략                  | 2           |
| 일반 재생에 `startSeconds` 혼입        | 8           |

**실제 브라우저 검증 (Chromium 155 headless · 실제 YouTube IFrame API).**
프로젝트 소스의 어댑터를 그대로 import 하는 하네스를 돌렸다. **실제 `PLAYING`
을 관측했다** — 단, `--autoplay-policy=no-user-gesture-required` ·
`--mute-audio` 를 준 헤드리스다. 운영 사이트에서는 하지 않았다 (배포 없음).
표는 **ADR 0020 "실측 요약"**. 세 가정이 모두 확인됐다: `seekTo` 는 재생 중엔
BUFFERING → PLAYING 이고 일시정지 중엔 멈춘 채 유지 / `loadVideoById({
startSeconds: 60 })` 는 60 에서 PLAYING / 전환 직후 캐시가 비어 `position()` 은
`null`. 하나 더 보였다 — 새 영상이 지정 시점으로 가기 전 ~200ms 동안 `0` 을
보고한다. M9-4 TODO 로 적었다.

**M9-3 이 하지 않은 것** — 중요하다.

- UI 가 없다. `capturePosition()` · `playMoment()` 를 부르는 버튼·목록은 M9-4
- ⚠ **백업에 Moments 가 들어가지 않는다.** 통합은 M9-5 다. 그 전에 받은 백업
  파일에는 Moment 가 없다 — 소스 수준 테스트로 고정돼 있다
  (`moments-store.spec.ts` G)
- `PlayerSurface` 와 iframe 생성 방식은 바뀌지 않았다. 저장 스키마도 그대로다
- `playPlaylist` · `playTrack` 이 어댑터 없이 `ok: true` 를 돌려주는 기존 동작은
  건드리지 않았다 (ADR 0020 결정 13 의 TODO)

### M9-4. UI — 완료 (2026-11-10)

| #   | 작업                                                              | 결과                                                                     |
| --- | ----------------------------------------------------------------- | ------------------------------------------------------------------------ |
| 4.1 | `이 순간 저장` 버튼 — 시점 모르면 비활성                          | ✔ 자리는 **Moments 위젯 안** (설계안에서 벗어남, ADR 0021 결정 1 · 실측) |
| 4.2 | 메모 입력 — 누른 순간의 시점을 **고정해** 보여준다                | ✔ + 곡이 바뀌면 알리고 대상은 그대로                                     |
| 4.3 | Moments 위젯 — 3열의 빈 자리. 플레이리스트 위젯과 같은 펼침 방식  | ✔ 넓음: 3·4 행을 채우고 안에서 스크롤 · 좁음: 플레이어 바로 아래 행      |
| 4.4 | 영상별 묶기 · 최근순 · 영상 안에서 시점 오름차순                  | ✔ + 지금 곡 강조 · `이 곡`/`전체`                                        |
| 4.5 | 표시 제목 3단 우선순위 (`MOMENTS_DESIGN.md` §1-1)                 | ✔ 라이브러리는 선택 목록 먼저                                            |
| 4.6 | `✎` 메모 수정 · `×` 삭제 (**확인을 거친다**)                      | ✔ 그 줄 바로 아래 인라인                                                 |
| 4.7 | 두 테마 토큰만 사용. 새 치수·새 색을 만들지 않는다                | ✔ 토큰 추가 0 — 플레이리스트 위젯의 치수 토큰을 그대로 씀                |
| 4.8 | (더함) 200ms 가짜 0초 차단 — `hasStartedPlaying` 을 store 로 옮김 | ✔ 버튼과 `capturePosition()` 이 같은 `isPositionReliable` 을 본다        |

구조와 규칙은 `MOMENTS_DESIGN.md` §9, 결정과 실측은 **ADR 0021**.

**테스트 기준 — 실행 결과**

| 기준                                                                   | 결과                                            |
| ---------------------------------------------------------------------- | ----------------------------------------------- |
| 메모를 쓰는 동안 재생이 흘러가도 **저장되는 초가 변하지 않는다**       | ✔ (Fake) · ✔ 실측 4.47~4.55초 → 4초             |
| 곡 전환 중의 가짜 0초로 저장할 수 없다 · 확인된 0초는 저장된다         | ✔ (Fake) · ✔ 실측 — 아래                        |
| 메모 중 곡이 바뀌어도 누른 곡·시점에 저장한다                          | ✔                                               |
| 메모 500자 · 넘기면 저장 막음                                          | ✔ 저장·수정 둘 다                               |
| 제목 우선순위 3단이 전부 동작한다 (라이브러리 있음 / 없음 / 빈 스냅샷) | ✔ + 트랙 이름 변경을 따라감                     |
| 삭제가 **확인 없이는 일어나지 않는다** · 그 순간만 지운다              | ✔ 라이브러리 원문 불변                          |
| 저장 실패 · protected · unavailable 을 성공처럼 보이지 않는다          | ✔ 이유와 "새로고침하면 사라짐" 을 함께          |
| Moment 재생 — 같은 곡 seek · 다른 곡 `startSeconds` · 지운 곡 단일 큐  | ✔ (Fake) · ✔ 실측                               |
| 가려진 플레이어 · 시트 · 플레이어 없음                                 | ✔ 다른 재생과 같은 문구 · 시트는 비켜준 뒤 재생 |
| 없는 기능의 버튼이 없다 (M8 의 가드 테스트를 확장)                     | ✔ 전부 지우기·시점 편집·복구·내보내기 없음      |
| 메모는 일반 텍스트 — HTML 로 해석하지 않는다                           | ✔ `<b>`·`<img onerror>` 가 글자로               |
| 테마 전환 · 드로어 · 재생을 거쳐도 플레이어 DOM 하나                   | ✔ (Fake) · ✔ 실측 iframe 1개                    |
| 두 테마에서 가로 넘침이 없다 — **모든 요소의 `scrollWidth`** 를 훑는다 | ✔ 8개 폭 × 2 테마, 폼을 연 상태 5개 폭          |

**변이 검사.** 15건을 심어 전부 실패로 잡혔다 (기준 235개 통과).

| 심은 변이                         | 잡힌 테스트 |
| --------------------------------- | ----------- |
| 저장 버튼이 재생 시작을 보지 않음 | 3           |
| 캡처가 재생 시작을 보지 않음      | 6           |
| 신뢰 판정에서 재생 시작 조건 제거 | 6           |
| 저장할 때 지금 곡으로 대상을 바꿈 | 1           |
| 500자 검사 제거                   | 1           |
| 확인 없이 삭제                    | 5           |
| 저장 안 됨을 성공으로 알림        | 3           |
| 묶음을 오래된 순으로              | 5           |
| 제목 1단(라이브러리) 무시         | 3           |
| 재생 전 시트 비키기 생략          | 1           |
| 넓은 화면 `contain: size` 제거    | 1           |
| 메모를 HTML 로 그림               | 2           |
| `이 곡` 거르기 무시               | 1           |
| 곡이 바뀌어도 알리지 않음         | 1           |
| 같은 시점 순간을 합침             | 3           |

**실제 브라우저 검증 (Chromium 155 headless · 실제 YouTube IFrame API · 실제
마우스 클릭 · 자동재생 우회 플래그 없음).** 격리 프로필, 검증용 시드만 썼다.
iframe 안의 `<video>` 는 CDP 로 그 프레임에 붙어 읽었다 — 앱 코드는 읽지 못한다.
**실제 `PLAYING` 을 관측했다.** 운영 사이트(39page.com)에서는 하지 않았다 — 배포하지 않았다.

| 확인                                                 | 결과                                                                          |
| ---------------------------------------------------- | ----------------------------------------------------------------------------- |
| A 재생 — 버튼은 `<video>` 가 실제로 재생될 때 켜진다 | ✔ `t=0 paused` 동안 꺼짐 → `t=0.01 재생` 과 함께 켜짐                         |
| 저장 — 누른 순간의 초                                | ✔ 4.47~4.55초에 눌러 **4초** 저장. 메모 쓴 2초가 더해지지 않음                |
| **B 전환 창**                                        | ✔ 앱은 아직 A 의 `재생 중`, iframe 은 **B·0초·정지**(표본 5) — 버튼 전부 꺼짐 |
| 다른 곡의 Moment ▶                                   | ✔ A 가 **4.02초**부터 재생                                                    |
| 같은 곡의 Moment ▶                                   | ✔ 7.34초 → **4초**로 이동, iframe 1개 · 플레이어 루트 그대로                  |
| 테마 전환                                            | ✔ 목록 2줄 · iframe 그대로 · 재생 4→4.75초 이어짐                             |
| 새로고침                                             | ✔ 2줄 복원                                                                    |
| 390px · 시트가 하단 557px 를 덮은 상태에서 Moment ▶  | ✔ 시트가 먼저 닫힘 → 플레이어를 화면 안(336×200)으로 → B 61초부터 재생        |
| 폼을 연 상태 360 · 390 · 1101 · 1280 · 1440px        | ✔ 가로 넘침 0 · 저장 버튼에 실제로 닿음                                       |
| 폼을 열기 전/후 (1101 · 1280 · 1440px)               | ✔ 호스트 바닥·플레이리스트·마스코트·위젯 높이 **모두 같음**                   |

**넘침 훑기에서 함께 보인 것 — M9-4 이전부터 있던 것.** 390·360px 에서
플레이리스트 위젯 머리말(`PLAYLISTS` + `＋ 새 목록`)이 반 칸보다 14~29px 넓고,
데크 안내·360px 날씨도 넘친다(1101px 데크 안내 +4). **기준 빌드(`97af2fe`)와
목록이 같다** — Moments 가 더한 넘침은 0 이다. 문서 루트의 가로 스크롤은 0
(워크스페이스가 잘라낸다). 이번 범위가 아니라 고치지 않았다.
TODO: 좁은 화면의 플레이리스트 위젯 머리말 넘침 (M9-4 이전부터).

**M9-4 가 하지 않은 것** — 중요하다.

- ⚠ **백업에 Moments 가 들어가지 않는다.** 통합은 M9-5 다. M9-4 부터는 사용자가
  화면에서 Moment 를 만들 수 있으므로, **M9-5 전에 운영에 배포하지 않는다.**
  그 전에 받은 백업 파일에는 Moment 가 없다 — 소스 수준 테스트로 고정돼 있다
  (`moments-store.spec.ts` G)
- Android Chrome · iOS Safari 실기기 확인 없음 (에뮬레이션 360·390px 만)
- `PlayerSurface` · iframe 생성 방식 · 저장 스키마 · 저장 키는 바뀌지 않았다

### M9-5. 백업 통합 — 완료 (2026-11-10)

**이 단계가 M9 호환성의 완료 조건이다.**

| #   | 작업                                                                       | 결과                                                             |
| --- | -------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| 5.1 | `BACKUP_SECTION_VERSIONS.moments` — store 에서 가져온다 (상수 재선언 금지) | ✔ `MOMENTS_STORAGE_VERSION`                                      |
| 5.2 | 내보내기가 `data.moments` 를 **항상** 넣는다 (0개여도 `[]`)                | ✔ `BackupSource.moments` 가 **필수 타입** — 빠뜨리면 컴파일 오류 |
| 5.3 | 가져오기 — **섹션 없음 ≠ 빈 섹션** (`BACKUP_FORMAT.md` §6-2)               | ✔ `momentsSection: absent · skipped · present`                   |
| 5.4 | 미리보기에 Moments 줄 — `교체 N → M` 또는 `유지 (파일에 없음)`             | ✔ 표 · 섹션 줄 · 교체 목록("모두 지워집니다")                    |
| 5.5 | M8 파일을 읽을 때 **"이 파일은 Moments 가 생기기 전 것"** 안내             | ✔ `moments-section-absent` 경고                                  |
| 5.6 | 미래 섹션 버전은 건너뛰고 **기존 Moments 를 유지**한다                     | ✔                                                                |
| 5.7 | `schemaVersion` 은 **1 그대로.** 올리지 않는다                             | ✔                                                                |
| 5.8 | (더함) 섹션별 온전성 `integrity.moments` · 섹션별 결과 · 보호 원본 원문    | ✔ `BACKUP_FORMAT.md` §6-4                                        |

구현에서 정한 것은 `BACKUP_FORMAT.md` §6-4 와 ADR 0018 개정 (M9-5) 에 모았다.
요점: 쓰는 순서는 플레이리스트 → Moments → 테마, **플레이리스트 저장이 실패하면
Moments 는 보류**, Moments 만 교체하면 재생을 멈추지 않는다, 버린 Moment 는
**이유별로** 센다(`normalizeMomentsData` 가 — 새 규칙 없음).

**테스트 기준 — 실행 결과** (`tests/unit/backup-moments.spec.ts` 45개 + 기존 갱신)

| 기준                                                                     | 결과                                         |
| ------------------------------------------------------------------------ | -------------------------------------------- |
| M8 고정 파일(`backup-v1.json`)을 가져와도 **Moments 가 그대로 남는다**   | ✔ 원문까지 그대로 · 새로고침 뒤에도          |
| 빈 섹션 `[]` 은 **0개로 교체한다**                                       | ✔                                            |
| 왕복: 내보내기 → 가져오기에서 id·순서·초·메모가 보존된다                 | ✔ 다른 기기(빈 저장소)로 옮겨도 같다         |
| Moments 가 0개여도 파일에 `data.moments` 가 **있다**                     | ✔                                            |
| 미래 `version` 섹션은 건너뛰고 기존 Moments 를 **지우지 않는다**         | ✔ "일부만 복원" 으로 보고                    |
| 라이브러리에 없는 `videoId` 의 Moment 를 **버리지 않는다**               | ✔                                            |
| `schemaVersion` 이 **1 이다**                                            | ✔                                            |
| 라이브러리 복원 실패 시 Moments 도 **쓰지 않는다**                       | ✔ 보류 → "다시 저장 시도" 에서 순서대로 반영 |
| 승인 전 `setItem` 0회 · 취소해도 불변                                    | ✔                                            |
| 다른 탭이 Moments 를 바꾸면 낡은 승인을 막는다                           | ✔ 지문에 원문 포함                           |
| Moments 만 저장 실패 → 화면 반영 · 저장소 불변 · 새로고침 뒤 실제 상태   | ✔ 새 플레이리스트 + 옛 Moments               |
| 보호된 Moments 원본 — 옛 파일엔 보존, 새 파일엔 알리고 교체, 원문 꺼내기 | ✔ 접근 불가면 막음                           |
| Moments 만 교체하면 재생·라이브러리 불변                                 | ✔                                            |
| M10 입구(`addMoments`)로 들어온 Moment 도 같은 검증·백업 경로            | ✔                                            |

새 고정 파일 `tests/fixtures/backup-v1-moments.json` 을 더했다. `backup-v1.json`
은 **바꾸지 않았다.** 그 파일을 읽은 결과의 단정 하나만 의도적으로 바뀌었다 —
경고가 0개에서 `moments-section-absent` 1개로.

**변이 검사.** 12건을 심어 전부 실패로 잡혔다 (기준 205개 통과).

| 심은 변이                                | 잡힌 테스트 |
| ---------------------------------------- | ----------- |
| 섹션 없음을 빈 배열로 읽음               | 9           |
| 미래 버전도 그대로 읽음                  | 4           |
| 검증 없이 섹션 데이터를 받음             | 3           |
| 배열 아닌 섹션을 0개로 읽음              | 1           |
| 0개면 섹션을 빼고 내보냄                 | 5           |
| 플레이리스트 저장 실패에도 Moments 를 씀 | 1           |
| 지문에 Moments 원문 빠짐                 | 1           |
| Moments 저장 실패를 저장됨으로 보고      | 1           |
| 보호된 Moments 차단 조건 제거            | 1           |
| Moments 만 교체해도 재생을 멈춤          | 1           |
| 내보내기가 Moments 보호 상태를 무시      | 1           |
| 유지(kept)를 실패로 셈                   | 1           |

### M9-6. 통합 검증과 안정화 — 완료 (2026-11-10)

계획대로 다섯 관문 · 실제 Chromium · 두 테마 × 여러 폭 · iframe 영속성을 봤다.
여기에 **대용량 성능**과 **배포 전 인프라 재확인**을 더했다. M8 과 같은 금지를
지켰다 — 검증을 지우거나 약화하지 않았고, 저장 키·`schemaVersion`·디자인
레퍼런스를 바꾸지 않았다.

**실측 환경.** 이 기기(Android · Termux)의 headless Chromium 155, 격리
프로필, **자동재생 허용 플래그 없이** 실제 마우스 이벤트로 눌렀다. YouTube 는
진짜 iframe 이고, 재생 여부는 iframe 안의 `<video>.currentTime` 과
`getVideoData().video_id` 로 읽었다 (테스트 더블이 아니다).

#### 1. 시나리오 (실제 Chromium · 실제 YouTube)

| #     | 시나리오                                                            | 결과 |
| ----- | ------------------------------------------------------------------- | ---- |
| 1     | UI 로 목록을 만들고 링크 둘을 넣어 재생                             | ✔    |
| 2     | 재생 중 "＋ 이 순간 저장" — 누른 순간의 초 (2.81–2.99 → 2)          | ✔    |
| 3     | 메모 추가·수정(생성 시각 불변)·삭제(확인 거침)                      | ✔    |
| 4     | 한 영상에 Moment 여러 개 — 한 묶음, 시점 오름차순                   | ✔    |
| 5     | 같은 영상: 그 시점으로 이동 (11.57 → 2.02), iframe 그대로           | ✔    |
| 6     | 다른 영상의 Moment → 그 영상이 그 시점부터                          | ✔    |
| 7     | 트랙을 지워도 Moment 가 남고 "목록에 없음" 표시, 그 시점부터 재생   | ✔ ¹  |
| 8     | 테마 전환 — 목록·iframe·재생 그대로 (같은 iframe, 2→2.97 계속)      | ✔    |
| 9     | 390px: 재생 중 시트를 열면 멈춤 → 시트 위 Moment ▶ → 시트 닫고 재생 | ✔ ²  |
| 10    | 새로고침 뒤 Moments 복원                                            | ✔    |
| 11    | 내보내기 — 플레이리스트·테마·Moments 가 한 파일에                   | ✔    |
| 12–14 | 데이터 변경 → 가져오기 → 미리보기·취소(저장소 불변) → 승인(3섹션)   | ✔    |
| 15    | 옛 백업(M8) 복원 — "Moments 이전 파일" 안내, Moments 원문 그대로    | ✔    |
| 16    | 부분 복구 원본 — 배너, 복구본 내보내기, 원문 보존·원문 꺼내기       | ✔    |

¹ 처음 단정이 틀렸다. 지운 곡이 **아직 지금 큐에 있으면** 그 큐 안에서 재생한다
(2/2) — ADR 0020 결정 9 의 설계 그대로다. 큐에도 라이브러리에도 없을 때만
그 한 곡(1/1)으로 재생하는 것을 따로 확인했다.
² 처음엔 B 를 61초부터 재생하는 데서 YouTube "오류 5" 가 났다. 앱 밖의 맨
임베드(`/embed/…?start=61`)도 같은 영상을 61·120초에서 재생하지 못하고 2·30초는
재생했다 — 이 환경과 YouTube 쪽의 사정이다. 30초로 바꿔 시트 동작을 확인했다.
앱은 그 오류를 "이 브라우저의 플레이어에서 재생할 수 없는 영상이에요 (오류 5)"
로 정확히 알렸다.

#### 2. 데이터 보호 — 새로고침 뒤 실제로 남는 것

| 상황                                    | 화면                                   | 새로고침 뒤                          |
| --------------------------------------- | -------------------------------------- | ------------------------------------ |
| Moment 저장 중 쓰기 실패 (할당량)       | 4줄 + "저장하지 못했어요" 안내         | 3줄 — 안내대로 사라짐                |
| 복원에서 Moments 만 저장 실패           | 섹션별 결과 · "일부만 복원했습니다"    | 새 플레이리스트 + **옛 Moments**     |
| 미리보기 뒤 다른 탭이 Moments 를 바꿈   | 낡은 승인 거부                         | —                                    |
| 다른 탭의 변경 (한계)                   | 이 탭 목록은 모른다 (3줄 / 저장소 1개) | 저장소의 것                          |
| 구형 빌드(M8, 운영 중)가 M9 파일을 읽음 | "다루지 않는 항목: moments" 로 알림    | 라이브러리 복원, Moments 원문 그대로 |
| 구형 빌드가 내보낸 파일을 M9 가 읽음    | "Moments 가 생기기 전 파일" 안내       | 지금 Moments 유지                    |

다른 탭 변경을 실시간으로 반영하지 않는 것은 라이브러리와 같은 기존 한계다
(`storage` 이벤트를 듣지 않는다). 쓰기 전에 지문으로 막으므로 덮어쓰지는 않는다.
구형 빌드가 내보낸 파일에 Moments 가 없는 것은 **막을 수 없는 알려진 위험**이다
— 운영(M8)에서 내보낸 파일로는 Moment 를 옮길 수 없다.

#### 3. 두 테마 × 반응형 — 163/163

Mono Vinyl · Kawaii Synth Cassette × 1440 · 1101 · 1100 · 768 · 500 · 390 · 360
에서, 한 페이지의 폭만 바꿔 가며 (재생 중) 확인했다. 시드에 60자 줄바꿈 없는
목록 이름, 100자 줄바꿈 없는 트랙 제목, 300자 줄바꿈 없는 메모, 여러 줄 메모,
HTML 처럼 보이는 메모, Moment 35개를 넣었다.

- 모든 요소의 가로 넘침(안쪽 스크롤 상자 포함)과 화면 밖으로 나간 요소
- Moments 목록의 세로 스크롤, `이 곡` / `전체` 필터
- 긴 제목·메모의 말줄임과 ✎ × 가 줄 안에 남는지
- 저장 폼(긴 메모 입력) · 인라인 수정 · 삭제 확인 · 취소가 저장소를 바꾸지 않음
- 드로어(시트)를 실제로 열고 닫기(×를 실제로 누름)
- 각 폭에서 **같은 iframe**·같은 영상·200×200 이상
- 키보드: Tab 이 ▶ · ✎ · × 를 차례로 지나고 각 정지점에 링이 보이며 화면·목록
  안으로 스크롤된다 (1440 · 390)

LP 열기 툴팁(`OPEN PLAYLISTS ↗`)은 원형 버튼보다 넓어 360·390·1101px 에서
버튼 밖으로 나가지만 **데크와 화면 안**에 있다 — hover/focus 때만 보이는 의도된
모양이다.

**고친 기존 결함 3건** (모두 M9 이전부터 있었다). 세 컴포넌트는 운영(M8,
`8377c83`) 이후 바뀌지 않았고, 드로어 결함은 운영 빌드에서 같은 수치로 재현했다.
머리말 넘침은 M9-4 측정에서 M9-4 이전 빌드와 같음을 확인했다:

| 결함                                                                                                            | 원인                                                     | 고침                                                                        |
| --------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- | --------------------------------------------------------------------------- |
| 360·390px 플레이리스트 머리말 `＋ 새 목록` 이 29·14px 넘침                                                      | 반 칸(144·159px) < `PLAYLISTS` + 버튼                    | 정말 안 들어갈 때만 버튼이 아래로 (`flex-wrap` + 기준 폭 0)                 |
| 360px 날씨 최고·최저가 12px 넘침, 360·390px 설명이 몇 px 로 눌려 말줄임표 조각만 보임                           | 반 칸(144·159px) < 아이콘 + 기온 + 설명 + 최고·최저      | 650px 이하에서만 같은 방식으로 줄 나눔 · 설명 최소 2.5em — 높이 66px 그대로 |
| 긴 목록 이름·트랙 제목이 드로어를 넓힘 — 390px 에서 닫기(×)가 화면 밖 550px, 1440px 에서 화면 전체가 206px 밀림 | 말줄임 상자에 `min-width: 0` 없음, 트랙 목록의 `auto` 열 | 머리말 글 상자 `min-width: 0`, 목록 열 `minmax(0, 1fr)`                     |

세 번째가 가장 크다. 이름에 공백이 있어도 `nowrap` 이라 같다 — 47자 정도의 평범한
영어 목록 이름이면 생긴다. 고친 뒤 같은 시드에서 넘침 0, 닫기가 화면 안이다.
jsdom 은 레이아웃을 하지 않으므로 해법의 조건을 소스 테스트로 고정했다.

#### 4. 대용량 성능

**이 기기는 느리다.** 앱 없이 빈 페이지에 같은 모양의 행 1000개를 처음 배치하는
데 1.09초가 걸린다(200개 0.24초). 아래 수치는 그 기준으로 읽는다.

데이터 처리(실제 소스 함수를 Node 에서 · 중앙값):

| 개수   | 복원(파싱+검증) | 저장(직렬화) | 묶기  | 내보내기 | 가져오기(읽기+검증) | 파일     |
| ------ | --------------- | ------------ | ----- | -------- | ------------------- | -------- |
| 1,000  | 3.3ms           | 1.7ms        | 2.3ms | 3.5ms    | 4.1ms               | 401 KB   |
| 5,000  | 16.5ms          | 10.4ms       | 7ms   | 15.6ms   | 18.9ms              | 1.9 MB   |
| 20,000 | 69ms            | 47ms         | 17ms  | 65ms     | 77ms                | 7.4 MB ³ |

³ 8 MB 가져오기 상한 안이다. 저장소는 이 기기의 Chromium 에서 2만 개(4.88M 자)까지
들어갔고, 그 위는 M9-2 의 쓰기 실패 처리(메모리 유지·안내)로 간다.

화면(실제 Chromium · 1440px) — **데이터 처리는 병목이 아니다. 행 배치가 병목이다.**

| 동작 (1000개)                                  | 고치기 전                           | 고친 뒤                            |
| ---------------------------------------------- | ----------------------------------- | ---------------------------------- |
| 삭제 확인 열기 / 확인 / 메모 수정 열기         | 615 / 664 / 675ms (레이아웃 ~430ms) | 253 / 356 / 276ms (레이아웃 ~13ms) |
| 삭제 (확인 포함)                               | 1,061ms                             | 407ms                              |
| 가져오기 적용                                  | 876ms                               | 397ms                              |
| `전체` 로 되돌리기 · 저장 후 목록 복귀         | 2.0–3.0s / 1.5–1.8s                 | 같다 (아래)                        |
| (200개) 삭제 확인 열기 / 확인 / 메모 수정 열기 | 188 / 211 / 202ms                   | 31 / 50 / 42ms                     |

이 기기는 같은 측정을 되풀이해도 30–50% 흔들린다. 표는 한 번씩 잰 값이고, 고친
뒤가 줄어든 근거는 **레이아웃 시간**(Chromium `Performance.getMetrics`)이다.

원인은 목록 상자의 `overflow-y: auto` 였다. 스크롤바가 폭을 차지하는 환경
(Windows·Linux 데스크톱 Chrome)에서는 한 줄만 바뀌어도 "스크롤바가 필요한가" 를
정하려고 **목록 전체를 다시 배치**했다. `scrollbar-gutter: stable` 로 자리를
고정해 바뀐 줄만 배치하게 했다 — 한 줄 변경 550–700ms → 10ms. 스크롤바가 겹치는
390px 모바일 에뮬레이션에서는 처음부터 8ms 였다. Android · iOS 도 스크롤바가
겹치므로 같을 것으로 보지만 **실기기로 재지는 않았다.** 배치 모델을 바꾸는
것(flex·block·`contain`)은 효과가 없거나 나빴다.

**남은 비용은 행 수에 비례한다.** `전체` 로 되돌리거나 저장 폼을 닫아 목록을 다시
보일 때 1000행을 처음부터 배치한다 — 이 기기의 빈 페이지 기준치와 같은 크기다.
200개에서는 0.5–0.8초, 35개에서는 0.1–0.2초였다. `content-visibility: auto` 는
비용을 없앴지만 **화면 밖 행의 크기를 추정**하므로 스크롤·포커스 이동 뒤 줄이
37px 밀려 다른 줄을 누르게 됐다 — 들이지 않았다. 수천 개 규모가 실제로 생기면
가상 스크롤이 필요하다 (TODO, 아래).

5,000개 이상을 실제 브라우저로 그리는 측정은 **하지 못했다.** 이 기기에서 그
페이지(약 15만 노드)를 띄우는 중에 세션이 두 번 종료됐다 — 메모리 압박으로
보인다. 데이터 처리 수치는 위 표대로 있다.

#### 5. 배포 전 인프라 재확인 (읽기만 · Cloudflare 설정 변경 없음)

| 확인                 | 결과 (2026-11-10)                           |
| -------------------- | ------------------------------------------- |
| `https://39page.com` | 200 · Cloudflare · HSTS 헤더 없음           |
| `http://39page.com`  | **200, 리다이렉트 없음** — 그대로           |
| `www.39page.com`     | **NXDOMAIN** (DoH 로 확인) — 그대로         |
| 운영 번들            | `index-_5ud30QU.js` — M8 (`8377c83`) 그대로 |

`DEPLOYMENT.md` §4 가 아직 남았다. M9 이후 이 문제는 더 커진다 — `http` 와
`https` 는 다른 저장소이므로 **Moments 도 둘로 갈린다.**

#### 6. 실기기 — 미검증

Android Chrome · iOS Safari 실기기에서 **확인하지 않았다.** 위의 390px 결과는
데스크톱 Chromium 의 모바일 에뮬레이션이다. 터치 · 실제 화면 회전 · iOS 의
자동재생 정책 · 겹치는 스크롤바에서의 실제 체감은 실기기에서만 확인된다.

#### 남긴 TODO

- [ ] **실기기 확인** — Android Chrome · iOS Safari (위 §6)
- [ ] **`DEPLOYMENT.md` §4** — `http → https` 강제, `www` 레코드와 리다이렉트
- [ ] Moments 가 수천 개일 때의 **가상 스크롤** — 지금은 1000개에서 목록 전체를
      다시 보일 때 이 기기 기준 2–3초
- [ ] 다른 탭의 변경을 실시간 반영 (`storage` 이벤트) — 라이브러리와 함께

### M9 완료 조건 — 전부 충족 ✔ (실기기 확인 제외)

| #   | 조건                                                                   | 결과                                                                       |
| --- | ---------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| 1   | F13–F17 이 **실제로 동작한다** (스텁·목업 아님)                        | **✔** M9-6 실제 Chromium · 실제 YouTube 시나리오 1–16                      |
| 2   | 트랙·플레이리스트를 지워도 Moment 가 남는 것을 테스트가 고정한다       | **✔ M9-2** + M9-3 · M9-6 지운 영상의 Moment 재생                           |
| 3   | **M9 이전 백업을 복원해도 Moments 가 지워지지 않는다**                 | **✔ M9-5** — 원문까지 그대로 · M9-6 브라우저 확인                          |
| 4   | **내보내기와 가져오기 양쪽**이 바뀌고, 호환성 안내가 사용자에게 보인다 | **✔ M9-5** — M9-6 에서 운영 중인 M8 빌드와 양방향 확인                     |
| 5   | 기존 라이브러리 데이터의 마이그레이션·손상이 **없다**                  | **✔** 키·스키마 불변                                                       |
| 6   | `schemaVersion` 이 1 그대로다                                          | **✔** 백업 미변경                                                          |
| 7   | iframe 재생성이 없다                                                   | **✔** M9-3 · M9-4 · M9-6 — 저장·재생·테마 전환·7개 폭 전환에도 같은 iframe |
| 8   | 다섯 관문 통과 · 기존 테스트를 지우거나 약화하지 않았다                | **✔ M9-2 ~ M9-6**                                                          |

3·4 번이 **M9 호환성의 핵심**이고 M9-5 에서 둘 다 채웠다. M9-2 ~ M9-4 동안
"백업에 Moments 가 아직 없다" 를 고정하던 소스 테스트는 M9-5 에서 반대 —
"두 내보내기 경로가 모두 Moments 를 담는다" — 로 바꿨다.

### M9 Release — 운영 배포 완료 (2026-11-11)

> **갱신 (2026-11-11, Batch 2)**: 사용자가 Cloudflare §4 를 설정한 것을 확인하고
> `main` 을 푸시했다 (`8377c83..5478923`). 배포본이 로컬 빌드와 바이트 동일하고,
> 운영 스모크 테스트 44항목이 통과했다 — 기록은 `DEPLOYMENT.md` §5
> "M9 운영 배포". 실기기는 미검증. 아래는 처음 점검 때(보류)의 기록이다.

#### 처음 점검 — 보류 (2026-11-11, Batch 1)

**푸시하지 않았다.** 운영은 M8 그대로다. 기록과 사용자 조치 순서는
[`DEPLOYMENT.md`](DEPLOYMENT.md) §4-0 · §4-1 · §5 "M9 Release 점검" 이다.

| 확인                    | 결과                                                                                                      |
| ----------------------- | --------------------------------------------------------------------------------------------------------- |
| 다섯 관문 (`8d8a7d5`)   | ✔ 전부 EXIT 0 · 42 파일 · 1629 테스트. 빌드가 M9-6 검증 빌드와 바이트 동일                                |
| `http` → `https`        | ✖ 200, 리다이렉트 없음 · HSTS 없음                                                                        |
| `www`                   | ✖ NXDOMAIN. 인증서는 이미 `*.39page.com` 을 덮는다                                                        |
| Cloudflare 설정         | **바꾸지 않았다** — 이 환경에 대시보드 권한이 없다. 지시대로 우회하지 않고 보류                           |
| `http` 저장 데이터 보호 | 검토·기록 (§4-0). 권장: 수동 이전(백업 내보내기 → 가져오기) 후 리다이렉트. HSTS 는 이전 기간 뒤 별도 결정 |
| 운영 스모크 테스트      | **미수행** — M9 가 운영에 없다. 체크리스트를 §5 에 남겼다                                                 |
| 실기기                  | **미검증** (Android Chrome · iOS Safari)                                                                  |

배포 보류는 **코드 결함 때문이 아니다.** §4 전에 배포하면 Moments 가 두
origin 으로 새로 갈리는 것을 피하려는 순서 문제다.

- [ ] (사용자) `DEPLOYMENT.md` §4-0 1단계 → §4-1 → §5 `curl` → `git push origin main`
- [ ] 배포 후 운영 스모크 테스트 (§5 체크리스트) · 실기기 확인

---

## M10 — Chrome 확장을 통한 음악·Moment 수집

> 설계: [`../architecture/EXTENSION_DESIGN.md`](../architecture/EXTENSION_DESIGN.md) ·
> ADR [0022](../decisions/0022-extension-repository-and-build.md) (저장소·빌드) ·
> ADR [0023](../decisions/0023-extension-webapp-communication.md) (웹앱 통신·권한·보안)
>
> **브랜치**: M10 커밋은 로컬 브랜치 `m10-extension` 에 둔다. `main` 푸시가 곧
> 운영 배포이므로, M9 운영 배포(보류 중)와 섞이지 않게 한다.

가장 중요한 사용자 문제: **YouTube 에서 찾은 음악을 39page 에 넣으려면 링크를
복사해 붙여 넣어야 한다.** 첫 목표는 Quick Add, 두 번째는 Moment 캡처다.

| 단계      | 범위                                                                           | 상태                              |
| --------- | ------------------------------------------------------------------------------ | --------------------------------- |
| **M10-1** | 아키텍처·통신 방식·계약·권한 설계                                              | 완료 (2026-11-11)                 |
| **M10-2** | `extension/` 골격 — MV3 · Popup · Background · Content · 메시지 · YouTube 인식 | 완료 (2026-11-11)                 |
| **M10-3** | Quick Add — 웹앱 수집 화면 + 탭 간 덮어쓰기 해결                               | 진행 — 3A · 3B 구현, 3C 통합 검증 |
| M10-4     | Moment 캡처 — 재생 시점 · 메모                                                 | 예정                              |
| M10-5     | 단축키 · 추가 UX (B 방식 재검토)                                               | 예정                              |
| M10-6     | Chrome Web Store 배포 준비                                                     | 예정                              |

### M10-1. 설계 — 완료 (2026-11-11)

**범위**: 저장소 구조, 실행 영역 책임, 지원 범위(일반·Shorts·SPA·YouTube Music),
웹앱 통신 방식 비교와 결정, 메시지·데이터 계약, 권한·보안 정책, M10 전체 계획.
코드 없음.

| 완료 기준                                                                                          | 결과                                                |
| -------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| 메시지 방향을 공식 API 문서로 확인 (`runtime` · `tabs` · `postMessage` · `externally_connectable`) | ✔ `EXTENSION_DESIGN.md` §4 · ADR 0023 표            |
| A · B · C 를 보안·난이도·확장성·UX 로 비교하고 MVP 결정                                            | ✔ **A** (수집 화면 URL + 웹앱 승인)                 |
| 계약 — 타입 · 버전 · 실패 응답 · 중복                                                              | ✔ 수집 URL v1 · 내부 메시지 v1 · 오류 코드 8개 · §9 |
| 권한 최소화                                                                                        | ✔ `activeTab` · `scripting` (M10-3 에 `storage`)    |
| 웹앱 빌드 격리 방식                                                                                | ✔ ADR 0022 §5                                       |

**설계 중 발견한 것 — M10-3 의 선행 조건**: 라이브러리 store 는 다른 탭의
변경을 확인하지 않고 메모리 상태 전체를 쓴다(코드 확인). Quick Add 가 새 탭에서
트랙을 추가하면 열려 있던 대시보드 탭의 다음 변경이 그것을 지운다
(ADR 0023 결정 4).

### M10-2. 확장 골격 — 완료 (2026-11-11)

**범위**: `extension/` 독립 프로젝트 · Manifest V3 · Vue 3 Popup(Mono Vinyl
디자인 언어) · Background 서비스 워커(메시지 라우터) · 주입형 Content script ·
메시지 계약 v1 과 검증 · YouTube 페이지 인식(`videoId` · 제목) · 지원하지 않는
페이지 안내. **웹앱에 아무것도 저장하지 않는다.** Quick Add 버튼은 만들지
않는다(준비 중 표시만).

| 완료 기준                                                                                                            |
| -------------------------------------------------------------------------------------------------------------------- |
| 확장 독립 관문 통과 — 타입 검사 · 단위 테스트 · 린트 · 포맷 · 빌드 · manifest 검증                                   |
| 실제 Chromium 에 압축해제 로드 · 팝업 표시 · 인식 · 안내 · 탭 이동 갱신 · 메시지 실패 처리 · 워커 재시작 · 오류 없음 |
| 웹앱 다섯 관문 그대로 통과 · 루트 빌드 산출물 SHA-256 동일                                                           |
| 확장의 판정이 웹앱 `parseYouTubeVideoId` 와 같은 ID 를 낸다 (호환성 테스트)                                          |

#### 결과

| 확인                       | 결과                                                                                                                                                                                 |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 확장 관문                  | type-check · test (**12 파일 · 222**) · lint · format:check · build(+ manifest 검사) 모두 EXIT 0                                                                                     |
| 변이 검사                  | **13/13** 잡힘 — 보낸 쪽 검사 · Music 허용 · 플레이어/제목 줄 ID 일치 · 메인 세계 · 제목 재확인 · 재주입 · `v-html` · 버튼 · 양방향 문자 · `tabs` 권한 · content 보낸 쪽 · 늦은 응답 |
| **실제 Chromium 155**      | **33/33** — 운영 manifest 그대로(호스트 권한 없음) · 실제 YouTube · CDP `Extensions.triggerAction` 으로 툴바 클릭(`activeTab` 부여)                                                  |
| 웹앱 다섯 관문 (이 브랜치) | type-check · test (**42 파일 · 1629**, M9 와 같다) · lint · format:check · build 모두 EXIT 0. 관문이 고친 파일 0                                                                     |
| 웹앱 빌드 격리             | 루트 `npm run build` 산출물 4개 파일의 SHA-256 이 M9(`8d8a7d5`) 빌드와 **동일**                                                                                                      |
| 새 의존성                  | `@types/chrome` 하나 (타입 전용, ADR 0022 §4). 나머지는 루트와 같은 패키지·버전                                                                                                      |

실제 Chromium 33 항목 (지시서 4절의 1–8):

| #   | 항목                    | 확인한 것                                                                                                                                                                                                 |
| --- | ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | 로드                    | `--load-extension` 으로 설치 · 켜짐 · `getManifest()` 권한 `activeTab`·`scripting` 만                                                                                                                     |
| 2   | 팝업                    | 브랜드 · 340px · 가로 넘침 0 · Quick Add 자리 "준비 중" · 누를 수 있는 것 0개                                                                                                                             |
| 3   | 일반 영상 · Shorts 인식 | 주소의 ID · 종류(영상 / Shorts)                                                                                                                                                                           |
| 4   | 지원하지 않는 페이지    | example.com · YouTube 홈 · YouTube Music · `chrome://version` (주소가 안 보여 "읽을 수 없습니다")                                                                                                         |
| 5   | ID · 제목               | 팝업 제목 = 플레이어 `getVideoData()` 제목, 출처 `player`                                                                                                                                                 |
| 6   | 메시지 · 실패 처리      | 수신자 없음 → 주입 1회 → 재질의 · 두 번째는 재주입 없음 · 실패 코드 5종 · content 직접 질의 · content 발신 거절 · 웹페이지에 확장 API 없음 · 실제 Chrome 오류 문구 2종이 분류기와 일치                    |
| 7   | 탭 이동 뒤 갱신         | SPA "다음 영상" (최종 빌드: ID 0.85초 · 제목 2.5초 뒤 갱신, **33회 표본 중 다른 영상 제목 0** — 앞선 두 실행 54 · 59회도 0) · 같은 사이트 전체 이동(재주입 1회) · 다른 사이트 이동(`activeTab` 회수 안내) |
| 8   | 오류                    | 서비스 워커 · 팝업 · content script 예외·콘솔 오류 0. 워커 종료 뒤 새 인스턴스가 같은 답                                                                                                                  |

**실측으로 바꾼 설계 두 가지** (`EXTENSION_DESIGN.md` §3-2 · §11, ADR 0023 보완):

1. **제목 출처** — 첫 실측에서 자동 재생이 다음 영상으로 넘어가는 순간 팝업이
   새 ID 에 **이전 영상의 제목**을 붙였다. 10ms 표본으로 보니 `document.title`
   이 주소보다 약 1초 늦었다. ID 와 제목을 한 객체로 주는 플레이어
   `getVideoData()` 를 메인 세계에서 읽도록 바꿨다 (권한 변화 없음).
   `document.title` · 탭 제목은 출처에서 뺐다. 고친 뒤 SPA 이동 표본에서 불일치 0.
2. **툴바 클릭** — M10-1 은 "헤드리스에서 누를 수 없다" 고 적었으나
   `Extensions.triggerAction` 이 `activeTab` 을 실제로 부여했다. 테스트 전용
   manifest 를 만들지 않았다.

**검증하지 못한 것**

- 사람이 누르는 실제 툴바 클릭 · 데스크톱 화면 (헤드리스 Chromium 155 에서 CDP 로 대신)
- 브랜드 Google Chrome (이 기기에는 Chromium 만 있다)
- 탭을 만들거나 이동한 직후 ~2초 안의 `triggerAction` 은 `activeTab` 을 부여하지
  않았다 — 실제 클릭에도 있는 지연인지 확인 못 함. 그때 팝업은 "다시 눌러 주세요" 로 안전하게 실패한다
- 웹앱 쪽 변경·저장 — 이 단계의 범위 밖 (M10-3)

**남긴 TODO**

- [ ] 아이콘 · `minimum_chrome_version` · 스토어 설명 (M10-6)
- [ ] YouTube Music 지원 여부 (M10-5)
- [ ] 모바일 브라우저 동작 확인 (M10-6)

**테스트 항목**: 메시지 검증(봉투·버전·타입·필드) · 페이지 판정 표 · 제목 정리
(알림 수·접미·제어 문자·길이·HTML 같은 문자열) · Background(수신자 없음 →
주입 → 재시도, 주입 실패, 플레이어 ID 일치, SPA 이동 직후 제목 없음, 탭 없음,
권한 없음, 시간 초과, 보낸 쪽 검사) · 메인 세계 함수의 자기 완결 ·
Content(응답·모르는 요청·중복 주입) · Popup(상태별 화면 · 같은 탭 이벤트만
반영 · 동작하는 척하는 버튼이 없다) · `@web/` import 허용 목록.

### M10-3. Quick Add (구현 — M10-3A 탭 간 정합성 · M10-3B 수집 화면과 Quick Add)

**범위**: (1) **탭 간 덮어쓰기 해결** — 라이브러리·Moments store 가 다른 탭의
변경을 반영하거나 낡은 쓰기를 거절한다. (2) 웹앱 수집 화면
`#collect?v=1&kind=track…` — 검증 · 플레이리스트 선택 · 승인 · `addTrack` ·
결과 표시 · 조각 삭제. 플레이어를 띄우지 않는다. (3) 확장 `collect/open` —
새 탭 · 중복 방지(`storage.session`) · Popup 버튼.

| 완료 기준                                                                              |
| -------------------------------------------------------------------------------------- |
| 승인(클릭) 없이 저장 0 — 위조·잘못된 링크(버전·종류·ID·길이·중복 필드)로 저장 0        |
| 대시보드 탭이 열린 채 Quick Add → 대시보드 탭에서 이어서 편집해도 추가한 트랙이 남는다 |
| 연속 클릭 · 같은 영상 5초 안 재요청 → 탭 하나 · 추가 한 번                             |
| 재생 중인 39page 탭이 새로고침되거나 재생이 끊기지 않는다                              |
| 기존 저장 키·스키마·백업 형식 불변. 웹앱 다섯 관문                                     |

### M10-4. Music Moment 캡처 (예정)

**범위**: content `player/position`(현재 시점) · 수집 URL `kind=moment&t=` ·
웹앱 확인 화면에서 메모 입력 · 기존 `createMoment` / `addMoments` 경로.
Shorts 제외. `live` 처리 결정.

| 완료 기준                                                           |
| ------------------------------------------------------------------- |
| 저장한 시점이 YouTube 의 실제 재생 위치와 ±1초 안 (실제 Chromium)   |
| Moment 검증·백업 경로가 웹앱에서 만든 Moment 와 같다                |
| 광고 재생 중 · 영상 로드 전 · 시점을 읽지 못함 → 저장하지 않고 안내 |

### M10-5. 단축키 · 추가 UX (예정)

**범위**: `commands`(`_execute_action` 등) · 열린 39page 탭에 넘기는 B 방식을
A 위에 얹을지 재검토 · YouTube Music 지원 여부.

| 완료 기준                                                    |
| ------------------------------------------------------------ |
| 단축키도 사용자 조작으로 `activeTab` 이 부여되는 경로만 쓴다 |
| 새 권한이 생기면 ADR 로 기록하고 설치 경고 변화를 보고한다   |

### M10-6. Chrome Web Store 배포 준비 (예정)

**범위**: 아이콘 · 설명 · 개인정보 고지(수집 없음) · 패키징 · 버전 정책 ·
`minimum_chrome_version`. 개발자 등록비 결제와 게시는 **사용자가 한다**.

| 완료 기준                                                                 |
| ------------------------------------------------------------------------- |
| 패키지에 소스맵·테스트·비밀 값이 없다                                     |
| 스토어 권한 설명이 manifest 와 일치한다                                   |
| Android Chrome 은 확장을 지원하지 않는다는 점을 안내에 적는다 — TODO 확인 |

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
| **내보내기·가져오기 UI 자리** (레퍼런스에 없음 — 규칙 6 확인 필요)                                  | **M8-2**  | `BACKUP_RESTORE.md` §5  |
| 라이브러리 내부 버전 2 의 마이그레이션 함수 모양                                                    | 필요 시   | ADR 0018 결정 6         |
| 드래그 라이브러리 (DOM 재배치 금지 제약)                                                            | 백로그    | `BACKLOG.md` §1         |

## 작업 방식

- 한 작업 단위는 하나의 M*n*-N 범위를 넘지 않는다.
- 동작 변경 시 테스트를 함께 수정한다 (`AGENTS.md` 규칙 7).
- 작업마다 변경 파일과 검증 결과를 보고한다 (`AGENTS.md` 규칙 10).
- 승인된 디자인 레퍼런스는 수정하지 않는다 (`AGENTS.md` 규칙 6).
