<script setup lang="ts">
/**
 * Kawaii Synth Cassette 카세트 데크 데크 아트.
 *
 * `design/references/two-themes-v09.html`의 SVG를 **그대로 이식**했다.
 * 좌표·`viewBox`·형태·색을 바꾸지 않았다 (`AGENTS.md` 규칙 6).
 *
 * 원본과 달라진 점은 세 가지뿐이다.
 * 1. `<defs>`의 id 에 `ksc-` 접두사를 붙였다. 두 데크 SVG 가 동시에 DOM 에
 *    존재하므로 id 가 충돌하면 그라디언트·필터·클립이 서로 덮인다.
 *    `url(#...)` 참조도 함께 바꿨다.
 * 2. 프로토타입 스크립트만 쓰던 id(`platter`, `hardwarePlay`, `deckIcon`)를
 *    제거했다. 애니메이션·동작에 필요한 class 는 그대로 남겼다.
 * 3. 내부 컨트롤의 `role="button"` / `tabindex` / `data-speed-button` 을
 *    제거했다. 동작하지 않는 버튼을 만들지 않기 위해서다. 금속 하드웨어는
 *    데크 본체 디자인의 일부이므로 외형만 남긴다.
 *
 * 회전 애니메이션은 M4 다. 지금은 정지 상태이며, 재생 중인 것처럼 보이지 않는다.
 */
</script>

