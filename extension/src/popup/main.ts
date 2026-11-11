// 디자인 토큰은 웹앱 파일을 그대로 쓴다 — 변수 선언뿐인 CSS 다 (ADR 0022 결정 2).
import '@web/styles/tokens.css'
import '@web/themes/mono-vinyl/tokens.css'
import './popup.css'

import { createApp } from 'vue'

import PopupApp from './PopupApp.vue'
import { BRIDGE_KEY, createChromeBridge } from './bridge'

createApp(PopupApp).provide(BRIDGE_KEY, createChromeBridge()).mount('#app')
