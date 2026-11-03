# 테마 시스템

> 상태: 개정 (M1 준비). 토큰 값은 프로토타입에서 **추출**했다.
> 토큰 **이름**은 제안이며 확정 전이다.
>
> **구현 상태: 테마 구현 없음.** `src/themes/*`는 빈 디렉터리다 (`AGENTS.md` 규칙 9).
>
> 기준 문서: [`design/references/README.md`](../../design/references/README.md)
> (`two-themes-v09.html` 최우선)

## 1. 목표

- CSS Variables로 테마를 정의하고 런타임에 교체한다.
- **테마 전환이 재생 상태에 영향을 주지 않는다** (`AGENTS.md` 규칙 5).
- 테마는 외형만 책임지고 재생 로직을 포함하지 않는다 (`AGENTS.md` 규칙 4).
- 승인된 디자인을 임의로 변경하지 않는다 (`AGENTS.md` 규칙 6).

## 2. 테마 목록

| 테마                  | 키                      | 모티프                            | 상태   |
| --------------------- | ----------------------- | --------------------------------- | ------ |
| Mono Vinyl            | `mono-vinyl`            | LP / 턴테이블. 따뜻한 회갈색 금속 | 미구현 |
| Kawaii Synth Cassette | `kawaii-synth-cassette` | 카세트. 민트 + 분홍 포인트        | 미구현 |

기본값은 `mono-vinyl`이다. 저장된 값이 알려진 키가 아니면 기본값으로 되돌린다.

소스 디렉터리는 키와 1:1로 대응한다: `src/themes/mono-vinyl/`,
`src/themes/kawaii-synth-cassette/` (M1-0에서 통일 완료).

## 3. 전환 방식 — 확정

M0에서 후보 A/B/C로 남겨둔 결정을 **프로토타입이 이미 확정했다.**

**채택: 루트 엘리먼트의 속성 교체 + 테마별 데크 아트의 CSS 표시 전환.**

프로토타입은 `document.body.classList.toggle('theme-kawaii', isSynth)` 한 줄로
전환한다. 제품에서는 `data-theme` 속성을 쓴다 (값이 2개 이상으로 늘어날 때 깔끔하다).

```html
<html data-theme="mono-vinyl">
  <!-- 또는 "kawaii-synth-cassette" -->
</html>
```

```css
/* mono는 bare :root를 함께 둔다 -> data-theme가 없어도 기본 테마가 적용된다 */
:root,
:root[data-theme='mono-vinyl'] {
  /* 토큰 값 */
}

:root[data-theme='kawaii-synth-cassette'] {
  /* 토큰 값 */
}
```

`:root[data-theme=…]`의 특이도가 bare `:root`보다 높으므로, 속성이 설정되면
해당 테마가 이기고 설정되지 않거나 **알 수 없는 값이면 mono로 복귀한다.**
브라우저에서 확인했다 (M1-2). M1-3의 Theme Store는 속성만 설정하면 되고
CSS 수정은 필요하지 않다.

### 3.3 첫 페인트 전 테마 적용 (M1-3)

Vite는 앱을 `<script type="module">`로 넣는다. 이 스크립트는 **`first-paint`
이후에 실행된다.** 측정 결과(Chromium 155, 프로덕션 빌드):

| 구성                 | `first-paint` | 테마 적용 시점      | 결과                                     |
| -------------------- | ------------- | ------------------- | ---------------------------------------- |
| 인라인 스크립트 없음 | 156ms         | 208.9ms (`main.ts`) | **약 53ms 동안 기본 테마 배경이 보인다** |
| 인라인 스크립트 있음 | 188ms         | 파싱 중 (페인트 전) | 첫 페인트부터 저장된 테마                |

따라서 `index.html`의 `<head>`에 인라인 스크립트를 둔다.

```js
try {
  var saved = JSON.parse(localStorage.getItem('39page.theme')).data
  if (typeof saved === 'string') document.documentElement.dataset.theme = saved
} catch (error) {}
```

