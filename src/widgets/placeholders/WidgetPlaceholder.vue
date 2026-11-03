<script setup lang="ts">
/**
 * 개발용 임시 플레이스홀더. **최종 디자인이 아니다.**
 *
 * 실제 위젯 컴포넌트(데크 SVG, 시계, 날씨, 플레이어, 마스코트)가 들어오기
 * 전까지 레이아웃 영역을 식별할 수 있게만 한다.
 *
 * 교체는 `src/widgets/registry.ts`의 `component` 한 줄만 바꾸면 된다.
 * `DashboardShell`이나 `WidgetHost`는 수정하지 않는다.
 */
defineProps<{
  /** 영역 이름. 화면에서 위젯을 식별하는 용도다. */
  label: string
  /** 실제 컴포넌트가 들어올 마일스톤. */
  plannedIn: string
}>()
</script>

<template>
  <section class="widget-placeholder">
    <span class="label">{{ label }}</span>
    <span class="planned">{{ plannedIn }}에서 구현</span>
  </section>
</template>

<style scoped>
.widget-placeholder {
  display: flex;
  flex-direction: column;
  gap: 6px;
  align-items: center;
  justify-content: center;
  min-height: 112px;
  padding: 18px;
  border: 1px dashed var(--line-color);
  color: var(--text-dim-color);
  font-family: var(--font-mono);
  text-align: center;
}

.label {
  color: var(--text-muted-color);
  font-size: 12px;
  letter-spacing: 0.12em;
}

.planned {
  font-size: 10px;
  letter-spacing: 0.05em;
}
</style>
