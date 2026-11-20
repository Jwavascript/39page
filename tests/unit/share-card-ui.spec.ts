/**
 * ADR 0041 — 공유 카드 이미지 화면: 링크 공유 칸 안의 미리보기 · 복사 · 저장.
 *
 * 그리기는 주입한 가짜 렌더러다 (jsdom 에는 캔버스가 없다). 실제 캔버스 그리기는 실제 Chrome 확인에서 본다.
 */
import { nextTick } from 'vue'

import { flushPromises, mount } from '@vue/test-utils'
import { IDBFactory } from 'fake-indexeddb'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import App from '@/app/App.vue'
import { validateArtwork } from '@/features/artwork/imageValidation'
import {
  SHARE_CARD_RENDERER,
  type ShareCardModel,
  type ShareCardRenderer,
} from '@/features/backup/shareCard'
import { FakePlayerAdapter } from '@/features/playback/FakePlayerAdapter'
import { PLAYER_ADAPTER_FACTORY } from '@/features/playback/PlayerAdapter'
import { STORAGE_KEYS } from '@/shared/storage'
import type { Moment } from '@/shared/types'
import { useArtworkStore } from '@/stores/artwork'
import { LIBRARY_STORAGE_VERSION, useLibraryStore } from '@/stores/library'
import { MOMENTS_STORAGE_VERSION, useMomentsStore } from '@/stores/moments'
import { useThemeStore } from '@/stores/theme'

import { fakeImageTools, fileOf, pngBytes } from '../support/artworkFixtures'
import { installPlayerRect, uninstallPlayerRect } from '../support/playerLayout'
import { openTrackManage } from '../support/trackManage'

const A = 'aaaaaaaaaaa'
const B = 'bbbbbbbbbbb'

const MOMENT: Moment = {
  id: 'm1',
  source: 'youtube',
  videoId: A,
  atSeconds: 83,
  note: '후렴',
  title: 'Alpha',
  createdAt: '2026-11-20T01:00:00.000Z',
  updatedAt: '2026-11-20T01:00:00.000Z',
}

function fakeRenderer() {
  return vi.fn<ShareCardRenderer>(async (model: ShareCardModel) => ({
    blob: new Blob(['png'], { type: 'image/png' }),
    width: model.width,
    height: model.height ?? 2000,
  }))
}

function boot(options: { renderer?: ShareCardRenderer | null; theme?: 'mono-vinyl' } = {}) {
  globalThis.localStorage.setItem(
    STORAGE_KEYS.library,
    JSON.stringify({
      version: LIBRARY_STORAGE_VERSION,
      data: {
        playlists: [
          {
            id: 'one',
            name: 'ONE',
            tracks: [
              { id: 't1', source: 'youtube', videoId: A, title: 'Alpha (Official Video)' },
              { id: 't2', source: 'youtube', videoId: B, title: 'Bravo' },
            ],
          },
        ],
        selectedPlaylistId: 'one',
      },
    }),
  )
  globalThis.localStorage.setItem(
    STORAGE_KEYS.moments,
    JSON.stringify({ version: MOMENTS_STORAGE_VERSION, data: [MOMENT] }),
  )
  setActivePinia(createPinia())
  const theme = useThemeStore()
  theme.restore()
  if (options.theme !== undefined) theme.setTheme(options.theme)
  useLibraryStore().restore()
  useMomentsStore().restore()
  const renderer = options.renderer === undefined ? fakeRenderer() : options.renderer
  const wrapper = mount(App, {
    attachTo: document.body,
    global: {
      provide: {
        [PLAYER_ADAPTER_FACTORY as symbol]: () => new FakePlayerAdapter(),
        ...(renderer === null ? {} : { [SHARE_CARD_RENDERER as symbol]: renderer }),
      },
    },
  })
  return { wrapper, renderer, theme }
}

type Session = ReturnType<typeof boot>

async function settle(): Promise<void> {
  await flushPromises()
  await nextTick()
}

