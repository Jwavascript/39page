<script setup lang="ts">
/**
 * 앱 루트.
 *
 * 조립만 담당한다. 화면 구조는 `DashboardShell`, 위젯 배치는 `WidgetHost`가
 * 맡는다.
 */
import { provide } from 'vue'

import DashboardShell from '@/components/layout/DashboardShell.vue'
import { MVP_DASHBOARD_LAYOUT } from '@/app/layout'
import { createPlaybackCoordinator } from '@/features/playback/createPlaybackCoordinator'
import { PLAYBACK_COORDINATOR } from '@/features/playback/playbackCoordinator'

/*
 * 라이브러리와 재생을 잇는 유일한 지점 (M3-0.2, ADR 0009).
 *
 * 여기서 만드는 이유: 두 기능을 모두 아는 계층이 여기뿐이다
 * (`SYSTEM_DESIGN.md` §6.1). `library` 와 `playback` store 는 서로를
 * 모른 채로 남는다.
 *
 * 어댑터 팩토리(`PLAYER_ADAPTER_FACTORY`)는 `main.ts` 가 넣는다. 그쪽은
 * 실제 YouTube 구현체를 고르는 일이라 테스트가 갈아끼울 수 있어야 한다.
 */
provide(PLAYBACK_COORDINATOR, createPlaybackCoordinator())
</script>

<template>
  <DashboardShell brand="39page" :layout="MVP_DASHBOARD_LAYOUT" />
</template>
