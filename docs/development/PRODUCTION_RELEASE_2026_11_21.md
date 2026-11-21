# 설명 글 줄이기 · 행 아이콘 · Moments 두 칸 운영 배포 — 2026-11-21 KST

## 결과

**https://39page.com 반영 및 운영 확인 완료.** 사용자 요청("배포를 진행해줘")에 따라 기존 경로(`main` push → Cloudflare Workers Builds).

| 항목                           | 값                                                                                                                            |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| 배포 커밋                      | **`e934828122502a0c03e40bb0a198a20997db9683`** (ADR 0044)                                                                     |
| 기존 main                      | `0fc990f2b56a440cb87b6f367eeca16e6da6ef7f`                                                                                    |
| push                           | 2026-11-21 22:45 KST, `0fc990f..e934828` fast-forward (force push 아님)                                                       |
| Workers Builds                 | [성공한 GitHub check](https://github.com/Jwavascript/39page/runs/136865329923) · Build `363dc7e6-ba4e-4c4b-9908-89d2e5cfe8c3` |
| 새 Worker Version ID (CI 보고) | **`22d39930-4feb-4dbd-acb6-d9601f35f998`** (22:47:06 KST 완료)                                                                |
| 이전 Version ID                | `234ec425-4c70-45ab-bcc3-a958ed69989b`                                                                                        |
| 운영 HTTP                      | **16/16** (운영과 같은 브리지 설정으로 만든 빌드와 바이트 비교)                                                               |
| 운영 실제 Chrome               | **100/100** — smoke 7 · ux 47 · queue 15 · search 5 · share-dialog 15 · quiet-ui 11 (모두 첫 실행)                            |

## 무엇이 배포됐나

[ADR 0044](../decisions/0044-quiet-ui-row-icons-and-two-pane-moments.md) · [작업 보고](QUIET_UI_REPORT.md) — 늘 보이던 설명 글 삭제,
카세트 머리 글(SYNTH / CASSETTE) 삭제, NOW PLAYLIST 의 "보관함에서 편집" 삭제(데크가 고른 목록의 곡으로 연다), 아이콘만 있는 단추
(보관함 닫기 × 등), 곡 · 목록 · Moment 행의 "관리" 메뉴 대신 오른쪽 아이콘(연필 · 공유 · 휴지통), Moments 탭 두 칸. 저장 키 · 백업 형식 ·
공유 링크 형식 · 확장 계약 변경 없음. 새 의존성 없음. Chrome Web Store 업로드 없음.

## 운영 확인

- 2026-11-20 셋째 배포의 다섯 스위트에 이번 기능 확인(`quiet-ui`)을 더해 주소만 운영으로 바꿔 돌렸다
  ([`check/live.mjs`](production-release-2026-11-21-results/check/live.mjs)). 버리는 임시 프로필 · 합성 데이터만 썼다.
- 운영 첫 화면이 내려준 `main-DfhXR8Q4.js` 는 이 커밋의 로컬 빌드와 같다.
- 이 PC 에는 `gh` 가 없어 CI 결과는 공개 GitHub API(check-runs)로 읽었다.

원본: [배포 메타데이터](production-release-2026-11-21-results/deployment.json) · [CI](production-release-2026-11-21-results/ci.json) ·
[HTTP](production-release-2026-11-21-results/http.json) · [실제 Chrome 요약](production-release-2026-11-21-results/live-summary.json).

## 되돌리기

로컬 브랜치 `rollback/quiet-ui` — 이 기록이 들어간 main 위에 `0fc990f` 의 트리를 담은 커밋. push 하지 않았고 실행하지 않았다.
필요하면 `git push origin rollback/quiet-ui:main` 뒤 Workers Builds 성공과 HTTP 를 다시 본다. 저장 형식이 같아 사용자 데이터는 그대로
읽힌다.

## TODO

- 바닥 테마 표기(SYNTH CASSETTE · PIXEL × KAWAII / RECORD LIBRARY / PLAYLIST FIRST)와 Mono 데크의 "MONO VINYL / DIRECT DRIVE / 01"
  도 뺄지 — 사용자 확인.
- 실제 터치 기기(손잡이 · 순서 모드), macOS · Android · Safari · Firefox 확인.
- 실사용 — 아이콘만으로 앨범아트 · 순서 모드를 찾는지.
