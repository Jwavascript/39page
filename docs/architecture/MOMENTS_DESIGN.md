# Music Moments — 도메인 · 저장 · 재생 · 백업 설계 (M9-1)

> 상태: **설계만 완료 (2026-11-07). 코드는 없다.**
> 이 문서의 타입·함수는 전부 **앞으로 만들 것**이며, 지금 저장소에 존재하지
> 않는다.
>
> 기능 명세: [`../product/MUSIC_MOMENTS.md`](../product/MUSIC_MOMENTS.md)
> 결정: **ADR 0019** (도메인·저장) · **ADR 0020** (시점 조회·이동)
> 파일 포맷: [`BACKUP_FORMAT.md`](BACKUP_FORMAT.md) §6

## 1. 도메인 모델

```ts
// src/shared/types/moments.ts (신규)

/** 영상의 한 순간에 대한 사용자의 기록. */
export interface Moment {
  /** 앱 내부 식별자. `videoId` 와 다르다. */
  id: string
  source: 'youtube'
  /** YouTube 영상 ID (11자). Moment 의 **유일한 외부 참조**다. */
  videoId: string
  /** 영상 시작점부터의 초. 0 이상 정수. */
  atSeconds: number
  /** 사용자 메모. 빈 문자열 허용. */
  note: string
  /** 저장 당시 보이던 제목. 표시 대체용이며 신뢰 순위는 2번이다. */
  title: string
  /** ISO 8601 UTC. */
  createdAt: string
  /** ISO 8601 UTC. 메모를 고치면 갱신한다. */
  updatedAt: string
}

export type MomentsData = Moment[]
```

`Track` 과 모양이 닮았지만 **참조하지 않는다.** `source` 를 같이 두는 것은
앞으로 다른 출처가 생겼을 때의 자리를 트랙과 같은 방식으로 비워 두는 것이다.

> 필드 이름 `atSeconds` 는 M8-4 의 `backup-compat.spec.ts` 가 `data.moments`
> 공존 테스트에서 이미 쓴 이름이다. 그 테스트는 섹션을 **모르는 채** 경고만
> 확인하므로 필드 이름이 규범은 아니었지만, 이미 적힌 이름을 따른다.
> `seconds` 보다 "무엇의 초인가" 가 분명하기도 하다.

왜 `track.id` 가 없는가, 왜 `title` 을 저장하는가 → **ADR 0019** 결정 1·2.

### 1-1. 표시 제목의 우선순위

```
라이브러리에 같은 videoId 의 트랙이 있다  → 그 트랙의 현재 title
없다                                      → Moment.title (스냅샷)
스냅샷도 비어 있다                        → `YouTube · <videoId>`
```

마지막 줄은 `normalizeTitle` 의 대체 표기와 같은 규칙이다 (`addTrack` ·
`renameTrack` 이 쓰는 것). 새 규칙을 만들지 않는다.

이 조회는 **표시 시점의 파생값**이고 저장하지 않는다. 저장하면 라이브러리를
고칠 때마다 Moments 키를 다시 써야 한다 — 두 키가 서로를 쓰게 된다.

## 2. 검증과 정규화

`normalizeLibraryData` 와 **같은 모양**의 순수 함수를 만든다. 던지지 않고,
버린 것을 세어 보고한다.

```ts
// src/stores/moments.ts (신규)
export function normalizeMomentsData(value: unknown): {
  data: MomentsData
  report: { droppedMoments: number }
} | null
```

| 입력                                       | 처리              |
| ------------------------------------------ | ----------------- |
| 배열이 아님                                | 복구 불가. `null` |
| `id` 가 빈 문자열이 아닌 문자열이 아님     | 그 항목만 버린다  |
| `source !== 'youtube'`                     | 그 항목만 버린다  |
| `videoId` 가 11자 패턴이 아님              | 그 항목만 버린다  |
| `atSeconds` 가 유한한 0 이상 정수가 아님   | 그 항목만 버린다  |
| `note` · `title` 이 문자열이 아님          | 그 항목만 버린다  |
| `createdAt` · `updatedAt` 이 문자열이 아님 | 그 항목만 버린다  |
| 중복 `id`                                  | 처음 것만 남긴다  |

**`atSeconds` 를 반올림해 살리지 않는다.** 소수나 문자열이 들어왔다는 것은
우리가 쓴 값이 아니라는 뜻이고, 고쳐서 받으면 어디서 왔는지 모르는 값을
사용자 데이터로 승격시키는 셈이다. M8 의 트랙 검증과 같은 태도다.

