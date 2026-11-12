// 디자인 토큰은 웹앱 파일을 그대로 쓴다 — 변수 선언뿐인 CSS 다 (ADR 0022 결정 2).
import '@web/styles/tokens.css'
import '@web/themes/mono-vinyl/tokens.css'
import './panel.css'

import { createApp } from 'vue'

import PanelApp from './PanelApp.vue'
import { PANEL_BRIDGE, createChromePanelBridge } from './panelBridge'

createApp(PanelApp).provide(PANEL_BRIDGE, createChromePanelBridge()).mount('#app')
