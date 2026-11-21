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
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

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

/*
 * 가사 칸의 위치 (ADR 0046). 가사는 넓은 화면에서 **영상 · 재생 카드 바로 아래**, 두 열에서는 **데크 바로 아래**의
 * 남는 자리를 쓴다. 그 자리의 위 끝은 플레이어 · 데크의 높이로 정해지는데, 그 높이는 열 폭(16:9 영상 · 데크 그림)에
 * 따라 바뀐다. 행을 하나 더 두는 CSS 만으로는 데크 아래나 카드 아래에 틈이 생긴다(여러 행을 걸치는 칸의 높이 분배).
 * 그래서 두 위젯의 높이를 재서 변수로 건다 — 배치(그리드 영역 · DOM 부모)는 그대로다 (ADR 0002).
 */
const host = ref<HTMLElement | null>(null)
let observer: ResizeObserver | null = null

function measure(): void {
  const root = host.value
  if (root === null) return
  for (const name of ['player', 'deck'] as const) {
    const el = root.querySelector<HTMLElement>(`:scope > [data-widget='${name}']`)
    if (el !== null) root.style.setProperty(`--${name}-block-size`, `${String(el.offsetHeight)}px`)
  }
}

onMounted(() => {
  measure()
  if (typeof ResizeObserver !== 'function' || host.value === null) return
  observer = new ResizeObserver(measure)
  for (const name of ['player', 'deck']) {
    const el = host.value.querySelector(`:scope > [data-widget='${name}']`)
    if (el !== null) observer.observe(el)
  }
})

onBeforeUnmount(() => observer?.disconnect())
</script>

<template>
  <div ref="host" class="widget-host">
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
  /*
   * NOW PLAYLIST · Moments 칸의 **고정** 높이 (ADR 0046). 곡 · 순간이 적어도 칸은 이 높이라 대시보드 전체 높이가
   * 목록 길이에 따라 바뀌지 않는다. 넘치면 칸 안에서 스크롤한다.
   */
  --dashboard-list-height: clamp(300px, 46vh, 470px);

  display: grid;
  /*
   * M11-7B: NOW PLAYLIST(`playlist`)가 **데크 바로 아래**에서 3·4 행을 쓴다 (ADR 0030). M11-6 까지는
   * 데크가 1~3 행을 가로질렀고 그 높이를 플레이어가 정해, 데크 아래에 빈자리가 남은 뒤에야 4 행의
   * 플레이리스트가 왔다. 그 빈자리가 지금 재생목록의 자리다.
   */
  grid-template-areas:
    'deck player clock'
    'deck player weather'
    'playlist player moments';
  /*
   * 1 행은 **콘텐츠 높이**(`auto`), 2 행이 `1fr` 다. 데크는 1·2 행을 가로지르고 그 남는 높이를 2 행이
   * 받는다 — 시계(1 행)와 날씨(2 행 위쪽)는 서로 붙어 있고, 벌어지는 자리는 날씨 **아래**다.
   * 3 행은 콘텐츠 높이다: NOW PLAYLIST 와 Music Moments 가 선다.
   *
   * M12-2 (ADR 0032): 4 행의 마스코트가 없어졌다. 영상 아래의 Now Playing 카드는 **플레이어 위젯 안**이라 플레이어가
   * 1 ~ 3 행을 가로지른다 — 카드를 따로 된 그리드 칸으로 두면 세 열이 한 행 높이를 나눠 써서 영상과 카드 사이가
   * 81 ~ 165px 벌어졌다 (실제 Chrome 실측, `docs/development/m12-results`). Moments 는 시계 · 날씨 아래 3 행의 남는
   * 높이를 모두 쓴다 (`align-self: stretch`).
   *
   * (M7 까지는 행이 둘뿐이어서 시계가 1 행 위쪽에 붙은 뒤 아래로 빈 공간이 생긴 다음 날씨가 2 행
   * 시작에 붙었다. 그 벌어짐을 다시 만들지 않는다.)
   */
  grid-template-rows: auto 1fr auto;
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
 * Music Moments 의 자리 (M9-4). 정보 열의 빈자리 — 3·4 행을 채운다.
 *
 * M11-3 에서 위젯이 "이 곡의 Moments" 미리보기(최대 3행 · 빠른 저장)로 줄어 **안쪽 스크롤이 없다**.
 * 그래서 M9 의 `contain: size`(칸 안에서 스크롤)를 풀었다 — 메모 폼을 여는 동안만 행이 조금 길어질 수
 * 있다. 데크 · 플레이어는 위쪽 정렬이라 움직이지 않는다.
 */