**검증 로직을 중복하지 않는다.** 이 스크립트는 테마 키 목록을 모른다.

- 알 수 없는 값이 들어가도 CSS가 기본 테마로 되돌린다 (§3의 특이도 규칙,
  M1-2에서 브라우저로 확인).
- 마운트 시 Theme Store가 `isThemeKey`로 검증한 값으로 속성을 덮어쓴다.
- 따라서 중복되는 지식은 **저장 키 이름 하나뿐**이고, 테스트가 store의
  `STORAGE_KEYS.theme`와 일치하는지 검사한다.

테마의 단일 진실 공급원은 Theme Store다. 인라인 스크립트는 첫 페인트를 위한
선반영일 뿐이며, store가 항상 최종 상태를 결정한다.

### 3.1 왜 이 방식인가

**이 방식이 규칙 5를 구조적으로 보장한다.** 전환이 속성 변경 한 번이므로
컴포넌트 트리가 전혀 바뀌지 않는다. 플레이어를 포함한 모든 DOM이 그대로 유지된다.

탈락한 대안:

| 후보                        | 탈락 이유                                            |
| --------------------------- | ---------------------------------------------------- |
| 테마별 스타일시트 동적 로드 | 전환 지연이 생기고 FOUC 위험. 프로토타입은 즉시 전환 |
| 테마별 컴포넌트 트리 교체   | 서브트리 언마운트 → 플레이어 파괴. 규칙 5 위반       |

### 3.2 데크 아트는 토큰으로 표현할 수 없다

턴테이블과 카세트는 **완전히 다른 SVG**다. 색 토큰 교체로는 만들 수 없다.
프로토타입의 해법을 따른다.

```css
/* 두 아트가 동시에 DOM에 존재하고, CSS로 표시만 전환한다 */
[data-theme='kawaii-synth-cassette'] .turntable {
  display: none;
}
[data-theme='mono-vinyl'] .cassette {
  display: none;
}
```

- 두 아트를 **동시에 DOM에 두고 CSS로 전환**한다.
- `v-if`로 교체하지 않는다. 데크 자체는 플레이어를 품지 않으므로 `v-if`도
  치명적이지는 않지만, CSS 전환이 프로토타입 동작과 일치하고 더 단순하다.

따라서 테마 적용은 **두 축의 혼합**이다.

| 축                 | 대상                                  | 방식              |
| ------------------ | ------------------------------------- | ----------------- |
| 토큰 교체          | 색·질감·테두리·글로우 등 공통 UI 전체 | `data-theme` 속성 |
| 컴포넌트 표시 전환 | 데크 아트 (턴테이블 / 카세트)         | CSS `display`     |

TODO: 두 SVG를 항상 로드하는 비용이 문제가 되는지 측정 (번들 크기)

## 4. 토큰 계층 — 구현 완료 (M1-2)

2단계로 나눈다.

1. **원시 토큰** — 실제 색/크기 값. 테마 파일에만 존재한다.
2. **의미 토큰** — 용도로 이름 붙인 값. **컴포넌트는 의미 토큰만 참조한다.**

컴포넌트에 테마별 색을 직접 쓰지 않는다. `.theme-kawaii .x { color: #… }` 같은
후손 선택자 오버라이드를 만들지 않는다.

> **프로토타입과의 차이**: 프로토타입은 9개 변수만 두고 나머지 색은 후손
> 선택자로 하드코딩했다. M1-2에서 이 값들을 모두 의미 토큰으로 끌어올렸다.
> 시각 결과는 동일하다 (§4.6의 예외 2건 제외).

### 4.1 파일 배치

| 파일                                          | 내용                                                      |
| --------------------------------------------- | --------------------------------------------------------- |
| `src/styles/tokens.css`                       | 테마와 무관한 공통 토큰. **색은 포커스 링 기본값 하나뿐** |
| `src/styles/base.css`                         | 리셋, body, 포커스, `prefers-reduced-motion`              |
| `src/themes/mono-vinyl/tokens.css`            | Mono Vinyl 토큰 124개                                     |
| `src/themes/kawaii-synth-cassette/tokens.css` | Kawaii Synth Cassette 토큰 124개                          |

