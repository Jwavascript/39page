/**
 * M12-2 — Now Playing 카드 (ADR 0032).
 *
 *   A. 자리 — 영상 바로 아래, 플레이어 위젯 안, 어댑터 소유 영역 밖. 같은 정보 · 버튼은 한 번만
 *   B. 내용 — 곡 그림(썸네일 → 기본) · 제목 · 상태 · 위치 · 조작 · 안내
 *   C. 영속성 — 테마 · 보관함 · 곡 바꾸기에서 iframe · 카드 노드가 그대로
 *   D. 배치 규칙 — 컨테이너 쿼리 · 보관함 띠 · 마스코트 없음 (소스 고정, jsdom 은 레이아웃이 없다)
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { nextTick } from 'vue'

import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import App from '@/app/App.vue'
import { MVP_DASHBOARD_LAYOUT } from '@/app/layout'
import { FakePlayerAdapter } from '@/features/playback/FakePlayerAdapter'
import { PLAYER_ADAPTER_FACTORY } from '@/features/playback/PlayerAdapter'
import { useLibraryStore } from '@/stores/library'
import { usePlaybackStore } from '@/stores/playback'
import { useThemeStore } from '@/stores/theme'

import { archiveCloseButton } from '../support/archiveClose'
import { installPlayerRect, uninstallPlayerRect } from '../support/playerLayout'

const VIDEOS = ['aaaaaaaaaaa', 'bbbbbbbbbbb'] as const

const read = (relative: string) => readFileSync(resolve(process.cwd(), relative), 'utf8')

beforeEach(() => {
  globalThis.localStorage.clear()
  delete document.documentElement.dataset.theme
  setActivePinia(createPinia())
  installPlayerRect()
})

afterEach(() => {
  uninstallPlayerRect()
  globalThis.localStorage.clear()
  delete document.documentElement.dataset.theme
  document.body.innerHTML = ''
})

function mountApp(withAdapter = true) {
  const fake = new FakePlayerAdapter()
  const wrapper = mount(App, {
    attachTo: document.body,
    global: withAdapter ? { provide: { [PLAYER_ADAPTER_FACTORY as symbol]: () => fake } } : {},
  })
  return { wrapper, fake }
}

type Wrapper = ReturnType<typeof mountApp>['wrapper']

async function setup() {
  const { wrapper, fake } = mountApp()
  const library = useLibraryStore()
  const created = await library.createPlaylist('CARD')
  const playlistId = created.ok ? created.playlistId : ''
  await library.addTrack(playlistId, { videoId: VIDEOS[0], title: 'First Song' })
  await library.addTrack(playlistId, { videoId: VIDEOS[1], title: 'Second Song' })
  await nextTick()
  return { wrapper, fake, playlistId }
}

async function playFirst(wrapper: Wrapper, fake: FakePlayerAdapter) {
  await wrapper.get('.now-playlist .track-row').trigger('click')
  await nextTick()
  fake.emitStateChange('playing')
  await nextTick()
}

describe('A. 자리 — 영상 바로 아래 한 장', () => {
  it('카드는 플레이어 위젯 안, 영상 상자 바로 다음 형제다', () => {
    const { wrapper } = mountApp()
    const player = wrapper.get('[data-widget="player"]').element
    const holder = wrapper.get('[data-widget="player"] .video-holder').element
    const card = wrapper.get('.now-playing-card').element

    expect(card.parentElement).toBe(player)
    expect(holder.nextElementSibling).toBe(card)
  })

  it('카드는 어댑터 소유 영역 밖이다 — 영상을 덮지 않는다', () => {
    const { wrapper, fake } = mountApp()
    const mountNode = wrapper.get('.player-mount').element
    const card = wrapper.get('.now-playing-card').element

    expect(mountNode.contains(card)).toBe(false)
    expect(fake.hostNode?.contains(card)).toBe(false)
  })

  it('곡 제목 · 재생 조작 · 상태 줄은 화면에 한 번만 있다 (영상 위에 남지 않는다)', () => {
    const { wrapper } = mountApp()

    expect(wrapper.findAll('.now-title')).toHaveLength(1)
    expect(wrapper.findAll('.action-row')).toHaveLength(1)
    expect(wrapper.findAll('[data-widget="player"] [role="status"]')).toHaveLength(1)
    // 영상 상자보다 앞에는 아무것도 없다 — 제목 · 조작이 영상 위에 오지 않는다.
    const surface = wrapper.get('.player-surface').element
    expect(surface.firstElementChild?.classList.contains('video-holder')).toBe(true)
  })

  it('마스코트 위젯이 없다 — 레이아웃 · DOM 모두', () => {
    const { wrapper } = mountApp()

    expect(MVP_DASHBOARD_LAYOUT.items.some((item) => String(item.widgetType) === 'mascot')).toBe(
      false,
    )
    expect(wrapper.find('[data-widget="mascot"]').exists()).toBe(false)
    expect(wrapper.find('.mascot-panel').exists()).toBe(false)
  })
})

describe('B. 내용', () => {
  it('곡이 없으면 안내 제목 · 기본 그림 · 꺼진 조작', () => {
    const { wrapper } = mountApp()

    expect(wrapper.get('.now-playing-card .now-title').text()).toBe('재생할 음악을 선택하세요')
    expect(
      wrapper.get('.now-playing-card [data-artwork-source]').attributes('data-artwork-source'),
    ).toBe('default')
    expect(wrapper.find('.now-playing-card .np-art img').exists()).toBe(false)
    for (const button of wrapper.findAll('.now-playing-card .round')) {
      expect(button.attributes('disabled')).toBeDefined()
    }
  })

  it('재생하면 제목 · 상태 · 그 곡의 썸네일이 카드에 선다', async () => {
    const { wrapper, fake } = await setup()
    await playFirst(wrapper, fake)

    const card = wrapper.get('.now-playing-card')
    expect(card.get('.now-title').text()).toBe('First Song')
    expect(card.get('.now-sub').text()).toContain('1 / 2')
    expect(card.get('.now-sub').text()).toContain('재생 중')
    expect(card.get('.np-art img').attributes('src')).toBe(
      `https://i.ytimg.com/vi/${VIDEOS[0]}/hqdefault.jpg`,
    )
    expect(card.get('.external').attributes('href')).toContain(VIDEOS[0])
  })

  it('재생 위치를 알면 지금 초를 적는다 — 길이는 추정하지 않는다', async () => {
    const { wrapper, fake } = await setup()
    fake.emitReady()
    await playFirst(wrapper, fake)
    fake.emitPosition(83)
    // 위치는 1초마다 묻는다 — 곡을 바꾸지 않고 다시 읽게 멈췄다 재생한다.
    fake.emitStateChange('paused')
    await nextTick()
    fake.emitStateChange('playing')
    await nextTick()

    expect(wrapper.get('.now-playing-card .now-position').text()).toBe('· 1:23')
    expect(wrapper.get('.now-playing-card .now-sub').text()).not.toContain('/ 1:')
  })

  it('다음 곡으로 가면 그림도 그 곡의 것으로 바뀐다', async () => {
    const { wrapper, fake } = await setup()
    await playFirst(wrapper, fake)
    await wrapper.get('.now-playing-card [aria-label="다음 곡"]').trigger('click')
    await nextTick()

    expect(wrapper.get('.now-playing-card .now-title').text()).toBe('Second Song')
    expect(wrapper.get('.now-playing-card .np-art img').attributes('src')).toContain(
      `/${VIDEOS[1]}/`,
    )
  })

  it('상태 안내는 비어 있으면 자리를 차지하지 않고, 경고는 경고 색이다', async () => {
    const { wrapper, fake } = await setup()
    const status = () => wrapper.get('.now-playing-card .status')

    await playFirst(wrapper, fake)
    expect(status().classes()).toContain('is-empty')

    fake.emitError({ kind: 'embed-not-allowed', code: 150 })
    await nextTick()
    expect(status().classes()).not.toContain('is-empty')
    expect(status().classes()).toContain('is-warning')
    expect(status().attributes('aria-live')).toBe('polite')
  })

  it('플레이어를 연결하지 못하면 카드가 그것을 경고로 알린다', () => {
    const { wrapper } = mountApp(false)

    expect(wrapper.get('.now-playing-card .status').text()).toBe('플레이어를 연결하지 못했습니다.')
    expect(wrapper.get('.now-playing-card .status').classes()).toContain('is-warning')
  })
})

describe('C. 영속성 — iframe · 카드 노드가 그대로', () => {
  it('테마를 바꿔도 플레이어 · 카드 · 그림 노드와 재생이 그대로다', async () => {
    const { wrapper, fake } = await setup()
    await playFirst(wrapper, fake)
    const mountNode = wrapper.get('.player-mount').element
    const card = wrapper.get('.now-playing-card').element
    const art = wrapper.get('.now-playing-card .artwork-image').element

    useThemeStore().setTheme('mono-vinyl')
    await nextTick()
    useThemeStore().setTheme('kawaii-synth-cassette')
    await nextTick()

    expect(wrapper.get('.player-mount').element).toBe(mountNode)
    expect(wrapper.get('.now-playing-card').element).toBe(card)
    expect(wrapper.get('.now-playing-card .artwork-image').element).toBe(art)
    expect(fake.calls.mount).toBe(1)
    expect(fake.calls.destroy).toBe(0)
    expect(usePlaybackStore().playerState).toBe('playing')
  })

  it('보관함을 열고 닫아도 같은 카드 인스턴스가 재생 띠에 선다 — 복제 · 새 마운트 없음', async () => {
    const { wrapper, fake } = await setup()
    await playFirst(wrapper, fake)
    const card = wrapper.get('.now-playing-card').element

    await wrapper.get('.app-nav button').trigger('click')
    await nextTick()
    expect(wrapper.findAll('.now-playing-card')).toHaveLength(1)
    expect(wrapper.get('.now-playing-card').element).toBe(card)

    await archiveCloseButton(wrapper).trigger('click')
    await nextTick()
    expect(wrapper.get('.now-playing-card').element).toBe(card)
    expect(fake.calls.mount).toBe(1)
    expect(usePlaybackStore().playerState).toBe('playing')
  })
})

describe('D. 배치 규칙 (소스)', () => {
  const card = read('src/features/playback/NowPlayingCard.vue')

  it('그림 크기는 카드가 받은 폭으로 정한다 — 148 · 112 · 88px', () => {
    expect(card).toContain('container: now-playing / inline-size')
    expect(card).toContain('--np-art-size: 148px')
    expect(card).toMatch(/@container now-playing \(max-width: 440px\)[^@]*--np-art-size: 112px/)
    expect(card).toMatch(/@container now-playing \(max-width: 330px\)[^@]*--np-art-size: 88px/)
    expect(card).toMatch(/\.np-art \{[^}]*aspect-ratio: 1;/)
  })

  it('긴 제목은 두 줄까지 — 줄임표로 끝난다', () => {
    expect(card).toMatch(/\.now-title \{[^}]*-webkit-line-clamp: 2;/)
    expect(card).toMatch(/\.now-title \{[^}]*overflow-wrap: anywhere;/)
  })

  it('보관함 띠: 넓으면 [영상 | 카드], 좁으면 영상 → 한 줄 카드(그림 없음)', () => {
    const surface = read('src/features/playback/PlayerSurface.vue')
    const compact = surface.slice(surface.lastIndexOf('<style>'))
    expect(compact).toContain("grid-template-areas: 'video card'")
    expect(card).toMatch(
      /\[data-archive-layout='strip'\] \.now-playing-card \.np-body \{[^}]*--np-art-size: 72px/,
    )
    expect(card).toContain("[data-archive-layout='stack'] .now-playing-card .np-art")
    expect(card).toContain("[data-archive-layout='side'] .now-playing-card .np-art")
  })

  it('카드는 플레이어를 부르지 않는다 — 명령은 코디네이터 (ADR 0009)', () => {
    // 어댑터 팩토리는 "있는가" 만 본다 — 만들거나 부르지 않는다.
    expect(card).not.toContain('createAdapter()')
    expect(card).not.toContain('YT.')
    expect(card).toContain('useTransport')
  })

  it('영상 템플릿에 조건부 렌더가 없다 (ADR 0002)', () => {
    const surface = read('src/features/playback/PlayerSurface.vue')
    const template = surface.slice(surface.indexOf('<template>'), surface.indexOf('</template>'))
    expect(template.replace(/<!--[\s\S]*?-->/g, '')).not.toContain('v-if')
  })
})
