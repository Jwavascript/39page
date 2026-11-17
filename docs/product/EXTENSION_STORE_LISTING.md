# Chrome Web Store 등록 정보 — Private 출시 초안

2026-11-17, Manifest 1.0.0 기준. 최초 업로드용 자료다. 심사 제출·승인·게시 완료를 의미하지 않는다.

## 기본 정보

| 항목             | 입력값                                                                                    |
| ---------------- | ----------------------------------------------------------------------------------------- |
| 이름             | 39page                                                                                    |
| 짧은 설명        | YouTube 를 떠나지 않고, 보고 있는 영상과 지금 이 순간을 작은 패널에서 39page 에 담습니다. |
| 언어             | 한국어                                                                                    |
| 분류             | 생산성 (Dashboard에서 최종 확인)                                                          |
| 홈페이지         | https://39page.com                                                                        |
| 배포             | Private → Only trusted testers                                                            |
| 개인정보처리방침 | TODO: 검토·연락처 확정·승인 후 https://39page.com/privacy 게시 및 실제 응답 확인          |
| 지원             | TODO: 사용자가 관리할 공개 지원 URL 또는 이메일 확정                                      |

## 상세 설명 — 붙여넣기

39page는 음악 중심의 개인 대시보드입니다. 이 확장은 YouTube에서 보고 있는 영상의 링크와 기억하고 싶은 시점을 39page에 담는 도구입니다.

• YouTube 위 작은 카세트 패널에서 플레이리스트를 고르고 곡을 담습니다.
• 새 플레이리스트를 만들면서 곡을 담을 수 있습니다.
• 이미 있는 곡은 위치를 알려주며, 한 번 더 담을지 직접 선택합니다.
• Moment는 누른 순간의 재생 시점을 고정합니다. 메모를 쓰고 저장하면 그 시점부터 다시 들을 수 있습니다.
• 직접 저장에는 39page 사이트 접근 권한이 필요합니다. 허용하지 않거나 연결할 수 없으면 39page 수집 화면을 새 탭으로 열어 확인 후 저장할 수 있습니다.

도구 모음 아이콘 또는 Alt+Shift+Y로 음악 담기, Alt+Shift+M으로 Moment 패널을 엽니다. 단축키는 chrome://extensions/shortcuts에서 변경할 수 있습니다. YouTube에서 패널이 열리면 팝업은 닫히며, 패널을 열 수 없을 때 팝업의 수집 화면 경로를 제공합니다.

지원: youtube.com과 m.youtube.com의 영상 페이지. Shorts와 라이브는 곡을 담을 수 있지만 Moment 저장은 지원하지 않습니다. 광고 중이거나 재생 전에는 시점을 잡지 않습니다. YouTube Music은 지원하지 않습니다.

곡과 Moments는 사용 중인 브라우저의 39page 사이트 저장소에 보관됩니다. 클라우드 계정 동기화는 제공하지 않습니다. 브라우저·프로필·기기를 바꾸면 데이터가 자동으로 이동하지 않으므로 39page의 백업 기능을 이용하세요.

## 단일 목적

사용자가 선택한 YouTube 영상의 링크·제목·재생 시점 및 직접 입력한 메모를 자신의 39page 플레이리스트와 Moments에 수집하는 것. 목록 조회·중복 확인·새 목록 생성은 이 수집 작업을 돕습니다.

## 권한별 사유

| 권한·선언                                       | 사용 목적과 범위                                                                                                                                                   |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| activeTab                                       | 사용자가 아이콘·단축키를 누른 활성 탭의 주소를 확인하고 YouTube 영상 정보를 읽기 위한 일시 접근. 방문 기록 전체를 조회하지 않는다.                                 |
| scripting                                       | 해당 YouTube 탭에서 패키지의 content.js를 실행해 영상 ID·제목·시점을 확인하고, 패널 iframe을 생성·닫는다. 상시 자동 주입은 하지 않는다.                            |
| offscreen                                       | 권한 승인 후 39page 브리지 iframe을 담는 숨은 문서를 생성해 사이트 저장소와 메시지를 교환한다. 서비스 워커에는 DOM과 localStorage가 없다.                          |
| optional_host_permissions: https://39page.com/* | 직접 저장을 선택한 사용자에게 추가로 요청한다. 권한이 먼저 승인돼야 브리지 iframe이 같은 브라우저의 39page 저장소에 접근할 조건이 성립한다. 철회 시 문서를 닫는다. |
| web_accessible_resources                        | 패키지의 패널 HTML만 www.youtube.com·m.youtube.com에서 표시한다. 모든 사이트 접근 권한이 아니다.                                                                   |
| commands                                        | 두 사용자 단축키 선언. 별도 권한이 아니다.                                                                                                                         |