**토큰 값의 단일 출처는 위 CSS 파일이다.** 이 문서는 규칙과 구조만 기술한다.
값을 문서에 복제하면 어긋난다. 레퍼런스와의 일치는
`tests/unit/theme-tokens.spec.ts`가 검증한다.

두 테마는 **정확히 같은 토큰 이름 집합**을 정의한다. 한쪽에만 있는 토큰은
전환 시 조용히 빈 값이 되므로 테스트로 동일성을 강제한다.

### 4.2 네이밍 규칙

| 접미사 / 접두사                                      | 용도                                           | 예                        |
| ---------------------------------------------------- | ---------------------------------------------- | ------------------------- |
| `--…-color`                                          | 단일 색 값                                     | `--video-border-color`    |
| `--…-background`                                     | `background` 단축 속성 전체 (다중 레이어 가능) | `--workspace-background`  |
| `--…-shadow`                                         | `box-shadow` / `filter` 값 전체                | `--deck-shadow`           |
| `--…-opacity` · `-width` · `-offset`                 | 색이 아닌 스칼라                               | `--clock-dot-off-opacity` |
| `--duration-…` · `--easing-…`                        | 모션                                           | `--duration-spin-33`      |
| `--font-…` · `--radius-…` · `--size-…` · `--ratio-…` | 공통 상수                                      | `--size-drawer-width`     |

- 단일 색은 반드시 `-color`로 끝난다. 테스트가 강제한다.
- 복합 값은 CSS 속성 이름을 쓴다. 색 하나로 표현할 수 없음을 이름에서 알린다.

### 4.3 토큰 그룹

기본 팔레트 · 페이지/워크스페이스 · 강조 · 헤더/브랜드/푸터/구분선 ·
테마 전환 UI · 버튼/Pill · 데크 · 시계 · 날씨 · 플레이어 · 트랜스포트 ·
드로어 · 행(플레이리스트/트랙) · 모달/오버레이/토스트 · 마스코트.

각 그룹의 토큰 목록은 CSS 파일의 구획 주석을 따른다.

### 4.4 통합하지 않은 값 — 의도적 결정

승인된 디자인의 미세한 차이를 보존하기 위해 다음을 **합치지 않았다.**

| 항목                                                      | 이유                                                                                                                                                                                                                                                                                              |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 경계선 농도                                               | mono는 `#49433b`(header) · `#554f45`(info) · `#534c42`(rule) · `#443e36`(footer) · `#38332c`(workspace) · `#686053`(drawer) · `#544d43`(drawer-head) · `#51493e`(drawer-foot)를 모두 다르게 쓴다. `--line-strong`/`--line-soft` 2개로 묶으면 **시각 결과가 달라진다.** 컴포넌트별 토큰을 유지한다 |
| `--button-*` vs `--pill-*`                                | mono에서 값이 다르다 (`#26231e` vs `#28251f` 등). kawaii는 같다                                                                                                                                                                                                                                   |
| `--accent-*` vs `--accent-strong-*`                       | mono는 두 본색이 다르다 (`#d8cebe` vs `#d5cab9`). kawaii는 둘 다 `#ff9bc5`다                                                                                                                                                                                                                      |
| 날씨 4색                                                  | mono는 icon/temp/desc/highlow가 모두 다르다. kawaii는 2색으로 묶인다                                                                                                                                                                                                                              |
| `--playlist-play-text-color` vs `--track-play-text-color` | mono에서 `#e1d6c5` vs `#e0d3c1`로 다르다                                                                                                                                                                                                                                                          |
| 포커스 링                                                 | §7 참조. 전역 링과 데크 열기 버튼의 링을 분리한다                                                                                                                                                                                                                                                 |

반대로 의미와 값이 모두 반복되는 경우에만 공통 토큰을 썼다. 두 테마가 같은
값을 쓰는 서체·반경·기하·모션은 `src/styles/tokens.css`로 올렸다.

