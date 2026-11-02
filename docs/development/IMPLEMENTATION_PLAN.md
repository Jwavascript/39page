# 구현 계획

> 상태: 개정 (M1 확정). 디자인 레퍼런스 검토 결과를 반영했다.
>
> 기준 문서: [`design/references/README.md`](../../design/references/README.md)

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
- [ ] **UI 구현 — 미착수 (의도적)**

---

## M1 — 앱 셸 · 테마 토큰 · 플레이어 영속성 골격

**목표**: 테마를 전환해도 YouTube 재생이 유지되는 **구조**를 세운다.

**왜 이것이 먼저인가**: 플레이어 iframe은 부모가 바뀌기만 해도 재로드된다
(`SYSTEM_DESIGN.md` §4). 이 제약을 만족하는 DOM 골격을 먼저 확정하지 않으면
테마와 재생을 나중에 양쪽 다 다시 써야 한다.

**M1에 포함하지 않는 것**: 플레이리스트 CRUD UI, Record Library 내용,
실제 날씨 API, 위젯 편집 UI. 레이아웃은 고정 상수다.

### M1-0. 선행 정리

| #   | 작업                                                                     | 산출물    |
| --- | ------------------------------------------------------------------------ | --------- |
| 0.1 | `src/themes/kawaii-cassette/` → `src/themes/kawaii-synth-cassette/` 개명 | 디렉터리  |
| 0.2 | 테마 키 확정 반영 (`mono-vinyl`, `kawaii-synth-cassette`)                | 문서 일치 |

### M1-1. 공유 타입과 저장 계층

| #   | 작업                                                     | 산출물                |
| --- | -------------------------------------------------------- | --------------------- |
| 1.1 | `Track`, `Playlist`, `ThemeKey`, `PlayerState` 타입 정의 | `src/shared/types/`   |
| 1.2 | YouTube URL → videoId 파서 (+ 단위 테스트)               | `src/shared/utils/`   |
| 1.3 | `defineStorage<T>` — 방어적 읽기, 안전한 쓰기, 버전 필드 | `src/shared/storage/` |
| 1.4 | 손상 데이터 복구 테스트                                  | `tests/unit/`         |

파서는 `MVP_SPEC.md` F4의 호스트·경로 목록을 모두 처리한다.
저장 계층은 프로토타입 `safeLoad` 패턴을 따른다 (`MVP_SPEC.md` F9).

### M1-2. 테마 토큰 체계

| #   | 작업                                                  | 산출물                                        |
| --- | ----------------------------------------------------- | --------------------------------------------- |
| 2.1 | 공유 토큰 (서체·포커스 링·반경·기하)                  | `src/styles/tokens.css`                       |
| 2.2 | 리셋 + body 기본 + `prefers-reduced-motion` 전역 처리 | `src/styles/base.css`                         |
| 2.3 | `mono-vinyl` 토큰 값                                  | `src/themes/mono-vinyl/tokens.css`            |
| 2.4 | `kawaii-synth-cassette` 토큰 값                       | `src/themes/kawaii-synth-cassette/tokens.css` |
| 2.5 | 테마 레지스트리 (키 → 메타데이터)                     | `src/themes/index.ts`                         |

`THEME_SYSTEM.md` §4의 토큰 표를 그대로 옮긴다. **값을 바꾸지 않는다** (규칙 6).
**선행 결정**: 토큰 이름 확정 (`THEME_SYSTEM.md` §4.2 TODO).

### M1-3. 테마 store와 전환

| #   | 작업                                                 | 산출물                |
| --- | ---------------------------------------------------- | --------------------- |
| 3.1 | `theme` store — 키 보유, 전환, 영속화                | `src/stores/theme.ts` |
| 3.2 | 루트 `data-theme` 속성 동기화                        | `src/app/`            |
| 3.3 | 테마 전환 UI (2버튼, `aria-pressed`, `role="group"`) | `src/components/ui/`  |
| 3.4 | 알 수 없는 저장값 → 기본 테마 복구 테스트            | `tests/unit/`         |