MV3·Chrome 116·권한·호스트 범위·key 미포함을 유지한다. 116은 runtime.getContexts와 저장소 분할/호스트 권한 동작을 전제로 한 기존 정책이다. Chrome 116 실측은 별도 TODO다.

## 원격 코드 입력란

확장 페이지의 JS·Vue·content script는 ZIP에 포함한다. eval/new Function, 원격 JS를 확장 문맥에 주입하는 코드는 없다.
다만 offscreen 문서가 https://39page.com/bridge.html (최종 /bridge)을 iframe으로 열며, 그 웹사이트 문맥에서는 원격 웹앱 JS가 실행된다. 이 코드는 확장 API에 접근하지 않고 고정된 브리지 명령으로 사이트의 로컬 저장소를 읽고 쓴다. 임의 코드 실행·명령 다운로드·일반 RPC는 제공하지 않는다.

Dashboard 원격 코드 질문에는 이 구조를 명시한다. 단순히 사용 안 함으로 신고하지 않는다. [MV3 정책 2항의 iframe 예외](https://developer.chrome.com/docs/webstore/program-policies/mv3-requirements)에 근거하되 최종 적합성은 심사에서 결정된다. 검토자가 전체 기능을 확인할 수 있도록 브리지 소스와 [검증 안내](../development/CWS_PRIVATE_RELEASE.md)를 제공한다.

## Privacy Practices 근거

| 양식 항목                                      | 권장 신고와 근거                                                                                    |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Website content                                | 해당: YouTube 영상 제목·ID·시점, 사용자가 입력한 메모·목록 이름을 기능에 사용한다.                  |
| Web history                                    | 보수적으로 해당: 사용자가 실행한 탭 URL에서 영상 ID를 읽는다. 전체 방문 기록 API는 사용하지 않는다. |
| Personally identifiable information            | 이름·이메일·계정 ID를 요구하지 않는다. 메모에 개인정보를 직접 쓰면 로컬에 포함될 수 있다.           |
| Personal communications                        | 메시지 서비스·메일·채팅을 읽지 않는다. 메모가 현재 양식의 정의에 포함되는지 제출 시 확인한다.       |
| User activity                                  | 키 입력 추적·클릭 분석·이동 추적을 하지 않는다. 저장 버튼 동작만 처리한다.                          |
| Location / health / financial / authentication | 기능상 수집하지 않는다. 웹앱 날씨는 고정 좌표이며 위치 API를 쓰지 않는다.                           |
| 판매·목적 외 이용·신용 평가 금지               | 세 항목 모두 준수. 해당 기능이 없다.                                                                |

로컬 저장이라는 이유로 모두 해당 없음으로 신고하지 않는다. 네트워크·호스팅 로그와 웹앱의 YouTube/날씨 요청은 [개인정보처리방침](EXTENSION_PRIVACY.md)에 별도 설명한다. 제출 시 최신 양식의 정의와 일치 여부를 다시 확인한다.

## 이미지와 정책

승인 Cassette 원본은 extension/src/ui/cassette.svg이며 128px 아이콘은 extension/icons/icon-128.png다. 과거 LP 아이콘·M10 스크린샷은 사용하지 않는다.
등록용 이미지와 실제 촬영 조건은 [출시 안내](../development/CWS_PRIVATE_RELEASE.md)에 기록한다.

정책 확인: [업로드 절차](https://developer.chrome.com/docs/webstore/publish), [Private 배포](https://developer.chrome.com/docs/webstore/cws-dashboard-distribution), [Privacy 입력](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy), [이미지 규격](https://developer.chrome.com/docs/webstore/images), [사용자 데이터 정책](https://developer.chrome.com/docs/webstore/program-policies/policies). 확인일 2026-11-17.
