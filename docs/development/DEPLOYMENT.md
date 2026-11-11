# 배포 — Cloudflare Workers Static Assets

> 상태: **배포 완료 (2026-11-04).** `https://39page.com` 이 앱을 서비스한다.
> `www`·`http` 리다이렉트(§4)는 남아 있다.
> **M9 는 운영 배포 보류 (2026-11-11)** — §4 를 사용자가 먼저 수행해야 한다
> (§4-0 의 `http` 데이터 확인 포함). 기록: §5 "M9 Release 점검".
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

### 4-0. 켜기 전에 — `http` 에 이미 저장된 데이터 (2026-11-11 검토)

**Always Use HTTPS 는 데이터를 지우지 않는다. 그러나 앱이 그 데이터에 다시
닿지 못하게 만든다.**

- `localStorage` 는 origin(스킴 + 호스트 + 포트) 단위다. `http://39page.com`
  과 `https://39page.com` 은 **서로 다른 저장소**다. 앱의 세 키
  (`39page.library` · `39page.theme` · `39page.moments`) 모두 그렇다.
- 리다이렉트를 켜면 `http` 페이지가 더 열리지 않으므로, 그 저장소를 읽을 코드가
  실행될 기회가 없다. 브라우저 안에서 지워지지는 않지만(리다이렉트를 끄면 다시
  닿는다) 사용자에게는 **"다 사라졌다"** 로 보인다.

**누가 `http` 데이터를 갖고 있을 수 있나**

| 경로                                                 | 판단              | 근거                                                                                                                                                                                                                            |
| ---------------------------------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `www.39page.com`                                     | **없다**          | 처음부터 NXDOMAIN — 페이지가 열린 적이 없다                                                                                                                                                                                     |
| Chrome 115+ 에서 `http://` 주소로 들어온 경우        | **대개 없다**     | Chrome 의 HTTPS-Upgrades (데스크톱·Android 115 출시). **실측**: Chromium 155 에서 `http://39page.com/some/path?x=1#frag` → 내부 **307** → `https://39page.com/some/path?x=1#frag`. 기업 정책으로 끈 경우·이전 버전은 확인 못 함 |
| Safari · Firefox · Samsung Internet · 앱 내 브라우저 | **확인 못 함**    | 이 기기에서 실측할 수 없다                                                                                                                                                                                                      |
| Moments (M9)                                         | **어디에도 없다** | M9 가 아직 운영에 없다 — 어느 origin 에도 Moments 데이터가 생길 수 없었다                                                                                                                                                       |

→ 위험은 **"Chrome 이 아닌 브라우저로 `http` 에 들어와 플레이리스트를 만든
사용자"** 로 좁혀진다. 앱에 분석 도구가 없어 그 수를 알 수 없다.

**이전 방법 비교**

| 안                              | 방법                                                                                              | 장점                                   | 위험·비용                                                                                                                                                                                       |
| ------------------------------- | ------------------------------------------------------------------------------------------------- | -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A. 수동 이전 (권장)**         | `http` 에서 백업 내보내기 → `https` 에서 가져오기 (미리보기 → 승인)                               | **새 코드 없음.** 운영 M8 에 이미 있다 | 사용자가 알아야 한다                                                                                                                                                                            |
| B. `http` 안내 배너 (전환 기간) | 앱이 `http:` 에서 열리면 "백업해서 `https` 로 옮기세요" 를 띄우고, 일정 기간 뒤 리다이렉트        | 해당 사용자가 직접 본다                | **새 기능** — 승인 필요. 배포 → 대기 → 리다이렉트라 §4 가 늦어지고, 그동안 갈림이 계속된다. 기간 중 오지 않은 사용자는 못 본다                                                                  |
| C. 자동 이전 (`postMessage`)    | `http` 페이지가 `https` 창에 백업 문자열을 보내고, `https` 가 기존 가져오기 미리보기로 승인받는다 | 파일을 거치지 않는다                   | `http` 페이지가 계속 열려야 한다 → zone 전체에 걸리는 Always Use HTTPS 와 양립하지 않는다. 새 교차 origin 수신 경로(보안 표면). Chrome 은 `http` 이동을 자동으로 올려 그 페이지에 닿지도 못한다 |
| D. 리다이렉트를 켜지 않는다     | —                                                                                                 | —                                      | 갈림이 계속되고 M9 이후 Moments 까지 갈린다. **기각**                                                                                                                                           |

