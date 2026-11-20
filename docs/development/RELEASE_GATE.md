# M11·M12 운영 승격 Release Gate

> **2026-11-16 후속:** 사용자 승인 후 운영 배포·smoke를 완료했다. [실행 기록](PRODUCTION_RELEASE_2026_11_16.md).
> 아래 CONDITIONAL 판정과 미실행 표기는 배포 전 Gate 시점의 기록이다.

검증: 2026-11-15~16 KST, Windows / Node 26.13.0 / npm 11.20.0 / Chrome 157.0.8103.51.
이 문서는 **준비 보고서**다. 운영은 이미 M10을 서비스하며, 이번 대상은 M11·M12 및 후속 UX의 첫 운영 반영이다.

## 1. 판정과 승인 경계

| 항목                    | 결과                                                                                      |
| ----------------------- | ----------------------------------------------------------------------------------------- |
| 배포 가능               | **CONDITIONAL — 지금 배포하지 않음**                                                      |
| 검증한 코드 커밋        | **`e371fb52454ecac349f27843df8a15c1444bed5e`** (`extension-cassette-design`)              |
| 준비 브랜치             | `release-gate-2026-11-15` — 제품 소스 변경 없이 보고서·검증 자료만 추가                   |
| 최종 main 배포 SHA      | **아직 없음.** 원격 main의 기록을 보존하는 병합이 승인 후 필요                            |
| 남은 사전 조치          | Cloudflare 설정·활성/롤백 Version ID 확인, 실제 사용자 데이터 백업, 병합 후 최종 SHA 검증 |
| 이번에 실행하지 않은 것 | Git push, main 병합, 운영 배포, Web Store 업로드, 사용자 프로필 데이터 접근·삭제·초기화   |

사용자의 명시적 승인과 별도 요청 전에는 위 배포 작업을 실행하지 않는다.
새 기능·UI 재설계·권한·저장 계약·환경변수 변경도 하지 않았다.

## 2. Git ancestry와 병합 전략

작업 시작 시 `extension-cassette-design` = `e371fb5`, 작업 트리는 깨끗했다.
원격을 변경하지 않는 `git ls-remote --heads origin`과 GitHub 공개 API로 원격 main을 확인했다.

| 작업                  | 확인한 끝 커밋                     | e371fb5의 조상 |
| --------------------- | ---------------------------------- | -------------- |
| M11 브리지·UX         | f5a4932, a1259a3, db968bf, 1db699e | 모두 YES       |
| M12 Artwork·백업      | fd4b995                            | YES            |
| M12-6 UX Polish       | 7ebc67b, 8884ae1, bbaa80c, 325226d | 모두 YES       |
| Artwork Editor 후속   | b73c96e, e65f8c7, f2b290f          | 모두 YES       |
| 헤더 접기·화살표 후속 | f304cce, 850a45e, 80a4cd3          | 모두 YES       |
| 확장 Cassette         | e371fb5                            | 동일 커밋      |
| 원격 main의 운영 기록 | **2bc8fd2**                        | **NO**         |

기존 로컬 작업 브랜치의 tip도 모두 e371fb5에 포함된다. 원격 main은
`2bc8fd2af9ac2609ce2f565a19c6ab185253d497`, 공통 조상은 `9b4035d`다.
원격에만 1개, 후보에만 42개 커밋이 있다. e371fb5를 main에 단순 fast-forward할 수 없다.

누락된 2bc8fd2는 `DEPLOYMENT.md`의 M10 운영 기록과 `EXTENSION_RELEASE.md`만 변경한다.
`git merge-tree --write-tree --messages e371fb5 origin/main` **시뮬레이션만** 실행했다.
충돌 없이 tree `db0bcb602eff315bef110521e60544f0a9192d68`을 계산했고 후보와의 차이는 이 두 문서뿐이었다.
브랜치·index·main에 병합을 적용하지 않았다. 원격 내용이 달라지면 충돌 가능성도 다시 확인해야 한다.

