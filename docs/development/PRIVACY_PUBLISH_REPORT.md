# 개인정보처리방침 게시 (2026-11-18 KST)

사용자의 게시 요청에 따라 https://39page.com/privacy 에 최종 문서를 게시했다.
운영 기준 cac19d5에서 별도 worktree/브랜치 release/privacy-page를 만들고 public/privacy.html 한 파일만 추가했다.
배포 커밋 c754100, main에 fast-forward push. Cloudflare Workers Builds 완료 success 확인.
기존 작업 브랜치의 확장·브리지 변경은 운영에 포함하지 않았다.

시행일 2026-11-18, 문의 jwavascript@gmail.com. 초안/TODO 제거. 로컬 저장, 웹 브리지 전달, 외부 YouTube/Open-Meteo 및 Cloudflare 네트워크 진단, 백업·삭제 안내 포함.

검증:

- 별도 worktree npm run build: 타입 검사·production build 통과.
- Prettier check: public/privacy.html·docs/product/EXTENSION_PRIVACY.md 통과. Markdown 초기 포맷 경고를 수정 후 재확인.
- GET /privacy: HTTP 200, 준비한 HTML과 바이트 일치. 초안/TODO 없음.
- HTML SHA-256: 303b6aea8621873bb781d93467aa6cfd188d6a063ddfae9964b0b1b415f61e8e
- /privacy.html: /privacy로 307 리다이렉트.
- /bridge.html → /bridge: frame-ancestors none 유지.
- git diff --check 통과. 콘텐츠 추가만이므로 전체 단위 테스트는 재실행하지 않았다.

로컬 변경/추가: public/privacy.html, docs/product/EXTENSION_PRIVACY.md, docs/product/EXTENSION_STORE_LISTING.md, 이 보고서.
의존성 추가 없음. 원복은 운영 c754100 커밋을 revert하여 재배포한다. 기존 웹앱 파일·저장소 키·재생 로직 변경 없음.

이 게시가 스토어 제출이나 BUG-001 브리지 활성화를 뜻하지 않는다. 공식 Store ID 확보 및 해당 ID만 허용하는 브리지 검증·운영 변경은 별도 TODO다.
