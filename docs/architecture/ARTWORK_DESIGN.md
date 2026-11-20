# Custom Artwork · 자산 백업 · 파일 공유 — 기술 설계 (M12)

- 상태: **M12-1 설계** (2026-11-15). 구현 단계 M12-2 ~ M12-4 에서 이 문서를 기준으로 하고, 구현과 다르게 정한
  것은 이 문서를 고친다.
- 결정 기록: ADR 0032 (Now Playing 카드) · ADR 0033 (Artwork 저장) · ADR 0034 (ZIP 백업 · 공유 패키지)
- UX: [`../product/M12_CUSTOM_ARTWORK.md`](../product/M12_CUSTOM_ARTWORK.md)

## 1. 지금 시스템에서 확인한 사실 (분석 결과)

| 항목              | 사실 (파일)                                                                                                                                                                                                               | 설계에 주는 뜻                                                                                    |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Track id 유일성   | 같은 목록 안에서는 유일하다 (`normalizeLibraryData` 가 중복을 버린다). 앱이 만드는 id 는 UUID 라 사실상 전역 유일이지만, **가져온 백업 파일은 다른 목록끼리 같은 id 를 가질 수 있다** (목록 간 검사가 없다, `library.ts`) | Artwork 연결 키는 **(playlistId, trackId)** 다. trackId 하나로 두지 않는다                        |
| 같은 영상 여러 번 | 한 목록에 같은 `videoId` 를 여러 번 넣을 수 있고 그때도 `track.id` 가 다르다 (`addTrackNow`)                                                                                                                              | 같은 영상의 두 트랙에 다른 Artwork 를 줄 수 있다                                                  |
| 재생 큐           | 큐는 트랙 **스냅샷**이고 `queueSource.playlistId` 를 함께 적는다 (메모리). 목록 밖 영상의 Moment 재생은 `moment:<videoId>` 트랙 · 출처 `null` (`createPlaybackCoordinator.ts`)                                            | 지금 곡의 Artwork 는 (큐 출처 playlistId, 큐 트랙 id) 로 찾는다. 출처가 없으면 영상 썸네일 → 기본 |
| 트랙 순서 바꾸기  | `moveTrackTo` 는 트랙 객체를 옮길 뿐 id 를 바꾸지 않는다                                                                                                                                                                  | 연결은 id 기반이라 순서와 무관하다. 배열 인덱스를 쓰지 않는다                                     |
| 되돌리기          | 트랙 · 목록 삭제에 되돌리기가 없다                                                                                                                                                                                        | 삭제가 저장된 **뒤** 연결을 지우고, 아무도 쓰지 않는 자산을 지운다                                |
| 텍스트 저장소     | `localStorage` 의 `39page.library` · `39page.moments` · `39page.theme`, 탭 간 Web Locks + 수정 번호 (ADR 0024 · 0025)                                                                                                     | Artwork 는 **이 키들을 건드리지 않는다.** 마이그레이션이 없다                                     |
| JSON 백업         | `39page-backup` schemaVersion 1, 최대 8 MB, 미리보기 → 승인 → 섹션별 결과 (ADR 0018, `useBackupImport.ts`)                                                                                                                | ZIP 전체 백업은 이 파일을 **그대로 품는다** — 검증기 · 쓰기 경로를 다시 만들지 않는다             |
| CSP               | 웹앱 문서에 CSP 가 없다. `bridge.html` 만 `frame-ancestors` 헤더가 있다 (`vite.config.ts`)                                                                                                                                | `i.ytimg.com` 썸네일 · `blob:` 이미지가 바로 된다. CSP 를 도입하면 `img-src` 에 둘을 넣어야 한다  |
| 확장 저장 계약    | 확장은 브리지로 `library.addTrack` · `moments.add` 만 부른다 (ADR 0028)                                                                                                                                                   | Artwork 는 확장 계약에 들어가지 않는다. 확장으로 담은 곡은 자동(썸네일)이다                       |
| 기존 마스코트     | `features/mascot/*` 는 위젯 레지스트리 · 레이아웃 · 테마 메타데이터(`mascot` 문구) · 토큰(`--mascot-*`)에서만 쓰인다                                                                                                      | 마스코트 위젯을 빼고 플레이어 위젯 안 Now Playing 카드로, 코드 · 토큰 · 문구를 지운다 (M12-2)     |

