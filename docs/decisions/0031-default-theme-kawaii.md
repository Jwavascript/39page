# 0031. Theme 1 과 새 사용자의 기본 테마를 Kawaii Synth Cassette 로 한다 — 테마 키 · 저장 형식은 그대로

- 상태: **채택 — M11-7B (2026-11-14, 사용자 결정 · 로컬 브랜치)**
- 관련: **ADR 0001** (테마 전환 — `data-theme` 교체), `docs/architecture/THEME_SYSTEM.md` §2 · §3.3, ADR 0030

## 배경

M1 부터 표시 순서는 Mono Vinyl(01) → Kawaii Synth Cassette(02) 였고, 저장된 테마가 없는 사용자는 Mono Vinyl 로
시작했다. 사용자가 Kawaii Synth Cassette 를 39page 의 첫 얼굴로 정했다 (M11-7B 지시).

## 결정

1. **표시 순서**: Theme 1 = Kawaii Synth Cassette (`01 / SYNTH CASSETTE`), Theme 2 = Mono Vinyl (`02 / MONO VINYL`).
   `THEME_KEYS` 순서가 곧 표시 순서다.
2. **기본 테마**: `DEFAULT_THEME_KEY = 'kawaii-synth-cassette'`. 저장된 테마가 **없을 때**와 저장된 값을 읽을 수
   없을 때(알 수 없는 키 · 손상 · 미래 버전) 이 값을 쓴다 — 후자는 M1 부터의 규칙이고 기본값만 바뀌었다.
3. **테마 키를 바꾸지 않는다.** `mono-vinyl` · `kawaii-synth-cassette` 는 그대로다. 저장 키(`39page.theme`) ·
   형식(`{ version: 1, data: <키> }`) · 백업 파일의 `theme` 도 그대로라 **마이그레이션이 없다.** Mono Vinyl 을 골라 둔
   사용자는 Mono Vinyl 로, Cassette 를 골라 둔 사용자는 Cassette 로 남는다. 읽기는 저장소에 쓰지 않는다.
4. **첫 페인트 스크립트**(`index.html`)는 `<html data-theme="kawaii-synth-cassette">` 를 기본으로 두고, 저장된 값이
   **알려진 두 키일 때만** 덮어쓴다. CSS 의 바탕 토큰(bare `:root`)은 여전히 Mono Vinyl 이라(kawaii 가 재정의하지 않은
   값의 바탕 — THEME_SYSTEM §4.7), 알 수 없는 값을 그대로 넣으면 Mono 배경이 한 프레임 비친다. 키 목록이 이 스크립트에
   한 번 더 적히는 대가는 시험(`theme-store.spec.ts`)이 `THEME_KEYS` 와 같은지 지킨다.
5. 레이블의 번호만 바뀌었다 — 이름 · 디자인 · 토큰 · 문구는 승인된 레퍼런스(v09) 그대로다. 레퍼런스 파일은 고치지 않았다.

## 결과

- 시험: 기본 테마를 전제하던 시험을 갱신했고, 기존 사용자 보호(빈 프로필 · Mono 저장 · Cassette 저장 · 전환 → 새로고침
  · 표시 순서) 시험을 더했다. 실제 Chrome: 빈 프로필 → Cassette, 저장된 Mono → 새로고침 뒤 Mono (M11-7B 실측).
- 백업 복원은 백업 파일의 테마를 그대로 따른다 (M8 규칙 그대로).