### 4.5 토큰으로 두지 않은 것

- **데크 SVG 내부 색** (턴테이블 하드웨어 키·램프, 카세트 본체 그라디언트).
  두 테마에 대응물이 없고, SVG 내부의 수십 개 `fill`과 함께 M1-6의
  `DeckArt.vue`가 원본 그대로 갖는 편이 정확하다.
- **브레이크포인트**. CSS 변수는 `@media` 조건에서 쓸 수 없다.
  승인된 값(`1100` / `730` / `650` / `600`px)은 `tokens.css` 주석에 적고
  미디어 쿼리에 직접 쓴다.

### 4.6 레퍼런스에서 적용되지 않는 규칙 2건

v09에 kawaii 값이 **작성되어 있지만 선택자·속성이 맞지 않아 적용되지 않는**
규칙이 2건 있다. 작성된 의도를 따랐다.
근거: [`../decisions/0004-unapplied-reference-rules.md`](../decisions/0004-unapplied-reference-rules.md)

| 대상        | v09 작성 내용                                                                                      | 왜 적용되지 않는가                                                          | 채택한 값           |
| ----------- | -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | ------------------- |
| 모달 · 입력 | `.theme-kawaii .modal{background:#19374a;border-color:#8fd8cb;color:#d8fff2}` 와 `.modal input{…}` | 실제 마크업은 `.add-modal` / `.field`다. `.modal` 클래스는 존재하지 않는다  | 작성된 민트 계열 값 |
| 구분선      | `.theme-kawaii .rule{border-color:#456b78}`                                                        | `.rule`은 `height:1px; background:#534c42`로 그린다. `border`가 없어 무효다 | `#456b78`           |

레퍼런스 렌더 결과대로 두면 민트 테마에서 모달과 구분선만 갈색으로 남는다.
되돌리려면 kawaii 토큰 파일의 해당 값을 mono 값으로 바꾸면 된다
(`[의도]` 주석으로 표시해 두었다).

### 4.7 kawaii가 재정의하지 않은 값

v09에서 kawaii가 재정의하지 않아 mono 값이 그대로 보이는 토큰이 있다.
**작성된 의도가 없으므로 레퍼런스 렌더 결과를 보존했다.**
kawaii 토큰 파일에 `[미재정의]`로 표시했다.

`--row-border-color` · `--playlist-play-border-color` ·
`--playlist-play-surface-hover-color` · `--transport-surface-hover-color` ·
`--clock-dot-off-color` · `--weather-note-text-color` ·
`--mute-note-text-color` · `--external-link-text-color` ·
`--drawer-foot-text-color` · `--drawer-muted-text-color` ·
`--status-warning-text-color` · `--error-text-color` ·
`--close-button-text-color` · `--label-text-color` · `--link-text-color` ·
`--modal-shadow` · `--toast-shadow` · `--row-action-hover-text-color` ·
`--info-border-compact-color` · `--deck-hint-strong-text-color`

TODO: 위 목록을 민트 계열로 조정할지 확인 (디자인 판단 필요)

### 4.8 모션 토큰 — 구현 완료

| 토큰                 | 값         | 비고                                      |
| -------------------- | ---------- | ----------------------------------------- |
| `--duration-spin-33` | `1.8s`     | LP 회전 **연출** 33 RPM. 음악 속도와 무관 |
| `--duration-spin-45` | `1.33333s` | LP 회전 연출 45 RPM                       |
| `--duration-spool`   | `1.9s`     | 카세트 릴                                 |
| `--duration-breath`  | `1s`       | 마스코트 호흡 (alternate)                 |
| `--duration-tonearm` | `0.65s`    | 톤암                                      |
| `--duration-stage`   | `0.18s`    | 스테이지 투명도                           |
| `--duration-hint`    | `0.2s`     | 열기 버튼 툴팁                            |

