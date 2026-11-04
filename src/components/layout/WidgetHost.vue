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
 *
 * M5: 정보 열 구분선을 **의사 요소**로 그린다. 선을 위한 DOM 래퍼를 만들면
 * 위젯 루트가 그리드의 직계 자식이 아니게 되어 ADR 0002 를 깬다.
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
 *
 * 행은 셋이다. 데크가 위 두 행을 가로지르고 마스코트가 셋째 행에 선다.
 * 승인된 디자인은 두 열이 각자 흐르는 구조(`.deck-wrap` / `.info`)지만,
 * 위젯 루트가 그리드의 직계 자식이어야 하므로 래퍼를 쓸 수 없다 (ADR 0002).
 * 행을 이렇게 나누면 래퍼 없이도 마스코트가 데크 바로 아래에 붙는다.
 *
 * 남는 차이 하나: 데크가 위 두 행보다 크면 그 차이가 두 행에 나뉘어, 시계와
 * 날씨 사이가 레퍼런스보다 약 35px 넓어진다 (1440px 실측). 행을
 * `max-content` 로 묶어봐도 막히지 않는다 — 두 트랙 모두 내재 크기라서
 * 분배 대상이다. 래퍼 없이 두 열을 **각자 흐르게** 할 방법이 없으므로
 * 여기까지가 한계다. 레퍼런스와의 차이를 M5 보고에 적었다.
 */
.widget-host {
  /* 간격을 변수로 둔다. 구분선이 이 값의 절반만큼 왼쪽으로 나가야 한다. */
  --host-gap: clamp(20px, 2.3vw, 39px);

  display: grid;
  grid-template-areas:
    'deck clock'
    'deck weather'
    'mascot player';
  grid-template-columns: minmax(0, 1.13fr) minmax(420px, 0.87fr);
  gap: var(--host-gap);
  align-content: start;
  /*
   * 늘이지 않는다. 승인된 디자인은 두 열이 각자의 흐름이라 마스코트가 데크
   * **바로 아래**에 붙는다. 늘이면 마스코트가 열 바닥까지 밀려 데크와의
   * 사이에 큰 빈 공간이 생긴다 (M5 스크린샷 비교에서 발견).
   */
  align-items: start;
}

/*
 * 정보 열 구분선 (M5). 승인된 디자인의 `.info { border-left }` 다.
 *
 * **DOM 래퍼를 만들지 않는다.** 위젯 루트가 그리드의 직계 자식이라는 성질을
 * 지켜야 한다 — 래퍼를 끼우면 플레이어 iframe 의 부모가 바뀐다 (ADR 0002).
 * 그래서 선을 의사 요소로 그린다. 의사 요소도 그리드 아이템이 될 수 있고,
 * 명시적 `grid-column` / `grid-row` 를 주므로 다른 위젯의 배치를 밀지 않는다.
 *
 * 간격의 가운데에 선다. 위젯 안쪽이 아니라 두 열 사이다.
 */
.widget-host::before {
  content: '';
  grid-row: 1 / -1;
  grid-column: 2;
  margin-left: calc(-0.5 * var(--host-gap));
  border-left: 1px solid var(--info-border-color);
  pointer-events: none;
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

  /*
   * 1열에서는 가로선이 된다. 승인된 디자인도 같은 전환을 한다
   * (`.info { border-left: 0; border-top: 1px }`). 시계 위, 즉 정보 블록이
   * 시작하는 자리에 둔다.
   */
  .widget-host::before {
    margin-top: calc(-0.5 * var(--host-gap));
    margin-left: 0;
    border-top: 1px solid var(--info-border-compact-color);
    border-left: 0;
    grid-row: 3;
    grid-column: 1;
    align-self: start;
  }
}
</style>
