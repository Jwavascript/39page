import { createApp } from 'vue'
import { createPinia } from 'pinia'

// 공통 토큰 -> 기본 스타일 -> 테마 토큰 순서로 불러온다.
// 두 테마를 항상 함께 로드해 `data-theme` 교체만으로 즉시 전환되게 한다.
import './styles/tokens.css'
import './styles/base.css'
import './themes/mono-vinyl/tokens.css'
import './themes/kawaii-synth-cassette/tokens.css'
// 테마별 데크 CSS. 두 테마를 함께 로드해 CSS 로만 표시를 전환한다.
import './themes/mono-vinyl/deck.css'
import './themes/kawaii-synth-cassette/deck.css'

import App from './app/App.vue'
import CollectApp from './app/CollectApp.vue'
import { resolveEntry } from './app/entry'
import { PLAYER_ADAPTER_FACTORY } from './features/playback/PlayerAdapter'
import { YouTubeIFramePlayerAdapter } from './features/playback/YouTubeIFramePlayerAdapter'
import { useLibraryStore } from './stores/library'
import { useMomentsStore } from './stores/moments'
import { useThemeStore } from './stores/theme'

/** 최초 실행에서만 만드는 기본 플레이리스트 (`MVP_SPEC.md` F4). */
const DEFAULT_PLAYLIST_NAME = 'MY RECORDS'

const pinia = createPinia()

// 마운트 전에 저장된 테마를 동기적으로 복원한다.
// 첫 페인트에 다른 테마가 보이는 현상(FOUC)을 줄이기 위한 것이며,
// 검증 로직은 store와 저장 계층에만 둔다 (index.html에 중복하지 않는다).
useThemeStore(pinia).restore()

// 라이브러리도 마운트 전에 복원한다. 복원은 저장소에 쓰지 않는다.
// 기본 플레이리스트 생성은 restore() 와 분리된 별도 액션이며, 저장값이
// 아예 없었던 최초 실행에서만 동작한다 (ADR 0007).
const library = useLibraryStore(pinia)
library.restore()
library.seedFirstRunPlaylist(DEFAULT_PLAYLIST_NAME)
// 다른 탭의 저장을 이 탭에 반영한다 (M10-3, ADR 0024). 앱 수명 동안 듣는다.
library.watchExternalChanges()

if (resolveEntry(globalThis.location.hash) === 'collect') {
  /*
   * 수집 화면 (M10-3B, ADR 0023). 확장이 `#collect?…` 로 연다.
   *
   * 대시보드·플레이어·Moments 를 띄우지 않는다 — 두 번째 YouTube iframe 이 생기지
   * 않고, 이 탭은 라이브러리에 한 곡을 넣는 일만 한다. 저장은 사용자가 화면에서
   * 누를 때만 일어난다.
   */
  const collect = createApp(CollectApp, { hash: globalThis.location.hash })
  collect.use(pinia)
  collect.mount('#app')
} else {
  const app = createApp(App)
  app.use(pinia)

  /*
   * 실제 플레이어 어댑터. 팩토리로 주입한다 (ADR 0006).
   *
   * 인스턴스가 아니라 팩토리인 이유: 인스턴스를 주입하면 여러 PlayerSurface 가
   * 같은 어댑터를 공유한다. MVP 에는 하나뿐이지만 공유는 의도가 아니다.
   *
   * 이 한 줄이 FakePlayerAdapter 와 갈리는 유일한 지점이다. Fake 는 테스트만
   * 주입하므로 프로덕션 번들에 들어가지 않는다.
   *
   * 마운트 시점에는 네트워크 요청이 없다. YouTube API 스크립트와 iframe 은
   * 첫 load() 에서 생긴다 (ADR 0008).
   */
  app.provide(PLAYER_ADAPTER_FACTORY, () => new YouTubeIFramePlayerAdapter())

  /*
   * Music Moments 도 마운트 전에 복원한다 (M9-3). **읽기만 한다.**
   *
   * 키가 없으면 빈 목록이고 쓰지 않는다 — 기본값을 심는 액션이 없다. 손상·미래
   * 버전 원본은 `protected` 로 남고, 라이브러리의 복원 결과와 서로 영향을
   * 주지 않는다 (ADR 0019 결정 3). 화면에 보여주는 것은 M9-4 다.
   */
  useMomentsStore(pinia).restore()

  app.mount('#app')
}
