<script setup lang="ts">
/**
 * Mono Vinyl 턴테이블 데크 아트.
 *
 * `design/references/mono-vinyl-v08.html 및 two-themes-v09.html (동일)`의 SVG를 **그대로 이식**했다.
 * 좌표·`viewBox`·형태·색을 바꾸지 않았다 (`AGENTS.md` 규칙 6).
 *
 * 원본과 달라진 점은 세 가지뿐이다.
 * 1. `<defs>`의 id 에 `mv-` 접두사를 붙였다. 두 데크 SVG 가 동시에 DOM 에
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
    class="deck-art deck-art--mono-vinyl"
    viewBox="0 0 900 570"
    role="img"
    aria-label="따뜻한 회갈색 금속 본체에 검은 음반과 은빛 톤암이 놓인 턴테이블"
  >
    <defs>
      <linearGradient id="mv-chassis" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" style="stop-color: #c9c1b3" />
        <stop offset="47%" style="stop-color: #a9a194" />
        <stop offset="100%" style="stop-color: #8c857b" />
      </linearGradient>
      <linearGradient id="mv-controlSilver" x1="0" x2="1" y1="0" y2="1">
        <stop stop-color="#f0eee8" />
        <stop offset=".5" stop-color="#afaca6" />
        <stop offset="1" stop-color="#777671" />
      </linearGradient>
      <radialGradient id="mv-discGrad" cx="31%" cy="25%">
        <stop stop-color="#232323" />
        <stop offset=".53" stop-color="#101112" />
        <stop offset=".84" stop-color="#111213" />
        <stop offset="1" stop-color="#030405" />
      </radialGradient>
      <radialGradient id="mv-platterGrad">
        <stop offset="89%" stop-color="#353638" />
        <stop offset="93%" stop-color="#c7c8c6" />
        <stop offset="96%" stop-color="#828482" />
        <stop offset="100%" stop-color="#2d2e30" />
      </radialGradient>
      <linearGradient id="mv-discGlint" x1="0" x2="1" y1="0" y2="1">
        <stop stop-color="#d9d9d9" stop-opacity=".17" />
        <stop offset=".28" stop-color="#d9d9d9" stop-opacity="0" />
        <stop offset=".65" stop-color="#d9d9d9" stop-opacity="0" />
        <stop offset="1" stop-color="#d9d9d9" stop-opacity=".06" />
      </linearGradient>
      <filter id="mv-metalNoise" x="0" y="0" width="100%" height="100%">
        <feTurbulence
          type="fractalNoise"
          baseFrequency=".46"
          numOctaves="2"
          seed="7"
          stitchTiles="stitch"
          result="noise"
        />
        <feColorMatrix in="noise" type="saturate" values="0" result="gray" />
        <feComponentTransfer in="gray"><feFuncA type="linear" slope=".09" /></feComponentTransfer>
      </filter>
      <filter id="mv-deckShadow" x="-20%" y="-20%" width="140%" height="160%">
        <feDropShadow dx="0" dy="11" stdDeviation="10" flood-color="#000" flood-opacity=".34" />
      </filter>
      <clipPath id="mv-deckClip"><rect x="22" y="15" width="856" height="535" rx="15" /></clipPath>
    </defs>
    <!-- real metal material and subtle, intentionally restrained detail -->
    <rect
      x="18"
      y="22"
      width="864"
      height="533"
      rx="17"
      fill="#3a3834"
      stroke="#48443e"
      stroke-width="3"
      filter="url(#mv-deckShadow)"
    />
    <rect
      x="22"
      y="15"
      width="856"
      height="535"
      rx="15"
      fill="url(#mv-chassis)"
      stroke="#d8d0c3"
      stroke-width="2"
    />
    <g clip-path="url(#mv-deckClip)">
      <rect x="22" y="15" width="856" height="535" filter="url(#mv-metalNoise)" opacity=".5" />
      <path d="M42 38 H858" stroke="#fff" stroke-opacity=".18" />
      <path d="M40 527 H861" stroke="#312e2a" stroke-opacity=".25" />
    </g>
    <!-- precision-machined platter -->
    <circle cx="345" cy="281" r="233" fill="#514e49" opacity=".5" />
    <circle
      cx="345"
      cy="281"
      r="225"
      fill="url(#mv-platterGrad)"
      stroke="#5f5e5a"
      stroke-width="2"
    />
    <circle cx="345" cy="281" r="213" fill="#0d0e0f" />
    <g class="platter">
      <circle
        cx="345"
        cy="281"
        r="207"
        fill="url(#mv-discGrad)"
        stroke="#363637"
        stroke-width="1"
      />
      <circle
        cx="345"
        cy="281"
        r="206"
        fill="none"
        stroke="#7c7c7c"
        stroke-opacity=".2"
        stroke-width="2"
      />
      <g fill="none">
        <circle
          cx="345"
          cy="281"
          r="192"
          stroke="#575859"
          stroke-opacity=".18"
          stroke-width="1.2"
        />
        <circle cx="345" cy="281" r="186" stroke="#6e7070" stroke-opacity=".12" stroke-width="1" />
        <circle
          cx="345"
          cy="281"
          r="178"
          stroke="#646666"
          stroke-opacity=".15"
          stroke-width="1.4"
        />
        <circle cx="345" cy="281" r="171" stroke="#494b4b" stroke-opacity=".21" stroke-width=".9" />
        <circle cx="345" cy="281" r="163" stroke="#656665" stroke-opacity=".18" stroke-width="1" />
        <circle
          cx="345"
          cy="281"
          r="156"
          stroke="#626362"
          stroke-opacity=".18"
          stroke-width="1.1"
        />
        <circle cx="345" cy="281" r="148" stroke="#686967" stroke-opacity=".16" stroke-width="1" />
        <circle cx="345" cy="281" r="141" stroke="#626363" stroke-opacity=".2" stroke-width=".8" />
        <circle cx="345" cy="281" r="134" stroke="#676969" stroke-opacity=".17" stroke-width=".9" />
        <circle
          cx="345"
          cy="281"
          r="127"
          stroke="#747575"
          stroke-opacity=".12"
          stroke-width="1.2"
        />
        <circle cx="345" cy="281" r="120" stroke="#676969" stroke-opacity=".14" stroke-width=".7" />
        <circle cx="345" cy="281" r="113" stroke="#626363" stroke-opacity=".15" stroke-width="1" />
        <circle cx="345" cy="281" r="105" stroke="#747575" stroke-opacity=".14" stroke-width=".8" />
        <circle cx="345" cy="281" r="96" stroke="#646565" stroke-opacity=".22" stroke-width="1" />
        <circle cx="345" cy="281" r="89" stroke="#676868" stroke-opacity=".23" stroke-width="1" />
        <circle cx="345" cy="281" r="78" stroke="#555657" stroke-opacity=".22" stroke-width="1.3" />
      </g>
      <path
        d="M165 179 A205 205 0 0 1 455 104"
        fill="none"
        stroke="#d8d7d1"
        stroke-opacity=".085"
        stroke-width="13"
      />
      <path
        d="M525 374 A205 205 0 0 1 247 458"
        fill="none"
        stroke="#d8d7d1"
        stroke-opacity=".035"
        stroke-width="16"
      />
      <circle cx="345" cy="281" r="64" fill="#b8b1a5" stroke="#58574f" stroke-width="3" />
      <circle cx="345" cy="281" r="60" fill="#e1d8c8" />
      <circle cx="345" cy="281" r="56" fill="none" stroke="#918b81" stroke-width=".7" />
      <circle cx="345" cy="281" r="43" fill="none" stroke="#a7a091" stroke-width=".6" />
      <text
        class="svg-mono"
        x="345"
        y="247"
        fill="#33322f"
        font-size="11"
        text-anchor="middle"
        letter-spacing="3"
      >
        M.L.F.
      </text>
      <path d="M315 270 H375" stroke="#757267" stroke-width=".8" />
      <text
        x="345"
        y="265"
        text-anchor="middle"
        font-size="19"
        font-family="Georgia,serif"
        letter-spacing="-1"
        fill="#33312d"
      >
        MONO
      </text>
      <text
        class="svg-mono"
        x="345"
        y="314"
        text-anchor="middle"
        font-size="8"
        letter-spacing="1.7"
        fill="#5b584f"
      >
        33 ⅓ · SIDE A
      </text>
      <circle cx="345" cy="281" r="4" fill="#6b675f" />
    </g>
    <!-- visual metallic hardware, fixed at right -->
    <circle cx="751" cy="121" r="29" fill="#6f6e68" stroke="#cfcbc2" stroke-width="1.5" />
    <circle
      cx="751"
      cy="121"
      r="23"
      fill="url(#mv-controlSilver)"
      stroke="#77736e"
      stroke-width="1"
    />
    <circle cx="751" cy="121" r="8" fill="#686762" stroke="#e1dbce" stroke-width="1" />
    <path d="M751 102 V91" stroke="#f5eee1" stroke-width="2" stroke-opacity=".7" />
    <g class="tonearm">
      <path
        d="M751 121 L754 310 Q754 329 738 334 L546 376"
        stroke="#302f2e"
        stroke-width="12"
        stroke-linecap="round"
        stroke-linejoin="round"
        fill="none"
        opacity=".42"
        transform="translate(2 4)"
      />
      <path
        d="M751 121 L754 310 Q754 329 738 334 L546 376"
        stroke="url(#mv-controlSilver)"
        stroke-width="8.5"
        stroke-linecap="round"
        stroke-linejoin="round"
        fill="none"
      />
      <path
        d="M751 121 L754 310 Q754 329 738 334 L546 376"
        stroke="#fff7e8"
        stroke-opacity=".43"
        stroke-width="1.6"
        stroke-linecap="round"
        stroke-linejoin="round"
        fill="none"
        transform="translate(-2 -1)"
      />
      <rect
        x="524"
        y="360"
        width="35"
        height="19"
        rx="3"
        fill="#292824"
        stroke="#9c958a"
        stroke-width="1"
        transform="rotate(-13 542 370)"
      />
      <path d="M528 375 l-4 10" stroke="#7c7972" stroke-width="2" />
    </g>
    <!-- lower surface: hardware controls deliberately sparse -->
    <text x="76" y="81" class="svg-mono" font-size="14" letter-spacing="2" fill="#3d3934">
      MONO VINYL
    </text>
    <text x="77" y="99" class="svg-mono" font-size="9" letter-spacing="1.5" fill="#59554e">
      DIRECT DRIVE / 01
    </text>
    <circle cx="76" cy="127" r="10" fill="#75716a" stroke="#d8d2c8" stroke-width="1.7" />
    <circle cx="76" cy="127" r="4.5" fill="#8c857b" />
    <circle cx="76" cy="159" r="3.7" class="mini-lamp" />
    <text x="89" y="162" class="svg-mono" fill="#4a463f" font-size="10" letter-spacing="1">
      POWER
    </text>
    <g class="deck-control">
      <circle
        class="hit-outline"
        cx="103"
        cy="478"
        r="30"
        fill="url(#mv-controlSilver)"
        stroke="#77746e"
        stroke-width="2"
      />
      <circle
        class="key-surface"
        cx="103"
        cy="478"
        r="22"
        fill="#aaa59b"
        stroke="#ebe5d9"
        stroke-width=".8"
      />
      <path d="M96 470 L111 478 L96 486 Z" fill="#302d28" />
      <circle cx="103" cy="478" r="36" fill="none" />
    </g>
    <text x="69" y="526" fill="#413e37" font-size="9" class="svg-mono" letter-spacing="1">
      START / STOP
    </text>
    <g class="deck-control speed33">
      <rect
        x="628"
        y="462"
        width="45"
        height="31"
        rx="3"
        class="key-surface"
        fill="#ded9ce"
        stroke="#756f66"
        stroke-width="1.3"
      />
      <text
        class="svg-mono"
        x="650.5"
        y="481.5"
        text-anchor="middle"
        fill="#34312d"
        font-size="12"
        font-weight="bold"
      >
        33
      </text>
    </g>
    <g class="deck-control speed45">
      <rect
        x="680"
        y="462"
        width="45"
        height="31"
        rx="3"
        class="key-surface"
        fill="#99938a"
        stroke="#756f66"
        stroke-width="1.3"
      />
      <text
        class="svg-mono"
        x="702.5"
        y="481.5"
        text-anchor="middle"
        fill="#34312d"
        font-size="12"
        font-weight="bold"
      >
        45
      </text>
    </g>
    <text class="svg-mono" x="628" y="509" font-size="8" fill="#514b44" letter-spacing="1">
      SPEED / RPM
    </text>
    <text
      class="svg-mono"
      x="820"
      y="519"
      font-size="9"
      fill="#514b44"
      letter-spacing="1.5"
      text-anchor="end"
    >
      ANALOG UNIT / MLF — 01
    </text>
  </svg>
</template>