**권장 순서 (A)** — B 는 `http` 사용자가 실제로 있다는 근거가 생길 때 다시 본다.

1. **(사용자)** 평소 쓰는 브라우저마다 주소창에 `http://39page.com` 을 직접
   연다. 플레이리스트가 보이고 `https` 쪽과 다르면 → 라이브러리 드로어의
   **백업 내보내기** → `https://39page.com` 에서 **가져오기** (미리보기를
   확인하고 승인). Chrome 은 `https` 로 바뀌어 열리는데, 정상이다 — 그
   브라우저에는 `http` 데이터가 대개 없다.
2. 아래 1–3 단계 (레코드 → 리다이렉트 → Always Use HTTPS).
3. §5 의 `curl` 검증.
4. **그다음** M9 를 푸시한다. 순서를 바꾸면 `http` 에서 만든 Moments 가 생길
   수 있다.

**되돌리기** — 나중에 "데이터가 사라졌다" 는 사용자가 나오면 Always Use
HTTPS 를 잠시 끈다. 저장소가 지워지지 않았으므로 그 사용자가 `http` 에서
내보낼 수 있다. 그 뒤 다시 켠다.

> ⚠ **HSTS 는 지금 켜지 않는다.** HSTS 를 받은 브라우저는 `max-age` 동안
> 스스로 `http` 로 가지 않으므로 위의 되돌리기가 브라우저 쪽에서 막힌다.
> Always Use HTTPS 와 별개의 설정이다. 이전 기간이 끝난 뒤 따로 정한다.

### 4-1. 설정 (사용자가 Cloudflare 대시보드에서)

순서를 지킨다.

1. **DNS 레코드 추가** — `www` 에 자리표시자를 두고 **프록시를 켠다**
   (오렌지 구름). Cloudflare 가 origin 에 닿기 전에 가로챈다.

   | Type | Name  | Content | Proxy |
   | ---- | ----- | ------- | ----- |
   | AAAA | `www` | `100::` | 켜짐  |

   (IPv4 자리표시자를 A 레코드로 써도 된다. Workers Custom Domains 문서는
   `192.0.2.0`, 다른 문서는 `192.0.2.1` 을 쓴다 — 둘 다 RFC 5737 예약
   주소다.) Rules 기능은 "DNS 레코드가 프록시될 것" 을 요구한다 (공식
   Redirects 문서).

2. **Rules → Redirect Rules** 에서 Single Redirect 생성.
   공식 예시 "Redirect from WWW to root": Request URL 와일드카드
   `https://www.*` → `https://${1}`, **301**, **Preserve query string 켬**.
   이 예시는 `https://www` 만 잡는다 — `http://www` 는 3단계가 먼저
   `https://www` 로 올리고, 그다음 이 규칙이 apex 로 보낸다 (두 번).
   수동 설정이라면: `www.39page.com/*` → `https://39page.com/${1}`, **301**.

3. **SSL/TLS → Edge Certificates → Always Use HTTPS** 를 켠다.
   공식 문서: "redirects all your visitor requests from `http` to `https`,
   for all subdomains and hosts" — zone 전체에 걸린다. SSL/TLS 모드가
   **Off 면 이 항목이 보이지 않는다.**

**무료 플랜 한도** — Single Redirects 는 zone 당 **10개** (공식 Availability
표). 이 작업은 1개를 쓴다. (이전 TODO 해소)

**리다이렉트 루프** — 공식 문서는 "origin 웹 서버에서 리다이렉트하지 말 것"
을 권한다. 39page 는 Workers Static Assets 라 origin 서버가 없고 앱도
리다이렉트하지 않는다. `http` → `https` → (www 면) apex 에서 끝난다. 배포 후
§5 의 `curl -L` 로 횟수를 확인한다.

**TLS** — 실측(2026-11-11): 지금 인증서의 SAN 이 `39page.com, *.39page.com`
(Google Trust Services WE1, 2027-02-02 까지)이다. SNI `www.39page.com` 으로
접속해도 같은 인증서가 나온다 → `www` 에 **별도 인증서가 필요 없다.**

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

# 경로와 쿼리가 보존된다 (§4-1)
curl -s -o /dev/null -w "%{http_code} -> %{redirect_url}\n" "http://39page.com/a/b?x=1&y=2"
curl -s -o /dev/null -w "%{http_code} -> %{redirect_url}\n" "https://www.39page.com/a/b?x=1&y=2"

