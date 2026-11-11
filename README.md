# 39page

음악 중심의 커스터마이징 웹 대시보드.

> 상태: **MVP(M0–M5) 완료**, **M6·M7(실기기 검증 후속) 구현 완료**,
> **M8 JSON 백업·복원 구현·검증·배포 완료.** 테마 2종과 테마 전환, YouTube
> IFrame Player API 재생, 플레이리스트 위젯과 편집 오버레이, 시계·날씨 위젯,
> 테마별 도트 마스코트, 라이브러리 JSON 백업·복원까지 구현했다.
> **<https://39page.com> 에 배포했고 M8 도 반영돼 있다** (2026-11-06).
>
> **M9 Music Moments 를 운영에 배포했다 (2026-11-11)** — 지금 이 순간을 저장하고,
> 목록에서 찾아 그 시점부터 다시 듣고, JSON 백업에 함께 실린다. `http`·`www` 는
> `https://39page.com` 으로 보낸다. 실기기(Android Chrome · iOS Safari) 확인이 남았다
> ([`docs/development/DEPLOYMENT.md`](docs/development/DEPLOYMENT.md) §5).
> 명세는 [`docs/product/MUSIC_MOMENTS.md`](docs/product/MUSIC_MOMENTS.md),
> 설계는 [`docs/architecture/MOMENTS_DESIGN.md`](docs/architecture/MOMENTS_DESIGN.md).
>
> 남은 검증: M7 의 변경(트리거 재배치, 하단 겹침 시트, 정보 열 정리)은 jsdom
> 단위·통합 테스트로만 확인했다. **실기기 재확인이 남아 있다** — 목록은
> [`docs/development/M7_PLAN.md`](docs/development/M7_PLAN.md) §6 에 있다.
>
> 승인된 디자인 기준은 [`design/references/`](design/references/README.md),
> MVP 이후 계획은 [`docs/development/POST_MVP_PLAN.md`](docs/development/POST_MVP_PLAN.md),
> 배포 절차는 [`docs/development/DEPLOYMENT.md`](docs/development/DEPLOYMENT.md) 참조.

## 요구사항

- Node.js `^22.18.0 || >=24.12.0`
- npm

## 시작하기

```sh
npm install     # 의존성 설치
npm run dev     # 개발 서버 (기본 http://localhost:5173)
```

## 명령

| 명령                 | 용도                                |
| -------------------- | ----------------------------------- |
| `npm run dev`        | 개발 서버                           |
| `npm run build`      | 타입 검사 + 프로덕션 빌드 (`dist/`) |
| `npm run preview`    | 빌드 결과 미리보기                  |
| `npm run type-check` | 타입 검사                           |
| `npm test`           | 테스트 1회 실행                     |
| `npm run test:unit`  | 테스트 watch 모드                   |
| `npm run lint`       | oxlint + ESLint (`--fix` 포함)      |
| `npm run format`     | Prettier 포맷                       |

## 기술 스택

Vue 3 (Composition API, `<script setup>`) · TypeScript · Vite · Pinia ·
Vitest · ESLint + Prettier · CSS Variables 기반 테마 시스템

## 구조

```
39page/
├── AGENTS.md              # 프로젝트 공통 작업 규칙
├── CLAUDE.md              # Claude Code 설정 (AGENTS.md 참조)
├── docs/
│   ├── product/           # MVP 스펙, 로드맵
│   ├── architecture/      # 시스템 설계, 테마 시스템
│   ├── decisions/         # 결정 기록 (ADR)
│   └── development/       # 구현 계획
├── design/
│   ├── references/        # 확정 HTML 디자인 참고자료 (수정 금지)
│   │   ├── two-themes-v09.html    # 최우선 기준 (테마 전환 · 카세트 · 마스코트)
│   │   └── mono-vinyl-v08.html    # Mono Vinyl · 기본 UX 기준
│   └── assets/            # 디자인 원본 에셋
├── public/                # 정적 파일
├── src/
│   ├── app/               # 앱 루트
│   ├── components/        # layout / ui
│   ├── features/          # playback / library / mascot
│   ├── themes/            # mono-vinyl / kawaii-synth-cassette
│   ├── widgets/           # clock / weather
│   ├── stores/            # Pinia
│   ├── shared/            # types / utils / storage
│   └── styles/            # 전역 스타일, CSS 변수 토큰
└── tests/
    ├── unit/
    └── integration/
```

`design/`은 빌드 대상이 아니며 소스코드와 분리한다.

## MVP 범위

포함: 테마 2종(Mono Vinyl, Kawaii Synth Cassette), 테마 전환,
YouTube IFrame Player API 재생, 플레이리스트 위젯과 편집 오버레이,
시계·날씨 위젯, 테마별 도트 마스코트, 기본 설정 로컬 저장.

제외: 로컬 음악 재생, 집중 모드, AI 에이전트, 소셜 기능.

자세한 내용은 [docs/product/MVP_SPEC.md](docs/product/MVP_SPEC.md) 참조.
확정되지 않은 사항은 문서에서 `TODO`로 표시되어 있다.

## 기여

작업 전에 [AGENTS.md](AGENTS.md)를 읽는다.
