/**
 * M9-4 — Music Moments UI.
 *
 * **앱 전체를 마운트**해 사용자가 하는 순서대로 밟는다. 외부 플레이어는
 * `FakePlayerAdapter` 가 맡고, 테스트가 "플레이어가 보고했다" 를 흘려보낸다.
 * 실제 YouTube 재생은 브라우저 검증이 따로 본다 (`IMPLEMENTATION_PLAN.md` M9-4).
 *
 *   A  저장 (F13) — 시점 고정 · 200ms 가짜 0초 · 입력 중 곡 변경 · 500자
 *   B  저장 상태 — 실패 · protected · unavailable
 *   C  목록 (F14) — 개수 · 강조 · 거르기 · 정렬 · 제목 3단 · 글자로만
 *   D  수정·삭제 (F16)
 *   E  재생 (F15) — 같은 곡 · 다른 곡 · 지운 곡 · 가려짐 · 시트 · 실패
 *   F  영속 · 테마 · iframe
 *   G  경계 — 없는 기능의 버튼 · 소스 수준
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { nextTick } from 'vue'

import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import App from '@/app/App.vue'
import MomentsWidget from '@/features/moments/MomentsWidget.vue'
import { createPlaybackCoordinator } from '@/features/playback/createPlaybackCoordinator'
import { FakePlayerAdapter } from '@/features/playback/FakePlayerAdapter'
import {
  PLAYBACK_COORDINATOR,
  PLAY_REFUSED_HIDDEN_MESSAGE,
} from '@/features/playback/playbackCoordinator'
import { PLAYER_ADAPTER_FACTORY } from '@/features/playback/PlayerAdapter'
import { STORAGE_KEYS } from '@/shared/storage'
import type { Moment } from '@/shared/types'
import { useLibraryStore } from '@/stores/library'
import { MAX_MOMENT_NOTE_LENGTH, MOMENTS_STORAGE_VERSION, useMomentsStore } from '@/stores/moments'
import { usePlaybackStore } from '@/stores/playback'
import { useThemeStore } from '@/stores/theme'

import {
  HIDDEN_RECT,
  installMatchMedia,
  installPlayerRect,
  setPlayerRect,
  setRectOverride,
  sheetRect,
  uninstallMatchMedia,
  uninstallPlayerRect,
} from '../support/playerLayout'

const A = 'aaaaaaaaaaa'
const B = 'bbbbbbbbbbb'
const C = 'ccccccccccc'
const GONE = 'zzzzzzzzzzz'

const realLocalStorage = globalThis.localStorage

function readSource(relative: string): string {
  return readFileSync(resolve(process.cwd(), relative), 'utf8')
}

function stripComments(code: string): string {
  return code
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '')
}

function stubLocalStorage(descriptor: PropertyDescriptor): void {
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, ...descriptor })
}

/** Moments 키 쓰기만 실패하는 저장소. 라이브러리는 정상이다. */
function stubMomentsWriteFailure(): void {
  const map = new Map<string, string>()
  stubLocalStorage({
    value: {
      get length() {
        return map.size
      },
      key: (index: number) => [...map.keys()][index] ?? null,
      getItem: (key: string) => map.get(key) ?? null,
      setItem: (key: string, value: string) => {
        if (key === STORAGE_KEYS.moments) throw new DOMException('full', 'QuotaExceededError')
        map.set(key, value)
      },
      removeItem: (key: string) => void map.delete(key),
      clear: () => map.clear(),
    } satisfies Storage,
    writable: true,
  })
}

/** `Array.prototype.at` 은 이 tsconfig 의 lib 에 없다. */
function last<T>(items: readonly T[]): T | undefined {
  return items[items.length - 1]
}

function rawMoments(): string | null {
  return globalThis.localStorage.getItem(STORAGE_KEYS.moments)
}

function rawLibrary(): string | null {
  return globalThis.localStorage.getItem(STORAGE_KEYS.library)
}

function seedMoments(data: Moment[]): void {
  globalThis.localStorage.setItem(
    STORAGE_KEYS.moments,
    JSON.stringify({ version: MOMENTS_STORAGE_VERSION, data }),
  )
}

function moment(overrides: Partial<Moment> = {}): Moment {
  return {
    id: 'm-1',
    source: 'youtube',
    videoId: A,
    atSeconds: 10,
    note: '',
    title: 'Alpha',
    createdAt: '2026-11-10T01:00:00.000Z',
    updatedAt: '2026-11-10T01:00:00.000Z',
    ...overrides,
  }
}

/**
 * `main.ts` 와 같은 순서로 앱을 세운다. 목록 하나에 세 곡(A·B·C)을 넣는다.
 * 라이브러리 시드는 저장소를 통해 넣는다 — 실제 앱처럼 복원에서 읽는다.
 */
