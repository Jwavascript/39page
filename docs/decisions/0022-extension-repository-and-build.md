# 0022. Chrome 확장은 같은 저장소의 독립 프로젝트 `extension/` 으로 두고, 웹앱 빌드와 격리한다

- 상태: 채택 — **M10-1 (2026-11-11)**, M10-2 에서 구현
- 관련: **ADR 0023** (웹앱 통신·권한), **ADR 0015** (배포 대상),
  `docs/architecture/EXTENSION_DESIGN.md` §1 · §10, `AGENTS.md` 규칙 1 · 8

## 배경

M10 은 YouTube 에서 39page 로 영상을 담는 Chrome 확장을 만든다. 확장은 웹앱과
다른 산출물(압축해제 폴더 / zip)이고, 웹앱은 `main` 푸시가 곧 운영 배포다
(Workers Builds, `DEPLOYMENT.md` §2). 확장 코드가 웹앱 빌드·배포에 섞이면
안 된다.

`AGENTS.md` 규칙 1 은 "소스는 `src/` 한 곳" 이다. 이 규칙은 **웹앱**에 두 번째
소스 루트를 만들지 말라는 것이다. 확장은 별개의 배포물이므로 독립 프로젝트로
둔다 — 규칙 1 에 이 예외를 적는다.

## 결정

### 1. 같은 저장소, 독립 프로젝트 `extension/`

- 자체 `package.json` · `package-lock.json` · `tsconfig` · ESLint · Prettier ·
  Vitest 설정. `extension/` 안에서 `npm install` · `npm run build`.
- **npm workspaces 를 쓰지 않는다.** 쓰면 루트 `npm ci`(Workers Builds 가 실행)가
  확장 의존성까지 설치하고 루트 lockfile 이 바뀐다. 지금 두 프로젝트가
  공유하는 것은 파일 하나다(2번) — 공용 패키지의 필요가 확인되지 않았다.
- 별도 저장소는 기각: 웹앱의 YouTube ID 규칙을 복사해야 하고, 두 쪽의 계약
  (수집 URL v1, ADR 0023)을 한 커밋으로 바꿀 수 없다.

### 2. 웹앱 코드는 순수 모듈 하나만 직접 가져온다

- `src/shared/utils/youtube.ts` (import 0개)를 별칭 `@web/` 으로 가져온다.
  확장의 판정은 이 함수의 결과에 호스트 제한을 **더한** 것이다 → 확장이 받은
  주소는 웹앱도 같은 ID 로 받는다.
- 그 밖의 웹앱 코드(Vue 컴포넌트·store·storage)는 가져오지 않는다. 확장
  테스트가 `@web/` import 를 허용 목록과 대조한다.
- 같은 계약을 호환성 테스트로도 고정한다 (같은 주소 표를 두 함수에).
- **보완 (M10-2)** — 디자인 토큰 CSS 두 파일(`src/styles/tokens.css`,
  `src/themes/mono-vinyl/tokens.css`)도 허용 목록에 넣었다. 변수 선언뿐인 CSS
  라(`url()`·`@import` 없음) 순수 모듈과 같은 성격이고, 팝업이 Mono Vinyl 값을
  복사하지 않고 그대로 따라간다. 허용 목록은 세 항목이고 테스트가 고정한다.

### 3. 도구 — 웹앱과 같은 Vue 3 + Vite + TypeScript

- Popup 은 Vue 3 (`<script setup lang="ts">`). Background · Content 는 Vue 없음.
- Vite 빌드 두 번:
  - **본 빌드**: `src/popup/index.html` + `src/background/index.ts`. 서비스 워커는
    manifest 가 이름으로 가리키므로 `background.js` 고정 이름, ES 모듈
    (`"type": "module"`).
  - **content 빌드**: `src/content/index.ts` → `content.js` 한 파일 IIFE.
    `scripting.executeScript({ files })` 로 주입하는 스크립트는 모듈이 아니므로
    import 가 남으면 안 된다.
- `manifest.json` 원본은 `extension/` 최상위. 빌드의 작은 플러그인이 그대로
  `dist/` 로 내보내고, 검증 스크립트가 산출물을 확인한다.
- 버전은 루트와 같은 줄을 쓴다(vue · vite · typescript · vitest · eslint ·
  prettier 등). 포맷 설정도 루트와 같다.

### 4. 의존성 검토 (`AGENTS.md` 규칙 8)

