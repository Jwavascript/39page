# 배포 — Cloudflare Workers Static Assets

> 상태: **배포 완료 (2026-11-04).** `https://39page.com` 이 앱을 서비스한다.
> `www`·`http` 리다이렉트(§4)는 남아 있다.
> 결정 근거: [`../decisions/0015-deployment-target.md`](../decisions/0015-deployment-target.md)
> 비용 분석: [`POST_MVP_PLAN.md`](POST_MVP_PLAN.md) §F.1

| 항목        | 값                                           |
| ----------- | -------------------------------------------- |
| 호스팅      | Cloudflare Workers Static Assets             |
| 표준 origin | **`https://39page.com`** (apex 하나)         |
| 설정 파일   | [`../../wrangler.toml`](../../wrangler.toml) |
| 비용        | $0 — 정적 자산 요청은 무료·무제한            |
| 빌드 산출물 | `dist/` — 11초, 187 KB, 4개 파일             |

---

## ⚠ 0. 이 기기(Termux/Android)에서는 wrangler 를 쓸 수 없다

실측 확인 (2026-11-04):

```
$ npm install wrangler@4
npm error Error: Unsupported platform: android arm64 LE
npm error path .../node_modules/workerd
```

`workerd` 는 wrangler 의 **필수 의존성**이고 Android 빌드가 없다. 이 기기의
`process.platform` 은 `linux` 가 아니라 **`android`** 다. 선택적 의존성 누락이
아니라 설치 스크립트가 예외를 던지므로 **우회할 수 없다.**

→ **`npx wrangler deploy` 를 이 기기에서 실행할 수 없다.**

### 대안 세 가지

| 안                                          | 평가                                                                                  |
| ------------------------------------------- | ------------------------------------------------------------------------------------- |
| **Cloudflare Workers Builds (Git 연동)**    | **추천.** 빌드와 배포가 Cloudflare 의 Linux 환경에서 돈다. 로컬 wrangler 가 필요 없다 |
| 다른 기기(PC/Mac)에서 `npx wrangler deploy` | 된다. 그 기기에 저장소를 받아야 한다                                                  |
| Cloudflare API 를 `curl` 로 직접 호출       | 이론상 가능하지만 번거롭고 실수 여지가 크다. 권하지 않는다                            |

**이 때문에 Git 원격(C11)이 선호 사항이 아니라 사실상 필수 조건이 된다.**
코드가 현재 이 기기에만 있다는 점(백업 부재)과 함께 보면 어차피 해야 할 일이다.

### 의존성 검토 (`AGENTS.md` 규칙 8)

- **(a) 왜 필요한가** — 배포에 wrangler 가 필요하다.
- **(b) 기존 의존성으로 가능한가** — 아니다. 그러나 **로컬에 추가할 필요가
  없다.** Workers Builds 가 CI 환경에서 제공한다.
- **(c) 대안** — 위 표.

→ **`package.json` 을 바꾸지 않았다. 새 의존성 0개.**
`wrangler.toml` 설정 파일만 저장소에 들어간다.

---

## 1. Git 원격 만들기 (선행) — 완료 (2026-11-04)

```
origin  https://github.com/Jwavascript/39page.git
```

공개 저장소로 만들었다. 커밋 22개, 파일 147개, `main` 이 업스트림을 추적한다.
`node_modules`·`dist`·`.vscode/settings.json` 은 올라가지 않았다.

publishable key 는 공개용 설계이므로 노출되어도 되지만, **secret /
service_role key 는 공개·비공개 어느 쪽이든 저장소에 넣지 않는다.**
`.gitignore` 가 `.env*` 와 `*.key` 를 이미 막는다.

나중에 비공개로 전환해도 Workers Builds 는 끊기지 않는다. 연결은
`Cloudflare Workers and Pages` **GitHub App** 설치로 이뤄지고, App 에 접근
권한을 준 저장소는 공개 여부와 무관하게 읽는다. "저장소가 public 이어야
한다" 는 제약은 Deploy to Cloudflare 버튼에만 적용되며 Workers Builds 와
무관하다. 단 GitHub 에서 App 접근을 **제거**하면 이후 빌드는 멈춘다
(기존 배포본은 계속 서비스된다).

