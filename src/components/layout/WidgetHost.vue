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
 * 넓은 화면: 데크 | 플레이어 | 정보(시계·날씨) 3열. 마스코트는 데크 아래.
 *
 * ⚠ **M6-1 에서 승인된 레퍼런스의 2열 배치에서 의도적으로 벗어났다.**
 * 실기기 검증에서 보고된 세 가지를 풀기 위해서다 (AGENTS.md 규칙 6 — 사용자
 * 확인을 받았다. 상세: `docs/development/M6_PLAN.md`).
 *
 * - 데크(LP·카세트)가 너무 컸다. 3열로 나누면 열 폭이 줄어 데크도 줄어든다
 * - 영상이 아래쪽에 있어 스크롤해야 보였다. 플레이어를 **2열 1행**으로 올린다
 * - 플레이어가 항상 화면 안에 있어야 드로어를 오버레이로 바꿀 수 있다.
 *   가시성 측정은 다른 요소에 덮인 것을 감지하지 못하므로, 오버레이가
 *   플레이어를 비켜가는 배치가 전제다 (ADR 0011 개정 절)
 *
 * 행은 셋이다. 데크와 플레이어가 위 두 행을 가로지르고 마스코트가 셋째 행에
 * 선다. 위젯 루트가 그리드의 직계 자식이어야 하므로 래퍼를 쓸 수 없다
 * (ADR 0002). 행을 이렇게 나누면 래퍼 없이도 마스코트가 데크 바로 아래에 붙는다.
 *
 * 2열의 최소값 360px 은 임의의 값이 아니다. `.video-holder` 가
 * `min-height: 202px` 과 `aspect-ratio: 16/9` 를 함께 가지므로, 폭이
 * 202 × 16/9 ≈ 359px 미만이면 16:9 를 지킬 수 없다. 그 아래에서는 상자가
 * 세로로 눌려 레터박스가 생긴다.
 */