`videoId` 패턴은 **기존 것을 그대로 쓴다** — 트랙 검증이 쓰는 11자 규칙.
두 벌을 만들면 갈라진다.

### 2-1. 순수 함수로 만드는 것

```ts
createMoment(input: {
  videoId: string
  atSeconds: number
  note: string
  title: string
  now: Date
  id: string
}): Moment
```

`now` 와 `id` 를 **밖에서 받는다.** `createBackup` 이 `exportedAt: Date` 를
받는 것과 같은 이유다 — 시계와 난수를 건드리지 않으면 테스트가 고정값으로
전부 확인할 수 있고, M10 확장이 같은 함수를 쓸 수 있다 (ADR 0020 §6).

## 3. 영속 저장

```
키: 39page.moments
{ "version": 1, "data": [ ... ] }
```

- `defineStorage` 를 그대로 쓴다. 새 저장 계층을 만들지 않는다
- `MOMENTS_STORAGE_VERSION = 1`
- `fallback: () => []` — 키가 없으면 빈 목록이다. **없음은 오류가 아니다**
- `validate: normalizeMomentsData` 의 `data` 부분
- `STORAGE_KEYS.moments` 를 **더한다.** 기존 `library` · `theme` 의 이름과
  봉투와 쓰기 경로는 **바꾸지 않는다**

### 3-1. 보호 (ADR 0007)

읽지 못한 `39page.moments` 원본은 덮어쓰지 않는다. 라이브러리와 **같은**
정책이고, 같은 구현(`defineStorage` 의 보호 경로)을 쓴다.

보호 상태에서의 탈출구도 같다 — 가져오기만이 명시적으로 교체할 수 있다
(M8-3 의 `replaceAll` 에 대응하는 `replaceAllMoments`). 그 경로는 가져오기
외에서 부르지 않으며, M8 이 그랬듯 **호출처를 테스트로 고정한다.**

### 3-2. 마이그레이션

M9 에서는 없다. 새 키이므로 이전 버전이 존재하지 않는다.

다만 M8-4 가 고정한 제약이 그대로 적용된다. **내부 저장 스키마를 v2 로
올릴 때는 공통 순수 함수를 쓴다** — 저장 읽기 경로와 백업 가져오기 경로가
같은 함수를 통과해야 한다. 두 벌을 쓰면 한쪽만 고쳐져 조용히 갈라진다.
(`IMPLEMENTATION_PLAN.md` M8-4, `BACKUP_FORMAT.md` §3-2-1)

**기존 라이브러리 데이터는 건드리지 않는다.** M9 는 `39page.library` 의
스키마도 버전도 바꾸지 않는다.

## 4. 재생 연동

결정 근거는 **ADR 0020**. 여기서는 계층별로 무엇이 늘어나는지만 적는다.

```
Moments 위젯  ──▶ PlaybackCoordinator (PlaybackMoments)
                        │
                        ▼
                  PlayerAdapter (position · seek · load{startSeconds})
                        │
                        ▼
                  YouTube IFrame API
```

| 계층                  | 추가                                                        |
| --------------------- | ----------------------------------------------------------- |
| `PlayerAdapter`       | `position(): number \| null` · `seek(seconds): void`        |
| `PlayerLoadOptions`   | `startSeconds?: number`                                     |
| `FakePlayerAdapter`   | 위 셋을 **실제로** 구현 (두 구현이 갈라지지 않게)           |
| `PlaybackCoordinator` | `PlaybackMoments` 면 — `capturePosition()` · `playMoment()` |
| UI                    | 어댑터도 YouTube API 도 **모른다**. 코디네이터만 부른다     |

```ts
/** `capturePosition()` 이 찍어 주는 값. Moment 를 만들 재료다. */
export interface MomentCapture {
  videoId: string
  atSeconds: number
  /** 지금 화면에 보이는 제목. 그대로 Moment 의 스냅샷이 된다. */
  title: string
}

export interface PlaybackMoments {
  /** 재생할 영상이 없거나 플레이어가 아직 시점을 모르면 `null`. */
  capturePosition(): MomentCapture | null
  playMoment(target: { videoId: string; atSeconds: number }): PlayRequestResult
}
```

`atSeconds` 는 `position()` 이 준 실수를 **내림한 정수**다. 내림은
코디네이터가 한다 — 어댑터는 플레이어가 준 값을 그대로 전하고, 도메인
규칙(정수 초)은 도메인 쪽에서 적용한다.

