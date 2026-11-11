# M11-1 저장 브리지 PoC — 실험 코드 (배포하지 않음)

YouTube 위 플로팅 패널에서 **39page 탭으로 전환하지 않고** 기존 39page store · 탭 간 잠금을 그대로 써서 저장할 수
있는지 실제 Chrome 에서 검증한 코드다. 결과와 판단: [`docs/architecture/M11_BRIDGE_POC.md`](../../docs/architecture/M11_BRIDGE_POC.md),
결정: [ADR 0028](../../docs/decisions/0028-extension-save-bridge.md).

## 정식 기능과의 경계

- **운영 빌드에 들어가지 않는다.** 루트 `npm run build` 는 `index.html` 하나만 입력으로 쓰고 이 폴더를 모른다.
  `src/` 는 이 폴더를 가져오지 않는다 (이 폴더가 `src/` 를 가져온다 — store 를 재사용하려고).
- **운영 확장(`extension/`)과 별개다.** 이 확장은 이름에 "DEV ONLY" 를 달았고, 개발 origin `http://127.0.0.1:4173` 만 안다.
  운영 `https://39page.com` 에 접속하지 않는다.
- `src/` 단일 소스 규칙(`AGENTS.md` 규칙 1)의 예외로 둔 **임시 실험 폴더**다. M11 구현이 끝나면 지운다 (TODO, ADR 0028).

| 경로                    | 내용                                                                                                            |
| ----------------------- | --------------------------------------------------------------------------------------------------------------- |
| `web/bridge.*`          | 39page origin 의 화면 없는 브리지 페이지 — 기존 `useLibraryStore` · `useMomentsStore` 로만 쓴다                 |
| `web/bridgeProtocol.ts` | 메시지 계약 v1 (순수) — 요청 검증 · 허용 확장 origin · 조상 검사                                                |
| `web/bridgeHandlers.ts` | 요청 처리 — 보호 상태 거절 · 저장 뒤 다시 읽어 확인 · 요청 ID 중복 실행 방지 · 부분 성공                        |
| `web/probe.*`           | 저장소 파티션 측정용 탐침 (사용자 데이터를 쓰지 않는다)                                                         |
| `extension/`            | MV3 실험 확장 (빌드 없음, 순수 JS) — 플로팅 패널 · offscreen 브리지 · 39page 탭 포트                            |
| `harness/`              | 실제 Chrome 통합 하네스 (CDP, 의존성 없음)                                                                      |
| `tests/`                | 단위 시험 (실제 store + jsdom)                                                                                  |
| `vite.config.ts`        | PoC 빌드 — 대시보드 + 브리지 + 탐침을 **같은 origin** 으로 (`dist/web`, Git 제외 — 루트 `.gitignore` 의 `dist`) |

## 실행

```sh
# 단위 시험 · 타입 검사 (Node 25+ 는 NODE_OPTIONS=--no-webstorage 가 필요 — 아래 참고)
NODE_OPTIONS=--no-webstorage npx vitest run --config poc/m11-bridge/vitest.config.ts
npx vue-tsc --noEmit -p poc/m11-bridge/tsconfig.json

# 실제 Chrome 통합 (실제 YouTube 에 접속한다 · 격리된 임시 프로필)
npx vite build --config poc/m11-bridge/vite.config.ts
POC_CHROME=<Chrome for Testing 의 chrome.exe> node poc/m11-bridge/harness/run.mjs
```

- **브라우저는 Chrome for Testing** 을 쓴다. 브랜드 Chrome 137+ 은 압축해제 확장 로드 명령줄 플래그를 막고, 이 기기(Windows)
  에서는 CDP 파이프 연결(`--remote-debugging-pipe`)이 Chrome 을 바로 종료시켰다. Chrome for Testing 157 은
  `--enable-unsafe-extension-debugging` 과 함께 WebSocket CDP 로 `Extensions.loadUnpacked` · `Extensions.triggerAction`
  이 됐다.
- 하네스는 매번 새 임시 프로필을 만들고 포트 0 으로 띄운다. 사용자의 Chrome 프로필에 닿지 않는다.
- 확장 ID 는 manifest `key`(공개 키)로 `pkagnijdhfmkodpdfgdehfdghcgbfpoa` 에 고정했다. 개인 키는 저장하지 않았다
  (압축해제 로드에는 필요 없다).
- Node 25+ 는 전역 `localStorage` 를 스스로 정의해 jsdom 의 것을 가린다. 이 기기(Node 26)에서는 루트 시험도 같은 이유로
  `NODE_OPTIONS=--no-webstorage` 없이는 실패한다 — PoC 와 무관한 기존 환경 문제다 (TODO, `IMPLEMENTATION_PLAN.md` M11).
