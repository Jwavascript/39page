# 39page Chrome 확장 (M10)

YouTube 에서 보고 있는 영상을 39page 로 담는 확장이다 (M10-3 Quick Add).

1. YouTube 영상 페이지에서 툴바의 39page 아이콘을 누른다
2. 팝업이 영상 제목 · ID 를 보여 준다 → **39page 에 추가**
3. 39page **수집 화면**이 새 탭으로 열린다 → 플레이리스트를 고르고 **플레이리스트에 추가**

확장은 **저장하지 않는다.** 수집 화면에서 사용자가 누를 때 39page 웹앱이 저장한다.
링크를 복사할 필요가 없다. 지금 보는 시점·메모(Music Moment) 캡처는 M10-4 다.

- 설계: [`../docs/architecture/EXTENSION_DESIGN.md`](../docs/architecture/EXTENSION_DESIGN.md)
- 결정: ADR [0022](../docs/decisions/0022-extension-repository-and-build.md) (저장소·빌드),
  [0023](../docs/decisions/0023-extension-webapp-communication.md) (웹앱 통신·권한)

웹앱과 **독립된 npm 프로젝트**다. 루트의 설치·빌드·배포(Cloudflare Workers Builds)는 이
폴더를 읽지 않는다.

## 명령 (이 폴더에서)

| 명령                     | 용도                                                                                     |
| ------------------------ | ---------------------------------------------------------------------------------------- |
| `npm install`            | 의존성 설치 (루트와 따로)                                                                |
| `npm run build`          | 타입 검사 + 빌드 + manifest 검사 → `dist/` (수집 화면: `https://39page.com`)             |
| `npm run build:dev`      | 개발 빌드 → `dist-dev/` (수집 화면: `VITE_COLLECT_ORIGIN`, 기본 `http://localhost:5173`) |
| `npm run type-check`     | 타입 검사만                                                                              |
| `npm test`               | 단위 테스트 1회                                                                          |
| `npm run lint`           | oxlint + ESLint (`--fix` 포함)                                                           |
| `npm run format:check`   | Prettier 검사                                                                            |
| `npm run check:manifest` | `dist/manifest.json` 과 산출물 검사 (빌드 뒤)                                            |

## Chrome 에 올려 보기

1. `npm run build`
2. `chrome://extensions` → 오른쪽 위 **개발자 모드** 켜기
3. **압축해제된 확장 프로그램을 로드합니다** → `extension/dist` 폴더 선택
4. YouTube 영상 페이지에서 툴바의 39page 아이콘을 누른다

웹앱을 로컬에서 함께 볼 때는 `npm run build:dev` 의 `dist-dev` 를 올린다. 수집 화면 주소는
허용 목록(`http://localhost:5173`, `http://127.0.0.1:5173`, `http://localhost:4173`,
`http://127.0.0.1:4173`)만 쓸 수 있고, 그 밖의 값이면 빌드가 멈춘다.

데스크톱 Chrome 을 기준으로 한다. 모바일 브라우저에서의 동작은 확인하지 않았다 (TODO, M10-6).

## 권한

| 권한        | 왜                                                      |
| ----------- | ------------------------------------------------------- |
| `activeTab` | 아이콘을 누른 **그 탭**의 주소를 보고 스크립트를 넣는다 |
| `scripting` | 그 탭에 페이지를 읽는 스크립트를 넣는다                 |

YouTube 상시 접근 권한·방문 기록 권한(`tabs`)은 요청하지 않는다. 확장은 네트워크
요청을 하지 않고, 39page 의 저장소에 닿지 않는다.

## 구조

```
src/
├── popup/        Vue 3 팝업 — 상태(useActiveVideo) · bridge · 컴포넌트
├── background/   서비스 워커 — 메시지 라우터 · 탭 조회 · 스크립트 주입 · 플레이어 읽기
├── content/      YouTube 페이지에서 읽기만 하는 스크립트 (아이콘을 누를 때 주입)
└── shared/       메시지 계약 v1 · 검증 · YouTube 페이지 판정 · 제목 정리
```

웹앱 코드는 `@web/` 별칭으로 **허용 목록**(`src/shared/utils/youtube.ts`, 디자인 토큰
CSS 두 파일)만 가져온다. `tests/boundaries.spec.ts` 가 고정한다.
