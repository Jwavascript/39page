/**
 * M5 — MVP 종합 흐름.
 *
 * 단위 테스트가 조각을 보는 것과 달리, 여기서는 **앱을 마운트해 사용자가
 * 하는 순서대로** 밟는다. 지시받은 13개 흐름에 하나씩 대응한다.
 *
 * 실제 YouTube API 는 쓰지 않는다 — `FakePlayerAdapter` 가 외부 플레이어
 * 역할을 하고 테스트가 사건을 흘려보낸다. 실제 재생은 브라우저 검증이 맡는다.
 */
import { nextTick } from 'vue'

import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import App from '@/app/App.vue'
import { FakePlayerAdapter } from '@/features/playback/FakePlayerAdapter'
import { PLAYER_ADAPTER_FACTORY } from '@/features/playback/PlayerAdapter'
import { STORAGE_KEYS } from '@/shared/storage'
import { LIBRARY_STORAGE_VERSION, useLibraryStore } from '@/stores/library'
import { usePlaybackStore } from '@/stores/playback'
import { useThemeStore } from '@/stores/theme'

import { installPlayerRect, uninstallPlayerRect } from '../support/playerLayout'

/** `main.ts` 가 하는 기본 플레이리스트 이름. */
const DEFAULT_PLAYLIST_NAME = 'MY RECORDS'

const VIDEO_URL = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
const VIDEO_ID = 'dQw4w9WgXcQ'
const SECOND_URL = 'https://youtu.be/jNQXAC9IVRw'
const SECOND_ID = 'jNQXAC9IVRw'

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

/**
 * `main.ts` 와 **같은 순서**로 앱을 세운다.
 *
 * 복원 → 최초 실행 기본 목록 → 마운트. 이 순서가 깨지면 새로고침 복원이
 * 저장값을 덮어쓸 수 있다 (ADR 0007).
 */
function boot() {
  setActivePinia(createPinia())

  useThemeStore().restore()
  const library = useLibraryStore()
  library.restore()
  library.seedFirstRunPlaylist(DEFAULT_PLAYLIST_NAME)

  const fake = new FakePlayerAdapter()
  const wrapper = mount(App, {
    attachTo: document.body,
    global: { provide: { [PLAYER_ADAPTER_FACTORY as symbol]: () => fake } },
  })

  return { wrapper, fake, library, playback: usePlaybackStore(), theme: useThemeStore() }
}

type Session = ReturnType<typeof boot>

async function openDrawer(session: Session) {
  await session.wrapper.get(`.deck-open--${session.theme.current}`).trigger('click')
  await nextTick()
}

async function closeDrawer(session: Session) {
  await session.wrapper.get('.drawer .close').trigger('click')
  await nextTick()
}

/**
 * 플레이리스트 위젯으로 새 목록을 만든다.
 *
 * M6-4 에서 `＋ 새 목록` 이 드로어에서 위젯으로 옮겼다. 플레이리스트가 사는
 * 곳에서 만든다 (보고 6a).
 */
async function createPlaylist(session: Session, name: string) {
  await session.wrapper.get('.playlist-widget .pill--strong').trigger('click')
  await session.wrapper.get('#new-playlist-name').setValue(name)
  await session.wrapper.get('form.create-form').trigger('submit')
  await nextTick()
}

/** 드로어의 링크 폼으로 트랙을 등록한다. */
async function addTrack(session: Session, url: string, title: string) {
  await session.wrapper.get('[aria-label], .drawer-actions .pill:nth-child(2)').trigger('click')
  const buttons = session.wrapper.findAll('.drawer-actions button')
  const addLink = buttons.find((button) => button.text().includes('YouTube 링크 추가'))
  await addLink?.trigger('click')

  await session.wrapper.get('#track-url').setValue(url)
  await session.wrapper.get('#track-title').setValue(title)
  await session.wrapper.get('.link-form button[type="submit"]').trigger('click')
  await nextTick()
}

/** 재생을 시작해 실제로 울리는 상태까지 끌고 간다. */
async function startPlaying(session: Session, index = 0) {
  const plays = session.wrapper.findAll('.track-play')
  await plays[index]?.trigger('click')
  session.fake.emitReady()
  session.fake.emitStateChange('playing')
  await nextTick()
}

