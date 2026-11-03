# 0008. 플레이어 어댑터 이벤트는 mount 시 넘기는 핸들러 묶음으로 전달한다

- 상태: 채택
- 날짜: 2026-11-03
- 구현: M3-1
- 관련: `docs/decisions/0006-player-adapter-ownership.md`,
  `docs/architecture/SYSTEM_DESIGN.md` §4.6, §8.1

## 배경

M1-5 의 `PlayerAdapter` 에는 **이벤트 구독 수단이 없다.** 당시에는 쓰지 않는
이벤트 시스템을 두지 않기로 했다 (`AGENTS.md` 규칙 9).

M3-1 에서 실제 IFrame API 를 붙이면 더 미룰 수 없다. YouTube 가 알려주는
사실 중 **밖에서 알아낼 방법이 없는 것**이 넷 있다.

| 사실                       | 왜 폴링으로 대체할 수 없는가                                          |
| -------------------------- | --------------------------------------------------------------------- |
| `onReady`                  | 준비 전에는 어떤 메서드도 부를 수 없다. 보류한 요청을 풀 시점이다     |
| `onStateChange` 의 `ENDED` | 곡이 끝난 **순간**을 놓치면 연속 재생이 끊긴다 (M3-2)                 |
| `onError`                  | 영상별 임베드 거부는 재생을 시도해야 알 수 있다                       |
| `onAutoplayBlocked`        | 브라우저가 막았다는 것은 플레이어만 안다. 상태값으로는 구분이 안 된다 |

`state()` 를 주기적으로 읽어 대신하는 방법은 쓸 수 없다. `ENDED` 는 즉시
다음 곡으로 넘어가므로 폴링 간격 안에서 사라지고, 자동재생 차단은 상태값에
흔적을 남기지 않는다.

같이 결정해야 하는 것이 둘 더 있다. §4.6 이 "M3 결정"으로 남겨둔
`load(videoId, { autoplay })` 와, `mount()` 가 `YT.Player` 를 **언제**
만드는지다. 셋 다 같은 계약을 고치는 일이라 한 기록에 묶는다.

## 결정

### 1. 이벤트는 `mount()` 의 두 번째 인자로 받는다

```ts
export interface PlayerAdapterEvents {
  ready?(): void
  stateChange?(state: PlayerState): void
  error?(info: PlayerErrorInfo): void
  autoplayBlocked?(): void
}

mount(container: HTMLElement, events?: PlayerAdapterEvents): void
```

구독/해지 API(`on()` / `off()`)를 두지 않는다. **핸들러의 수명이 마운트
수명과 정확히 같기 때문이다.** `destroy()` 가 핸들러를 버리므로 해지할 것이
없고, 구독자 목록·해지 함수·중복 구독 방어가 전부 필요 없어진다.

인자는 **선택**이다. 이벤트를 쓰지 않는 호출부(M1-5 의 테스트)는 그대로 둔다.

오류는 YouTube 숫자 코드를 도메인 종류로 바꿔서 넘긴다. 번호도 함께 넘기는데,
승인된 디자인이 사용자에게 번호를 보여주기 때문이다 (`오류 101`).

```ts
export type PlayerErrorKind =
  | 'api-unavailable' // 스크립트를 못 불러왔다 (YouTube 코드가 아니다)
  | 'invalid-parameter' // 2
  | 'not-playable' // 5
  | 'not-found' // 100
  | 'embed-not-allowed' // 101 · 150
  | 'referrer-missing' // 153
  | 'unknown'

export interface PlayerErrorInfo {
  kind: PlayerErrorKind
  /** YouTube 원본 코드. 스크립트 로드 실패에는 코드가 없어 `null` 이다. */
  code: number | null
}
```

종류 변환을 **어댑터 안에서** 한다. 밖에서 `code === 101 || code === 150` 을
쓰면 YouTube 특이사항이 UI 코드로 새어 나간다.

오류가 나면 `stateChange('error')` 를 먼저, `error(info)` 를 다음에 보낸다.
상태만 보는 구독자와 이유까지 보는 구독자가 **같은 순서**를 보게 된다.

### 2. `load()` 가 자동재생 의도를 받는다

```ts
export interface PlayerLoadOptions {
  /** `true` → `loadVideoById` (즉시 재생), 생략/`false` → `cueVideoById` (대기) */
  autoplay?: boolean
}

load(videoId: string, options?: PlayerLoadOptions): void
```

