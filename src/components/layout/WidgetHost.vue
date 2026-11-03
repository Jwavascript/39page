<script setup lang="ts">
/**
 * 레이아웃에 선언된 위젯 인스턴스를 렌더링한다.
 *
 * 이 컴포넌트의 루트가 CSS Grid 컨테이너이고, **각 위젯의 루트 DOM 노드가
 * 그 직계 자식**이다. 래퍼 `<div>`를 끼우지 않는다. 배치는 `grid-area`로만
 * 지정하므로, 영역이 바뀌거나 반응형으로 재배치되어도 DOM 부모와 순서는
 * 그대로다.
 *
 * 이 성질이 필수인 이유: 플레이어 iframe은 언마운트는 물론 **부모가 바뀌기만
 * 해도 재로드된다.** 따라서 레이아웃 엔진은 DOM을 재배치하지 않고 CSS로만
 * 배치해야 한다 (`docs/decisions/0002-persistent-player-host.md`).
 *
 * 테마는 참조하지 않는다. 테마 전환은 CSS 토큰 교체이며 위젯 목록·순서·키에
 * 영향을 주지 않는다.
 */
import { computed } from 'vue'

import type { DashboardLayout, WidgetInstance } from '@/shared/types'
import { findWidgetDefinition, type WidgetDefinition } from '@/widgets/registry'

const props = defineProps<{ layout: DashboardLayout }>()

interface PlacedWidget {
  instance: WidgetInstance
  definition: WidgetDefinition
}

/**
 * 레이아웃 순서를 유지한 채 각 인스턴스에 정의를 붙인다.
 *
 * 알 수 없는 위젯 종류는 **조용히 건너뛴다.** 저장된 레이아웃이 구버전이거나
 * 제거된 위젯을 가리킬 수 있다 (`SYSTEM_DESIGN.md` §5.3).
 */
const placed = computed<PlacedWidget[]>(() =>
  props.layout.items.flatMap((instance) => {
    const definition = findWidgetDefinition(instance.widgetType)
    return definition === undefined ? [] : [{ instance, definition }]
  }),
)
</script>

<template>
  <div class="widget-host">
    <!--
      :key 는 instanceId 만 쓴다. 테마나 배열 인덱스를 섞으면 재마운트가
      일어나고 플레이어가 재생 상태를 잃는다.
    -->
    <component
      v-for="{ instance, definition } in placed"
      :is="definition.component"
      :key="instance.instanceId"
      v-bind="definition.componentProps"
      :style="{ gridArea: instance.area }"
      :data-widget="instance.widgetType"
      :data-instance-id="instance.instanceId"
    />
  </div>
</template>

<style scoped>
/*
 * 넓은 화면: 왼쪽에 데크·마스코트, 오른쪽에 시계·날씨·플레이어.
 * 비율과 간격은 승인된 디자인의 .content 값을 따른다.
 */
.widget-host {
  display: grid;
  grid-template-areas:
    'deck clock'
    'deck weather'
    'deck player'
    'mascot player';
  grid-template-columns: minmax(0, 1.13fr) minmax(420px, 0.87fr);
  gap: clamp(20px, 2.3vw, 39px);
  align-content: start;
}

/*
 * 직계 자식이 넘치지 않게 한다. 긴 제목이나 iframe 때문에 가로 스크롤이
 * 생기는 것을 막는다.
 */
.widget-host > * {
  min-width: 0;
  max-width: 100%;
}

/*
 * 1100px 이하: 단일 열로 재배치한다.
 *
 * grid-template-areas 만 바꾼다. DOM 부모·순서·컴포넌트 인스턴스는 그대로이며
 * 언마운트나 re-parenting 이 일어나지 않는다.
 * 730 / 650 / 600px 의 정교한 조정은 M5에서 한다.
 */
@media (max-width: 1100px) {
  .widget-host {
    grid-template-areas:
      'deck'
      'mascot'
      'clock'
      'weather'
      'player';
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