describe('1. 최초 실행 → 기본 라이브러리 생성', () => {
  it('저장값이 없으면 MY RECORDS 하나로 시작한다', () => {
    const session = boot()

    expect(session.library.playlists.map((playlist) => playlist.name)).toEqual([
      DEFAULT_PLAYLIST_NAME,
    ])
    expect(session.library.selectedPlaylist?.tracks).toEqual([])
    expect(session.playback.queue).toEqual([])
  })

  it('기본 목록이 저장되어 다음 실행에서 다시 만들어지지 않는다', () => {
    boot()
    const raw = globalThis.localStorage.getItem(STORAGE_KEYS.library)
    expect(raw).not.toBeNull()

    document.body.innerHTML = ''
    const second = boot()

    expect(second.library.playlists).toHaveLength(1)
  })

  it('빈 목록은 재생할 수 없다', async () => {
    const session = boot()
    await openDrawer(session)

    /*
     * M6-4 — 빈 타일을 누르면 재생이 아니라 편집 오버레이가 열린다.
     *
     * 비활성 타일은 막다른 길이다. 레코드를 넣을 곳으로 데려가는 쪽이 맞다.
     * 드로어의 `▶ 목록 전체 재생` 은 그대로 비활성이다.
     */
    const tile = session.wrapper.get('.playlist-play')
    expect(tile.attributes('aria-label')).toContain('열기')

    await tile.trigger('click')
    await nextTick()

    expect(session.playback.queue).toEqual([])
    expect(session.playback.currentTrack).toBeNull()

    const playAll = session.wrapper
      .findAll('.drawer-actions button')
      .find((button) => button.text().includes('목록 전체 재생'))
    expect(playAll?.attributes('disabled')).toBeDefined()
  })
})

describe('2. 플레이리스트 생성과 YouTube 링크 등록', () => {
  it('새 목록을 만들고 선택한다', async () => {
    const session = boot()
    await openDrawer(session)

    await createPlaylist(session, 'EVENING')

    expect(session.library.playlists.map((playlist) => playlist.name)).toContain('EVENING')
    // 만들면 바로 선택된다 — 편집 오버레이가 그 목록을 가리킨다.
    expect(session.library.selectedPlaylist?.name).toBe('EVENING')
  })

  it('링크를 등록하면 트랙이 생기고 저장된다', async () => {
    const session = boot()
    await openDrawer(session)
    await addTrack(session, VIDEO_URL, 'FIRST SONG')

    const tracks = session.library.selectedPlaylist?.tracks ?? []
    expect(tracks).toHaveLength(1)
    expect(tracks[0]?.videoId).toBe(VIDEO_ID)
    expect(tracks[0]?.title).toBe('FIRST SONG')

    const raw = globalThis.localStorage.getItem(STORAGE_KEYS.library) ?? ''
    expect(raw).toContain(VIDEO_ID)
    // URL 문자열은 저장하지 않는다. videoId 만 남긴다.
    expect(raw).not.toContain('youtube.com/watch')
  })

  it('잘못된 링크는 인라인 오류로 거절하고 입력을 지우지 않는다', async () => {
    const session = boot()
    await openDrawer(session)

    const addLink = session.wrapper
      .findAll('.drawer-actions button')
      .find((button) => button.text().includes('YouTube 링크 추가'))
    await addLink?.trigger('click')
    await session.wrapper.get('#track-url').setValue('https://example.com/not-youtube')
    await session.wrapper.get('.link-form button[type="submit"]').trigger('click')
    await nextTick()

    expect(session.wrapper.get('#track-url-error').text()).toContain('올바른 YouTube 영상 링크')
    expect((session.wrapper.get('#track-url').element as HTMLInputElement).value).toBe(
      'https://example.com/not-youtube',
    )
    expect(session.library.selectedPlaylist?.tracks).toEqual([])
  })
})

