/**
 * ADR 0042 — 공유 입구: 지금 재생 카드의 공유 아이콘(YouTube 링크 자리)과 데크(카세트 · LP)의 목록 공유 아이콘.
 *
 * 둘 다 대상만 정하고 같은 공유 대화상자(`SHARE_DIALOG`)를 연다 — 무엇을 공유할지는 대화상자에서 본다.
 */
import { nextTick } from 'vue'

import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import App from '@/app/App.vue'
import { FakePlayerAdapter } from '@/features/playback/FakePlayerAdapter'
import { PLAYER_ADAPTER_FACTORY } from '@/features/playback/PlayerAdapter'
import { useLibraryStore } from '@/stores/library'

import { installPlayerRect, uninstallPlayerRect } from '../support/playerLayout'

const VIDEOS = ['aaaaaaaaaaa', 'bbbbbbbbbbb'] as const

beforeEach(() => {
  globalThis.localStorage.clear()
  setActivePinia(createPinia())
  installPlayerRect()
})

afterEach(() => {
  uninstallPlayerRect()
  globalThis.localStorage.clear()
  document.body.innerHTML = ''
})

async function setup(lists: { name: string; tracks: number }[] = [{ name: 'LIST', tracks: 2 }]) {
  const fake = new FakePlayerAdapter()
  const wrapper = mount(App, {
    attachTo: document.body,
    global: { provide: { [PLAYER_ADAPTER_FACTORY as symbol]: () => fake } },
  })
  const library = useLibraryStore()
  const ids: string[] = []
  const trackIds: string[][] = []
  for (const list of lists) {
    const created = await library.createPlaylist(list.name)
    const playlistId = created.ok ? created.playlistId : ''
    ids.push(playlistId)
    const tracks: string[] = []
    for (let index = 0; index < list.tracks; index += 1) {
      const added = await library.addTrack(playlistId, {
        videoId: VIDEOS[index % VIDEOS.length] ?? VIDEOS[0],
        title: `${list.name} ${String(index + 1)}`,
      })
      tracks.push(added.ok ? (added.trackId ?? '') : '')
    }
    trackIds.push(tracks)
  }
  if (ids[0] !== undefined) library.selectPlaylist(ids[0])
  await nextTick()
  return { wrapper, fake, library, ids, trackIds }
}

type Ctx = Awaited<ReturnType<typeof setup>>

async function settle(): Promise<void> {
  await flushPromises()
  await nextTick()
}

/** 공유 대화상자(ADR 0043)가 열렸고, 무엇을 공유하는지 — 종류 · 이름. 데이터 · 백업은 닫혀 있다. */
function shareTarget({ wrapper }: Ctx) {
  const dialog = wrapper.find('.share-dialog')
  return {
    open: dialog.exists(),
    dataOpen: wrapper.get('.data-backdrop').attributes('hidden') === undefined,
    kind: dialog.exists() ? dialog.get('.target-kind').text() : null,
    name: dialog.exists() ? dialog.get('.target-name').text() : null,
  }
}

describe('A. 지금 재생 카드 — YouTube 링크 자리의 공유 아이콘', () => {
  it('누르면 지금 곡을 공유 대화상자로 연다', async () => {
    const ctx = await setup()
    await ctx.wrapper.get('.now-playlist .play-all').trigger('click')
    await ctx.wrapper.get('[aria-label="다음 곡"]').trigger('click')
    await settle()

    await ctx.wrapper.get('.action-row .share').trigger('click')
    await settle()

    expect(shareTarget(ctx)).toEqual({ open: true, dataOpen: false, kind: '곡', name: 'LIST 2' })
  })

  it('재생 중인 목록이 보관함에서 지워지면(큐는 끝까지 재생) 누를 수 없고 이유를 말한다', async () => {
    const ctx = await setup()
    await ctx.wrapper.get('.now-playlist .play-all').trigger('click')
    await settle()

    await ctx.library.deletePlaylist(ctx.ids[0] ?? '')
    await settle()

    const share = ctx.wrapper.get('.action-row .share')
    expect(share.attributes('disabled')).toBeDefined()
    expect(share.attributes('aria-label')).toBe('보관함 목록에 있는 곡만 공유할 수 있어요')
  })
})

describe('B. 데크(카세트 · LP) — 목록 공유 아이콘', () => {
  it('재생 전에는 보관함에서 고른 목록을 목록 전체로 연다', async () => {
    const ctx = await setup()

    const share = ctx.wrapper.get('.deck-share')
    expect(share.attributes('aria-label')).toBe('지금 목록 공유 — LIST')
    await share.trigger('click')
    await settle()

    expect(shareTarget(ctx)).toEqual({
      open: true,
      dataOpen: false,
      kind: '플레이리스트',
      name: 'LIST',
    })
  })

  it('재생 중이면 큐의 출처 목록 — 보관함에서 다른 목록을 골라도 데크가 보이는 목록이다', async () => {
    const ctx = await setup([
      { name: 'PLAYING', tracks: 2 },
      { name: 'OTHER', tracks: 1 },
    ])
    await ctx.wrapper.get('.now-playlist .play-all').trigger('click')
    await settle()
    ctx.library.selectPlaylist(ctx.ids[1] ?? '')
    await settle()

    const share = ctx.wrapper.get('.deck-share')
    expect(share.attributes('aria-label')).toBe('지금 목록 공유 — PLAYING')
    await share.trigger('click')
    await settle()
    expect(shareTarget(ctx).name).toBe('PLAYING')
  })

  it('빈 목록 · 목록 없음이면 누를 수 없고 이유를 말한다', async () => {
    const empty = await setup([{ name: 'EMPTY', tracks: 0 }])
    expect(empty.wrapper.get('.deck-share').attributes('disabled')).toBeDefined()
    expect(empty.wrapper.get('.deck-share').attributes('aria-label')).toBe(
      'EMPTY — 빈 목록은 공유할 수 없어요',
    )
    empty.wrapper.unmount()
    document.body.innerHTML = ''
    globalThis.localStorage.clear()
    setActivePinia(createPinia())

    const none = await setup([])
    expect(none.wrapper.get('.deck-share').attributes('disabled')).toBeDefined()
    expect(none.wrapper.get('.deck-share').attributes('aria-label')).toBe('공유할 목록이 없어요')
  })
})

describe('C. 공유 대화상자 (ADR 0043)', () => {
  it('Esc 로 닫히고 연 단추로 포커스가 돌아온다 · 열린 동안 뒤쪽은 inert', async () => {
    const ctx = await setup()
    const button = ctx.wrapper.get('.deck-share')
    ;(button.element as HTMLElement).focus()
    await button.trigger('click')
    await settle()

    expect(ctx.wrapper.find('.share-dialog').exists()).toBe(true)
    expect(ctx.wrapper.get('.workspace').attributes('inert')).toBeDefined()

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await settle()
    expect(ctx.wrapper.find('.share-dialog').exists()).toBe(false)
    expect(ctx.wrapper.get('.workspace').attributes('inert')).toBeUndefined()
    expect(document.activeElement).toBe(button.element)
  })
})
