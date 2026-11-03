# 시스템 설계

> 상태: 개정 (M1 준비). 디자인 레퍼런스에서 확정 가능한 구조를 반영했다.
>
> **구현 상태: 코드 구현 없음.** 이 문서는 설계 방향이며 구현을 서술하지 않는다
> (`AGENTS.md` 규칙 9).
>
> 기준 문서: [`design/references/README.md`](../../design/references/README.md)

## 1. 범위

39page는 백엔드 없이 동작하는 클라이언트 전용 SPA로 시작한다.

- YouTube IFrame Player API는 **API 키가 필요 없다.** 서버 없이 사용 가능하다.
- 날씨 API는 제공자에 따라 키가 필요할 수 있다. 키를 클라이언트에 노출할 수 없는
  제공자를 선택하면 **프록시 서버가 필요해진다.**

TODO: 날씨 제공자 확정 후 서버 컴포넌트 필요 여부 재결정 (`MVP_SPEC.md` F7)
TODO: 배포 대상 확정 (정적 호스팅 전제)

## 2. 기술 스택

| 영역          | 선택                                      | 비고              |
| ------------- | ----------------------------------------- | ----------------- |
| 프레임워크    | Vue 3 (Composition API, `<script setup>`) |                   |
| 언어          | TypeScript                                |                   |
| 빌드          | Vite                                      |                   |
| 상태 관리     | Pinia                                     |                   |
| 테스트        | Vitest + @vue/test-utils (jsdom)          |                   |
| 린트/포맷     | ESLint (+oxlint), Prettier                |                   |
| 스타일        | CSS Variables 기반 테마 토큰              | `THEME_SYSTEM.md` |
| 패키지 매니저 | npm                                       |                   |

**라우터는 포함하지 않는다.** 프로토타입은 단일 화면이고 Record Library는
오버레이가 아닌 그리드 형제 열이다. 라우팅이 필요한 화면 전환이 없다.

TODO: 라우팅 필요 여부 재검토 트리거 — 설정 화면 분리, 공유 URL, 딥링크가 생기면

## 3. 레이어와 의존 방향

```
┌──────────────────────────────────────────────────────────────┐
│ src/app                 앱 조립, 전역 스타일 주입, 루트 레이아웃  │
└────────────────────────────┬─────────────────────────────────┘
                             │
┌────────────────────────────▼─────────────────────────────────┐
│ src/components/layout      WidgetHost, 고정 골격, 드로어 셸     │
└────────────────────────────┬─────────────────────────────────┘
                             │  (레지스트리로 위젯 해석)
      ┌──────────────────────┼──────────────────────┐
      │                      │                      │
┌─────▼──────┐   ┌───────────▼─────────┐   ┌────────▼────────┐
│ src/themes │   │ src/widgets         │   │ src/features    │
│ 데크 아트   │   │ clock / weather     │   │ playback        │
│ 스킨 토큰   │   │                     │   │ library / mascot│
└─────┬──────┘   └───────────┬─────────┘   └────────┬────────┘
      │                      │                      │
      └──────────────────────┼──────────────────────┘
                             │  (상태는 store 경유. 기능 간 직접 import 금지)
┌────────────────────────────▼─────────────────────────────────┐
│ src/stores              playback · library · theme · layout · ui │
└────────────────────────────┬─────────────────────────────────┘
                             │
┌────────────────────────────▼─────────────────────────────────┐
│ src/shared              types · utils · storage              │
│                         (다른 레이어를 import하지 않음)          │
└──────────────────────────────────────────────────────────────┘
```

규칙 (`AGENTS.md` 규칙 2, 4):

- `src/shared/*`는 어떤 상위 레이어도 import하지 않는다.
- `src/themes/*`와 `src/widgets/*`는 `src/features/*`를 직접 import하지 않는다.
  필요한 상태는 `src/stores/*`에서 읽는다.
- `src/features/playback`은 테마를 모른다. `ThemeKey`를 참조하지 않는다.
- 테마는 외형만 책임진다. 플레이어 API를 직접 호출하지 않는다.

## 4. 재생과 테마의 분리 — 플레이어 영속성

