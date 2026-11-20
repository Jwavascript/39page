# 재생 큐 UX — 목록 바꾸기 · 큐가 목록을 따름 · 셔플 · 반복 · YouTube에서 검색 (ADR 0038 · 0039)

- 날짜: 2026-11-20 · 브랜치 `feat/playback-queue-ux` (`main` 에서 분기, 별도 작업 폴더) · 운영 배포 · push 없음
- 결정 기록: [ADR 0038](../decisions/0038-queue-follows-source-and-play-modes.md) ·
  [ADR 0039](../decisions/0039-youtube-search-without-api.md)

## 1. 요청과 사용자 결정

| #   | 불편 (운영 사용)                                                    | 사용자 결정                              |
| --- | ------------------------------------------------------------------- | ---------------------------------------- |
| 1   | 재생 중 "목록 바꾸기" 를 하면 "지금 ○○ 을(를) 재생 중이에요 …" 안내 | 고르는 순간 그 목록을 처음부터 재생      |
| 2   | 재생 중인 목록에 곡을 추가하면 "목록이 변경됐어요 …" 안내           | 추가 · 순서 변경 · 삭제를 모두 바로 반영 |
| 3   | 목록 순서대로만 재생된다                                            | 셔플과 반복을 함께                       |

후속 지시(같은 날): 셔플 · 반복 단추를 두 줄로 나누지 말고 ⏮ ▶ ⏭ 와 **한 줄**에, 새로고침 뒤에는 **기억하지 않아도 된다**, 그다음
**"YouTube에서 검색" 버튼(API 키 없음)** 을 더한다. 가사 위젯은 저작권 문제로 **보류**다.

## 2. 바뀐 동작

- **목록 바꾸기**: 재생 큐가 있을 때 다른 목록을 고르면 바로 그 목록을 처음부터 재생한다(셔플이면 무작위 곡부터). 재생 중인 목록을
  다시 고르면 큐를 보일 뿐 다시 틀지 않는다. 빈 목록 · 영상이 가려진 경우는 재생하지 못하므로 그 목록을 "재생 대기" 로 보이고 부제에
  "지금 재생: ○○" 을 적는다. 재생 큐가 없을 때는 예전처럼 보기만 바뀐다. "재생 중인 큐 보기" 안내 상자는 없앴다.
- **큐가 목록을 따름**: 출처 목록의 곡 추가 · 순서 변경 · 이름 변경 · 삭제가 안내 없이 바로 큐에 반영된다. 지금 곡과 재생 위치는 끊기지
  않는다(플레이어에 명령이 가지 않는다). 확장 저장 · 다른 탭의 변경도 같다.
- **지금 곡 삭제**: 예전에는 멈추고 "재생 중이던 곡이 목록에서 삭제돼 재생을 멈췄습니다." 였다. 이제 지운 곡의 **다음 곡**으로 간다 —
  소리가 나던 중이면 재생, 일시정지 중이면 올려 두기만 한다. 마지막 곡이었으면 반복이 켜진 경우 처음 곡, 꺼진 경우 앞 곡에 서서 멈춘다.
  하나뿐인 곡이면 멈추고 큐를 비운다. 목록 자체를 지우면 큐는 끝까지 재생된다(기존 안내 유지).
- **셔플 · 반복**: Now Playing 카드에 `🔀 ⏮ ▶ ⏭ 🔁` 한 줄. 반복은 끔 → 전체 → 한 곡 → 끔. 셔플을 켜면 지금 곡이 맨 앞이고
  나머지가 섞이며, 끄면 목록 순서로 돌아간다(소리는 끊기지 않는다). NOW PLAYLIST 부제에 "· 셔플 · 전체 반복" 을 적는다.
  **저장하지 않는다** — 새로고침하면 둘 다 꺼진다(사용자 확인).
- **한 줄 배치**: 단추 사이를 4px 로 좁혀 다섯 단추가 243px 다. 넓은 카드에서는 그림 옆(제목 아래), 카드가 400px 이하(폰)면 조작 줄을
  그림 아래 전체 폭으로 내려 한 줄을 지킨다. "YOUTUBE에서 열기 ↗" 는 그 아래 줄이다. 보관함이 열린 넓은 띠에서도 다섯 단추가 한 줄이고,
  좁은 한 줄 카드(쌓기 · 옆)는 지금처럼 재생 단추 셋만 보인다.
