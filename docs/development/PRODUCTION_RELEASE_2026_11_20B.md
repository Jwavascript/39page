# 공유 입구 · 카드 앨범아트 · 개인정보 처리방침 · CWS 작업 통합 운영 배포 — 2026-11-20 KST (둘째)

## 결과

**https://39page.com 반영 및 운영 확인 완료.** 사용자 요청("사용자 앨범아트를 카드에 넣어줘 … 다른 작업 줄기에 있는 걸 검토해
통합하고 배포해줘")에 따라 기존 Git 연동 경로(`main` push → Cloudflare Workers Builds)로 진행했다.

| 항목                           | 값                                                                                                                            |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| 배포 커밋                      | **`799fb18d541a23ad3578a5fa3ace4a090962ad3f`**                                                                                |
| 기존 main                      | `95b0d7bd93d53b4b980be48c1a1a455823ac0e39` (첫 배포 기록)                                                                     |
| push                           | 2026-11-20 21:08:55 KST, `95b0d7b..799fb18` fast-forward (force push 아님)                                                    |
| Workers Builds                 | [성공한 GitHub check](https://github.com/Jwavascript/39page/runs/136279159801) · Build `a99a3180-720e-4973-a370-79d8a882629e` |
| 새 Worker Version ID (CI 보고) | **`7dbb7d49-1219-4cd8-a6a9-e12a1e7db7d8`** (21:10:26 KST 완료)                                                                |
| 이전 Version ID (95b0d7b)      | `20f7d311-e92b-48dd-9718-f11bec0bc960`                                                                                        |
| 운영 HTTP                      | **16/16** (운영과 같은 브리지 설정으로 만든 빌드와 바이트 비교)                                                               |
| 운영 실제 Chrome               | **123/123** (첫 실행 112/113 — 아래)                                                                                          |

## 무엇이 배포됐나

- **ADR 0042** — 지금 재생 카드의 `YOUTUBE에서 열기` 자리에 공유 아이콘(지금 곡), 데크(카세트 · LP) 안내 옆에 목록 공유 아이콘.
  YouTube 링크는 재생 오류 안내 아래에만. 공유 카드 다섯 틀에 사용자가 올린 앨범아트("내 앨범아트 넣기" 로 끔).
  [작업 보고](SHARE_ENTRY_REPORT.md).
- **개인정보 처리방침** — "공유 링크와 이미지 카드" 항목을 더하고 시행일을 2026-11-20 으로(최초 2026-11-18 명시).
- **CWS 작업 줄기 통합** — `fix/extension-clear-playlist-after-save`(확장: 저장 확인 뒤 목록 선택 해제 · 시간 초과 구분 · 브리지 버전
  확인 · 패키지 출처 기록, 툴바 아이콘 확대, 로컬 시험 ID 를 운영 허용 목록에서 막는 `vite.config.ts` 검사, CWS 출시 · 진단 문서,
  11-16 배포 기록)와 `fix/store-bridge-aaihan`(Store 브리지 활성화 후보 기록). 웹 런타임 코드는 바뀌지 않았다 — 운영 웹에 닿는 것은
  `vite.config.ts` 의 빌드 검사뿐이고, 운영 ID(`aaihan…`)는 그 검사를 통과한다.
- 저장 키 · 라이브러리 · 백업 형식 · 확장 계약 변경 없음. 새 의존성 없음. **Chrome Web Store 업로드 없음** — 확장 코드는 main 에
  들어갔지만 Store 에 올리는 것은 사용자의 일이다.

## 통합

- 메인 작업 폴더(`C:/Users/phoria/39page`, 브랜치 `fix/extension-clear-playlist-after-save`)의 미커밋 변경을 내용 그대로 그 브랜치에
  두 커밋으로 남겼다 — `cb3c360` 툴바 아이콘, `42653a0` 개인정보 · Listing · 업로드 이미지 · BUG-001 진단. 그 폴더는 깨끗하다.
- `origin/main` 에서 `release/share-entry-cws` 를 만들고 세 브랜치를 `--no-ff` 로 병합했다. 충돌은 없었다. `public/privacy.html` 은
  병합 뒤 게시된 판(c754100)과 같았고, 그 위에 공유 항목을 더했다(`cc9988c`).
- 다른 줄기에서 온 두 파일이 Prettier 를 통과하지 못해 모양만 고쳤다 (`EXTENSION_TOOLBAR_ICON_REPORT.md`, 확장
  `integration/cassette-design.mjs` — `799fb18`).
- 검토: 확장 변경(시간 초과 이유 · 목록 조회 실패 문구 · 저장 성공 뒤 선택 해제 감시 · 브리지 응답의 `v` 확인)은 웹 브리지가 모든
  메시지에 `v: 1` 을 넣으므로 호환된다. 시험 430개가 통과했다.

## 통합 커밋의 검사

| 검사                                                        | 결과                                                                 |
| ----------------------------------------------------------- | -------------------------------------------------------------------- |
| root `npm test`                                             | **2,235 통과** (73파일)                                              |
| root `npm run type-check` · `lint` · `format:check` · build | 통과                                                                 |
| extension `npm test`                                        | **430 통과** (26파일)                                                |
| extension type-check · lint · format:check · build+Manifest | 통과 (format 은 `799fb18` 뒤)                                        |
| extension `npm run package` (로컬만)                        | 통과 — 소스맵 · 개발 주소 · eval 없음, 다시 읽기 일치. 올리지 않았다 |
| `prepare-production-bridge.mjs aaihan…` (로컬 후보)         | 통과 — 두 브리지 경로에 공식 ID 한 개, 브리지 JS 에 ID               |
| 실제 Chrome (로컬 빌드) `share-entry.mjs`                   | 20/20 ([결과](share-entry-results/real-chrome-share-entry.json))     |

## 운영에서 확인한 것

원본: [배포 메타데이터](production-release-2026-11-20b-results/deployment.json) · [CI](production-release-2026-11-20b-results/ci.json) ·
[HTTP](production-release-2026-11-20b-results/http.json) · [실제 Chrome 요약](production-release-2026-11-20b-results/live-summary.json).

- HTTP 16/16 — 공개 자산(새 main · 공유 묶음 · privacy.html 포함)이 `VITE_BRIDGE_EXTENSION_IDS=aaihan…` 로 만든 로컬 빌드와 바이트까지
  같고, 브리지 두 경로의 헤더가 그 빌드의 `_headers` 와 같다. `/privacy` 에 "공유 링크와 이미지 카드" · 새 시행일이 보인다.
- 실제 Chrome(버리는 임시 프로필 · 합성 데이터): smoke 7 · ux 49 · queue 15 · search 5 · sharelink 10 · sharecard 17 · share-entry 20.
  - 첫 실행에서 queue 가 "전체 반복 — 끝나면 처음 곡" 단계에서 시간 초과로 멈췄다(10개 중 9 통과, 나머지 미실행 — [첫 실행 결과](production-release-2026-11-20b-results/queue-first-run.json)).
    실제 YouTube 영상을 끝 3초 전으로 옮겨 끝나기를 기다리는 단계다. 이번 변경은 그 단추(`button.mode`)를 건드리지 않는다. 다시 실행해
    15/15 였다.
  - share-entry 는 운영에서도 실제 YouTube 가 합성 영상 ID 를 거절(오류 150)할 때 안내 아래 YouTube 링크가 서는 것을 봤다.

## 되돌리기

로컬 브랜치 `rollback/share-entry-cws` — 이 기록이 들어간 main 위에 `95b0d7b` 의 트리를 담은 커밋(fast-forward 로 올릴 수 있다).
push 하지 않았고 실행하지 않았다. 필요하면 `git push origin rollback/share-entry-cws:main` 뒤 Workers Builds 성공과 HTTP 를 다시 본다.
브리지 빌드 변수는 그대로 두면 된다(이전 판도 같은 ID 로 빌드됐다). 사용자 데이터는 형식이 같아 되돌려도 그대로 읽힌다 — 다만 되돌리면
카드의 앨범아트 · 공유 아이콘이 사라지고 처리방침이 11-18 판으로 돌아간다.

## TODO

- Store 설치본으로 실제 조회 · 저장 끝까지 확인 (STORE_BRIDGE_ACTIVATION "배포 후 TODO").
- 확장 새 패키지 업로드 — main 의 확장 코드가 Store 에 올라간 판보다 새로울 수 있다. 올리려면 `manifest.json` 버전을 올려야 한다
  (지금 1.0.0). 사용자 결정.
- 실제 게시판에 그림이 든 카드 올리기 · macOS · Android · Safari · Firefox 확인.