회전 애니메이션은 기본 `paused`이고 재생 중일 때만 `running`이다.
`prefers-reduced-motion: reduce`에서 `base.css`가 위 값을 모두 `0s`로 바꾸므로
토큰을 사용하는 애니메이션은 자동으로 멈춘다. 토큰을 거치지 않는
애니메이션을 위한 안전망 규칙도 함께 둔다. 브라우저에서 확인했다 (M1-2).

### 4.9 기하 토큰 — 구현 완료

| 토큰                                                                         | 값                            |
| ---------------------------------------------------------------------------- | ----------------------------- |
| `--ratio-deck`                                                               | `900 / 570`                   |
| `--size-drawer-width`                                                        | `340px`                       |
| `--size-workspace-min-height`                                                | `650px`                       |
| `--size-shell-max-width`                                                     | `1920px`                      |
| `--ratio-video` / `--size-video-min`                                         | `16 / 9` / `200px`            |
| `--radius-control` / `--radius-modal` / `--radius-field` / `--radius-circle` | `3px` / `4px` / `2px` / `50%` |

## 5. 전환 시 보존 규칙

테마 전환 시 다음은 **반드시** 유지된다.

- 현재 트랙과 재생 위치
- 재생 / 일시정지 상태
- 큐, 큐 인덱스, 큐 출처 목록
- 선택된 플레이리스트와 라이브러리 전체
- 드로어 열림 상태

### 5.1 구조적 보장

1. `theme` store는 `playback` store를 **참조하지 않는다.**
   M1-3에서 정적 import 검사와 pinia 등록 store 검사로 강제한다.
2. 전환은 루트 속성 교체뿐이다. 컴포넌트 트리가 바뀌지 않는다.
3. 플레이어 호스트는 테마별 서브트리 밖에 있다.
4. 플레이어 iframe은 **부모가 바뀌지 않는다.** → `SYSTEM_DESIGN.md` §4

> ⚠️ iframe은 DOM에서 **옮기기만 해도 재로드**된다. 언마운트 금지만으로는
> 부족하다. `<Teleport>`로 플레이어를 이동시키면 안 된다.
> 상세는 `SYSTEM_DESIGN.md` §4.2의 금지 패턴 표를 따른다.

### 5.1.1 위젯 시스템과의 분리 (M1-4)

`WidgetHost`·`DashboardShell`·레이아웃 상수는 Theme Store를 참조하지 않는다.
테마 전환으로 다음이 일어나지 않는다.

- 레지스트리 재생성
- 레이아웃 배열 교체 (같은 객체 참조가 유지된다)
- 위젯 목록·순서·`instanceId` 변경
- 위젯 컴포넌트 재마운트

두 테마가 **같은** 셸·호스트·위젯 인스턴스를 공유하고, 달라지는 것은 CSS
토큰뿐이다. 테마별로 외형이 완전히 다른 데크 아트도 컴포넌트 교체가 아니라
CSS 표시 전환으로 처리하므로(§3.2) 위젯 정의의 `component`는 정적이다.

브라우저에서 확인했다 (M1-4): 테마를 바꿔도 그리드 직계 자식 5개의 DOM 노드가
동일 인스턴스로 유지된다.

### 5.2 검증

`tests/integration/`에 작성한다 (`MVP_SPEC.md` §5).

- 전환 전후 `playback` 상태 동일
- 전환 전후 플레이어 호스트 DOM 노드가 **동일 인스턴스**
- 전환 시 `PlayerAdapter.mount`가 **재호출되지 않음**

## 6. 마스코트 — 구현 완료 (M1-6, 정적)

- 레이아웃(패널·도트 그리드 구조)은 **두 테마가 공유**한다.
- 테마별로 바뀌는 것은 스킨 토큰과 문구다. 토큰 값은
  `src/themes/<key>/tokens.css` 의 `--mascot-*` 가 단일 출처다.

### 6.1 패턴 데이터와 렌더러의 분리

