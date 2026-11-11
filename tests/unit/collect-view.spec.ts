/**
 * 수집 화면 (M10-3B, ADR 0023).
 *
 * `main.ts` 의 수집 경로와 같은 순서로 세운다 — 테마 · 라이브러리 복원 → 첫 실행
 * 목록 → 다른 탭 듣기 → `CollectApp` 마운트. 다른 탭은 같은 `localStorage` 를 쓰는
 * 별도 Pinia store 다.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'

import CollectApp from '@/app/CollectApp.vue'
import CollectView from '@/features/collect/CollectView.vue'
import { STORAGE_KEYS } from '@/shared/storage'
import type { LibraryData } from '@/shared/types'
import { LIBRARY_STORAGE_VERSION, useLibraryStore } from '@/stores/library'
import { useThemeStore } from '@/stores/theme'

const KEY = STORAGE_KEYS.library
const REQ = '3f0c6b1e-8d2a-4c7e-9b5f-1a2b3c4d5e6f'
const VIDEO = 'jNQXAC9IVRw'
const realLocalStorage = globalThis.localStorage
let stopWatching: (() => void) | null = null

function collectHash(fields: Record<string, string> = {}): string {
  const params = new URLSearchParams({
    v: '1',
    kind: 'track',
    videoId: VIDEO,
    title: 'Me at the zoo',
    req: REQ,
    ...fields,
  })
  return `#collect?${params.toString()}`
}

function seedLibrary(data: LibraryData): void {
  realLocalStorage.setItem(KEY, JSON.stringify({ version: LIBRARY_STORAGE_VERSION, data }))
}

const TWO_LISTS: LibraryData = {
  playlists: [
    {
      id: 'p1',
      name: '출근길',
      tracks: [{ id: 't1', source: 'youtube', videoId: 'dQw4w9WgXcQ', title: '있던 곡' }],
    },
    { id: 'p2', name: '공부', tracks: [] },
  ],
  selectedPlaylistId: 'p2',
}

/** `main.ts` 의 수집 경로와 같은 순서. */
function boot(hash = collectHash()) {
  setActivePinia(createPinia())
  useThemeStore().restore()
  const library = useLibraryStore()
  library.restore()
  library.seedFirstRunPlaylist('MY RECORDS')
  stopWatching = library.watchExternalChanges()
  const clearRequest = vi.fn<() => void>()
  const wrapper = mount(CollectView, {
    props: { hash, options: { clearRequest } },
    attachTo: document.body,
  })
  return { wrapper, library, clearRequest }
}

type Wrapper = ReturnType<typeof boot>['wrapper']

function stored(): LibraryData {
  return JSON.parse(realLocalStorage.getItem(KEY) as string).data as LibraryData
}

function titlesIn(playlistId: string): string[] {
  return (
    stored()
      .playlists.find((playlist) => playlist.id === playlistId)
      ?.tracks.map((track) => track.title) ?? []
  )
}

async function clickAdd(wrapper: Wrapper): Promise<void> {
  await wrapper.get('form.choose').trigger('submit')
  await nextTick()
}

function otherTab() {
  const store = useLibraryStore(createPinia())
  store.restore()
  return store
}

beforeEach(() => {
  realLocalStorage.clear()
  delete document.documentElement.dataset.theme
})

afterEach(() => {
  stopWatching?.()
  stopWatching = null
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: realLocalStorage })
  realLocalStorage.clear()
  document.body.innerHTML = ''
})

