# 재생 큐 UX · YouTube 검색 · 링크 공유 · 공유 카드 운영 배포 — 2026-11-20 KST

## 결과

**https://39page.com 반영 및 운영 확인 완료.** 사용자 요청("일단 구현 후 배포해서 실기기에서 사용 후 개선해보자")에 따라 기존 Git 연동
경로(`main` push → Cloudflare Workers Builds)로 진행했다.

| 항목                               | 값                                                                                                                            |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| 배포 커밋                          | **`b88ab35d3b4720dfb0fa36b595c09eca80bf3e3d`** (병합)                                                                         |
| 브랜치                             | 로컬 main 및 origin/main 모두 위 커밋                                                                                         |
| 기존 main                          | `c75410014f275718a5bd735c7348121ffcbd4eda` (개인정보 처리방침 게시, 2026-11-18)                                               |
| 기능 커밋                          | `4412277` ADR 0038 · `a6d5f7b` ADR 0039 · `70c933e` ADR 0040 · `f774ee0` ADR 0041                                             |
| push                               | 2026-11-20 17:54:21 KST, `c754100..b88ab35` fast-forward (force push 아님)                                                    |
| Workers Builds                     | [성공한 GitHub check](https://github.com/Jwavascript/39page/runs/136187266688) · Build `10aa4592-9cf0-4da7-9492-dfb14e3a5ff4` |
| 새 Worker Version ID (CI 보고)     | **`349c8ccf-c11e-43cb-9b7f-830d09a42213`** (17:56:11 KST 완료)                                                                |
| 이전 Version ID (c754100, CI 보고) | `6bbd6023-c7e7-4a89-bf18-745c0ea00649`                                                                                        |
| 운영 HTTP                          | **16/16** (운영과 같은 브리지 설정으로 만든 빌드 기준)                                                                        |
| 운영 실제 Chrome                   | **103/103** (첫 실행 102/103 — 확인 스크립트의 낡은 선택자, 아래)                                                             |

## 무엇이 배포됐나

- **ADR 0038** — 재생 큐가 출처 목록을 바로 따른다(곡 추가 · 삭제 · 순서 · 이름, 안내 없음, 지금 곡 · 위치 유지). NOW PLAYLIST 의 목록
  바꾸기는 그 목록을 처음부터 재생. 셔플 · 반복(끔 · 전체 · 한 곡)을 ⏮ ▶ ⏭ 와 한 줄에. 메모리에만 있고 새로고침하면 꺼진다.
- **ADR 0039** — "YouTube에서 검색" — API 키 없이 YouTube 검색 결과를 새 탭으로 연다. 검색어를 보내거나 저장하지 않는다.
- **ADR 0040** — 링크로 공유(목록 · 곡 · Moment) — 내용을 주소 조각(`#share?v=1&d=`)에 담는다. 받는 쪽 미리보기, 고르기 전에는 저장 ·
  재생하지 않는다.
- **ADR 0041** — 공유 카드 이미지 — 테마별 카세트 J카드 · LP 뒷면 · 영수증 · 싱글 PNG, 이미지 복사 · 저장. QR · 안내 문구 없음,
  시스템 글꼴.
- 저장 키 · 라이브러리 형식 · 백업 형식 · 확장 계약 변경 없음. 새 의존성 없음. Chrome Web Store 업로드 없음.

## 통합 · 데이터 보호

- `origin/main`(c754100)에서 `release/playback-share` 를 만들고 `feat/playback-queue-ux` 를 `--no-ff` 로 병합했다. 충돌 없었고 양쪽
  이력을 보존했다. 병합 결과는 검증한 기능 끝(f774ee0)과 `public/privacy.html` 하나만 다르다(c754100 의 것).
- 기능 커밋 네 개가 **각자 혼자서** type-check · 전체 테스트 · lint 를 통과하는지 확인했다(68파일/2,162 · 68/2,170 · 70/2,200 ·
  72/2,221) — 나중에 한 커밋만 되돌리거나 찾아갈 때 깨진 중간 상태가 없게.
- main 을 fast-forward 한 뒤 `git push origin main` 을 실행했고 성공했다. 직전에 `git ls-remote` 로 원격 main 이 c754100 그대로임을 확인했다.
- 11-16 배포 때와 달리 평소 프로필에는 실제 사용 데이터가 있을 수 있다. 이번 배포는 저장 형식을 바꾸지 않으므로 기존 데이터를 그대로
  읽는다. 평소 프로필 · 사이트 데이터를 열거나 지우지 않았다. 운영 확인은 매번 새 임시 Chrome 프로필에서 합성 데이터로만 했다.
- 게시된 개인정보 처리방침(c754100)과 대조했다. 새 기능이 방침과 어긋나는 흐름을 만들지 않는다 — 링크는 주소 조각(서버로 가지 않음),
  곡 이름 없는 링크의 제목 찾기는 방침에 적힌 YouTube oEmbed, 검색은 사용자가 여는 YouTube 링크, 카드는 이 브라우저 안. 다만 방침에
  `#share` 조각 설명은 없다 — TODO (아래).

## 통합 커밋(b88ab35)의 검사

| 검사                                             | 결과                                                                                                    |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| root `npm run type-check`                        | 통과                                                                                                    |
| root `npm run lint`, `npm run format:check`      | 통과 (lint 의 `--fix` 뒤에도 작업 트리 변경 없음)                                                       |
| root `npm test`                                  | **2,221 통과** (72파일)                                                                                 |
| root `npm run build`                             | 통과 — main 321.13 KB (gzip 104.60) · shareCardCanvas 10.33 KB (3.95) · ShareLinkDialog 12.16 KB (4.67) |
| extension `npm test`                             | 26파일 / **420 통과**                                                                                   |
| extension `npm run build`                        | type-check · 빌드 · Manifest 검사 통과                                                                  |
| extension `npm run lint`, `npm run format:check` | 통과                                                                                                    |

## 운영에서 확인한 것

원본: [배포 메타데이터](production-release-2026-11-20-results/deployment.json) · [CI](production-release-2026-11-20-results/ci.json) ·
[이전 CI](production-release-2026-11-20-results/previous-ci.json) · [HTTP](production-release-2026-11-20-results/http.json) ·
[HTTP — 기본 빌드](production-release-2026-11-20-results/http-default-build.json) ·
[브라우저 집계](production-release-2026-11-20-results/live-summary.json) · [변경 파일](production-release-2026-11-20-results/changed-files.md).

### HTTP — 16/16

1. **운영 빌드에는 브리지 확장 ID 가 들어 있다.** 운영 `/bridge` 의 CSP 는
   `frame-ancestors chrome-extension://aaihanclknbboaehbjpmlcefkbgdeima` 다 — CWS 비공개 출시 절차(`CWS_PRIVATE_RELEASE.md` — `fix/extension-clear-playlist-after-save` 브랜치, main 에는 아직 없음)대로 운영 CI
   빌드 환경에 `VITE_BRIDGE_EXTENSION_IDS` 가 설정돼 있다. 같은 값으로 이 커밋을 로컬 빌드하면 공개 자산 12개(index · main JS/CSS ·
   Moments · ShareLinkDialog JS/CSS · shareCardCanvas · 브리지 JS · bridge.html · favicon · privacy.html)와 `/` 가 운영과
   **SHA-256 까지 같고**, 두 브리지 경로의 헤더가 그 빌드의 `_headers` 와 같다. Cloudflare 설정 화면은 읽지 않았다 — 응답과 바이트가
   같은 빌드로 확인한 것이다.
2. 환경 변수 없이 만든 기본 빌드와 비교하면 **12/16** — 브리지 JS · bridge.html · 두 브리지 응답 헤더 4건만 다르다. 앱 쪽 자산(이번에
   바뀐 main · 공유 묶음 · index)은 기본 빌드와도 같다.
3. 11-16 기록의 "운영 직접 저장은 비활성(`frame-ancestors 'none'`)" 은 지금 운영과 다르다. 이것은 그 뒤 CWS 비공개 출시에서 정한
   설정이고 이번 배포가 바꾼 것이 아니다 — 이번 빌드도 같은 CI 설정을 그대로 썼다. 맨 위 창으로 `/bridge` 를 열면 여전히 거부한다(아래 smoke).
4. http · www 는 `https://39page.com/` 으로 301 이동한다.

### 실제 Chrome — 103/103

[`check/live.mjs`](production-release-2026-11-20-results/check/live.mjs) 가 로컬 확인 스크립트를 주소만 운영으로 바꿔 스크립트마다 새
임시 프로필로 돌린다.

| 묶음                      | 결과      | 내용                                                                                                                                                  |
| ------------------------- | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| smoke (Release Gate 회귀) | **7/7**   | 실제 YouTube 재생 · NOW PLAYLIST · 다음/이전 같은 iframe · Moment 저장 · ZIP 에 Moment · 브리지 맨 위 방문 거부 · Collect 확인 전 무저장/확인 후 저장 |
| ux (M12-6 회귀)           | **49/49** | 실제 재생 · 라디오 미리보기 · GIF 구도 · 공유 대상 · 두 테마 × 7 화면 크기 × (대시보드 · 보관함) 배치 · ZIP 복원 · 실제 oEmbed                        |
| queue (ADR 0038)          | **15/15** | 곡 추가 · 순서 · 삭제가 큐에 바로 · 목록 바꾸기 바로 재생 · 셔플 · 전체/한 곡 반복(실제 `ended`) · 테마 전환 유지 · 한 줄 배치 · 저장 키 없음         |
| search (ADR 0039)         | **5/5**   | Enter · 단추가 검색 결과를 새 탭(noopener)으로 · 링크 칸의 곡 이름 → 검색어 · 배치 · 저장 없음                                                        |
| sharelink (ADR 0040)      | **10/10** | 링크 만들기 · 복사 · 길이 경고 · 다른 프로필에서 미리보기 → 추가하고 듣기(실제 재생) · oEmbed 제목 · Moment 링크 · 잘린 링크 거부 · 배치              |
| sharecard (ADR 0041)      | **17/17** | 두 테마 × 목록 10 · 30 · 60곡 · 곡 · Moment, 이미지 복사(클립보드 PNG) · 저장(PNG) · 390px 배치                                                       |

- **첫 실행은 102/103** 이었다 — ux 의 "Playlist management shares unselected target; Moments off". 이 확인은 공유 칸의 **첫 체크박스**가
  꺼져 있기를 기대하는데, ADR 0040 부터 그 위에 "링크로 공유" 칸이 있고 첫 칸 "곡 이름 넣기" 는 기본으로 켜져 있다. 운영에서 같은
  흐름을 따로 열어 확인했다 — 공유 대상 `b`(고르지 않은 목록) · 범위 전체 · **ZIP 의 "Moments 도 넣기" 는 꺼짐** — 제품 동작은
  그대로다. 확인 스크립트(`docs/development/m12-6-results/check/ux.mjs`)가 링크 칸 밖의 체크박스를 보도록 고치고(규칙 7 — ADR 0040
  작업에서 했어야 할 수정) ux 를 다시 돌려 49/49. 첫 결과는 [`ux-first-run.json`](production-release-2026-11-20-results/ux-first-run.json).
- 같은 날 운영에서 그린 카드는 로컬에서 그린 것과 바이트 수가 같다(Kawaii J카드 194,193 · Mono LP 671,937) — 영수증은 시각(HH:MM)이
  들어가 다르다. 스크린샷: [재생 카드](production-release-2026-11-20-results/queue-card-shuffle-repeat-all-1440.png) ·
  [Kawaii J카드](production-release-2026-11-20-results/sharecard-kawaii-playlist-10.png) · [Mono LP](production-release-2026-11-20-results/sharecard-mono-playlist-10.png) ·
  [받는 쪽 미리보기](production-release-2026-11-20-results/sharelink-receiver-dialog-1440.png).

## 준비된 롤백 — 실행하지 않음

롤백은 **지금 원격 main 위에, tree 가 이전 main c754100 과 같은 커밋**을 올리는 것이다 — fast-forward 라 force push 가 아니다. 이
기록(문서 · 확인 스크립트만)도 main 에 올라갔으므로, 처음 준비한 `3a0f8ed`(부모 b88ab35)는 더 이상 fast-forward 가 아니라 쓰지 않는다.
로컬 `rollback/playback-share` 는 이 기록이 올라간 main 위에 다시 만들어 두었다(SHA 는 작업 보고). 운영이 정상이라 실행하거나 push 하지
않았다.

b88ab35 뒤 main 에 **제품 변경이 없을 때만** 그대로 쓴다 — 있으면 그 변경까지 함께 되돌린다.

```powershell
# 별도 장애 대응에서만.
git fetch origin
git diff --stat b88ab35 origin/main -- . ':!docs'   # 비어 있어야 한다 (b88ab35 뒤 제품 변경 없음)
# 준비된 브랜치의 부모가 지금 origin/main 이면 그대로:
git push origin rollback/playback-share:main
# 아니면 지금 main 위에 새로 만든다:
$tree = git rev-parse 'c754100^{tree}'
$commit = git commit-tree $tree -p origin/main -m 'revert(release): roll back main to c754100'
git push origin "${commit}:refs/heads/main"
# Workers Builds 가 이전 코드 tree 를 다시 배포한다.
```

Cloudflare 에 로그인한 담당자는 이전 Version ID `6bbd6023-c7e7-4a89-bf18-745c0ea00649` 로 직접 되돌릴 수도 있다(이 세션에는 관리 인증이
없다). 코드 롤백은 사용자 데이터를 되돌리지 않는다 — 이번 배포는 저장 형식을 바꾸지 않았으므로 롤백해도 기존 데이터를 그대로 읽는다.
롤백하면 링크 공유 · 카드 · 셔플 · 반복이 사라지고, 이미 퍼진 `#share` 링크는 첫 화면만 열린다(미리보기가 뜨지 않는다).

## 운영 사용 시작

- 평소 열린 39page 탭을 새로고침한다. 사이트 데이터 · IndexedDB 를 지우지 않는다.
- 셔플 · 반복은 새로고침하면 꺼진다(의도한 동작).
- 공유: 보관함 → 목록 "관리" → "이 목록 공유" (곡은 곡 "관리" → "이 곡 공유", Moment 는 Moments 탭 "관리" → "링크로 공유") → 링크 복사 ·
  이미지 복사 → 게시판 글에 이미지를 붙여 넣고 링크를 건다.

## TODO · 남은 확인

- TODO: 실제 게시판에 카드 이미지 + 링크를 올려 보기 — 이미지에 링크 걸기, 게시판의 재압축, 긴 링크가 잘리는지(사용자 실기기 사용).
- TODO: 사용자가 직접 올린 앨범아트를 카드에 넣을지 (결정 대기).
- TODO: 개인정보 처리방침에 `#share` 링크(내용을 주소 조각에 담음 · 서버로 가지 않음 · 곡 이름 없는 링크는 열 때 oEmbed) 문구 —
  `public/privacy.html` 은 다른 작업 트리에서 고치는 중이라 이번에 건드리지 않았다.
- 확인한 브라우저는 Windows Chrome 뿐이다. macOS · Android 의 시스템 글꼴, Safari · Firefox 의 이미지 복사, 폰은 보지 못했다.
- CWS 작업 줄기(`fix/extension-clear-playlist-after-save` 브랜치와 그 작업 폴더의 미커밋 변경 — 확장 코드 · 아이콘 · CWS 문서 ·
  `vite.config.ts` 의 시험 확장 ID 검사)는 이번 배포에 넣지 않았다. 따로 검토해 통합한다.

## 이 기록의 배포

이 기록과 확인 스크립트 수정(ux.mjs 선택자)은 사용자 요청("지금까지 내용을 커밋 후 배포해줘")으로 main 에 올렸다. 문서 · 확인
스크립트만 바뀌므로 웹 자산은 b88ab35 와 같다. 그 빌드의 Version ID 는 이 커밋이 그 빌드를 만들기 때문에 여기 적을 수 없다 —
GitHub check 에서 본다.