| 파일                                  | 책임                                                               |
| ------------------------------------- | ------------------------------------------------------------------ |
| `src/features/mascot/patterns.ts`     | 도트 패턴 **데이터**. 어떤 캐릭터인지 안다                         |
| `src/features/mascot/DotMatrix.vue`   | **렌더러**. 패턴을 받아 CSS Grid 로 그린다. 어떤 캐릭터인지 모른다 |
| `src/features/mascot/MascotPanel.vue` | 패널 조립. 테마에 맞는 패턴과 문구를 고른다                        |

```ts
type DotPattern = readonly string[] // '1' 켜짐, '0' 꺼짐
const MASCOT_PATTERNS: Record<ThemeKey, DotPattern>
```

- 패턴은 **16×12** 비트맵이다. `two-themes-v09.html` 의 배열을 그대로 이식했다.
- **MVP 에서는 두 테마가 같은 패턴을 공유한다.** v09 도 그렇게 하며 색과
  디스플레이 스타일만 다르다. 테마별 캐릭터를 따로 정의할 수 있도록
  맵으로 두었다.
- **캐릭터 IP 를 쓰지 않는다** (원본 주석 `No character IP.`).
  외부 이미지·이모지·생성 이미지를 쓰지 않는다.
- 렌더러는 어떤 크기의 패턴도 그린다. M4 에서 애니메이션 프레임을 추가할 때
  `patterns.ts` 만 늘리면 된다.

M0 에서 남긴 "테마별 도트 패턴을 다르게 할지" TODO 는 **MVP 에서는 공유**로
확정했다. 테마별 캐릭터는 M4 이후 결정한다.

### 6.2 애니메이션 — 구현 완료 (M4-4 · M4-5)

`PlayerState` → **기분**(mood) → 표정·문구으로 한 겹 접는다
(`features/mascot/moods.ts`). 상태는 여섯인데 표정은 그만큼 필요하지 않다.

| 기분      | `PlayerState`                | 패턴                   | 호흡 |
| --------- | ---------------------------- | ---------------------- | ---- |
| `idle`    | `idle` · `loading` · `ended` | 승인된 `COMPANION_01`  | —    |
| `playing` | `playing`                    | 승인된 `COMPANION_01`  | ✔    |
| `paused`  | `paused`                     | `…_RESTING` (2행 차이) | —    |
| `error`   | `error`                      | `…_ALERT` (1행 차이)   | —    |

- `playing` 에 별도 패턴을 두지 않는다. 승인된 디자인이 **같은 패턴에 호흡
  애니메이션을 얹는** 방식이고 그대로 쓴다.
- `loading` 은 `playing` 이 아니다. 소리가 나지 않는데 호흡하면 재생 중으로
  보인다.
- 표정 변형은 승인된 패턴에서 **한두 행만** 바꿨다. 테스트가 그 행 수를
  검사해 파생 관계를 고정한다.
- 호흡은 `.mascot-panel.is-playing :deep(.dot.is-on)` 에 걸린다. 레퍼런스는
  `.workspace` 에 클래스를 걸지만, 우리는 패널이 `playback` store 를 직접
  읽고 **자기 루트**에 건다 — `DashboardShell` · `WidgetHost` 를 건드리지
  않는다.

테마별 문구(`SIGNAL READY` / `MIXTAPE READY`)는 테마 메타데이터
(`ThemeMetadata.mascot`)에 그대로 있다. 기분별 문구는 `moods.ts` 가 얹고,
`idle` 은 메타데이터의 승인된 값으로 떨어진다.

## 6.5 포커스 링 — 구현 완료 (M1-2)

공통 기본값을 두고 테마·컴포넌트가 재정의할 수 있게 했다.
**모든 포커스를 같은 색으로 통일하지 않는다.**

| 범위                         | 토큰                                                  | mono                      | kawaii                         |
| ---------------------------- | ----------------------------------------------------- | ------------------------- | ------------------------------ |
| 전역 기본 (`:focus-visible`) | `--focus-ring-color` / `-width` / `-offset`           | `#f0e2c8` / `2px` / `3px` | 동일 (v09가 재정의하지 않는다) |
| 데크 열기 버튼               | `--deck-open-focus-ring-color` / `-width` / `-offset` | `#eee2d0` / `2px` / `2px` | `#ff8fc3` / `3px` / `-4px`     |

