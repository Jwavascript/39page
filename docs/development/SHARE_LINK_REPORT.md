# 링크로 공유 (ADR 0040) — 작업 보고

- 날짜: 2026-11-20 · 브랜치 `feat/playback-queue-ux` (별도 작업 폴더, 커밋 · push · 배포 없음)
- 결정 기록: [ADR 0040](../decisions/0040-share-links-in-url-fragment.md) · 공유 카드 이미지 리서치: [SHARE_CARD_RESEARCH](../product/SHARE_CARD_RESEARCH.md)

## 1. 요청

커뮤니티 게시판(첨부 파일 불가, 노래 게시판은 사이트의 YouTube 검색으로만 글쓰기)에 목록 · 곡을 공유하고 싶다 — 이미지를 올리고
그 이미지에 링크를 거는 방식. 사용자 결정: ① 링크 공유(목록 · 곡 · Moment) 구현, ③ 공유 카드 이미지는 디자인 리서치까지.
② YouTube 임시 재생목록 링크는 고르지 않았다.

## 2. 동작

**보내는 사람**

- 보관함의 "이 목록 공유" · 곡 관리의 "이 곡 공유" → 데이터 · 백업 대화상자의 SHARE 가 열린다. 맨 위 **"링크로 공유"** 에 링크가 바로
  만들어진다 → **링크 복사**. 아래 "파일로 공유 (ZIP)" 는 그대로다(앨범아트까지 넘길 때).
- 선택: 곡 이름 넣기(기본 켬) · 이 곡들의 Moments 넣기(기본 끔) · Moment 메모 넣기(기본 끔). 길이 · 곡 수 · Moment 수를 보이고,
  2,000자를 넘으면 "일부 게시판에서 잘릴 수 있어요 — 곡 이름을 빼면 N자" 를 알린다.
- Moment 하나: Moments 탭 → 관리 → **링크로 공유**.
- 링크에 무엇이 들어가는지(링크를 가진 누구나 본다)와 앨범아트는 빠진다는 것을 적는다.

**받는 사람** (처음 온 사람도)

- 링크를 열면 대시보드 위에 미리보기 — 목록 이름 · 곡 이름 · Moment(시점 · 메모). **누르기 전에는 아무것도 저장 · 재생하지 않는다.**
- 목록: "보관함에 추가하고 듣기" · "추가만 하기"(뒤에 듣기 · 보관함에서 보기). 넣을 곳(새 목록 / 기존 목록), 같은 영상 건너뛰기,
  Moments 도 저장.
- 곡: "바로 듣기"(저장 안 함) · "목록에 추가". Moment: "그 순간부터 듣기"(저장 안 함) · "Moment 저장".
- 곡 이름이 빠진 링크는 YouTube 에서 실제 제목을 찾아 보이고 그 이름으로 넣는다.
- 잘렸거나 손상된 링크는 이유와 할 일을 말한다. 닫으면 주소의 `#share…` 를 지운다.

## 3. 변경 파일

| 파일                                                                                               | 내용                                                                            |
| -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `src/features/backup/shareLink.ts` (새)                                                            | 형식 · 만들기 · 읽기 · 검증 (순수 함수)                                         |
| `src/features/backup/useShareLink.ts` · `ShareLinkBox.vue` (새)                                    | 보내는 쪽 — 링크 · 선택 · 길이 · 복사                                           |
| `src/features/backup/useShareLinkReceive.ts` · `ShareLinkPreview.vue` · `ShareLinkDialog.vue` (새) | 받는 쪽 — 미리보기 · 제목 찾기 · 넣기 · 재생 (따로 내려받는 묶음)               |
| `src/components/ui/useFocusTrap.ts` (새)                                                           | 모달 안 Tab 순환                                                                |
| `src/features/backup/SharePanel.vue`                                                               | "링크로 공유" + "파일로 공유 (ZIP)", Moment 대상                                |
| `src/features/backup/useShare.ts`                                                                  | 새 목록 이름 규칙을 `uniquePlaylistName` 으로 꺼냄 (두 가져오기가 같이 씀)      |
| `src/components/layout/DashboardShell.vue`                                                         | `#share` 읽기 · `hashchange` · 미리보기 모달(뒤쪽 `inert` · Esc) · 닫은 뒤 재생 |
| `src/shared/types/share.ts`                                                                        | 공유 대상에 Moment                                                              |
| `src/features/moments/MomentRow.vue` · `MomentList.vue` · `MomentsBrowserPanel.vue`                | 관리 메뉴 "링크로 공유"                                                         |
| `tests/unit/share-link.spec.ts` · `share-link-ui.spec.ts` (새)                                     | 형식 13 · 화면 17                                                               |
| `docs/decisions/0040-…` (새) · ADR 색인 · 이 보고서 · `share-link-results/`                        | 결정 · 실제 Chrome 확인 스크립트 · 결과 · 스크린샷                              |