describe('3. 개별 트랙 재생', () => {
  it('고른 트랙부터 목록 전체가 큐가 된다', async () => {
    const session = boot()
    await openDrawer(session)
    await addTrack(session, VIDEO_URL, 'ONE')
    await addTrack(session, SECOND_URL, 'TWO')

    await session.wrapper.findAll('.track-play')[1]?.trigger('click')
    await nextTick()

    expect(session.playback.queue.map((track) => track.title)).toEqual(['ONE', 'TWO'])
    expect(session.playback.queueIndex).toBe(1)
    expect(session.fake.calls.load).toEqual([{ videoId: SECOND_ID, autoplay: true }])
  })

  it('제목과 큐 위치가 화면에 뜬다', async () => {
    const session = boot()
    await openDrawer(session)
    await addTrack(session, VIDEO_URL, 'ONE')
    await addTrack(session, SECOND_URL, 'TWO')
    await startPlaying(session, 0)

    expect(session.wrapper.get('.now-title').text()).toBe('ONE')
    expect(session.wrapper.get('.now-sub').text()).toBe('1 / 2 · YOUTUBE · 재생 중')
    expect(session.wrapper.get('.video-placeholder').classes()).toContain('is-hidden')
  })
})

describe('4. 다음 · 이전 · 일시정지 · 다시 재생', () => {
  async function threeTracks() {
    const session = boot()
    await openDrawer(session)
    await addTrack(session, VIDEO_URL, 'ONE')
    await addTrack(session, SECOND_URL, 'TWO')
    await addTrack(session, 'https://www.youtube.com/shorts/aqz-KE-bpKQ', 'THREE')
    await startPlaying(session, 0)
    return session
  }

  it('다음·이전으로 큐를 오간다', async () => {
    const session = await threeTracks()

    await session.wrapper.get('[aria-label="다음 곡"]').trigger('click')
    expect(session.playback.queueIndex).toBe(1)

    await session.wrapper.get('[aria-label="다음 곡"]').trigger('click')
    expect(session.playback.queueIndex).toBe(2)

    await session.wrapper.get('[aria-label="이전 곡"]').trigger('click')
    expect(session.playback.queueIndex).toBe(1)
  })

  it('경계에서 버튼이 비활성이고 반복하지 않는다', async () => {
    const session = await threeTracks()

    expect(session.wrapper.get('[aria-label="이전 곡"]').attributes('disabled')).toBeDefined()

    await session.wrapper.get('[aria-label="다음 곡"]').trigger('click')
    await session.wrapper.get('[aria-label="다음 곡"]').trigger('click')
    await nextTick()

    expect(session.playback.queueIndex).toBe(2)
    expect(session.wrapper.get('[aria-label="다음 곡"]').attributes('disabled')).toBeDefined()
  })

  it('일시정지하고 다시 재생한다', async () => {
    const session = await threeTracks()

    await session.wrapper.get('[aria-label="일시정지"]').trigger('click')
    expect(session.fake.calls.pause).toBe(1)

    session.fake.emitStateChange('paused')
    await nextTick()
    expect(session.wrapper.get('.round--main').text()).toBe('▶')

    await session.wrapper.get('[aria-label="재생"]').trigger('click')
    expect(session.fake.calls.play).toBe(1)
  })

  it('재생이 끝난 트랙을 다시 재생한다', async () => {
    const session = await threeTracks()
    session.fake.emitStateChange('ended')
    await nextTick()
    // 자동으로 다음 곡이 걸린다. 그 곡을 멈추고 다시 누른다.
    session.fake.emitStateChange('playing')
    session.fake.emitStateChange('ended')
    await nextTick()
    session.fake.emitStateChange('playing')
    session.fake.emitStateChange('ended')
    await nextTick()

    expect(session.wrapper.get('.status').text()).toContain('마지막 곡')

    await session.wrapper.get('.round--main').trigger('click')

    expect(session.fake.calls.play).toBe(1)
  })
})

