# 0015. 배포는 Cloudflare Workers Static Assets 로 하고 표준 origin 을 apex 하나로 고정한다

- 상태: 채택
- 날짜: 2026-11-04
- 관련: `docs/architecture/SYSTEM_DESIGN.md` §1,
  `docs/development/POST_MVP_PLAN.md` §B.4 §F.1,
  `docs/development/DEPLOYMENT.md`

## 배경

`SYSTEM_DESIGN.md` §1 의 `TODO: 배포 대상 확정` 이 남아 있었다. MVP 는
정적 호스팅을 전제로만 설계되어 있었고 실제 대상이 없었다.

이 TODO 가 단순한 미결 사항이 아니었다. **`localStorage` 는 origin 단위다.**
스킴·호스트·포트가 하나라도 다르면 다른 저장소다. 따라서 배포 주소가
정해지지 않은 동안에는 사용자가 쌓은 라이브러리가 어디에 쌓이는지 보장할 수
없었다. 개발 서버(`http://localhost:5173`)에서 만든 데이터는 배포 주소에서
보이지 않는다.

사용자가 `39page.com` 을 보유하고 있고, 확인해 보니 **DNS 가 이미 Cloudflare
네임서버에서 관리되고 있었다** (`desi.ns` · `fonzie.ns.cloudflare.com`,
A 레코드는 비어 있음).

## 결정

### 1. 호스팅은 Cloudflare Workers Static Assets

| 근거                      | 내용                                                                                        |
| ------------------------- | ------------------------------------------------------------------------------------------- |
| DNS 이전이 불필요하다     | 네임서버가 이미 Cloudflare 다                                                               |
| SPA 폴백을 공식 지원한다  | `[assets] not_found_handling = "single-page-application"`                                   |
| 비용이 $0 이다            | 공식 가격 문서: **"Requests to static assets are free and unlimited"** (Free·Paid 양쪽)     |
| Worker 가 호출되지 않는다 | `main` 을 두지 않는다. Free 의 일 10만 요청 한도는 **Worker 호출**을 세므로 적용되지 않는다 |

빌드 실측: `npm run build` 11 초, 산출물 187 KB · 4 개 파일. Workers Builds
무료 한도(월 3,000 빌드분, 동시 1)에 **자릿수로 여유가 있다.**

### 2. 표준 origin 은 `https://39page.com` 하나다

```
https://39page.com          ← 표준. 모든 사용자 데이터가 여기 쌓인다
https://www.39page.com      → 301
http://  (모든 호스트)       → 301 (Always Use HTTPS)
<name>.<sub>.workers.dev    → 열지 않는다 (workers_dev = false)
```

**이것이 이 ADR 의 핵심이다.** origin 을 둘 이상 열어두면 사용자가 들어온
주소에 따라 라이브러리가 갈리고, 사용자에게는 "데이터가 사라졌다"로 보인다.
복구할 방법도 없다 — 두 저장소는 서로를 읽을 수 없다.

`workers_dev = false` 를 명시하는 이유가 여기 있다. 기본값으로 열리는
`*.workers.dev` 주소는 **같은 앱의 또 다른 origin** 이다.

### 3. OAuth 리다이렉트 URL 은 둘만 등록한다

| 용도 | URL                     |
| ---- | ----------------------- |
| 개발 | `http://localhost:5173` |
| 운영 | `https://39page.com`    |

커밋마다 발급되는 프리뷰 URL 은 등록하지 않는다. origin 이 매번 달라
저장소가 분리되고, 리다이렉트 허용 목록을 넓히는 것 자체가 위험하다.

### 4. 라우터는 여전히 추가하지 않는다

`SYSTEM_DESIGN.md` §2 의 "라우터 없음"을 유지한다. SPA 폴백을 켜는 것은
라우팅을 도입하는 것과 다르다 — 알 수 없는 경로를 404 대신 앱 셸로 보내는
자산 서버 설정일 뿐이다.

## 대안

| 후보                      | 탈락 이유                                                                                                                                           |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Workers Static Assets** | **채택.** 위 표                                                                                                                                     |
| Cloudflare Pages          | 같은 계정에서 동작하고 Git 워크플로가 더 단순하다. 다만 빌드 한도가 월 500 회로 더 좁고, 신규 기능이 Workers 쪽에 집중된다는 관측이 있다 (2차 자료) |
| Vercel / Netlify          | 잘 동작하지만 DNS 를 Cloudflare 에서 그쪽으로 향하게 해야 한다. 얻는 것이 없다                                                                      |
| GitHub Pages              | SPA 폴백이 깔끔하지 않다 (404 우회 트릭 필요)                                                                                                       |
| www 를 표준으로           | 어느 쪽이든 되지만 **하나만 골라야** 한다. apex 가 짧고 입력하기 쉽다                                                                               |
| 두 origin 을 모두 허용    | 사용자 데이터가 갈린다. 이 ADR 이 막으려는 바로 그 문제                                                                                             |

## 결과

- `SYSTEM_DESIGN.md` §1 의 배포 대상 TODO 가 닫힌다. **단 아직 배포하지
  않았다** — 절차는 `docs/development/DEPLOYMENT.md` 다.
- 호스팅 비용이 $0 이다. 전체 스택(호스팅·Supabase·Open-Meteo·YouTube)에서
  **연 단위 도메인 갱신비만 실제 비용으로 남는다.**
- `wrangler.toml` 이 저장소에 들어간다. **의존성은 추가하지 않았다** —
  `npx wrangler` 로 실행한다 (규칙 8 검토는 DEPLOYMENT.md §의존성).
- `www` 리다이렉트는 **DNS 레코드가 있어야 발동한다.** 없으면 리다이렉트가
  아니라 NXDOMAIN 이 난다. 런북에 함정으로 적었다.
- **이 기기(Termux/Android)에서는 배포를 실행할 수 없다.** wrangler 의 필수
  의존성 `workerd` 에 Android 빌드가 없다 (`Unsupported platform: android
arm64 LE`). 따라서 배포는 **Cloudflare Workers Builds (Git 연동)** 로 한다.
  이 때문에 Git 원격(POST_MVP_PLAN.md C11)이 선호 사항이 아니라 **사실상 필수
  조건**이 된다.
- 계정·동기화(POST_MVP_PLAN.md 트랙 B)를 도입하면 이 origin 결정이 그대로
  전제가 된다. OAuth 리다이렉트 URL 이 여기서 나온다.

TODO: 실제 배포 수행과 `https://39page.com` 응답 확인
TODO: Single Redirect 의 무료 플랜 규칙 수 한도는 확인하지 못했다
TODO: 프리뷰 URL 비활성화 설정의 정확한 이름을 확인한다 (대시보드 확인 필요)