추가한 의존성: **없음** (압축은 ZIP 공유가 이미 쓰는 fflate).

## 4. 검증 (실제로 실행한 명령과 결과)

| 명령                                                                         | 결과                                                                            |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `npm run type-check` · `npm run lint` · `npm run format`                     | 통과                                                                            |
| `npx vitest run` (PowerShell)                                                | **70 파일 · 2,200 테스트 통과**                                                 |
| `npm run build`                                                              | 통과 — main JS 313.57 KB (gzip 101.20 KB), 받는 쪽 묶음 12.16 KB (gzip 4.67 KB) |
| `node docs/development/share-link-results/check/sharelink.mjs` (실제 Chrome) | **10/10 통과** — `share-link-results/real-chrome-sharelink.json`                |

실제 Chrome: 설치된 Chrome · 격리된 임시 프로필 · 로컬 빌드. 보내는 사람(A)과 받는 사람(B · C · D · E · F)은 **서로 다른 브라우저
컨텍스트**(저장소가 나뉜다 — 다른 사람과 같다). 확인한 것: A 가 링크를 만들고 "링크 복사" 가 실제 클립보드에 같은 링크를 넣음 · 50곡
목록의 길이 경고 · B 가 링크를 열면 미리보기만(저장 안 됨) → "보관함에 추가하고 듣기" 로 B 의 보관함에 저장 · 실제 YouTube 첫 곡 재생 ·
조각 지움 · A 의 보관함은 그대로 · C 는 곡 이름 없는 링크에서 YouTube 실제 제목 3개를 찾음 · D 는 Moment 링크로 저장 없이 120초부터
재생(YouTube 시각 120.07초) · B 의 열린 탭에 링크를 붙여 넣어도 미리보기 · "Moment 저장" · E 는 끝이 잘린 링크에 오류 안내 · 받는 쪽
대화상자 1440 · 390 · 320px 배치(넘침 없음 · 단추 44px) · 보내는 쪽 390px 넘침 없음.

링크 길이 실측(로컬 주소 `http://127.0.0.1:4173/` 기준 — `https://39page.com/` 은 6자 짧다):

| 내용                                | 길이    |
| ----------------------------------- | ------- |
| 3곡 목록 (곡 이름 포함)             | 229자   |
| 3곡 목록 (곡 이름 뺌)               | 165자   |
| Moment 하나 (메모 포함)             | 166자   |
| 50곡 · 겹치지 않는 한글 제목 18자씩 | 3,807자 |
| 같은 50곡 (곡 이름 뺌)              | 791자   |

## 5. 남은 일 (TODO)

- **TODO(사용자 확인)**: 보내는 쪽 "링크로 공유" 칸 · 받는 쪽 미리보기의 모양은 승인된 디자인 참고자료에 없는 새 화면이다 —
  `share-link-results/*.png` 를 보고 확정이 필요하다.
- **TODO(확인)**: 개인정보 처리방침에 공유 링크(내용이 주소에 들어감 · 서버로 가지 않음 · 곡 이름 없는 링크는 열 때 YouTube 에서 제목
  조회)를 적을지. `public/privacy.html` 은 다른 브랜치에서 수정 중이라 건드리지 않았다.
- 게시판마다 링크 길이 한도 · 자동 링크 처리(리다이렉트로 감싸기 등)가 다르다 — 실제 게시판에서 확인하지 않았다.
- 실제 폰에서는 확인하지 않았다 (데스크톱 Chrome 의 화면 크기 흉내).
- 공유 카드 이미지는 리서치까지 — 구현하지 않았다.