describe('5·6. 영상 종료 → 다음 곡, 마지막 곡에서 정지', () => {
  it('ENDED 가 오면 다음 곡을 적재한다', async () => {
    const session = boot()
    await openDrawer(session)
    await addTrack(session, VIDEO_URL, 'ONE')
    await addTrack(session, SECOND_URL, 'TWO')
    await startPlaying(session, 0)

    session.fake.emitStateChange('ended')
    await nextTick()

    expect(session.playback.queueIndex).toBe(1)
    expect(session.fake.calls.load.map((call) => call.videoId)).toEqual([VIDEO_ID, SECOND_ID])
  })

  it('마지막 곡이 끝나면 멈추고 알린다', async () => {
    const session = boot()
    await openDrawer(session)
    await addTrack(session, VIDEO_URL, 'ONE')
    await startPlaying(session, 0)

    session.fake.emitStateChange('ended')
    await nextTick()

    expect(session.playback.queueIndex).toBe(0)
    expect(session.fake.calls.load).toHaveLength(1)
    expect(session.wrapper.get('.status').text()).toContain('마지막 곡까지 재생했습니다')
  })
})

describe('7. 재생 중 테마 변경', () => {
  it('재생 상태와 어댑터와 iframe 호스트가 모두 유지된다', async () => {
    const session = boot()
    await openDrawer(session)
    await addTrack(session, VIDEO_URL, 'ONE')
    await closeDrawer(session)
    await startPlaying(session, 0)

    const host = session.fake.hostNode
    const mountNode = session.wrapper.get('.player-mount').element
    const before = {
      track: session.playback.currentTrack?.id,
      index: session.playback.queueIndex,
      state: session.playback.playerState,
    }

    await session.wrapper.findAll('.theme-button')[1]?.trigger('click')
    await nextTick()

    expect(document.documentElement.dataset.theme).toBe('kawaii-synth-cassette')
    expect(session.fake.calls.mount).toBe(1)
    expect(session.fake.calls.destroy).toBe(0)
    expect(session.fake.hostNode).toBe(host)
    expect(session.wrapper.get('.player-mount').element).toBe(mountNode)
    expect({
      track: session.playback.currentTrack?.id,
      index: session.playback.queueIndex,
      state: session.playback.playerState,
    }).toEqual(before)
  })

  it('테마 문구와 연출이 함께 바뀐다', async () => {
    const session = boot()
    await openDrawer(session)
    await addTrack(session, VIDEO_URL, 'ONE')
    await closeDrawer(session)
    await startPlaying(session, 0)

    expect(session.wrapper.get('.mascot-message').text()).toBe('NOW SPINNING')
    expect(session.wrapper.get('.footer-theme').text()).toContain('MONO VINYL')

    await session.wrapper.findAll('.theme-button')[1]?.trigger('click')
    await nextTick()

    expect(session.wrapper.get('.mascot-message').text()).toBe('TAPE ROLLING')
    expect(session.wrapper.get('.footer-theme').text()).toContain('SYNTH CASSETTE')
    expect(session.wrapper.get('.deck-widget').classes()).toContain('is-playing')
  })
})

describe('8. 재생 중 드로어 열기·닫기', () => {
  it('세 번 여닫아도 어댑터와 DOM 이 그대로다', async () => {
    const session = boot()
    await openDrawer(session)
    await addTrack(session, VIDEO_URL, 'ONE')
    await closeDrawer(session)
    await startPlaying(session, 0)

    const host = session.fake.hostNode
    for (let round = 0; round < 3; round += 1) {
      await openDrawer(session)
      await closeDrawer(session)
    }

    expect(session.fake.calls.mount).toBe(1)
    expect(session.fake.calls.destroy).toBe(0)
    expect(session.fake.hostNode).toBe(host)
    expect(session.playback.playerState).toBe('playing')
  })

  it('닫으면 포커스가 트리거로 돌아온다', async () => {
    const session = boot()
    const trigger = session.wrapper.get(`.deck-open--${session.theme.current}`)
    ;(trigger.element as HTMLElement).focus()

    await trigger.trigger('click')
    await nextTick()
    await flushPromises()
    expect(document.activeElement).toBe(session.wrapper.get('.drawer .close').element)

    await closeDrawer(session)
    await flushPromises()

    expect(document.activeElement).toBe(trigger.element)
  })
})