### 4-1. 두 경로

| 상황                | 하는 일                                           | 이유                   |
| ------------------- | ------------------------------------------------- | ---------------------- |
| 지금 틀고 있는 영상 | `seek(atSeconds)` + `play()`                      | 재적재·재버퍼링이 없다 |
| 다른 영상           | `load(videoId, { autoplay: true, startSeconds })` | 보류·경쟁이 없다       |

### 4-2. Moment 재생의 큐

Moment 는 플레이리스트에 속하지 않는다. 큐를 이렇게 정한다.

| 그 `videoId` 가 있는 곳        | 큐                                          |
| ------------------------------ | ------------------------------------------- |
| **선택된 플레이리스트**에 있다 | 그 플레이리스트. 그 트랙부터                |
| 다른 플레이리스트에만 있다     | 그중 **처음** 발견한 플레이리스트           |
| 어디에도 없다                  | **그 한 곡만.** 이전·다음은 양끝에서 비활성 |

마지막 줄이 "트랙을 지워도 Moment 는 산다" 를 실제 동작으로 만드는 부분이다.

### 4-3. 바뀌지 않는 것

- `PlayerSurface` 와 iframe 은 **전혀 바뀌지 않는다.** `seek` 도
  `startSeconds` 도 이미 적재된 플레이어에 보내는 명령이지 재생성이 아니다
  (ADR 0002)
- 가시성 가드 (ADR 0011) · 실패 처리 (ADR 0012) · 거절 문구는 **그대로**
  쓴다. Moment 만의 경로를 만들지 않는다
- 재생 로직은 테마를 모르고, 테마 UI 는 플레이어를 부르지 않는다
  (`AGENTS.md` 규칙 4)

## 5. 백업 통합과 호환성

### 5-1. 파일에 들어가는 모양

```json
"data": {
  "library": { "version": 1, "data": { ... } },
  "moments": { "version": 1, "data": [ ... ] },
  "preferences": { "theme": { "version": 1, "data": "mono-vinyl" } }
}
```

- **선택 섹션**이므로 `schemaVersion` 은 **1 그대로다** (`BACKUP_FORMAT.md`
  §3-2). 올릴 이유가 없고, 올리면 M8 빌드가 파일 전체를 거부한다
- `BACKUP_SECTION_VERSIONS.moments = MOMENTS_STORAGE_VERSION` — 상수를 다시
  적지 않고 store 에서 가져온다 (M8-2 가 세운 방식)
- 내보내기는 **항상** 이 섹션을 넣는다. Moment 가 0개여도 `[]` 로 넣는다

0개여도 넣는 이유는 §5-2 다.

### 5-2. ⚠ "없음" 과 "비었음" 은 다르다 — M9 호환성의 핵심

| 파일의 `data.moments` | 가져오기                    | 미리보기 표시        |
| --------------------- | --------------------------- | -------------------- |
| **키가 없다**         | Moment 를 **건드리지 않음** | `유지 (파일에 없음)` |
| `[]`                  | **0개로 교체**              | `교체 3개 → 0개`     |
| 항목이 있다           | 그 목록으로 **교체**        | `교체 3개 → 7개`     |

구분하지 않고 "없으면 빈 배열" 로 다루면, **M9 이전에 만든 백업을 복원할
때마다 Moment 가 전부 사라진다.** M8 백업은 전부 이 모양이다.

그래서 내보내기가 0개일 때도 `[]` 를 넣는다. 그래야 "사용자가 정말로
0개였다" 와 "이 파일은 Moments 를 모르던 시절 것이다" 가 **파일에서
구별된다.**

### 5-3. 옛 빌드와의 호환 — 막는 것과 막지 못하는 것

39page 는 origin 하나에 자동 갱신되는 사이트다. "옛 빌드" 는 **열어 둔 채
갱신되지 않은 탭** 정도로 한정된다. 그래도 경로를 적어 둔다.

| 경로                                        | 결과                                                               |
| ------------------------------------------- | ------------------------------------------------------------------ |
| 옛 빌드가 M9 파일을 **읽는다**              | `unknown-section: moments` 경고. 라이브러리만 복원                 |
| 옛 빌드가 복원해 `39page.library` 를 덮는다 | **그 브라우저의 Moment 는 산다** — 키가 다르다 (ADR 0019 §3)       |
| 옛 빌드에서 **새로 내보낸다**               | ⚠ **그 파일에는 Moment 가 없다.** 코드로 막을 수 없다              |
| M9 빌드가 M8 파일을 읽는다                  | Moment 를 유지한다 (§5-2) + **"이 파일에는 Moments 가 없다"** 안내 |