`AGENTS.md` 규칙 4, 5의 핵심이다. **이 절의 제약이 M1 설계를 가장 강하게 규정한다.**

### 4.1 왜 특별한 취급이 필요한가

YouTube 플레이어는 `<iframe>`이다. iframe에는 다음 성질이 있다.

1. **언마운트하면 재생 상태가 사라진다.** (당연)
2. **DOM에서 부모를 바꾸면(re-parenting) 다시 로드된다.** iframe 노드를
   `appendChild`로 옮기면 브라우저가 문서를 재로드한다. 즉 **노드를 옮기는 것은
   언마운트와 동등하게 파괴적이다.**
3. **`YT.Player(id, …)`는 지정한 엘리먼트를 iframe으로 교체한다.** 그 엘리먼트는
   API가 소유한다. Vue의 렌더러가 같은 엘리먼트를 관리하면 충돌한다.

따라서 제약은 "언마운트 금지"보다 강하다.

> **플레이어 iframe은 생성 이후 부모가 바뀌지 않아야 하고, Vue의 재조정(reconciliation)
> 대상이 아니어야 한다.**

### 4.2 금지 패턴

| 패턴                                  | 왜 안 되는가                             |
| ------------------------------------- | ---------------------------------------- |
| `<Teleport>`로 플레이어 이동          | 노드를 re-parenting한다 → iframe 재로드  |
| 테마별 컴포넌트 안에 플레이어 배치    | 테마 전환 시 서브트리 교체 → 언마운트    |
| `v-if`로 플레이어 표시 전환           | 언마운트                                 |
| `<KeepAlive>`에 의존                  | DOM에서 분리(detach)되므로 iframe 재로드 |
| `:key`에 테마/스킨 포함               | 키가 바뀌면 재생성                       |
| 드래그 라이브러리가 DOM 노드를 재배치 | re-parenting → 재로드                    |

### 4.3 채택 구조

```
app/App.vue
└── layout/DashboardShell.vue      ← 테마에 무관한 안정 골격
    ├── layout/WidgetHost.vue
    │   ├── (위젯들: 테마별로 교체 가능)
    │   └── PlayerSurface.vue      ← 단 한 번 마운트. 부모 고정.
    │       └── <div ref="mount">  ← Vue가 관리하는 안정 래퍼
    │           └── <div>          ← 어댑터가 명령형으로 생성.
    │                                 템플릿에 없으므로 Vue가 패치하지 않는다.
    │                                 YT API가 이 노드를 iframe으로 교체한다.
    └── layout/LibraryDrawer.vue
```

- `PlayerSurface.vue`는 **테마를 모른다.** 테마 전환 시 다시 렌더되지 않는다.
- 플레이어의 **시각적 배치는 CSS로만** 바꾼다 (`grid-area`, `transform`,
  `position`, 크기). CSS 배치는 re-parenting이 아니므로 안전하다.
- 테마별 외형(테두리·배경·글로우)은 `PlayerSurface`의 래퍼에 토큰으로 적용한다.
  → `THEME_SYSTEM.md` §4

### 4.4 장기 목표(위젯 이동·크기 변경)와의 양립

플레이어를 옮길 수 없다는 제약은 위젯 이동과 충돌하는 것처럼 보이지만,
**레이아웃 엔진이 DOM 순서를 바꾸지 않고 CSS로만 배치하면** 양립한다.

- CSS Grid의 `grid-area` / `grid-column` / `grid-row`는 DOM 순서와 무관하게
  배치를 바꾼다. → **이동·크기 변경 모두 re-parenting 없이 가능하다.**
- 따라서 위젯 호스트는 모든 위젯을 **그리드 컨테이너의 직계 자식**으로 두고,
  배치는 인스턴스별 CSS 변수/클래스로 지정한다.

> ⚠️ **라이브러리 선택 제약**: 향후 드래그 앤 드롭을 도입할 때, DOM 노드를
> 재배치하는 라이브러리는 사용할 수 없다. "좌표만 계산하고 배치는 CSS에 맡기는"
> 라이브러리여야 한다. `AGENTS.md` 규칙 8에 따라 도입 시 ADR에 기록한다.

