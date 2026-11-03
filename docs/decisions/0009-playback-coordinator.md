# 0009. 라이브러리와 재생은 Playback Coordinator 가 잇고, 어댑터는 PlayerSurface 가 등록한다

- 상태: 채택
- 날짜: 2026-11-03
- 구현: M3-2
- 관련: `docs/decisions/0006-player-adapter-ownership.md`,
  `docs/decisions/0008-player-adapter-event-contract.md`,
  `docs/architecture/SYSTEM_DESIGN.md` §4.6, §6.1

## 배경

M3-0.2 에서 "라이브러리 → 큐 연결은 `src/features/playback` 의 모듈이 하고
애플리케이션 계층이 주입한다"까지 정했다. M3-2 에서 실제로 만들려니 두 가지가
남아 있었다.

**1. 코디네이터가 어댑터에 어떻게 명령하는가.**

ADR 0006 의 "결과"는 이렇게 적어두었다.

> `PlayerSurface`가 store를 watch해 어댑터를 호출하는 방향(데이터 → DOM
> 단방향)을 유지한다.

문제를 실제로 마주하니 이 스케치가 버티지 못한다. **재생은 상태가 아니라
명령이다.**

| 명령                   | store 상태로 표현하면                                                                |
| ---------------------- | ------------------------------------------------------------------------------------ |
| 같은 트랙을 다시 재생  | `currentTrack` 이 그대로라 watcher 가 깨지 않는다. 깨우려면 **nonce 를 넣어야** 한다 |
| 즉시 재생인지 대기인지 | `{ autoplay }` 를 store 에 넣어야 한다. 큐 상태가 아닌 것이 큐 state 에 섞인다       |
| 큐 끝에서 **멈춤**     | 아무 상태도 바뀌지 않는다. watcher 가 구분할 수 없다                                 |

nonce 를 넣는 순간 store 는 "무엇이 큐에 있는가"가 아니라 "방금 무슨 버튼을
눌렀는가"를 들고 있게 된다. 되돌리기 어려운 종류의 설계 부채다.

**2. Record Library 가 재생을 어떻게 요청하는가.**

드로어는 `features/library` 에, 재생은 `features/playback` 에 있다.
`AGENTS.md` 규칙 2 는 기능 간 직접 import 를 막는다.

## 결정

### 1. Playback Coordinator — 평범한 팩토리 + 주입

`src/app/App.vue` 가 하나 만들어 `provide` 한다. Pinia store 가 아니다.

```ts
createPlaybackCoordinator(): PlaybackCoordinator
PLAYBACK_COORDINATOR: InjectionKey<PlaybackCoordinator>
```

`library` 를 **읽고** `playback` 에 **쓴다.** 두 store 는 여전히 서로를
모른다. 큐 스냅샷을 뜨는 곳이 여기 하나뿐이라 "큐는 재생 시작 시점의 복사본"
이라는 보장이 흩어지지 않는다.

store 로 만들지 않은 이유: 자기 상태가 없다. 가진 것은 어댑터 참조와 플래그
둘뿐이고, 둘 다 **반응형이면 안 되는** 것들이다 (ADR 0006).

### 2. 어댑터는 `PlayerSurface` 가 **등록**한다

```ts
// PlayerSurface.vue
attachment = coordinator?.attachAdapter(adapter) ?? null
adapter.mount(container, attachment?.events)
// 언마운트
attachment?.detach()
adapter?.destroy()
```

**만들고 없애는 책임은 `PlayerSurface` 에 그대로 있다** (ADR 0006).
코디네이터는 빌려 쓰고 `detach()` 로 돌려준다. `detach()` 는 어댑터를
없애지 않는다.

코디네이터가 든 어댑터 참조는 **평범한 지역 변수**다. Pinia state 에도
`ref` 에도 넣지 않는다 — 넣는 순간 외부 플레이어와 iframe 이 반응형 그래프에
끌려들어간다.

사건은 코디네이터가 만든 핸들러 묶음(ADR 0008)을 `mount()` 에 그대로 넘겨
받는다. 방향은 여전히 단방향이다.

