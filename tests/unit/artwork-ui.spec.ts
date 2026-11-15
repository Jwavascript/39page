/**
 * M12-3 — 앨범아트 설정 화면 · Now Playing 카드의 사용자 그림 (M12_CUSTOM_ARTWORK §3 · ARTWORK_DESIGN §5).
 *
 *   A. 입구 — 곡 "관리" → 🖼 앨범아트, 카드의 그림. 보관함 상세 칸 자리에 선다 (영상을 덮지 않는다)
 *   B. 저장 — 확정 뒤에만 "저장했습니다" · 카드가 바뀜 · 다른 곡 · 재생에 닿지 않음
 *   C. 실패 — 잘못된 파일 · 다른 탭 변경 · 곡 삭제 · 저장소 없음 — 이전 그림 그대로
 *   D. GIF — 움직임 정책 (모션 감소 · 멈춤 = 포스터로 바꿔 끼우기)
 *   E. Object URL 수명 — 바꾸면 이전 것을, 사라지면 모두 지운다
 */
import { nextTick } from 'vue'

import { flushPromises, mount } from '@vue/test-utils'
import { IDBFactory } from 'fake-indexeddb'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import App from '@/app/App.vue'
import { createArtworkRepository, openArtworkDb } from '@/features/artwork/artworkRepository'
import { ARTWORK_IMAGE_TOOLS } from '@/features/artwork/imageValidation'
import { ARTWORK_OBJECT_URLS } from '@/features/artwork/useTrackArtwork'
import { FakePlayerAdapter } from '@/features/playback/FakePlayerAdapter'
import { PLAYER_ADAPTER_FACTORY } from '@/features/playback/PlayerAdapter'
import { useArtworkStore } from '@/stores/artwork'
import { useLibraryStore } from '@/stores/library'
import { usePlaybackStore } from '@/stores/playback'
import { useThemeStore } from '@/stores/theme'

import {
  fakeImageTools,
  fileOf,
  gifBytes,
  pngBytes,
  recordingUrls,
} from '../support/artworkFixtures'
import { installPlayerRect, uninstallPlayerRect } from '../support/playerLayout'
import { openTrackManage } from '../support/trackManage'

const VIDEOS = ['aaaaaaaaaaa', 'bbbbbbbbbbb'] as const

let factory: IDBFactory
let urls: ReturnType<typeof recordingUrls>
let reducedMotion = false

