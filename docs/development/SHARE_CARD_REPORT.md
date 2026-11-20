# 공유 카드 이미지 (ADR 0041) — 작업 보고

- 날짜: 2026-11-20 · 브랜치 `feat/playback-queue-ux`
- 결정 기록: [ADR 0041](../decisions/0041-share-card-image.md) · 리서치 · 시안: [SHARE_CARD_RESEARCH](../product/SHARE_CARD_RESEARCH.md) ·
  [`design/mockups/share-card/`](../../design/mockups/share-card/)

## 1. 요청

리서치 · 시안을 본 사용자 결정 (2026-11-20):

- 테마 구성은 좋다 — Kawaii 는 카세트 J카드, Mono 는 LP 뒷면, 긴 목록은 영수증.
- 휴대폰을 주 사용 기기로 보지 않으므로 QR 을 뺀다. QR 안내 문구("폰 카메라로 … 비추거나, 링크를 누르세요")와 "링크는 이 이미지 ·
  글 본문에 있어요" 문구도 뺀다.
- 글꼴은 기본 글꼴로 시작한다.
- 구현 후 배포해서 실기기에서 쓰며 고친다.

사용자 앨범아트를 카드에 넣을지는 답을 받지 못했다 — 기본값(39page 그림)으로 두고 TODO 로 남겼다.

## 2. 동작

- 공유 대화상자의 **"링크로 공유"** 칸 안에 **"이미지 카드"** 가 있다. 링크와 같은 대상 · 같은 선택(Moments · 메모 넣기)으로 그린
  카드를 미리 보인다. 곡 이름을 링크에서 빼도 카드에는 곡 이름이 있다.
- 틀: 목록 10곡까지는 Kawaii 카세트 J카드(1080×1350) · Mono LP 뒷면(1080×1080), 11곡부터는 두 테마 모두 영수증(곡 수만큼 길어지고
  최대 3,240, 넘치면 "+N곡 더 · 총 N곡"), 곡 하나 · Moment 는 각 테마의 싱글(Kawaii 1080×1350 · Mono 1080×1080).
- **이미지 복사** — PNG 를 클립보드에 넣는다 → 게시판 글쓰기 칸에 붙여 넣고, 위의 링크를 이미지에 건다. 막히면 "이미지 저장" 을
  권한다. **이미지 저장** — `<제목>.39page.png`.
- 대상 · 선택 · 테마를 바꾸면 다시 그린다. 그동안은 지난 카드를 흐리게 보이고 복사 · 저장을 끈다.
- 카드 안에 QR · 링크 안내 문구 · YouTube 썸네일 · 로고가 없다. 서버로 보내지 않고 저장하지 않는다.

## 3. 변경 파일

| 파일                                                               | 내용                                                                             |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| `src/features/backup/shareCard.ts` (새)                            | 틀 고르기 · 줄 맞추기(keep-all · 그래핌 말줄임) · 영수증 높이 · 파일 이름 (순수) |
| `src/features/backup/shareCardCanvas.ts` (새)                      | canvas 2D 그리기 — J카드 · LP · 싱글 두 가지 · 영수증 (따로 내려받는 묶음)       |
| `src/features/backup/shareCardLazy.ts` (새)                        | 그리기 묶음을 처음 쓸 때 가져오는 렌더러                                         |
| `src/features/backup/useShareCard.ts` (새)                         | 미리 그리기 · 다시 그리기 · 복사 · 저장                                          |
| `src/features/backup/ShareCardBox.vue` (새)                        | 미리보기 · 틀 이름과 크기 · 단추 · 상태 줄                                       |
| `src/features/backup/ShareLinkBox.vue`                             | 링크 칸 안에 카드 칸                                                             |
| `src/features/backup/useShareLink.ts`                              | `cardContent` — 링크와 같은 선택, 곡 이름은 늘 넣음                              |
| `src/main.ts`                                                      | 렌더러 주입 (`SHARE_CARD_RENDERER`)                                              |
| `tests/unit/share-card.spec.ts` (새)                               | 순수 함수 12개                                                                   |
| `tests/unit/share-card-ui.spec.ts` (새)                            | 화면 9개 (가짜 렌더러)                                                           |
| `docs/development/share-card-results/` (새)                        | 실제 Chrome 확인 스크립트 · 결과 JSON · 카드 PNG 14장 · 390px 칸 스크린샷        |
| `docs/decisions/0041-share-card-image.md` (새) · README            | 결정 기록                                                                        |
| `docs/product/SHARE_CARD_RESEARCH.md`                              | §7 을 결정으로 바꿈, 구현 표시                                                   |
| `design/mockups/share-card/README.md` · `design/mockups/README.md` | 구현에서는 QR · 안내 문구를 뺐다는 표시                                          |

