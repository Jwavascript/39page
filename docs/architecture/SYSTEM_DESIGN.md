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

### 4.6 플레이어 어댑터 — 구현 완료 (M1-5)

계약은 `src/features/playback/PlayerAdapter.ts`에 있다.

```ts
interface PlayerAdapter {
  mount(container: HTMLElement): void // 중복 호출은 no-op
  destroy(): void // 중복 호출은 no-op
  load(videoId: string): void
  play(): void
  pause(): void
  state(): PlayerState // YouTube 숫자값을 노출하지 않는다
}

type PlayerAdapterFactory = () => PlayerAdapter
const PLAYER_ADAPTER_FACTORY: InjectionKey<PlayerAdapterFactory>
```

초안과 달라진 점:

| 초안                          | 구현                   | 이유                                                                                                                                          |
| ----------------------------- | ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `mount(): Promise<void>`      | `mount(): void`        | `YT.Player` 생성 자체는 동기다. 준비 완료는 `onReady` 콜백이므로 구현체가 내부에서 추적한다. Promise를 쓰면 호출부가 불필요하게 비동기가 된다 |
| `readonly state: PlayerState` | `state(): PlayerState` | 외부 플레이어에 질의하는 동작이므로 메서드가 맞다                                                                                             |
| `on(event, handler)`          | 없음                   | 이벤트 구독은 M3에서 필요해질 때 더한다. 지금 쓰지 않는 이벤트 시스템을 두지 않는다 (규칙 9)                                                  |
| `load(videoId, { autoplay })` | `load(videoId)`        | 자동재생 정책은 M3 결정이다                                                                                                                   |

#### 중복 호출 계약

- `mount()`를 이미 마운트된 상태에서 부르면 **no-op**이다. 두 번째 인스턴스를
  만들지 않고 기존 노드를 유지한다. 실수로 다시 불려도 재생이 끊기지 않게
  하는 방어다.
- `destroy()`를 마운트되지 않은 상태에서 불러도 던지지 않는다.
- `destroy()` 이후 `mount()`를 다시 부르면 새로 만든다.

#### 수명주기

| 사건                          | `mount()`     | `destroy()`   |
| ----------------------------- | ------------- | ------------- |
| `PlayerSurface` 최초 마운트   | 1회           | —             |
| 테마 전환                     | **호출 없음** | **호출 없음** |
| Vue 재렌더                    | 호출 없음     | 호출 없음     |
| 반응형 레이아웃 변경          | 호출 없음     | 호출 없음     |
| `PlayerSurface` 실제 언마운트 | —             | 1회           |

#### DOM 소유권

```
<section class="player-surface">     Vue 소유 (WidgetHost Grid 의 직계 자식)
  <div class="player-mount" ref>     Vue 소유 — 안정적인 래퍼
    └── <div> (어댑터가 생성)          어댑터 소유 — Vue 가 패치하지 않는다
                                      M3 에서 YT.Player 가 iframe 으로 교체
  <p class="player-notice">          Vue 소유 — 어댑터 영역 밖의 형제
</section>
```

- Vue 템플릿은 `.player-mount` **안에 자식을 두지 않는다.** 같은 영역을
  Vue와 API가 동시에 건드리면 충돌한다.
- 개발 단계 안내 문구는 어댑터 영역 밖의 형제다.
- `PlayerSurface`는 **단일 루트**다. `WidgetHost`가 `grid-area`를 루트에
  적용하므로 fragment면 배치가 깨진다.

#### 플레이어 영역 크기

`.player-mount`는 `--ratio-video`(16/9)와 `--size-video-min`(200px)을 쓴다.
`min-height`를 함께 둬서 부모 Grid가 높이를 눌러 찌그러지지 않게 한다.
브라우저에서 확인한 결과(M1-5): 1440px에서 536×301, 1000px에서 871×490,
500px에서 433×244 — 모두 비율 1.778이고 200×200 이상이다.
실제 가시성 준수(200×200 이상 + 50% 초과 노출)는 M3의 가시성 가드에서
다시 확인한다.

#### 어댑터 보유 위치

`PlayerSurface`의 **비반응형 지역 변수**다. Pinia state나 `ref`에 넣지 않는다.
팩토리를 `provide`/`inject`로 주입한다.
근거: [`../decisions/0006-player-adapter-ownership.md`](../decisions/0006-player-adapter-ownership.md)

- 주입되지 않으면 어댑터를 만들지 않는다. **M1-5의 기본 상태가 그것이다.**
- 테스트는 `global.provide`로 `FakePlayerAdapter`를 넣는다.
- M3는 `main.ts`에서 한 줄로 실제 어댑터를 주입한다.