beforeEach(() => {
  globalThis.localStorage.clear()
  delete document.documentElement.dataset.theme
  setActivePinia(createPinia())
  installPlayerRect()
  factory = new IDBFactory()
  urls = recordingUrls()
  reducedMotion = false
  vi.stubGlobal(
    'matchMedia',
    (query: string) =>
      ({
        matches: query.includes('prefers-reduced-motion') ? reducedMotion : false,
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      }) as unknown as MediaQueryList,
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
  uninstallPlayerRect()
  globalThis.localStorage.clear()
  delete document.documentElement.dataset.theme
  document.body.innerHTML = ''
})

async function setup(options: { tools?: ReturnType<typeof fakeImageTools> } = {}) {
  const library = useLibraryStore()
  const created = await library.createPlaylist('ART')
  const playlistId = created.ok ? created.playlistId : ''
  const one = await library.addTrack(playlistId, { videoId: VIDEOS[0], title: 'One' })
  const two = await library.addTrack(playlistId, { videoId: VIDEOS[1], title: 'Two' })
  const store = useArtworkStore()
  await store.init({ factory, channel: null })

  const fake = new FakePlayerAdapter()
  const wrapper = mount(App, {
    attachTo: document.body,
    global: {
      provide: {
        [PLAYER_ADAPTER_FACTORY as symbol]: () => fake,
        [ARTWORK_IMAGE_TOOLS as symbol]: options.tools ?? fakeImageTools(),
        [ARTWORK_OBJECT_URLS as symbol]: urls,
      },
    },
  })
  await nextTick()
  const key = (result: typeof one) => ({
    playlistId,
    trackId: result.ok ? (result.trackId ?? '') : '',
  })
  return { wrapper, fake, library, store, playlistId, keyOne: key(one), keyTwo: key(two) }
}

type Ctx = Awaited<ReturnType<typeof setup>>

async function playFirst({ wrapper, fake }: Ctx) {
  await wrapper.get('.now-playlist .track-row').trigger('click')
  await nextTick()
  fake.emitStateChange('playing')
  await nextTick()
}

async function openSettingsFromManage(ctx: Ctx, title: string) {
  await ctx.wrapper.get('.app-nav button').trigger('click')
  await nextTick()
  await openTrackManage(ctx.wrapper, title)
  await ctx.wrapper.get(`button[aria-label="${title} 앨범아트 설정"]`).trigger('click')
  await nextTick()
  await flushPromises()
}

async function pickFile(ctx: Ctx, file: File) {
  const input = ctx.wrapper.get('.artwork-settings input[type="file"]')
  Object.defineProperty(input.element, 'files', { value: [file], configurable: true })
  await input.trigger('change')
  await vi.waitFor(() => {
    expect(ctx.wrapper.text()).not.toContain('확인하는 중')
  })
  await flushPromises()
}

async function save(ctx: Ctx) {
  await ctx.wrapper.get('.artwork-settings .pill--primary').trigger('click')
  await vi.waitFor(() =>
    expect(ctx.wrapper.get('.artwork-settings').text()).not.toContain('저장하는 중'),
  )
  await flushPromises()
}

const status = (ctx: Ctx) => ctx.wrapper.get('.artwork-settings .settings-status')
const cardSource = (ctx: Ctx) =>
  ctx.wrapper.get('.now-playing-card [data-artwork-source]').attributes('data-artwork-source')

describe('A. 입구', () => {
  it('곡 "관리" → 🖼 앨범아트 — 보관함 상세 칸 자리에 설정이 서고, 닫으면 곡 목록으로', async () => {
    const ctx = await setup()
    await openSettingsFromManage(ctx, 'One')

    const settings = ctx.wrapper.get('#archive-panel .music-layout .artwork-settings')
    expect(settings.text()).toContain('One')
    expect(ctx.wrapper.get('#archive-panel .music-layout').classes()).toContain('is-artwork')
    expect(ctx.wrapper.find('[role="dialog"][aria-modal="true"] .artwork-settings').exists()).toBe(
      false,
    )

    await ctx.wrapper.get('.artwork-settings [aria-label="앨범아트 설정 닫기"]').trigger('click')
    await nextTick()
    expect(ctx.wrapper.find('.artwork-settings').exists()).toBe(false)
    expect(ctx.wrapper.get('#archive-panel .music-layout').classes()).not.toContain('is-artwork')
  })

  it('카드의 그림을 누르면 그 곡의 설정이 열린다 — 목록 밖 영상이면 누를 수 없다', async () => {
    const ctx = await setup()
    expect(ctx.wrapper.find('.np-art-edit').exists()).toBe(false) // 곡 없음
    await playFirst(ctx)

    await ctx.wrapper.get('.np-art-edit').trigger('click')
    await nextTick()
    await flushPromises()
    expect(ctx.wrapper.get('.artwork-settings').text()).toContain('One')
  })
})

describe('B. 저장', () => {
  it('파일을 고르면 미리보기만 — 저장을 눌러 확정된 뒤에 카드가 바뀐다', async () => {
    const ctx = await setup()
    await playFirst(ctx)
    await openSettingsFromManage(ctx, 'One')

    await pickFile(ctx, fileOf(pngBytes(1), 'cover.png'))
    expect(ctx.wrapper.findAll('.artwork-settings .preview')).toHaveLength(2)
    expect(ctx.wrapper.get('.artwork-settings').text()).toContain('320×320')
    expect(ctx.store.preferenceFor(ctx.keyOne)).toEqual({ mode: 'auto' })
    expect(cardSource(ctx)).not.toBe('custom')

    await save(ctx)
    expect(status(ctx).text()).toBe('저장했습니다.')
    expect(ctx.store.preferenceFor(ctx.keyOne).mode).toBe('custom')
    await vi.waitFor(() => expect(cardSource(ctx)).toBe('custom'))
    // 재생 · 큐는 그대로.
    expect(usePlaybackStore().playerState).toBe('playing')
    expect(usePlaybackStore().currentTrack?.title).toBe('One')
  })

  it('기본 그림 · 썸네일로 바꾸기 — 다른 곡에는 닿지 않는다', async () => {
    const ctx = await setup()
    await openSettingsFromManage(ctx, 'Two')
    await ctx.wrapper.get('.artwork-settings input[value="default"]').setValue(true)
    await save(ctx)
    expect(ctx.store.preferenceFor(ctx.keyTwo)).toEqual({ mode: 'default' })
    expect(ctx.store.preferenceFor(ctx.keyOne)).toEqual({ mode: 'auto' })

    await ctx.wrapper.get('.artwork-settings input[value="auto"]').setValue(true)
    await save(ctx)
    expect(ctx.store.preferenceFor(ctx.keyTwo)).toEqual({ mode: 'auto' })
  })

  it('테마를 바꿔도 사용자 그림은 그대로다', async () => {
    const ctx = await setup()
    await playFirst(ctx)
    await openSettingsFromManage(ctx, 'One')
    await pickFile(ctx, fileOf(pngBytes(1), 'cover.png'))
    await save(ctx)
    await vi.waitFor(() => expect(cardSource(ctx)).toBe('custom'))
    const src = ctx.wrapper.get('.now-playing-card .artwork-image__custom').attributes('src')

    useThemeStore().setTheme('mono-vinyl')
    await nextTick()
    expect(ctx.wrapper.get('.now-playing-card .artwork-image__custom').attributes('src')).toBe(src)
  })
})

describe('C. 실패해도 이전 그림이 남는다', () => {
  it('지원하지 않는 파일 — 이유를 보이고 아무것도 저장하지 않는다', async () => {
    const ctx = await setup()
    await openSettingsFromManage(ctx, 'One')
    await pickFile(
      ctx,
      fileOf('<svg xmlns="http://www.w3.org/2000/svg"/>', 'a.svg', 'image/svg+xml'),
    )
    expect(status(ctx).text()).toContain('PNG · JPEG · WebP · GIF')
    expect(status(ctx).classes()).toContain('is-warning')
    expect(ctx.wrapper.get('.artwork-settings .pill--primary').attributes('disabled')).toBeDefined()
    expect(ctx.store.usage.assets).toBe(0)
  })

  it('손상된 이미지 — 디코딩 실패를 알린다', async () => {
    const ctx = await setup({ tools: fakeImageTools({ failDecode: true }) })
    await openSettingsFromManage(ctx, 'One')
    await pickFile(ctx, fileOf(pngBytes(1), 'broken.png'))
    expect(status(ctx).text()).toContain('손상')
  })

  it('다른 탭이 먼저 바꿨으면 거절하고 다른 탭의 그림이 남는다', async () => {
    const ctx = await setup()
    await openSettingsFromManage(ctx, 'One')
    await pickFile(ctx, fileOf(pngBytes(1), 'mine.png'))

    // 다른 탭: 같은 데이터베이스에 먼저 기본 그림을 저장한다.
    const other = createArtworkRepository(await openArtworkDb(factory))
    await other.setPreference(ctx.keyOne, VIDEOS[0], { mode: 'default' }, 0, new Date())
    other.close()

    await save(ctx)
    expect(status(ctx).text()).toContain('다른 탭')
    expect(ctx.store.preferenceFor(ctx.keyOne)).toEqual({ mode: 'default' })
    expect(ctx.store.usage.assets).toBe(0)
  })

  it('설정 중에 곡이 지워졌으면 저장하지 않는다', async () => {
    const ctx = await setup()
    await openSettingsFromManage(ctx, 'One')
    await ctx.wrapper.get('.artwork-settings input[value="default"]').setValue(true)
    await ctx.library.removeTrack(ctx.keyOne.playlistId, ctx.keyOne.trackId)
    await nextTick()
    expect(ctx.wrapper.get('.artwork-settings').text()).toContain('지워졌습니다')
    expect(ctx.wrapper.get('.artwork-settings .pill--primary').attributes('disabled')).toBeDefined()
    expect(ctx.store.assignmentFor(ctx.keyOne)).toBeNull()
  })
})

describe('D. 움직이는 그림 (GIF)', () => {
  async function withGif() {
    const ctx = await setup()
    await playFirst(ctx)
    await openSettingsFromManage(ctx, 'One')
    await pickFile(ctx, fileOf(gifBytes(2), 'dance.gif'))
    await save(ctx)
    await vi.waitFor(() => expect(cardSource(ctx)).toBe('custom'))
    return ctx
  }

  it('카드에서 움직인다 — 멈추면 첫 프레임(포스터)으로 바꿔 끼운다', async () => {
    const ctx = await withGif()
    const img = () => ctx.wrapper.get('.now-playing-card .artwork-image__custom').attributes('src')
    const moving = img()
    const toggle = ctx.wrapper.get('.np-art-motion')
    expect(toggle.attributes('aria-label')).toBe('그림 움직임 멈춤')

    await toggle.trigger('click')
    expect(img()).not.toBe(moving)
    expect(ctx.wrapper.get('.np-art-motion').attributes('aria-pressed')).toBe('true')

    await ctx.wrapper.get('.np-art-motion').trigger('click')
    expect(img()).toBe(moving)
  })

  it('모션 감소 환경에서는 처음부터 포스터다', async () => {
    reducedMotion = true
    const ctx = await withGif()
    expect(ctx.wrapper.get('.np-art-motion').attributes('aria-label')).toBe('그림 움직임 다시 재생')
    const view = ctx.wrapper.get('.now-playing-card .artwork-image__custom').attributes('src')
    await ctx.wrapper.get('.np-art-motion').trigger('click')
    expect(ctx.wrapper.get('.now-playing-card .artwork-image__custom').attributes('src')).not.toBe(
      view,
    )
  })
})

describe('E. Object URL 수명', () => {
  it('그림을 바꾸면 이전 URL 을 지우고, 앱이 사라지면 남은 URL 이 없다', async () => {
    const ctx = await setup()
    await playFirst(ctx)
    await openSettingsFromManage(ctx, 'One')
    await pickFile(ctx, fileOf(pngBytes(1), 'a.png'))
    await save(ctx)
    await vi.waitFor(() => expect(cardSource(ctx)).toBe('custom'))
    await pickFile(ctx, fileOf(pngBytes(2), 'b.png'))
    await save(ctx)
    await vi.waitFor(() => expect(ctx.store.usage.assets).toBe(1))
    await flushPromises()

    expect(urls.created).toBeGreaterThan(0)
    ctx.wrapper.unmount()
    expect(urls.live.size).toBe(0)
    expect(urls.revoked).toBe(urls.created)
  })
})

describe('M12-6A — 편집 세션과 미리보기', () => {
  it('라디오 선택은 저장 전 미리보기만 바꾸고, 닫았다 열면 기본 목록 화면과 저장값으로 돌아온다', async () => {
    const ctx = await setup()
    await playFirst(ctx)
    await openSettingsFromManage(ctx, 'One')
    await ctx.wrapper.get('.artwork-settings input[value="default"]').setValue(true)
    expect(
      ctx.wrapper.get('.preview--draft [data-artwork-source]').attributes('data-artwork-source'),
    ).toBe('default')
    expect(ctx.store.preferenceFor(ctx.keyOne)).toEqual({ mode: 'auto' })
    await ctx.wrapper.get('.strip-close').trigger('click')
    await flushPromises()
    expect(ctx.wrapper.find('.artwork-settings').exists()).toBe(false)
    await ctx.wrapper.get('.app-nav button').trigger('click')
    await flushPromises()
    expect(ctx.wrapper.get('.music-layout').attributes('data-step')).toBe('lists')
    expect(ctx.wrapper.find('.artwork-settings').exists()).toBe(false)
    await ctx.wrapper.get('.np-art-edit').trigger('click')
    await flushPromises()
    expect((ctx.wrapper.get('input[value="auto"]').element as HTMLInputElement).checked).toBe(true)
    expect(ctx.wrapper.get('.artwork-settings .pill--primary').attributes('disabled')).toBeDefined()
    expect(usePlaybackStore().currentTrack?.title).toBe('One')
  })

  it('미저장 업로드는 확인에서 계속 편집하면 유지되고, 폐기하면 URL과 파일이 정리된다', async () => {
    const ctx = await setup()
    await openSettingsFromManage(ctx, 'One')
    await pickFile(ctx, fileOf(pngBytes(1), 'draft.png'))
    await ctx.wrapper.get('.strip-close').trigger('click')
    await nextTick()
    expect(ctx.wrapper.find('.discard-confirm').exists()).toBe(true)
    await ctx.wrapper.get('#archive-keep-editing').trigger('click')
    await flushPromises()
    expect(ctx.wrapper.find('.artwork-settings').exists()).toBe(true)
    await ctx.wrapper.get('.strip-close').trigger('click')
    await nextTick()
    await ctx.wrapper.get('.discard-confirm button:last-child').trigger('click')
    await flushPromises()
    expect(ctx.wrapper.find('.artwork-settings').exists()).toBe(false)
    expect(urls.live.size).toBe(0)
    expect(ctx.store.usage.assets).toBe(0)
    expect(ctx.store.preferenceFor(ctx.keyOne)).toEqual({ mode: 'auto' })
  })
})
