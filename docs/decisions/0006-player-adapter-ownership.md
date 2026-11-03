# 0006. 플레이어 어댑터는 PlayerSurface가 비반응형으로 보유하고 팩토리로 주입한다

- 상태: 채택
- 날짜: 2026-11-03
- 관련: `docs/decisions/0002-persistent-player-host.md`,
  `docs/architecture/SYSTEM_DESIGN.md` §4.6, §6

## 배경

`SYSTEM_DESIGN.md` §4.6은 "어댑터 인스턴스 보유 위치 확정 (store 내부 / 앱 레벨
provide)"을 TODO로 남겨두었다. M1-5에서 확정해야 했다.

제약이 세 가지 있다.

1. 어댑터는 외부 플레이어(M3의 `YT.Player`)와 그것이 소유한 DOM 노드를 들고
   있다. 이 노드는 부모가 바뀌기만 해도 재로드된다 (ADR 0002).
2. 테스트는 `FakePlayerAdapter`를 주입해야 한다. 실제 YouTube 네트워크에
   접속하지 않는다.
3. `PlayerSurface`는 `WidgetHost`가 레지스트리를 보고 렌더한다. 따라서
   `PlayerSurface`에 props를 넘기려면 `WidgetHost`와 `DashboardShell`까지
   팩토리를 꿰어야 한다.

## 결정

**어댑터는 `PlayerSurface`의 비반응형 지역 변수로 보유하고, 팩토리를
`provide`/`inject`로 주입한다.**

```ts
// PlayerSurface.vue
const createAdapter = inject(PLAYER_ADAPTER_FACTORY, null)
let adapter: PlayerAdapter | null = null // ref 가 아니다

onMounted(() => {
  if (createAdapter === null) return
  adapter = createAdapter()
  adapter.mount(mountHost.value)
})
onUnmounted(() => {
  adapter?.destroy()
  adapter = null
})
```

세 가지를 함께 정한다.

1. **Pinia state에 넣지 않는다.** Pinia는 state를 반응형 프록시로 감싼다.
   어댑터와 그 DOM 노드가 프록시로 감싸이면 의존성 추적 대상이 되고, 외부
   플레이어가 Vue의 반응형 그래프에 끌려들어간다. `playback` store는
   **데이터만** 갖는다.
2. **`ref`/`reactive`로도 감싸지 않는다.** 같은 이유다. 평범한 `let`이다.
   템플릿이 어댑터를 읽지 않으므로 반응형이 필요하지 않다.
3. **주입은 팩토리(`() => PlayerAdapter`)다.** 인스턴스를 직접 주입하면
   여러 `PlayerSurface`가 같은 어댑터를 공유하게 된다. MVP에는 하나뿐이지만
   공유는 의도가 아니다.

주입되지 않으면 어댑터를 만들지 않고 "연결되지 않음"으로 표시한다. M1-5의
기본 상태가 그것이다.

## 대안

| 대안                                  | 탈락 이유                                                                                                                                     |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `playback` store가 어댑터를 보유      | 어댑터와 DOM 노드가 Pinia의 반응형 프록시에 들어간다. store가 DOM 수명주기를 알게 되어 "store는 데이터, 컴포넌트는 DOM"이라는 경계가 무너진다 |
| props로 팩토리 전달                   | `WidgetHost`·`DashboardShell`을 수정해야 한다. 두 파일은 위젯 종류를 모르는 게 설계인데, 플레이어만을 위한 prop을 꿰면 그 성질이 깨진다       |
| 전역 mutable singleton                | 테스트 간 상태가 새고, 주입 지점이 보이지 않는다                                                                                              |
| DI 프레임워크 도입                    | 의존성이 하나뿐이다. 규칙 8에 비춰 필요성이 없다                                                                                              |
| 모듈 레벨 `let adapter` (모듈 싱글턴) | 테스트가 모듈 상태를 초기화해야 하고, 컴포넌트 수명주기와 어긋날 수 있다                                                                      |

## 결과

- `WidgetHost`·`DashboardShell`·`src/app/layout.ts`를 **수정하지 않고**
  `PlayerSurface`를 연결했다.
- 테스트는 `global.provide`로 Fake를 주입한다. 실제 네트워크를 쓰지 않는다.
- M3는 `main.ts`에서 한 줄로 실제 어댑터를 주입한다.
  ```ts
  app.provide(PLAYER_ADAPTER_FACTORY, () => new YouTubeIFramePlayerAdapter())
  ```
- 어댑터는 Vue devtools나 Pinia devtools에 보이지 않는다. 디버깅 시
  `PlayerSurface` 인스턴스를 직접 들여다봐야 한다. 의도한 비용이다.
- `playback` store는 어댑터를 호출하지 않는다. M3에서 재생 명령을 연결할 때
  store와 어댑터를 잇는 지점이 필요해지는데, `PlayerSurface`가 store를 watch해
  어댑터를 호출하는 방향(데이터 → DOM 단방향)을 유지한다. 역방향(어댑터가
  store를 직접 변경)은 두지 않고, 이벤트는 M3에서 콜백으로 받아
  `PlayerSurface`가 store에 반영한다.

TODO: M3에서 store ↔ 어댑터 연결 방향을 이 결정에 맞게 구현하고 검증