## 2. Artwork 데이터 모델

### 2-1. 선호와 연결

```ts
/** 트랙의 Artwork 선호. 연결 레코드가 없으면 'auto' 로 본다 — 기존 트랙은 손대지 않는다. */
type ArtworkPreference =
  | { mode: 'auto' } //    YouTube 썸네일 → 실패하면 기본 Artwork
  | { mode: 'default' } // 사용자가 39page 기본 Artwork 를 골랐다 (썸네일을 쓰지 않는다)
  | { mode: 'custom'; assetId: string } // 사용자가 올린 이미지

/** IndexedDB `assignments` 의 레코드. 'auto' 는 저장하지 않는다 (레코드 없음 = auto). */
interface ArtworkAssignment {
  playlistId: string
  trackId: string
  /** 연결할 때의 영상 — 진단 · 공유 패키지 · 고아 정리에 쓴다. 표시 판단에는 쓰지 않는다. */
  videoId: string
  mode: 'default' | 'custom'
  assetId?: string // mode === 'custom' 일 때만
  /** 단조 증가 수정 번호 (탭 간 충돌 판정). */
  revision: number
  updatedAt: string // ISO 8601
}
```

- 키: `[playlistId, trackId]` (IndexedDB 복합 keyPath). 배열 인덱스 · videoId 를 키에 쓰지 않는다.
- `auto` 를 저장하지 않으므로 **기존 데이터를 일괄 수정할 필요가 없다.** 썸네일로 되돌리기는 레코드 삭제다.
- Moment 의 videoId 모델은 그대로다. Moment 에는 Artwork 가 없다 — Moment 를 보여줄 때 곡 그림이 필요하면
  같은 영상의 썸네일(또는 기본)을 쓴다. 목록 밖 Moment 를 트랙으로 만들지 않는다.

### 2-2. 자산 (실제 이미지)

```ts
interface ArtworkAsset {
  id: string // = SHA-256 16진수 64자. 같은 파일은 같은 id — 중복 저장을 구조로 막는다
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'
  byteSize: number
  width: number
  height: number
  animated: boolean // GIF 의 프레임이 둘 이상
  createdAt: string
}
interface ArtworkBlobRecord {
  id: string // 자산 id
  blob: Blob // 사용자가 올린 원본 바이트 그대로 (다시 인코딩하지 않는다)
  poster: Blob | null // 움직이는 GIF 의 첫 프레임 (PNG). 정지 이미지는 null
}
```

- 자산 id 를 **내용 해시**로 둔다: 같은 이미지를 여러 트랙에 써도 한 번만 저장되고, 백업 · 공유 패키지를 가져올 때
  같은 파일이 이미 있으면 다시 쓰지 않는다. 장래 클라우드 동기화 · 공개 링크에서도 같은 id 를 그대로 쓸 수 있다.
- 메타데이터와 바이트를 **다른 object store** 에 둔다 — 사용량 집계 · 목록이 큰 Blob 을 읽지 않는다.
- 참조 수는 `assignments` 의 `assetId` 색인으로 센다. 별도 참조 카운터를 두지 않는다 (어긋날 값이 없다).

### 2-3. 표시 우선순위 (`resolveArtwork`)

| 선호                          | 자산 상태         | 표시                                                                                     |
| ----------------------------- | ----------------- | ---------------------------------------------------------------------------------------- |
| custom                        | 있음              | 사용자 이미지 (GIF 는 움직임 · 정지 규칙 §5)                                             |
| custom                        | **사라짐** (손상) | 기본 Artwork + "연결된 이미지를 찾지 못함" (숨기지 않음)                                 |
| default                       | —                 | 테마의 기본 Artwork                                                                      |
| auto (레코드 없음)            | —                 | `https://i.ytimg.com/vi/<videoId>/hqdefault.jpg` → 실패 · 120×90 회색 대체 이미지면 기본 |
| 지금 곡이 목록 밖 (출처 없음) | —                 | auto 와 같다 (영상 썸네일 → 기본)                                                        |