describe('열기만 해서는 저장하지 않는다', () => {
  it('제목 · 영상 ID · 목록을 보이고, 기본 선택은 대시보드에서 고른 목록이다', () => {
    seedLibrary(TWO_LISTS)
    const before = realLocalStorage.getItem(KEY)
    const { wrapper } = boot()

    expect(wrapper.get('.video-title').text()).toBe('Me at the zoo')
    expect(wrapper.text()).toContain(VIDEO)
    const radios = wrapper.findAll('input[type="radio"]')
    expect(radios.map((radio) => (radio.element as HTMLInputElement).value)).toEqual(['p1', 'p2'])
    expect(radios.map((radio) => (radio.element as HTMLInputElement).checked)).toEqual([
      false,
      true,
    ])
    expect(wrapper.text()).toContain('추가를 누르기 전에는 아무것도 저장하지 않습니다')
    expect(realLocalStorage.getItem(KEY)).toBe(before)
    wrapper.unmount()
  })

  it('수집 화면에서 목록을 바꿔 골라도 라이브러리의 선택(저장값)을 바꾸지 않는다', async () => {
    seedLibrary(TWO_LISTS)
    const before = realLocalStorage.getItem(KEY)
    const { wrapper } = boot()

    await wrapper.findAll('input[type="radio"]')[0]?.setValue(true)
    expect(realLocalStorage.getItem(KEY)).toBe(before)
    wrapper.unmount()
  })
})

describe('명시적으로 누르면 한 곡을 넣는다', () => {
  it('고른 목록 끝에 넣고 완료를 알린 뒤 요청 조각을 지운다', async () => {
    seedLibrary(TWO_LISTS)
    const { wrapper, clearRequest } = boot()

    await clickAdd(wrapper)

    expect(titlesIn('p2')).toEqual(['Me at the zoo'])
    expect(titlesIn('p1')).toEqual(['있던 곡'])
    expect(wrapper.text()).toContain('“Me at the zoo” 을(를) “공부” 에 추가했습니다')
    expect(wrapper.find('form.choose').exists()).toBe(false)
    expect(wrapper.get('a[href="/"]').text()).toBe('대시보드로 이동')
    expect(clearRequest).toHaveBeenCalledTimes(1)
    wrapper.unmount()
  })

  it('연속으로 눌러도 한 곡만 들어간다', async () => {
    seedLibrary(TWO_LISTS)
    const { wrapper } = boot()
    const form = wrapper.get('form.choose')

    await form.trigger('submit')
    await form.trigger('submit')
    await form.trigger('submit')
    await nextTick()

    expect(titlesIn('p2')).toEqual(['Me at the zoo'])
    wrapper.unmount()
  })

  it('제목이 없으면 라이브러리 기본 제목으로 저장한다', async () => {
    seedLibrary(TWO_LISTS)
    const params = new URLSearchParams({ v: '1', kind: 'track', videoId: VIDEO, req: REQ })
    const { wrapper } = boot(`#collect?${params.toString()}`)

    expect(wrapper.text()).toContain(`제목 없음 — “YouTube · ${VIDEO}” 로 저장됩니다`)
    await clickAdd(wrapper)
    expect(titlesIn('p2')).toEqual([`YouTube · ${VIDEO}`])
    wrapper.unmount()
  })

  it('첫 실행(저장된 라이브러리 없음)이면 기본 목록에 넣을 수 있다', async () => {
    const { wrapper } = boot()
    expect(wrapper.findAll('input[type="radio"]')).toHaveLength(1)
    await clickAdd(wrapper)
    expect(stored().playlists[0]?.name).toBe('MY RECORDS')
    expect(stored().playlists[0]?.tracks.map((track) => track.videoId)).toEqual([VIDEO])
    wrapper.unmount()
  })
})

describe('같은 영상이 이미 있으면 알리고, 명시적으로만 한 번 더 넣는다', () => {
  it('알림 · 버튼 문구 · 누르면 두 번째로 들어간다', async () => {
    seedLibrary({
      ...TWO_LISTS,
      playlists: [
        {
          id: 'p1',
          name: '출근길',
          tracks: [{ id: 't1', source: 'youtube', videoId: VIDEO, title: 'Me at the zoo' }],
        },
        { id: 'p2', name: '공부', tracks: [] },
      ],
      selectedPlaylistId: 'p1',
    })
    const { wrapper } = boot()

    expect(wrapper.get('.duplicate').text()).toContain('이미 있습니다 (1번째)')
    expect(wrapper.get('button[type="submit"]').text()).toBe('한 번 더 추가')
    expect(titlesIn('p1')).toEqual(['Me at the zoo'])

    // 다른 목록을 고르면 알림이 사라진다
    await wrapper.findAll('input[type="radio"]')[1]?.setValue(true)
    expect(wrapper.find('.duplicate').exists()).toBe(false)
    expect(wrapper.get('button[type="submit"]').text()).toBe('플레이리스트에 추가')

    await wrapper.findAll('input[type="radio"]')[0]?.setValue(true)
    await clickAdd(wrapper)
    expect(titlesIn('p1')).toEqual(['Me at the zoo', 'Me at the zoo'])
    wrapper.unmount()
  })
})