async function openShare(s: Session, which: 'track' | 'list'): Promise<void> {
  await s.wrapper.get('.app-nav button').trigger('click')
  await settle()
  if (which === 'track') {
    await openTrackManage(s.wrapper, 'Alpha (Official Video)')
    await s.wrapper.get('[aria-label="Alpha (Official Video) 공유"]').trigger('click')
  } else {
    await s.wrapper.findAll('.archive-lists .list-manage')[0]?.trigger('click')
    await s.wrapper
      .findAll('.archive-lists .manage-panel button')
      .find((button) => button.text() === '이 목록 공유')
      ?.trigger('click')
  }
  await settle()
}

const card = (s: Session) => s.wrapper.get('.card-share')
async function waitCard(s: Session): Promise<void> {
  await vi.waitFor(
    async () => {
      await settle()
      if (!card(s).find('.card-preview-image').exists()) throw new Error('card not ready')
    },
    { timeout: 3000, interval: 20 },
  )
}
const lastModel = (s: Session): ShareCardModel => {
  const calls = (s.renderer as ReturnType<typeof fakeRenderer>).mock.calls
  return calls[calls.length - 1]?.[0] as ShareCardModel
}
const button = (s: Session, text: string) =>
  card(s)
    .findAll('button')
    .find((node) => node.text() === text)

beforeEach(() => {
  globalThis.localStorage.clear()
  installPlayerRect()
  URL.createObjectURL = vi.fn<(object: Blob | MediaSource) => string>(() => 'blob:card')
  URL.revokeObjectURL = vi.fn<(url: string) => void>()
})

afterEach(() => {
  uninstallPlayerRect()
  vi.unstubAllGlobals()
  Reflect.deleteProperty(globalThis.navigator, 'clipboard')
  Reflect.deleteProperty(URL, 'createObjectURL')
  Reflect.deleteProperty(URL, 'revokeObjectURL')
  globalThis.localStorage.clear()
  document.body.innerHTML = ''
})

describe('A. 미리보기', () => {
  it('곡 공유 — 링크와 같은 대상으로 싱글 카드를 그려 미리 보인다 (Kawaii)', async () => {
    const s = boot()
    await openShare(s, 'track')
    await waitCard(s)

    expect(card(s).get('.card-preview-image').attributes('src')).toBe('blob:card')
    expect(card(s).get('.card-preview-image').attributes('alt')).toBe('공유 카드 미리보기 — Alpha')
    expect(card(s).get('.meta').text()).toBe('싱글 · 1080×1350 PNG')
    const model = lastModel(s)
    expect([model.template, model.theme, model.heading]).toEqual(['single', 'kawaii', 'Alpha'])
  })

  it('목록 공유 (Mono) — LP 뒷면, Moments · 메모를 넣으면 카드도 따라 그린다', async () => {
    const s = boot({ theme: 'mono-vinyl' })
    await openShare(s, 'list')
    await waitCard(s)
    expect(lastModel(s).template).toBe('lp')
    expect(lastModel(s).momentCount).toBe(0)
    expect(card(s).get('.meta').text()).toBe('LP 뒷면 · 1080×1080 PNG')

    await s.wrapper
      .findAll('.link-share label.check')
      .find((node) => node.text().includes('Moments 1개 넣기'))
      ?.get('input')
      .setValue(true)
    await vi.waitFor(() => {
      if (lastModel(s).momentCount !== 1) throw new Error('not re-rendered')
    })
    expect(
      lastModel(s)
        .sides.flat()
        .map((row) => row.moment),
    ).toEqual(['1:23', null])
  })

  it('곡 이름을 뺀 링크여도 카드에는 곡 이름이 있다', async () => {
    const s = boot()
    await openShare(s, 'list')
    await waitCard(s)
    await s.wrapper
      .findAll('.link-share label.check')
      .find((node) => node.text().includes('곡 이름 넣기'))
      ?.get('input')
      .setValue(false)
    await settle()
    expect(
      lastModel(s)
        .sides.flat()
        .map((row) => row.title),
    ).toEqual(['Alpha', 'Bravo'])
  })

  it('테마를 바꾸면 그 테마의 틀로 다시 그린다', async () => {
    const s = boot()
    await openShare(s, 'list')
    await waitCard(s)
    expect(lastModel(s).template).toBe('jcard')

    s.theme.setTheme('mono-vinyl')
    await vi.waitFor(() => {
      if (lastModel(s).template !== 'lp') throw new Error('not re-rendered')
    })
  })

  it('그릴 수 없는 환경이면 그렇다고 말하고 단추를 끈다', async () => {
    const s = boot({ renderer: null })
    await openShare(s, 'track')
    expect(card(s).get('.placeholder').text()).toBe('이 브라우저에서는 이미지를 만들 수 없어요.')
    expect(button(s, '이미지 복사')?.attributes('disabled')).toBeDefined()
    expect(button(s, '이미지 저장')?.attributes('disabled')).toBeDefined()
  })
})