대안(플레이어를 절대 위치 오버레이 레이어로 분리하고 슬롯의 사각형을 측정해
겹쳐 놓는 방식)은 더 복잡하고 §4.5의 가시성 가드와 상호작용이 늘어난다.
그리드 방식으로 해결되지 않을 때만 검토한다.

TODO: 그리드 배치 방식으로 모든 이동·크기 변경 케이스가 커버되는지 M1 이후 검증

### 4.5 가시성 가드

YouTube 임베드는 충분히 보여야 한다. 프로토타입 `syncVisibility()`를 유지한다.

- 조건: 영상 영역 **200×200 이상** && 보이는 면적 **50% 초과** && 드로어에 가려지지 않음
- 위반 시: 재생을 시작하지 않고, 재생 중이면 일시정지하고 사용자에게 안내한다
- 재평가 시점: 드로어 열기/닫기, 창 크기 변경, 뷰 전환, 재생 시도 직전

이 로직은 `src/features/playback`의 composable로 둔다. 테마는 관여하지 않는다.

TODO: `ResizeObserver` / `IntersectionObserver` 사용 여부 확정
(프로토타입은 `getBoundingClientRect` + resize 이벤트)

### 4.6 플레이어 어댑터

```
PlayerAdapter (인터페이스)
  mount(container: HTMLElement): Promise<void>
  load(videoId: string, opts: { autoplay: boolean }): void
  play(): void
  pause(): void
  destroy(): void
  readonly state: PlayerState
  on(event: 'statechange' | 'error' | 'autoplayblocked' | 'ready', handler): void
```

- 구현체 `YouTubeIFramePlayerAdapter`가 IFrame API를 감싼다.
- **store는 인터페이스에만 의존한다.** 테스트는 `FakePlayerAdapter`를 주입한다.
- API 스크립트는 **전역 싱글턴**이다. `window.onYouTubeIframeAPIReady` 콜백은
  한 번만 등록하고, 중복 로드를 막는다.
- API 준비 전 재생 요청은 **지연**한다 (프로토타입의 `wantsPlay` 패턴).
- 곡 전환은 `load`(= `loadVideoById` / `cueVideoById`)로 한다.
  **어댑터를 재생성하지 않는다.**

TODO: `PlayerAdapter` 시그니처 최종 확정
TODO: 어댑터 인스턴스 보유 위치 확정 (store 내부 / 앱 레벨 provide)

## 5. Widget Registry / Widget Host

장기 목표(위젯 추가·삭제·이동·크기 변경, 위젯별 스킨 조합)를 위한 **최소 구조**다.

> **MVP에서는 레이아웃이 고정이다.** 레지스트리와 호스트는 존재하지만
> 레이아웃은 모듈 상수이며 사용자가 편집할 수 없다. 추가·삭제·이동·크기 변경
> UI는 MVP에 포함하지 않는다 (`MVP_SPEC.md` §3).
>
> 지금 만드는 이유는 나중에 레이아웃을 동적으로 바꿀 때 **컴포넌트 트리를
> 다시 쓰지 않기 위해서**다.

### 5.1 개념

| 개념                  | 역할                                             |
| --------------------- | ------------------------------------------------ |
| **Widget Definition** | 위젯 종류 하나의 메타데이터와 컴포넌트 해석 규칙 |
| **Widget Registry**   | 종류 → 정의의 조회. 앱 시작 시 등록된다          |
| **Widget Instance**   | 레이아웃에 배치된 개별 위젯. `instanceId`로 식별 |
| **Widget Host**       | 레이아웃을 받아 인스턴스를 렌더링하는 컴포넌트   |
| **Skin**              | 위젯 단위 외형 변형. 테마와 **독립적인 축**      |

### 5.2 타입 — 구현 완료 (M1-4)

데이터 모델은 `src/shared/types/widget.ts`, 컴포넌트를 들고 있는 정의는
`src/widgets/registry.ts`에 있다.