승인 후 권장 전략은 원격 main에서 통합 브랜치를 만들고 준비 브랜치를 병합해 두 이력을 모두 보존하는 것이다.
운영 기록을 버리는 reset/force push, 무검토 ours/theirs 선택을 사용하지 않는다.
최종 통합 SHA에서 제품·빌드 파일이 e371fb5와 같은지 확인하고 검사를 재실행한 다음 main을 fast-forward한다.

## 3. 운영 환경 — 확인한 사실과 미확인 항목

근거: [공개 환경 조사 원본](release-gate-results/environment-audit.json), 저장소 `wrangler.toml`,
기존 [DEPLOYMENT.md](DEPLOYMENT.md), [GitHub main](https://github.com/Jwavascript/39page/commit/2bc8fd2af9ac2609ce2f565a19c6ab185253d497).

| 항목                          | 확인한 내용                                                                                                                                                        |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 호스팅                        | 저장소 설정·기존 기록은 **Cloudflare Workers Static Assets**, Worker 이름 `39page`. 실제 응답 `server: cloudflare`                                                 |
| origin                        | `https://39page.com`. http와 www는 경로·쿼리를 유지해 301로 apex HTTPS 이동                                                                                        |
| 현재 운영 자산                | `index-BDctC-gs.js` / `index-D9zkpkAY.css`, HTML 기본 Mono. M10 배포 기록의 지문과 일치                                                                            |
| GitHub 원격 main              | 2bc8fd2. 해당 커밋의 `Workers Builds: 39page` check는 success (2026-11-12 00:07:21 UTC)                                                                            |
| 현재 활성 배포 SHA·Version ID | **Cloudflare 관리 화면에서 미확인.** 성공한 GitHub build나 같은 자산만으로 활성 Version ID를 확정하지 않음                                                         |
| CI/CD                         | 기존 기록: production branch `main`, root `/`, `npm run build` → `npx wrangler deploy`. 현재 dashboard 설정은 재확인 필요. 저장소에 GitHub Actions 워크플로는 없음 |
| 빌드 변수·Node                | 현재 세션에 해당 관리 설정/인증이 제공되지 않아 **Cloudflare의 실제 값은 미확인**. 로컬 `.env*` 및 VITE/Cloudflare 환경변수는 발견되지 않음                        |
| 정적 배포 설정                | `assets.directory=./dist`, SPA fallback, `workers_dev=false`, apex custom domain. 변경하지 않음                                                                    |
| 보안 응답 헤더                | 현재 운영 root/bridge 경로에 CSP·HSTS·nosniff·Referrer-Policy 응답 헤더가 없음. 현재 bridge 경로는 M10 SPA fallback                                                |
| 후보 bridge                   | `_headers`에 `/bridge`와 `/bridge.html` 모두 `frame-ancestors 'none'`, nosniff, no-referrer                                                                        |
| 웹앱 YouTube 설정             | index의 `strict-origin-when-cross-origin`, IFrame API `origin=window.location.origin`, controls/playsinline 유지. root에 no-referrer를 추가하지 않음               |

원시 HTTP 조사에는 자산별 SHA-256과 redirect 경로를 기록했다. 사용자 프로필은 열지 않았다.
GitHub check가 가리키는 **Build ID는 롤백용 Worker Version ID와 다르다**.
공개 HTTP/Git 조사로 확인할 수 없는 관리 설정은 사용자 확인 요청을 남겼으며 추측으로 채우지 않았다.

현재 운영 대비 후보에는 보관함/대시보드 UX·Cassette 기본값·Moments 개선·Artwork/구도·ZIP 백업/공유·헤더 접기가 들어간다.
확장 UI도 같은 코드 이력에 포함되지만 이번 웹앱 배포가 확장을 설치하거나 스토어에 게시하지는 않는다.

### Cloudflare에서 먼저 확인할 값

- production branch `main`, Worker `39page`, root `/`, build/deploy 명령이 기존 기록과 같은지.
- 현재 Active Deployment의 Git SHA와 **Worker Version ID**, 되돌릴 이전 Version이 실제 목록에 있고 계정에서 rollback 가능한지.
- **`VITE_BRIDGE_EXTENSION_IDS`는 미설정 또는 빈 값**, `VITE_BRIDGE_DEV_BUILD`는 미설정. 정식 ID/보안 준비 전 직접 저장을 켜지 않음.
- `NODE_VERSION` 등 실제 선택된 Node가 `package.json`의 `^22.18.0 || >=24.12.0`를 만족하는지.
  공식 build image의 현재 기본값과 이 Worker의 실제 설정은 구별한다. 로컬 재현은 Node 26.13.0이며 CI 런타임은 아직 재현하지 못했다.
- Cloudflare 인증 토큰은 보고서·대화·저장소에 복사하지 않는다.

설정 근거: [Workers Builds branch control](https://developers.cloudflare.com/workers/ci-cd/builds/build-branches/),
[build image와 버전 override](https://developers.cloudflare.com/workers/ci-cd/builds/build-image/).
이 Worker의 설정을 바꾼 것은 아니다.

## 4. 데이터 안전성과 백업

### 호환성 결과

| 데이터           | 결과와 한계                                                                                                                 |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------- |
| localStorage     | library·moments·theme 키/봉투 버전 1 유지. 실제 운영 M10 자산을 로컬에서 실행한 뒤 후보로 올려 세 봉투 원문이 동일함을 확인 |
| 기존 테마        | 저장된 Mono 유지. 저장값 없는 새 프로필에만 Cassette 기본값이 적용됨                                                        |
| Artwork          | `39page-artwork` DB 버전 1, assets/blobs/assignments 유지. 새 구도는 선택 display 필드이며 원본 바이트를 바꾸지 않음        |
| ZIP v2           | 실제 UI로 생성·다운로드 후 새 Chrome 프로필에 복원. 원본 GIF 해시·연결·구도·목록·테마 확인                                  |
| ZIP v1           | 유효한 v1 시험 패키지를 새 격리 context에 복원. 그림 해시·연결 유지, UI 기본 구도 cover/50/50/1 확인                        |
| Moments          | 기존 M10 데이터 읽기 보존, 후보 UI 신규 메모·시점 저장, 내려받은 ZIP에 포함됨을 확인                                        |
| M10 코드 롤백    | 같은 로컬 origin에서 실제 M10 자산으로 되돌려 열고 재승격해 세 봉투·DB 메타·그림 해시·구도가 동일함을 확인                  |
| 구버전 파일 읽기 | M10은 **JSON만** 지원하며 새 ZIP v1/v2·Artwork UI를 읽지 못함. ZIP은 새 버전 복구용으로 외부 보관                           |

[데이터 왕복 원본](release-gate-results/data-compat.json). 롤백 검사는 새 문서로 열기/재승격 범위이며 구버전에서의 모든 편집 조합을 보장하지 않는다.
롤백 뒤 Artwork가 안 보이는 것과 데이터가 지워진 것은 다르다. 코드 롤백은 사용자 데이터를 과거 시점으로 돌리지 않는다.

### 배포 전 사용자 백업 절차 — 아직 완료로 간주하지 않음

1. 실제 사용하는 **같은 브라우저·프로필의 `https://39page.com`**에서 목록·Moments·현재 테마를 확인한다.
2. 현재 운영 M10은 **ZIP 메뉴가 없다**. 레코드 편집 영역의 DATA/백업에서 **JSON 백업 내보내기**를 눌러 파일을 브라우저 밖에 보관한다.
   온전한 백업인지 확인하고, 복구본 경고가 있으면 배포 전에 원인을 확인한다.
3. 이미 M12 Artwork가 있는 프로필은 **그림·새 구도가 든 전체 ZIP을 배포 전에 따로 보관해야 한다**.
   M12 화면을 이용할 수 없고 구버전 UI만 보이면 JSON으로 Artwork까지 백업됐다고 간주하지 않는다. 사전 ZIP 확보 방법을 먼저 확인한다.
4. 백업은 원본 운영 프로필에 되가져와 시험하지 않는다. 격리 프로필에서 파일 미리보기·복원을 확인하고 개수·그림을 대조한다.
5. 배포 직전 모든 39page 탭에서 편집을 마친다. 배포 후 모든 기존 탭/PWA 창을 새로고침해 버전을 맞춘다.
6. 새 버전에서 데이터가 그대로인지 확인한 후 **데이터·백업 → 전체 백업(ZIP)**을 내려받고, 사전 JSON과 함께 보관한다.

평소 프로필을 이번 자동 검증에서 읽지 않았으므로 데이터 유무·사용자의 사전 백업 완료는 확인되지 않았다.
캐시/사이트 데이터 지우기, IndexedDB 삭제, 브라우저 저장소 초기화를 배포 절차로 사용하지 않는다.
일반 새로고침/강력 새로고침과 **사이트 데이터 삭제**를 혼동하지 않는다.
localhost·www·http·다른 브라우저 프로필의 저장소는 운영 apex HTTPS와 서로 다르다.

## 5. 운영 빌드 최종 검사

검사는 e371fb5와 동일한 제품 소스에서 수행했다. 추가한 파일은 보고서·검증 하네스/자료뿐이다.
원본: [검사·산출물 해시](release-gate-results/verification.json).

| 명령/검사                                        | 이번 실행 결과                                                                                  |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| root `npm run type-check`                        | 통과                                                                                            |
| root `npm run lint`, `npm run format:check`      | 통과                                                                                            |
| root `npm test`                                  | **67파일 / 2,127 통과**                                                                         |
| root `npm run build`                             | 통과, 8개 산출물 SHA-256 기록                                                                   |
| extension `npm test`                             | **26파일 / 420 통과**                                                                           |
| extension `npm run build`                        | type-check·두 빌드·Manifest 검사 통과, 기존 3권한·2단축키·4아이콘·개발용 key 없음               |
| extension `npm run lint`, `npm run format:check` | 통과                                                                                            |
| 헤더 Chrome 회귀                                 | **43/43** — 두 테마·반복·키보드·공간·스크롤·같은 iframe/진행하는 실제 영상                      |
| Artwork Editor Chrome 회귀                       | **98/98** — 업로드·미리보기·드래그·구도·취소·저장·새로고침·두 테마·좁은/가로 화면               |
| M12-6 UX/ZIP Chrome 회귀                         | **49/49** — 보관함·제목·Moment 경고·영상·새 프로필 ZIP/공유 구도 왕복                           |
| 데이터 업그레이드/롤백·ZIP v1/v2                 | **7/7** — 운영 자산 재생은 로컬에서만 수행                                                      |
| 운영 설정의 local smoke                          | **7/7** — YouTube·NOW PLAYLIST·다음/이전·Moment 저장·ZIP 다운로드·브리지 거부·Collect 확인 저장 |

이전 보고서 숫자를 재사용하지 않고 하네스를 다시 실행했다.
[회귀 집계](release-gate-results/browser-regression.json) · [운영 설정 smoke](release-gate-results/smoke.json).
Chrome/테스트 프로필은 모두 새 격리 환경이다. 운영에는 HTTP GET만 수행했다.
Node Web Storage ExperimentalWarning·Vite 향후 configLoader 안내는 있었고 검사 명령은 통과했다.

검증 하네스의 첫 데이터 실행은 ZIP v1 레코드에도 display가 반드시 있다고 가정해 실패했다.
생략된 필드는 기존 기본값을 사용하므로 실제 Editor UI 값을 검사하도록 고쳤고 전체 데이터 검사를 7/7로 재실행했다.
실패 원본은 `data-compat-run1.json`에 별도 보존한다. 제품 코드 수정은 없었다.

### 확장 운영 정책

- 웹앱 배포만 대상. 확장 Manifest·권한·호스트 범위·저장 계약과 정식 ID를 바꾸지 않는다.
- 후보 웹 빌드의 허용 확장 ID는 비어 있고 개발 ID 문자열도 없다. 실제 브라우저에서 bridge가 `refused`이고 저장소를 건드리지 않음을 확인했다.
- 로컬 preview는 `_headers`를 적용하지 않으므로 **배포 후 실제 `/bridge`·`/bridge.html`의 CSP 응답을 반드시 확인**한다.
- Collect는 화면을 여는 것만으로 저장하지 않으며, 명시적 확인 후 기존 store에 저장되는 것을 다시 확인했다.
- Web Store 업로드·정식 ID 발급·운영 직접 저장 활성화는 별도 작업이다.

## 6. 승인 후 실행할 배포 계획 — 이번에는 실행하지 않음

1. Cloudflare·백업 조건을 먼저 충족하고 현재 Version ID/활성 SHA·자산 지문을 기록한다.
2. 아래 통합을 수행하되 원격이 달라졌으면 ancestry·충돌 검토부터 다시 한다.
3. 최종 통합 SHA를 기록하고, 소스 동등성 및 검사 명령을 **그 SHA에서 재실행**한다.
   이 보고서는 아직 만들어지지 않은 main 병합 SHA를 검증했다고 주장하지 않는다.
4. main push가 운영 배포를 시작하므로 마지막 승인 동작으로 수행한다. feature/report 브랜치도 이번에는 push하지 않는다.

```powershell
# 아래는 별도 승인 요청에서만 실행할 계획이다.
git fetch origin
git switch -c release/m11-m12 origin/main
git merge --no-ff release-gate-2026-11-15
git rev-parse HEAD
git diff --exit-code e371fb5 HEAD -- src public index.html bridge.html package.json package-lock.json vite.config.ts wrangler.toml extension

# 이 통합 SHA에서 root/extension 품질 게이트를 다시 실행하고 산출물 해시 확인.
# origin/main이 조사 때와 같은지도 확인한 후 마지막 단계만 진행.
git switch main
git merge --ff-only origin/main
git merge --ff-only release/m11-m12
git push origin main
```

현재 문서상 Cloudflare CI는 root `npm run build` 후 **`npx wrangler deploy`**를 실행한다.
관리 화면에서 이 값과 브랜치를 확인하기 전 실행하지 않는다. 별도 로컬 Wrangler 배포를 병행하지 않는다.
빌드 성공만으로 끝내지 않고 실제 응답의 신규 자산 SHA/헤더와 다음 smoke를 확인한다.

## 7. 배포 직후 Smoke Test

운영 반영 전에는 아래 항목을 완료로 체크하지 않는다. 사용자 프로필에서는 먼저 보존 여부를 읽어 확인하고,
추가/삭제·복원 시험은 별도 격리 프로필의 시험 데이터로 수행한다.

- [ ] Cloudflare가 승인한 최종 SHA를 배포했고 Active Version ID/시각을 기록했다.
- [ ] apex HTTPS 200, http/www 301, JS/CSS는 올바른 MIME·자산 해시. 콘솔의 chunk/MIME 오류 없음.
- [ ] `/bridge` 및 `/bridge.html`의 최종 응답 CSP는 `frame-ancestors 'none'`, nosniff·no-referrer 존재.
- [ ] 기존 프로필 목록·곡·Moments·테마·Artwork가 보존됨. 기존 Mono 선택은 그대로, 빈 프로필은 Cassette.
- [ ] 재생·일시정지·재개·다음/이전, NOW PLAYLIST의 현재 곡/순서와 큐가 정상.
- [ ] 보관함 열기/닫기, Moments 열기/메모/저장/해당 시점 재생 정상.
- [ ] Artwork 표시·업로드·구도 편집·취소/저장·새로고침 유지 정상 (시험 데이터).
- [ ] 헤더 접기/펼치기·테마 전환 중 같은 iframe과 재생 유지, 가로 넘침 없음.
- [ ] 전체 ZIP 다운로드, 격리 프로필에 복원해 목록·Moments·그림·구도·테마 대조.
- [ ] Collect 폴백은 확인하기 전 쓰지 않고 확인 뒤 한 번만 저장. 확장 직접 저장은 계속 비활성.
- [ ] 기존 탭을 모두 새로고침한 뒤 사용 시작, 사전 JSON + 새 ZIP을 외부 보관.

지연 로드 자산이 추가된 후보이므로 배포/롤백 전후 오래 열린 탭의 자산 버전이 섞이지 않게 새로고침한다.
[Cloudflare version skew 안내](https://developers.cloudflare.com/workers/versions-and-deployments/version-skew/)도 같은 자산 가용성 문제를 설명한다.

## 8. 실패 시 롤백

**선행: 현재 안정 Version ID와 rollback 권한을 아직 확인하지 못했다. 이를 확보하기 전 배포하지 않는다.**

1. P0/P1이면 추가 편집/배포 push를 중단하고 시각·증상·현재 SHA를 기록한다. 가능한 경우 현재 새 ZIP도 보관한다.
2. Cloudflare **Workers & Pages → 39page → Deployments → 기록해 둔 이전 Version → Rollback**으로 복귀한다.
   공식 [rollback 절차](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/) 기준이다.
   GitHub Build ID나 Git SHA를 Worker Version ID 자리에 넣지 않는다.
3. CLI를 사용하는 별도 승인 작업이라면 다음의 실제 Version ID를 채운다. 이번에는 실행하지 않았다.

```powershell
npx wrangler rollback <PREVIOUS_WORKER_VERSION_ID> --name 39page
```

4. M10 자산 지문·사이트 로딩·재생·JSON 데이터가 정상인지 확인하고 모든 기존 탭을 새로고침한다.
5. 브라우저 저장소를 지우거나 백업을 운영 원본에 즉시 덮어쓰지 않는다. 코드 복귀와 데이터 복원을 구별한다.
   M10은 새 Artwork/ZIP UI를 지원하지 않으므로 문제 확인 중 쓰기를 최소화하고 ZIP을 보관한다.
6. Cloudflare rollback은 Git main을 바꾸지 않는다. 문제가 남은 main에서 재배포되지 않게 추가 push를 중단한다.
   이후 별도 승인으로 수정/revert를 준비한다. force push는 사용하지 않는다.

이 작업에서 실제 운영 rollback을 수행해 보지는 않았다. 로컬 데이터 호환성 검사와 운영 rollback 권한 확인은 별개다.

## 9. 3~7일 안정화와 남은 항목

[사용 기록·피드백 양식](POST_RELEASE_FEEDBACK.md)에 배포일을 Day 0으로 기록한다.
P0/P1은 즉시 대응하고 일반 UX 변경은 안정화 묶음으로 분리한다. 자동 피드백 수집 기능을 새로 추가하지 않았다.

미해결 Gate: Cloudflare 활성/이전 Version ID·현재 CI 설정/Node/빌드 변수, 사용자 데이터 백업 완료,
최종 통합 SHA의 재검증, 승인 후 실제 운영 헤더/HTTPS YouTube/smoke.
추가 UAT: 실제 F11·확장 단축키, 화면 낭독기·실기기/Safari·Chrome 116 등은 이번 Windows Chrome 검사에 포함하지 않았다.
이들을 완료했다고 보고하지 않는다.

변경 파일: 이 보고서·피드백 양식과 `release-gate-results/` 검증 자료/하네스. 새 의존성·제품 코드 변경·삭제 파일 없음.
전체 경로는 [변경 파일 목록](release-gate-results/changed-files.md)에 기록한다.
