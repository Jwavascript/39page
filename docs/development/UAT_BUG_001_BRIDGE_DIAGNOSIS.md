# BUG-001 운영 확장 플레이리스트 조회 실패 진단

조사일 2026-11-17 KST. 코드 기준 `562f8c1`. 조사 시작 작업 트리는 깨끗했다.

> **후속 (2026-11-20)** — 운영 빌드가 공식 Store ID 한 개를 허용한다: `/bridge` · `/bridge.html` 응답이
> `Content-Security-Policy: frame-ancestors chrome-extension://aaihanclknbboaehbjpmlcefkbgdeima` 다
> ([2026-11-20 배포 HTTP 확인](production-release-2026-11-20-results/http.json)). 빌드 변수는 운영자가 Cloudflare 에서 설정했고, 그
> 화면은 읽지 않았다. Store 설치본으로 실제 조회 · 저장을 끝까지 확인하지는 않았다 —
> [STORE_BRIDGE_ACTIVATION.md](STORE_BRIDGE_ACTIVATION.md) "배포 후 TODO" 그대로다.

## 판정

**운영 브리지의 허용 ID 설정이 비어 있고 CSP가 iframe 삽입을 차단한다.** 현재 운영 구성으로는 설치 ID `mfijienedkbogcldkjfjjmgbfkfidocb`의 직접 플레이리스트 조회가 성립하지 않는다.

공개 운영 응답과 JS를 직접 확인했다. 설치된 확장의 콘솔과 실제 요청 결과는 미확인이다. 따라서 운영 차단 원인은 확인했으며, 사용자 프로필에서 가장 먼저 실패한 단계는 로그로 확정해야 한다.

설치 ID는 사용자가 제공한 값이다. 설치 출처, 실제 패키지 바이트, Chrome Web Store 등록 ID와의 일치는 확인하지 못했다. Cassette 디자인 적용만으로 설치 패키지의 빌드 모드나 origin을 판정할 수 없다.

## 1. ID와 운영 빌드 비교

| 대상                   | 확인값                             | 근거                                          |
| ---------------------- | ---------------------------------- | --------------------------------------------- |
| 현재 설치 ID           | `mfijienedkbogcldkjfjjmgbfkfidocb` | 사용자 재현 정보                              |
| 개발 고정 ID           | `pkagnijdhfmkodpdfgdehfdghcgbfpoa` | `extension/vite.config.ts`, 개발 빌드 공개 키 |
| 운영 브리지 JS 허용 ID | 빈 목록                            | 공개 JS의 `var N=u(void 0),P=M(window,N,...)` |
| 운영 iframe 허용 부모  | 없음                               | 두 bridge 경로의 `frame-ancestors 'none'`     |

현재 ID는 개발 고정 ID와 다르며, 운영 허용 목록에는 두 ID 모두 없다. 운영에 별도 확장 ID가 활성화되어 있다는 증거도 없다.

웹앱의 `src/app/bridgeMain.ts`는 `VITE_BRIDGE_EXTENSION_IDS`를 빌드 시 읽는다. `parseAllowedExtensionOrigins(undefined)`는 `[]`를 만든다. `startBridge`는 허용된 조상 확인 후에만 store를 복원하고 메시지 리스너와 `ready` 신호를 활성화한다.

`vite.config.ts`는 동일한 ID 설정으로 `_headers`를 생성한다. 빈 목록은 두 bridge 경로에 `frame-ancestors 'none'`을 출력한다. 개발 고정 ID는 `VITE_BRIDGE_DEV_BUILD=1`인 시험 빌드에서만 허용한다.

Cloudflare 관리 화면의 환경변수 원문은 조회하지 않았다. 공개 산출물의 `void 0`와 헤더로 이번 운영 빌드의 유효 설정을 확인했다. 정적 JS의 Vite 설정을 바꾸려면 웹앱 재빌드가 필요하다.

## 2. 실제 운영 응답

