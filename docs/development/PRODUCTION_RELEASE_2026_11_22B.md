# 가사 위젯 · 목록 칸 고정 · 푸터 삭제 운영 배포 — 2026-11-22 KST (둘째)

## 결과

**https://39page.com 반영 및 운영 확인 완료.** 사용자 요청("배포를 진행해줘")에 따라 기존 경로(`main` push → Cloudflare Workers Builds).

| 항목                           | 값                                                                                                                            |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| 배포 커밋                      | **`03b6b7d9e85bcdebca4b7b14dccc55e09af78286`** (ADR 0046)                                                                     |
| 기존 main                      | `23d4f9c3cf21ddee291a02fa26f4d402d7d03931`                                                                                    |
| push                           | 2026-11-22 02:21 KST, `23d4f9c..03b6b7d` fast-forward (force push 아님)                                                       |
| Workers Builds                 | [성공한 GitHub check](https://github.com/Jwavascript/39page/runs/136923526605) · Build `d8bfc6f2-fe4e-490e-a418-dd2beb3d3f15` |
| 새 Worker Version ID (CI 보고) | **`8c29501d-3cf5-4cd3-ad7d-fe47e1254467`** (02:23:00 KST 완료)                                                                |
| 이전 Version ID                | `8fb2410d-b490-49bc-bcd9-1ec9b9529452`                                                                                        |
| 운영 HTTP                      | **18/18** (운영과 같은 브리지 설정으로 만든 빌드와 바이트 비교, `/privacy` 의 LRCLIB 문구)                                    |
| 실제 LRCLIB                    | **1/1** — 운영 페이지 안에서 앱과 같은 머리로 검색, CORS 통과 · 싱크 가사 있는 DUNE 레코드                                    |
| 운영 실제 Chrome               | **119/119** — smoke 7 · ux 47 · queue 15 · search 5 · share-dialog 15 · quiet-ui 11 · custom-theme 11 · lyrics 8 (아래)       |

## 무엇이 배포됐나

[ADR 0046](../decisions/0046-lyrics-widget-fixed-lists-no-footer.md) · [작업 보고](LYRICS_REPORT.md) — LRCLIB 가사 위젯(자동은 제목의 영어
낱말 · 곡 길이로, 못 찾으면 돋보기로 직접 찾아 곡마다 기억), 넓은 화면은 재생 카드 아래 · 두 열은 데크 아래, 700px 넘는 배치의
NOW PLAYLIST · Moments 칸 높이 고정, 푸터 삭제, 개인정보 처리방침의 LRCLIB 문구. 새 외부 요청 `https://lrclib.net`, 새 저장 키
`39page.lyrics`. 기존 저장 · 백업 · 공유 링크 형식과 확장 계약 변경 없음. 새 의존성 없음. Chrome Web Store 업로드 없음.

## 운영 확인에서 있었던 일

- custom-theme(ADR 0045 확인)이 첫 실행에서 5단계(움짤 포스터)에서 멈췄다. 다시 돌리니 11/11. 확인 스크립트의 클릭 도우미가
  스크롤 직후 바로 합성 마우스 이벤트를 보내는 탓으로 본다 — 같은 원인을 share-dialog 에서 로컬로 재현 · 확인했다(LYRICS_REPORT).
  custom-theme · lyrics 확인의 도우미도 두 프레임 기다린 뒤 다시 재도록 고치고 운영에서 다시 돌려 11/11 · 8/8.
- lyrics 확인은 LRCLIB 를 합성 응답으로 가로챈다. 실제 LRCLIB 는 [`check/lrclib-live.mjs`](production-release-2026-11-22b-results/check/lrclib-live.mjs)
  가 운영 페이지 안에서 따로 봤다.

원본: [배포 메타데이터](production-release-2026-11-22b-results/deployment.json) · [CI](production-release-2026-11-22b-results/ci.json) ·
[HTTP](production-release-2026-11-22b-results/http.json) · [실제 LRCLIB](production-release-2026-11-22b-results/lrclib-live.json) ·
[실제 Chrome 요약](production-release-2026-11-22b-results/live-summary.json).

## 되돌리기

로컬 브랜치 `rollback/lyrics-widget` — 이 기록이 들어간 main 위에 `23d4f9c` 의 트리를 담은 커밋. push 하지 않았고 실행하지 않았다.
필요하면 `git push origin rollback/lyrics-widget:main` 뒤 Workers Builds 성공과 HTTP 를 다시 본다. `39page.lyrics` 는 이전 버전이
읽지 않을 뿐 지우지 않는다.

## TODO

- 직접 고른 가사를 백업에 넣을지 (사용자 확인).
- 한국어 제목 자동 찾기 · 실제 터치 기기 · macOS · Android · Safari · Firefox.