# 루프가 없고 apex https 에서 끝난다 (http://www 는 두 번이 정상)
curl -sL --max-redirs 5 -o /dev/null -w "%{http_code} %{num_redirects} %{url_effective}\n" "http://www.39page.com/a?x=1"

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

### M9 Release 점검 (2026-11-11) — 운영 배포 보류

**결론: M9 를 푸시하지 않았다.** 운영은 M8 그대로다.

| 조건 (Batch 1 지시)                       | 결과                                                                                                                                   |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Git · 다섯 관문                           | ✔ `8d8a7d5` 에서 type-check · test (42 파일 · 1629) · lint · format:check · build 모두 EXIT 0. 빌드가 M9-6 검증 빌드와 **바이트 동일** |
| 정규 HTTPS origin · 데이터 보존 위험 확인 | ✖ **§4 미수행.** 이 환경에는 Cloudflare 대시보드 접근 권한이 없다(wrangler 도 이 기기에서 돌지 않는다, §0). 설정을 우회하지 않았다     |
| 주요 기능의 중대한 데이터 손실 문제       | 없음 (M9-6). 단 §4 전에 배포하면 Moments 가 `http`/`https` 로 **새로** 갈린다                                                          |
| 기존 배포 설정 변경 없이 배포 가능        | ✔ — `main` 푸시만으로 된다(§2). 그러나 위 둘째 줄 때문에 보류                                                                          |

실측 (읽기만 — `curl` · DoH · `openssl s_client` · 격리 프로필 Chromium, 설정 변경 없음):

| 확인                                        | 결과                                                                       |
| ------------------------------------------- | -------------------------------------------------------------------------- |
| `http://39page.com/` · `/some/path?x=1&y=2` | **200, 리다이렉트 없음**                                                   |
| `https://39page.com/` · `/anything?q=1`     | 200 · `server: cloudflare` · **HSTS 헤더 없음**                            |
| `www.39page.com`                            | **NXDOMAIN** (DoH Status 3). IP 를 지정해 접속하면 **530**                 |
| 인증서                                      | SAN `39page.com, *.39page.com` — `www` 도 덮는다 (§4-1)                    |
| 운영 번들                                   | `index-_5ud30QU.js` — M8 그대로                                            |
| Chromium 155 에서 `http://` 를 열면         | HTTPS-Upgrades 가 **307** 로 `https` 에 보낸다. 경로·쿼리·해시 보존 (§4-0) |

**운영 스모크 테스트는 하지 못했다** — M9 가 운영에 없기 때문이다. 같은
빌드는 M9-6 에서 로컬 정적 서버로 검증했다(실제 Chromium · 실제 YouTube 시나리오
1–16, 두 테마 × 7개 폭 163/163). Android Chrome · iOS Safari 실기기는 그때도
지금도 **미검증**이다.

**사용자가 할 일 (이 순서)**

1. §4-0 의 1단계 — 쓰는 브라우저마다 `http://39page.com` 을 열어 `https` 와
   다른 데이터가 있으면 백업 내보내기 → `https` 에서 가져오기
2. §4-1 의 1–3단계 (Cloudflare 대시보드)
3. §5 의 `curl` 검증 (경로·쿼리 보존과 루프 확인 포함)
4. `git push origin main` — `main` 에는 M9 커밋까지만 있다 (M10 은 별도 로컬
   브랜치 `m10-extension`). Workers Builds 가 배포한다
5. 아래 운영 스모크 테스트 · 실기기 확인

**M9 운영 스모크 테스트 (배포 후)** — 격리 프로필 · 테스트 데이터로

- [ ] 운영 번들이 로컬 `npm run build` 와 바이트 동일
- [ ] 두 테마 전환 — 재생이 끊기지 않고 iframe 이 그대로다
- [ ] YouTube 재생 · 일시정지
- [ ] Moment 저장 · 메모 수정 · 삭제
- [ ] 같은 영상의 Moment 재생(되감기) · 다른 영상의 Moment 재생(그 시점부터)
- [ ] 새로고침 뒤 Moments 유지
- [ ] JSON 내보내기에 Library · Theme · Moments 가 모두 있다
- [ ] JSON 가져오기 미리보기 → 승인 → 데이터 일치
- [ ] 구형(M8) 백업을 가져와도 Moments 가 남는다
- [ ] 드로어 열고 닫기 · 테마 전환에 iframe 재생성 없음
- [ ] Android Chrome · iOS Safari 실기기 (위 항목 중 재생 · Moment 저장 · 시트)

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
