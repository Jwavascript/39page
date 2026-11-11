/**
 * M9-3 — 앱 시작 시 Moments 복원.
 *
 * `main.ts` 와 **같은 순서**로 앱을 세우고(테마 → 라이브러리 → Moments →
 * 마운트) 복원이 읽기만 하는지, 라이브러리와 독립인지, 그 사이 플레이어의
 * DOM 이 그대로인지 본다. 실제 YouTube API 는 쓰지 않는다.
 *
 * 화면에 Moments 를 보여주는 UI 는 아직 없다 (M9-4). 여기서 보는 것은 store
 * 와 저장소다.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { nextTick } from 'vue'

import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import App from '@/app/App.vue'
import { FakePlayerAdapter } from '@/features/playback/FakePlayerAdapter'
import { PLAYER_ADAPTER_FACTORY } from '@/features/playback/PlayerAdapter'
import { STORAGE_KEYS } from '@/shared/storage'
import type { Moment } from '@/shared/types'
import { useLibraryStore } from '@/stores/library'
import { MOMENTS_STORAGE_VERSION, useMomentsStore } from '@/stores/moments'
import { usePlaybackStore } from '@/stores/playback'
import { useThemeStore } from '@/stores/theme'

import { installPlayerRect, uninstallPlayerRect } from '../support/playerLayout'

const DEFAULT_PLAYLIST_NAME = 'MY RECORDS'
const VIDEO = 'jNQXAC9IVRw'

function readSource(relative: string): string {
  return readFileSync(resolve(process.cwd(), relative), 'utf8')
}

function stripComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
}

function rawMoments(): string | null {
  return globalThis.localStorage.getItem(STORAGE_KEYS.moments)
}

function moment(overrides: Partial<Moment> = {}): Moment {
  return {
    id: 'm-1',
    source: 'youtube',
    videoId: VIDEO,
    atSeconds: 83,
    note: '간주',
    title: 'Me at the zoo',
    createdAt: '2026-11-07T01:00:00.000Z',
    updatedAt: '2026-11-07T01:00:00.000Z',
    ...overrides,
  }
}

function seedMoments(data: unknown, version = MOMENTS_STORAGE_VERSION): string {
  const raw = JSON.stringify({ version, data })
  globalThis.localStorage.setItem(STORAGE_KEYS.moments, raw)
  return raw
}

/** `main.ts` 와 같은 순서. 복원 → 기본 목록 → Moments 복원 → 마운트. */
function boot() {
  setActivePinia(createPinia())

  useThemeStore().restore()
  const library = useLibraryStore()
  library.restore()
  library.seedFirstRunPlaylist(DEFAULT_PLAYLIST_NAME)
  const moments = useMomentsStore()
  moments.restore()

  const fake = new FakePlayerAdapter()
  const wrapper = mount(App, {
    attachTo: document.body,
    global: { provide: { [PLAYER_ADAPTER_FACTORY as symbol]: () => fake } },
  })

  return { wrapper, fake, library, moments, playback: usePlaybackStore(), theme: useThemeStore() }
}

type Session = ReturnType<typeof boot>

async function openDrawer(session: Session) {
  await session.wrapper.get('.playlist-tile .playlist-open').trigger('click')
  await nextTick()
}

async function closeDrawer(session: Session) {
  await session.wrapper.get('.drawer .close').trigger('click')
  await nextTick()
}

beforeEach(() => {
  globalThis.localStorage.clear()
  delete document.documentElement.dataset.theme
  installPlayerRect()
})

afterEach(() => {
  uninstallPlayerRect()
  globalThis.localStorage.clear()
  delete document.documentElement.dataset.theme
  document.body.innerHTML = ''
})

describe('A. 복원', () => {
  it('저장된 Moments 가 앱 시작 시 돌아온다', () => {
    seedMoments([moment({ id: 'a', atSeconds: 10 }), moment({ id: 'b', atSeconds: 40 })])

    const session = boot()

    expect(session.moments.restoreOutcome).toBe('stored')
    expect(session.moments.status).toBe('ready')
    expect(session.moments.moments.map((item) => item.id)).toEqual(['a', 'b'])
    session.wrapper.unmount()
  })

  it('키가 없는 첫 실행은 빈 목록이고 아무것도 쓰지 않는다', async () => {
    const session = boot()

    expect(session.moments.restoreOutcome).toBe('empty')
    expect(session.moments.status).toBe('ready')
    expect(session.moments.moments).toEqual([])
    // 라이브러리는 기본 목록을 심지만 Moments 는 심을 것이 없다.
    expect(globalThis.localStorage.getItem(STORAGE_KEYS.library)).not.toBeNull()
    expect(rawMoments()).toBeNull()

    // 앱을 쓰는 동안에도 쓰지 않는다 — 부르는 UI 가 없다.
    session.library.createPlaylist('MORE')
    session.theme.setTheme('kawaii-synth-cassette')
    await nextTick()
    expect(rawMoments()).toBeNull()
    session.wrapper.unmount()
  })

  it('복원은 저장소에 쓰지 않는다 — 원문이 그대로다', () => {
    const raw = seedMoments([moment()])

    const session = boot()

    expect(rawMoments()).toBe(raw)
    session.wrapper.unmount()
  })
})