```ts
// src/shared/types/widget.ts — 순수 데이터
type WidgetType = 'deck' | 'clock' | 'weather' | 'player' | 'mascot'
type GridArea = 'deck' | 'mascot' | 'clock' | 'weather' | 'player'

interface WidgetInstance {
  instanceId: string // 안정적. :key 로 쓰는 유일한 값
  widgetType: WidgetType
  area: GridArea
}

interface DashboardLayout {
  version: number
  items: readonly WidgetInstance[]
}

// src/widgets/registry.ts — Vue 컴포넌트를 들고 있는 정의
interface WidgetDefinition {
  type: WidgetType
  title: string
  component: Component // 정적. resolve(theme) 함수가 아니다
  componentProps?: Readonly<Record<string, unknown>>
  defaultArea: GridArea
  movable: boolean // MVP 전부 false
  resizable: boolean // MVP 전부 false
  removable: boolean // MVP 전부 false
  persistent?: boolean // player 만 true
  skins?: readonly string[] // 확장 지점. 현재 전부 미지정
}
```

초안과 달라진 점:

| 초안                            | 구현               | 이유                                                                                                                                                   |
| ------------------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `kind`                          | `widgetType`       | 인스턴스의 `widgetType`과 이름을 맞췄다                                                                                                                |
| `resolve(ctx: { theme, skin })` | `component` (정적) | 테마별 외형은 컴포넌트 교체가 아니라 **CSS 표시 전환**으로 처리한다 (ADR 0001). 테마를 받는 해석 함수가 필요 없고, 레지스트리가 테마에 종속되지 않는다 |
| `minSize?: GridSize`            | 없음               | 사용자가 크기를 바꿀 수 없어 저장할 크기가 없다. 제약은 CSS로 표현한다 (ADR 0005)                                                                      |

`GridArea`와 `GridSize`의 표현은 ADR 0005에서 확정했다. 인스턴스는 **이름 있는
영역만** 갖고 고정 좌표를 저장하지 않는다. 실제 위치는 `WidgetHost`의
`grid-template-areas`가 정의한다.

### 5.3 Widget Host 규칙 — 구현 완료

1. **`:key`는 `instanceId`만 사용한다.**
   인덱스·테마·스킨을 키에 넣지 않는다. 키가 바뀌면 재마운트되고,
   플레이어 위젯은 그 순간 재생 상태를 잃는다 (§4.2).
2. **모든 인스턴스는 그리드 컨테이너의 직계 자식이다.**
   래퍼 `<div>`를 끼우지 않는다. 위젯 컴포넌트의 루트 엘리먼트가 곧 그리드
   아이템이며, 배치는 `grid-area` 인라인 스타일로만 지정한다.
   → 위젯 컴포넌트는 **단일 루트 엘리먼트**여야 한다 (fragment 금지).
3. **`persistent: true` 위젯은 테마에 따라 컴포넌트를 교체하지 않는다.**
   `component`가 정적이므로 구조적으로 보장된다.
4. 알 수 없는 `widgetType`은 **조용히 건너뛴다.** 저장된 레이아웃이 구버전일
   수 있다. 조회는 `findWidgetDefinition`을 쓰며, 프로토타입 체인을 타지
   않도록 `isWidgetType`으로 확인한다 (`'toString'` 같은 값 차단).
5. **반응형은 `grid-template-areas`만 바꾼다.** DOM 부모·순서·컴포넌트
   인스턴스는 유지된다. 1100px 이하에서 단일 열로 전환한다.

테마는 참조하지 않는다. `WidgetHost`·`DashboardShell`·레이아웃 상수 모두
`useThemeStore`를 import하지 않으며, 테스트가 이를 강제한다.

### 5.4 MVP 레이아웃 — 구현 완료

`src/app/layout.ts`의 모듈 상수 `MVP_DASHBOARD_LAYOUT`이다.
사용자가 편집할 수 없고 저장하지 않는다.

```
┌──────────────────────────────────────────────┐
│ header (brand=39page · ThemeSwitcher)        │
├──────────────────────────┬───────────────────┤
│                          │ clock             │
│  deck                    ├───────────────────┤
│  (deck 영역, 3행 span)    │ weather           │
│                          ├───────────────────┤
├──────────────────────────┤ player            │
│  mascot                  │ (player 영역,      │
│                          │  2행 span)        │
└──────────────────────────┴───────────────────┘
grid-template-columns: minmax(0, 1.13fr) minmax(420px, 0.87fr)
```