## 2. Workers Builds 연결

Cloudflare 대시보드 → **Workers & Pages** → **Create** → 저장소 가져오기.

| 설정           | 값                    |
| -------------- | --------------------- |
| Build command  | `npm run build`       |
| Deploy command | `npx wrangler deploy` |
| Root directory | `/`                   |

`wrangler.toml` 이 나머지를 결정한다 — 자산 디렉터리, SPA 폴백,
`workers_dev = false`, 커스텀 도메인.

### ⚠ 대시보드의 Worker 이름과 `wrangler.toml` 의 `name` 이 같아야 한다

다르면 빌드가 이 오류로 실패한다 (공식 문서의 알려진 제약).

```
✘ [ERROR] The name in your Wrangler configuration file (<Worker name>)
  must match the name of your Worker.
```

빌드 시스템은 `wrangler.toml` 의 `name` 으로 **어느 Worker 에 배포할지**
결정한다. 그래서 대시보드에서 만든 Worker 이름을 그대로 `name` 에 써야 한다.
현재 둘 다 `39page` 다.

### 이름 규칙 (공식)

- 영숫자(`a-z`, `A-Z`, `0-9`)와 하이픈(`-`)만
- 하이픈으로 **시작하거나 끝날 수 없다**
- `workers.dev` 를 쓸 때 63자 이하. 쓰지 않으면 255자까지

**숫자로 시작하는 이름은 허용된다.** 제약은 하이픈에만 걸린다. 이름이
`workers.dev` 하위 도메인의 DNS 레이블로 쓰이기 때문인데, DNS 레이블은
숫자로 시작할 수 있다. 즉 `39page` 는 유효한 이름이고, 더구나 이 프로젝트는
`workers_dev = false` 라서 DNS 레이블 제약 자체가 적용되지 않는다.

TODO: 대시보드 화면 구성은 변할 수 있다. 위 세 값이 들어갈 자리를 찾는다.

## 3. 커스텀 도메인 — 추가 완료 (2026-11-04)

`wrangler.toml` 의 아래 설정이 배포 시 apex 커스텀 도메인과 프록시된 DNS
레코드를 만든다.

```toml
[[routes]]
pattern = "39page.com"
custom_domain = true
```

도메인이 **Workers 를 쓰는 것과 같은 Cloudflare 계정**에 있어야 한다.
Workers Builds 가 자동 생성하는 API 토큰의 권한이
`Zone: Workers Routes (edit) for all zones on the account` 이므로,
다른 계정의 zone 에는 커스텀 도메인을 만들 수 없다.

실제로는 첫 배포를 기다리지 않고 대시보드에서 직접 추가했다
(Worker → Settings → Domains & Routes → Add → Custom domain).
`[[routes]]` 는 이미 존재하는 것을 가리키게 되므로 충돌하지 않는다.

**실측** (2026-11-04)

| 확인                     | 결과                                               |
| ------------------------ | -------------------------------------------------- |
| A                        | `104.21.49.182`, `172.67.191.178`                  |
| AAAA                     | `2606:4700:3036::ac43:bfb2`, `2606:4700:3037::…`   |
| `https://39page.com`     | **200**, TLS 검증 통과 (`ssl_verify_result=0`)     |
| 본문                     | `Hello world` (`content-type: text/plain`)         |
| `https://www.39page.com` | **530** — 레코드가 없다 (4단계가 남았다)           |
| `http://39page.com`      | **200, 리다이렉트 없음** — Always Use HTTPS 미설정 |

**본문이 `Hello world` 라는 것이 중요하다.** 대시보드에서 Worker 를 만들 때
쓴 템플릿이 그대로 서비스되고 있다는 뜻이고, 저장소 빌드가 아직 배포되지
않았다는 뜻이다. 39page 는 HTML 을 주므로 `content-type` 이 `text/html` 이어야
한다. 저장소에서 빌드가 성공해 `wrangler deploy` 가 `dist/` 를 올리면 바뀐다.

