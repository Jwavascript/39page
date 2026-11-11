/**
 * 탭 간 정합성 — 화면 (M10-3, ADR 0024).
 *
 * 이 탭 = 마운트한 앱. 다른 탭 = 같은 `localStorage` 를 쓰는 별도 Pinia store.
 * `storage` 이벤트는 같은 창에서 생기지 않으므로 다른 탭이 보낸 것처럼 손으로 쏜다.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { nextTick } from 'vue'

import App from '@/app/App.vue'
import { LIBRARY_CONFLICT_MESSAGE } from '@/features/library/libraryFeedback'
import { FakePlayerAdapter } from '@/features/playback/FakePlayerAdapter'
import { PLAYER_ADAPTER_FACTORY } from '@/features/playback/PlayerAdapter'
import { STORAGE_KEYS } from '@/shared/storage'
import type { LibraryData } from '@/shared/types'
import { useLibraryStore } from '@/stores/library'
import { useThemeStore } from '@/stores/theme'

const KEY = STORAGE_KEYS.library
const realLocalStorage = globalThis.localStorage
let stopWatching: (() => void) | null = null

/** `main.ts` 와 같은 순서 — 복원 → 첫 실행 목록 → 다른 탭 듣기 → 마운트. */
function boot() {
  setActivePinia(createPinia())
  useThemeStore().restore()
  const library = useLibraryStore()
  library.restore()
  library.seedFirstRunPlaylist('MY RECORDS')
  stopWatching = library.watchExternalChanges()

  const fake = new FakePlayerAdapter()
  const wrapper = mount(App, {
    attachTo: document.body,
    global: { provide: { [PLAYER_ADAPTER_FACTORY as symbol]: () => fake } },
  })
  return { wrapper, library }
}

type Wrapper = ReturnType<typeof boot>['wrapper']

/** 같은 저장소를 쓰는 다른 탭. */
function otherTab() {
  const store = useLibraryStore(createPinia())
  store.restore()
  return store
}

function deliverStorageEvent(): void {
  globalThis.dispatchEvent(new StorageEvent('storage', { key: KEY }))
}

function stored(): LibraryData {
  return JSON.parse(realLocalStorage.getItem(KEY) as string).data as LibraryData
}

async function openDrawer(wrapper: Wrapper): Promise<void> {
  await nextTick()
  await wrapper.findAll('.playlist-tile .playlist-open')[0]?.trigger('click')
  await nextTick()
}

function trackNames(wrapper: Wrapper): string[] {
  return wrapper.findAll('#record-library-drawer .track-name').map((node) => node.text())
}