아래 GET 요청을 실행했다. 첫 헤더 관측의 서버 Date는 `Mon, 16 Nov 2026 15:38:42 GMT`, 한국 시각으로 2026-11-17 00시 38분 42초다.

```powershell
curl.exe -sS -D - -o NUL https://39page.com/bridge.html
curl.exe -sS -D - https://39page.com/bridge
curl.exe -f -sS https://39page.com/assets/bridge-C4cijQlM.js
```

| 요청           | HTTP 결과                | 주요 응답 헤더                                    |
| -------------- | ------------------------ | ------------------------------------------------- |
| `/bridge.html` | 307, `Location: /bridge` | `Content-Security-Policy: frame-ancestors 'none'` |
| `/bridge`      | 200, bridge HTML         | `Content-Security-Policy: frame-ancestors 'none'` |

두 응답 모두 `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`가 있다. 최종 HTML은 `/assets/bridge-C4cijQlM.js`를 참조한다. 307 리다이렉트는 현재 호스팅의 HTML 정규화 동작과 일치한다.

JS는 9,752바이트이며 SHA-256은 아래와 같다.

```text
d3af7d39c2f0af9dc8657bb1d31e4ec939478c934a504101a1eab7c21d8bbad7
```

이 값은 [기존 운영 배포 HTTP 기록](production-release-results/http.json)의 bridge JS 해시와 일치한다. JS에서 현재 설치 ID와 개발 고정 ID 문자열은 모두 발견되지 않았고, 허용 목록 초기화 인수는 `void 0`이었다.

`frame-ancestors 'none'`은 해당 페이지의 iframe 삽입을 차단한다. 이 지시자는 응답 헤더에 적용해야 하며 모든 조상을 검사한다. [MDN frame-ancestors 문서](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/frame-ancestors)

## 3. 실패 단계와 화면 문구

다음은 현재 소스와 운영 헤더를 조합한 예상 경로다. 설치 확장 콘솔에서 관측한 타임라인은 아니다.

1. 패널 `useSaves.loadLists()`가 권한 상태 `granted`를 확인하고 로딩 문구를 표시한다.
2. 패널이 서비스 워커에 `bridge/call`, payload `library/list`를 보낸다.
3. 워커 `bridgeClient.ensure()`가 host permission을 확인하고 offscreen 문서를 만든다.
4. offscreen이 `https://39page.com/bridge.html` iframe을 삽입한다. 요청은 `/bridge`로 이동한다.
5. 운영 CSP가 iframe 로드를 차단하여 bridge의 `ready` 신호가 오지 않는다.
6. offscreen은 기본 8초 대기 뒤 `transport: 'not-ready'`를 반환한다. 워커의 외부 대기 한도는 9초다.
7. 워커는 `{ outcome: 'unavailable', reason: 'bridge-failed' }`로 변환하고 실패한 offscreen을 닫는다. 이 경로에서 웹앱으로 `library/list` 요청 봉투를 보내는 단계에는 도달하지 않는다.
8. `useSaves`는 성공 이외의 조회 결과를 `listPhase = 'failed'`로 합친다. `MusicTab.vue`가 “플레이리스트를 불러오지 못했어요.”를 표시한다. 재시도도 같은 운영 정책에 막힌다.

CSP를 바꾸는 것만으로도 연동은 완성되지 않는다. JS의 빈 허용 목록이 별도로 거부한다. JS의 거부 신호를 실제 수신한 경우에는 `transport: 'not-allowed'`와 `reason: 'not-allowed'`가 된다. CSP가 JS 실행 이전에 로드를 차단한 상황에서는 이 구체적인 거부 신호를 기대할 수 없다.

후속 UX 개선 후보는 조회 결과의 reason 보존과 권한·연결·명시적 거부의 안내 분리다. `bridge-failed`만으로 CSP 차단을 단정하는 문구를 만들면 네트워크 장애와 혼동된다.