1100px 이하에서는 단일 열로 `deck → mascot → clock → weather → player` 순서다.

- `deck`은 M1-6에서 테마별 아트(턴테이블/카세트)를 렌더링한다.
  두 아트를 동시에 DOM에 두고 CSS로 전환하므로 위젯 컴포넌트는 하나다.
- `player`는 `persistent: true`다. M1-5에서 `PlayerSurface`로 교체한다.
- 드로어는 위젯이 아니다. M2에서 `DashboardShell`의 `.workspace` 안에
  `WidgetHost`의 형제 열로 들어온다.
- 헤더는 위젯이 아니다. 셸이 `AppHeader`를 직접 소유한다.

M1-4 기준으로 5개 위젯 모두 **개발용 플레이스홀더**다
(`src/widgets/placeholders/WidgetPlaceholder.vue`). 최종 디자인이 아니다.
실제 컴포넌트로 교체할 때 레지스트리의 `component` 한 줄만 바꾸며
`DashboardShell`·`WidgetHost`는 수정하지 않는다.

TODO: 드로어를 위젯으로 볼지 셸 소유로 볼지 최종 확정 (현재 셸 소유 전제)
TODO: 푸터(테마별 문구)를 셸에 추가할지 결정 — 테마별 copy가 레지스트리에 없다

## 6. 상태 경계

| store      | 책임                                                               | 영속화              |
| ---------- | ------------------------------------------------------------------ | ------------------- |
| `playback` | 현재 트랙, 큐, 큐 인덱스, 큐 출처 목록, 플레이어 상태, 상태 메시지 | 현재 트랙 포인터만  |
| `library`  | 플레이리스트 목록, 선택된 목록, 트랙 CRUD                          | 전체                |
| `theme`    | 선택된 테마 키                                                     | 전체                |
| `layout`   | 위젯 레이아웃, 위젯별 스킨                                         | MVP에서는 하지 않음 |
| `ui`       | 드로어 열림 상태, 모달 열림 상태, 토스트                           | 하지 않음           |

의존 방향:

- `playback`은 `library`에서 **큐를 스냅샷으로 복사**한다. 재생 중 목록을 편집해도
  큐가 즉시 흔들리지 않는다 (프로토타입 동작).
- `theme`은 아무 store에도 의존하지 않는다. **`playback`을 절대 참조하지 않는다.**
  이것이 규칙 5를 구조로 보장한다.
- `ui`는 `playback`의 가시성 가드에 영향을 준다 (드로어 열림 → 가시성 재평가).
  방향은 `ui` → `playback`이며 역방향 의존을 만들지 않는다.

TODO: `ui` store를 둘지 컴포넌트 로컬 상태로 둘지 확정
TODO: 각 store의 액션 시그니처 확정

## 7. 영속화

- `src/shared/storage/`가 `localStorage`를 감싼다. store는 매체를 직접 알지 않는다.
- 읽기는 **방어적**이다. 손상된 데이터에서 초기 상태로 복구한다
  (프로토타입 `safeLoad` 패턴, `MVP_SPEC.md` F9).
- 쓰기는 `try/catch`로 감싼다. 실패가 앱을 멈추지 않는다.
- 키는 **용도별로 분리**한다. 프로토타입도 라이브러리와 테마를 분리해 저장한다.
  테마 전환이 라이브러리 쓰기를 유발하지 않게 한다.

### 7.1 구현된 계약 (M1-1)

```
shared/storage/
  STORAGE_KEYS = { library: '39page.library', theme: '39page.theme' }

  defineStorage<T>({ key, version, fallback, validate, migrate? }): TypedStorage<T>
    read(): { value: T; outcome: ReadOutcome }
    write(value: T): { ok: true } | { ok: false; reason: WriteFailureReason; error? }
```

저장 객체는 `{ version, data }` 봉투 형태다.

