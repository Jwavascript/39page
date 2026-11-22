# 민트 음표 탭 아이콘 운영 배포 — 2026-11-22 KST (셋째)

## 결과

**https://39page.com 반영 및 운영 확인 완료.** 사용자 요청("배포를 진행해줘")에 따라 기존 경로(`main` push → Cloudflare Workers Builds).

| 항목                           | 값                                                                                                                              |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| 배포 커밋                      | **`6ebbb62153cbab4c2a6c2b49a2ef605ba5e29e2d`** (탭 아이콘)                                                                      |
| 기존 main                      | `b66f1a55d9b4ebe84eb51a7941ef87b5f00d5880`                                                                                      |
| push                           | 2026-11-22 16:45 KST, `b66f1a5..6ebbb62` fast-forward (force push 아님)                                                         |
| Workers Builds                 | [성공한 GitHub check](https://github.com/Jwavascript/39page/runs/137138700066) · Build `99114c82-9ee2-4270-8a2e-b7ec17e09c18`   |
| 새 Worker Version ID (CI 보고) | **`1b820b2c-de1f-4649-befe-f071740dda11`** (16:47:35 KST 완료)                                                                  |
| 이전 Version ID                | `c46fe088-fc16-46e4-9c39-b0f9f06d4426`                                                                                          |
| 운영 HTTP                      | **19/19** (운영과 같은 브리지 설정으로 만든 빌드와 바이트 비교 — `favicon.svg` · `favicon.ico` 포함)                            |
| 운영 실제 Chrome               | **119/119** — smoke 7 · ux 47 · queue 15 · search 5 · share-dialog 15 · quiet-ui 11 · custom-theme 11 · lyrics 8 (모두 첫 실행) |

## 무엇이 배포됐나

탭 아이콘을 민트 8분음표로 바꿨다 — `favicon.svg`(최신 브라우저)와 같은 그림으로 만든 `favicon.ico`(16 · 32 · 48, 아이콘 링크가 없는
`/privacy` 포함). 운영 응답: `favicon.svg` 200 `image/svg+xml`, `favicon.ico` 200 `image/vnd.microsoft.icon`. 저장 형식 · 확장 계약 변경
없음. 새 의존성 없음. Chrome Web Store 업로드 없음(확장 1.0.1 패키지는 별도 브랜치 `release/extension-1.0.1`, 이 배포와 무관).

원본: [배포 메타데이터](production-release-2026-11-22c-results/deployment.json) · [CI](production-release-2026-11-22c-results/ci.json) ·
[HTTP](production-release-2026-11-22c-results/http.json) · [실제 Chrome 요약](production-release-2026-11-22c-results/live-summary.json).

## 되돌리기

로컬 브랜치 `rollback/mint-favicon` — 이 기록이 들어간 main 위에 `b66f1a5` 의 트리를 담은 커밋. push 하지 않았고 실행하지 않았다.

## TODO

- 브라우저가 옛 아이콘을 기억하면 새로고침 · 탭 다시 열기 뒤 바뀐다. 실제 탭 모습은 사용자 화면에서 확인.