**새 라이브러리는 `@types/chrome` 하나.** 나머지는 루트가 이미 쓰는 것과 같은
패키지·같은 버전을 확장 쪽에 따로 설치한 것이다.

- **(a) 왜 필요한가** — `chrome.*` API 의 타입. 없으면 `chrome` 전역이
  `any` 가 되어 메시지·탭 API 오용을 타입 검사가 잡지 못한다.
- **(b) 직접 구현 가능한가** — 쓰는 API 만 손으로 선언할 수 있다(약 80줄).
  그러나 API 가 늘 때마다 틀린 선언이 조용히 쌓인다. 타입 전용(런타임 코드
  0)이고 `devDependencies` 라 번들에 들어가지 않는다.
- **(c) 대안**

| 후보                                               | 판단                                                                               |
| -------------------------------------------------- | ---------------------------------------------------------------------------------- |
| **`@types/chrome`** (DefinitelyTyped)              | **채택.** 가장 널리 쓰인다. 타입 전용                                              |
| `chrome-types` (Google, Chromium 에서 생성)        | 정확도는 좋다. 사용 예가 적다. 바꿔야 하면 tsconfig `types` 한 줄 — 재검토 가능    |
| 손으로 쓴 `.d.ts`                                  | 기각 — 위 (b)                                                                      |
| `webextension-polyfill`                            | 기각 — 런타임 코드. Chrome 만 대상이고 MV3 API 가 이미 promise 를 돌려준다         |
| `@crxjs/vite-plugin` · `vite-plugin-web-extension` | 기각 — 빌드 두 번 + manifest 내보내기 20줄로 충분하다. 플러그인의 HMR 은 필요 없다 |
| WXT · Plasmo (프레임워크)                          | 기각 — 구조를 통째로 정한다. 이 저장소의 규칙·도구와 겹친다                        |

### 5. 웹앱 빌드·배포와의 격리

| 경로                                                | 어떻게 막는가                                                                                                                                                                                                                                                                                         |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 루트 `npm run build`                                | `vue-tsc --build`(루트 tsconfig 의 `include` 는 `src/`) · `vite build`(루트 `index.html`). 확장을 읽지 않는다                                                                                                                                                                                         |
| Workers Builds                                      | 루트에서 설치·빌드하고 `assets.directory = "./dist"` 만 올린다. `wrangler.toml` 을 바꾸지 않는다                                                                                                                                                                                                      |
| Git                                                 | 루트 `.gitignore` 의 `dist` · `node_modules` 가 `extension/` 아래에도 걸린다                                                                                                                                                                                                                          |
| 루트 `vitest`                                       | `include` 가 `tests/**` · `src/**/__tests__` 라 `extension/tests` 를 줍지 않는다                                                                                                                                                                                                                      |
| 루트 `oxlint .` · `eslint .` · `prettier --check .` | 저장소 전체를 훑는다 → `extension/` 을 뺀다 (M10-2): `eslint.config.ts` 의 `globalIgnores` · `.prettierignore` · `lint:oxlint` 스크립트의 `--ignore-pattern 'extension/**'`. oxlint 는 하위 폴더의 자체 `.oxlintrc.json` 이 루트 설정의 `ignorePatterns` 보다 앞서 설정 파일로는 빠지지 않았다 (실측) |

검증 기준: M10-2 전후로 루트 `npm run build` 산출물의 파일별 SHA-256 이 같다.

## 대안

- **별도 저장소** — 위 1번.
- **npm workspaces + `packages/shared`** — 공유 대상이 파일 하나인데 루트 설치·
  배포 경로를 바꾼다. 필요가 확인되면 그때 옮긴다.
- **확장을 웹앱 `src/` 안에** — 규칙 1 의 뜻(웹앱 한 소스)은 지키지만 웹앱
  빌드·타입 검사·테스트에 확장 코드가 섞인다. 기각.

## 결과

- 루트 설정 변경은 **린트·포맷 제외 세 곳**(`eslint.config.ts` 한 줄 · `.prettierignore` 한 줄 · `package.json` 의 `lint:oxlint` 플래그)뿐이다. 웹앱의 소스·빌드
  설정·`wrangler.toml` 은 그대로다.
- 확장을 수정해도 웹앱 운영 배포가 바뀌지 않는다. 다만 `main` 에 확장 코드가
  들어가는 시점은 웹앱 배포와 같은 푸시이므로, M10 커밋은 그 결정 전까지 별도
  로컬 브랜치(`m10-extension`)에 둔다.
- 확장 개발자는 `npm install` 을 두 번 한다(루트 · `extension/`).