describe('B. 복사 · 저장', () => {
  it('"이미지 복사" — PNG 를 클립보드에 넣는다', async () => {
    class FakeClipboardItem {
      constructor(readonly items: Record<string, Promise<Blob>>) {}
    }
    vi.stubGlobal('ClipboardItem', FakeClipboardItem)
    const write = vi
      .fn<(items: FakeClipboardItem[]) => Promise<void>>()
      .mockResolvedValue(undefined)
    Object.defineProperty(globalThis.navigator, 'clipboard', {
      value: { write },
      configurable: true,
    })
    const s = boot()
    await openShare(s, 'track')
    await waitCard(s)

    await button(s, '이미지 복사')?.trigger('click')
    await settle()

    expect(write).toHaveBeenCalledTimes(1)
    const item = write.mock.calls[0]?.[0][0] as FakeClipboardItem
    expect(Object.keys(item.items)).toEqual(['image/png'])
    expect((await item.items['image/png'])?.type).toBe('image/png')
    expect(card(s).get('.status').text()).toBe(
      '이미지를 복사했어요. 게시판 글쓰기 칸에 붙여 넣으세요.',
    )
  })

  it('복사가 막히면 저장으로 안내한다', async () => {
    const s = boot()
    await openShare(s, 'track')
    await waitCard(s)

    await button(s, '이미지 복사')?.trigger('click')
    await settle()
    expect(card(s).get('.status').text()).toContain('"이미지 저장" 으로 받아 주세요')
  })

  it('선택이 바뀌면 새 카드가 나올 때까지 복사 · 저장을 끈다 — 지난 카드를 붙여 넣지 않게', async () => {
    const gate: { release: (() => void) | null } = { release: null }
    const renderer = vi.fn<ShareCardRenderer>(async (model) => {
      if (model.momentCount > 0) {
        await new Promise<void>((resolve) => {
          gate.release = resolve
        })
      }
      return {
        blob: new Blob(['png'], { type: 'image/png' }),
        width: model.width,
        height: model.height ?? 2000,
      }
    })
    const s = boot({ renderer, theme: 'mono-vinyl' })
    await openShare(s, 'list')
    await waitCard(s)
    expect(button(s, '이미지 복사')?.attributes('disabled')).toBeUndefined()

    await s.wrapper
      .findAll('.link-share label.check')
      .find((node) => node.text().includes('Moments 1개 넣기'))
      ?.get('input')
      .setValue(true)
    await nextTick()

    // 바로 — 미루는 동안에도. 보이는 정보는 아직 지난 카드의 것이다.
    expect(card(s).get('.card-preview').attributes('data-state')).toBe('rendering')
    expect(button(s, '이미지 복사')?.attributes('disabled')).toBeDefined()
    expect(button(s, '이미지 저장')?.attributes('disabled')).toBeDefined()
    expect(card(s).get('.meta').text()).toBe('LP 뒷면 · 1080×1080 PNG')

    await vi.waitFor(() => {
      if (gate.release === null) throw new Error('not rendering yet')
    })
    gate.release?.()
    await vi.waitFor(async () => {
      await settle()
      if (card(s).get('.card-preview').attributes('data-state') !== 'ready') {
        throw new Error('not ready')
      }
    })
    expect(button(s, '이미지 복사')?.attributes('disabled')).toBeUndefined()
    expect(lastModel(s).momentCount).toBe(1)
  })

  it('"이미지 저장" — <이름>.39page.png 로 내려받는다', async () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    const s = boot()
    await openShare(s, 'list')
    await waitCard(s)

    await button(s, '이미지 저장')?.trigger('click')
    await settle()

    expect(click).toHaveBeenCalledTimes(1)
    const anchor = click.mock.instances[0] as unknown as HTMLAnchorElement
    expect(anchor.download).toBe('ONE.39page.png')
    expect(card(s).get('.status').text()).toBe('“ONE.39page.png” 을 저장했어요.')
    click.mockRestore()
  })
})

