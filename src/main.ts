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
import { useLibraryStore } from './stores/library'
import { useThemeStore } from './stores/theme'

/** 최초 실행에서만 만드는 기본 플레이리스트 (`MVP_SPEC.md` F4). */
const DEFAULT_PLAYLIST_NAME = 'MY RECORDS'

const app = createApp(App)
const pinia = createPinia()

app.use(pinia)

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

app.mount('#app')