function boot(options: { library?: boolean } = {}) {
  if (options.library !== false) {
    globalThis.localStorage.setItem(
      STORAGE_KEYS.library,
      JSON.stringify({
        version: 1,
        data: {
          playlists: [
            {
              id: 'list',
              name: 'LIST',
              tracks: [
                { id: 't-a', source: 'youtube', videoId: A, title: 'Alpha' },
                { id: 't-b', source: 'youtube', videoId: B, title: 'Bravo' },
                { id: 't-c', source: 'youtube', videoId: C, title: 'Charlie' },
              ],
            },
          ],
          selectedPlaylistId: 'list',
        },
      }),
    )
  }

  setActivePinia(createPinia())
  useThemeStore().restore()
  const library = useLibraryStore()
  library.restore()
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

const widget = (s: Session) => s.wrapper.get('.moments-widget')
const captureButton = (s: Session) => s.wrapper.get('.capture-button')
const captureFeedback = (s: Session) => s.wrapper.findAll('.moments-widget .feedback')[0]
const listFeedback = (s: Session) => s.wrapper.findAll('.moments-widget .feedback')[1]

/** 목록 전체 재생 → 플레이어 준비 → 실제 재생 → 위치 보고. */
async function playFromStart(s: Session, seconds: number): Promise<void> {
  await s.wrapper.get('.playlist-tile .playlist-play').trigger('click')
  await flushPromises()
  s.fake.emitReady()
  s.fake.emitStateChange('playing')
  s.fake.emitPosition(seconds)
  await nextTick()
}

async function nextTrack(s: Session): Promise<void> {
  await s.wrapper.get('button[aria-label="다음 곡"]').trigger('click')
  await nextTick()
}

async function beginCapture(s: Session): Promise<void> {
  await captureButton(s).trigger('click')
  await nextTick()
}

async function saveCapture(s: Session, note = ''): Promise<void> {
  if (note !== '') await s.wrapper.get('#moment-capture-note').setValue(note)
  await s.wrapper.get('.capture-form').trigger('submit')
  await nextTick()
}

beforeEach(() => {
  globalThis.localStorage.clear()
  delete document.documentElement.dataset.theme
  installPlayerRect()
})

afterEach(() => {
  stubLocalStorage({ value: realLocalStorage, writable: true })
  globalThis.localStorage.clear()
  uninstallPlayerRect()
  uninstallMatchMedia()
  delete document.documentElement.dataset.theme
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

/* ================================================================== *
 * A. 저장 (F13)
 * ================================================================== */

describe('A. 지금 이 순간 저장', () => {
  it('곡이 없으면 저장 버튼이 꺼져 있고 왜 꺼졌는지 말한다', () => {
    const s = boot()

    expect(captureButton(s).attributes('disabled')).toBeDefined()
    expect(s.wrapper.get('#moment-capture-hint').text()).toContain('곡을 재생하면')
  })

  it('재생을 요청해도 실제로 재생되기 전에는 꺼져 있다', async () => {
    const s = boot()
    await s.wrapper.get('.playlist-tile .playlist-play').trigger('click')
    await flushPromises()
    s.fake.emitReady()
    s.fake.emitPosition(0)
    await nextTick()

    // 불러오는 중이다. 플레이어가 0 을 보고해도 아직 믿지 않는다.
    expect(s.playback.playerState).toBe('loading')
    expect(captureButton(s).attributes('disabled')).toBeDefined()
    expect(s.wrapper.get('#moment-capture-hint').text()).toContain('재생이 시작되면')
  })

  it('재생이 시작되면 켜지고, 누르면 그 순간을 고정해 보여준다', async () => {
    const s = boot()
    await playFromStart(s, 42.7)

    expect(captureButton(s).attributes('disabled')).toBeUndefined()
    await beginCapture(s)

    const target = s.wrapper.get('.capture-target')
    expect(target.text()).toContain('0:42')
    expect(target.text()).toContain('Alpha')
    // 메모 칸으로 바로 간다.
    expect(document.activeElement).toBe(s.wrapper.get('#moment-capture-note').element)
  })

  it('메모를 쓰는 동안 재생이 흘러가도 저장되는 초는 누른 순간이다', async () => {
    const s = boot()
    await playFromStart(s, 42.7)
    await beginCapture(s)

    s.fake.emitPosition(97.3)
    await saveCapture(s, '여기부터 좋다')

    expect(s.moments.moments).toHaveLength(1)
    expect(s.moments.moments[0]).toMatchObject({
      videoId: A,
      atSeconds: 42,
      note: '여기부터 좋다',
      title: 'Alpha',
    })
  })

  it('정상적으로 확인된 0초는 유효한 순간이다', async () => {
    const s = boot()
    await playFromStart(s, 0.4)

    await beginCapture(s)
    expect(s.wrapper.get('.capture-target').text()).toContain('0:00')
    await saveCapture(s)

    expect(s.moments.moments[0]?.atSeconds).toBe(0)
  })

  /*
   * M9-3 실측: 새 영상을 적재하면 플레이어는 지정 시점으로 가기 전 약 200ms 동안
   * `0` 을 보고한다 — 영상은 맞고 시간만 틀리다. 그 사이 저장되면 0초짜리
   * 순간이 생긴다.
   */
  it('곡을 바꾸는 중에 보고되는 가짜 0초로는 저장할 수 없다', async () => {
    const s = boot()
    await playFromStart(s, 30)
    await nextTrack(s)

    // 실제 YouTube 가 전환 중에 보내는 순서 그대로: paused@0 → idle → loading.
    s.fake.emitStateChange('paused')
    s.fake.emitPosition(0)
    await nextTick()
    expect(captureButton(s).attributes('disabled')).toBeDefined()
    s.fake.emitStateChange('idle')
    s.fake.emitStateChange('loading')
    await nextTick()
    expect(captureButton(s).attributes('disabled')).toBeDefined()

    // 버튼을 우회해 눌러도(이벤트 직접 발생) 저장되지 않는다.
    await captureButton(s).element.dispatchEvent(new MouseEvent('click'))
    await nextTick()
    expect(s.wrapper.find('.capture-form').exists()).toBe(false)
    expect(s.moments.moments).toEqual([])

    // 실제로 재생이 시작된 뒤에는 그 영상의 위치로 저장된다.
    s.fake.emitPosition(0.2)
    s.fake.emitStateChange('playing')
    await nextTick()
    await beginCapture(s)
    await saveCapture(s)

    expect(s.moments.moments[0]).toMatchObject({ videoId: B, atSeconds: 0, title: 'Bravo' })
  })

  it('버튼이 켜진 뒤 누르기 전에 위치를 잃으면 0 으로 바꾸지 않고 거절한다', async () => {
    const s = boot()
    await playFromStart(s, 30)
    // 플레이어가 보고를 거뒀다 (준비가 풀린 경우 등).
    s.fake.emitPosition(null)

    await beginCapture(s)

    expect(s.wrapper.find('.capture-form').exists()).toBe(false)
    expect(captureFeedback(s)?.text()).toContain('재생 위치를 확인하지 못했어요')
    expect(s.moments.moments).toEqual([])
  })

  it('메모를 쓰는 중에 곡이 바뀌어도 누른 곡·시점에 저장하고, 바뀌었다고 알린다', async () => {
    const s = boot()
    await playFromStart(s, 42)
    await beginCapture(s)
    expect(s.wrapper.find('.stale-note').exists()).toBe(false)

    await nextTrack(s)
    s.fake.emitStateChange('playing')
    s.fake.emitPosition(5)
    await nextTick()

    expect(s.wrapper.get('.stale-note').text()).toContain('곡이 바뀌었어요')
    // 고정한 대상이 그대로 보인다.
    expect(s.wrapper.get('.capture-target').text()).toContain('Alpha')

    await saveCapture(s, 'A 의 메모')

    expect(s.moments.moments[0]).toMatchObject({
      videoId: A,
      atSeconds: 42,
      title: 'Alpha',
      note: 'A 의 메모',
    })
  })

  it('메모는 500자까지다 — 입력란이 막고, 넘긴 값은 저장하지 않는다', async () => {
    const s = boot()
    await playFromStart(s, 10)
    await beginCapture(s)

    const field = s.wrapper.get('#moment-capture-note')
    expect(field.attributes('maxlength')).toBe(String(MAX_MOMENT_NOTE_LENGTH))

    // 스크립트·붙여넣기 경로처럼 maxlength 를 넘긴 값.
    await field.setValue('가'.repeat(MAX_MOMENT_NOTE_LENGTH + 1))
    expect(s.wrapper.get('#moment-capture-count').text()).toContain('501 / 500')
    expect(s.wrapper.get('#moment-capture-count').text()).toContain('500자까지')
    expect(
      s.wrapper.get('.capture-form button[type="submit"]').attributes('disabled'),
    ).toBeDefined()

    await s.wrapper.get('.capture-form').trigger('submit')
    expect(s.moments.moments).toEqual([])
    // 폼은 남는다 — 쓴 메모를 잃지 않는다.
    expect(s.wrapper.find('.capture-form').exists()).toBe(true)

    await field.setValue('가'.repeat(MAX_MOMENT_NOTE_LENGTH))
    await s.wrapper.get('.capture-form').trigger('submit')
    await nextTick()
    expect(s.moments.moments[0]?.note).toHaveLength(MAX_MOMENT_NOTE_LENGTH)
  })

  it('메모 없이도 저장된다 — 메모는 선택이다', async () => {
    const s = boot()
    await playFromStart(s, 10)
    await beginCapture(s)
    await saveCapture(s)

    expect(s.moments.moments[0]?.note).toBe('')
  })

  it('취소하면 아무것도 저장하지 않고 저장 버튼으로 돌아간다', async () => {
    const s = boot()
    await playFromStart(s, 10)
    await beginCapture(s)
    await s.wrapper.get('#moment-capture-note').setValue('버릴 메모')

    const cancel = s.wrapper.findAll('.capture-form button').find((b) => b.text() === '취소')
    await cancel?.trigger('click')
    await nextTick()

    expect(s.moments.moments).toEqual([])
    expect(rawMoments()).toBeNull()
    expect(s.wrapper.find('.capture-form').exists()).toBe(false)
    expect(document.activeElement).toBe(captureButton(s).element)
  })

  it('한 영상에 여러 순간 — 같은 시점도 합치지 않는다', async () => {
    const s = boot()
    await playFromStart(s, 50)
    await beginCapture(s)
    await saveCapture(s, '오십')

    s.fake.emitPosition(10)
    await beginCapture(s)
    await saveCapture(s, '열 하나')
    await beginCapture(s)
    await saveCapture(s, '열 둘')

    expect(s.moments.count).toBe(3)
    const groups = s.wrapper.findAll('.moment-group')
    expect(groups).toHaveLength(1)
    expect(groups[0]?.findAll('.moment-time').map((t) => t.text())).toEqual([
      '0:10',
      '0:10',
      '0:50',
    ])
  })

  it('저장하면 무엇을 어느 시점에 저장했는지 알린다', async () => {
    const s = boot()
    await playFromStart(s, 83)
    await beginCapture(s)
    await saveCapture(s)

    const feedback = captureFeedback(s)
    expect(feedback?.text()).toContain('저장했어요')
    expect(feedback?.text()).toContain('Alpha · 1:23')
    expect(feedback?.classes()).not.toContain('is-warning')
    expect(document.activeElement).toBe(captureButton(s).element)
  })

  it('저장 폼을 쓰는 동안 목록과 거르기는 잠시 물러난다', async () => {
    seedMoments([moment()])
    const s = boot()
    await playFromStart(s, 20)

    await beginCapture(s)

    expect(s.wrapper.get('#moments-list').isVisible()).toBe(false)
    expect(s.wrapper.get('.filter').isVisible()).toBe(false)
  })
})

/* ================================================================== *
 * B. 저장 상태 — 실패 · protected · unavailable
 * ================================================================== */

describe('B. 저장되지 않은 상태를 저장된 것처럼 보이지 않는다', () => {
  it('쓰기에 실패하면 경고하고, 목록에는 남되 새로고침하면 사라진다고 말한다', async () => {
    stubMomentsWriteFailure()
    const s = boot()
    await playFromStart(s, 30)
    await beginCapture(s)
    await saveCapture(s, '메모')

    const feedback = captureFeedback(s)
    expect(feedback?.classes()).toContain('is-warning')
    expect(feedback?.text()).toContain('저장하지 못했어요')
    expect(feedback?.text()).toContain('저장 공간이 부족')
    expect(feedback?.text()).toContain('새로고침하면 사라집니다')
    expect(feedback?.text()).not.toContain('저장했어요')
    // 메모리에는 들어갔다.
    expect(s.wrapper.findAll('.moment')).toHaveLength(1)
    expect(s.wrapper.get('.moments-status').text()).toContain('저장에 실패했습니다')
  })

  it('protected — 배너로 알리고, 저장해도 원본을 덮어쓰지 않는다', async () => {
    globalThis.localStorage.setItem(STORAGE_KEYS.moments, '{깨진 값')
    const s = boot()

    expect(s.wrapper.get('.moments-status').text()).toContain('Moments 자동 저장이 중단')
    expect(s.wrapper.get('.moments-status').text()).toContain('원본은 보존 중')

    await playFromStart(s, 30)
    await beginCapture(s)
    await saveCapture(s, '메모리만')

    expect(captureFeedback(s)?.text()).toContain('보호하는 중')
    expect(captureFeedback(s)?.classes()).toContain('is-warning')
    expect(rawMoments()).toBe('{깨진 값')
  })

  it('unavailable — 배너로 알리고 저장 결과도 경고다', async () => {
    stubLocalStorage({
      get() {
        throw new Error('blocked')
      },
    })
    const s = boot({ library: false })

    expect(s.wrapper.get('.moments-status').text()).toContain('저장소를 쓸 수 없습니다')
    // 라이브러리도 저장소를 못 쓰므로 메모리에 목록을 만들어 재생한다.
    s.library.createPlaylist('MEM')
    const listId = s.library.selectedPlaylistId ?? ''
    s.library.addTrack(listId, { videoId: A, title: 'Alpha' })
    await nextTick()
    await playFromStart(s, 30)
    await beginCapture(s)
    await saveCapture(s)

    expect(captureFeedback(s)?.text()).toContain('브라우저 저장소를 쓸 수 없어요')
  })

  it('정상 상태에서는 배너가 비어 있다', () => {
    const s = boot()

    expect(s.wrapper.get('.moments-status').text()).toBe('')
  })
})

/* ================================================================== *
 * C. 목록 (F14)
 * ================================================================== */

describe('C. Moments 목록', () => {
  it('비었을 때 안내하고, 거를 것도 접을 것도 그리지 않는다', () => {
    const s = boot()

    expect(widget(s).get('.empty').text()).toContain('아직 저장한 순간이 없어요')
    expect(widget(s).find('.filter').exists()).toBe(false)
    expect(widget(s).find('.expand-toggle').exists()).toBe(false)
  })

  it('개수를 머리말과 거르기 단추에 보인다', async () => {
    seedMoments([
      moment({ id: '1' }),
      moment({ id: '2', videoId: B, title: 'Bravo' }),
      moment({ id: '3', atSeconds: 99 }),
    ])
    const s = boot()
    await playFromStart(s, 5)

    expect(widget(s).get('.widget-sub').text()).toContain('3개')
    const chips = widget(s)
      .findAll('.chip')
      .map((chip) => chip.text())
    expect(chips).toEqual(['이 곡 2', '전체 3'])
  })

  it('지금 곡의 묶음을 강조한다 — 색만이 아니라 글로도', async () => {
    seedMoments([moment({ id: '1' }), moment({ id: '2', videoId: B, title: 'Bravo' })])
    const s = boot()
    await playFromStart(s, 5)

    const current = widget(s)
      .findAll('.moment-group')
      .filter((g) => g.attributes('aria-current') === 'true')
    expect(current).toHaveLength(1)
    expect(current[0]?.get('.group-title').text()).toBe('Alpha')
    expect(current[0]?.get('.group-meta').text()).toContain('재생 중')
  })

  it('이 곡만 보기와 전체 보기', async () => {
    seedMoments([moment({ id: '1' }), moment({ id: '2', videoId: B, title: 'Bravo' })])
    const s = boot()

    // 재생 중인 곡이 없으면 "이 곡" 은 고를 수 없다.
    expect(widget(s).findAll('.chip')[0]?.attributes('disabled')).toBeDefined()

    await playFromStart(s, 5)
    await widget(s).findAll('.chip')[0]?.trigger('click')

    expect(widget(s).findAll('.chip')[0]?.attributes('aria-pressed')).toBe('true')
    expect(
      widget(s)
        .findAll('.group-title')
        .map((t) => t.text()),
    ).toEqual(['Alpha'])

    // 곡이 바뀌면 그 곡의 순간으로 바뀐다.
    await nextTrack(s)
    expect(
      widget(s)
        .findAll('.group-title')
        .map((t) => t.text()),
    ).toEqual(['Bravo'])

    await nextTrack(s)
    expect(widget(s).get('.empty').text()).toContain('이 곡에 저장한 순간이 없어요')

    await widget(s).findAll('.chip')[1]?.trigger('click')
    expect(widget(s).findAll('.group-title')).toHaveLength(2)
  })

  it('영상은 가장 최근에 만든 순, 안에서는 시점 오름차순으로 보인다', () => {
    seedMoments([
      moment({ id: 'a-90', atSeconds: 90, createdAt: '2026-11-10T01:00:00Z' }),
      moment({
        id: 'b-1',
        videoId: B,
        title: 'Bravo',
        atSeconds: 1,
        createdAt: '2026-11-10T02:00:00Z',
      }),
      moment({ id: 'a-5', atSeconds: 5, createdAt: '2026-11-10T03:00:00Z' }),
    ])
    const s = boot()

    const groups = widget(s).findAll('.moment-group')
    expect(groups.map((g) => g.get('.group-title').text())).toEqual(['Alpha', 'Bravo'])
    expect(groups[0]?.findAll('.moment-time').map((t) => t.text())).toEqual(['0:05', '1:30'])
    // 저장 순서는 추가 순서 그대로다.
    expect(s.moments.moments.map((m) => m.id)).toEqual(['a-90', 'b-1', 'a-5'])
  })

  it('제목 3단 — 라이브러리 현재 제목 · 스냅샷 · 대체 표기', async () => {
    seedMoments([
      moment({ id: 'lib', videoId: A, title: 'Old Alpha' }),
      moment({
        id: 'snap',
        videoId: GONE,
        title: 'Deleted Song',
        createdAt: '2026-11-10T00:30:00Z',
      }),
      moment({ id: 'none', videoId: 'yyyyyyyyyyy', title: '', createdAt: '2026-11-10T00:10:00Z' }),
    ])
    const s = boot()
    const titles = () =>
      widget(s)
        .findAll('.group-title')
        .map((t) => t.text())

    // 1단: 라이브러리에 있다 — 스냅샷이 아니라 지금 이름이다.
    expect(titles()).toContain('Alpha')
    // 2단: 라이브러리에 없다 — 저장 당시 이름. 목록에 없다고 알린다.
    expect(titles()).toContain('Deleted Song')
    // 3단: 스냅샷도 없다.
    expect(titles()).toContain('YouTube · yyyyyyyyyyy')
    const gone = widget(s)
      .findAll('.moment-group')
      .find((g) => g.text().includes('Deleted Song'))
    expect(gone?.get('.group-meta').text()).toContain('목록에 없음')

    // 트랙 이름을 바꾸면 따라간다 (표시 시점의 파생값).
    s.library.renameTrack('list', 't-a', 'Alpha (Live)')
    await nextTick()
    expect(titles()).toContain('Alpha (Live)')
    // 저장된 스냅샷은 바꾸지 않는다.
    expect(s.moments.getMoment('lib')?.title).toBe('Old Alpha')

    // 트랙을 지우면 스냅샷으로 내려간다. 순간은 남는다.
    s.library.removeTrack('list', 't-a')
    await nextTick()
    expect(titles()).toContain('Old Alpha')
    expect(s.moments.count).toBe(3)
  })

  it('메모는 글자로만 보인다 — HTML 로 해석하지 않는다', () => {
    const note = '<b>굵게</b><img src=x onerror="window.__pwned=1">'
    seedMoments([moment({ note })])
    const s = boot()

    const cell = widget(s).get('.moment-note')
    expect(cell.text()).toBe(note)
    expect(widget(s).findAll('b, img')).toHaveLength(0)
    expect((window as unknown as { __pwned?: number }).__pwned).toBeUndefined()
  })

  it('여러 줄 메모는 첫 줄만 보이고, 전체는 title 로 볼 수 있다', () => {
    seedMoments([moment({ note: '첫 줄\n둘째 줄' })])
    const s = boot()

    expect(widget(s).get('.moment-note').text()).toBe('첫 줄')
    expect(widget(s).get('.moment-note').attributes('title')).toBe('첫 줄\n둘째 줄')
  })

  it('메모가 없으면 "메모 없음" 을 흐리게 보인다', () => {
    seedMoments([moment({ note: '' })])
    const s = boot()

    expect(widget(s).get('.moment-note').text()).toBe('메모 없음')
    expect(widget(s).get('.moment-note').classes()).toContain('is-empty')
  })

  it('접기·펼치기는 좁은 화면용 토글이다 — 상태를 aria-expanded 로 알린다', async () => {
    seedMoments([moment()])
    const s = boot()
    const toggle = widget(s).get('.expand-toggle')

    expect(toggle.attributes('aria-expanded')).toBe('false')
    expect(toggle.attributes('aria-controls')).toBe('moments-list')
    expect(widget(s).classes()).toContain('is-collapsed')

    await toggle.trigger('click')
    expect(toggle.attributes('aria-expanded')).toBe('true')
    expect(widget(s).classes()).not.toContain('is-collapsed')
  })
})

/* ================================================================== *
 * D. 수정·삭제 (F16)
 * ================================================================== */

describe('D. 메모 수정과 삭제', () => {
  it('✎ 로 메모를 고친다 — 저장하면 바뀌고 ✎ 로 포커스가 돌아온다', async () => {
    seedMoments([moment({ id: 'x', note: '처음' })])
    const s = boot()

    await widget(s).get('[data-moment-edit="x"]').trigger('click')
    await nextTick()
    const field = widget(s).get('#moment-note-x')
    expect((field.element as HTMLTextAreaElement).value).toBe('처음')
    expect(document.activeElement).toBe(field.element)

    await field.setValue('고친 메모')
    await widget(s).get('.edit-form').trigger('submit')
    await nextTick()

    expect(s.moments.getMoment('x')?.note).toBe('고친 메모')
    expect(listFeedback(s)?.text()).toContain('메모를 고쳤어요')
    expect(document.activeElement).toBe(widget(s).get('[data-moment-edit="x"]').element)
  })

  it('수정을 취소하면 메모가 그대로다', async () => {
    seedMoments([moment({ id: 'x', note: '처음' })])
    const s = boot()
    const before = rawMoments()

    await widget(s).get('[data-moment-edit="x"]').trigger('click')
    await widget(s).get('#moment-note-x').setValue('버릴 메모')
    const cancel = widget(s)
      .findAll('.edit-form button')
      .find((b) => b.text() === '취소')
    await cancel?.trigger('click')

    expect(s.moments.getMoment('x')?.note).toBe('처음')
    expect(rawMoments()).toBe(before)
    expect(widget(s).find('.edit-form').exists()).toBe(false)
  })

  it('수정도 500자를 넘기면 저장하지 않는다', async () => {
    seedMoments([moment({ id: 'x', note: '처음' })])
    const s = boot()

    await widget(s).get('[data-moment-edit="x"]').trigger('click')
    await widget(s)
      .get('#moment-note-x')
      .setValue('나'.repeat(MAX_MOMENT_NOTE_LENGTH + 1))
    await widget(s).get('.edit-form').trigger('submit')

    expect(s.moments.getMoment('x')?.note).toBe('처음')
    expect(widget(s).get('.edit-form .error-msg').text()).toContain('500자까지')
  })

  it('× 는 확인 없이 지우지 않는다 — 취소하면 남는다', async () => {
    seedMoments([moment({ id: 'x' })])
    const s = boot()

    await widget(s).get('[data-moment-remove="x"]').trigger('click')

    const confirm = widget(s).get('[role="alertdialog"]')
    expect(confirm.text()).toContain('지울까요')
    expect(s.moments.count).toBe(1)

    const cancel = confirm.findAll('button').find((b) => b.text() === '취소')
    await cancel?.trigger('click')
    await nextTick()

    expect(s.moments.count).toBe(1)
    expect(widget(s).find('[role="alertdialog"]').exists()).toBe(false)
    expect(document.activeElement).toBe(widget(s).get('[data-moment-remove="x"]').element)
  })

  it('확인하면 그 순간만 지운다 — 다른 순간과 라이브러리는 그대로다', async () => {
    seedMoments([
      moment({ id: 'keep-1', atSeconds: 5 }),
      moment({ id: 'gone', atSeconds: 10 }),
      moment({ id: 'keep-2', videoId: B, title: 'Bravo' }),
    ])
    const s = boot()
    const libraryBefore = rawLibrary()

    await widget(s).get('[data-moment-remove="gone"]').trigger('click')
    const remove = widget(s)
      .get('[role="alertdialog"]')
      .findAll('button')
      .find((b) => b.text() === '삭제')
    await remove?.trigger('click')
    await nextTick()

    expect(s.moments.moments.map((m) => m.id)).toEqual(['keep-1', 'keep-2'])
    expect(JSON.parse(rawMoments() as string).data).toHaveLength(2)
    expect(rawLibrary()).toBe(libraryBefore)
    expect(listFeedback(s)?.text()).toContain('순간을 지웠어요')
  })

  it('보호 상태에서 지우면 저장되지 않았고 새로고침하면 돌아온다고 말한다', async () => {
    const raw = JSON.stringify({
      version: MOMENTS_STORAGE_VERSION,
      data: [moment({ id: 'x' }), { id: 'broken' }],
    })
    globalThis.localStorage.setItem(STORAGE_KEYS.moments, raw)
    const s = boot()

    await widget(s).get('[data-moment-remove="x"]').trigger('click')
    const remove = widget(s)
      .get('[role="alertdialog"]')
      .findAll('button')
      .find((b) => b.text() === '삭제')
    await remove?.trigger('click')

    expect(listFeedback(s)?.classes()).toContain('is-warning')
    expect(listFeedback(s)?.text()).toContain('새로고침하면 다시 나타납니다')
    expect(rawMoments()).toBe(raw)
  })

  it('메모를 고치는 중 다른 줄을 지우려 하면 폼을 닫는다 — 두 폼이 겹치지 않는다', async () => {
    seedMoments([moment({ id: 'x' }), moment({ id: 'y', atSeconds: 20 })])
    const s = boot()

    await widget(s).get('[data-moment-edit="x"]').trigger('click')
    await widget(s).get('[data-moment-remove="y"]').trigger('click')

    expect(widget(s).find('.edit-form').exists()).toBe(false)
    expect(widget(s).find('[role="alertdialog"]').exists()).toBe(true)
  })
})

/* ================================================================== *
 * E. 재생 (F15)
 * ================================================================== */

describe('E. Moment 로 재생', () => {
  it('지금 곡의 순간이면 다시 적재하지 않고 그 시점으로 옮긴다', async () => {
    seedMoments([moment({ id: 'x', atSeconds: 83 })])
    const s = boot()
    await playFromStart(s, 5)
    const loadsBefore = s.fake.calls.load.length

    await widget(s).get('[data-moment-play="x"]').trigger('click')
    await flushPromises()

    expect(s.fake.calls.seek).toEqual([83])
    expect(s.fake.calls.play).toBe(1)
    expect(s.fake.calls.load).toHaveLength(loadsBefore)
    expect(listFeedback(s)?.text()).toBe('')
  })

  it('다른 곡의 순간이면 그 시점부터 적재하고, 듣던 큐는 그대로 둔다', async () => {
    seedMoments([moment({ id: 'x', videoId: C, title: 'Charlie', atSeconds: 61 })])
    const s = boot()
    await playFromStart(s, 5)
    const queueBefore = s.playback.queue.map((track) => track.id)

    await widget(s).get('[data-moment-play="x"]').trigger('click')
    await flushPromises()

    expect(last(s.fake.calls.load)).toEqual({ videoId: C, autoplay: true, startSeconds: 61 })
    expect(s.fake.calls.seek).toEqual([])
    expect(s.playback.queue.map((track) => track.id)).toEqual(queueBefore)
    expect(s.playback.currentTrack?.title).toBe('Charlie')
  })

  it('라이브러리에서 지운 영상의 순간도 목록에 남고 재생된다 — 그 한 곡으로', async () => {
    seedMoments([moment({ id: 'x', videoId: GONE, title: 'Deleted Song', atSeconds: 42 })])
    const s = boot()

    expect(
      widget(s)
        .findAll('.group-title')
        .map((t) => t.text()),
    ).toEqual(['Deleted Song'])
    await widget(s).get('[data-moment-play="x"]').trigger('click')
    await flushPromises()

    expect(s.fake.calls.load).toEqual([{ videoId: GONE, autoplay: true, startSeconds: 42 }])
    expect(s.playback.queue).toHaveLength(1)
    expect(s.playback.currentTrack?.title).toBe('Deleted Song')
  })

  it('0초 순간은 처음부터가 아니라 "0초부터" 로 적재한다', async () => {
    seedMoments([moment({ id: 'x', videoId: B, title: 'Bravo', atSeconds: 0 })])
    const s = boot()

    await widget(s).get('[data-moment-play="x"]').trigger('click')
    await flushPromises()

    expect(s.fake.calls.load).toEqual([{ videoId: B, autoplay: true, startSeconds: 0 }])
  })

  it('플레이어가 가려져 있으면 다른 재생과 같은 문구로 거절하고 아무것도 틀지 않는다', async () => {
    seedMoments([moment({ id: 'x', videoId: B, title: 'Bravo', atSeconds: 30 })])
    const s = boot()
    setPlayerRect(HIDDEN_RECT)

    await widget(s).get('[data-moment-play="x"]').trigger('click')
    await flushPromises()

    expect(listFeedback(s)?.text()).toBe(PLAY_REFUSED_HIDDEN_MESSAGE)
    expect(listFeedback(s)?.classes()).toContain('is-warning')
    expect(s.fake.calls.load).toEqual([])
    expect(s.fake.calls.seek).toEqual([])
    expect(s.playback.queue).toEqual([])
  })

  it('좁은 화면에서 시트가 플레이어를 덮고 있으면 먼저 비켜준 뒤 재생한다 (M7-2)', async () => {
    installMatchMedia(true)
    seedMoments([moment({ id: 'x', videoId: B, title: 'Bravo', atSeconds: 30 })])
    const s = boot()
    // 시트가 화면 하단 700px 을 덮는다 — 플레이어(120~425)까지 덮는다.
    setRectOverride('#record-library-drawer', sheetRect(700))
    await s.wrapper.get('.playlist-tile .playlist-open').trigger('click')
    await flushPromises()
    expect(s.wrapper.get('#record-library-drawer').attributes('hidden')).toBeUndefined()

    await widget(s).get('[data-moment-play="x"]').trigger('click')
    await flushPromises()

    // 시트가 닫혔고(가림 0), 그 뒤에 가드를 통과해 재생됐다. 가드를 건너뛴 것이 아니다.
    expect(s.wrapper.get('#record-library-drawer').attributes('hidden')).toBeDefined()
    expect(s.fake.calls.load).toEqual([{ videoId: B, autoplay: true, startSeconds: 30 }])
  })

  it('비켜줘도 여전히 가려져 있으면 거절한다 — 숨은 iframe 을 틀지 않는다', async () => {
    installMatchMedia(true)
    seedMoments([moment({ id: 'x', videoId: B, title: 'Bravo', atSeconds: 30 })])
    const s = boot()
    // 시트와 무관하게 플레이어 자체가 display: none 이다.
    setPlayerRect(HIDDEN_RECT)

    await widget(s).get('[data-moment-play="x"]').trigger('click')
    await flushPromises()

    expect(listFeedback(s)?.text()).toBe(PLAY_REFUSED_HIDDEN_MESSAGE)
    expect(s.fake.calls.load).toEqual([])
  })

  it('플레이어가 아직 없으면 성공으로 보이지 않고 이유를 말한다', async () => {
    seedMoments([moment({ id: 'x' })])
    setActivePinia(createPinia())
    useLibraryStore().restore()
    useMomentsStore().restore()
    // 어댑터가 붙지 않은 코디네이터 — 플레이어 영역이 아직 없다.
    const wrapper = mount(MomentsWidget, {
      attachTo: document.body,
      global: { provide: { [PLAYBACK_COORDINATOR as symbol]: createPlaybackCoordinator() } },
    })

    await wrapper.get('[data-moment-play="x"]').trigger('click')
    await flushPromises()

    expect(wrapper.findAll('.feedback')[1]?.text()).toContain('플레이어가 아직 준비되지 않았어요')
  })

  it('재생할 수 없는 영상이면 플레이어의 오류 안내가 뜨고 순간은 지워지지 않는다', async () => {
    seedMoments([moment({ id: 'x', videoId: C, title: 'Charlie', atSeconds: 10 })])
    const s = boot()
    const before = rawMoments()

    await widget(s).get('[data-moment-play="x"]').trigger('click')
    await flushPromises()
    s.fake.emitError({ kind: 'embed-not-allowed', code: 150 })
    await nextTick()

    expect(s.wrapper.get('.player-surface .status').text()).toContain('오류 150')
    expect(s.moments.count).toBe(1)
    expect(rawMoments()).toBe(before)
    // 재생할 수 없으니 그 상태로는 저장 버튼도 꺼진다.
    expect(captureButton(s).attributes('disabled')).toBeDefined()
  })

  it('연달아 누르면 마지막 순간이 이긴다', async () => {
    seedMoments([
      moment({ id: 'b', videoId: B, title: 'Bravo', atSeconds: 10 }),
      moment({ id: 'c', videoId: C, title: 'Charlie', atSeconds: 20 }),
    ])
    const s = boot()

    await widget(s).get('[data-moment-play="b"]').trigger('click')
    await widget(s).get('[data-moment-play="c"]').trigger('click')
    await flushPromises()

    expect(last(s.fake.calls.load)).toEqual({ videoId: C, autoplay: true, startSeconds: 20 })
    expect(s.playback.currentTrack?.videoId).toBe(C)
  })
})

/* ================================================================== *
 * F. 영속 · 테마 · iframe
 * ================================================================== */

describe('F. 영속성 · 테마 · 플레이어 DOM', () => {
  it('저장한 순간이 새로고침 뒤에도 목록에 돌아온다', async () => {
    const s = boot()
    await playFromStart(s, 42)
    await beginCapture(s)
    await saveCapture(s, '다시 보자')
    s.wrapper.unmount()

    const again = boot()

    expect(again.wrapper.findAll('.moment-note').map((n) => n.text())).toEqual(['다시 보자'])
    expect(again.wrapper.get('.moment-time').text()).toBe('0:42')
  })

  it('테마를 바꿔도 목록·쓰던 메모·고정한 시점이 그대로다', async () => {
    seedMoments([moment({ id: 'x', note: '테마와 무관' })])
    const s = boot()
    await playFromStart(s, 42)
    await beginCapture(s)
    await s.wrapper.get('#moment-capture-note').setValue('쓰던 중')

    s.theme.setTheme('kawaii-synth-cassette')
    await nextTick()

    expect(document.documentElement.dataset.theme).toBe('kawaii-synth-cassette')
    expect((s.wrapper.get('#moment-capture-note').element as HTMLTextAreaElement).value).toBe(
      '쓰던 중',
    )
    expect(s.wrapper.get('.capture-target').text()).toContain('0:42')
    expect(s.moments.getMoment('x')?.note).toBe('테마와 무관')
  })

  it('저장·재생·테마 전환·드로어를 거쳐도 플레이어 DOM 은 하나이고 같은 노드다', async () => {
    seedMoments([moment({ id: 'x', videoId: C, title: 'Charlie', atSeconds: 7 })])
    const s = boot()
    const host = s.fake.hostNode
    expect(host).not.toBeNull()

    await playFromStart(s, 12)
    await beginCapture(s)
    await saveCapture(s)
    await widget(s).get('[data-moment-play="x"]').trigger('click')
    await flushPromises()
    s.theme.setTheme('kawaii-synth-cassette')
    await nextTick()
    await s.wrapper.get('.playlist-tile .playlist-open').trigger('click')
    await s.wrapper.get('.drawer .close').trigger('click')
    await nextTick()

    expect(s.fake.hostNode).toBe(host)
    expect(s.fake.calls.mount).toBe(1)
    expect(s.fake.calls.destroy).toBe(0)
    expect(document.querySelectorAll('[data-fake-player-host]')).toHaveLength(1)
  })

  it('Moment 를 저장·수정·삭제해도 라이브러리 원문은 바뀌지 않는다', async () => {
    const s = boot()
    const before = rawLibrary()
    await playFromStart(s, 10)
    await beginCapture(s)
    await saveCapture(s, '하나')
    const id = s.moments.moments[0]?.id ?? ''

    await widget(s).get(`[data-moment-edit="${id}"]`).trigger('click')
    await widget(s).get(`#moment-note-${id}`).setValue('둘')
    await widget(s).get('.edit-form').trigger('submit')
    await widget(s).get(`[data-moment-remove="${id}"]`).trigger('click')
    const remove = widget(s)
      .get('[role="alertdialog"]')
      .findAll('button')
      .find((b) => b.text() === '삭제')
    await remove?.trigger('click')

    expect(rawLibrary()).toBe(before)
  })
})

/* ================================================================== *
 * G. 경계
 * ================================================================== */

describe('G. 없는 기능 · 소스 수준 보장', () => {
  /*
   * M8 의 가드 테스트(`record-library-drawer.spec.ts` 24)를 Moments 로 넓힌다.
   * 보호 상태에서도 "복구" · "초기화" · "전부 지우기" 는 없다.
   */
  it('없는 기능의 버튼이 없다 — 전부 지우기 · 시점 편집 · 내보내기 · 복구', async () => {
    globalThis.localStorage.setItem(
      STORAGE_KEYS.moments,
      JSON.stringify({
        version: MOMENTS_STORAGE_VERSION,
        data: [moment({ id: 'x' }), { id: 'bad' }],
      }),
    )
    const s = boot()
    await widget(s).get('[data-moment-edit="x"]').trigger('click')

    // 버튼 이름만 본다. 배너 문구("일부 순간만 복구했습니다")는 버튼이 아니다.
    const labels = widget(s)
      .findAll('button')
      .map((b) => `${b.text()} ${b.attributes('aria-label') ?? ''}`.trim())
    const forbidden = ['전부 지우기', '모두 삭제', '초기화', '복구', '내보내기', '가져오기', '시점']
    expect(labels.filter((label) => forbidden.some((word) => label.includes(word)))).toEqual([])
    expect(labels.every((label) => label !== '')).toBe(true)

    // 시점은 고치지 못한다 (F16). 숫자·시간 입력이 없다 — 메모 칸(textarea)뿐이다.
    expect(widget(s).findAll('input')).toEqual([])
    expect(widget(s).findAll('textarea')).toHaveLength(1)
  })

  it('빈 상태의 위젯에는 저장 버튼 하나만 있다', () => {
    const s = boot()

    expect(
      widget(s)
        .findAll('button')
        .map((b) => b.text().trim()),
    ).toEqual(['＋ 이 순간 저장'])
  })

  it('Moments UI 는 플레이어·YouTube API 를 직접 부르지 않는다', () => {
    for (const file of [
      'src/features/moments/MomentsWidget.vue',
      'src/features/moments/MomentList.vue',
      'src/features/moments/MomentsStatusBanner.vue',
      'src/features/moments/useMomentCapture.ts',
      'src/features/moments/useMomentsBrowser.ts',
      'src/features/moments/momentsView.ts',
      'src/features/moments/momentFeedback.ts',
    ]) {
      const code = stripComments(readSource(file))
      const found = [
        'PlayerAdapter',
        'YT.',
        'getCurrentTime',
        'seekTo',
        'iframe',
        'localStorage',
        'v-html',
        'innerHTML',
      ].filter((word) => code.includes(word))
      // 파일 이름을 함께 남겨 어디서 걸렸는지 보이게 한다.
      expect({ file, found }).toEqual({ file, found: [] })
    }
  })

  it('라이브러리를 고치는 호출이 없다 — 제목을 읽기만 한다', () => {
    const code = stripComments(readSource('src/features/moments/useMomentsBrowser.ts'))

    for (const action of [
      'removeTrack',
      'addTrack',
      'renameTrack',
      'deletePlaylist',
      'replaceAll',
    ]) {
      expect(code).not.toContain(action)
    }
  })

  it('저장 버튼의 활성 판정과 캡처 판정이 같은 값을 본다', () => {
    const capture = stripComments(readSource('src/features/moments/useMomentCapture.ts'))
    const coordinator = stripComments(
      readSource('src/features/playback/createPlaybackCoordinator.ts'),
    )

    expect(capture).toContain('playback.isPositionReliable')
    expect(coordinator).toContain('playback.isPositionReliable')
  })

  it('좁은 화면에서는 플레이어 바로 아래 한 행이다', () => {
    const source = readSource('src/components/layout/WidgetHost.vue')
    const compact = source.slice(source.indexOf('@media (max-width: 1100px)'))

    expect(compact).toMatch(/'player player'\s*'moments moments'/)
    // 자기 행을 가지므로 contain 을 푼다. 풀지 않으면 행 높이가 0 이 된다.
    expect(compact).toMatch(/\[data-widget='moments'\]\s*\{[^}]*contain: none;/)
  })

  it('넓은 화면에서 위젯이 칸 안에서 스크롤하고 토글을 숨긴다', () => {
    const source = readSource('src/features/moments/MomentsWidget.vue')
    const wide = source.slice(source.indexOf('@media (min-width: 1101px)'))

    expect(wide).toContain('overflow-y: auto')
    expect(wide).toMatch(/\.expand-toggle\s*\{\s*display: none;/)
  })

  /*
   * M9-6 성능 — 스크롤바가 폭을 차지하는 환경에서 `overflow-y: auto` 목록은
   * 한 줄만 바뀌어도 전체를 다시 배치했다(1000개에서 550~700ms). 자리를 고정해
   * 두면 10ms 다. jsdom 은 레이아웃을 하지 않으므로 그 조건을 고정한다.
   */
  it('목록 스크롤 상자가 스크롤바 자리를 고정해 둔다 (큰 목록의 재배치 비용)', () => {
    const source = readSource('src/features/moments/MomentsWidget.vue')
    const block = /\.list-scroll \{[^}]*\}/.exec(source)?.[0] ?? ''

    expect(block).toContain('overflow-y: auto')
    expect(block).toContain('scrollbar-gutter: stable')
  })
})