- 썸네일은 **저장하지 않는다** (요청마다 브라우저 캐시). 오프라인 · 차단 · 삭제된 영상은 `error` 또는
  `naturalWidth === 120` (YouTube 의 "없음" 그림)로 판정해 기본 Artwork 로 바꾼다.
- `hqdefault` 는 480×360 에 위아래 검은 띠가 있다. 정사각형 상자에서 `object-fit: cover` + `scale(1.34)` 로 띠를
  잘라 16:9 내용의 가운데 정사각형(약 270px)을 쓴다. `maxresdefault` 는 없는 영상이 많아 쓰지 않는다.
- 기본 Artwork 는 테마별 컴포넌트를 **둘 다 마운트하고 CSS 로 고른다** (ADR 0001 과 같은 방식). 사용자 이미지는
  테마와 무관해 전환해도 그대로다.

## 3. 저장 계층 — IndexedDB

### 3-1. 스키마

데이터베이스 `39page-artwork`, 버전 1.

| object store  | keyPath                    | 색인                  | 값                                   |
| ------------- | -------------------------- | --------------------- | ------------------------------------ |
| `assets`      | `id`                       | —                     | `ArtworkAsset`                       |
| `blobs`       | `id`                       | —                     | `ArtworkBlobRecord`                  |
| `assignments` | `['playlistId','trackId']` | `assetId` (custom 만) | `ArtworkAssignment`                  |
| `meta`        | `key`                      | —                     | `{ key: 'revision', value: number }` |

- 버전을 올릴 때는 `onupgradeneeded` 에서 이전 버전을 이어 받는다. 알 수 없는 **더 새** 버전(다른 탭의 새 빌드)이면
  열기가 `VersionError` 로 실패한다 → "unavailable" 로 다룬다 (덮어쓰지 않는다).
- 다른 탭이 버전을 올리려 하면(`versionchange`) 연결을 닫고 "새로고침 필요" 로 둔다.

### 3-2. API (`src/features/artwork/artworkRepository.ts` · `src/stores/artwork.ts`)

| 개념 (지시서)             | 실제                                                                       | 원자성                                                                                                      |
| ------------------------- | -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `getArtworkForTrack`      | `artworkStore.preferenceFor(playlistId, trackId)` + `ArtworkImage` 의 해석 | 메모리의 연결 표(시작 · 다른 탭 알림 때 IndexedDB 에서 다시 읽음)                                           |
| `setCustomArtwork`        | `artworkStore.setCustom(key, file, expected)`                              | 검증 · 해시 · 포스터는 트랜잭션 **밖**에서, 자산 · 바이트 · 연결 · 옛 자산 정리는 **한 readwrite 트랜잭션** |
| `useYouTubeThumbnail`     | `artworkStore.useAuto(key, expected)`                                      | 연결 삭제 + 쓰지 않게 된 자산 삭제 — 한 트랜잭션                                                            |
| `useDefaultArtwork`       | `artworkStore.useDefault(key, expected)`                                   | 연결 쓰기 + 옛 자산 정리 — 한 트랜잭션                                                                      |
| `removeArtworkAssignment` | `artworkStore.forgetTracks(keys)`                                          | 트랙 · 목록 삭제가 **저장된 뒤** 부른다. 연결들 삭제 + 고아 자산 삭제 — 한 트랜잭션                         |
| `deleteUnusedAssets`      | `artworkStore.cleanUp()`                                                   | 연결이 없는 자산 · 라이브러리에 없는 트랙의 연결을 지운다 (라이브러리가 `ready` 일 때만)                    |
| `exportArtworkAssets`     | `repository.exportAll()`                                                   | 한 readonly 트랜잭션에서 연결 · 자산 · 바이트를 읽는다 (같은 시점의 사진)                                   |
| `importArtworkAssets`     | `repository.stageAssets()` + `repository.commitAssignments()`              | §7-3 단계 복원                                                                                              |

### 3-3. 실패 처리 — 성공으로 표시하지 않는다