describe('9. 플레이리스트 편집 후 큐 안정성', () => {
  it('재생 중 트랙을 추가·정렬·이름 변경해도 큐가 흔들리지 않는다', async () => {
    const session = boot()
    await openDrawer(session)
    await addTrack(session, VIDEO_URL, 'ONE')
    await addTrack(session, SECOND_URL, 'TWO')
    await startPlaying(session, 0)

    const queueBefore = session.playback.queue.map((track) => track.id)

    // 트랙 추가
    await addTrack(session, 'https://www.youtube.com/embed/aqz-KE-bpKQ', 'THREE')
    // 순서 변경
    await session.wrapper.get('[aria-label="TWO 위로"]').trigger('click')
    // 이름 변경
    const rename = session.wrapper
      .findAll('.drawer-actions button')
      .find((button) => button.text().includes('이름 수정'))
    await rename?.trigger('click')
    await session.wrapper.get('#playlist-name').setValue('RENAMED')
    await session.wrapper.get('.name-form button[type="submit"]').trigger('click')
    await nextTick()

    expect(session.playback.queue.map((track) => track.id)).toEqual(queueBefore)
    expect(session.playback.queueIndex).toBe(0)
    expect(session.playback.playerState).toBe('playing')
    expect(session.library.selectedPlaylist?.name).toBe('RENAMED')
  })

  it('다른 목록을 선택해도 큐가 그대로다', async () => {
    const session = boot()
    await openDrawer(session)
    await addTrack(session, VIDEO_URL, 'ONE')
    await startPlaying(session, 0)

    await createPlaylist(session, 'OTHER')

    expect(session.playback.currentTrack?.title).toBe('ONE')
    expect(session.playback.playerState).toBe('playing')
  })
})

describe('10. 재생 중인 트랙 삭제', () => {
  it('멈추고 안내하며 큐는 스냅샷으로 남는다', async () => {
    const session = boot()
    await openDrawer(session)
    await addTrack(session, VIDEO_URL, 'ONE')
    await addTrack(session, SECOND_URL, 'TWO')
    await startPlaying(session, 0)

    await session.wrapper.get('[aria-label="ONE 삭제"]').trigger('click')
    await session.wrapper.get('.confirm .pill--strong').trigger('click')
    await nextTick()

    expect(session.fake.calls.pause).toBe(1)
    expect(session.wrapper.get('.status').text()).toContain('삭제돼 재생을 멈췄습니다')
    expect(session.playback.queue).toHaveLength(2)
    expect(session.library.selectedPlaylist?.tracks).toHaveLength(1)
  })

  it('멈춘 뒤 ENDED 가 와도 다음 곡이 흐르지 않는다', async () => {
    const session = boot()
    await openDrawer(session)
    await addTrack(session, VIDEO_URL, 'ONE')
    await addTrack(session, SECOND_URL, 'TWO')
    await startPlaying(session, 0)

    await session.wrapper.get('[aria-label="ONE 삭제"]').trigger('click')
    await session.wrapper.get('.confirm .pill--strong').trigger('click')
    session.fake.emitStateChange('ended')
    await nextTick()

    expect(session.playback.queueIndex).toBe(0)
  })
})

describe('11. 새로고침 후 복원', () => {
  it('플레이리스트와 테마가 돌아온다', async () => {
    const first = boot()
    await openDrawer(first)
    await addTrack(first, VIDEO_URL, 'KEEP ME')
    await first.wrapper.findAll('.theme-button')[1]?.trigger('click')
    await nextTick()
    first.wrapper.unmount()
    document.body.innerHTML = ''

    // 새로고침: 같은 localStorage, 새 pinia, main.ts 와 같은 순서
    const second = boot()

    expect(second.theme.current).toBe('kawaii-synth-cassette')
    expect(second.library.selectedPlaylist?.tracks[0]?.title).toBe('KEEP ME')
    // 재생 상태는 영속화 대상이 아니다.
    expect(second.playback.queue).toEqual([])
    expect(second.playback.currentTrack).toBeNull()
  })

  it('복원이 저장소에 쓰지 않는다', async () => {
    const first = boot()
    await openDrawer(first)
    await addTrack(first, VIDEO_URL, 'KEEP ME')
    const saved = globalThis.localStorage.getItem(STORAGE_KEYS.library)
    first.wrapper.unmount()
    document.body.innerHTML = ''

    boot()

    expect(globalThis.localStorage.getItem(STORAGE_KEYS.library)).toBe(saved)
  })
})

