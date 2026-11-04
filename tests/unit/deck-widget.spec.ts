import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { nextTick } from 'vue'

import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import App from '@/app/App.vue'
import DeckWidget from '@/features/deck/DeckWidget.vue'
import { FakePlayerAdapter } from '@/features/playback/FakePlayerAdapter'
import { PLAYER_ADAPTER_FACTORY } from '@/features/playback/PlayerAdapter'
import { useThemeStore } from '@/stores/theme'

function readSource(relative: string): string {
  return readFileSync(resolve(process.cwd(), relative), 'utf8')
}

/**
 * 주석을 지운 소스.
 *
 * 문서 주석에 `v-if`, `role="button"`, `url(#...)` 같은 설명이 들어 있으므로
 * 코드만 남겨 검사해야 한다.
 */
function readCode(relative: string): string {
  return readSource(relative)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\/.*$/gm, '')
}

/** 레퍼런스 HTML 에서 특정 class 로 시작하는 SVG 블록을 꺼낸다. */
function referenceSvg(file: string, rootClass: string): string {
  const html = readSource(`design/references/${file}`)
  const start = html.indexOf(`<svg class="${rootClass}"`)
  if (start === -1) throw new Error(`reference svg not found: ${rootClass}`)
  const end = html.indexOf('</svg>', start) + '</svg>'.length
  return html.slice(start, end)
}

/** `<defs>` 의 id. 테마별 접두사를 붙인 대상이다. */
const DEFS_IDS = [
  'chassis',
  'controlSilver',
  'discGrad',
  'platterGrad',
  'discGlint',
  'metalNoise',
  'deckShadow',
  'deckClip',
  'synthBody',
  'cassetteGlass',
  'tapeShell',
  'synthShadow',
]

/** 프로토타입 스크립트만 쓰던 id. 이식 시 제거했다. */
const SCRIPT_IDS = ['platter', 'hardwarePlay', 'deckIcon', 'cassetteDeck']

/**
 * 레퍼런스 SVG 에 **이식 시 의도한 변경만** 적용한다.
 *
 * 결과가 실제 이식 결과와 완전히 같아야 한다. 그래야 "의도한 차이 외에는
 * 아무것도 바뀌지 않았다" 를 증명할 수 있다. 좌표·색·속성 하나만 달라져도
 * 드러난다.
 */
function applyIntendedChanges(svg: string, prefix: string, rootClass: string): string {
  let out = svg
  for (const name of DEFS_IDS) {
    // tsconfig.vitest.json 의 lib 설정 때문에 replaceAll 타입이 없다.
    out = out.replace(new RegExp(`id="${name}"`, 'g'), `id="${prefix}-${name}"`)
    out = out.replace(new RegExp(`url\\(#${name}\\)`, 'g'), `url(#${prefix}-${name})`)
  }
  for (const name of SCRIPT_IDS) {
    out = out.replace(new RegExp(`\\s+id="${name}"`, 'g'), '')
  }
  out = out.replace(/\s+role="button"/g, '').replace(/\s+tabindex="0"/g, '')
  out = out.replace(/\s+data-speed-button="\d+"/g, '')

  // 내부 그룹의 aria-label 만 제거한다 (루트의 것은 남긴다).
  const headEnd = out.indexOf('>') + 1
  out = out.slice(0, headEnd) + out.slice(headEnd).replace(/\s+aria-label="[^"]*"/g, '')

  out = out.replace(/^<svg class="[^"]*"/, `<svg class="${rootClass}"`)
  out = out.replace(' xmlns="http://www.w3.org/2000/svg"', '')

  /*
   * M6: 테이프 릴의 배치와 회전을 **다른 요소로 분리한다.**
   *
   * 레퍼런스는 한 `<g>` 에 `transform="translate(...)"` 와 회전 클래스를 함께
   * 둔다. 개별 변환 속성(`rotate`)은 `transform` 속성보다 나중에 합성되므로
   * 최종 행렬이 `rotate × translate` 가 되고 **translate 된 위치가 회전한다.**
   * 릴이 제자리에서 돌지 않고 viewBox 원점을 중심으로 궤도를 그린다.
   *
   * 즉 이것은 레퍼런스에 있는 **버그**다. 실제 브라우저 검증에서 보고되어
   * 사용자 확인을 받고 고쳤다 (AGENTS.md 규칙 6). 좌표와 색은 그대로다 —
   * 그룹을 한 겹 나누는 것 말고는 아무것도 바뀌지 않는다.
   */
  const spoolSplit =
    /<g class="cassette-spool" transform="(translate\([^)]*\))">([\s\S]*?)<\/g>\s*<\/g>/g
  const before = out
  out = out.replace(spoolSplit, '<g transform="$1"><g class="cassette-spool">$2</g></g></g>')

  // 카세트에만 있는 변경이다. 적용되지 않았다면 레퍼런스 구조가 바뀐 것이다.
  if (rootClass.includes('kawaii-synth-cassette') && out === before) {
    throw new Error('레퍼런스에서 cassette-spool 그룹을 찾지 못했다')
  }

  return out
}