async function openLinkForm(wrapper: Wrapper): Promise<void> {
  const button = wrapper
    .findAll('#record-library-drawer .pill')
    .find((node) => node.text().includes('YouTube 링크 추가'))
  await button?.trigger('click')
  await nextTick()
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

describe('다른 탭의 변경이 이 탭 화면에 보인다', () => {
  it('다른 탭이 추가한 트랙이 이벤트로 열린 드로어에 나타난다', async () => {
    const { wrapper, library } = boot()
    await openDrawer(wrapper)
    expect(trackNames(wrapper)).toEqual([])

    otherTab().addTrack(library.playlists[0]?.id as string, {
      videoId: 'jNQXAC9IVRw',
      title: '다른 탭 곡',
    })
    deliverStorageEvent()
    await nextTick()

    expect(trackNames(wrapper)).toEqual(['다른 탭 곡'])
    wrapper.unmount()
  })
})

describe('이벤트보다 먼저 누르면 — 충돌 안내 · 입력 유지 · 다시 누르면 둘 다 남는다', () => {
  it('드로어의 링크 추가', async () => {
    const { wrapper, library } = boot()
    await openDrawer(wrapper)
    await openLinkForm(wrapper)
    await wrapper.get('#track-url').setValue('https://www.youtube.com/watch?v=dQw4w9WgXcQ')
    await wrapper.get('#track-title').setValue('이 탭 곡')

    otherTab().addTrack(library.playlists[0]?.id as string, {
      videoId: 'jNQXAC9IVRw',
      title: '다른 탭 곡',
    })
    await wrapper.get('.link-form').trigger('submit')
    await nextTick()

    expect(wrapper.get('#track-url-error').text()).toBe(LIBRARY_CONFLICT_MESSAGE)
    expect((wrapper.get('#track-url').element as HTMLInputElement).value).toContain('dQw4w9WgXcQ')
    expect(trackNames(wrapper)).toEqual(['다른 탭 곡'])
    expect(stored().playlists[0]?.tracks.map((track) => track.title)).toEqual(['다른 탭 곡'])

    await wrapper.get('.link-form').trigger('submit')
    await nextTick()
    expect(stored().playlists[0]?.tracks.map((track) => track.title)).toEqual([
      '다른 탭 곡',
      '이 탭 곡',
    ])
    expect(wrapper.find('.added').text()).toContain('이 탭 곡')
    wrapper.unmount()
  })

  it('플레이리스트 위젯에서 목록을 열 때(선택 저장) 충돌하면 그렇다고 알린다', async () => {
    const { wrapper, library } = boot()
    await nextTick()
    otherTab().renamePlaylist(library.playlists[0]?.id as string, '다른 탭 이름')

    await wrapper.findAll('.playlist-tile .playlist-open')[0]?.trigger('click')
    await nextTick()

    expect(wrapper.get('.widget-notice').text()).toBe(LIBRARY_CONFLICT_MESSAGE)
    expect(stored().playlists[0]?.name).toBe('다른 탭 이름')
    expect(library.playlists[0]?.name).toBe('다른 탭 이름')
    wrapper.unmount()
  })
})

describe('저장하지 못한 변경이 다시 읽기로 사라지면 알린다', () => {
  it('쓰기 실패 뒤 다른 탭의 변경이 오면 배너가 그 사실을 적는다', async () => {
    const { wrapper, library } = boot()
    const id = library.playlists[0]?.id as string

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
    expect(library.addTrack(id, { videoId: 'dQw4w9WgXcQ', title: '저장 안 됨' })).toMatchObject({
      persisted: false,
    })
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: realLocalStorage,
    })

    otherTab().addTrack(id, { videoId: 'jNQXAC9IVRw', title: '다른 탭 곡' })
    deliverStorageEvent()
    await nextTick()

    expect(wrapper.text()).toContain('다른 탭의 변경을 불러왔습니다')
    expect(wrapper.text()).toContain('저장하지 못했던 변경은 반영되지 않았습니다')
    expect(wrapper.text()).not.toContain('저장에 실패했습니다')
    wrapper.unmount()
  })
})

describe('동시 저장으로 덮였을 수 있으면 알린다 (M10-3C)', () => {
  it('방금 저장한 값이 바로 다른 탭의 값으로 바뀌면 배너가 확인을 권한다', async () => {
    const { wrapper, library } = boot()
    library.addTrack(library.playlists[0]?.id as string, {
      videoId: 'dQw4w9WgXcQ',
      title: '이 탭 곡',
    })
    const mine = realLocalStorage.getItem(KEY)

    realLocalStorage.setItem(
      KEY,
      JSON.stringify({ version: 1, data: { playlists: [], selectedPlaylistId: null } }),
    )
    globalThis.dispatchEvent(new StorageEvent('storage', { key: KEY, oldValue: mine }))
    await nextTick()

    expect(wrapper.text()).toContain('다른 탭과 거의 동시에 저장했습니다')
    expect(wrapper.text()).toContain('덮였을 수 있습니다')
    wrapper.unmount()
  })
})

describe('조립', () => {
  it('main.ts 가 복원 뒤 다른 탭의 저장을 듣기 시작한다', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/main.ts'), 'utf8')
    const restoreAt = source.indexOf('library.restore()')
    const watchAt = source.indexOf('library.watchExternalChanges()')
    expect(restoreAt).toBeGreaterThan(-1)
    expect(watchAt).toBeGreaterThan(restoreAt)
  })
})