`MVP_SPEC.md` F3 가 두 메서드를 **둘 다** 쓴다고 정해 두었다. 어느 쪽인지는
어댑터가 알 수 없다. 사용자가 트랙을 눌렀으면 즉시 재생이고, 복원된 포인터나
큐 이동 준비는 대기다. **그 구분은 호출부만 안다.**

### 3. `mount()` 는 호스트만 만들고, `YT.Player` 는 첫 `load()` 에서 만든다

`mount()` 가 하는 일: 자식 호스트 노드 생성, API 스크립트 로드 시작.
`YT.Player` 생성은 **재생할 영상이 생긴 뒤**다.

승인된 프로토타입이 그렇게 동작한다 (`ensurePlayer()` 는 `current` 가 있을 때만
플레이어를 만들고, 그전에는 placeholder 를 보여준다). 마운트 시점에 만들면
**사용자가 음악을 한 번도 틀지 않아도 매 페이지 로드마다 youtube.com iframe 이
붙는다.** 승인된 동작을 M3-1 이 임의로 바꾸지 않는다.

iframe 영속성(ADR 0002)에는 영향이 없다. 늦게 생겨도 생기는 자리는 언제나
어댑터가 소유한 같은 자식 노드 안이고, 그 노드의 부모는 바뀌지 않는다.

## 대안

| 대안                                        | 탈락 이유                                                                                                                                     |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `on(event, handler): () => void`            | 구독자가 하나뿐이고 그 수명이 마운트 수명과 같다. 해지 함수를 돌려주면 호출부가 그것을 보관·호출해야 하는데, 안 해도 티가 안 나는 누수가 된다 |
| 어댑터가 `EventTarget` 을 상속              | 이벤트 이름이 문자열이 되어 타입이 좁혀지지 않는다. DOM API 를 도메인 계약에 끌어들인다                                                       |
| 어댑터가 `playback` store 를 직접 수정      | ADR 0006 이 정한 단방향(데이터 → DOM)이 깨진다. 어댑터가 Pinia 를 알게 되고, 테스트에 store 가 필요해진다                                     |
| 팩토리·생성자에서 핸들러를 받는다           | 팩토리를 주입하는 `main.ts` 는 컴포넌트가 쓸 store 인스턴스를 모른다. 핸들러 수명이 마운트 수명과 어긋난다                                    |
| 숫자 코드를 그대로 넘긴다                   | `code === 101 \|\| code === 150` 같은 분기가 UI 로 퍼진다. 숫자 해석을 어댑터 안에 가두는 §4.6 의 원칙과 어긋난다                             |
| `load(videoId)` 만 두고 항상 `cueVideoById` | `loadVideoById` 를 쓰지 않게 되어 `MVP_SPEC.md` F3 와 어긋난다. cue 후 play 를 따로 부르면 준비 전 요청 보류 로직이 두 갈래로 늘어난다        |
| `mount()` 에서 `YT.Player` 를 만든다        | 음악을 틀지 않는 방문에도 youtube.com iframe 과 쿠키가 붙는다. 승인된 프로토타입의 동작을 바꾼다                                              |

## 결과

- `PlayerAdapter` 계약이 바뀌므로 **M1-5 의 수명주기 테스트를 함께 고친다**
  (`AGENTS.md` 규칙 7). 두 인자가 모두 선택이라 기존 호출은 그대로 통과한다.
- `FakePlayerAdapter` 도 같은 계약을 구현한다. 테스트가 이벤트를 흘려보낼 수
  있게 발생 함수를 더한다. 앱 코드는 여전히 Fake 를 주입하지 않는다.
- `PlayerSurface` 가 유일한 구독자다. M3-1 에서는 `stateChange` 만 store 에
  반영한다 (`playback.setPlayerState()`). `ready` · `error` ·
  `autoplayBlocked` 의 **화면 처리는 M3-3 · M3-5 다.** 어댑터가 넷 모두를
  전달하는 것은 M3-1 에서 테스트로 검증한다.
- `state()` 는 그대로 `PlayerState` 만 돌려준다. 숫자는 나가지 않는다.
- ADR 0006 의 "TODO: M3에서 store ↔ 어댑터 연결 방향을 이 결정에 맞게 구현하고
  검증" 이 이 결정으로 닫힌다.

TODO: 구독자가 둘 이상 필요해지면(예: 가시성 가드가 직접 상태를 보고 싶을 때)
이 결정을 다시 본다. 그때는 store 를 경유하는 쪽이 먼저다