describe('B. 원문 보호', () => {
  it('손상된 원문은 보호 상태로 남고 앱을 써도 덮어쓰이지 않는다', async () => {
    globalThis.localStorage.setItem(STORAGE_KEYS.moments, '{깨진 값')

    const session = boot()

    expect(session.moments.status).toBe('protected')
    expect(session.moments.protectedReason).toBe('malformed')
    expect(session.moments.canPersist).toBe(false)

    session.library.createPlaylist('STILL FINE')
    session.theme.setTheme('kawaii-synth-cassette')
    await nextTick()
    // 메모리 수정도 저장되지 않는다.
    const added = await session.moments.add({ videoId: VIDEO, atSeconds: 1 })
    expect(added.ok && added.persisted).toBe(false)

    expect(rawMoments()).toBe('{깨진 값')
    session.wrapper.unmount()
  })

  it('미지원 버전 원문은 추측해 변환하지 않고 그대로 둔다', () => {
    const raw = seedMoments([{ id: 'x', futureShape: true }], MOMENTS_STORAGE_VERSION + 1)

    const session = boot()

    expect(session.moments.restoreOutcome).toBe('version-mismatch')
    expect(session.moments.status).toBe('protected')
    expect(session.moments.moments).toEqual([])
    expect(rawMoments()).toBe(raw)
    session.wrapper.unmount()
  })

  it('일부만 복구한 원문도 보호한다', () => {
    const raw = seedMoments([moment({ id: 'good' }), { id: 'bad' }])

    const session = boot()

    expect(session.moments.moments.map((item) => item.id)).toEqual(['good'])
    expect(session.moments.protectedReason).toBe('partial-recovery')
    expect(rawMoments()).toBe(raw)
    session.wrapper.unmount()
  })
})

describe('C. 라이브러리와의 독립', () => {
  it('라이브러리 원문이 깨져도 Moments 는 정상 복원된다', () => {
    globalThis.localStorage.setItem(STORAGE_KEYS.library, '{깨진 라이브러리')
    seedMoments([moment()])

    const session = boot()

    expect(session.library.status).toBe('protected')
    expect(session.moments.status).toBe('ready')
    expect(session.moments.count).toBe(1)
    session.wrapper.unmount()
  })

  it('Moments 원문이 깨져도 라이브러리는 정상이고 기본 목록도 만든다', () => {
    globalThis.localStorage.setItem(STORAGE_KEYS.moments, '{깨진 Moments')

    const session = boot()

    expect(session.moments.status).toBe('protected')
    expect(session.library.status).toBe('ready')
    expect(session.library.playlists.map((playlist) => playlist.name)).toEqual([
      DEFAULT_PLAYLIST_NAME,
    ])
    session.wrapper.unmount()
  })

  it('복원된 Moment 가 가리키는 영상이 라이브러리에 없어도 남는다', () => {
    seedMoments([moment({ videoId: 'zzzzzzzzzzz' })])

    const session = boot()

    expect(session.moments.count).toBe(1)
    expect(session.library.playlists.every((p) => p.tracks.length === 0)).toBe(true)
    session.wrapper.unmount()
  })
})

describe('D. 플레이어 DOM 동일성', () => {
  it('Moments 가 있어도 테마 전환과 드로어 열고 닫기에 플레이어 호스트가 같다', async () => {
    seedMoments([moment()])
    const session = boot()
    const host = session.fake.hostNode
    expect(host).not.toBeNull()

    session.theme.setTheme('kawaii-synth-cassette')
    await nextTick()
    await openDrawer(session)
    await closeDrawer(session)
    session.theme.setTheme('mono-vinyl')
    await nextTick()

    expect(session.fake.hostNode).toBe(host)
    expect(session.fake.calls.mount).toBe(1)
    expect(session.fake.calls.destroy).toBe(0)
    session.wrapper.unmount()
  })
})

describe('E. main.ts', () => {
  it('Moments 를 테마·라이브러리 다음에 복원하고, 복원만 한다', () => {
    const code = stripComments(readSource('src/main.ts'))

    const theme = code.indexOf('useThemeStore(pinia).restore()')
    const library = code.indexOf('library.restore()')
    const store = code.indexOf('const moments = useMomentsStore(pinia)')
    const moments = code.indexOf('moments.restore()')
    // 다른 탭(수집 화면 포함)의 Moments 저장을 듣는다 — 복원 뒤에 (M10-3 안정화).
    const watch = code.indexOf('moments.watchExternalChanges()')
    const mountCall = code.indexOf("app.mount('#app')")

    expect(theme).toBeGreaterThan(-1)
    expect(library).toBeGreaterThan(theme)
    expect(store).toBeGreaterThan(library)
    expect(moments).toBeGreaterThan(store)
    expect(watch).toBeGreaterThan(moments)
    expect(mountCall).toBeGreaterThan(watch)

    // 기본값을 심거나 쓰는 호출이 없다.
    expect(code).not.toContain('.add(')
    expect(code).not.toContain('addMoments')
    expect(code).not.toContain('replaceAllMoments')
  })
})
