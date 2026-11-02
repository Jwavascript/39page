import { createApp } from 'vue'
import { createPinia } from 'pinia'

// 공통 토큰 -> 기본 스타일 -> 테마 토큰 순서로 불러온다.
// 두 테마를 항상 함께 로드해 `data-theme` 교체만으로 즉시 전환되게 한다.
import './styles/tokens.css'
import './styles/base.css'
import './themes/mono-vinyl/tokens.css'
import './themes/kawaii-synth-cassette/tokens.css'

import App from './app/App.vue'

const app = createApp(App)

app.use(createPinia())

app.mount('#app')
