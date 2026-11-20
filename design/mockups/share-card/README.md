# share-card — 공유 카드 이미지 비교 시안 (구현 아님)

게시판에 올리고 이미지에 공유 링크(ADR 0040)를 거는 카드의 시안이다. 앱이 가져오지 않고 빌드 대상이 아니다.
근거와 결정할 것은 [`docs/product/SHARE_CARD_RESEARCH.md`](../../../docs/product/SHARE_CARD_RESEARCH.md).

> **구현됨 — [ADR 0041](../../../docs/decisions/0041-share-card-image.md) (2026-11-20).** 구현에서는 사용자 결정으로 **QR 과 링크 안내
> 문구("폰 카메라로 …", "링크는 이 이미지 · 글 본문에 있어요")를 뺐고** 시스템 글꼴을 쓴다. 이 시안의 QR · 안내는 리서치 당시의
> 모습이다. 실제 카드: [`docs/development/share-card-results/`](../../../docs/development/share-card-results/).

- `index.html` · `cards.css` — 카드 다섯 장(실제 크기, 폭 1080px)과 폰 · 데스크톱 게시판 폭으로 줄인 모습. QR 은 **모양만 흉내 낸 예시**다
  (실제 링크가 아니다). 곡 이름은 예시다.
- `screenshots/` — `check/shoot.mjs` 로 찍은 PNG (격리된 임시 Chrome 프로필, 로컬 파일만).

```
npm run build
POC_CHROME=<chrome.exe> node design/mockups/share-card/check/shoot.mjs
```

| 파일                         | 내용                                                    |
| ---------------------------- | ------------------------------------------------------- |
| `a-jcard-playlist.png`       | A. 카세트 J카드 (Kawaii) · 1080×1350 · 10곡             |
| `a-jcard-moment.png`         | A′. 곡 하나 · Moment · QR                               |
| `b-lp-playlist.png`          | B. LP 뒷면 (Mono Vinyl) · 1080×1080 · 10곡              |
| `c-receipt-playlist.png`     | C. 영수증 (Kawaii 종이) · 10곡 · QR                     |
| `c-receipt-long.png`         | C′. 긴 영수증 (Mono 종이) · 50곡 중 20 + "+30곡 더"     |
| `scaled-phone-desktop.png`   | 폰 360px · 데스크톱 850px 로 줄인 모습                  |