`theme` store는 `playback` store를 **import하지 않는다** (`SYSTEM_DESIGN.md` §6).

### M1-4. 안정 셸과 Widget Host

| #   | 작업                                                    | 산출물                            |
| --- | ------------------------------------------------------- | --------------------------------- |
| 4.1 | `DashboardShell` — 헤더·그리드·푸터, 테마 무관 골격     | `src/components/layout/`          |
| 4.2 | `WidgetHost` — 레이아웃 순회, `instanceId` 키, CSS 배치 | `src/components/layout/`          |
| 4.3 | Widget Registry (`WidgetDefinition` 등록·조회)          | `src/widgets/` 또는 `src/shared/` |
| 4.4 | MVP 고정 레이아웃 상수                                  | `src/app/`                        |
| 4.5 | 반응형 브레이크포인트 (1100 / 730 / 650 / 600)          | `src/styles/`                     |

`SYSTEM_DESIGN.md` §5.3의 4개 규칙을 지킨다. 특히 **`:key`는 `instanceId`만** 쓴다.

**선행 결정**: `GridArea` / `GridSize` 표현, 레지스트리 배치 위치.

### M1-5. 플레이어 영속성 골격 ★ M1의 핵심

| #   | 작업                                                             | 산출물                                 |
| --- | ---------------------------------------------------------------- | -------------------------------------- |
| 5.1 | `PlayerAdapter` 인터페이스                                       | `src/features/playback/`               |
| 5.2 | `YouTubeIFramePlayerAdapter` — API 싱글턴 로드, `wantsPlay` 지연 | `src/features/playback/`               |
| 5.3 | `FakePlayerAdapter` (테스트용)                                   | `tests/` 또는 `src/features/playback/` |
| 5.4 | `PlayerSurface.vue` — 안정 래퍼 + 어댑터 소유 자식 노드          | `src/features/playback/`               |
| 5.5 | 가시성 가드 composable (200×200, 50%)                            | `src/features/playback/`               |
| 5.6 | `playback` store — 트랙·큐·인덱스·상태·메시지                    | `src/stores/playback.ts`               |
| 5.7 | 최소 트랜스포트 (이전/재생·일시정지/다음)                        | `src/features/playback/`               |

**통합 테스트 (필수, `MVP_SPEC.md` §5)**

| #    | 검증                                                         |
| ---- | ------------------------------------------------------------ |
| 5.8  | 테마 전환 후 `playback` 상태 동일 (트랙·큐·인덱스·재생 상태) |
| 5.9  | 테마 전환 후 플레이어 호스트 DOM 노드가 **동일 인스턴스**    |
| 5.10 | 테마 전환 시 `PlayerAdapter.mount` **재호출 없음**           |

5.9와 5.10은 재생 기능이 완성되지 않아도 **구조만으로 검증 가능하다.**
`FakePlayerAdapter`로 M1에서 바로 작성한다.

### M1-6. 데크 아트와 마스코트 (표시만)

| #   | 작업                                           | 산출물                                         |
| --- | ---------------------------------------------- | ---------------------------------------------- |
| 6.1 | 턴테이블 SVG 이식 (좌표·색 보존)               | `src/themes/mono-vinyl/DeckArt.vue`            |
| 6.2 | 카세트 SVG 이식 (좌표·색 보존)                 | `src/themes/kawaii-synth-cassette/DeckArt.vue` |
| 6.3 | SVG `<defs>` id 접두사 적용 (충돌 방지)        | 위 2개                                         |
| 6.4 | 두 아트 동시 DOM 존재 + CSS `display` 전환     | 테마 CSS                                       |
| 6.5 | 재생 중 회전 애니메이션 (`paused` → `running`) | 테마 CSS                                       |
| 6.6 | 마스코트 패널 + 16×12 도트 스크린              | `src/features/mascot/`                         |