| 상황                                   | 처리                                                                                                                 |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| IndexedDB 없음 · 열기 실패 · 비공개 창 | 상태 `unavailable`. 표시는 auto/default 로만 하고(지금 연결을 모르므로 "알 수 없음" 안내), 업로드 · 변경 단추는 끈다 |
| 용량 부족 (`QuotaExceededError`)       | 트랜잭션이 통째로 취소된다 → 이전 Artwork 그대로. "저장 공간이 부족합니다" + 사용량 · 정리 안내                      |
| 형식 · 내용 · 디코딩 실패              | 저장 전에 거른다 (§4). 아무것도 쓰지 않는다                                                                          |
| 자산은 저장됐는데 연결 실패            | 같은 트랜잭션이라 생기지 않는다 — 함께 취소된다                                                                      |
| 연결은 있는데 자산이 없음              | 표시: 기본 + 경고. 정리(`cleanUp`)가 그 연결을 auto 로 되돌릴지 사용자에게 묻는다 (자동으로 지우지 않는다)           |
| 트랙 삭제와 변경 경합                  | 저장 직전 라이브러리에 그 트랙이 있는지 본다 → 없으면 `track-missing` 으로 거절. 삭제 쪽은 저장 뒤 연결을 지운다     |
| 여러 탭 동시 변경                      | §3-4                                                                                                                 |

### 3-4. 탭 간 정책

- 모든 쓰기는 IndexedDB readwrite 트랜잭션 안에서 한다 — 같은 store 를 쓰는 트랜잭션은 탭을 넘어 **직렬화**된다.
- **낙관적 충돌 검사**: 설정 화면은 열 때 그 트랙 연결의 `revision`(없으면 0)을 기억하고, 저장 트랜잭션 안에서 지금 값과
  비교한다. 다르면 `conflict` 로 거절하고 아무것도 쓰지 않는다 → "다른 탭에서 이 곡의 앨범아트가 바뀌었습니다. 지금 것을
  보고 다시 고르세요." (자동 병합 · 마지막 쓰기 승리를 하지 않는다 — 사용자가 고른 이미지를 몰래 덮지 않는다.)
- 쓰기가 끝나면 `BroadcastChannel('39page-artwork')` 로 알린다. 다른 탭은 연결 표를 다시 읽는다 — 지금 곡의 그림이 바로 바뀐다.
  `BroadcastChannel` 이 없으면 창이 다시 보일 때(`visibilitychange`) 다시 읽는다.

### 3-5. 용량

- 올리기 한도 (초기 권장값 — M12-3 측정 뒤 확정): 정지 이미지 **5 MB**, GIF **12 MB**, 가로 · 세로 각 **4,096px** 이하
  (디코딩 메모리 상한 4096² × 4B ≈ 64 MB).
- `navigator.storage.estimate()` 로 브라우저 전체 사용량 · 할당량을, 자산 store 의 `byteSize` 합으로 Artwork 사용량을 보인다.
- `navigator.storage.persist()` 는 **사용자가 "이 브라우저에 오래 보관 요청" 을 누를 때만** 부른다. 결과(허용 · 거절)를 그대로 보인다.
- 안내: "앨범아트는 이 브라우저에만 저장됩니다. 브라우저 데이터를 지우면 함께 사라집니다 — 전체 백업(ZIP)으로 보관하세요."

## 4. 이미지 검증 (`imageValidation.ts`)

1. 크기 한도 (파일 `size`) — 읽기 전에 거른다.
2. **매직 바이트**로 형식을 정한다 (확장자 · `file.type` 은 믿지 않는다): PNG `89 50 4E 47 0D 0A 1A 0A`, JPEG `FF D8 FF`,
   GIF `GIF87a`/`GIF89a`, WebP `RIFF....WEBP`. 그 밖(SVG · HTML · 동영상 등)은 거절.
3. **움직이는 WebP**(`VP8X` 의 애니메이션 비트 · `ANIM` 청크)는 초기 범위에서 **거절**한다 — Chrome 은 재생하지만 정지
   프레임 · 성능을 이번에 검증할 수단(만들 도구)이 없다. "움직이는 이미지는 GIF 로 올려 주세요". (TODO: M12 이후)
4. GIF 프레임 수: 블록을 걸어 이미지 서술자(`0x2C`)를 센다 — 2 이상이면 `animated`.
5. **실제 디코딩**: `createImageBitmap(blob)` 이 성공해야 하고 폭 · 높이가 1 이상 · 한도 이하여야 한다. 실패하면 "이미지가
   손상되었거나 읽을 수 없습니다".