describe('신뢰하지 않는 입력', () => {
  it('잘못된 요청은 거절만 하고 아무것도 저장하지 않는다', () => {
    seedLibrary(TWO_LISTS)
    const before = realLocalStorage.getItem(KEY)
    const { wrapper } = boot(collectHash({ v: '2' }))

    expect(wrapper.get('[role="alert"]').text()).toContain('이 수집 요청은 열 수 없습니다')
    expect(wrapper.text()).toContain('버전이 맞지 않습니다')
    expect(wrapper.text()).toContain('아무것도 저장하지 않았습니다')
    expect(wrapper.find('form').exists()).toBe(false)
    expect(realLocalStorage.getItem(KEY)).toBe(before)
    wrapper.unmount()
  })

  it('스크립트 같은 제목은 글자로만 보이고 요소가 생기지 않는다', async () => {
    seedLibrary(TWO_LISTS)
    const title = '<script>window.__pwned = 1</script><img src=x onerror="window.__pwned = 2">'
    const { wrapper } = boot(collectHash({ title }))
    await nextTick()

    expect(wrapper.get('.video-title').text()).toBe(title)
    expect(wrapper.find('.video-title script').exists()).toBe(false)
    expect(wrapper.find('.video-title img').exists()).toBe(false)
    expect((globalThis as { __pwned?: number }).__pwned).toBeUndefined()

    await clickAdd(wrapper)
    expect(titlesIn('p2')).toEqual([title])
    wrapper.unmount()
  })
})

