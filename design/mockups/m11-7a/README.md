# M11-7A 비교 시안 — 조작할 수 있는 설계 시안 (실제 구현 아님)

설계 문서: [`docs/product/M11_7_UX_REDESIGN.md`](../../../docs/product/M11_7_UX_REDESIGN.md) · 결정: ADR 0030 (Proposed)

## 여는 법

`index.html` 을 브라우저로 바로 연다 (파일 더블클릭 · 서버 불필요). 위쪽 노란 띠가 "설계 시안 — 실제 39page 가 아닙니다" 를 늘 보인다.

- 샘플 데이터만 쓴다. **39page store · localStorage · YouTube · 날씨 API 에 연결하지 않고 아무것도 저장하지 않는다** — 새로고침하면 처음으로.
- 재생은 숫자가 1초씩 흐르는 흉내다. 소리 · 영상이 없다.
- 화면 상태가 주소 `#/…?` 에 적혀 같은 화면을 다시 열 수 있다.

| 화면                | 해 볼 것                                                                                                                                      |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 대시보드          | 제안 ↔ 지금(M11-6 스크린샷) · 화면 크기 6가지 · 헤더 H1/H2/지금 · 보관함 열기와 배치 A/B/C · Moment A/B · 데이터 양(UAT · 3 · 50목록 · 빈 상태) · 시나리오(재생 중인 목록 순서 바꾸기 · 다른 목록 고르기) · 데크 누름 영역 |
| 2 음악 보관함       | 데스크톱 2열 · 390 세로 목록 → 상세 · 낮은 데스크톱 · 목록 ⋯(이름 · 삭제) · 링크 연속 추가 · 트랙 편집 A/B/C                                   |
| 3 Moment 저장 A/B   | 두 모델을 나란히 — 저장소 쓰기 기록 · 누른 횟수 · 실패 흉내 · 곡 바뀜 흉내                                                                     |
| 4 트랙 정렬         | A 핸들+메뉴 · B 편집 모드 · C 혼합 — 마우스 · 터치 끌기, 키보드(≡ 에서 Space · ↑↓ · Home/End · Esc), 데스크톱/모바일 흉내                      |
| 5 모바일            | 360 · 390 세로 · 844×390 가로, 순서 M1/M2/지금, 펼치기, 보관함 두 단계                                                                       |
| 6 결정표            | 사용자가 고를 항목과 추천                                                                                                                     |

## 파일

| 파일               | 내용                                                                                                    |
| ------------------ | ------------------------------------------------------------------------------------------------------- |
| `index.html`       | 시안 입구                                                                                               |
| `proto.js` · `proto.css` | 시안 동작 · 모양 (컨테이너 쿼리로 한 마크업을 여러 폭에 그린다 — 제품은 미디어 쿼리)              |
| `tokens.css`       | **앱 토큰 사본** (`src/styles/tokens.css` + 두 테마 `tokens.css`, 2026-11-14) — 앱을 따라가지 않는다     |
| `decks.js`         | **데크 아트 SVG 사본** (`src/themes/*/DeckArt.vue`) — 아트를 바꾸지 않았다                                |
| `screenshots/now-*` | 지금(M11-6) 앱을 격리 프로필 · 샘플 데이터 · 외부 요청 차단으로 찍은 기준 사진                          |
| `screenshots/proposal-*` | 시안 화면                                                                                         |
| `check/`           | 다시 만들기 · 검증 스크립트와 결과 (아래)                                                               |

## 검증 (2026-11-14)

`check/` 의 스크립트는 `extension/integration/harness.mjs` 를 빌려 쓴다 (시안 폴더를 `vite preview` 로 띄우고 임시 프로필 Chrome 을 연다).

```sh
# 토큰 · 데크 사본 다시 만들기
node design/mockups/m11-7a/check/gen-assets.mjs .
# 화면 20개 렌더링 — 콘솔 오류 · 외부 요청 · 저장소 접근 · 넘침
POC_CHROME=<chrome.exe> WEB_DIST=<이 폴더> OUT=<출력> REPO_INT=<extension/integration> node design/mockups/m11-7a/check/shoot-proto.mjs
# 인터랙션 18개 — 실제 마우스 · 키 입력
POC_CHROME=… WEB_DIST=… OUT=… REPO_INT=… node design/mockups/m11-7a/check/interact.mjs
# 지금 앱 기준 사진 (WEB_DIST = 루트 npm run build 의 dist)
POC_CHROME=… WEB_DIST=<dist> OUT=… REPO_INT=… node design/mockups/m11-7a/check/shoot-current.mjs
```

결과: 렌더링 20화면 — 콘솔 오류 0 · 외부 요청 0 · localStorage/sessionStorage 접근 0 · 가로 넘침 0 (`check/result-render.json`) ·
인터랙션 18/18 (`check/result-interact.json`). 실기기 터치 · 화면 낭독기는 확인하지 않았다.