> ⚠ **이 기기에서는 `39page.com` 이 해석되지 않는다.** `curl` 이
> `(6) Could not resolve host` 를 낸다. 레코드는 존재하므로(위 표) 안드로이드
> 리졸버가 아직 받아오지 못한 것이다. 서버 문제와 구별하려면 IP 를 직접
> 지정한다.
>
> ```sh
> curl -sI --resolve 39page.com:443:104.21.49.182 https://39page.com
> ```

## 4. ⚠ www → apex 리다이렉트 — DNS 레코드가 먼저다

**함정**: `www` 에 DNS 레코드가 없으면 리다이렉트 규칙이 **발동하지 않는다.**
브라우저는 리다이렉트가 아니라 `DNS_PROBE_FINISHED_NXDOMAIN` 을 받는다.

순서를 지킨다.

1. **DNS 레코드 추가** — `www` 에 자리표시자를 두고 **프록시를 켠다**
   (오렌지 구름). Cloudflare 가 origin 에 닿기 전에 가로챈다.

   | Type | Name  | Content | Proxy |
   | ---- | ----- | ------- | ----- |
   | AAAA | `www` | `100::` | 켜짐  |

   (IPv4 자리표시자 `192.0.2.1` 을 A 레코드로 써도 된다. 둘 다 예약 주소다.)

2. **Rules → Redirect Rules** 에서 Single Redirect 생성.
   **"WWW to Root"** 템플릿이 있으면 그대로 저장한다.
   수동 설정이라면: `www.39page.com/*` → `https://39page.com/${1}`, **301**.

3. **SSL/TLS → Edge Certificates → Always Use HTTPS** 를 켠다.
   `http://` 와 `https://` 는 **다른 origin** 이다.

TODO: Single Redirect 의 무료 플랜 규칙 수 한도는 확인하지 못했다.

## 5. 검증 체크리스트

배포 후 확인한다. **처음 네 줄이 데이터 무결성에 직결된다.**

이 기기에서 돌릴 때는 `--resolve 39page.com:443:<A 레코드 IP>` 를 붙인다.
안드로이드 리졸버가 이 도메인을 해석하지 못한다 (3단계 참조).

```sh
# 표준 origin 이 200 을 준다
curl -s -o /dev/null -w "%{http_code}\n" https://39page.com

# www 가 apex 로 301 한다 (NXDOMAIN 이 아니라)
curl -s -o /dev/null -w "%{http_code} -> %{redirect_url}\n" https://www.39page.com

# http 가 https 로 301 한다
curl -s -o /dev/null -w "%{http_code} -> %{redirect_url}\n" http://39page.com

# workers.dev 주소가 열려 있지 않다 (열려 있으면 origin 이 하나 더 있는 것이다)
```

브라우저에서:

- [ ] 두 테마가 모두 뜨고 전환된다
- [ ] 라이브러리 드로어가 열리고 플레이리스트를 만들 수 있다
- [ ] 새로고침해도 플레이리스트가 남는다
- [ ] **실제 YouTube 재생** — 이 환경에서 검증하지 못한 유일한 항목이다
      (`POST_MVP_PLAN.md` 작성 시점 기준). 일반 브라우저에서 확인한다
- [ ] 알 수 없는 경로(`/anything`)가 404 가 아니라 앱으로 간다

### 실측 결과 (2026-11-04, 첫 배포 직후)

`--resolve` 로 로컬 DNS 를 우회해 확인했다.

| 확인                     | 결과                                   | 판정 |
| ------------------------ | -------------------------------------- | ---- |
| `https://39page.com`     | 200 · `text/html` · 1932 bytes         | ✅   |
| `<title>`                | `39page`                               | ✅   |
| JS 자산                  | 200 · `text/javascript` · 136443 bytes | ✅   |
| CSS 자산                 | 200 · `text/css` · 28894 bytes         | ✅   |
| SPA 폴백 `/anything`     | 200 · `text/html` (404 가 아니다)      | ✅   |
| `https://www.39page.com` | **530** — 레코드가 없다                | ❌   |
| `http://39page.com`      | **200, 리다이렉트 없음**               | ❌   |

자산 파일명과 크기가 로컬 `npm run build` 산출물과 일치한다
(`index-7X_aIsYw.js` 136.44 kB, `index-Ds6ZfYCY.css` 28.89 kB). 즉 배포된
것이 이 저장소의 코드다.

