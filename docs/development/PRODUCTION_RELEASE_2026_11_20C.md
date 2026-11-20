# 공유 대화상자 분리 · 데이터 대화상자 단순화 운영 배포 — 2026-11-20 KST (셋째)

## 결과

**https://39page.com 반영 및 운영 확인 완료.** 사용자 요청("배포를 진행해줘")에 따라 기존 경로(`main` push → Cloudflare Workers Builds).

| 항목                           | 값                                                                                                                            |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| 배포 커밋                      | **`7d494b0679680999fc7538cc14b46636848a9279`** (ADR 0043)                                                                     |
| 기존 main                      | `8941c77526914af7d45e1922bcb89cc05d20e201`                                                                                    |
| push                           | 2026-11-20 23:03:43 KST, `8941c77..7d494b0` fast-forward (force push 아님)                                                    |
| Workers Builds                 | [성공한 GitHub check](https://github.com/Jwavascript/39page/runs/136335627913) · Build `fb200e17-97fb-419f-a6ea-caf6932a6aed` |
| 새 Worker Version ID (CI 보고) | **`234ec425-4c70-45ab-bcc3-a958ed69989b`** (23:05:38 KST 완료)                                                                |
| 이전 Version ID                | `3e9c8737-25ef-446c-9d2d-f1a8ea90eee0`                                                                                        |
| 운영 HTTP                      | **16/16** (운영과 같은 브리지 설정으로 만든 빌드와 바이트 비교, `/privacy` 새 문구)                                           |
| 운영 실제 Chrome               | **89/89** — smoke 7 · ux 47 · queue 15 · search 5 · share-dialog 15 (첫 실행의 ux 는 아래)                                    |

## 무엇이 배포됐나

[ADR 0043](../decisions/0043-share-dialog-and-backup-only-data-dialog.md) · [작업 보고](SHARE_DIALOG_REPORT.md) — 따로 된 공유 대화상자,
옮기기 전용 데이터 · 백업(단추 둘), 파일(ZIP) 공유 삭제, 고르는 칸 없는 공유(대상이 정함), 곡 · Moment 싱글 카드는 곡 이름과 시점별
메모(기본 그림 없음, 높이는 내용만큼), 카드의 "39page 에서 듣기" 글 대신 ▶. 개인정보 처리방침에 곡 · Moment 공유는 메모가 함께
들어간다고 적었다. 저장 키 · 백업 형식 · 공유 링크 형식 · 확장 계약 변경 없음. 새 의존성 없음. Chrome Web Store 업로드 없음.

## 운영 확인에서 고친 것

- 첫 실행의 ux(M12-6 확인)는 15/16 에서 멈췄다 — 곡 공유 대상을 옛 목록 · 범위 고르기로 읽고, 없어진 파일(ZIP) 공유를 내려받으려 했다.
  제품 문제가 아니라 확인 스크립트가 ADR 0043 이전 화면을 본 것이다. 공유 대상은 새 대화상자의 한 줄로 읽고, 전체 백업 단추 이름을
  고치고, 파일 공유를 내려받아 다시 가져오는 두 확인은 기능과 함께 뺐다. 다시 실행해 47/47.
- 옛 공유 확인 세 개(sharelink 의 보내는 쪽 고르기 · sharecard 의 고르기 · share-entry 의 앨범아트 끄기)는 없어진 고르는 칸을 누르므로
  이번 운영 확인에서 돌리지 않았다. 대신 share-dialog 가 보내기(목록 · 곡 · Moment) · 카드 · 받는 쪽 미리보기를 본다.

원본: [배포 메타데이터](production-release-2026-11-20c-results/deployment.json) · [CI](production-release-2026-11-20c-results/ci.json) ·
[HTTP](production-release-2026-11-20c-results/http.json) · [실제 Chrome 요약](production-release-2026-11-20c-results/live-summary.json).

## 되돌리기

로컬 브랜치 `rollback/share-dialog` — 이 기록이 들어간 main 위에 `8941c77` 의 트리를 담은 커밋. push 하지 않았고 실행하지 않았다.
필요하면 `git push origin rollback/share-dialog:main` 뒤 Workers Builds 성공과 HTTP 를 다시 본다. 저장 형식이 같아 사용자 데이터는 그대로
읽힌다.

## TODO

- 앨범아트 저장 공간 정리(쓰지 않는 그림)의 화면 자리 — 지금은 없다.
- 실제 게시판에서 새 싱글 카드 · macOS · Android · Safari · Firefox 확인.
- 받는 쪽의 자세한 확인(sharelink 의 받기 부분)을 새 화면에 맞춰 다시 쓸지.