```
사용자 → 드로어 → Coordinator → Adapter        (명령)
                      ▲            │
            playback store ◀───────┘            (사건)
```

### 3. 드로어는 **계약 파일만** 가져온다

`playbackCoordinator.ts` 는 타입과 주입 키만 담고 store 를 import 하지 않는다.
구현은 `createPlaybackCoordinator.ts` 에 따로 있다.
`features/library/drawerController.ts` 와 같은 구조다.

드로어는 플레이리스트·트랙 **id 만** 넘긴다. 큐를 만들지도, `playback` store 를
보지도, `PlayerAdapter` 를 알지도 않는다.

### 4. 자동 전환 규칙

`ENDED` 에서 다음 곡으로 넘기는 조건은 둘 다 참일 때다.

| 조건                                   | 왜                                                                                                                                      |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| 그 트랙이 **한 번이라도 재생됐다**     | 곡을 빠르게 연달아 고르면 직전 트랙의 `ENDED` 가 새 트랙을 적재한 뒤에 도착할 수 있다. 그 신호를 믿으면 **사용자가 고른 곡을 건너뛴다** |
| **사용자 조작을 기다리는 중이 아니다** | 오류·자동재생 차단 뒤에는 멈춰 있어야 한다 (M3-0.7)                                                                                     |

큐 끝에서는 멈춘다. 처음으로 돌아가지 않는다 (M3-0.1).

## 대안

| 대안                                                | 탈락 이유                                                                                                                    |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `PlayerSurface` 가 store 를 watch (ADR 0006 스케치) | 명령을 상태로 흉내 내야 한다. 같은 곡 다시 재생에 nonce 가 필요하고, 자동재생 의도가 큐 state 에 섞인다                      |
| 코디네이터를 Pinia store 로                         | 자기 상태가 없다. 어댑터 참조가 반응형 프록시에 들어가 ADR 0006 이 막은 것을 정확히 하게 된다                                |
| 드로어가 두 store 를 직접 조립                      | 기능 간 결합이 생기고, M3-3 의 트랜스포트 버튼이 같은 조립을 또 해야 한다                                                    |
| 드로어가 emit → `DashboardShell` 이 처리            | M3-3 의 트랜스포트는 `WidgetHost` 아래에 있다. emit 을 꿰려면 `WidgetHost` 가 위젯 종류를 알아야 하는데 ADR 0003 이 금지한다 |
| 코디네이터가 어댑터를 직접 만든다                   | 어댑터 수명이 DOM 수명과 어긋난다. `PlayerSurface` 가 사라져도 iframe 을 든 어댑터가 남는다                                  |
| 이벤트별로 핸들러를 `PlayerSurface` 가 다시 감싼다  | 중계가 한 겹 늘 뿐이고, 어떤 사건을 어디까지 처리하는지가 두 파일에 흩어진다                                                 |

## 결과

- `library` 와 `playback` store 는 서로를 모른 채로 남는다. 기존 정적 검사
  (`library-playback-isolation.spec.ts`)가 그대로 통과한다.
- `PlayerSurface` 는 코디네이터가 **없어도** 동작한다. 단독 마운트 테스트를
  위한 기본값이고, 그때는 어댑터를 붙이기만 한다.
- ADR 0006 의 "store 를 watch 한다"는 **명령 방향에 한해 이 결정으로
  대체된다.** 소유권(비반응형 지역 변수, 팩토리 주입)은 그대로다.
- 코디네이터가 플래그 둘(`hasStartedPlaying`, `awaitingUserAction`)을 들고
  있다. 둘 다 화면에 보이지 않으므로 반응형일 필요가 없고, 테스트는 사건을
  흘려보내 간접적으로 확인한다.
- `playback.back()` 은 M3-2 에 호출부가 없다. 트랜스포트 버튼이 M3-3 이다.
  계획서가 `advance`/`back` 을 한 쌍으로 요구했고 둘 다 테스트가 있다.

TODO(M3-5): 재생 중인 트랙이 라이브러리에서 삭제됐을 때의 정책. 큐는
스냅샷이라 재생은 계속되는데, 그것을 사용자에게 어떻게 알릴지는 정하지 않았다.