세 번째 줄이 유일하게 남는 위험이고, **배포된 옛 번들을 고칠 수는 없다.**
다룰 수 있는 것은 M9 쪽이다 — M9 가 `data.moments` 없는 파일을 읽을 때,
"이 파일은 Moments 가 생기기 전에 만들어졌습니다. 복원해도 지금의 Moment
는 지워지지 않고 그대로 남습니다" 라고 **먼저** 말한다. 사용자가 그 파일을
자신의 완전한 백업으로 오인하지 않게 하는 것이 목적이다.

이것을 **M9 완료 조건에 넣는다** (`IMPLEMENTATION_PLAN.md` M9-5).

### 5-4. 미래 버전 섹션

`data.moments.version` 이 지금 지원 범위보다 크면 **건너뛰고 알린다.**
추측해서 변환하지 않는다 — M8-3 이 `library` · `theme` 에 쓰는 규칙과 같다.
이때 **기존 Moment 는 그대로 둔다** (§5-2 의 "없다" 와 같은 처리).

### 5-5. 참조 정합성을 조건으로 두지 않는다

가져온 Moment 가 가리키는 영상이 라이브러리에 없어도 **버리지 않는다.**
섹션 간 검증을 넣으면 두 섹션의 버전을 독립적으로 올릴 수 없게 되고,
"트랙을 지워도 Moment 는 산다" 가 가져오기에서만 깨진다.

## 6. M10 (Chrome 확장) 연계

M10 은 YouTube 페이지에서 제목·링크를 모으고, 현재 시점과 메모를 Moment 로
저장한다. 그때 **재사용할 수 있게** 지금 모양을 맞춰 둔다.

| 재사용 대상                   | 왜 가능한가                                                |
| ----------------------------- | ---------------------------------------------------------- |
| `Moment` 타입                 | 앱 내부 식별자를 참조하지 않는다. `videoId` 만 있으면 완결 |
| `createMoment(input)`         | `now` · `id` 까지 밖에서 받는 순수 함수                    |
| `normalizeMomentsData(value)` | 출처와 무관하게 같은 검증을 통과시킨다                     |
| `addMoments(list)` (M9-2)     | 묶음 추가 + 버린 것 보고. 확장이 넘길 때의 입구            |

**전달 방식은 M9 에서 정하지 않는다.** 백업 파일을 동기화 수단으로 쓰지
않는다는 것만 이미 정해져 있다 (`BACKUP_FORMAT.md` §6-3). 메시지 전달·
저장소 공유·권한은 M10 설계 대상이다 (`BACKLOG.md` §3).

## 7. 이 설계가 지키는 기존 보장

| 보장                                      | 어떻게 지키는가                                        |
| ----------------------------------------- | ------------------------------------------------------ |
| iframe 을 재생성하지 않는다 (ADR 0002)    | `seek`·`startSeconds` 는 적재된 플레이어에 보내는 명령 |
| 테마 전환이 재생을 끊지 않는다 (규칙 5)   | 플레이어 수명에 손대지 않는다                          |
| 재생 로직은 테마를 모른다 (규칙 4)        | 위젯이 코디네이터만 부른다                             |
| 가려진 채 재생하지 않는다 (III.I.9)       | `playMoment` 가 같은 가시성 가드를 통과한다            |
| 네이티브 컨트롤을 가리지 않는다 (III.I.6) | 저장 버튼은 영상의 **형제**다                          |
| 사용자 데이터를 자동 삭제하지 않는다      | 재생 불가 Moment 도 남긴다. 삭제는 확인을 거친다       |
| 기존 저장 키를 바꾸지 않는다              | `moments` 를 **더할** 뿐이다                           |
| 라이브러리 마이그레이션을 유발하지 않는다 | `39page.library` 의 스키마·버전을 건드리지 않는다      |

## 8. 미결 (M9-2 이후에서 정한다)

- **TODO**: 세로 화면에서 Moments 위젯의 자리 (M9-4, 실기기 확인 후)
- **TODO**: 같은 `videoId` · 같은 `atSeconds` 중복 저장을 합칠지 (M9-4)
- **TODO**: `position()` 읽기 주기 — 버튼 활성/비활성만이면 주기 읽기가
  필요 없다. 필요가 확인되기 전에 타이머를 만들지 않는다 (ADR 0020 TODO)