describe('보호 · 저장 실패 · 다른 탭', () => {
  it('라이브러리가 보호 상태면 추가 버튼이 없고 원문을 덮지 않는다', () => {
    realLocalStorage.setItem(KEY, '{broken')
    const { wrapper } = boot()

    expect(wrapper.text()).toContain('지금은 추가할 수 없습니다')
    expect(wrapper.text()).toContain('원본은 보존 중입니다')
    expect(wrapper.find('form').exists()).toBe(false)
    expect(realLocalStorage.getItem(KEY)).toBe('{broken')
    wrapper.unmount()
  })

  it('저장에 실패하면 성공이라 하지 않고, 다시 눌러도 한 곡만 들어간다', async () => {
    seedLibrary(TWO_LISTS)
    const before = realLocalStorage.getItem(KEY)
    const { wrapper, library, clearRequest } = boot()

    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        getItem: (key: string) => realLocalStorage.getItem(key),
        setItem: () => {
          throw new DOMException('full', 'QuotaExceededError')
        },
        removeItem: (key: string) => realLocalStorage.removeItem(key),
        clear: () => realLocalStorage.clear(),
        key: (index: number) => realLocalStorage.key(index),
        get length() {
          return realLocalStorage.length
        },
      },
    })
    await clickAdd(wrapper)

    expect(wrapper.get('.failure').text()).toContain('저장하지 못했습니다')
    expect(wrapper.text()).not.toContain('추가했습니다')
    expect(realLocalStorage.getItem(KEY)).toBe(before)
    expect(library.getPlaylist('p2')?.tracks).toHaveLength(0) // 메모리에도 남기지 않았다
    expect(clearRequest).not.toHaveBeenCalled()

    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: realLocalStorage,
    })
    await clickAdd(wrapper)
    expect(titlesIn('p2')).toEqual(['Me at the zoo'])
    wrapper.unmount()
  })

  it('다른 탭이 먼저 바꿨으면 충돌을 알리고, 다시 누르면 두 탭의 곡이 모두 남는다', async () => {
    seedLibrary(TWO_LISTS)
    const { wrapper } = boot()

    otherTab().addTrack('p2', { videoId: 'M7lc1UVf-VE', title: '다른 탭 곡' })
    await clickAdd(wrapper)

    expect(wrapper.get('.failure').text()).toContain('다른 탭에서 라이브러리가 바뀌어')
    expect(titlesIn('p2')).toEqual(['다른 탭 곡'])

    await clickAdd(wrapper)
    expect(titlesIn('p2')).toEqual(['다른 탭 곡', 'Me at the zoo'])
    wrapper.unmount()
  })

  it('다른 탭이 고른 목록을 지우면(이벤트) 다른 목록으로 다시 고른다', async () => {
    seedLibrary(TWO_LISTS)
    const { wrapper } = boot()

    otherTab().deletePlaylist('p2')
    globalThis.dispatchEvent(new StorageEvent('storage', { key: KEY }))
    await nextTick()

    const radios = wrapper.findAll('input[type="radio"]')
    expect(radios.map((radio) => (radio.element as HTMLInputElement).value)).toEqual(['p1'])
    expect(radios.map((radio) => (radio.element as HTMLInputElement).checked)).toEqual([true])
    await clickAdd(wrapper)
    expect(titlesIn('p1')).toEqual(['있던 곡', 'Me at the zoo'])
    wrapper.unmount()
  })

  it('저장한 곡이 다른 탭의 저장으로 없어지면 "추가했습니다" 를 남기지 않고 되돌린다 (M10-3C)', async () => {
    seedLibrary(TWO_LISTS)
    const { wrapper } = boot()
    await clickAdd(wrapper)
    expect(wrapper.text()).toContain('추가했습니다')

    // 다른 탭이 이 곡을 모른 채 쓴 값(동시 저장) — 또는 다른 탭에서 지운 경우와 같다
    seedLibrary(TWO_LISTS)
    globalThis.dispatchEvent(new StorageEvent('storage', { key: KEY }))
    await nextTick()

    expect(wrapper.text()).not.toContain('추가했습니다')
    expect(wrapper.get('.failure').text()).toContain('방금 추가한 곡이 목록에서 없어졌습니다')
    await clickAdd(wrapper)
    expect(titlesIn('p2')).toEqual(['Me at the zoo'])
    expect(wrapper.text()).toContain('추가했습니다')
    wrapper.unmount()
  })

  it('목록이 하나도 없으면 안내하고 추가할 수 없다', () => {
    seedLibrary({ playlists: [], selectedPlaylistId: null })
    const { wrapper } = boot()
    expect(wrapper.text()).toContain('플레이리스트가 없습니다')
    expect(wrapper.get('button[type="submit"]').attributes('disabled')).toBeDefined()
    wrapper.unmount()
  })
})

describe('수집 앱은 대시보드를 띄우지 않는다', () => {
  it('플레이어 · iframe · 위젯이 없다', () => {
    seedLibrary(TWO_LISTS)
    setActivePinia(createPinia())
    useLibraryStore().restore()
    const wrapper = mount(CollectApp, { props: { hash: collectHash() }, attachTo: document.body })

    expect(wrapper.get('h1').text()).toBe('39page')
    expect(document.querySelector('iframe')).toBeNull()
    expect(document.querySelector('[data-widget]')).toBeNull()
    expect(document.querySelector('.moments-widget')).toBeNull()
    wrapper.unmount()
  })

  it('main.ts 의 수집 경로는 플레이어 어댑터와 Moments 를 건드리지 않는다', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/main.ts'), 'utf8')
    const start = source.indexOf("if (resolveEntry(globalThis.location.hash) === 'collect') {")
    const end = source.indexOf('} else {', start)
    const branch = source.slice(start, end)

    expect(start).toBeGreaterThan(-1)
    expect(branch).toContain('createApp(CollectApp')
    expect(branch).not.toContain('PLAYER_ADAPTER_FACTORY')
    expect(branch).not.toContain('useMomentsStore')
    expect(source.indexOf('library.watchExternalChanges()')).toBeLessThan(start)
  })
})