| 항목              | 결정                                                                                 | 근거                                                                                                    |
| ----------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| 저장 키           | `39page.library`, `39page.theme`                                                     | 키에 버전을 넣지 않는다. 키가 버전과 함께 바뀌면 이전 데이터를 찾을 수 없어 마이그레이션이 불가능해진다 |
| 스키마 버전       | 봉투의 `version` 필드                                                                |                                                                                                         |
| `fallback`        | 값이 아니라 **팩토리** `() => T`                                                     | 값으로 받으면 모든 읽기가 같은 객체를 돌려주고, 호출자가 변형하면 이후 기본값이 오염된다                |
| `validate`        | **필수**. `(value: unknown) => T \| null`                                            | 타입 가드가 아닌 이유는 정규화가 필요해서다 (불량 항목 제거, 깨진 `selected` 보정 — `MVP_SPEC.md` F9)   |
| 읽기 실패         | 기본값 반환. **저장소를 건드리지 않는다**                                            | 검증·마이그레이션 실패 시 데이터를 지우면 사용자의 복구 가능성을 빼앗는다                               |
| 마이그레이션 성공 | 저장소에 **다시 쓰지 않는다**                                                        | 읽기에 쓰기 부작용을 넣지 않는다. `outcome: 'migrated'`로 알리고 호출자가 다음 저장 시점에 반영한다     |
| 상위 버전 데이터  | 마이그레이션하지 않고 기본값                                                         | 앞으로 되돌릴 수 없다 (앱 다운그레이드 시 데이터 보존)                                                  |
| 쓰기 실패         | 결과 객체로 보고 (`quota-exceeded` / `unavailable` / `serialize-failed` / `unknown`) | 호출자가 사용자 안내를 결정한다                                                                         |

`ReadOutcome`: `stored` · `migrated` · `empty` · `unavailable` · `malformed` ·
`invalid` · `version-mismatch` · `migration-failed`.
`stored`와 `migrated`만 저장된 데이터를 쓴 경우다.

구체 저장 인스턴스는 각 store와 함께 만든다: 테마는 M1-3, 라이브러리는 M2.
M1-1은 `defineStorage`와 키 상수만 제공한다.

TODO: 저장 실패 시 사용자 안내 방식 (`MVP_SPEC.md` F9)
TODO: 레이아웃·스킨 저장을 스키마에 미리 비워둘지 결정

## 8. 외부 의존

| 대상                      | 용도      | 키 필요            | 상태                   |
| ------------------------- | --------- | ------------------ | ---------------------- |
| YouTube IFrame Player API | 음악 재생 | 불필요             | 기준 확정 (프로토타입) |
| 날씨 API                  | 날씨 위젯 | 제공자에 따라 다름 | **제공자 미확정**      |

- YouTube API 스크립트는 `https://www.youtube.com/iframe_api`를 동적으로 로드한다.
  로드 실패를 사용자에게 안내하고 외부 링크로 대체한다.

TODO: 날씨 제공자 선정 — `AGENTS.md` 규칙 8에 따라 필요성·대안 검토 후 ADR 기록

## 9. 테스트 전략

- `tests/unit/` — 순수 로직, store, 단일 컴포넌트
- `tests/integration/` — 여러 모듈이 엮인 동작

**플레이어 목(mock)**: `PlayerAdapter` 인터페이스에 `FakePlayerAdapter`를 주입한다.
jsdom에서 실제 iframe을 띄우지 않는다.

반드시 작성할 통합 테스트 (`MVP_SPEC.md` §5):

1. 테마를 전환해도 `playback` 상태(현재 트랙·큐·인덱스·재생 상태)가 유지된다.
2. 테마를 전환해도 플레이어 호스트 DOM 노드가 **동일 인스턴스**다.
   (`el` 참조를 전환 전후로 비교)
3. 테마를 전환해도 `PlayerAdapter`의 `mount`가 **다시 호출되지 않는다.**
4. 손상된 저장 데이터에서 초기 상태로 복구된다.

TODO: 커버리지 목표 확정
TODO: E2E 도입 여부 (M0·M1에서는 제외)