describe('C. 내 앨범아트 (ADR 0042)', () => {
  /** 렌더러가 받은 그림 바이트를 기록하고, 그림이 있으면 "그렸다" 고 답한다. */
  function artRenderer() {
    return vi.fn<ShareCardRenderer>(async (model: ShareCardModel, art: Blob | null) => ({
      blob: new Blob(['png'], { type: 'image/png' }),
      width: model.width,
      height: model.height ?? 2000,
      art: art !== null,
    }))
  }

  /** 두 번째 곡(Bravo)에 사용자 그림을 단다. */
  async function withArt(): Promise<string> {
    const store = useArtworkStore()
    await store.init({ factory: new IDBFactory(), channel: null })
    const result = await validateArtwork(fileOf(pngBytes(3), 'cover.png'), fakeImageTools())
    if (!result.ok) throw new Error(result.reason)
    const saved = await store.setCustom(
      { playlistId: 'one', trackId: 't2' },
      B,
      result.artwork,
      0,
      {
        fit: 'contain',
        positionX: 20,
        positionY: 80,
        zoom: 1.5,
      },
    )
    if (!saved.ok) throw new Error(saved.reason)
    await settle()
    return result.artwork.id
  }

  const artBox = (s: Session) =>
    card(s)
      .findAll('label.check')
      .find((node) => node.text().includes('내 앨범아트 넣기'))

  it('목록에 사용자 그림이 있으면 처음 만나는 그림을 앱의 맞춤 그대로 넣는다', async () => {
    const s = boot({ renderer: artRenderer() })
    const assetId = await withArt()
    await openShare(s, 'list')
    await waitCard(s)

    expect(artBox(s)?.get('input').element).toHaveProperty('checked', true)
    const calls = (s.renderer as ReturnType<typeof artRenderer>).mock.calls
    const [model, blob] = calls[calls.length - 1] ?? []
    expect(model?.art).toEqual({
      assetId,
      display: { fit: 'contain', positionX: 20, positionY: 80, zoom: 1.5 },
    })
    // 그림 바이트를 넘긴다 (jsdom 의 IndexedDB 사본은 Blob 모양을 잃는다 — 있는지만 본다).
    expect(blob).not.toBeNull()
    expect(blob).toBeDefined()
    expect(card(s).get('.meta').text()).toBe('카세트 J카드 · 앨범아트 · 1080×1350 PNG')
  })

  it('"내 앨범아트 넣기" 를 끄면 39page 기본 그림으로 다시 그린다', async () => {
    const s = boot({ renderer: artRenderer() })
    await withArt()
    await openShare(s, 'list')
    await waitCard(s)

    await artBox(s)?.get('input').setValue(false)
    await vi.waitFor(async () => {
      await settle()
      if (lastModel(s).art !== null) throw new Error('not re-rendered')
      if (card(s).get('.card-preview').attributes('data-state') !== 'ready') throw new Error('busy')
    })
    const calls = (s.renderer as ReturnType<typeof artRenderer>).mock.calls
    expect(calls[calls.length - 1]?.[1]).toBeNull()
    expect(card(s).get('.meta').text()).toBe('카세트 J카드 · 1080×1350 PNG')
  })

  it('그림이 없는 곡이면 고르는 칸도 없고 기본 그림이다', async () => {
    const s = boot({ renderer: artRenderer() })
    await withArt()
    await openShare(s, 'track')
    await waitCard(s)

    expect(artBox(s)).toBeUndefined()
    expect(lastModel(s).art).toBeNull()
  })
})