.widget-host {
  /* 간격을 변수로 둔다. 구분선이 이 값의 절반만큼 왼쪽으로 나가야 한다. */
  --host-gap: clamp(20px, 2.3vw, 39px);

  display: grid;
  grid-template-areas:
    'deck player clock'
    'deck player weather'
    'deck player .'
    'playlist mascot .';
  /*
   * 1·2 행은 **콘텐츠 높이**(`auto`)다. 그래야 시계와 날씨가 서로 붙는다.
   * 3 행이 `1fr` 로 남은 높이를 모두 먹으므로 정보 열의 빈자리가 **아래**에
   * 모인다 — 다른 위젯을 더할 자리다 (M7 요청 4).
   *
   * 이전에는 행이 둘뿐이어서 행 높이를 데크·플레이어가 지배했고, 시계가
   * 1 행 위쪽에 붙은 뒤 **아래로 빈 공간이 생긴 다음** 날씨가 2 행 시작에
   * 붙었다. 둘 사이가 벌어져 보인 원인이다.
   */
  grid-template-rows: auto auto 1fr auto;
  /*
   * 3열의 최소값이 둘 다 근거가 있는 값이다.
   *
   * - 2열(플레이어) 360px: `.video-holder` 가 min-height 202px 과
   *   aspect-ratio 16/9 를 함께 가지므로 202 × 16/9 ≈ 359px 미만에서는
   *   16:9 를 지킬 수 없다
   * - 3열(정보) **드로어 폭 자체**: 우측 오버레이 드로어가 이 열 안에서
   *   끝나야 플레이어를 가리지 않는다. 가시성 측정은 다른 요소에 덮인 것을
   *   감지하지 못하므로(`playerVisibility.ts`), 이 보장은 레이아웃이 져야
   *   한다. 두 값을 묶어 두면 드로어 폭을 바꿔도 보장이 따라간다
   */
  grid-template-columns:
    minmax(0, 0.9fr)
    minmax(360px, 0.95fr)
    minmax(var(--size-drawer-width), 0.55fr);
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
 * 플레이리스트 위젯의 자리 (M6-4, M7 에서 이동).
 *
 * **데크 바로 아래(1열)** 다. 데크를 누르면 이 위젯이 펼쳐지므로 둘이 붙어
 * 있어야 무엇이 열렸는지 눈으로 따라갈 수 있다 (M7 요청 1·3). 마스코트는
 * 2열 아래로 내려갔다.
 *
 * 3열(정보)을 비워 둔 것은 의도다 — 우측 오버레이 드로어가 3열 안에서
 * 끝나므로, 플레이리스트가 1열에 있으면 **편집 오버레이가 열려 있어도 타일이
 * 가려지지 않는다.** 오버레이에서 한 목록을 편집하면서 다른 목록으로 건너갈
 * 수 있다.
 */

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
 * 1100px 이하: **2열**로 재배치한다 (M6-1).
 *
 * 이전에는 단일 열 5행이었고 플레이어가 **맨 아래**였다. 1000×713 실측에서
 * `.player-mount` 의 top 이 1247px — 화면 밖이라 재생 요청마다 자동 스크롤이
 * 필요했다. 데크도 전체 폭을 써서 너무 컸다.
 *
 * 플레이어를 **데크 바로 아래**에 둔다. 사용자가 지정한 자리다.
 *
 * grid-template-areas 만 바꾼다. DOM 부모·순서·컴포넌트 인스턴스는 그대로이며
 * 언마운트나 re-parenting 이 일어나지 않는다 (ADR 0002).
 */
@media (max-width: 1100px) {
  .widget-host {
    /*
     * M7 요청 5 — 데크 옆(이전의 시계·날씨 자리)이 플레이리스트다.
     * 시계·날씨는 플레이어 아래로 내려가 한 행을 나눠 쓴다.
     */
    grid-template-areas:
      'deck playlist'
      'player player'
      'clock weather'
      'mascot mascot';
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    grid-template-rows: auto auto auto auto;
  }

  /*
   * 플레이리스트가 **데크 높이를 넘지 않는다** (M7 요청 5).
   *
   * 행 높이는 데크가 정한다. 위젯을 그 행에 늘려 붙이면(`stretch`) 높이가
   * 데크와 같아지고, 목록이 길면 위젯 **안에서** 스크롤한다. 높이를 숫자로
   * 정하지 않으므로 화면 폭이 바뀌어도 따라간다.
   */
  .widget-host > [data-widget='playlist']:not(.is-collapsed) {
    min-height: 0;
    align-self: stretch;
  }

  /*
   * ⚠ **플레이어가 두 열을 가로지르는 것은 공식 요구사항 때문이다.**
   *
   * 폰 세로(390px)에서 워크스페이스 안쪽 폭은 약 356px 이고 반 칸은 ~168px 다.
   * `.video-holder` 의 최소값은 202px(200 + 테두리 2)이므로 반 칸에 두면
   * 넘치거나 `too-small` 로 재생이 거절된다. 그래서 전체 폭을 쓴다.
   *
   * 대신 상한을 둔다. 1000px 쯤에서 전체 폭이면 16:9 높이가 530px 까지 커져
   * "스크롤 없이 한 화면" 이 깨진다.
   */
  .widget-host > [data-widget='player'] {
    width: 100%;
    max-width: var(--size-player-max-compact);
    justify-self: center;
  }

  /*
   * 2열이므로 세로 구분선을 유지한다. 데크와 플레이리스트 사이, **첫 행**에만
   * 둔다. 단일 열이던 이전에는 가로선으로 바꿨지만(레퍼런스의 `.info` 전환)
   * 이제는 열이 둘이라 세로선이 그 역할을 그대로 한다.
   */
  .widget-host::before {
    grid-row: 1 / 2;
    grid-column: 2;
  }
}
</style>