## 4. 권한·타임아웃·프로토콜 구분

| 분류                | 확인할 증거                                                                                        | 현재 판단                                                                                     |
| ------------------- | -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| 사이트 권한 없음    | `permissions.contains`가 false, `bridge/state`의 `not-granted`, 조회 결과 `reason: 'permission'`   | 설치 프로필의 실제 권한은 미확인. 로딩 문구는 현재 코드에서 권한 granted를 확인한 후 표시됨   |
| offscreen 생성 실패 | `createDocument` 예외, offscreen context 부재, API 지원 여부                                       | 실제 예외 미확인. manifest는 `offscreen`과 최소 Chrome 116을 선언함                           |
| iframe CSP 차단     | offscreen 콘솔의 frame-ancestors 위반, 최종 응답 CSP, ready 미수신                                 | 운영 헤더의 차단은 확인. 설치 콘솔 메시지는 미확인                                            |
| JS ID 거부          | 정상 로드된 bridge에서 `kind: 'refused'`, `transport: 'not-allowed'`                               | 빈 운영 허용 목록 확인. CSP가 앞 단계에서 차단 가능                                           |
| 준비 타임아웃       | 약 8~9초, `not-ready` 또는 워커 ready 대기 초과                                                    | 현재 구성에서 예상. 사용자 환경의 실제 소요 시간은 미측정                                     |
| 요청 응답 타임아웃  | ready 후 요청 전송, 기본 30초 응답 대기, 읽기는 `bridge-failed`                                    | ready 이전 차단을 해소한 뒤 구분 가능                                                         |
| 메시지 프로토콜     | 라우터 `forbidden-sender`/입력 오류, 웹 응답 `unsupported-version`/`bad-request`, 잘못된 ns·v·id   | 로컬 양측은 namespace `39page-bridge`, v1. 계약 테스트 통과. 설치 패키지의 실제 응답은 미확인 |
| 저장소 분할·보호    | ready와 조회 성공 후 빈 목록 또는 보호 상태, 같은 Chrome 프로필·정확한 origin·host permission 확인 | 현재 확인된 iframe 차단 다음 단계에서 검사할 항목                                             |

이 구조는 offscreen iframe과 `postMessage`를 사용한다. manifest에 `externally_connectable`은 없으며 이 경로를 위해 추가할 필요가 없다. CORS 헤더 변경으로 `frame-ancestors` 차단을 해결할 수 없다.

