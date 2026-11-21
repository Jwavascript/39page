# 커스텀 테마 운영 배포 — 2026-11-22 KST

## 결과

**https://39page.com 반영 및 운영 확인 완료.** 사용자 요청("배포를 진행해줘")에 따라 기존 경로(`main` push → Cloudflare Workers Builds).

| 항목                           | 값                                                                                                                            |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| 배포 커밋                      | **`e80bd4aad716403b41560b8c58500f085f8f4f8a`** (ADR 0045)                                                                     |
| 기존 main                      | `5dae877f89e38e8e7426ce5684facdd123551960`                                                                                    |
| push                           | 2026-11-22 00:53 KST, `5dae877..e80bd4a` fast-forward (force push 아님)                                                       |
| Workers Builds                 | [성공한 GitHub check](https://github.com/Jwavascript/39page/runs/136899045362) · Build `4e71a052-80aa-471b-ae51-6ddc14c7810c` |
| 새 Worker Version ID (CI 보고) | **`01c7dabe-7b31-4008-a4f4-338d7c7a3378`** (00:55:25 KST 완료)                                                                |
| 이전 Version ID                | `22d39930-4feb-4dbd-acb6-d9601f35f998`                                                                                        |
| 운영 HTTP                      | **18/18** (운영과 같은 브리지 설정으로 만든 빌드와 바이트 비교, `/privacy` 새 문구)                                           |
| 운영 실제 Chrome               | **111/111** — smoke 7 · ux 47 · queue 15 · search 5 · share-dialog 15 · quiet-ui 11 · custom-theme 11 (모두 첫 실행)          |

## 무엇이 배포됐나

[ADR 0045](../decisions/0045-custom-theme.md) · [작업 보고](CUSTOM_THEME_REPORT.md) — 셋째 테마 `03 / CUSTOM`: 데크 자리에 사용자
그림 · 움짤(재생 중에만 움직임, 누르면 보관함, ■ · ▶), 다섯 색에서 만드는 테마 색과 저장 전 미리보기, 설정 창(헤더 팔레트 · 빈
데크의 "이미지 넣기"), JSON 백업의 색 · 전체 백업의 데크 그림, 고른 색의 공유 카드. 개인정보 처리방침에 커스텀 테마 색 ·
데크 그림의 저장 위치를 적었다.

새 저장소 둘(`localStorage` `39page.customTheme`, IndexedDB `39page-theme`). 기존 저장 키 · 백업 형식(데크 그림이 없으면 전체
백업 `formatVersion` 2 그대로) · 공유 링크 형식 · 확장 계약 변경 없음. 새 의존성 없음. Chrome Web Store 업로드 없음.

## 운영 확인

- 2026-11-21 배포의 여섯 스위트에 이번 기능 확인(`custom-theme`)을 더해 주소만 운영으로 바꿔 돌렸다
  ([`check/live.mjs`](production-release-2026-11-22-results/check/live.mjs)). 버리는 임시 프로필 · 합성 데이터 · 합성 그림만 썼다.
- 운영 첫 화면이 내려준 `main-DaVGKiZB.js` 는 이 커밋의 로컬 빌드와 같다. CI 결과는 공개 GitHub API(check-runs)로 읽었다.

원본: [배포 메타데이터](production-release-2026-11-22-results/deployment.json) · [CI](production-release-2026-11-22-results/ci.json) ·
[HTTP](production-release-2026-11-22-results/http.json) · [실제 Chrome 요약](production-release-2026-11-22-results/live-summary.json).

## 되돌리기

로컬 브랜치 `rollback/custom-theme` — 이 기록이 들어간 main 위에 `5dae877` 의 트리를 담은 커밋. push 하지 않았고 실행하지 않았다.
필요하면 `git push origin rollback/custom-theme:main` 뒤 Workers Builds 성공과 HTTP 를 다시 본다. 되돌리면 커스텀 테마를 고른
사용자는 기본 테마(카세트)로 보이고, 저장된 색 · 데크 그림은 지우지 않고 남는다(다시 배포하면 그대로 보인다).

## TODO

- 실제 YouTube 재생 중 움짤 움직임 · 터치 기기의 끌어 맞추기 · macOS · Android · Safari · Firefox 의 `color-mix()` 표시.
- 데크 그림 · 색을 공유 링크로 보내기 (범위 밖).