/** .vue 의 template 안에 있는 SVG. */
function portedSvg(relative: string): string {
  const source = readSource(relative)
  const start = source.indexOf('<template>') + '<template>'.length
  return source.slice(start, source.indexOf('</template>')).trim()
}

/**
 * 포맷 차이를 무시하고 내용만 비교한다.
 *
 * Prettier 가 `.vue` 를 다시 포맷하면서 공백을 세 군데 넣는다.
 * `/>` 앞, SVG 텍스트 노드의 앞뒤, 인라인 `style` 의 콜론 뒤다.
 * 세 가지 모두 렌더 결과를 바꾸지 않는다. 좌표·색·속성은 그대로 비교된다.
 */
function squash(svg: string): string {
  return (
    svg
      .replace(/\s+/g, ' ')
      // `<rect ... />` 의 닫는 공백
      .replace(/\s*\/>/g, '/>')
      .replace(/\s*>/g, '>')
      // `<text> 33 </text>` 처럼 텍스트 노드에 붙는 공백 (SVG 는 접어서 렌더한다)
      .replace(/>\s+/g, '>')
      .replace(/\s+</g, '<')
      // `style="stop-color: #c9c1b3"` 처럼 CSS 콜론 뒤에 붙는 공백
      .replace(/:\s+/g, ':')
      .trim()
  )
}

function mountAppWithFake() {
  const fake = new FakePlayerAdapter()
  const wrapper = mount(App, {
    attachTo: document.body,
    global: { provide: { [PLAYER_ADAPTER_FACTORY as symbol]: () => fake } },
  })
  return { wrapper, fake }
}

async function switchTheme(key: 'mono-vinyl' | 'kawaii-synth-cassette') {
  useThemeStore().setTheme(key)
  await nextTick()
}

beforeEach(() => {
  globalThis.localStorage.clear()
  delete document.documentElement.dataset.theme
  setActivePinia(createPinia())
})

afterEach(() => {
  globalThis.localStorage.clear()
  delete document.documentElement.dataset.theme
  document.body.innerHTML = ''
})

