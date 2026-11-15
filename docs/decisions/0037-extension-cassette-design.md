# 0037. 확장 팝업·패널의 기본 외형은 웹앱 Cassette 토큰과 승인된 카세트를 재사용한다

- 상태: 채택 — 사용자 출시 전 디자인 정리 요청 (2026-11-15)
- 관련: ADR 0022 (독립 빌드·순수 CSS 공유), 0023 (Collect), 0028 (저장 브리지), 0031 (웹앱 기본 테마)

## 결정

1. 팝업·패널 HTML에 `data-theme="kawaii-synth-cassette"`를 정적으로 두고 두 entry가 웹앱의 공통 토큰 및
   `src/themes/kawaii-synth-cassette/tokens.css`를 가져온다. 최초 페인트부터 같은 색이다.
   ADR 0022의 CSS 허용 목록에서 Mono 토큰을 Cassette 토큰으로 교체한다. 웹앱 Vue 컴포넌트나 store는 가져오지 않는다.
2. 그라디언트·카드·입력·목록·버튼·알림은 기존 의미 토큰을 사용한다. 도트 장식은 artwork dot 토큰을 사용한다.
   확장 크기에 맞춘 여백·한 열 구성은 유지하며, 긴 목록 이름과 메모는 줄바꿈·내부 스크롤로 읽는다.
3. 브랜드와 툴바 아이콘은 승인된 Cassette `DeckArt.vue`의 카세트 내부 부분을 잘라 사용한다.
   `extension/src/ui/cassette.svg`가 원본이며 도형 좌표·색은 유지한다. viewBox로 크기를 맞추고 가변 foreignObject만
   기존 기본 레이블의 정적 text로 치환한다. 16/32/48/128 PNG는 같은 SVG를 Chrome canvas로 렌더한다.
   `design/assets/extension-icon.svg`의 이전 LP 초안은 과거 자료로 남기며 현재 확장의 원본은 아니다.
4. 성공·실패·불확실·부분 성공·권한 요청은 텍스트·기호·ARIA 역할로 구별한다. 성공은 기존 저장 확인 결과만 따른다.
   기본 포커스 링과 44px 조작 영역을 유지한다. 상태 로직·메시지 계약·데이터 보호 규칙은 바꾸지 않는다.
5. 확장 테마는 Cassette로 고정한다. 웹앱의 사용자 테마와 자동 동기화하지 않으며 별도 테마 저장 설정을 만들지 않는다.
6. Manifest 원본·권한·호스트 범위·개발 키/ID·저장 스키마·브리지·백그라운드·content·offscreen 로직은 유지한다.
   새로운 런타임/개발 의존성이나 원격 글꼴·이미지는 추가하지 않는다.

## 검증

실행 명령·실제 권한 프롬프트·저장·스크린샷·미검증 범위는 [출시 전 확장 테마 보고서](../development/EXTENSION_CASSETTE_REPORT.md)에 기록한다.
