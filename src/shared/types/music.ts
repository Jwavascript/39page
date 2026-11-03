/**
 * 트랙의 재생 소스.
 *
 * MVP는 YouTube 단독이다. 유니온으로 둔 이유는 `source` 필드를 나중에
 * 넓힐 때 저장 스키마를 바꾸지 않아도 되게 하려는 것이며,
 * MVP에서 다른 값을 추가하지 않는다.
 */
export type TrackSource = 'youtube'

/** 플레이리스트에 담기는 한 곡. */
export interface Track {
  /** 앱 내부 식별자. YouTube의 videoId와 다르다. */
  id: string
  source: TrackSource
  /** YouTube 영상 ID (11자). `parseYouTubeVideoId`로 추출한다. */
  videoId: string
  /** 표시 이름. 비어 있으면 호출부가 videoId로 대체 표기한다. */
  title: string
}

/** 트랙의 순서 있는 묶음. */
export interface Playlist {
  id: string
  name: string
  tracks: Track[]
}

/**
 * 라이브러리의 저장 상태.
 *
 * `selectedPlaylistId`는 **존재하는 플레이리스트를 가리키거나 `null`** 이다.
 * 재생 중인 대기열과는 다른 상태다. 라이브러리에서 다른 목록을 선택해도
 * 재생 큐는 바뀌지 않는다 (`docs/architecture/SYSTEM_DESIGN.md` §6.1).
 */
export interface LibraryData {
  playlists: Playlist[]
  selectedPlaylistId: string | null
}