- **YouTube에서 검색**: 보관함의 "＋ YouTube 링크 추가" 양식 아래에 "링크가 없으면 — YouTube에서 찾기" 칸과 "YouTube에서 검색 ↗"
  단추. YouTube 검색 결과를 새 탭으로 연다 — API 키 · 서버 없음, 39page 는 검색어를 보내거나 저장하지 않는다. 찾은 영상은 확장
  프로그램으로 담거나 주소를 붙여 넣는다. 링크 칸에 곡 이름을 적으면 오류 대신 검색 칸으로 옮겨 준다. NOW PLAYLIST 의 빈 목록
  "＋ YouTube 링크 추가" 도 같은 양식으로 간다.

## 3. 변경 파일

| 파일                                                                                   | 내용                                                                                                                                                                                                                                                        |
| -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/shared/types/player.ts` · `index.ts`                                              | `RepeatMode` · `REPEAT_MODES`                                                                                                                                                                                                                               |
| `src/shared/utils/shuffle.ts` (새)                                                     | Fisher–Yates · 무작위 자리 끼우기 (난수 주입)                                                                                                                                                                                                               |
| `src/stores/playback.ts`                                                               | `queueListOrder` · `shuffle` · `repeat` · `wraps`, 끝 ↔ 처음 잇기, `setQueue` 출처를 마지막에                                                                                                                                                               |
| `src/features/playback/playbackCoordinator.ts`                                         | 계약: `PlaybackModes` · `REPEAT_LABEL` 추가, `trackRemoved` · `resyncQueueFromSource` · `canResync` · `'changed'` 제거                                                                                                                                      |
| `src/features/playback/createPlaybackCoordinator.ts`                                   | 출처 목록 동기 관찰 · `followSource` · 재생 순서 · 셔플 · 한 곡 반복                                                                                                                                                                                        |
| `src/features/playback/useTransport.ts` · `PlayerTransport.vue` · `NowPlayingCard.vue` | 셔플 · 반복 단추와 상태 · 접근성 이름                                                                                                                                                                                                                       |
| `src/features/library/useNowPlaylist.ts` · `NowPlaylistWidget.vue`                     | 목록 바꾸기 즉시 재생, 안내 상자 제거, 부제의 모드 · 지금 재생                                                                                                                                                                                              |
| `src/features/library/PlaylistEditor.vue`                                              | 삭제 뒤 `trackRemoved` 호출 제거 (관찰이 대신한다) · 검색 칸 연결 · 곡 이름 → 검색어 · 링크 양식 `novalidate`                                                                                                                                               |
| `src/features/library/YouTubeSearch.vue` (새) · `src/shared/utils/youtube.ts`          | "YouTube에서 찾기" 양식 · `youtubeSearchUrl`                                                                                                                                                                                                                |
| 테스트 15개 (`tests/unit/*` 14 · `tests/integration/mvp-flows.spec.ts`)                | 바뀐 동작에 맞춰 고침 · `shuffle.spec.ts` 새로 · `library-track-ui` · `youtube-url` 에 검색 테스트. 없앤 기능("재생 중인 큐 보기" · "새 순서로 이어 재생" · `trackRemoved`)의 테스트는 새 동작 테스트로 바꿨다. skip 처리한 테스트는 없다 (2,127 → 2,170개) |
| 문서                                                                                   | ADR 0038 · 0039 (새), ADR 0030 · ADR 색인 · `SYSTEM_DESIGN.md` · `BACKUP_FORMAT.md` · `MVP_SPEC.md` · `BACKLOG.md` 주석                                                                                                                                     |
| `docs/development/playback-ux-results/`                                                | 실제 Chrome 확인 스크립트 2개(`queue.mjs` · `search.mjs`) · 결과 JSON · 스크린샷                                                                                                                                                                            |

추가한 의존성: **없음.**

## 4. 검증 (실제로 실행한 명령과 결과)

| 명령                                                                       | 결과                                                          |
| -------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `npm run type-check`                                                       | 통과                                                          |
| `npx vitest run` (PowerShell)                                              | **68 파일 · 2,170 테스트 통과**                               |
| `npm run lint` · `npm run format`                                          | 통과 (오류 · 경고 출력 없음)                                  |
| `npm run build`                                                            | 통과 — main JS 297.94 KB (gzip 96.07 KB)                      |
| `node docs/development/playback-ux-results/check/queue.mjs` (실제 Chrome)  | **15/15 통과** — `playback-ux-results/real-chrome-queue.json` |
| `node docs/development/playback-ux-results/check/search.mjs` (실제 Chrome) | **5/5 통과** — `playback-ux-results/real-chrome-search.json`  |

실제 Chrome 확인은 설치된 Chrome · 격리된 임시 프로필 · 로컬 빌드(`127.0.0.1:4173`) · 실제 YouTube IFrame 플레이어로 했다. 다른 탭에서
저장소를 고쳐(확장 저장 · 다른 탭 편집과 같은 길) 곡 추가 · 순서 변경 · 삭제를 일으켰고, 플레이어 상태는 YouTube 공식 API
(`YT.get(...)`)로 읽었다. 확인한 것: 추가 · 순서 변경 중 같은 영상의 재생 시간이 계속 늘어남(다시 적재 없음), 안내 상자 없음, 지금 곡
삭제 시 다음 곡 재생 / 마지막 자리면 앞 곡에서 멈춤, 목록 바꾸기 즉시 재생, 빈 목록 대기 보기, **실제 `ended` 사건**으로 전체 반복
(마지막 → 처음) · 한 곡 반복(같은 곡 0초부터), 테마 전환 뒤 재생 · 모드 유지, 1440 · 1024 · 768 · 390 · 360 · 320px 에서
`🔀 ⏮ ▶ ⏭ 🔁` 가 **한 줄**(단추 중심 높이 차 2px 미만) · 카드 안 · 겹침 없음 · 44px · 가로 넘침 없음, 보관함을 연 넓은 띠(1440)에서도
다섯 단추 한 줄 · 좁은 한 줄 카드(390)는 셋, 새 저장 키 없음.

검색 확인(`search.mjs`): 검색 칸에 "아이유 밤편지" 입력 → Enter · 단추 모두 새 탭에 `youtube.com/results?search_query=아이유 밤편지`,
새 탭의 `window.opener === null`, 링크 추가는 제출되지 않음(곡 수 그대로 · 오류 없음), 링크 칸의 "밤편지" → 검색 칸으로 옮김,
1440 · 390 · 320px 배치, 검색어가 저장소에 없음. **처음 실행에서 링크 칸 → 검색어 옮기기가 실패**했다 — `type="url"` 의 브라우저 기본
검사가 제출을 막아 39page 안내가 나오지 않았다(jsdom 테스트는 통과). 링크 양식에 `novalidate` 를 더해 고쳤고 다시 실행해 통과했다.

스크린샷: `card-1440.png` · `card-390.png` · `card-320.png` 등(모드 꺼짐), `card-shuffle-repeat-all-1440.png`, `card-repeat-one-1440.png`,
`card-repeat-one-mono-1440.png`, `card-archive-1440.png` · `card-archive-390.png`, `search-1440.png` · `search-390.png` · `search-320.png`.

## 5. 남은 일 (TODO)

- **TODO(사용자 확인)**: 셔플 · 반복 단추 모양과 한 줄 배치(단추 사이 8px → 4px), 검색 칸 모양은 승인된 디자인 참고자료에 없는 새
  화면이다. 스크린샷을 보고 확정이 필요하다. `design/references/` 는 건드리지 않았다.
- 셔플 · 반복 기억: 사용자 확인으로 **하지 않는다** (TODO 아님).
- **TODO(다음 작업)**: 확장의 합본 영상 챕터 단위 담기. 가사 위젯은 보류.
- 확장 프로그램이 없는 사용자는 검색 뒤 주소를 복사해 붙여 넣어야 한다 — 39page 안에서 결과를 고르는 기능은 API 키가 필요해 하지 않았다.
- 실제 기기(폰) 확인은 하지 않았다 — 위 폭 확인은 데스크톱 Chrome 의 화면 크기 흉내다.
- 이 작업은 로컬 브랜치에만 있다. 커밋 · push · 배포는 하지 않았다.