6. 포스터: 움직이는 GIF 는 첫 프레임을 캔버스에 그려 PNG 로 만든다 (`OffscreenCanvas` → 없으면 `<canvas>`).
7. Blob 의 `type` 은 **검증한 MIME** 으로 다시 붙인다 (`new Blob([bytes], { type })`) — 사용자가 준 `type` 을 쓰지 않는다.

표시는 언제나 `<img src="blob:…">` 다. 이미지 요소는 스크립트를 실행하지 않고, SVG 를 받지 않으므로 그림 안의 스크립트도 없다.
업로드한 파일은 외부로 보내지 않는다.

## 5. GIF · 애니메이션 · Object URL

- **Now Playing 카드의 지금 곡만** 움직인다. 설정 화면의 미리보기도 움직이되(고르는 중이므로), 목록 · 공유 미리보기 등
  나머지는 포스터를 쓴다.
- `prefers-reduced-motion: reduce` 이면 카드도 포스터를 쓴다. 카드에 "움직임 멈춤 / 재생" 단추를 두고(움직이는 그림일 때만),
  멈춤은 **포스터로 바꿔 끼우는 것**이다 — 브라우저는 `<img>` 의 GIF 를 멈추는 API 가 없으므로 "일시정지" 라고 하지 않는다
  (다시 재생하면 첫 프레임부터). 이 선택은 탭 메모리에만 둔다.
- 화면에 보이지 않을 때(`IntersectionObserver` 가 0) 카드의 GIF 를 포스터로 바꾼다 — 보이지 않는 디코딩을 줄인다.
- Object URL 수명: `useObjectUrl(blob)` 하나가 만들고 지운다 — Blob 이 바뀌면 이전 URL 을 `revokeObjectURL`, 컴포넌트가
  사라지면(`onScopeDispose`) 지운다. 시험이 만든 수 = 지운 수를 확인한다.

## 6. 기존 데이터 · 기능 보호

- `39page.library` · `39page.moments` · `39page.theme` 의 키 · 형식 · 수정 번호 · 잠금은 바뀌지 않는다.
- Artwork 연결이 IndexedDB 에 있으므로 **라이브러리 쓰기 경로에 Artwork 가 끼지 않는다** — 확장 브리지 · Collect 대체
  경로 · 탭 간 잠금이 그대로다.
- 트랙 · 목록 삭제의 Artwork 정리는 라이브러리 저장이 **성공한 뒤** 별도로 한다. 정리가 실패해도 라이브러리는 이미
  옳다 — 남은 연결은 표시에 쓰이지 않고(트랙이 없다) `cleanUp` 이 지운다.
- 라이브러리가 `protected` · `unavailable` 이면 고아 정리를 하지 않는다 (지금 트랙 목록을 믿을 수 없다).

## 7. ZIP 전체 백업 (`39page-full-backup`)

### 7-1. 구조

```text
39page-backup-YYYYMMDD-HHmm.zip
├── manifest.json        파일 목록 · 크기 · SHA-256 · 형식 버전
├── backup.json          기존 JSON 백업 파일 그대로 (format 39page-backup, schemaVersion 1)
│                        = library · moments · preferences(theme). 형식을 바꾸지 않는다
├── artwork.json         연결(playlistId · trackId · videoId · mode · assetId) + 자산 메타데이터
└── assets/<sha256>.<png|jpg|webp|gif>
```

- 지시서의 `library.json` · `moments.json` · `settings.json` 을 따로 두지 않고 **기존 `backup.json` 하나**로 둔다:
  같은 내용을 두 형식으로 적지 않고, 기존 검증기(`readBackup`) · 미리보기 · 섹션별 쓰기(`useBackupImport`)를 그대로 쓰며,
  ZIP 을 풀어 `backup.json` 만 옛 빌드에 가져와도 된다(Artwork 만 빠진다).
- `manifest.json`:

```jsonc
{
  "format": "39page-full-backup",
  "formatVersion": 1,
  "createdAt": "2026-11-15T03:00:00.000Z",
  "app": { "name": "39page", "version": "<빌드 버전>" },
  "contents": ["backup", "artwork"],
  "files": [
    { "path": "backup.json", "byteSize": 1234, "sha256": "…" },
    { "path": "artwork.json", "byteSize": 456, "sha256": "…" },
    { "path": "assets/<id>.png", "byteSize": 99999, "sha256": "<id>", "mimeType": "image/png" },
  ],
}
```

- 자산 이미지는 압축하지 않고(`STORE` — 이미 압축된 형식) JSON 은 deflate 한다.

### 7-2. 읽기 검증 (아무것도 쓰기 전에 전부)

| 검사                      | 한도 · 규칙                                                                                                                     |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| ZIP 파일 크기             | 512 MB 이하                                                                                                                     |
| 항목 수                   | 4,000 이하                                                                                                                      |
| 경로                      | `manifest.json` · `backup.json` · `artwork.json` · `assets/<64 hex>.<ext>` **만** 허용. `..` · 절대 경로 · `\` · 다른 이름 거절 |
| 압축 해제 크기 (ZIP bomb) | 항목별 선언 크기 ≤ 한도(JSON 8 MB · 자산 12 MB), 합계 ≤ 1 GB, 압축률 > 200 이면 거절. **실제 풀린 바이트도** 선언과 같아야 한다 |
| 중복                      | 같은 경로 두 번 · 같은 assetId 두 번 거절                                                                                       |
| 무결성                    | 모든 파일의 SHA-256 = manifest. 자산은 파일 이름 = 내용 해시                                                                    |
| 이미지                    | §4 검증을 **다시** 한다 (매직 바이트 · 디코딩 · 한도). MIME 은 내용으로 정한다                                                  |
| 연결                      | `artwork.json` 의 assetId 가 모두 manifest 에 있어야 한다. 없으면 그 연결만 "자산 누락" 으로 보고                               |
| 미래 버전                 | `formatVersion` > 1 이면 거절 ("더 새 39page 에서 만든 파일")                                                                   |
| 손상                      | 하나라도 깨졌으면 **어느 파일이 왜**인지 미리보기에 적는다. 깨진 자산은 건너뛸 수 있게 하되(그 트랙은 auto) 숨기지 않는다       |

### 7-3. 복원 — 단계 · 검증 · 확정 · 실패 복구

`localStorage`(라이브러리 · Moments) 와 IndexedDB(Artwork) 는 **한 트랜잭션으로 묶이지 않는다.** 그래서:

1. **검증** — §7-2 전부. 실패하면 끝 (아무것도 쓰지 않음).
2. **미리보기** — 기존 미리보기(목록 · 트랙 · Moments 수, 교체되는 것) + Artwork(연결 수 · 자산 수 · 용량 · 이미 있는 자산 수 ·
   깨진 자산) + 저장 공간 여유(`estimate`). 시작 전 경고: "플레이리스트 · Moments 와 앨범아트는 다른 저장소라, 중간에 실패하면
   일부만 바뀔 수 있습니다. 먼저 지금 데이터를 전체 백업(ZIP)으로 내려받으세요." + 그 단추.
3. **스테이징 (추가만)** — 새 자산을 IndexedDB 에 넣는다. 내용 해시 id 라 기존 자산을 덮지 않고, 기존 연결은 그대로다.
   실패(용량 등) → 넣은 것 중 어떤 연결도 쓰지 않는 자산을 지우고 끝. **라이브러리 · Moments 는 아직 그대로.**
4. **텍스트 확정** — 기존 `useBackupImport.apply()` (잠금 · 지문 · 다시 읽어 확인 · 섹션별 결과).
   플레이리스트가 `saved` 가 아니면 → Artwork 연결을 바꾸지 않고, 3 에서 넣은 자산 중 안 쓰는 것을 지운다. 결과에 그대로 적는다.
5. **연결 확정** — 한 IndexedDB 트랜잭션: 기존 연결 전부 지우고 파일의 연결을 쓴다 (라이브러리를 통째로 교체했으므로 연결도
   통째로 교체). 이 트랜잭션은 전부 되거나 전부 안 된다.
   실패하면 → 라이브러리는 이미 새 것이고 연결은 **옛 것 그대로** (옛 트랙 id 를 가리켜 표시되지 않음). "앨범아트 연결을 저장하지
   못함 — 다시 시도" 를 결과에 남기고, 스테이징한 자산은 지우지 않는다(다시 시도가 쓴다).
6. **정리 · 확인** — 어느 연결도 쓰지 않는 자산을 지우고, 연결을 다시 읽어 파일과 같은지 확인한 뒤 "앨범아트 N개 복원됨" 을 적는다.

되돌릴 수 없는 지점은 4 (기존 JSON 가져오기와 같다 — 그래서 시작 전에 지금 데이터를 먼저 내려받게 한다).

### 7-4. JSON 내보내기와의 관계

- 기존 "JSON 백업" 은 그대로 둔다 (플레이리스트 · Moments · 테마). 이름을 **"JSON 백업 (앨범아트 제외)"** 로 바꾸고, 사용자 이미지가
  하나라도 있으면 "이 파일에는 앨범아트가 없습니다 — 전체 백업(ZIP)을 쓰세요" 를 내보내기 확인에 띄운다.
- "전체 백업 (ZIP)" 이 기본 권장이다. Artwork 를 읽지 못했거나(IndexedDB 불가) 자산이 깨졌으면 **완료라고 하지 않는다**: "앨범아트
  N개를 넣지 못했습니다" 를 보이고 manifest 의 `incomplete` 에 그 목록을 적는다.
- 기존 JSON 백업 파일(`.json`)은 계속 가져올 수 있다. 가져오면 Artwork 연결은 그대로 두고(같은 트랙 id 면 그대로 보이고, 아니면 auto),
  고아 연결은 정리가 지운다.

## 8. 파일 공유 패키지 (`39page-share`)

> **없어짐 (2026-11-20, ADR 0043)** — 파일 공유를 없앴다. 공유는 링크 · 이미지 카드다. 전체 백업 가져오기는 이 형식을 계속 거절한다.

### 8-1. 구조

```text
<목록 이름>.39page-share.zip
├── manifest.json   format "39page-share", formatVersion 1, kind "track" | "playlist", files(경로 · 크기 · SHA-256)
├── share.json      { playlist: { sourceId, name, tracks: [{ sourceId, videoId, title, artwork? }] }, moments?: [...] }
└── assets/<sha256>.<ext>
```

- `artwork`: `{ mode: 'default' }` 또는 `{ mode: 'custom', assetId }`. auto 는 적지 않는다.
- **넣는 것만 넣는다**: 고른 트랙(또는 고른 목록)의 제목 · videoId · 순서 · Artwork. 다른 목록 · 선택 상태 · 테마 · 다른 영상의 Moments 는
  넣지 않는다. Moments 는 **사용자가 켰을 때만**, 그 트랙들의 videoId 의 Moment 만 넣는다 (기본 꺼짐, 개수 표시).
- `sourceId` 는 보낸 쪽의 id (정보용 · 장래 커뮤니티 공유에서 같은 출처를 알아보는 데 쓸 수 있는 안정 식별자). 받는 쪽은
  **새 id 를 만든다** — 받은 id 를 그대로 쓰면 받는 사람의 목록과 충돌할 수 있다.

### 8-2. 가져오기

- 검증은 §7-2 와 같다 (경로 허용 목록만 다르다).
- 미리보기: 곡 수 · Artwork 수 · Moments 수 · 이미 있는 영상 수.
- 선택: **새 플레이리스트로**(기본, 이름 = 패키지 이름, 같은 이름이 있으면 "(2)") 또는 **기존 목록에 추가**.
- 중복: 기존 목록에 추가할 때 같은 videoId 가 이미 있으면 기본은 **건너뜀**("같은 영상 N곡 건너뜀"), 사용자가 "그래도 추가" 를 고를 수 있다.
- 자산: 내용 해시라 같은 이미지가 있으면 다시 저장하지 않는다.
- Moments: 켰을 때만. 같은 (videoId, 초, 메모) 의 Moment 가 있으면 건너뛴다. 새 Moment 는 새 id.
- 순서: (1) 자산 스테이징 → (2) 라이브러리 쓰기(목록 만들기 · 트랙 추가, 기존 store 액션) → (3) 연결 쓰기 (한 트랜잭션) →
  (4) Moments(켰을 때). 2 가 실패하면 3 · 4 를 하지 않고 스테이징한 자산을 정리한다. 3 이 실패하면 곡은 들어왔고 그림만
  빠졌다고 보고한다 ("다시 시도").

## 9. 장래 확장 (이번에 구현하지 않음)

- 계정 · 커뮤니티 · 공개 링크 공유 · 클라우드 동기화: 자산 id 가 내용 해시이고 공유 패키지가 `sourceId` · `formatVersion` 을
  가지므로, 서버가 생겨도 같은 패키지를 업로드 단위로 쓸 수 있다. 서버 · 로그인 · URL 생성은 만들지 않았다.
- 움직이는 WebP, 원본 픽셀 자르기 · 회전, 목록 화면의 작은 그림, Moment 별 그림.

## 10. M12-6 표시 설정·패키지 개정 (이 절이 v1 서술의 최신 보충이다)

`ArtworkAssignment.display?: ArtworkDisplay`는 사용자 이미지의 연결별 선택 필드다.
`{ fit: 'cover' | 'contain', positionX: 0..100, positionY: 0..100, zoom: 1..3 }`, 기본은 cover/50/50/1이다.
기존 연결에 필드가 없으면 기본값으로 읽고 쓰지 않는다. 잘못된 값·비유한 수·부분 객체는 패키지 읽기 시 거절한다.

원본과 포스터에 같은 CSS `object-fit`·`object-position`·확대·변환 중심을 적용한다. cover는 채우고 contain은 비율을
보존해 의도적인 여백을 둔다. 포인터 이동은 표시된 이미지의 실제 넘침/여백 길이로 백분율을 계산한다.
자산과 Blob은 그대로이며 구도만 저장할 때 assignments 한 건만 쓴다. DB 키·색인 변화가 없으므로 IndexedDB v1을 유지한다.
저장 실패·탭 간 revision 충돌 시 이전 연결을 보존하고, 카드에는 저장 확정 후 반영한다.

전체 ZIP manifest `formatVersion: 2`, artwork.json `version: 2`, 공유 manifest `formatVersion: 2`, share.json `version: 2`로
내보낸다. 각각 v1/v2를 읽고 더 새 버전을 거절한다. 내부 backup.json은 기존 JSON 형식이다. 공유 트랙 artwork와 전체 백업
연결에 display를 포함하며, 새 ID로 가져와도 그대로 옮긴다. staging·rollback·불완전 백업·누락 자산 정책은 §7–8 그대로다.

설정 화면에서도 GIF는 모션 감소·멈춤·화면 밖에서 포스터로 전환하고 URL은 세션 종료 시 해제한다.
기존 §9의 이미지 자르기 중 **표시 구도 조절**은 구현됐으며, 원본 픽셀 자르기·회전은 여전히 범위 밖이다.
근거: [ADR 0035](../decisions/0035-m12-6-edit-sessions-and-artwork-display.md).

## 11. Artwork Editor UX 후속 패치 (저장 계약 변경 없음)

설정 화면은 고정 헤더·단일 스크롤 본문·하단 동작 영역으로 나눈다. 본문은 편집 칸 폭 560px 이상에서 2열,
그 아래에서 1열이며 미리보기만 본문 안에서 sticky다. 편집 칸 높이 280px 이하는 여백과 미리보기를 줄여 컨트롤 행을 확보한다.
이 규칙은 Artwork 컴포넌트의 scoped CSS·크기 컨테이너 안에만 적용한다.

`ArtworkEditorPreview`는 기존 display draft를 직접 v-model로 받아 미리보기·슬라이더·드래그가 같은 값을 사용한다.
저장 전 비교는 로컬 UI boolean으로만 관리한다. 같은 자산이면 이미지 URL·노드를 유지해 구도만 바꾸며,
GIF 모션 상태는 기존 ArtworkPreview가 계속 소유한다. 비교·편집 UI를 위해 자산·연결·백업 포맷을 바꾸지 않는다.
검증: [편집기 UX 보고서](../development/ARTWORK_EDITOR_UX_REPORT.md).