데크 클릭 → 드로어 열기 **배선만** 한다. 드로어 내용은 M2다.

**선행 결정**: SVG id 접두사 규칙, 도트 패턴을 테마별로 다르게 할지.

### M1-7. 시계 위젯

| #   | 작업                                                    | 산출물               |
| --- | ------------------------------------------------------- | -------------------- |
| 7.1 | 도트 매트릭스 글리프 (0–9 5×7, `:` 1×7)                 | `src/widgets/clock/` |
| 7.2 | SVG 렌더러 (r 3.1, 간격 9.3 / 13, off 도트 포함)        | `src/widgets/clock/` |
| 7.3 | `Asia/Seoul` 12시간제, 15초 갱신, 분 변화 시에만 재렌더 | `src/widgets/clock/` |
| 7.4 | 글리프·포맷 단위 테스트                                 | `tests/unit/`        |

시계는 외부 의존이 없고 순수 함수로 테스트하기 쉽다. M1에서 완결 가능하다.

### M1 완료 기준

- [ ] 두 테마가 전환되고 토큰이 올바르게 적용된다
- [ ] 선택한 테마가 재시작 후 복원된다
- [ ] 통합 테스트 5.8 / 5.9 / 5.10 통과
- [ ] 시계가 동작한다
- [ ] 데크 아트 2종이 테마에 따라 전환된다
- [ ] `npm run type-check` / `test` / `lint` / `build` 전부 통과
- [ ] 승인된 디자인의 색·좌표를 변경하지 않았다 (규칙 6)

---

## M2 이후 (후보, 순서 미확정)

| 마일스톤 | 범위                                                                                              |
| -------- | ------------------------------------------------------------------------------------------------- |
| M2       | 라이브러리: 플레이리스트 CRUD, 트랙 추가·순서 변경·삭제, Record Library 드로어, 추가 모달, 토스트 |
| M3       | 재생 완성: 큐 진행, `ENDED` 자동 전환, 오류·자동재생 차단 처리, 외부 링크 대체                    |
| M4       | 날씨 위젯 (제공자 확정 선행), 설정 영속화 확장                                                    |
| M5       | 위젯 편집: 추가·삭제·이동·크기 변경, 위젯별 스킨 선택                                             |

TODO: M2 이후 범위와 순서 확정

## 선행 결정 사항

M1 착수 전 또는 해당 단계 전에 확정해야 한다. `docs/decisions/`에 기록한다.

| 항목                                     | 필요 시점 | 문서                    |
| ---------------------------------------- | --------- | ----------------------- |
| 토큰 이름 확정                           | M1-2      | `THEME_SYSTEM.md` §4.2  |
| `GridArea` / `GridSize` 표현             | M1-4      | `SYSTEM_DESIGN.md` §5.4 |
| `PlayerAdapter` 시그니처                 | M1-5      | `SYSTEM_DESIGN.md` §4.6 |
| SVG `id` 접두사 규칙                     | M1-6      | `THEME_SYSTEM.md` §8    |
| 마스코트 도트 패턴 테마별 차이           | M1-6      | `THEME_SYSTEM.md` §6    |
| 제품 저장 키 네이밍 · 스키마 버전        | M1-1      | `SYSTEM_DESIGN.md` §7   |
| 반복(loop) 동작                          | M3        | `MVP_SPEC.md` F3        |
| 날씨 API 제공자                          | M4        | `MVP_SPEC.md` F7        |
| 드래그 라이브러리 (DOM 재배치 금지 제약) | M5        | `SYSTEM_DESIGN.md` §4.4 |

## 작업 방식

- 한 작업 단위는 하나의 M1-N 범위를 넘지 않는다.
- 동작 변경 시 테스트를 함께 수정한다 (`AGENTS.md` 규칙 7).
- 작업마다 변경 파일과 검증 결과를 보고한다 (`AGENTS.md` 규칙 10).
- 승인된 디자인 레퍼런스는 수정하지 않는다 (`AGENTS.md` 규칙 6).