새 의존성 없음.

## 4. 검증 (실제로 실행한 것)

| 명령                                                                                                      | 결과                 |
| --------------------------------------------------------------------------------------------------------- | -------------------- |
| `npx vitest run tests/unit/share-card.spec.ts tests/unit/share-card-ui.spec.ts`                           | 2 파일 · 21 통과     |
| `npm test`                                                                                                | 72 파일 · 2,221 통과 |
| `npm run lint` · `npm run type-check`                                                                     | 통과                 |
| `npm run build`                                                                                           | 통과 — 아래 크기     |
| `node docs/development/share-card-results/check/sharecard.mjs` (실제 Chrome, 격리 임시 프로필, 로컬 빌드) | **17/17 통과**       |

**묶음 크기** — 첫 화면 `main` 321.13 KB (gzip 104.60 KB), 카드 전 313.57 KB (gzip 101.20 KB) 에서 +7.56 KB (gzip +3.40 KB):
카드 칸 · 틀 고르기 코드. 그리는 코드 `shareCardCanvas` 10.33 KB (gzip 3.95 KB) 는 따로 — 카드를 처음 그릴 때 받는다.

**실제 Chrome 확인 (17)** — 두 테마 각각: 목록 10곡(J카드 1080×1350 · LP 1080×1080) · Moments 를 넣으면 다시 그림 · **이미지 복사**
(클립보드를 다시 읽어 `image/png` 확인) · **이미지 저장**(`여름 밤 플레이리스트.39page.png`, PNG 머리 확인) · 30곡 영수증
(1080×2436) · 60곡 영수증(1080×3216, "+17곡 더") · 곡 하나 싱글 · Moment 싱글(메모 포함), 그리고 390px 에서 카드 칸이 대화상자 안에
들어가고 가로로 넘치지 않음.

| 카드                 | 크기      | PNG 크기 |
| -------------------- | --------- | -------- |
| Kawaii J카드 10곡    | 1080×1350 | 194 KB   |
| Kawaii 영수증 60곡   | 1080×3216 | 545 KB   |
| Kawaii 싱글 (Moment) | 1080×1350 | 133 KB   |
| Mono LP 10곡         | 1080×1080 | 672 KB   |
| Mono 영수증 60곡     | 1080×3216 | 536 KB   |
| Mono 싱글 (Moment)   | 1080×1080 | 613 KB   |

Mono 카드는 바탕 그라데이션 · 레코드 홈 때문에 PNG 가 크다(최대 약 680 KB).

## 5. 실제 Chrome 에서 찾아 고친 것

1. **지난 카드가 복사될 수 있던 틈** — 공유 대화상자는 닫아도 남아 있어서, 대상을 바꾸면 새 카드를 그리기 전(약 0.1–0.3초) 지난
   카드가 "준비됨" 으로 남았다. 그 사이 "이미지 복사" 를 누르면 다른 대상의 카드가 복사될 수 있었다. → 바뀌는 즉시 "그리는 중" 으로
   두고 복사 · 저장을 끈다. 틀 이름 · 크기 · 파일 이름은 그려진 카드의 것을 쓴다. 단위 시험 추가.
2. **J카드 제목이 위 테두리에 붙음** — 앞면을 30px 키우고 등 · 속지를 그만큼 내렸다(10곡도 아래 테두리까지 여유가 남는다).
3. **Kawaii 곡 카드의 빈 자리** — Moment 가 없는 곡 카드는 제목과 단추 사이가 약 350px 비었다. → 그림 · 제목 · 시점 · 메모 · 단추를
   먼저 재고 한 덩어리로 세로 가운데에 둔다.
4. **영수증 톱니 끝이 종이 오른쪽을 넘음** — 880px 를 36px 톱니로 나누면 남는다. → 종이 너비를 톱니 수로 똑같이 나눈다.

## 6. 확인하지 못한 것 · TODO

- TODO: 사용자가 직접 올린 앨범아트를 카드에 넣을지 (권리는 올린 사람 몫).
- TODO: 실제 게시판에 올려 이미지에 링크 걸기 · 게시판의 재압축 · 폰 화면에서 읽히는지 — 배포 뒤 실기기 사용으로 확인한다.
- 확인한 브라우저는 Windows 의 Chrome 뿐이다. macOS · Android 의 시스템 글꼴, Safari · Firefox 의 이미지 복사는 보지 못했다.
- TODO: 폰 공유 시트(`navigator.share({ files })`) — 폰에서 쓰게 되면.
- TODO: 개인정보 처리방침 문구 (ADR 0040 의 TODO 와 함께).
