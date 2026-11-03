<script setup lang="ts">
/**
 * 앱 루트.
 *
 * 조립만 담당한다. 화면 구조는 `DashboardShell`, 위젯 배치는 `WidgetHost`가
 * 맡는다.
 */
import DashboardShell from '@/components/layout/DashboardShell.vue'
import { MVP_DASHBOARD_LAYOUT } from '@/app/layout'
</script>

<template>
  <DashboardShell brand="39page" :layout="MVP_DASHBOARD_LAYOUT" />
</template>