.widget-host > [data-widget='moments'] {
  min-height: 0;
  align-self: stretch;
}

/*
 * 고정 높이 목록 (ADR 0046) — 위젯 안의 줄 칸이 남는 높이를 채우고(그 위젯의 `flex`), 상한(`max-height`)은 푼다.
 * 한 열(700px 이하)에서는 아래에서 푼다 — 그 배치는 안쪽 스크롤 없이 "펼치기" 로 늘인다 (M11-3).
 */
.widget-host > [data-widget='playlist'],
.widget-host > [data-widget='moments'] {
  height: var(--dashboard-list-height);
  --now-playlist-rows-height: none;
  --moments-rows-max: none;
}

/*
 * 가사 (ADR 0046) — 넓은 화면: 둘째 열 전체를 걸치되 **플레이어 높이만큼 내려서** 시작한다. 크기 봉쇄(`contain: size`)
 * 라 가사 길이가 행 높이를 정하지 않는다 — 칸은 다른 열이 정한 바닥까지이고 가사는 그 안에서 스크롤한다.
 * 배치 영역(`grid-area: lyrics`, 레이아웃 선언)을 여기서 덮는다 — 그 이름의 영역은 한 열 배치에만 있다.
 */
.widget-host > [data-widget='lyrics'] {
  grid-column: 2 !important;
  grid-row: 1 / -1 !important;
  align-self: stretch;
  min-height: 160px;
  margin-top: calc(var(--player-block-size, 0px) + var(--host-gap));
  contain: size;
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
      'moments moments'
      'clock weather';
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    grid-template-rows: auto auto auto auto;
  }

  /*
   * Music Moments 는 **플레이어 바로 아래** 한 행이다 (M9-4, ADR 0021).
   *
   * "지금 이 순간 저장" 은 영상을 보다가 누르는 버튼이라 영상 가까이 있어야
   * 한다. 시계·날씨는 그 아래로 한 칸 내려간다. 여기서는 자기 행을 가지므로
   * 내용 높이를 그대로 쓴다 — `contain` 을 풀지 않으면 행이 0 이 된다.
   */
  .widget-host > [data-widget='moments'] {
    align-self: start;
  }

  /* 가사 — 두 열에서는 **데크 바로 아래**(첫 행 왼쪽)의 남는 자리. 첫 행 높이는 옆의 NOW PLAYLIST 가 정한다. */
  .widget-host > [data-widget='lyrics'] {
    grid-column: 1 !important;
    grid-row: 1 !important;
    margin-top: calc(var(--deck-block-size, 0px) + var(--host-gap));
  }

  /*
   * 두 열의 NOW PLAYLIST 는 데크 + 가사 칸(약 240px)만큼 — 데크 아래 가사 자리가 너무 낮아지지 않게. 데크 높이는
   * 열 폭으로만 바뀌므로 목록 길이와 무관하게 고정이다.
   */
  .widget-host > [data-widget='playlist'] {
    height: max(
      var(--dashboard-list-height),
      calc(var(--deck-block-size, 0px) + var(--host-gap) + 240px)
    );
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

/*
 * 700px 이하: **한 열** (M11-3, U20 · U21).
 *
 * 두 열을 360px 까지 끌고 가면 데크 옆 반 칸(약 140px)에 플레이리스트가 끼고, 시계 · 날씨가 반 칸씩
 * 나눠 글자가 빽빽했다. 순서는 듣는 흐름이다 — **작은 데크 띠** → 영상 → **이 곡의 Moments(저장)** →
 * NOW PLAYLIST → 시계 → 날씨. (M12-2: 마스코트가 없어지고 영상 바로 아래가 Now Playing 카드다 — 플레이어 위젯 안.) 저장이 영상 바로 아래에 있어 세로 화면에서도 닿는다.
 *
 * M11-7B: 데크는 여기서 **작은 띠**다 (`DeckWidget` — 아트를 통째로 줄여 왼쪽에, 안내를 옆에). M11-6
 * 까지는 화면 폭의 데크(390px 에서 약 220px 높이)가 영상을 첫 화면 아래로 밀었다 (ADR 0030).
 *
 * `grid-template-areas` 만 바꾼다. DOM 부모 · 순서 · 인스턴스는 그대로다 (ADR 0002).
 */
@media (max-width: 700px) {
  .widget-host {
    grid-template-areas:
      'deck'
      'player'
      'moments'
      'lyrics'
      'playlist'
      'clock'
      'weather';
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: none;
  }

  /* 한 열 — 목록은 안쪽 스크롤 없이 늘고(M11-3), 가사는 자기 행에 고정 높이로 선다. */
  .widget-host > [data-widget='playlist'],
  .widget-host > [data-widget='moments'] {
    height: auto;
  }

  .widget-host > [data-widget='lyrics'] {
    grid-area: lyrics !important;
    height: 260px;
    margin-top: 0;
    contain: none;
  }

  /* 한 열에는 세로 구분선이 없다. */
  .widget-host::before {
    display: none;
  }

  /* 데크는 작은 띠다 — 폭 전체를 쓰고, 크기는 `DeckWidget` 이 정한다 (M11-7B). */
  .widget-host > [data-widget='deck'] {
    width: 100%;
  }

  /* 띠와 영상 사이는 위젯 사이의 기본 간격보다 좁게 — 띠는 영상의 머리말처럼 붙는다. */
  .widget-host {
    row-gap: 14px;
  }
}

/*
 * 낮은 가로 화면 (폰 가로 — 높이 560px 이하, M11-7B).
 *
 * 폭으로는 두 열(1100px 이하) 배치지만 그 배치는 데크 · NOW PLAYLIST 가 첫 행을 차지해 **영상이 첫 화면
 * 아래**로 밀린다 (844×390 실측: 영상 위 끝 586px). 가시성 가드는 영상이 화면과 전혀 겹치지 않으면
 * 재생을 멈추므로(`playerVisibility.ts`), 폰을 가로로 돌리기만 해도 음악이 멈췄다. 여기서는 영상을 첫
 * 행 왼쪽에 두고 이 곡의 Moments · NOW PLAYLIST 를 그 옆에 둔다 — 데크는 그 아래다.
 *
 * `grid-template-areas` 만 바꾼다. DOM 부모 · 순서 · 인스턴스는 그대로다 (ADR 0002). 보관함 쪽의 같은
 * 조건(옆 배치)은 `DashboardShell` 의 `SIDE_QUERY` 다.
 */
@media (max-height: 560px) and (orientation: landscape) and (max-width: 1100px) {
  .widget-host {
    grid-template-areas:
      'player moments'
      'player playlist'
      'deck playlist'
      'lyrics playlist'
      'clock weather';
    /* 왼쪽 열 360px 이상 — 16:9 영상이 202px 을 지킬 수 있는 폭 (위 머리말과 같은 근거). */
    grid-template-columns: minmax(360px, 1fr) minmax(0, 1fr);
    grid-template-rows: auto auto auto auto;
  }

  .widget-host > [data-widget='player'] {
    width: 100%;
    max-width: none;
    justify-self: stretch;
  }

  /* 데크는 영상 아래 왼쪽 열 — 너무 크지 않게 영상 폭 안에서. */
  .widget-host > [data-widget='deck'] {
    width: 100%;
    max-width: 420px;
  }

  .widget-host > [data-widget='lyrics'] {
    grid-area: lyrics !important;
    height: 220px;
    margin-top: 0;
    contain: none;
  }

  .widget-host::before {
    display: none;
  }
}
</style>