**남은 두 줄이 데이터 무결성 문제다.** `www` 와 `http` 는 각각 별도 origin
이고, 지금 상태에서 사용자가 `http://39page.com` 으로 들어오면 `https` 와
다른 `localStorage` 를 쓴다. §4 를 수행해야 닫힌다.

브라우저 항목(테마·드로어·영속성·실제 재생)은 **아직 확인하지 않았다.**

### 실측 결과 (2026-11-06, M8 백업·복원 배포)

푸시만으로 배포된다 — Workers Builds 가 `main` 을 받아 빌드하고 올린다.
`8666ad2..62d9a19` fast-forward, 강제 푸시 없음. 푸시에서 반영까지 **2분
미만**이었다.

| 확인                     | 결과                                                         |
| ------------------------ | ------------------------------------------------------------ |
| 배포본 JS SHA-256        | **로컬 `npm run build` 산출물과 바이트 동일**                |
| `https://39page.com`     | 200 · `text/html` · 1932 B                                   |
| JS / CSS                 | 200 · 165,555 B / 37,914 B                                   |
| SPA 폴백 `/anything`     | 200 · `text/html`                                            |
| 브라우저 항목            | **이번에 확인했다** — 테마·드로어·영속성·실제 재생 모두 통과 |
| `https://www.39page.com` | **NXDOMAIN** — 여전히 §4 가 남았다                           |
| `http://39page.com`      | **200, 리다이렉트 없음** — 여전히 §4 가 남았다               |

> **이 기기에서 `39page.com` 이 이제 해석된다.** 3단계의 경고(안드로이드
> 리졸버가 받아오지 못함)는 2026-11-06 기준 해소됐다. `--resolve` 없이
> `curl` 과 Chromium 이 바로 닿는다. 다만 리졸버 상태는 다시 바뀔 수
> 있으므로 3단계의 우회법은 남겨 둔다.

**§4 가 여전히 데이터 무결성 문제이고, M8 이후 더 커졌다.** 백업 파일을
`https` 에서 내보내고 `http` 에서 가져오면 서로 다른 저장소를 보게 된다.
두 주소는 사용자에게 같은 사이트로 보이므로, 사용자는 원인을 알 수 없다.

### 재확인 (2026-11-10, M9 배포 전 · 읽기만)

M9(Music Moments)는 **아직 배포하지 않았다.** 운영은 M8 그대로다. Cloudflare
설정은 바꾸지 않았고 `curl` 과 DoH 조회로만 봤다.

| 확인                 | 결과                                                          |
| -------------------- | ------------------------------------------------------------- |
| `https://39page.com` | 200 · `server: cloudflare` · **HSTS 헤더 없음**               |
| 운영 번들            | `index-_5ud30QU.js` — M8 (`8377c83`) 그대로                   |
| `http://39page.com`  | **200, 리다이렉트 없음** — §4 그대로                          |
| `www.39page.com`     | **NXDOMAIN** (`cloudflare-dns.com` DoH, Status 3) — §4 그대로 |

**M9 를 배포하면 §4 의 영향이 한 겹 더 커진다.** `http` 와 `https` 는 서로 다른
`localStorage` 이므로 플레이리스트·테마에 더해 **Moments 도 둘로 갈린다.** M9
배포 전에 §4 를 먼저 수행하는 것을 권한다.

## 6. 다음에 할 일

| 순서 | 할 일                                               | 막는 것           |
| ---- | --------------------------------------------------- | ----------------- |
| 1    | `/privacy` · `/terms` 작성 (`public/` 에 정적 HTML) | Google OAuth 등록 |
| 2    | Supabase 프로젝트 생성 (POST_MVP_PLAN.md §D.1)      | 동기화 구현       |
| 3    | Google OAuth 클라이언트 + brand verification        | 로그인 기능       |

**개인정보처리방침은 현재 앱 기준으로 먼저 쓴다.** 지금 39page 는 계정도
분석도 없고, 외부로 나가는 것은 YouTube 임베드와 Open-Meteo 요청뿐이다.
계정을 도입할 때 개정한다 — 아직 수집하지 않는 것을 수집한다고 적으면
그 자체가 부정확한 고지가 된다.