#### M3에서 실제 어댑터로 교체하는 방법

1. `src/features/playback/YouTubeIFramePlayerAdapter.ts`를 만들어
   `PlayerAdapter`를 구현한다. API 스크립트 싱글턴 로드,
   `window.onYouTubeIframeAPIReady` 단일 등록, `wantsPlay` 지연,
   숫자 → `PlayerState` 변환을 **이 파일 안에서만** 한다.
2. `main.ts`에 한 줄을 더한다.
   `app.provide(PLAYER_ADAPTER_FACTORY, () => new YouTubeIFramePlayerAdapter())`
3. `PlayerSurface`의 안내 문구를 실제 상태 표시로 교체한다.
4. `PlayerAdapter` 인터페이스를 바꿔야 하면 M1-5의 수명주기 테스트를 함께
   수정한다 (`AGENTS.md` 규칙 7).

`FakePlayerAdapter`는 그대로 남겨 같은 계약을 계속 검증한다. 앱 코드에서
주입하지 않으므로 프로덕션 번들에 포함되지 않는다 (M1-5에서 확인).

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
- 드로어는 위젯이 아니다. **M2-2에서 `DashboardShell`의 `.workspace` 안
  `WidgetHost`의 형제 열로 구현했다.** 열고 닫아도 `WidgetHost` 와 그 안의
  `PlayerSurface` 는 같은 부모에 그대로 있다. `v-if` 를 쓰지 않고 `hidden`
  속성으로 숨긴다.
  - 넓은 화면: `grid-template-columns: 1fr 340px`. 플레이어는 좁아지되
    가려지지 않는다 (1440px 기준 542→420px, 16:9 유지).
  - 1100px 이하: 레퍼런스와 같이 드로어가 스테이지를 대체한다.
    **언마운트가 아니라 `display: none`** 이므로 플레이어 DOM 은 유지된다.
    가려졌을 때의 일시정지 정책은 M3 의 가시성 가드에서 다룬다.
  - 열림 상태는 `DashboardShell` 의 지역 `ref` 다. 전역 store 를 만들지 않았다.
    트리거(`DeckWidget`)는 `WidgetHost` 너머에 있어 props 로 닿지 않으므로
    주입으로 전달한다 (`features/library/drawerController.ts`, ADR 0006 과 같은 방식).
- 헤더는 위젯이 아니다. 셸이 `AppHeader`를 직접 소유한다.

위젯 교체 현황 (레지스트리의 `component` 한 줄만 바꾸면 되고,
`DashboardShell`·`WidgetHost`·`src/app/layout.ts`는 수정하지 않는다):

| 위젯      | 컴포넌트                                     | 교체 시점        |
| --------- | -------------------------------------------- | ---------------- |
| `deck`    | `features/deck/DeckWidget.vue`               | M1-6 완료        |
| `mascot`  | `features/mascot/MascotPanel.vue`            | M1-6 완료 (정적) |
| `player`  | `features/playback/PlayerSurface.vue`        | M1-5 완료        |
| `clock`   | `widgets/placeholders/WidgetPlaceholder.vue` | M4               |
| `weather` | `widgets/placeholders/WidgetPlaceholder.vue` | M4               |

플레이스홀더는 개발용 임시 표시이며 최종 디자인이 아니다.

TODO: 드로어를 위젯으로 볼지 셸 소유로 볼지 최종 확정 (현재 셸 소유 전제)
TODO: 푸터(테마별 문구)를 셸에 추가할지 결정 — 테마별 copy가 레지스트리에 없다

## 6. 상태 경계

| store      | 책임                                                      | 영속화                  |
| ---------- | --------------------------------------------------------- | ----------------------- |
| `playback` | 현재 트랙, 큐, 큐 인덱스, 플레이어 상태, 상태 메시지·어조 | 현재 트랙 포인터만 (M3) |
| `library`  | 플레이리스트 목록, 선택된 목록, 저장 상태                 | 전체                    |
| `theme`    | 선택된 테마 키                                            | 전체                    |
| `layout`   | 위젯 레이아웃, 위젯별 스킨                                | MVP에서는 하지 않음     |
| `ui`       | 드로어 열림 상태, 모달 열림 상태, 토스트                  | 하지 않음               |

