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

### 5.2 타입 초안

```
type WidgetKind = 'deck' | 'player' | 'clock' | 'weather' | 'mascot'

interface WidgetDefinition {
  kind: WidgetKind
  title: string
  // 테마와 스킨에 따라 컴포넌트를 해석한다.
  resolve(ctx: { theme: ThemeKey; skin?: SkinKey }): Component
  defaultArea: GridArea
  minSize?: GridSize
  movable: boolean
  resizable: boolean
  removable: boolean
  // true면 재마운트가 금지된다 (플레이어). §4 참조
  persistent?: boolean
  skins?: SkinKey[]
}

interface WidgetInstance {
  instanceId: string      // 안정적. :key로 사용한다
  kind: WidgetKind
  area: GridArea
  skin?: SkinKey          // 미지정이면 테마 기본 스킨
}

interface DashboardLayout {
  version: number
  items: WidgetInstance[]
}
```

### 5.3 Widget Host 규칙

1. **`:key`는 `instanceId`만 사용한다.**
   인덱스·테마·스킨을 키에 넣지 않는다. 키가 바뀌면 재마운트되고,
   플레이어 위젯은 그 순간 재생 상태를 잃는다 (§4.2).
2. **모든 인스턴스는 그리드 컨테이너의 직계 자식이다.**
   배치는 CSS로만 지정한다 (§4.4).
3. **`persistent: true` 위젯은 테마에 따라 컴포넌트를 교체하지 않는다.**
   `resolve()`가 테마와 무관하게 동일 컴포넌트를 반환한다. 외형은 토큰으로 바꾼다.
4. 알 수 없는 `kind`는 **조용히 건너뛴다.** 저장된 레이아웃이 구버전일 수 있다.

### 5.4 MVP 레이아웃

프로토타입 구조를 그대로 고정한다.

```
┌──────────────────────────────────────────────┬──────────────┐
│ header (brand · 라이브러리 · 링크 추가)         │              │
├──────────────────────────┬───────────────────┤   drawer     │
│ deck        (deck)       │ clock   (clock)   │  (340px,     │
│ ─────────────────────────│ ──────────────────│   drawer-open│
│ mascot      (mascot)     │ weather (weather) │   일 때만)     │
│                          │ ──────────────────│              │
│                          │ player  (player)  │              │
├──────────────────────────┴───────────────────┤              │
│ footer                                       │              │
└──────────────────────────────────────────────┴──────────────┘
```

- `deck`은 테마별 아트(턴테이블/카세트)를 렌더링하고, 클릭 시 드로어를 연다.
- `player`는 `persistent: true`다.
- 드로어는 위젯이 아니다. 셸이 직접 소유한다 (레이아웃 그리드의 형제 열).

TODO: 드로어를 위젯으로 볼지 셸 소유로 볼지 최종 확정 (현재 셸 소유 전제)
TODO: `GridArea` / `GridSize` 표현 확정 (명시적 그리드 라인 / 12열 등)
TODO: 헤더·푸터를 위젯으로 승격할지 여부

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

```
shared/storage/
  defineStorage<T>(key, { version, parse, fallback })
    read(): T        // 실패·불일치 시 fallback
    write(v: T): void  // 실패를 삼키고 보고
```

TODO: 제품 저장 키 네이밍 확정
TODO: 스키마 버전 필드와 마이그레이션 정책 확정
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