describe('A. 데크 렌더링', () => {
  it('1. Mono Vinyl SVG 가 렌더링된다', () => {
    const wrapper = mount(DeckWidget)
    const svg = wrapper.get('.deck-art--mono-vinyl')

    expect(svg.element.tagName.toLowerCase()).toBe('svg')
    expect(svg.attributes('viewBox')).toBe('0 0 900 570')
    expect(svg.attributes('role')).toBe('img')
    expect(svg.attributes('aria-label')).toContain('턴테이블')
  })

  it('2. Kawaii Synth Cassette SVG 가 렌더링된다', () => {
    const wrapper = mount(DeckWidget)
    const svg = wrapper.get('.deck-art--kawaii-synth-cassette')

    expect(svg.element.tagName.toLowerCase()).toBe('svg')
    expect(svg.attributes('viewBox')).toBe('0 0 900 570')
    expect(svg.attributes('role')).toBe('img')
    expect(svg.attributes('aria-label')).toContain('카세트')
  })

  it('3. 두 데크 아트가 동시에 DOM 에 존재한다', () => {
    const wrapper = mount(DeckWidget)

    expect(wrapper.findAll('svg.deck-art')).toHaveLength(2)

    // 데크 아트를 v-if 로 교체하지 않는다. CSS 로만 표시를 전환한다.
    // (M2-2의 열기 버튼은 주입 유무로 v-if 를 쓰므로 아트 줄만 본다.)
    const deckArtLines = readCode('src/features/deck/DeckWidget.vue')
      .split('\n')
      .filter((line) => line.includes('DeckArt'))
    expect(deckArtLines.length).toBeGreaterThan(0)
    expect(deckArtLines.filter((line) => line.includes('v-if'))).toEqual([])
  })

  it('4. 활성 테마의 데크만 접근성 트리에 노출된다', async () => {
    const wrapper = mount(DeckWidget)
    const mono = () => wrapper.get('.deck-art--mono-vinyl')
    const kawaii = () => wrapper.get('.deck-art--kawaii-synth-cassette')

    expect(mono().attributes('aria-hidden')).toBeUndefined()
    expect(kawaii().attributes('aria-hidden')).toBe('true')

    await switchTheme('kawaii-synth-cassette')

    expect(mono().attributes('aria-hidden')).toBe('true')
    expect(kawaii().attributes('aria-hidden')).toBeUndefined()
  })

  it('시각적 표시는 테마별 deck.css 가 전환한다', () => {
    // jsdom 은 외부 CSS 계산을 하지 않는다. 규칙 존재만 확인하고
    // 실제 표시 여부는 브라우저에서 검증한다.
    const mono = readSource('src/themes/mono-vinyl/deck.css')
    const kawaii = readSource('src/themes/kawaii-synth-cassette/deck.css')

    expect(mono).toContain('.deck-art--mono-vinyl {\n  display: block;')
    expect(mono).toContain(":root[data-theme='kawaii-synth-cassette'] .deck-art--mono-vinyl")
    expect(kawaii).toContain('.deck-art--kawaii-synth-cassette {\n  display: none;')
    expect(kawaii).toContain(
      ":root[data-theme='kawaii-synth-cassette'] .deck-art--kawaii-synth-cassette",
    )
  })

  it('5. SVG id 충돌이 없다', () => {
    const { wrapper } = mountAppWithFake()

    // 문서 전체의 id 가 중복되지 않아야 한다 (드로어 등 UI id 포함).
    const allIds = [...wrapper.element.querySelectorAll('[id]')].map((el) => el.id)
    expect(new Set(allIds).size).toBe(allIds.length)

    // SVG 안의 id 는 전부 테마 접두사를 가져야 한다.
    const svgIds = [...wrapper.element.querySelectorAll('svg [id]')].map((el) => el.id)
    expect(svgIds.length).toBeGreaterThan(0)

    const monoIds = svgIds.filter((id) => id.startsWith('mv-'))
    const kawaiiIds = svgIds.filter((id) => id.startsWith('ksc-'))
    expect(monoIds.length).toBeGreaterThan(0)
    expect(kawaiiIds.length).toBeGreaterThan(0)
    expect(monoIds.length + kawaiiIds.length).toBe(svgIds.length)
  })

  it('모든 url(#...) 참조가 존재하는 id 를 가리킨다', () => {
    for (const file of [
      'src/themes/mono-vinyl/DeckArt.vue',
      'src/themes/kawaii-synth-cassette/DeckArt.vue',
    ]) {
      const source = readCode(file)
      const defined = new Set([...source.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]))
      const referenced = [...source.matchAll(/url\(#([^)]+)\)/g)].map((m) => m[1])

      expect(referenced.length).toBeGreaterThan(0)
      expect(referenced.filter((ref) => !defined.has(ref))).toEqual([])
    }
  })

  it('6. 이식 결과가 레퍼런스와 완전히 일치한다 — Mono Vinyl', () => {
    const expected = applyIntendedChanges(
      referenceSvg('two-themes-v09.html', 'turntable'),
      'mv',
      'deck-art deck-art--mono-vinyl',
    )

    // 좌표·색·속성이 하나라도 달라지면 실패한다.
    expect(squash(portedSvg('src/themes/mono-vinyl/DeckArt.vue'))).toBe(squash(expected))
  })

  it('6. 이식 결과가 레퍼런스와 완전히 일치한다 — Kawaii Cassette', () => {
    const expected = applyIntendedChanges(
      referenceSvg('two-themes-v09.html', 'cassette-art'),
      'ksc',
      'deck-art deck-art--kawaii-synth-cassette',
    )

    expect(squash(portedSvg('src/themes/kawaii-synth-cassette/DeckArt.vue'))).toBe(squash(expected))
  })

  /*
   * M6 회귀 방지.
   *
   * 이 셋이 동시에 성립해야 릴이 제자리에서 돈다. 하나라도 깨지면 릴이
   * viewBox 원점을 중심으로 궤도를 그린다 (반지름 450·674).
   */
  it('회전하는 릴에는 자기 transform 이 없다 (M6: 궤도 버그 방지)', () => {
    const ported = portedSvg('src/themes/kawaii-synth-cassette/DeckArt.vue')

    const spoolTags = [...ported.matchAll(/<g[^>]*class="cassette-spool"[^>]*>/g)].map((m) => m[0])

    expect(spoolTags).toHaveLength(2)
    // transform 이 붙으면 rotate 가 그 translate 를 회전시킨다.
    expect(spoolTags.filter((tag) => tag.includes('transform'))).toEqual([])
  })

  it('릴의 배치는 바깥 그룹이 맡는다', () => {
    const ported = portedSvg('src/themes/kawaii-synth-cassette/DeckArt.vue')

    // 레퍼런스의 두 좌표가 바깥 그룹에 그대로 남아 있어야 한다.
    for (const pos of ['translate(310 327)', 'translate(589 327)']) {
      expect(ported).toContain(`<g transform="${pos}">`)
    }
  })

  it('회전 축이 릴 자신의 바운딩 박스 중심이다', () => {
    const css = readSource('src/themes/kawaii-synth-cassette/deck.css')

    // fill-box 가 아니면 viewBox 중심이 축이 되어 다시 궤도가 된다.
    expect(css).toContain('transform-box: fill-box')
    expect(css).toContain('transform-origin: center')
  })

  it('v08 과 v09 의 턴테이블 형태가 같다', () => {
    // Mono Vinyl 의 기준 문서는 v08 이다. v09 는 그 상위집합이며
    // 턴테이블 자체는 동일하다 (design/references/README.md).
    const v08 = readSource('design/references/mono-vinyl-v08.html')
    const ported = portedSvg('src/themes/mono-vinyl/DeckArt.vue')

    // 이식한 path 좌표가 v08 에도 그대로 있어야 한다.
    const paths = [...ported.matchAll(/\sd="([^"]+)"/g)].map((m) => m[1] ?? '')
    expect(paths.length).toBeGreaterThan(5)
    expect(paths.filter((d) => !v08.includes(d))).toEqual([])
  })

  it('원본과의 차이는 id 접두사·스크립트 id 제거·인터랙션 속성 제거뿐이다', () => {
    for (const file of [
      'src/themes/mono-vinyl/DeckArt.vue',
      'src/themes/kawaii-synth-cassette/DeckArt.vue',
    ]) {
      const source = readCode(file)
      // 동작하지 않는 버튼을 만들지 않는다.
      expect(source).not.toContain('role="button"')
      expect(source).not.toContain('tabindex')
      expect(source).not.toContain('data-speed-button')
      // 루트의 role="img" 는 남는다.
      expect(source.match(/role="img"/g)).toHaveLength(1)
    }
  })

  it('드로어가 없으면 열기 버튼과 안내 문구를 만들지 않는다', () => {
    const wrapper = mount(DeckWidget)

    expect(wrapper.findAll('.deck-open')).toHaveLength(0)
    expect(wrapper.find('[role="button"]').exists()).toBe(false)
    // "LP를 누르면 ..." 안내는 드로어가 주입됐을 때만 붙인다.
    expect(wrapper.text()).not.toContain('누르면')
  })

  /*
   * M6-6 에서 뒤집힌 테스트다.
   *
   * 이전에는 "데크에 버튼이 하나도 없다" 를 고정하고 있었다. 아트에 그려진
   * ▶ / ■ 가 동작하지 않았기 때문이고, 그 상태를 실기기 검증에서 사용자가
   * 두 번 지적했다 (`M6_PLAN.md` §5-a). 이제는 동작하므로 "버튼이 없다" 가
   * 아니라 **"있는 버튼은 전부 이름이 있고 동작한다"** 를 고정한다.
   */
  it('데크의 버튼은 트랜스포트 키뿐이고 모두 이름이 있다 (M6-6)', () => {
    const wrapper = mount(DeckWidget)
    const buttons = wrapper.findAll('button')

    // mono 토글 1개 + 카세트 ■ · ▶ 2개. 열기 버튼은 드로어가 없으니 빠진다.
    expect(buttons).toHaveLength(3)
    for (const button of buttons) {
      expect(button.classes()).toContain('deck-key')
      expect(button.element.tagName).toBe('BUTTON')
      expect(button.attributes('type')).toBe('button')
      expect(button.attributes('aria-label')).toBeTruthy()
      expect(button.attributes('role')).toBeUndefined()
    }
  })

  it('회전 중심을 승인된 값으로 유지한다', () => {
    const mono = readSource('src/themes/mono-vinyl/deck.css')
    const kawaii = readSource('src/themes/kawaii-synth-cassette/deck.css')

    expect(mono).toContain('transform-origin: 345px 281px')
    expect(kawaii).toContain('transform-origin: center')
  })

  it('애니메이션은 기본이 정지다 (M4-3)', () => {
    // 멈춘 데크를 재생 중인 것처럼 보이게 하지 않는다.
    for (const file of [
      'src/themes/mono-vinyl/deck.css',
      'src/themes/kawaii-synth-cassette/deck.css',
    ]) {
      const css = readSource(file)
      expect(css).toMatch(/animation:[^;]*infinite paused/)
      expect(css).toContain('animation-play-state: running')
      // 달리게 하는 선택자는 재생 중일 때만이다.
      expect(css).toMatch(/\.deck-widget\.is-playing[^{]*\{\s*animation-play-state: running/)
    }
  })

  it('애니메이션 길이를 모션 토큰으로 받는다', () => {
    // `prefers-reduced-motion` 이 토큰을 0s 로 바꿔 자동으로 멈춘다.
    const mono = readSource('src/themes/mono-vinyl/deck.css')
    const kawaii = readSource('src/themes/kawaii-synth-cassette/deck.css')

    expect(mono).toContain('var(--duration-spin-33)')
    expect(mono).toContain('var(--duration-tonearm)')
    expect(kawaii).toContain('var(--duration-spool)')
    // 하드코딩된 초 단위 값을 쓰지 않는다.
    for (const css of [mono, kawaii]) {
      expect(css).not.toMatch(/animation:[^;]*\d+(?:\.\d+)?s/)
    }
  })
})

describe('B. 테마 전환 안정성', () => {
  it('7. 테마 변경 전후 DeckWidget 루트 DOM 이 동일하다', async () => {
    const { wrapper } = mountAppWithFake()
    const root = wrapper.get('[data-instance-id="deck-main"]').element

    await switchTheme('kawaii-synth-cassette')
    await switchTheme('mono-vinyl')

    expect(wrapper.get('[data-instance-id="deck-main"]').element).toBe(root)
  })

  it('8. 테마 변경 전후 두 DeckArt 인스턴스가 유지된다', async () => {
    const { wrapper } = mountAppWithFake()
    const mono = wrapper.get('.deck-art--mono-vinyl').element
    const kawaii = wrapper.get('.deck-art--kawaii-synth-cassette').element

    for (const key of ['kawaii-synth-cassette', 'mono-vinyl', 'kawaii-synth-cassette'] as const) {
      await switchTheme(key)
    }

    expect(wrapper.get('.deck-art--mono-vinyl').element).toBe(mono)
    expect(wrapper.get('.deck-art--kawaii-synth-cassette').element).toBe(kawaii)
    expect(wrapper.findAll('svg.deck-art')).toHaveLength(2)
  })

  it('9. WidgetHost 인스턴스 ID 가 유지된다', async () => {
    const { wrapper } = mountAppWithFake()
    const ids = () =>
      wrapper.findAll('[data-instance-id]').map((n) => n.attributes('data-instance-id'))
    const before = ids()

    await switchTheme('kawaii-synth-cassette')

    expect(ids()).toEqual(before)
    expect(before).toEqual([
      'deck-main',
      'mascot-main',
      'clock-main',
      'weather-main',
      'player-main',
      'playlist-main',
    ])
  })

  it('10. 테마 전환 후 PlayerSurface DOM 이 동일하다', async () => {
    const { wrapper } = mountAppWithFake()
    const surface = wrapper.get('[data-instance-id="player-main"]').element
    const mountHost = wrapper.get('.player-mount').element

    await switchTheme('kawaii-synth-cassette')
    await switchTheme('mono-vinyl')

    expect(wrapper.get('[data-instance-id="player-main"]').element).toBe(surface)
    expect(wrapper.get('.player-mount').element).toBe(mountHost)
  })

  it('11 · 12. PlayerAdapter mount 추가 호출과 destroy 호출이 없다', async () => {
    const { fake } = mountAppWithFake()

    expect(fake.calls.mount).toBe(1)

    for (const key of ['kawaii-synth-cassette', 'mono-vinyl', 'kawaii-synth-cassette'] as const) {
      await switchTheme(key)
    }

    expect(fake.calls.mount).toBe(1)
    expect(fake.calls.destroy).toBe(0)
    expect(fake.isMounted).toBe(true)
  })

  it('데크·마스코트가 레이아웃이나 레지스트리를 테마별로 복제하지 않는다', async () => {
    const { wrapper } = mountAppWithFake()
    const host = wrapper.findComponent({ name: 'WidgetHost' })
    const layoutBefore = host.props('layout')

    await switchTheme('kawaii-synth-cassette')

    expect(host.props('layout')).toBe(layoutBefore)
  })
})