- 전역 링은 아이보리 `#f0e2c8`다. 민트 배경에서도 대비가 충분하다.
- **분홍 포커스는 kawaii의 카세트 열기 버튼에만 있다.** v09에서 유일하게
  `.cassette-open:focus-visible`가 `3px solid #ff8fc3`, `outline-offset:-4px`를
  쓴다. 안쪽 오프셋은 버튼이 카세트 아트 위에 겹쳐 있어 링이 밖으로 나가지
  않게 하려는 것이다. 이 표현을 보존했다.
- 전역 기본값만 `src/styles/tokens.css`에 있고 나머지는 테마 파일에 있다.

M0에서 "포커스 링을 테마 축으로 올릴지" 남겨둔 TODO는 이렇게 해소했다.
전역 링은 공통 축, 데크 열기 버튼은 컴포넌트별 축으로 나눈다.

## 7. 위젯 스킨 — 테마와 독립된 축

장기 목표는 "개별 위젯 스킨 조합"이다. 즉 **테마와 스킨은 별개 축**이다.

```
테마 (전역)     ×     스킨 (위젯 단위)
mono-vinyl            clock: default | large | minimal
kawaii-synth-cassette weather: default | compact
```

- 테마는 토큰 집합을 결정한다.
- 스킨은 위젯이 그 토큰을 **어떻게 쓰는지**(배치·밀도·표현)를 결정한다.
- 스킨은 자체 색을 하드코딩하지 않는다. 테마 토큰을 참조한다.
  → 두 축이 곱집합으로 조합 가능해진다.

**MVP에서는 각 위젯의 스킨이 `default` 하나뿐이다.** 스킨 선택 UI는 없다.
구조만 `WidgetDefinition.skins`로 열어둔다 (`SYSTEM_DESIGN.md` §5.2).

TODO: 스킨 키 네이밍 규칙 확정
TODO: 스킨이 레이아웃 크기를 바꿀 수 있는지 (`minSize`와의 관계) 확정

## 8. 디렉터리 배치 — 구현 완료 (M1-6)

```
src/styles/
  tokens.css          [x] 공통 토큰
  base.css            [x] 리셋, body, 포커스, prefers-reduced-motion
src/themes/
  index.ts            [x] 테마 레지스트리 (메타데이터 + 마스코트 문구)
  mono-vinyl/
    tokens.css        [x] 토큰 값
    deck.css          [x] 데크 표시 전환 + 턴테이블 SVG 내부 스타일
    DeckArt.vue       [x] 턴테이블 SVG (레퍼런스 그대로 이식)
  kawaii-synth-cassette/
    tokens.css        [x] 토큰 값
    deck.css          [x] 데크 표시 전환 + 카세트 SVG 내부 스타일
    DeckArt.vue       [x] 카세트 SVG (레퍼런스 그대로 이식)
src/features/deck/
  DeckWidget.vue      [x] 두 데크 아트를 함께 품는 단일 위젯
src/features/mascot/
  patterns.ts         [x] 도트 패턴 데이터
  DotMatrix.vue       [x] 도트 렌더러
  MascotPanel.vue     [x] 패널 조립
```

CSS 는 `src/main.ts` 에서 **정적으로** import 한다. 순서는 공통 토큰 →
기본 스타일 → 테마 토큰 → 테마 데크 CSS 다.

### 8.1 데크 아트 이식 규칙 — 확정

레퍼런스에서 **그대로 이식**한다. 좌표·색·`viewBox` 를 바꾸지 않는다 (규칙 6).
`tests/unit/deck-widget.spec.ts` 가 이식 결과를 레퍼런스와 **문자 단위로**
비교하므로 좌표 한 자리나 색 한 글자만 달라져도 실패한다.

원본과 의도적으로 다른 점은 세 가지뿐이다.

