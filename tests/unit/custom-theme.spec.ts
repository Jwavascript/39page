/**
 * ADR 0045 — 커스텀 테마: 다섯 색 · 데크 그림 · 설정 창 · 데크 · 백업 · 공유 카드.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { nextTick } from 'vue'

import { IDBFactory } from 'fake-indexeddb'
import { flushPromises, mount } from '@vue/test-utils'
import { strFromU8, unzipSync } from 'fflate'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import ThemeSwitcher from '@/components/ui/ThemeSwitcher.vue'
import { ARTWORK_IMAGE_TOOLS, validateArtwork } from '@/features/artwork/imageValidation'
import { createBackup } from '@/features/backup/createBackup'
import { createFullBackupZip, readFullBackupZip } from '@/features/backup/fullBackup'
import { readBackup } from '@/features/backup/readBackup'
import { buildShareCard } from '@/features/backup/shareCard'
import { customCardPalette, KAWAII_CARD_PALETTE } from '@/features/backup/shareCardPalette'
import CustomThemeDialog from '@/features/custom-theme/CustomThemeDialog.vue'
import { createDeckImageRepository, openThemeDb } from '@/features/custom-theme/deckImageRepository'
import DeckWidget from '@/features/deck/DeckWidget.vue'
import { STORAGE_KEYS } from '@/shared/storage'
import {
  CUSTOM_THEME_DIALOG,
  DEFAULT_CUSTOM_COLORS,
  readCustomThemeSettings,
  type CustomThemeColors,
} from '@/shared/types/customTheme'
import { contrastRatio, mixHex, readableOn } from '@/shared/utils/color'
import {
  CUSTOM_THEME_STORAGE_VERSION,
  deckWriteFromArtwork,
  useCustomThemeStore,
} from '@/stores/customTheme'
import { usePlaybackStore } from '@/stores/playback'
import { useThemeStore } from '@/stores/theme'
import { customThemeWarnings } from '@/themes/custom/palette'

import {
  fakeImageTools,
  fileOf,
  gifBytes,
  pngBytes,
  recordingUrls,
} from '../support/artworkFixtures'
import { useNodeBlobs } from '../support/transferHarness'

const PINK: CustomThemeColors = {
  background: '#101820',
  surface: '#1c2a36',
  text: '#f4f1ea',
  accent: '#ff6fa8',
  line: '#3d5566',
}

const css = (name: string) => document.documentElement.style.getPropertyValue(name)

async function validated(bytes = pngBytes(3)) {
  const result = await validateArtwork(fileOf(bytes, 'deck.png'), fakeImageTools())
  if (!result.ok) throw new Error(result.reason)
  return result.artwork
}

let factory: IDBFactory
let urls: ReturnType<typeof recordingUrls>

beforeEach(() => {
  useNodeBlobs()
  localStorage.clear()
  document.documentElement.removeAttribute('style')
  factory = new IDBFactory()
  urls = recordingUrls()
  vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => urls.create(blob as Blob))
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation((url) => urls.revoke(url))
  setActivePinia(createPinia())
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  localStorage.clear()
  document.documentElement.removeAttribute('style')
})

describe('A. 색 계산 · 검증', () => {
  it('대비 · 섞기 · 읽히는 글자색', () => {
    expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 5)
    expect(mixHex('#000000', '#ffffff', 0.5)).toBe('#808080')
    expect(readableOn('#ffb347')).toBe('#111111')
    expect(readableOn('#1a1a40')).toBe('#ffffff')
  })

  it('다섯 색이 모두 #rrggbb 여야 한다 — 대문자는 소문자로, 모르는 필드는 버린다', () => {
    expect(readCustomThemeSettings({ colors: { ...PINK, accent: '#FF6FA8' }, extra: 1 })).toEqual({
      colors: PINK,
    })
    expect(readCustomThemeSettings({ colors: { ...PINK, line: 'red' } })).toBeNull()
    expect(readCustomThemeSettings({ colors: { background: '#000000' } })).toBeNull()
    expect(readCustomThemeSettings(null)).toBeNull()
  })

  it('읽히지 않는 조합을 알린다 (글자 4.5:1 · 강조 3:1)', () => {
    expect(customThemeWarnings(DEFAULT_CUSTOM_COLORS)).toEqual([])
    const bad = customThemeWarnings({ ...PINK, text: '#26323d', accent: '#1f2b36' })
    expect(bad.map((warning) => warning.id)).toEqual([
      'text-background',
      'text-surface',
      'accent-background',
      'accent-surface',
    ])
    expect(bad[0]?.message).toMatch(/대비가 \d\.\d:1/)
  })
})

describe('B. 색 저장 · 적용', () => {
  it('처음에는 기본 색을 문서 루트에 걸고 저장소에 쓰지 않는다', () => {
    const store = useCustomThemeStore()
    expect(store.restore()).toBe('empty')
    expect(css('--custom-accent')).toBe(DEFAULT_CUSTOM_COLORS.accent)
    expect(css('--custom-on-accent')).toBe('#111111')
    expect(localStorage.getItem(STORAGE_KEYS.customTheme)).toBeNull()
  })

  it('저장하면 봉투로 쓰고, 다시 읽으면 같은 색이다', () => {
    const store = useCustomThemeStore()
    expect(store.setColors(PINK)).toBe(true)
    expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.customTheme) ?? '')).toEqual({
      version: CUSTOM_THEME_STORAGE_VERSION,
      data: { colors: PINK },
    })
    expect(css('--custom-background')).toBe(PINK.background)

    setActivePinia(createPinia())
    document.documentElement.removeAttribute('style')
    const reloaded = useCustomThemeStore()
    expect(reloaded.restore()).toBe('stored')
    expect(reloaded.saved).toEqual(PINK)
    expect(css('--custom-text')).toBe(PINK.text)
  })

  it('미리보기는 저장하지 않고 걸었다가, 거두면 저장된 색으로 돌아간다', () => {
    const store = useCustomThemeStore()
    store.restore()
    store.previewColors(PINK)
    expect(css('--custom-accent')).toBe(PINK.accent)
    expect(localStorage.getItem(STORAGE_KEYS.customTheme)).toBeNull()
    store.previewColors(null)
    expect(css('--custom-accent')).toBe(DEFAULT_CUSTOM_COLORS.accent)
  })

  it('손상된 저장값은 기본 색으로 보이고 덮어쓰지 않는다', () => {
    const raw = JSON.stringify({ version: 1, data: { colors: { background: 'x' } } })
    localStorage.setItem(STORAGE_KEYS.customTheme, raw)
    const store = useCustomThemeStore()
    expect(store.restore()).toBe('invalid')
    expect(store.saved).toEqual(DEFAULT_CUSTOM_COLORS)
    expect(localStorage.getItem(STORAGE_KEYS.customTheme)).toBe(raw)
  })

  it('테마 전환은 색을 바꾸지 않고, 색 저장은 테마 선택을 쓰지 않는다', () => {
    const store = useCustomThemeStore()
    const theme = useThemeStore()
    store.setColors(PINK)
    theme.setTheme('custom')
    expect(document.documentElement.dataset.theme).toBe('custom')
    theme.setTheme('mono-vinyl')
    expect(css('--custom-accent')).toBe(PINK.accent)
    const themeRaw = localStorage.getItem(STORAGE_KEYS.theme)
    store.setColors({ ...PINK, accent: '#00ff88' })
    expect(localStorage.getItem(STORAGE_KEYS.theme)).toBe(themeRaw)
  })

  it('index.html 이 첫 그림 전에 저장된 색을 건다 (형식이 맞는 것만)', () => {
    const html = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8')
    const script = /<script>([\s\S]*?)<\/script>/.exec(html)?.[1] ?? ''
    localStorage.setItem(STORAGE_KEYS.theme, JSON.stringify({ version: 1, data: 'custom' }))
    localStorage.setItem(
      STORAGE_KEYS.customTheme,
      JSON.stringify({ version: 1, data: { colors: { ...PINK, line: 'url(x)' } } }),
    )
    new Function(script)()
    expect(document.documentElement.dataset.theme).toBe('custom')
    expect(css('--custom-accent')).toBe(PINK.accent)
    expect(css('--custom-line')).toBe('')
  })
})

describe('C. 데크 그림 저장소', () => {
  it('쓰고 · 읽고 · 지운다. 수정 번호가 다르면 conflict', async () => {
    const repo = createDeckImageRepository(await openThemeDb(factory))
    expect(await repo.read()).toBeNull()
    const write = deckWriteFromArtwork(await validated())
    const first = await repo.write(write, 0, new Date('2026-11-22T00:00:00Z'))
    expect(first.ok && first.record?.revision).toBe(1)
    expect((await repo.read())?.assetId).toBe(write.assetId)
    expect(await repo.write(write, 0, new Date())).toEqual({ ok: false, reason: 'conflict' })
    expect((await repo.write(null, 1, new Date())).ok).toBe(true)
    expect(await repo.read()).toBeNull()
  })

  it('잘못된 표시 설정은 아무것도 쓰지 않는다', async () => {
    const repo = createDeckImageRepository(await openThemeDb(factory))
    const write = deckWriteFromArtwork(await validated())
    const result = await repo.write(
      { ...write, display: { ...write.display, zoom: 9 } },
      0,
      new Date(),
    )
    expect(result).toEqual({ ok: false, reason: 'failed' })
    expect(await repo.read()).toBeNull()
  })

  it('store — 저장 뒤 blob: 주소, 다른 탭은 알림으로 다시 읽는다, 바꾸면 옛 주소를 돌려준다', async () => {
    const left = {
      onmessage: null as ((event: MessageEvent) => void) | null,
      postMessage: (m: unknown) => right.onmessage?.({ data: m } as MessageEvent),
    }
    const right = {
      onmessage: null as ((event: MessageEvent) => void) | null,
      postMessage: (m: unknown) => left.onmessage?.({ data: m } as MessageEvent),
    }
    const a = useCustomThemeStore()
    await a.initDeck({ factory, channel: left })
    setActivePinia(createPinia())
    const b = useCustomThemeStore()
    await b.initDeck({ factory, channel: right })
    expect(a.deckStatus).toBe('ready')

    expect((await a.writeDeck(deckWriteFromArtwork(await validated(pngBytes(1))))).ok).toBe(true)
    expect(a.deckSrc).toMatch(/^blob:test\//)
    await flushPromises()
    await vi.waitFor(() => expect(b.deck?.assetId).toBe(a.deck?.assetId))

    const before = a.deckSrc
    await a.writeDeck(deckWriteFromArtwork(await validated(pngBytes(2))))
    expect(a.deckSrc).not.toBe(before)
    expect(urls.live.has(before ?? '')).toBe(false)
  })

  it('저장소를 열 수 없으면 unavailable — 쓰기는 거절된다', async () => {
    const store = useCustomThemeStore()
    await store.initDeck({ factory: undefined as unknown as IDBFactory, channel: null })
    // 인자로 undefined 를 주면 브라우저의 indexedDB 를 쓴다 — jsdom 에는 없다.
    expect(store.deckStatus).toBe('unavailable')
    expect(await store.writeDeck(null)).toEqual({ ok: false, reason: 'unavailable' })
  })
})

describe('D. 데크 · 테마 전환 단추', () => {
  it('커스텀 테마일 때만 헤더에 설정(팔레트) 단추가 있고, 누르면 설정 창 입구를 부른다', async () => {
    const open = vi.fn<() => void>()
    const theme = useThemeStore()
    const wrapper = mount(ThemeSwitcher, {
      global: { provide: { [CUSTOM_THEME_DIALOG as symbol]: { open } } },
    })
    expect(wrapper.find('.custom-settings').exists()).toBe(false)
    theme.setTheme('custom')
    await nextTick()
    const button = wrapper.get('.custom-settings')
    expect(button.attributes('aria-label')).toBe('커스텀 테마 설정')
    await button.trigger('click')
    expect(open).toHaveBeenCalledOnce()
  })

  it('빈 커스텀 데크 — 저장소를 읽은 뒤 "이미지 넣기" 가 설정 창을 연다', async () => {
    const open = vi.fn<() => void>()
    const store = useCustomThemeStore()
    const wrapper = mount(DeckWidget, {
      global: { provide: { [CUSTOM_THEME_DIALOG as symbol]: { open } } },
    })
    expect(wrapper.find('.deck-add-image').exists()).toBe(false)
    await store.initDeck({ factory, channel: null })
    await nextTick()
    await wrapper.get('.deck-add-image').trigger('click')
    expect(open).toHaveBeenCalledOnce()
    expect(wrapper.get('.deck-art--custom').attributes('data-deck-image')).toBe('empty')
  })

  it('움짤은 재생 중에만 움직인다 — 멈추면 첫 프레임(포스터)', async () => {
    const store = useCustomThemeStore()
    await store.initDeck({ factory, channel: null })
    await store.writeDeck(deckWriteFromArtwork(await validated(gifBytes(3, 4))))
    const wrapper = mount(DeckWidget)
    await nextTick()
    const art = () => wrapper.get('.deck-art--custom')
    expect(store.deck?.animated).toBe(true)
    expect(art().attributes('data-deck-image')).toBe('poster')
    expect(art().get('img').attributes('src')).toBe(store.deckPosterSrc)
    usePlaybackStore().setPlayerState('playing')
    await nextTick()
    expect(art().attributes('data-deck-image')).toBe('image')
    expect(art().get('img').attributes('src')).toBe(store.deckSrc)
    expect(wrapper.find('.deck-add-image').exists()).toBe(false)
  })

  it('커스텀 데크의 ■ · ▶ 는 보이는 단추이고 이름이 있다. 비활성 테마의 아트는 보조기기에서 숨는다', async () => {
    const wrapper = mount(DeckWidget)
    const keys = wrapper.findAll('.deck-custom-keys button')
    expect(keys.map((key) => key.text())).toEqual(['■', '▶'])
    for (const key of keys) expect(key.attributes('aria-label')).toBeTruthy()
    expect(wrapper.get('.deck-art--custom').attributes('aria-hidden')).toBe('true')
    useThemeStore().setTheme('custom')
    await nextTick()
    expect(wrapper.get('.deck-art--custom').attributes('aria-hidden')).toBeUndefined()
  })
})

describe('D-2. 데크 표시 전환 (CSS)', () => {
  const read = (file: string) => readFileSync(resolve(process.cwd(), file), 'utf8')

  it('커스텀 테마에서는 LP · 카세트 아트가 숨고 커스텀 틀만 보인다', () => {
    // LP 는 data-theme 가 없을 때의 바탕이라 기본 표시다 — 다른 테마마다 숨겨야 한다.
    expect(read('src/themes/mono-vinyl/deck.css')).toMatch(
      /:root\[data-theme='custom'\] \.deck-art--mono-vinyl \{\s*display: none/,
    )
    expect(read('src/themes/kawaii-synth-cassette/deck.css')).toMatch(
      /\.deck-art--kawaii-synth-cassette \{\s*display: none/,
    )
    const custom = read('src/themes/custom/deck.css')
    expect(custom).toMatch(/\.deck-art--custom \{[^}]*display: none/)
    expect(custom).toMatch(/:root\[data-theme='custom'\] \.deck-art--custom \{\s*display: block/)
  })
})

describe('E. 설정 창', () => {
  async function openDialog() {
    const store = useCustomThemeStore()
    store.restore()
    await store.initDeck({ factory, channel: null })
    const wrapper = mount(CustomThemeDialog, {
      attachTo: document.body,
      global: { provide: { [ARTWORK_IMAGE_TOOLS as symbol]: fakeImageTools() } },
    })
    await flushPromises()
    return { store, wrapper }
  }

  async function chooseFile(
    wrapper: Awaited<ReturnType<typeof openDialog>>['wrapper'],
    file: File,
  ) {
    const input = wrapper.get('input[type="file"]')
    Object.defineProperty(input.element, 'files', { value: [file], configurable: true })
    await input.trigger('change')
    // 해시(Web Crypto)가 끝날 때까지 — 읽는 중 표시가 꺼지면 검증이 끝났다.
    await vi.waitFor(() =>
      expect(wrapper.get('[data-custom-save]').attributes('disabled')).toBeUndefined(),
    )
    await flushPromises()
  }

  it('고르는 색은 저장 전에 화면 전체에 보이고, 닫으면(취소) 되돌아간다', async () => {
    const { store, wrapper } = await openDialog()
    const accent = wrapper.get('[data-custom-color="accent"]')
    await accent.setValue('#00ff88')
    expect(css('--custom-accent')).toBe('#00ff88')
    expect(localStorage.getItem(STORAGE_KEYS.customTheme)).toBeNull()
    await wrapper.findAll('.dialog-foot .pill')[0]?.trigger('click')
    expect(wrapper.emitted('close')).toHaveLength(1)
    wrapper.unmount()
    expect(css('--custom-accent')).toBe(DEFAULT_CUSTOM_COLORS.accent)
    expect(store.saved).toEqual(DEFAULT_CUSTOM_COLORS)
  })

  it('그림을 고르고 저장하면 그림과 색이 함께 저장된다', async () => {
    const { store, wrapper } = await openDialog()
    await chooseFile(wrapper, fileOf(pngBytes(7), 'me.png'))
    expect(wrapper.get('[data-custom-preview] img').attributes('src')).toMatch(/^blob:test\//)
    await wrapper.get('[data-custom-color="background"]').setValue('#202020')
    await wrapper.get('[data-custom-save]').trigger('click')
    await vi.waitFor(() => expect(wrapper.emitted('close')).toHaveLength(1))
    expect(store.deck?.revision).toBe(1)
    expect(store.saved.background).toBe('#202020')
    expect(
      JSON.parse(localStorage.getItem(STORAGE_KEYS.customTheme) ?? '{}').data.colors.background,
    ).toBe('#202020')
    wrapper.unmount()
  })

  it('지원하지 않는 파일은 알리고 아무것도 바꾸지 않는다', async () => {
    const { store, wrapper } = await openDialog()
    await chooseFile(wrapper, fileOf('<svg></svg>', 'x.svg', 'image/svg+xml'))
    expect(wrapper.get('[role="alert"]').text()).toMatch(/PNG · JPEG · WebP · GIF/)
    expect(wrapper.find('[data-custom-preview] img').exists()).toBe(false)
    expect(store.deck).toBeNull()
    wrapper.unmount()
  })

  it('그 사이 다른 탭이 그림을 바꿨으면 저장하지 않고 알린다', async () => {
    const { store, wrapper } = await openDialog()
    await chooseFile(wrapper, fileOf(pngBytes(8), 'a.png'))
    // 다른 탭의 쓰기 — 같은 데이터베이스, 수정 번호가 1 이 된다.
    const other = createDeckImageRepository(await openThemeDb(factory))
    await other.write(deckWriteFromArtwork(await validated(pngBytes(9))), 0, new Date())
    await wrapper.get('[data-custom-save]').trigger('click')
    await vi.waitFor(() => expect(wrapper.find('[role="alert"]').exists()).toBe(true))
    expect(wrapper.emitted('close')).toBeUndefined()
    expect(wrapper.get('[role="alert"]').text()).toMatch(/다른 탭/)
    expect(store.deck?.revision).toBe(1)
    wrapper.unmount()
  })

  it('그림을 빼고 저장하면 지워진다. 대비가 낮으면 알린다', async () => {
    const { store, wrapper } = await openDialog()
    await store.writeDeck(deckWriteFromArtwork(await validated(pngBytes(5))))
    wrapper.unmount()
    const { wrapper: again } = await openDialog()
    await again.get('[data-custom-color="text"]').setValue('#1c1c24')
    expect(again.get('.warnings').text()).toMatch(/글자와 배경/)
    await again.get('[data-custom-remove]').trigger('click')
    await again.get('[data-custom-save]').trigger('click')
    await vi.waitFor(() => expect(again.emitted('close')).toHaveLength(1))
    expect(store.deck).toBeNull()
    again.unmount()
  })
})

describe('F. 백업', () => {
  it('JSON 백업에 색이 들어가고, 읽으면 돌아온다. 잘못된 색은 경고로 건너뛴다', () => {
    const file = createBackup({
      library: { playlists: [], selectedPlaylistId: null },
      moments: [],
      theme: 'custom',
      customTheme: { colors: PINK },
      integrity: null,
      exportedAt: new Date('2026-11-22T00:00:00Z'),
    })
    expect(file.data.preferences?.customTheme).toEqual({ version: 1, data: { colors: PINK } })
    const read = readBackup(JSON.stringify(file))
    expect(read.ok && read.theme).toBe('custom')
    expect(read.ok && read.customTheme).toEqual({ colors: PINK })

    const broken = JSON.parse(JSON.stringify(file)) as typeof file
    ;(broken.data.preferences!.customTheme!.data.colors as { text: string }).text = 'white'
    const again = readBackup(JSON.stringify(broken))
    expect(again.ok && again.customTheme).toBeNull()
    expect(again.ok && again.warnings).toContainEqual({
      kind: 'section-skipped',
      section: 'preferences.customTheme',
      reason: 'invalid',
    })
  })

  const backup = () =>
    createBackup({
      library: { playlists: [], selectedPlaylistId: null },
      moments: [],
      theme: 'custom',
      customTheme: { colors: PINK },
      integrity: null,
      exportedAt: new Date('2026-11-22T00:00:00Z'),
    })

  it('전체 백업 — 데크 그림이 없으면 형식 2 그대로, 있으면 theme.json 과 형식 3', async () => {
    const tools = fakeImageTools()
    const plain = await createFullBackupZip({
      backup: backup(),
      artwork: { assignments: [], assets: [], blobs: [] },
      now: new Date(),
      sha256: tools.sha256,
    })
    const plainFiles = unzipSync(plain.bytes)
    expect(Object.keys(plainFiles)).not.toContain('theme.json')
    expect(JSON.parse(strFromU8(plainFiles['manifest.json']!)).formatVersion).toBe(2)

    const store = useCustomThemeStore()
    await store.initDeck({ factory, channel: null })
    await store.writeDeck(
      deckWriteFromArtwork(await validated(gifBytes(2, 6)), {
        fit: 'contain',
        positionX: 20,
        positionY: 80,
        zoom: 1.5,
      }),
    )
    const withDeck = await createFullBackupZip({
      backup: backup(),
      artwork: { assignments: [], assets: [], blobs: [] },
      deck: store.deck,
      now: new Date(),
      sha256: tools.sha256,
    })
    expect(withDeck.deckIncluded).toBe(true)
    const files = unzipSync(withDeck.bytes)
    const manifest = JSON.parse(strFromU8(files['manifest.json']!))
    expect(manifest.formatVersion).toBe(3)
    expect(manifest.contents).toEqual(['backup', 'artwork', 'theme'])
    expect(Object.keys(files)).toContain(`assets/${store.deck!.assetId}.gif`)

    const read = await readFullBackupZip(withDeck.bytes, tools, new Date())
    expect(read.ok).toBe(true)
    if (!read.ok) return
    expect(read.deckProblem).toBeNull()
    expect(read.deck?.assetId).toBe(store.deck!.assetId)
    expect(read.deck?.animated).toBe(true)
    expect(read.deck?.display).toEqual({ fit: 'contain', positionX: 20, positionY: 80, zoom: 1.5 })
  })

  it('전체 백업 — 데크 그림 바이트가 이름(해시)과 다르면 넣지 않고 알린다', async () => {
    const tools = fakeImageTools()
    const write = deckWriteFromArtwork(await validated())
    const built = await createFullBackupZip({
      backup: backup(),
      artwork: { assignments: [], assets: [], blobs: [] },
      deck: { ...write, assetId: 'f'.repeat(64), id: 'deck', revision: 1, updatedAt: '' },
      now: new Date(),
      sha256: tools.sha256,
    })
    expect(built.deckCorrupt).toBe(true)
    expect(Object.keys(unzipSync(built.bytes))).not.toContain('theme.json')
  })
})

describe('G. 공유 카드', () => {
  it('커스텀은 Kawaii 카드 틀에 고른 색 — 목록 카드는 J카드', () => {
    const model = buildShareCard(
      {
        kind: 'playlist',
        name: 'MIX',
        tracks: [{ videoId: 'aaaaaaaaaaa', title: 'One' }],
        moments: [],
      } as unknown as Parameters<typeof buildShareCard>[0],
      'custom',
      new Date('2026-11-22T12:00:00'),
      null,
      PINK,
    )
    expect(model.template).toBe('jcard')
    expect(model.colors).toEqual(PINK)
    const kawaii = buildShareCard(
      {
        kind: 'playlist',
        name: 'MIX',
        tracks: [{ videoId: 'aaaaaaaaaaa', title: 'One' }],
        moments: [],
      } as unknown as Parameters<typeof buildShareCard>[0],
      'kawaii',
      new Date('2026-11-22T12:00:00'),
      null,
      PINK,
    )
    expect(kawaii.colors).toBeNull()
  })

  it.each([
    PINK,
    DEFAULT_CUSTOM_COLORS,
    {
      background: '#ffffff',
      surface: '#f0f0f0',
      text: '#111111',
      accent: '#ffff00',
      line: '#cccccc',
    },
    {
      background: '#000000',
      surface: '#000000',
      text: '#ffffff',
      accent: '#000000',
      line: '#000000',
    },
  ])('종이 위 글자는 어떤 색을 골라도 4.5:1 이상 (%o)', (colors) => {
    const palette = customCardPalette(colors)
    expect(contrastRatio(palette.ink, palette.paper)).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(palette.pinkDark, palette.paper)).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(palette.meta, palette.paper)).toBeGreaterThanOrEqual(4.5)
    expect(palette.bg).toBe(colors.background)
  })

  it('Kawaii 카드 색은 그대로다', () => {
    expect(KAWAII_CARD_PALETTE.pink).toBe('#ff9bc5')
    expect(KAWAII_CARD_PALETTE.bg).toBe('#10202c')
  })
})