M1-5 기준 `playback` store는 **데이터 구조와 기본 불변조건만** 갖는다.
불변조건: `queueIndex`는 큐 범위 안이거나 큐가 비면 `-1`이고, `currentTrack`은
항상 `queue[queueIndex]`와 일치한다. 큐는 스냅샷 복사다.
**어댑터 인스턴스나 DOM 노드를 state에 두지 않는다** (ADR 0006).
실제 재생 명령 연결·이벤트 구독·자동 전환은 M3이다.

### 6.1 선택된 플레이리스트와 재생 큐는 다른 상태다

라이브러리의 `selectedPlaylistId` 는 **지금 보고 있는 목록**이고,
`playback` 의 `queue` 는 **지금 울리고 있는 소리**다. 둘은 독립이다.

```
Playlist A 재생 중  →  Library 에서 B 선택  →  B 이름 변경 · 삭제
                       ↑                      ↑
                       playback.queue / queueIndex / currentTrack 은 그대로
```

큐는 재생 시작 시점의 **스냅샷**이므로, 원본 플레이리스트를 지워도 재생이
끊기지 않는다. 두 store 는 서로를 import 하지 않는다. 목록의 재생 버튼을
누르는 흐름은 **상위 UI 계층**이 두 store 를 조립해 만든다
(`library` 에서 트랙을 읽어 `playback.setQueue()` 에 넘긴다).

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

### 7.2 라이브러리 저장 — 구현 완료 (M2-1)

```
키: 39page.library
{ "version": 1, "data": { "playlists": [...], "selectedPlaylistId": null } }
```

`LibraryData` 는 `src/shared/types/music.ts` 에 있다. 기존 `Track` ·
`Playlist` 를 그대로 쓴다.

**검증과 정규화** (`normalizeLibraryData`)

| 입력                                                                  | 처리                                   |
| --------------------------------------------------------------------- | -------------------------------------- |
| 객체가 아님 · `playlists` 가 배열이 아님                              | 복구 불가. `null`                      |
| `id` 가 빈 문자열 · `name` 이 문자열 아님 · `tracks` 가 배열 아님     | 그 플레이리스트만 버린다               |
| 중복 플레이리스트 `id`                                                | 처음 것만 남긴다                       |
| `source !== 'youtube'` · 11자 아닌 `videoId` · `title` 이 문자열 아님 | 그 트랙만 버린다                       |
| 플레이리스트 안의 중복 트랙 `id`                                      | 처음 것만 남긴다                       |
| `selectedPlaylistId` 가 없는 목록을 가리킴                            | 첫 목록으로 보정. 목록이 없으면 `null` |

트랙 순서는 유지한다.

**데이터 보호** → [`../decisions/0007-library-data-protection.md`](../decisions/0007-library-data-protection.md)

라이브러리는 사용자가 축적한 데이터라 테마와 다르게 다룬다. 원본을 읽지
못했거나 일부만 복구한 경우 `status = 'protected'` 가 되어 **쓰기를 막는다.**
수정은 메모리에서 계속 되지만 저장되지 않으며, 액션이 `persisted: false` 로
알린다.

| `status`      | 조건                                                              | 쓰기 |
| ------------- | ----------------------------------------------------------------- | ---- |
| `ready`       | 정상 복원 또는 저장값 없음                                        | 허용 |
| `unavailable` | 저장소 접근 불가                                                  | 실패 |
| `protected`   | `malformed` · `invalid` · `version-mismatch` · `partial-recovery` | 차단 |

선택 ID 보정만으로는 보호하지 않는다. 잃은 데이터가 없기 때문이다.

프로토타입의 `mlf_mono_vinyl_v08` 키는 **읽지 않는다.** 이전이 필요하면
별도 마이그레이션 작업으로 분리한다.

**최초 실행 기본 플레이리스트** (`seedFirstRunPlaylist`, M2-2)

`restore()` 와 **분리된 별도 액션**이다. 복원이 저장소를 건드리지 않는다는
보장을 지키기 위해서다. 다음을 모두 만족할 때만 `MY RECORDS` 를 만든다.

| 조건                         | 이유                                                                                                     |
| ---------------------------- | -------------------------------------------------------------------------------------------------------- |
| `restoreOutcome === 'empty'` | 저장값이 **아예 없었다.** `'stored'` 인데 목록이 비었으면 사용자가 전부 지운 것이므로 최초 실행이 아니다 |
| `status === 'ready'`         | `protected` / `unavailable` 에서 기본값을 쓰면 원본을 덮어쓸 수 있다                                     |
| 목록이 비어 있다             |                                                                                                          |

`main.ts` 가 마운트 전에 `restore()` → `seedFirstRunPlaylist()` 순으로 부른다.

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