describe('12. 임베드 불허 · API 오류 · 자동재생 차단', () => {
  it('임베드 불허를 설명하고 자동으로 넘기지 않는다', async () => {
    const session = boot()
    await openDrawer(session)
    await addTrack(session, VIDEO_URL, 'BLOCKED')
    await addTrack(session, SECOND_URL, 'NEXT')
    await session.wrapper.findAll('.track-play')[0]?.trigger('click')

    session.fake.emitError({ kind: 'embed-not-allowed', code: 150 })
    await nextTick()

    expect(session.wrapper.get('.status').text()).toContain('다른 사이트에서 재생할 수 없도록')
    expect(session.wrapper.get('.status').text()).toContain('오류 150')
    expect(session.wrapper.get('.status').classes()).toContain('is-warning')
    expect(session.playback.queueIndex).toBe(0)
    expect(session.wrapper.get('.action-row a').attributes('href')).toContain(VIDEO_ID)
  })

  it('API 를 못 받으면 네트워크를 확인하라고 알린다', async () => {
    const session = boot()
    await openDrawer(session)
    await addTrack(session, VIDEO_URL, 'ONE')
    await session.wrapper.get('.track-play').trigger('click')

    session.fake.emitError({ kind: 'api-unavailable', code: null })
    await nextTick()

    expect(session.wrapper.get('.status').text()).toContain('네트워크를 확인하고')
    expect(session.wrapper.get('.round--main').text()).toBe('▶')
  })

  it('자동재생 차단 뒤 다시 누르면 재생된다', async () => {
    const session = boot()
    await openDrawer(session)
    await addTrack(session, VIDEO_URL, 'ONE')
    await session.wrapper.get('.track-play').trigger('click')

    session.fake.emitAutoplayBlocked()
    session.fake.emitStateChange('idle')
    await nextTick()

    expect(session.wrapper.get('.status').text()).toContain('자동재생을 막았어요')
    await session.wrapper.get('.round--main').trigger('click')

    expect(session.fake.calls.play).toBe(1)
  })
})

describe('13. localStorage 손상과 저장 실패', () => {
  it('손상된 라이브러리를 지우지 않고 보호한다', () => {
    globalThis.localStorage.setItem(STORAGE_KEYS.library, '{{{ broken')

    const session = boot()

    // 원본을 지우거나 덮어쓰지 않는다 (ADR 0007).
    expect(globalThis.localStorage.getItem(STORAGE_KEYS.library)).toBe('{{{ broken')
    expect(session.wrapper.get('.status-region').text()).not.toBe('')
  })

  it('미래 버전 데이터도 보존한다', () => {
    const future = JSON.stringify({
      version: LIBRARY_STORAGE_VERSION + 99,
      data: { playlists: [], selectedPlaylistId: null },
    })
    globalThis.localStorage.setItem(STORAGE_KEYS.library, future)

    boot()

    expect(globalThis.localStorage.getItem(STORAGE_KEYS.library)).toBe(future)
  })

  it('저장할 수 없어도 이번 세션의 조작은 적용된다', async () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
    const session = boot()
    await openDrawer(session)

    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() {
        throw new DOMException('denied', 'SecurityError')
      },
    })

    try {
      await addTrack(session, VIDEO_URL, 'IN MEMORY')

      expect(session.library.selectedPlaylist?.tracks[0]?.title).toBe('IN MEMORY')
      expect(session.wrapper.get('.unsaved').text()).toContain('저장되지 않았습니다')
    } finally {
      if (original === undefined) {
        delete (globalThis as { localStorage?: unknown }).localStorage
      } else {
        Object.defineProperty(globalThis, 'localStorage', original)
      }
    }
  })

  it('손상 상태에서도 테마 전환은 동작한다', async () => {
    globalThis.localStorage.setItem(STORAGE_KEYS.theme, 'not json at all')

    const session = boot()
    await session.wrapper.findAll('.theme-button')[1]?.trigger('click')
    await nextTick()

    expect(session.theme.current).toBe('kawaii-synth-cassette')
    expect(document.documentElement.dataset.theme).toBe('kawaii-synth-cassette')
  })
})