<template>
  <svg
    class="deck-art deck-art--kawaii-synth-cassette"
    viewBox="0 0 900 570"
    role="img"
    aria-label="민트와 분홍 포인트가 있는 오리지널 카세트 데크"
  >
    <defs>
      <linearGradient id="ksc-synthBody" x1=".07" y1=".02" x2=".94" y2="1">
        <stop stop-color="#b7f9e9" />
        <stop offset=".43" stop-color="#74d9d0" />
        <stop offset="1" stop-color="#489cab" />
      </linearGradient>
      <linearGradient id="ksc-cassetteGlass" x1=".1" y1="0" x2=".9" y2="1">
        <stop stop-color="#233f50" />
        <stop offset="1" stop-color="#0d273b" />
      </linearGradient>
      <linearGradient id="ksc-tapeShell" x1=".05" y1="0" x2=".95" y2="1">
        <stop stop-color="#f4fff8" stop-opacity=".96" />
        <stop offset=".52" stop-color="#d6f8f0" stop-opacity=".83" />
        <stop offset="1" stop-color="#9ae6df" stop-opacity=".95" />
      </linearGradient>
      <filter id="ksc-synthShadow" x="-20%" y="-20%" width="150%" height="160%">
        <feDropShadow dx="0" dy="16" stdDeviation="13" flood-color="#000d18" flood-opacity=".5" />
      </filter>
    </defs>
    <!-- deck surface, soft plastic instead of metal -->
    <rect
      x="19"
      y="18"
      width="862"
      height="532"
      rx="20"
      fill="#1b5368"
      filter="url(#ksc-synthShadow)"
    />
    <rect
      x="25"
      y="16"
      width="850"
      height="520"
      rx="18"
      fill="url(#ksc-synthBody)"
      stroke="#d6fff3"
      stroke-width="3"
    />
    <path d="M46 52 H854" stroke="#f0fff9" stroke-opacity=".62" stroke-width="2" />
    <path d="M45 502 H855" stroke="#145467" stroke-opacity=".34" stroke-width="2" />
    <g font-family="ui-monospace,monospace" fill="#154b60">
      <text x="70" y="94" font-size="25" font-weight="bold" letter-spacing="3">
        SYNTH / CASSETTE
      </text>
      <text x="71" y="118" font-size="12" letter-spacing="2">MLF • DIGITAL MIX TAPE / 02</text>
      <text x="727" y="93" font-size="15" font-weight="bold">✦ 90s</text>
    </g>
    <!-- plastic inset -->
    <rect x="128" y="145" width="645" height="329" rx="18" fill="#1b6876" opacity=".45" />
    <rect
      x="138"
      y="135"
      width="627"
      height="323"
      rx="19"
      fill="url(#ksc-tapeShell)"
      stroke="#edfff9"
      stroke-width="4"
    />
    <rect x="154" y="155" width="595" height="70" rx="7" fill="#143e52" />
    <text
      x="183"
      y="195"
      font-size="23"
      font-family="ui-monospace,monospace"
      letter-spacing="4"
      fill="#dcfff6"
      font-weight="bold"
    >
      KAWAII SYNTH MIX
    </text>
    <rect x="630" y="170" width="100" height="35" rx="4" fill="#ff91bc" />
    <text
      x="680"
      y="193"
      font-size="16"
      text-anchor="middle"
      font-family="monospace"
      fill="#3b2547"
      font-weight="bold"
    >
      SIDE A
    </text>
    <rect
      x="160"
      y="242"
      width="583"
      height="166"
      rx="12"
      fill="url(#ksc-cassetteGlass)"
      stroke="#68bfc3"
      stroke-width="3"
    />
    <rect
      x="174"
      y="255"
      width="554"
      height="139"
      rx="8"
      fill="none"
      stroke="#a8ffeb"
      stroke-opacity=".27"
    />
    <path d="M265 328 H638" stroke="#ffd1e6" stroke-width="4" opacity=".56" />
    <g class="cassette-spools">
      <g transform="translate(310 327)">
        <g class="cassette-spool">
          <circle r="68" fill="#0c3248" stroke="#91f4e1" stroke-width="7" />
          <circle r="48" fill="#2a7082" stroke="#18495c" stroke-width="12" />
          <circle r="28" fill="#d5fff1" />
          <circle r="10" fill="#377e91" />
          <g fill="#7acec7">
            <rect x="-5" y="-45" width="10" height="20" rx="2" />
            <rect x="-5" y="25" width="10" height="20" rx="2" />
            <rect x="-45" y="-5" width="20" height="10" rx="2" />
            <rect x="25" y="-5" width="20" height="10" rx="2" />
          </g>
        </g>
      </g>
      <g transform="translate(589 327)">
        <g class="cassette-spool">
          <circle r="68" fill="#0c3248" stroke="#91f4e1" stroke-width="7" />
          <circle r="48" fill="#2a7082" stroke="#18495c" stroke-width="12" />
          <circle r="28" fill="#d5fff1" />
          <circle r="10" fill="#377e91" />
          <g fill="#7acec7">
            <rect x="-5" y="-45" width="10" height="20" rx="2" />
            <rect x="-5" y="25" width="10" height="20" rx="2" />
            <rect x="-45" y="-5" width="20" height="10" rx="2" />
            <rect x="25" y="-5" width="20" height="10" rx="2" />
          </g>
        </g>
      </g>
    </g>
    <path d="M175 417 H728 L689 453 H213 Z" fill="#f4c3d6" opacity=".88" />
    <text
      x="450"
      y="440"
      fill="#5d466c"
      text-anchor="middle"
      font-size="12"
      font-family="monospace"
      letter-spacing="4"
    >
      REWIND • PLAY • REPEAT
    </text>
    <g fill="#104456" font-family="monospace" font-size="15" font-weight="bold">
      <text x="70" y="504">■ STOP</text>
      <text x="274" y="504">▶ PLAY</text>
      <text x="696" y="504">60 MIN</text>
    </g>
    <rect
      x="675"
      y="477"
      width="113"
      height="36"
      rx="5"
      fill="#fa9ec9"
      stroke="#ffe4f0"
      stroke-width="2"
    />
    <text
      x="729"
      y="500"
      font-family="monospace"
      fill="#5c3355"
      font-size="14"
      text-anchor="middle"
      font-weight="bold"
    >
      ◁▷ MIX
    </text>
    <!-- stylized pixel hearts / stars (original shapes) -->
    <g fill="#ff88b4">
      <rect x="78" y="314" width="12" height="12" />
      <rect x="101" y="314" width="12" height="12" />
      <rect x="66" y="326" width="59" height="12" />
      <rect x="77" y="338" width="36" height="12" />
      <rect x="89" y="350" width="12" height="12" />
    </g>
  </svg>
</template>