| 변경                                                                     | 이유                                                                                                               |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| `<defs>` id 에 테마 접두사 (`mv-`, `ksc-`)                               | 두 SVG 가 동시에 DOM 에 있으므로 id 가 충돌하면 그라디언트·필터·클립이 서로 덮인다. `url(#...)` 참조도 함께 바꾼다 |
| 프로토타입 스크립트 전용 id 제거 (`platter`, `hardwarePlay`, `deckIcon`) | 참조하는 코드가 없다. 애니메이션에 필요한 class 는 유지한다                                                        |
| 내부 컨트롤의 `role="button"` · `tabindex` · `data-speed-button` 제거    | 동작하지 않는 버튼을 만들지 않는다. 금속 하드웨어는 데크 본체 디자인의 일부이므로 외형만 남긴다                    |

M0 에서 남긴 "SVG id 접두사 규칙" TODO 는 `mv-` / `ksc-` 로 확정했다.
"데크 SVG 를 Vue 컴포넌트로 둘지" TODO 는 **컴포넌트**로 확정했다.
클래스 훅과 테마별 표시 전환이 필요하기 때문이다.

### 8.2 테마 전환 방식

두 데크 아트를 **동시에 DOM 에 두고 CSS 로만 표시를 전환한다** (ADR 0001).
컴포넌트를 교체하지 않으므로 테마 전환이 DOM 재생성을 유발하지 않는다.

- 시각적 표시: 각 테마의 `deck.css` 가 `:root[data-theme]` 로 `display` 전환
- 접근성 트리: `DeckWidget` 이 비활성 아트에 `aria-hidden="true"`

`display: none` 만으로도 접근성 트리에서 빠지지만 `aria-hidden` 을 함께 두어,
CSS 로드 실패 시에도 두 데크가 동시에 읽히지 않게 하고 jsdom 에서도
활성 테마를 DOM 으로 검증할 수 있게 했다.

### 8.3 회전 애니메이션 — 구현 완료 (M4-3)

`DeckWidget` 이 `playback` store 를 읽어 자기 루트에 `is-playing` /
`is-paused` 를 건다. 테마별 `deck.css` 가 그 클래스를 본다.

| 연출           | 테마   | 기본 상태        | 달리는 조건                   |
| -------------- | ------ | ---------------- | ----------------------------- |
| LP 회전        | mono   | `paused`         | `is-playing`                  |
| 톤암 하강      | mono   | `rotate(-12deg)` | `is-playing` 또는 `is-paused` |
| 전원 램프      | mono   | 꺼짐             | `is-playing`                  |
| 테이프 릴 회전 | kawaii | `paused`         | `is-playing`                  |

- 기본이 `animation-play-state: paused` 다. **정지한 데크를 재생 중인 것처럼
  표현하지 않는다.** 달릴 때도 `play-state` 만 바꾸므로 멈춘 자리에서 이어진다.
- 톤암은 `is-paused` 에서도 내려와 있다 — 멈춰 있어도 바늘은 판 위에 있다
  (레퍼런스와 같다).
- 애니메이션 길이는 **모션 토큰**으로만 받는다. `prefers-reduced-motion` 이
  토큰을 0s 로 바꿔 자동으로 멈추고, `base.css` 의 안전망이 한 번 더 막는다.
  테스트가 하드코딩된 초 단위 값을 금지한다.
- 키프레임 이름에 테마 접두사를 붙인다 (`mv-disc` · `ksc-turn`). SVG `<defs>`
  id 규칙(§8.1)과 같은 이유다.
- 45 RPM(`--duration-spin-45`)은 아직 쓰이지 않는다. 승인된 디자인의 속도 키를
  M1-6 에서 **동작하지 않는 컨트롤**로 정리했고, 연결할 컨트롤이 없다.

### 8.4 Record Library 연결 (M2)

데크를 눌러 Record Library 를 여는 동작은 M2 다. 지금은 동작하지 않는
버튼이나 "LP 를 누르면 …" 안내 문구를 만들지 않는다. M2 는 `DeckWidget` 에
접근 가능한 트리거를 더하면 되고, `DeckArt` 컴포넌트는 건드리지 않는다.