host permission은 임베드된 웹 origin의 저장소 분할 예외에도 관여한다. 기존의 권한 확인·변경 시 offscreen 재생성 절차를 유지해야 한다. [Chrome 저장소 문서](https://developer.chrome.com/docs/extensions/develop/concepts/storage-and-cookies)

## 5. 로컬 통과와 운영 설정 차이

| 항목        | 로컬 Cassette 검증                                   | 현재 운영                                                    |
| ----------- | ---------------------------------------------------- | ------------------------------------------------------------ |
| 웹 origin   | `http://127.0.0.1:4173`                              | `https://39page.com`                                         |
| 확장 ID     | 개발 고정 ID `pkagnijdhfmkodpdfgdehfdghcgbfpoa`      | 사용자 제공 ID `mfijienedkbogcldkjfjjmgbfkfidocb`            |
| 웹 빌드     | 개발 ID 허용, `VITE_BRIDGE_DEV_BUILD=1`              | 허용 목록 없음                                               |
| 확장 빌드   | `build:dev`, `VITE_COLLECT_ORIGIN` localhost         | 설치 패키지 미열람. 소스의 production 빌드는 apex HTTPS 고정 |
| 헤더 적용   | 로컬 preview는 Cloudflare `_headers`를 적용하지 않음 | Cloudflare가 두 bridge 경로에 CSP 적용                       |
| 검증 데이터 | 새 임시 Chrome 프로필·합성 플레이리스트              | 사용자 프로필의 기존 플레이리스트                            |

[Cassette 보고서](EXTENSION_CASSETTE_REPORT.md)는 로컬 Chrome 12/12를 기록한다. [운영 배포 보고서](PRODUCTION_RELEASE_2026_11_16.md)는 직접 저장 비활성 및 top-level bridge 거부를 통과 조건으로 기록한다. 기존 성공 기록에 현재 설치 ID의 운영 직접 조회 성공 검증은 포함되어 있지 않다.

## 6. 설치 확장에서 확보할 로그

브라우저 접근 도구는 `The browser access host is unavailable`을 반환했다. 네이티브 Chrome 두 창도 최소화 상태 오류로 화면을 읽지 못했다. 확장 콘솔, 설치 파일, 사용자의 플레이리스트 원문에는 접근하지 못했다.

### 서비스 워커

`chrome://extensions/?id=mfijienedkbogcldkjfjjmgbfkfidocb`에서 ID·버전·설치 출처·사이트 접근 상태를 확인하고 service worker 검사 창을 연다. Console과 Network의 로그 보존을 켠 뒤 아래 읽기 전용 검사를 실행한다.

```javascript
console.log({
  id: chrome.runtime.id,
  version: chrome.runtime.getManifest().version,
  manifestVersion: chrome.runtime.getManifest().manifest_version,
  optionalHosts: chrome.runtime.getManifest().optional_host_permissions,
  userAgent: navigator.userAgent,
})
console.log('permission', await chrome.permissions.contains({ origins: ['https://39page.com/*'] }))
console.log('offscreen', await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] }))
```

패널에서 다시 불러오기를 누른 직후와 약 10초 뒤의 context 결과, worker 예외 원문과 stack, 로딩부터 실패까지 시간을 기록한다. 실패 후 워커가 offscreen을 닫으므로 최종 context가 빈 값이라는 사실만으로 생성 실패를 확정할 수 없다. DevTools를 열면 워커 수명에 영향을 주므로 검사 창을 닫은 재현 여부도 함께 기록한다.

### 패널과 offscreen

YouTube DevTools에서 실제 확장 패널 iframe 실행 컨텍스트를 선택한다. 정상적으로 열린 기존 패널에서 아래 조회를 실행하면 사용자 UI와 같은 워커 진입점을 이용한다. 일반 YouTube 페이지 컨텍스트에서는 실행하지 않는다.

```javascript
console.log('bridgeState', await chrome.runtime.sendMessage({ v: 1, type: 'bridge/state' }))
const requestId = crypto.randomUUID()
const startedAt = performance.now()
const result = await chrome.runtime.sendMessage({
  v: 1,
  type: 'bridge/call',
  requestId,
  payload: { op: 'library/list', videoId: null },
})
console.log('bridgeRead', {
  elapsedMs: Math.round(performance.now() - startedAt),
  routerOk: result?.ok,
  routerError: result?.error?.code,
  outcome: result?.data?.outcome,
  reason: result?.data?.reason,
  bridgeError: result?.data?.error?.code,
  status: result?.data?.data?.status,
  playlistCount: result?.data?.data?.playlists?.length,
})
```

offscreen이 존재하는 동안 `chrome://inspect/#extensions` 등의 검사 뷰에서 `src/offscreen/index.html?gen=…`을 연다. Console의 CSP 위반 원문과 Network의 bridge 요청 URL·307·최종 200·Response Headers·blocked 사유를 기록한다. 문서가 빨리 닫히면 Sources에서 `chrome.offscreen.createDocument` 성공 후와 ready 응답 후 위치에 중단점을 걸어 단계를 확인한다. 중단 중 경과 시간은 일반 타임아웃 측정에서 제외한다.

예상 CSP 오류는 `Framing 'https://39page.com/...' violates ... "frame-ancestors 'none'"`에 해당하는 내용이다. 실제 오류 원문은 추가로 확보해야 한다. `not-allowed`, `not-ready`, `timeout`, message port 연결 종료 등이 나오면 원문을 기록한다.

공유 로그는 위 메타데이터·오류·bridge 요청 헤더로 충분하다. 플레이리스트 이름·Moment 본문·localStorage/IndexedDB 전체·무관한 탭의 HAR 수집은 생략한다.

## 7. 안전한 수정안과 현재 ID 시험

### 현재 설정에서 가능한 확인

현재 ID로 위 읽기 검사를 수행해 permission, 실제 연결 origin, CSP, ready 실패를 확정한다. 공개 헤더와 JS 확인은 이번에 완료했다. 성공하는 직접 연동 시험에는 허용 설정을 갖춘 빌드가 필요하다.

### 기능 활성화 시 제한적인 수정안

1. 현재 ID의 출처와 설치 코드를 확인하고 시험 대상으로 승인한다. 상시 운영 ID는 Chrome Web Store에서 확정한 ID를 사용한다.
2. 승인된 빌드에서 `VITE_BRIDGE_EXTENSION_IDS=mfijienedkbogcldkjfjjmgbfkfidocb`를 설정한다. `VITE_BRIDGE_DEV_BUILD`는 미설정으로 둔다. 기존 ID 형식·조상·source/origin·sender 검사를 유지한다.
3. 같은 빌드에서 bridge JS와 `_headers`를 생성한다. 기대 CSP는 `frame-ancestors chrome-extension://mfijienedkbogcldkjfjjmgbfkfidocb`이며 `/bridge`와 `/bridge.html` 모두에 적용한다. 다른 계층의 추가 CSP나 X-Frame-Options도 최종 응답에서 확인한다.
4. Web Locks, 권한 재확인, 권한 변경 시 offscreen 재생성과 기존 프로토콜을 유지한다. 호스트 권한은 기존 `https://39page.com/*` 범위를 사용한다.
5. 격리한 Chrome 프로필에 검증한 동일 ID 패키지와 합성 데이터를 준비한다. 먼저 `hello`·`library/list`로 ready와 목록 일치를 확인하고 이후 쓰기 UAT를 진행한다.
6. 비허용 ID·일반 웹 부모·top-level bridge 거부, 권한 거부/철회, 재시도, 워커 재시작, 리다이렉트 후 CSP를 확인한다. 임시 ID 시험 종료 후에는 허용 삭제와 재빌드로 복원한다.

소스의 production 확장은 연결 주소가 `https://39page.com`으로 고정되어 있다. 따라서 다른 호스트의 후보 웹만 준비하면 현 설치 확장의 성공 경로를 시험할 수 없다. 운영 변경 전 성공 시험에는 같은 ID를 유지하는 관리된 UAT 확장과 허용 설정을 갖춘 격리 웹이 필요하다. 기존 localhost 개발 빌드에 맞춘 시험을 사용하고, 동일 ID 유지에 필요한 공개 키 등을 확인한다. 현재 설치를 유지한 운영 origin 성공 시험에는 승인된 제한적 웹 배포가 필요하다.

공개 키를 이용한 개발 중 ID 고정은 Chrome 공식 절차에 있다. 이 저장소의 production manifest 검사는 `key`를 금지하므로, 동일 ID UAT 패키지는 기존 출하 절차와 구분해 관리하고 검사 방침을 확인한다. [Chrome manifest key 문서](https://developer.chrome.com/docs/extensions/reference/manifest/key)

### 보안 영향

단일 ID 추가로 그 ID에 기존 프로토콜의 플레이리스트·Moment 읽기와 곡·목록·Moment 추가가 허용된다. 현재 구조에는 시험자 한정·읽기 전용·만료 시각 제어가 없다. 새 Chrome 프로필은 해당 프로필의 데이터를 격리하며, 공개 허용 설정은 같은 ID의 다른 설치에도 적용된다.

ID 문자열과 공개 키는 공개 정보다. 개발자 모드에서 같은 공개 키를 쓰는 코드는 같은 ID를 가질 수 있다. 배포 코드의 정당성을 위해 패키지·서명·업데이트 경로를 관리해야 한다.

대상 확장 침해나 불법적인 동일 ID 개발 빌드가 해당 프로필 데이터를 읽고 쓰는 위험을 고려한다. 승인된 짧은 시험 기간, 합성 데이터, 허용 삭제를 포함한 웹 재배포 복원 절차를 준비한다. 상시 사용은 정식 ID와 관리된 배포를 기준으로 한다.

## 8. 수정 후 배포 대상

| 수정 내용                                                | 필요한 대상                                                                                   |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| 승인 ID 직접 연동 허용                                   | **웹앱 재빌드와 Cloudflare 정적 자산 재배포**. bridge JS·HTML·`_headers`를 동일 산출물로 반영 |
| 현재 패키지가 production origin·v1 계약·기존 권한을 만족 | ID 허용을 위한 확장 갱신은 생략 가능. 실제 설치에서 조건 확인 필요                            |
| 목록 실패 reason 보존과 안내 개선                        | 확장 소스·관련 테스트 수정 후 확장 재빌드·재배포. 스토어 배포 시 version 갱신                 |
| 정식 ID가 현재 ID와 다른 경우                            | 정식 ID 확장 배포와 해당 ID를 허용하는 웹 재빌드·재배포                                       |
| 임시 시험 허용 철회                                      | 웹 ID 삭제·재빌드·재배포와 실제 헤더 확인                                                     |

## 9. 이번 검증과 변경

| 위치             | 실행 명령                                                                                                                | 결과                                                                              |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| root             | 위 `curl.exe` GET 3종                                                                                                    | 307/200·CSP·bridge JS 확인                                                        |
| root             | `npm test -- tests/unit/bridge.spec.ts tests/unit/bridge-headers.spec.ts`                                                | 2파일, 24테스트 통과                                                              |
| extension        | `npm test -- tests/bridgeClient.spec.ts tests/offscreenHost.spec.ts tests/bridgeRouter.spec.ts tests/panelSaves.spec.ts` | 실재하는 3파일, 26테스트 통과. `panelSaves.spec.ts`는 존재하지 않아 대상에서 빠짐 |
| extension        | `npm test -- tests/panelApp.spec.ts`                                                                                     | 1파일, 13테스트 통과                                                              |
| root / extension | `npm run type-check`                                                                                                     | 양쪽 통과                                                                         |

문서의 Prettier 검사는 초기 실패 후 포맷을 적용해 재검사에서 통과했다. 실행 명령은 `npx prettier --write docs/development/UAT_BUG_001_BRIDGE_DIAGNOSIS.md`와 같은 경로의 `npx prettier --check`다. `git diff --check`도 통과했다.

기존 Node localStorage ExperimentalWarning과 Vite configLoader 안내가 출력되었다. Python urllib의 공개 JS 요청은 403으로 실패해 curl GET으로 본문과 해시를 확인했다. 웹 도구의 운영 첫 화면 열기도 실패했다. 확장 실패 원인의 판단은 성공한 HTTP 조회와 소스 분석에 근거한다.

추가 파일은 이 진단 보고서 하나다. 의존성 추가·삭제는 없다. 이번 작업 범위는 진단과 문서 작성이다. 운영 E2E 성공 경로와 설치 확장 콘솔 실측은 TODO로 남아 있다.

## TODO

- 설치 확장의 ID·출처·빌드 origin·권한·v1 응답 실측.
- service worker와 offscreen 콘솔, ready 전후 실제 실패 단계·시간 확보.
- 승인할 시험 ID 또는 정식 ID 결정, 제한적 허용 빌드 배포와 복원 계획 확인.
- 필요 시 목록 오류 reason 보존 UX 수정과 관련 테스트.
- 승인된 배포 후 현재 ID 또는 정식 ID의 성공·거부 경로 운영 UAT.
