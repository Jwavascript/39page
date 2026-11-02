# 디자인 레퍼런스

이 디렉터리의 HTML 파일은 **승인된 디자인·UX 기준**이다.

- 읽기 전용으로 취급한다. 임의로 수정하지 않는다 (`AGENTS.md` 규칙 6).
- 빌드 대상이 아니다. `.prettierignore`와 `eslint.config.ts`의 `globalIgnores`에서 제외된다.
- 실제 서비스 코드는 이 프로토타입을 **Vue 3 + TypeScript로 재구현**한다.
  HTML/바닐라 JS를 그대로 복사해 넣지 않는다.
- 변경이 필요하면 먼저 사람에게 확인하고, 새 버전 파일(`-v10.html` 등)로 추가한다.
  기존 파일을 덮어쓰지 않는다.

## 파일 목록과 역할

| 파일 | 역할 | 우선순위 |
| --- | --- | --- |
| `two-themes-v09.html` | **최신 통합 기준.** Kawaii Synth Cassette 디자인, 테마 전환, 마스코트 전광판 | **1 (최우선)** |
| `mono-vinyl-v08.html` | Mono Vinyl 디자인 및 기본 UX 기준 | 2 |

### 우선순위 규칙

1. **`two-themes-v09.html`가 최우선 기준이다.**
   구조적으로 `mono-vinyl-v08.html`의 **상위집합**이다. v08의 모든 요소를 포함하고
   다음을 추가한다.
   - 테마 전환 UI (`.theme-switch`, `01 / MONO VINYL`, `02 / SYNTH CASSETTE`)
   - Kawaii Synth Cassette 스킨 (`body.theme-kawaii` 토큰 재정의 + `.cassette-deck`)
   - 도트 마스코트 전광판 (`.mascot-panel`)

2. **`mono-vinyl-v08.html`는 Mono Vinyl 테마와 기존 UX의 기준이다.**
   Mono Vinyl 단일 테마 상태에서의 레이아웃·동작·문구를 확인할 때 참조한다.

3. **두 파일이 충돌하는 경우** `two-themes-v09.html`를 따른다.
   실제 충돌은 없다. 두 파일의 차이는 아래 6곳뿐이며, v08에서 삭제된 요소는 없다.

   | 차이 | v08 | v09 |
   | --- | --- | --- |
   | `<title>` | `… Mono Vinyl v0.8` | `… Two-Theme UX Study v0.9` |
   | 프로토타입 라벨 | `MONO VINYL / UX 0.8` | `MY LITTLE FREQUENCY / TWO THEMES 0.9` (`id` 추가) |
   | 턴테이블 `<svg>` | class 없음 | `class="turntable"` (테마별 표시 전환용) |
   | `.deck-hint` | `id` 없음 | `id="mediaHint"` (테마별 문구 교체용) |
   | 푸터 테마 라벨 | `id` 없음 | `id="footerThemeLabel"` (테마별 문구 교체용) |
   | `</section>` 위치 | 데크 직후 종료 | 마스코트 패널 포함 후 종료 |

   즉 v09의 추가 `id`와 `class`는 **테마 전환을 위한 훅**이다. 디자인 변경이 아니다.

## 프로토타입 고유 요소 (제품에 포함하지 않음)

프로토타입 검증용 스캐폴딩이다. 재구현 대상이 아니다.

| 요소 | 설명 |
| --- | --- |
| `.demo-top` 컨테이너 | 프로토타입 상단 바 자체. 단, 내부의 테마 전환 UI는 제품 기능이다 |
| `#wideView` / `#portraitView` (`가로 보기` / `세로 보기`) | 뷰포트 시뮬레이터. 실제 제품은 CSS 미디어 쿼리로 처리한다 |
| `.ux-notes` `<details>` | UX 검증 포인트 메모 |
| `.weather` 고정값 (`18°`, `조금 흐림`, `H 22° / L 12°`) | 디자인 예시. `weather-note`에 "실제 API 연결 전"으로 명시되어 있다 |
| `data-speed` 33/45 버튼 | LP 회전 **연출** 속도만 변경한다. 음악 속도와 무관하다 (토스트 문구로 명시) |
| `localStorage` 키 (`mlf_mono_vinyl_v08`, `mlf.design.theme.preview.v1`) | 프로토타입 키. 제품 키는 별도 확정 대상 |

테마 전환 UI의 **최종 배치 위치**는 확정되지 않았다. 프로토타입은 워크스페이스 밖
데모 바에 두었다. TODO: 제품에서의 배치 확정.

## 재구현 시 보존해야 하는 핵심 제약

프로토타입에서 **의도적으로** 설계된 부분이다. 재구현 시 유지한다.

1. **YouTube 플레이어는 테마 전환에 영향받지 않는다.**
   테마 전환은 `document.body`의 클래스 토글이며, 플레이어 호스트(`#ytHost`)는
   테마별 서브트리 밖의 공유 영역(`.info`)에 있다. 두 데크 아트(턴테이블/카세트)는
   **동시에 DOM에 존재**하고 CSS `display`로만 전환된다.
   → `docs/architecture/THEME_SYSTEM.md`, `docs/architecture/SYSTEM_DESIGN.md` 참조

2. **Record Library 드로어는 오버레이가 아니다.**
   넓은 화면에서 `.workspace` 그리드의 **형제 열**(340px)로 열린다. 영상을 가리지 않는다.
   원본 주석: *"Right Drawer is a sibling in layout, not a layer covering the YouTube video"*

3. **LP / 카세트는 실제 버튼이다.**
   영상 위에 겹친 오버레이가 아니다.
   원본 주석: *"LP is an actual discoverable button rather than an overlay on the YouTube video"*

4. **플레이어 가시성 가드.**
   `syncVisibility()`가 영상 영역이 200×200 이상이고 50% 넘게 보이는지 확인하고,
   조건을 벗어나면 일시정지한다. 좁은 화면에서 드로어를 열면 영상이 숨겨지므로
   먼저 일시정지한다.

5. **단일 플레이어 / 단일 큐.**
   원본 주석: *"One YouTube player, one unified list. loadVideoById + ENDED event advances the queue."*
   테마가 바뀌어도 라이브러리·큐·플레이어는 동일하다.
   원본 주석: *"02. Kawaii Synth Cassette: independent skin, SAME library/queue/player. No character IP."*

6. **마스코트는 캐릭터 IP를 사용하지 않는다.**
   원본 주석에 `No character IP.`로 명시되어 있다. 도트 패턴은 오리지널 도형이다.

7. **`prefers-reduced-motion` 대응.**
   플래터 회전, 카세트 릴 회전, 마스코트 호흡 애니메이션, 툴팁 트랜지션을 모두 비활성화한다.

## 로컬에서 열기

YouTube IFrame API는 `file://`에서 실패할 수 있다. 로컬 서버로 열어야 한다.

```sh
cd design/references
python -m http.server 8000
# http://localhost:8000/two-themes-v09.html
```
