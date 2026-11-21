/**
 * Music Moments UI — 대시보드 "이 곡의 Moments" (M11-3) 와 보관함 Moments 탭 (M11-2).
 *
 * **앱 전체를 마운트**해 사용자가 하는 순서대로 밟는다. 외부 플레이어는 `FakePlayerAdapter` 가 맡고,
 * 테스트가 "플레이어가 보고했다" 를 흘려보낸다. 실제 YouTube 재생은 브라우저 검증이 따로 본다.
 *
 * M9 의 이 파일은 위젯 하나에 저장 폼 · 목록 · 거르기 · 수정 · 삭제가 다 있었다. M11 에서 저장은
 * **빠른 저장**(누르면 바로 저장, 메모는 그다음)이 됐고(D2), 목록 · 수정 · 삭제는 보관함으로 갔다
 * (ADR 0027). 시험도 그 자리로 옮겼다 — 같은 보장을 새 자리에서 다시 고정한다.
 *
 *   A  빠른 저장 (F13 · D2) — 시점 고정 · 가짜 0초 · 위치 잃음 · 연속 클릭 · 저장 중
 *   B  저장 뒤 메모 — 추가 · 고치기 · 500자 · 취소 · 곡이 바뀐 동안 · 충돌
 *   C  저장 상태 — 실패 · protected · unavailable · 곡이 바뀌면 지난 안내를 지운다
 *   D  대시보드 미리보기 — 이 곡 최대 3개 · 재생 · 모두 보기 · 안쪽 스크롤 없음
 *   E  보관함 Moments 탭 (F14 · F16) — 묶음 · 정렬 · 거르기 · 제목 3단 · 관리(수정 · 삭제)
 *   F  재생 (F15) — 같은 곡 · 다른 곡 · 지운 곡 · 0초 · 가려짐 · 비켜주기 · 실패 · 연속
 *   G  영속 · 테마 · iframe · 소스 수준
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
  uninstallMatchMedia,
  uninstallPlayerRect,
  VISIBLE_RECT,
} from '../support/playerLayout'
import { archiveCloseButton } from '../support/archiveClose'

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
const previewFeedback = (s: Session) => s.wrapper.findAll('.moments-widget .feedback')[1]

/** 목록 전체 재생 → 플레이어 준비 → 실제 재생 → 위치 보고. */
async function playFromStart(s: Session, seconds: number): Promise<void> {
  await s.wrapper.get('.now-playlist .play-all').trigger('click')
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

/** ＋ 이 순간 저장 — 시점을 잡는다 (아직 저장하지 않는다 · M11-7C 저장 모델 B). */
async function captureNow(s: Session): Promise<void> {
  await captureButton(s).trigger('click')
  await nextTick()
}

const draftForm = (s: Session) => widget(s).get('.draft-form')
const noteField = (s: Session) => s.wrapper.get('#dashboard-moment-capture-note')

/** 초안의 Moment 저장. 저장은 탭 간 잠금을 지나 끝난다 (ADR 0025). */
async function saveDraft(s: Session): Promise<void> {
  await draftForm(s).trigger('submit')
  await flushPromises()
  await nextTick()
}

/** 잡고 바로 저장한다 (메모 없음). */
async function quickSave(s: Session): Promise<void> {
  await captureNow(s)
  await saveDraft(s)
}

/** 잡고 메모를 써서 저장한다. */
async function saveWithNote(s: Session, note: string): Promise<void> {
  await captureNow(s)
  await noteField(s).setValue(note)
  await saveDraft(s)
}

/** 보관함의 Moments 탭을 연다 — 헤더 입구로. */
async function openArchiveMoments(s: Session) {
  // M11-7B: 헤더에는 "보관함" 하나다 — 열고, 탭을 고른다.
  if (s.wrapper.get('#archive-panel').attributes('hidden') !== undefined) {
    await s.wrapper.findAll('.app-nav button')[0]?.trigger('click')
    await flushPromises()
  }
  await s.wrapper.get('#archive-tab-moments').trigger('click')
  await flushPromises()
  await nextTick()
  return s.wrapper.get('#archive-panel-moments')
}

const archiveMoments = (s: Session) => s.wrapper.get('#archive-panel-moments')

const VIEW_KEY = { '이 곡': 'current', 전체: 'all', 최근: 'recent' } as const

/** 보관함 Moments 의 보기를 고른다 — 왼쪽 칸의 이 곡 · 전체 · 최근 (M11-7C 순서, ADR 0044 두 칸). */
async function chooseView(s: Session, label: '이 곡' | '전체' | '최근'): Promise<void> {
  const item = archiveMoments(s).find(`.view-item[data-view="${VIEW_KEY[label]}"]`)
  if (!item.exists()) throw new Error(`no view ${label}`)
  await item.trigger('click')
  await nextTick()
}
const archiveFeedback = (s: Session) => archiveMoments(s).get('.feedback')

/**
 * 보관함 Moment 줄의 동작을 쓸 준비 (ADR 0044). M11-3 에서는 "관리" 를 펼쳐야 했지만, 이제 메모 수정 · 공유 ·
 * 삭제가 줄 오른쪽의 아이콘으로 늘 보인다 — 그 줄이 있는지만 확인한다.
 */
async function openMomentManage(s: Session, id: string): Promise<void> {
  archiveMoments(s).get(`[data-moment-edit="${id}"]`)
  await nextTick()
}

beforeEach(() => {
  globalThis.localStorage.clear()
  delete document.documentElement.dataset.theme
  document.documentElement.style.overflow = ''
  installPlayerRect()
})

afterEach(() => {
  stubLocalStorage({ value: realLocalStorage, writable: true })
  globalThis.localStorage.clear()
  uninstallPlayerRect()
  uninstallMatchMedia()
  delete document.documentElement.dataset.theme
  document.documentElement.style.overflow = ''
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

/* ================================================================== *
 * A. 잡기 → 저장 (M11-7C 저장 모델 B)
 * ================================================================== */

describe('A. 잡기 → Moment 저장 — 누르면 시점만 잡고, 저장은 따로 누른다', () => {
  it('곡이 없으면 저장 버튼이 꺼져 있고 왜 꺼졌는지 말한다', () => {
    const s = boot()

    expect(captureButton(s).attributes('disabled')).toBeDefined()
    // 꺼진 단추로 충분하다 — 설명 글은 두지 않는다 (ADR 0044). 막힌 이유(오류)만 적는다.
    expect(s.wrapper.find('#dashboard-moment-capture-hint').exists()).toBe(false)
    expect(captureButton(s).attributes('aria-describedby')).toBeUndefined()
  })

  it('재생을 요청해도 실제로 재생되기 전에는 꺼져 있다', async () => {
    const s = boot()
    await s.wrapper.get('.now-playlist .play-all').trigger('click')
    await flushPromises()
    s.fake.emitReady()
    s.fake.emitPosition(0)
    await nextTick()

    // 불러오는 중이다. 플레이어가 0 을 보고해도 아직 믿지 않는다.
    expect(s.playback.playerState).toBe('loading')
    expect(captureButton(s).attributes('disabled')).toBeDefined()
    expect(s.wrapper.find('#dashboard-moment-capture-hint').exists()).toBe(false)
  })

  it('누르면 시점을 잡을 뿐 저장하지 않고 음악은 계속된다 — Moment 저장 뒤에만 "저장했어요"', async () => {
    const s = boot()
    await playFromStart(s, 83.7)
    const pausesBefore = s.fake.calls.pause
    const add = vi.spyOn(s.moments, 'add')

    // 누르면 무엇이 되는지는 단추 이름과 다음 화면(메모 칸)이 말한다 — 설명 글은 없다 (ADR 0044).
    expect(s.wrapper.find('#dashboard-moment-capture-hint').exists()).toBe(false)
    await captureNow(s)

    // 아직 아무것도 만들지 않았다.
    expect(s.moments.moments).toEqual([])
    expect(rawMoments()).toBeNull()
    expect(add).not.toHaveBeenCalled()
    expect(s.fake.calls.pause).toBe(pausesBefore)
    expect(s.playback.playerState).toBe('playing')
    // 저장 전 초안 — 시점 · 곡이 보이고 메모 칸으로 간다.
    const target = draftForm(s).get('.note-target').text()
    expect(target).toContain('저장 전')
    expect(target).toContain('1:23')
    expect(target).toContain('Alpha')
    expect(document.activeElement).toBe(noteField(s).element)
    expect(captureFeedback(s)?.text()).toBe(
      '1:23 을 잡았어요 — 메모를 쓰고(선택) Moment 저장을 누르세요.',
    )
    expect(widget(s).find('.capture-button').exists()).toBe(false)

    await saveDraft(s)

    expect(s.moments.moments).toHaveLength(1)
    const saved = s.moments.moments[0] as Moment
    expect(saved).toMatchObject({ videoId: A, atSeconds: 83, title: 'Alpha', note: '' })
    // 초안의 요청 id 로 저장한다 — store 의 호출자 id 계약 (한 번만).
    expect(saved.id).toMatch(/^ext-web-[A-Za-z0-9]{16,}$/)
    expect(add).toHaveBeenCalledTimes(1)
    // 저장소에도 들어갔다 — 메모리만이 아니다.
    expect(JSON.parse(rawMoments() as string).data).toHaveLength(1)
    const feedback = captureFeedback(s)
    expect(feedback?.text()).toBe('1:23 Moment 를 저장했어요 — Alpha')
    expect(feedback?.classes()).not.toContain('is-warning')
    // 양식이 닫히고 포커스가 저장 단추로 돌아온다. 새 줄이 목록에 바로 보이고 강조된다.
    expect(widget(s).find('.draft-form').exists()).toBe(false)
    expect(document.activeElement).toBe(captureButton(s).element)
    const row = widget(s).get(`[data-moment-row="${saved.id}"]`)
    expect(row.classes()).toContain('is-new')
    expect(row.text()).toContain('방금 저장')
    // 메모가 없으면 조용히 "—".
    expect(row.get('.moment-note').text()).toBe('—')
  })

  it('정상적으로 확인된 0초는 유효한 순간이다', async () => {
    const s = boot()
    await playFromStart(s, 0.4)
    await quickSave(s)

    expect(s.moments.moments[0]?.atSeconds).toBe(0)
    expect(captureFeedback(s)?.text()).toContain('0:00')
  })

  /*
   * M9-3 실측: 새 영상을 적재하면 플레이어는 지정 시점으로 가기 전 약 200ms 동안 `0` 을 보고한다 —
   * 영상은 맞고 시간만 틀리다. 그 사이 잡히면 0초짜리 순간이 생긴다.
   */
  it('곡을 바꾸는 중에 보고되는 가짜 0초로는 잡을 수 없다', async () => {
    const s = boot()
    await playFromStart(s, 30)
    await nextTrack(s)

    s.fake.emitStateChange('paused')
    s.fake.emitPosition(0)
    await nextTick()
    expect(captureButton(s).attributes('disabled')).toBeDefined()
    s.fake.emitStateChange('idle')
    s.fake.emitStateChange('loading')
    await nextTick()
    expect(captureButton(s).attributes('disabled')).toBeDefined()

    // 버튼을 우회해 눌러도(이벤트 직접 발생) 잡히지 않는다.
    captureButton(s).element.dispatchEvent(new MouseEvent('click'))
    await flushPromises()
    expect(widget(s).find('.draft-form').exists()).toBe(false)
    expect(s.moments.moments).toEqual([])

    // 실제로 재생이 시작된 뒤에는 그 영상의 위치로 저장된다.
    s.fake.emitPosition(0.2)
    s.fake.emitStateChange('playing')
    await nextTick()
    await quickSave(s)

    expect(s.moments.moments[0]).toMatchObject({ videoId: B, atSeconds: 0, title: 'Bravo' })
  })

  it('버튼이 켜진 뒤 누르기 전에 위치를 잃으면 0 으로 바꾸지 않고 잡지 않는다', async () => {
    const s = boot()
    await playFromStart(s, 30)
    s.fake.emitPosition(null)

    await captureNow(s)

    expect(captureFeedback(s)?.text()).toContain('재생 위치를 확인하지 못했어요')
    expect(widget(s).find('.draft-form').exists()).toBe(false)
    expect(s.moments.moments).toEqual([])
  })

  it('시점은 누른 순간에 고정된다 — 메모를 쓰는 사이 재생이 흘러도 잡은 초로 저장한다', async () => {
    const s = boot()
    await playFromStart(s, 10)
    await captureNow(s)
    s.fake.emitPosition(50)
    await nextTick()
    await noteField(s).setValue('도입부')
    await saveDraft(s)

    expect(s.moments.moments).toHaveLength(1)
    expect(s.moments.moments[0]).toMatchObject({ atSeconds: 10, note: '도입부' })
  })

  it('↻ 다시 잡기는 쓰던 메모를 지키고 시점만 지금으로 바꾼다', async () => {
    const s = boot()
    await playFromStart(s, 10)
    await captureNow(s)
    await noteField(s).setValue('후렴 직전')
    s.fake.emitPosition(50)
    await nextTick()

    await draftForm(s).get('.draft-recapture').trigger('click')
    await nextTick()
    expect(draftForm(s).get('.note-target').text()).toContain('0:50')
    expect((noteField(s).element as HTMLTextAreaElement).value).toBe('후렴 직전')
    expect(captureFeedback(s)?.text()).toBe(
      '시점을 0:50 으로 다시 잡았어요 — 아직 저장하지 않았어요.',
    )
    expect(s.moments.moments).toEqual([])

    await saveDraft(s)
    expect(s.moments.moments).toHaveLength(1)
    expect(s.moments.moments[0]).toMatchObject({ atSeconds: 50, note: '후렴 직전' })
  })

  it('취소하면 아무것도 만들지 않는다 — 쓰던 메모도 버린다', async () => {
    const s = boot()
    await playFromStart(s, 10)
    await captureNow(s)
    await noteField(s).setValue('버릴 메모')

    await draftForm(s).get('.draft-cancel').trigger('click')
    await nextTick()

    expect(s.moments.moments).toEqual([])
    expect(rawMoments()).toBeNull()
    expect(widget(s).find('.draft-form').exists()).toBe(false)
    expect(document.activeElement).toBe(captureButton(s).element)
    expect(captureFeedback(s)?.text()).toBe('취소했어요 — 저장하지 않았어요.')

    // 다시 잡으면 빈 메모로 시작한다.
    await captureNow(s)
    expect((noteField(s).element as HTMLTextAreaElement).value).toBe('')
  })

  it('저장이 끝나기 전에는 "저장 중…" 이고, 여러 번 눌러도 한 번만 저장한다 (초안 D)', async () => {
    const s = boot()
    await playFromStart(s, 40)
    let release: (() => void) | undefined
    const original = s.moments.add
    const gate = new Promise<void>((resolveGate) => {
      release = resolveGate
    })
    const add = vi.spyOn(s.moments, 'add').mockImplementation(async (input) => {
      await gate
      return original(input)
    })

    await captureNow(s)
    await draftForm(s).trigger('submit')
    await nextTick()
    const save = draftForm(s).get('.draft-save')
    expect(save.text()).toBe('저장 중…')
    expect(save.attributes('disabled')).toBeDefined()
    expect(save.attributes('aria-busy')).toBe('true')
    expect(draftForm(s).get('.draft-cancel').attributes('disabled')).toBeDefined()
    expect(draftForm(s).get('.draft-recapture').attributes('disabled')).toBeDefined()
    // 막힌 단추를 우회해도(제출 · Enter) 두 번째 요청은 가지 않는다.
    await draftForm(s).trigger('submit')
    await noteField(s).trigger('keydown', { key: 'Enter' })
    await nextTick()
    expect(add).toHaveBeenCalledTimes(1)

    release?.()
    await flushPromises()
    await nextTick()
    expect(captureButton(s).text()).toBe('＋ 이 순간 저장')
    expect(captureFeedback(s)?.text()).toContain('저장했어요')
    expect(s.moments.moments).toHaveLength(1)
  })

  it('재생이 흘러 다른 초가 되면 또 저장된다 — 한 영상에 여러 순간', async () => {
    const s = boot()
    await playFromStart(s, 10)
    await quickSave(s)
    s.fake.emitPosition(50)
    await nextTick()
    await quickSave(s)

    expect(s.moments.moments.map((m) => m.atSeconds)).toEqual([10, 50])
    expect(new Set(s.moments.moments.map((m) => m.id)).size).toBe(2)
  })

  it('같은 초를 일부러 다시 잡아 저장하면 다른 순간이다 — 메모가 다를 수 있다 (ADR 0019)', async () => {
    const s = boot()
    await playFromStart(s, 20)
    await saveWithNote(s, '처음 느낌')
    await saveWithNote(s, '다시 들어 보니')

    expect(s.moments.moments.map((m) => [m.atSeconds, m.note])).toEqual([
      [20, '처음 느낌'],
      [20, '다시 들어 보니'],
    ])
  })
})

/* ================================================================== *
 * B. 초안의 메모 · 초안 사례
 * ================================================================== */

describe('B. 초안의 메모 — 저장 전에 쓰고, 초안은 하나다', () => {
  it('메모를 쓰고 저장하면 그 메모로 한 번에 저장된다', async () => {
    const s = boot()
    await playFromStart(s, 42)
    await saveWithNote(s, '여기부터 좋다')

    expect(s.moments.moments).toHaveLength(1)
    expect(s.moments.moments[0]).toMatchObject({ atSeconds: 42, note: '여기부터 좋다' })
    expect(widget(s).get('.moment-row.is-new .moment-note').text()).toBe('여기부터 좋다')
  })

  it('Enter 는 저장, Shift+Enter 와 한글 조합 중의 Enter 는 저장하지 않는다', async () => {
    const s = boot()
    await playFromStart(s, 42)
    await captureNow(s)
    await noteField(s).setValue('한 줄')

    await noteField(s).trigger('keydown', { key: 'Enter', shiftKey: true })
    await noteField(s).trigger('keydown', { key: 'Enter', isComposing: true })
    await noteField(s).trigger('keydown', { key: 'Enter', keyCode: 229 })
    await flushPromises()
    expect(s.moments.moments).toEqual([])

    await noteField(s).trigger('keydown', { key: 'Enter' })
    await flushPromises()
    await nextTick()
    expect(s.moments.moments[0]?.note).toBe('한 줄')
  })

  it('메모는 500자까지다 — 입력란이 막고, 넘긴 값은 저장하지 않고 초안을 지킨다', async () => {
    const s = boot()
    await playFromStart(s, 10)
    await captureNow(s)

    const field = noteField(s)
    expect(field.attributes('maxlength')).toBe(String(MAX_MOMENT_NOTE_LENGTH))
    await field.setValue('가'.repeat(MAX_MOMENT_NOTE_LENGTH + 1))
    expect(s.wrapper.get('#dashboard-moment-capture-count').text()).toContain('501 / 500')
    expect(draftForm(s).get('.draft-save').attributes('disabled')).toBeDefined()

    await saveDraft(s)
    expect(s.moments.moments).toEqual([])
    expect(widget(s).find('.draft-form').exists()).toBe(true)

    await field.setValue('가'.repeat(MAX_MOMENT_NOTE_LENGTH))
    await saveDraft(s)
    expect(s.moments.moments[0]?.note).toHaveLength(MAX_MOMENT_NOTE_LENGTH)
  })

  it('초안 A — 쓰는 중에 곡이 바뀌어도 처음 곡 · 시점으로 저장하고, 바뀌었다고 알린다', async () => {
    const s = boot()
    await playFromStart(s, 42)
    await captureNow(s)
    await noteField(s).setValue('A 의 메모')

    await nextTrack(s)
    s.fake.emitStateChange('playing')
    s.fake.emitPosition(5)
    await nextTick()

    expect(draftForm(s).get('.stale-note').text()).toContain('곡이 바뀌었어요')
    expect(
      draftForm(s)
        .get('.draft-save')
        .element.compareDocumentPosition(draftForm(s).get('.stale-note').element) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    expect(draftForm(s).get('.note-target').text()).toContain('Alpha')
    expect(draftForm(s).get('.note-target').text()).toContain('0:42')
    await saveDraft(s)

    expect(s.moments.moments[0]).toMatchObject({ videoId: A, atSeconds: 42, note: 'A 의 메모' })
    expect(captureFeedback(s)?.text()).toBe('0:42 Moment 를 저장했어요 — Alpha')
  })

  it('초안 C — 다른 탭이 먼저 바꿨으면 저장하지 않고 초안과 메모를 지킨다 · 다시 저장하면 한 번만 (ADR 0025)', async () => {
    const s = boot()
    await playFromStart(s, 30)
    await captureNow(s)
    await noteField(s).setValue('이 탭의 메모')

    // 다른 탭이 Moments 를 저장했다 (이 탭은 아직 모른다).
    seedMoments([moment({ id: 'other', videoId: B, note: '다른 탭' })])
    const before = rawMoments()
    await saveDraft(s)

    expect(rawMoments()).toBe(before)
    expect(captureFeedback(s)?.text()).toContain('다른 탭에서 Moments 가 바뀌어')
    expect(captureFeedback(s)?.text()).toContain('초안과 메모는 그대로')
    expect(captureFeedback(s)?.text()).not.toContain('저장했어요')
    expect((noteField(s).element as HTMLTextAreaElement).value).toBe('이 탭의 메모')
    // 다시 누르면 최신 위에 한 번만 저장된다.
    await saveDraft(s)
    expect(s.moments.moments.map((m) => m.note)).toEqual(['다른 탭', '이 탭의 메모'])
  })

  it('초안 C — 다른 탭이 저장하는 중(잠금 대기)이면 성공으로 보이지 않고 초안을 지킨다', async () => {
    const s = boot()
    await playFromStart(s, 30)
    await captureNow(s)
    await noteField(s).setValue('기다린 메모')
    vi.spyOn(s.moments, 'add').mockResolvedValueOnce({ ok: false, reason: 'busy' })

    await saveDraft(s)
    expect(captureFeedback(s)?.text()).toContain('다른 39page 탭이 저장하는 중')
    expect(captureFeedback(s)?.classes()).toContain('is-warning')
    expect(s.moments.moments).toEqual([])
    expect((noteField(s).element as HTMLTextAreaElement).value).toBe('기다린 메모')

    await saveDraft(s)
    expect(s.moments.moments.map((m) => m.note)).toEqual(['기다린 메모'])
  })

  it('초안 E · B — 대시보드에서 잡은 초안을 보관함 이 곡에서 이어 쓰고, 닫아도 잃지 않는다', async () => {
    const s = boot()
    await playFromStart(s, 42)
    await captureNow(s)
    await noteField(s).setValue('대시보드에서')

    // 보관함을 연다 — 영상 띠에는 저장이 없지만 초안이 있다고 말한다.
    await openArchiveMoments(s)
    await chooseView(s, '전체')
    const notice = widget(s).get('.draft-notice')
    expect(notice.text()).toContain('저장 전 초안 0:42')
    await notice.get('button').trigger('click')
    await flushPromises()
    await nextTick()

    // 이 곡 보기로 와서 같은 초안의 메모 칸에 포커스가 있다.
    const archiveNote = archiveMoments(s).get('#archive-moment-capture-note')
    expect(archiveMoments(s).get('.view-item[aria-current="true"]').attributes('data-view')).toBe(
      'current',
    )
    expect(document.activeElement).toBe(archiveNote.element)
    expect((archiveNote.element as HTMLTextAreaElement).value).toBe('대시보드에서')
    await archiveNote.setValue('보관함에서 고침')

    // 닫아도 초안은 남는다 — 대시보드가 그대로 보인다.
    await archiveCloseButton(s.wrapper).trigger('click')
    await flushPromises()
    expect((noteField(s).element as HTMLTextAreaElement).value).toBe('보관함에서 고침')
    expect(s.moments.moments).toEqual([])

    // 다시 열어 보관함에서 저장한다 — 그 줄이 강조되고, 영상 띠에도 바로 보인다.
    await openArchiveMoments(s)
    await archiveMoments(s).get('.current-head .draft-form').trigger('submit')
    await flushPromises()
    await nextTick()
    const saved = s.moments.moments[0] as Moment
    expect(saved).toMatchObject({ atSeconds: 42, note: '보관함에서 고침' })
    expect(archiveMoments(s).get(`[data-moment-id="${saved.id}"]`).classes()).toContain('is-new')
    expect(archiveMoments(s).get('.current-head .feedback').text()).toBe(
      '0:42 Moment 를 저장했어요 — Alpha',
    )
    expect(widget(s).find(`[data-moment-row="${saved.id}"]`).exists()).toBe(true)
    expect(widget(s).find('.draft-notice').exists()).toBe(false)
    expect(archiveMoments(s).get('.view-item[data-view="current"] .nav-meta').text()).toBe('1')
  })
})

/* ================================================================== *
 * C. 저장 상태
 * ================================================================== */

describe('C. 저장되지 않은 상태를 저장된 것처럼 보이지 않는다', () => {
  it('쓰기에 실패하면 경고하고, 새로고침하면 사라진다고 말한다 — "저장했어요" 가 아니다', async () => {
    stubMomentsWriteFailure()
    const s = boot()
    await playFromStart(s, 30)
    await quickSave(s)

    const feedback = captureFeedback(s)
    expect(feedback?.classes()).toContain('is-warning')
    expect(feedback?.text()).toContain('저장하지 못했어요')
    expect(feedback?.text()).toContain('저장 공간이 부족')
    expect(feedback?.text()).toContain('새로고침하면 사라집니다')
    expect(feedback?.text()).not.toContain('Moment 를 저장했어요')
    expect(s.wrapper.get('.moments-status').text()).toContain('저장에 실패했습니다')
  })

  it('저장하지 못한 변경이 다른 탭의 저장을 다시 읽으며 사라지면 배너가 알린다 (M10-3 안정화)', async () => {
    const s = boot()
    const stop = s.moments.watchExternalChanges()
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError')
    })
    expect(await s.moments.add({ videoId: A, atSeconds: 4 })).toMatchObject({
      ok: true,
      persisted: false,
    })
    setItem.mockRestore()

    seedMoments([moment({ id: 'other', note: '다른 탭' })])
    globalThis.dispatchEvent(new StorageEvent('storage', { key: STORAGE_KEYS.moments }))
    await nextTick()

    expect(s.moments.moments.map((item) => item.id)).toEqual(['other'])
    expect(s.wrapper.get('.moments-status').text()).toContain('다른 탭의 변경을 불러왔습니다')
    expect(s.wrapper.get('.moments-status').text()).toContain(
      '저장하지 못했던 변경은 반영되지 않았습니다',
    )
    stop()
  })

  it('protected — 배너로 알리고, 저장해도 원본을 덮어쓰지 않는다', async () => {
    globalThis.localStorage.setItem(STORAGE_KEYS.moments, '{깨진 값')
    const s = boot()

    expect(s.wrapper.get('.moments-status').text()).toContain('Moments 자동 저장이 중단')
    await playFromStart(s, 30)
    await quickSave(s)

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
    s.library.createPlaylist('MEM')
    const listId = s.library.selectedPlaylistId ?? ''
    s.library.addTrack(listId, { videoId: A, title: 'Alpha' })
    await nextTick()
    await playFromStart(s, 30)
    await quickSave(s)

    expect(captureFeedback(s)?.text()).toContain('브라우저 저장소를 쓸 수 없어요')
  })

  it('곡이 바뀌면 지난 곡의 저장 안내를 지운다 — 초안이 없을 때만 (M11-3)', async () => {
    const s = boot()
    await playFromStart(s, 30)
    await quickSave(s)
    expect(captureFeedback(s)?.text()).toContain('저장했어요')

    await nextTrack(s)
    await nextTick()
    expect(captureFeedback(s)?.text()).toBe('')

    // 초안이 있으면 지우지 않는다 — 어느 곡 · 몇 초의 초안인지가 남아야 한다.
    s.fake.emitStateChange('playing')
    s.fake.emitPosition(7)
    await nextTick()
    await captureNow(s)
    await nextTrack(s)
    await nextTick()
    expect(captureFeedback(s)?.text()).toContain('0:07 을 잡았어요')
    expect(widget(s).find('.draft-form').exists()).toBe(true)
  })

  it('정상 상태에서는 배너가 비어 있다', () => {
    const s = boot()
    expect(s.wrapper.get('.moments-status').text()).toBe('')
  })
})

/* ================================================================== *
 * D. 대시보드 미리보기
 * ================================================================== */

describe('D. 대시보드 — 이 곡의 Moments (M11-7C: 모두 · 시점 순 · 지금 선)', () => {
  const times = (s: Session) =>
    widget(s)
      .findAll('.moment-time')
      .map((n) => n.text())

  it('지금 곡의 Moments 를 시점 순으로 모두 보인다 — "N개 더 · 모두 보기" 로 자르지 않는다', async () => {
    seedMoments([
      moment({ id: 'a-90', atSeconds: 90 }),
      moment({ id: 'a-5', atSeconds: 5 }),
      moment({ id: 'a-30', atSeconds: 30 }),
      moment({ id: 'a-60', atSeconds: 60 }),
      moment({ id: 'a-120', atSeconds: 120 }),
      moment({ id: 'b-1', videoId: B, title: 'Bravo', atSeconds: 1 }),
    ])
    const s = boot()
    await playFromStart(s, 1)

    expect(times(s)).toEqual(['▶ 0:05', '▶ 0:30', '▶ 1:00', '▶ 1:30', '▶ 2:00'])
    expect(widget(s).find('.more').exists()).toBe(false)
    expect(widget(s).get('.widget-title').text()).toContain('5개')
    expect(widget(s).get('.widget-sub').text()).toBe('전체 6개')
    // 넓은 화면은 칸 안 스크롤 — 높이를 묶고, 페이지로 새지 않는다.
    const style = readSource('src/features/moments/CurrentMomentsList.vue')
    expect(style).toMatch(/max-height:\s*var\(--current-moments-height\)/)
    expect(style).toMatch(/overscroll-behavior:\s*contain/)
  })

  it('지금 위치를 순간들 사이의 선으로 보인다 — 재생이 흐르면 따라간다', async () => {
    vi.useFakeTimers()
    try {
      seedMoments([
        moment({ id: 'a-5', atSeconds: 5 }),
        moment({ id: 'a-30', atSeconds: 30 }),
        moment({ id: 'a-60', atSeconds: 60 }),
      ])
      const s = boot()
      await playFromStart(s, 12)
      const order = () =>
        widget(s)
          .findAll('.moment-rows > li')
          .map((li) => (li.classes('now-marker') ? li.text() : li.attributes('data-moment-row')))
      expect(order()).toEqual(['a-5', '지금 0:12', 'a-30', 'a-60'])

      s.fake.emitPosition(75)
      vi.advanceTimersByTime(1000)
      await nextTick()
      expect(order()).toEqual(['a-5', 'a-30', 'a-60', '지금 1:15'])
    } finally {
      vi.useRealTimers()
    }
  })

  it('메모는 글자로만 · 첫 줄만 · 없으면 조용한 "—"', async () => {
    const note = '<b>굵게</b><img src=x onerror="window.__pwned=1">\n둘째 줄'
    seedMoments([moment({ id: 'x', note }), moment({ id: 'y', atSeconds: 20, note: '' })])
    const s = boot()
    await playFromStart(s, 1)

    const notes = widget(s).findAll('.moment-note')
    expect(notes[0]?.text()).toBe('<b>굵게</b><img src=x onerror="window.__pwned=1">')
    expect(widget(s).findAll('b, img')).toHaveLength(0)
    expect((window as unknown as { __pwned?: number }).__pwned).toBeUndefined()
    expect(notes[1]?.text()).toBe('—')
    expect(notes[1]?.classes()).toContain('is-empty')
    // 낭독기에는 곡 · 시점 · 메모를 말한다.
    expect(widget(s).get('[data-moment-play="x"]').attributes('aria-label')).toBe(
      'Alpha 0:10 부터 재생 — <b>굵게</b><img src=x onerror="window.__pwned=1">',
    )
  })

  it('"모두 보기" 는 보관함 Moments 탭을 연다', async () => {
    seedMoments([moment()])
    const s = boot()
    await widget(s).get('.widget-head .pill').trigger('click')
    await flushPromises()

    expect(s.wrapper.get('#archive-panel').attributes('hidden')).toBeUndefined()
    expect(s.wrapper.get('#archive-tab-moments').attributes('aria-selected')).toBe('true')
  })

  it('빈 상태 · 이 곡에 없을 때를 각각 안내한다', async () => {
    const s = boot()
    // 곡이 없으면 꺼진 저장 단추뿐 — 설명 글은 없다 (ADR 0044).
    expect(widget(s).find('.empty').exists()).toBe(false)

    seedMoments([moment({ videoId: B, title: 'Bravo' })])
    s.moments.restore()
    await playFromStart(s, 3)
    expect(widget(s).get('.empty').text()).toBe('이 곡에 저장한 순간이 아직 없어요.')
  })

  it('위젯에는 수정 · 삭제 · 거르기가 없다 — 관리는 보관함 › 이 곡에서 (M11-3 · M11-7C)', async () => {
    seedMoments([moment({ id: 'x' })])
    const s = boot()
    await playFromStart(s, 1)

    expect(widget(s).find('[data-moment-edit]').exists()).toBe(false)
    expect(widget(s).find('[data-moment-remove]').exists()).toBe(false)
    expect(widget(s).find('.chip').exists()).toBe(false)
  })

  it('빈 상태의 위젯 단추는 모두 보기와 저장 둘뿐이다', () => {
    const s = boot()
    expect(
      widget(s)
        .findAll('button')
        .map((b) => b.text().trim()),
    ).toEqual(['모두 보기 (0)', '＋ 이 순간 저장'])
  })

  it('좁은 대시보드(700px 이하)는 안쪽 스크롤 대신 앞의 4개와 펼치기', async () => {
    seedMoments(
      [5, 10, 20, 30, 40, 50].map((at) => moment({ id: `a-${String(at)}`, atSeconds: at })),
    )
    const s = boot()
    await playFromStart(s, 1)

    const outside = widget(s)
      .findAll('.moment-row')
      .filter((r) => r.classes('is-outside'))
      .map((r) => r.attributes('data-moment-row'))
    expect(outside).toEqual(['a-40', 'a-50'])
    const expand = widget(s).get('.expand')
    expect(expand.attributes('aria-expanded')).toBe('false')
    expect(expand.text()).toContain('6개 모두 펼치기')
    await expand.trigger('click')
    expect(expand.attributes('aria-expanded')).toBe('true')

    const style = readSource('src/features/moments/CurrentMomentsList.vue')
    const narrow = style.slice(style.indexOf('@media (max-width: 700px)'))
    expect(narrow).toMatch(/overflow-y:\s*visible/)
    expect(narrow).toMatch(/\.is-outside[\s\S]*display:\s*none/)
  })

  it('"이 곡" 은 실제로 재생 중인 영상이다 — 재생 전에는 어느 곡의 순간도 보이지 않는다', async () => {
    seedMoments([moment({ id: 'a' }), moment({ id: 'b', videoId: B, title: 'Bravo' })])
    const s = boot()
    const ids = () =>
      widget(s)
        .findAll('.moment-row')
        .map((r) => r.attributes('data-moment-row'))
    expect(ids()).toEqual([])

    await playFromStart(s, 1)
    expect(ids()).toEqual(['a'])
    await nextTrack(s)
    expect(ids()).toEqual(['b'])
  })
})

describe('D2. 보관함이 열린 영상 띠 — 보기 · 재생 전용 (M11-7C)', () => {
  it('저장 · 모두 보기 · 관리가 없고, "이 곡의 Moments" 제목 · 개수 · 시점 · 메모만', async () => {
    seedMoments([
      moment({ id: 'a-30', atSeconds: 30, note: '후렴' }),
      moment({ id: 'a-5', atSeconds: 5 }),
    ])
    const s = boot()
    await playFromStart(s, 1)
    await openArchiveMoments(s)

    const strip = widget(s)
    expect(strip.classes()).toContain('is-readonly')
    expect(strip.get('.widget-title').text().replace(/\s+/g, ' ')).toBe('이 곡의 Moments 2개')
    expect(strip.find('.capture-button').exists()).toBe(false)
    expect(strip.find('.widget-head .pill').exists()).toBe(false)
    expect(strip.find('[data-moment-edit]').exists()).toBe(false)
    expect(strip.find('[data-moment-remove]').exists()).toBe(false)
    expect(strip.find('.expand').exists()).toBe(false)
    expect(strip.findAll('.moment-time').map((n) => n.text())).toEqual(['▶ 0:05', '▶ 0:30'])
    expect(strip.findAll('.moment-note').map((n) => n.text())).toEqual(['—', '후렴'])
    expect(strip.get('.current-moments').classes()).toContain('is-compact')
  })

  it('누르면 그 시점부터 재생한다', async () => {
    seedMoments([moment({ id: 'a-30', atSeconds: 30 })])
    const s = boot()
    await playFromStart(s, 1)
    await openArchiveMoments(s)

    await widget(s).get('[data-moment-play="a-30"]').trigger('click')
    await flushPromises()
    expect(s.fake.calls.seek).toEqual([30])
  })

  it('재생 중인 곡이 없으면 짧게 말한다', async () => {
    seedMoments([moment()])
    const s = boot()
    await openArchiveMoments(s)
    expect(widget(s).get('.empty').text()).toBe('재생 중인 곡이 없어요.')
    expect(widget(s).find('.moment-row').exists()).toBe(false)
  })

  it('보관함을 닫으면 대시보드의 저장 · 모두 보기가 돌아온다 — 같은 위젯 노드다', async () => {
    const s = boot()
    await playFromStart(s, 1)
    const before = widget(s).element
    await openArchiveMoments(s)
    expect(widget(s).element).toBe(before)

    await archiveCloseButton(s.wrapper).trigger('click')
    await flushPromises()
    expect(widget(s).element).toBe(before)
    expect(widget(s).classes()).not.toContain('is-readonly')
    expect(widget(s).find('.capture-button').exists()).toBe(true)
  })
})

/* ================================================================== *
 * E. 보관함 Moments 탭 — 목록 · 관리
 * ================================================================== */

describe('E. 보관함 Moments 탭 (F14 · F16)', () => {
  it('개수와 거르기 — 이 곡 → 전체 → 최근, 이 곡은 곡이 바뀌면 따라간다 (M11-7C)', async () => {
    seedMoments([moment({ id: '1' }), moment({ id: '2', videoId: B, title: 'Bravo' })])
    const s = boot()
    const panel = await openArchiveMoments(s)
    const views = () => panel.findAll('.view-item')
    // 재생 중인 곡이 없으면 "이 곡" 은 없고, 처음 보기는 전체다.
    expect(views().map((v) => v.attributes('data-view'))).toEqual(['all', 'recent'])
    expect(panel.get('.view-item[aria-current="true"]').text()).toBe('전체2')

    await playFromStart(s, 5)
    expect(views().map((v) => v.text())).toEqual(['이 곡1', '전체2', '최근'])
    await chooseView(s, '이 곡')
    const rowIds = () => panel.findAll('.moment-item').map((r) => r.attributes('data-moment-id'))
    expect(rowIds()).toEqual(['1'])
    expect(panel.find('.group-title').exists()).toBe(false)

    await nextTrack(s)
    expect(rowIds()).toEqual(['2'])
    await chooseView(s, '전체')
    expect(panel.findAll('.group-title')).toHaveLength(2)
  })

  it('지금 곡의 묶음을 강조한다 — 색만이 아니라 글로도', async () => {
    seedMoments([moment({ id: '1' }), moment({ id: '2', videoId: B, title: 'Bravo' })])
    const s = boot()
    await playFromStart(s, 5)
    const panel = await openArchiveMoments(s)
    await chooseView(s, '전체')

    const current = panel
      .findAll('.moment-group')
      .filter((g) => g.attributes('aria-current') === 'true')
    expect(current).toHaveLength(1)
    expect(current[0]?.get('.group-title').text()).toBe('Alpha')
    expect(current[0]?.get('.group-meta').text()).toContain('재생 중')
  })

  it('영상은 가장 최근에 만든 순, 안에서는 시점 오름차순으로 보인다', async () => {
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
    const panel = await openArchiveMoments(s)

    const groups = panel.findAll('.moment-group')
    expect(groups.map((g) => g.get('.group-title').text())).toEqual(['Alpha', 'Bravo'])
    expect(groups[0]?.findAll('.moment-time').map((t) => t.text())).toEqual(['0:05', '1:30'])
    expect(s.moments.moments.map((m) => m.id)).toEqual(['a-90', 'b-1', 'a-5'])
  })

  it('제목 3단 — 라이브러리 현재 제목 · 스냅샷 · 대체 표기 · 목록에 없음', async () => {
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
    const panel = await openArchiveMoments(s)
    const titles = () => panel.findAll('.group-title').map((t) => t.text())

    expect(titles()).toEqual(
      expect.arrayContaining(['Alpha', 'Deleted Song', 'YouTube · yyyyyyyyyyy']),
    )
    const gone = panel.findAll('.moment-group').find((g) => g.text().includes('Deleted Song'))
    expect(gone?.get('.group-meta').text()).toContain('목록에 없음')

    await s.library.renameTrack('list', 't-a', 'Alpha (Live)')
    await nextTick()
    expect(titles()).toContain('Alpha (Live)')
    expect(s.moments.getMoment('lib')?.title).toBe('Old Alpha')
  })

  it('행에는 ▶ 와 오른쪽 아이콘 — 메모 수정 · 공유 · 삭제, 글자 없이 이름과 툴팁 (ADR 0044)', async () => {
    seedMoments([moment({ id: 'x', note: '처음' })])
    const s = boot()
    const panel = await openArchiveMoments(s)

    expect(panel.find('[data-moment-manage="x"]').exists()).toBe(false)
    const edit = panel.get('[data-moment-edit="x"]')
    const share = panel.get('[data-moment-share="x"]')
    const remove = panel.get('[data-moment-remove="x"]')
    for (const icon of [edit, share, remove]) expect(icon.text()).toBe('')
    expect(edit.attributes('aria-label')).toBe('Alpha 0:10 메모 수정')
    expect(edit.attributes('title')).toBe('메모 수정')
    expect(share.attributes('aria-label')).toBe('Alpha 0:10 링크로 공유')
    expect(remove.attributes('aria-label')).toBe('Alpha 0:10 순간 삭제')
    expect(edit.attributes('aria-expanded')).toBe('false')
  })

  it('메모를 고친다 — 저장하면 바뀌고 연필로 포커스가 돌아온다', async () => {
    seedMoments([moment({ id: 'x', note: '처음' })])
    const s = boot()
    const panel = await openArchiveMoments(s)
    await openMomentManage(s, 'x')
    await panel.get('[data-moment-edit="x"]').trigger('click')
    await flushPromises()
    await nextTick()

    const field = panel.get('#archive-moment-note-x')
    expect((field.element as HTMLTextAreaElement).value).toBe('처음')
    expect(document.activeElement).toBe(field.element)
    await field.setValue('고친 메모')
    await panel.get('.edit-form').trigger('submit')
    await flushPromises()
    await nextTick()

    expect(s.moments.getMoment('x')?.note).toBe('고친 메모')
    expect(archiveFeedback(s).text()).toContain('메모를 고쳤어요')
    expect(document.activeElement).toBe(panel.get('[data-moment-edit="x"]').element)
  })

  it('다른 탭이 먼저 바꿨으면 저장하지 않고 폼과 쓴 메모를 지킨다 (M10-3 안정화)', async () => {
    seedMoments([moment({ id: 'x', note: '처음' }), moment({ id: 'y', atSeconds: 5, note: 'Y' })])
    const s = boot()
    const panel = await openArchiveMoments(s)
    await openMomentManage(s, 'x')
    await panel.get('[data-moment-edit="x"]').trigger('click')
    await flushPromises()
    await panel.get('#archive-moment-note-x').setValue('이 탭에서 쓴 긴 메모')

    seedMoments([moment({ id: 'x', note: '처음' }), moment({ id: 'y', atSeconds: 5, note: 'Y2' })])
    const before = rawMoments()
    await panel.get('.edit-form').trigger('submit')
    await flushPromises()
    await nextTick()

    expect(rawMoments()).toBe(before)
    expect(archiveFeedback(s).text()).toContain('다른 탭에서 Moments 가 바뀌어')
    expect((panel.get('#archive-moment-note-x').element as HTMLTextAreaElement).value).toBe(
      '이 탭에서 쓴 긴 메모',
    )

    await panel.get('.edit-form').trigger('submit')
    await flushPromises()
    await nextTick()
    expect(s.moments.getMoment('x')?.note).toBe('이 탭에서 쓴 긴 메모')
    expect(s.moments.getMoment('y')?.note).toBe('Y2')
  })

  it('수정도 500자를 넘기면 저장하지 않는다 · 취소하면 그대로다', async () => {
    seedMoments([moment({ id: 'x', note: '처음' })])
    const s = boot()
    const panel = await openArchiveMoments(s)
    await openMomentManage(s, 'x')
    await panel.get('[data-moment-edit="x"]').trigger('click')
    await panel.get('#archive-moment-note-x').setValue('나'.repeat(MAX_MOMENT_NOTE_LENGTH + 1))
    await panel.get('.edit-form').trigger('submit')
    expect(s.moments.getMoment('x')?.note).toBe('처음')
    expect(panel.get('.edit-form .error-msg').text()).toContain('500자까지')

    const cancel = panel.findAll('.edit-form button').find((b) => b.text() === '취소')
    await cancel?.trigger('click')
    expect(panel.find('.edit-form').exists()).toBe(false)
    expect(s.moments.getMoment('x')?.note).toBe('처음')
  })

  it('삭제는 확인을 받는다 — 취소하면 남고, 확인하면 그 순간만 지운다', async () => {
    seedMoments([
      moment({ id: 'keep-1', atSeconds: 5 }),
      moment({ id: 'gone', atSeconds: 10 }),
      moment({ id: 'keep-2', videoId: B, title: 'Bravo' }),
    ])
    const s = boot()
    const libraryBefore = rawLibrary()
    const panel = await openArchiveMoments(s)
    await openMomentManage(s, 'gone')

    await panel.get('[data-moment-remove="gone"]').trigger('click')
    const confirm = panel.get('[role="alertdialog"]')
    expect(confirm.text()).toContain('지울까요')
    await confirm
      .findAll('button')
      .find((b) => b.text() === '취소')
      ?.trigger('click')
    await nextTick()
    expect(s.moments.count).toBe(3)
    expect(document.activeElement).toBe(panel.get('[data-moment-remove="gone"]').element)

    await panel.get('[data-moment-remove="gone"]').trigger('click')
    await panel
      .get('[role="alertdialog"]')
      .findAll('button')
      .find((b) => b.text() === '삭제')
      ?.trigger('click')
    await flushPromises()
    await nextTick()

    expect(s.moments.moments.map((m) => m.id)).toEqual(['keep-1', 'keep-2'])
    expect(rawLibrary()).toBe(libraryBefore)
    expect(archiveFeedback(s).text()).toContain('순간을 지웠어요')
  })

  it('보호 상태에서 지우면 저장되지 않았고 새로고침하면 돌아온다고 말한다', async () => {
    const raw = JSON.stringify({
      version: MOMENTS_STORAGE_VERSION,
      data: [moment({ id: 'x' }), { id: 'broken' }],
    })
    globalThis.localStorage.setItem(STORAGE_KEYS.moments, raw)
    const s = boot()
    const panel = await openArchiveMoments(s)
    await openMomentManage(s, 'x')
    await panel.get('[data-moment-remove="x"]').trigger('click')
    await panel
      .get('[role="alertdialog"]')
      .findAll('button')
      .find((b) => b.text() === '삭제')
      ?.trigger('click')
    await flushPromises()

    expect(archiveFeedback(s).classes()).toContain('is-warning')
    expect(archiveFeedback(s).text()).toContain('새로고침하면 다시 나타납니다')
    expect(rawMoments()).toBe(raw)
  })

  it('메모를 고치는 중 다른 줄을 지우려 하면 폼을 닫는다 — 두 폼이 겹치지 않는다', async () => {
    seedMoments([moment({ id: 'x' }), moment({ id: 'y', atSeconds: 20 })])
    const s = boot()
    const panel = await openArchiveMoments(s)
    await openMomentManage(s, 'x')
    await panel.get('[data-moment-edit="x"]').trigger('click')
    await openMomentManage(s, 'y')
    await panel.get('[data-moment-remove="y"]').trigger('click')

    expect(panel.find('.edit-form').exists()).toBe(false)
    expect(panel.find('[role="alertdialog"]').exists()).toBe(true)
  })

  it('없는 기능의 버튼이 없다 — 전부 지우기 · 시점 편집 · 복구 (보호 상태에서도)', async () => {
    globalThis.localStorage.setItem(
      STORAGE_KEYS.moments,
      JSON.stringify({
        version: MOMENTS_STORAGE_VERSION,
        data: [moment({ id: 'x' }), { id: 'bad' }],
      }),
    )
    const s = boot()
    const panel = await openArchiveMoments(s)
    await openMomentManage(s, 'x')
    await panel.get('[data-moment-edit="x"]').trigger('click')

    const labels = panel
      .findAll('button')
      .map((b) => `${b.text()} ${b.attributes('aria-label') ?? ''}`.trim())
    const forbidden = ['전부 지우기', '모두 삭제', '초기화', '복구', '내보내기', '가져오기', '시점']
    expect(labels.filter((label) => forbidden.some((word) => label.includes(word)))).toEqual([])
    expect(labels.every((label) => label !== '')).toBe(true)
    // 시점은 고치지 못한다 (F16) — 메모 칸(textarea)뿐이다. 입력란은 M11-4 의 검색란 하나다.
    expect(panel.findAll('input').map((input) => input.attributes('id'))).toEqual([
      'archive-moments-search',
    ])
    expect(panel.findAll('textarea')).toHaveLength(1)
  })
})

/* ================================================================== *
 * F. 재생 (F15)
 * ================================================================== */

describe('F. Moment 로 재생', () => {
  it('지금 곡의 순간이면 다시 적재하지 않고 그 시점으로 옮긴다 (대시보드 미리보기)', async () => {
    seedMoments([moment({ id: 'x', atSeconds: 83 })])
    const s = boot()
    await playFromStart(s, 5)
    const loadsBefore = s.fake.calls.load.length

    await widget(s).get('[data-moment-play="x"]').trigger('click')
    await flushPromises()

    expect(s.fake.calls.seek).toEqual([83])
    expect(s.fake.calls.play).toBe(1)
    expect(s.fake.calls.load).toHaveLength(loadsBefore)
    expect(previewFeedback(s)?.text()).toBe('')
  })

  it('다른 곡의 순간이면 그 시점부터 적재하고, 듣던 큐는 그대로 둔다 (보관함)', async () => {
    seedMoments([moment({ id: 'x', videoId: C, title: 'Charlie', atSeconds: 61 })])
    const s = boot()
    await playFromStart(s, 5)
    const queueBefore = s.playback.queue.map((track) => track.id)
    const panel = await openArchiveMoments(s)
    await chooseView(s, '전체')

    await panel.get('[data-moment-play="x"]').trigger('click')
    await flushPromises()

    expect(last(s.fake.calls.load)).toEqual({ videoId: C, autoplay: true, startSeconds: 61 })
    expect(s.playback.queue.map((track) => track.id)).toEqual(queueBefore)
    expect(s.playback.currentTrack?.title).toBe('Charlie')
    // 보관함은 플레이어를 덮지 않으므로 열린 채다.
    expect(s.wrapper.get('#archive-panel').attributes('hidden')).toBeUndefined()
  })

  it('라이브러리에서 지운 영상의 순간도 남고 재생된다 — 그 한 곡으로', async () => {
    seedMoments([moment({ id: 'x', videoId: GONE, title: 'Deleted Song', atSeconds: 42 })])
    const s = boot()
    const panel = await openArchiveMoments(s)
    expect(panel.findAll('.group-title').map((t) => t.text())).toEqual(['Deleted Song'])

    await panel.get('[data-moment-play="x"]').trigger('click')
    await flushPromises()

    expect(s.fake.calls.load).toEqual([{ videoId: GONE, autoplay: true, startSeconds: 42 }])
    expect(s.playback.queue).toHaveLength(1)
  })

  it('0초 순간은 처음부터가 아니라 "0초부터" 로 적재한다', async () => {
    seedMoments([moment({ id: 'x', videoId: B, title: 'Bravo', atSeconds: 0 })])
    const s = boot()
    const panel = await openArchiveMoments(s)
    await panel.get('[data-moment-play="x"]').trigger('click')
    await flushPromises()

    expect(s.fake.calls.load).toEqual([{ videoId: B, autoplay: true, startSeconds: 0 }])
  })

  it('플레이어가 가려져 있으면 다른 재생과 같은 문구로 거절하고 아무것도 틀지 않는다', async () => {
    seedMoments([moment({ id: 'x', videoId: B, title: 'Bravo', atSeconds: 30 })])
    const s = boot()
    const panel = await openArchiveMoments(s)
    setPlayerRect(HIDDEN_RECT)

    await panel.get('[data-moment-play="x"]').trigger('click')
    await flushPromises()

    expect(archiveFeedback(s).text()).toBe(PLAY_REFUSED_HIDDEN_MESSAGE)
    expect(archiveFeedback(s).classes()).toContain('is-warning')
    expect(s.fake.calls.load).toEqual([])
    expect(s.playback.queue).toEqual([])
  })

  it('쌓기 배치에서 측정상 영상이 시트에 덮이면 먼저 비켜준 뒤 재생한다 (M7-2 계약, M11-2)', async () => {
    installMatchMedia(true)
    seedMoments([moment({ id: 'x', videoId: B, title: 'Bravo', atSeconds: 30 })])
    const s = boot()
    const panel = await openArchiveMoments(s)
    setRectOverride('[data-widget="player"] .video-holder', {
      ...VISIBLE_RECT,
      top: 300,
      bottom: 605,
    })

    await panel.get('[data-moment-play="x"]').trigger('click')
    await flushPromises()

    expect(s.wrapper.get('#archive-panel').attributes('hidden')).toBeDefined()
    expect(s.fake.calls.load).toEqual([{ videoId: B, autoplay: true, startSeconds: 30 }])
  })

  it('플레이어가 아직 없으면 성공으로 보이지 않고 이유를 말한다', async () => {
    seedMoments([moment({ id: 'x' })])
    setActivePinia(createPinia())
    useLibraryStore().restore()
    useMomentsStore().restore()
    const coordinator = createPlaybackCoordinator()
    // 위젯 미리보기는 지금 곡의 것이다 — 큐에 A 를 올려 둔다 (어댑터는 없다).
    usePlaybackStore().setQueue([{ id: 't', source: 'youtube', videoId: A, title: 'Alpha' }], 0)
    const wrapper = mount(MomentsWidget, {
      attachTo: document.body,
      global: { provide: { [PLAYBACK_COORDINATOR as symbol]: coordinator } },
    })

    await wrapper.get('[data-moment-play="x"]').trigger('click')
    await flushPromises()

    expect(wrapper.findAll('.feedback')[1]?.text()).toContain('플레이어가 아직 준비되지 않았어요')
  })

  it('재생할 수 없는 영상이면 플레이어의 오류 안내가 뜨고 순간은 지워지지 않는다', async () => {
    seedMoments([moment({ id: 'x', videoId: C, title: 'Charlie', atSeconds: 10 })])
    const s = boot()
    const before = rawMoments()
    const panel = await openArchiveMoments(s)
    await panel.get('[data-moment-play="x"]').trigger('click')
    await flushPromises()
    s.fake.emitError({ kind: 'embed-not-allowed', code: 150 })
    await nextTick()

    expect(s.wrapper.get('.player-surface .status').text()).toContain('오류 150')
    expect(rawMoments()).toBe(before)
    // 저장은 보관함 › 이 곡에 있다(영상 띠에는 없다) — 재생되지 않은 곡이라 꺼져 있다.
    expect(widget(s).find('.capture-button').exists()).toBe(false)
    await chooseView(s, '이 곡')
    expect(archiveMoments(s).get('.capture-button').attributes('disabled')).toBeDefined()
  })

  it('연달아 누르면 마지막 순간이 이긴다', async () => {
    seedMoments([
      moment({ id: 'b', videoId: B, title: 'Bravo', atSeconds: 10 }),
      moment({ id: 'c', videoId: C, title: 'Charlie', atSeconds: 20 }),
    ])
    const s = boot()
    const panel = await openArchiveMoments(s)
    await panel.get('[data-moment-play="b"]').trigger('click')
    await panel.get('[data-moment-play="c"]').trigger('click')
    await flushPromises()

    expect(last(s.fake.calls.load)).toEqual({ videoId: C, autoplay: true, startSeconds: 20 })
  })
})

/* ================================================================== *
 * G. 영속 · 테마 · iframe · 소스 수준
 * ================================================================== */

describe('G. 영속성 · 테마 · 플레이어 DOM · 경계', () => {
  it('저장한 순간과 메모가 새로고침 뒤에도 돌아온다', async () => {
    const s = boot()
    await playFromStart(s, 42)
    await saveWithNote(s, '다시 보자')
    s.wrapper.unmount()

    const again = boot()
    const panel = await openArchiveMoments(again)
    expect(panel.findAll('.moment-note').map((n) => n.text())).toEqual(['다시 보자'])
    expect(panel.get('.moment-time').text()).toBe('0:42')
  })

  it('테마를 바꿔도 저장 전 초안 · 쓰던 메모와 방금 저장한 순간이 그대로다', async () => {
    const s = boot()
    await playFromStart(s, 42)
    await quickSave(s)
    const savedId = s.moments.moments[0]?.id ?? ''
    s.fake.emitPosition(50)
    await nextTick()
    await captureNow(s)
    await noteField(s).setValue('쓰던 중')

    s.theme.setTheme('mono-vinyl')
    await nextTick()

    expect((noteField(s).element as HTMLTextAreaElement).value).toBe('쓰던 중')
    expect(draftForm(s).get('.note-target').text()).toContain('0:50')
    expect(widget(s).find(`[data-moment-row="${savedId}"]`).exists()).toBe(true)
    expect(s.moments.moments).toHaveLength(1)
  })

  it('저장 · 재생 · 테마 전환 · 보관함을 거쳐도 플레이어 DOM 은 하나이고 같은 노드다', async () => {
    seedMoments([moment({ id: 'x', videoId: C, title: 'Charlie', atSeconds: 7 })])
    const s = boot()
    const host = s.fake.hostNode
    expect(host).not.toBeNull()

    await playFromStart(s, 12)
    await quickSave(s)
    const panel = await openArchiveMoments(s)
    await chooseView(s, '전체')
    await panel.get('[data-moment-play="x"]').trigger('click')
    await flushPromises()
    s.theme.setTheme('mono-vinyl')
    await nextTick()
    await archiveCloseButton(s.wrapper).trigger('click')
    await nextTick()

    expect(s.fake.hostNode).toBe(host)
    expect(s.fake.calls.mount).toBe(1)
    expect(s.fake.calls.destroy).toBe(0)
    expect(document.querySelectorAll('[data-fake-player-host]')).toHaveLength(1)
  })

  it('Moment 를 저장 · 메모 · 삭제해도 라이브러리 원문은 바뀌지 않는다', async () => {
    const s = boot()
    const before = rawLibrary()
    await playFromStart(s, 10)
    await saveWithNote(s, '하나')
    const id = s.moments.moments[0]?.id ?? ''
    const panel = await openArchiveMoments(s)
    await openMomentManage(s, id)
    await panel.get(`[data-moment-remove="${id}"]`).trigger('click')
    await panel
      .get('[role="alertdialog"]')
      .findAll('button')
      .find((b) => b.text() === '삭제')
      ?.trigger('click')
    await flushPromises()

    expect(s.moments.count).toBe(0)
    expect(rawLibrary()).toBe(before)
  })

  it('Moments UI 는 플레이어 · YouTube API · 저장소를 직접 부르지 않는다', () => {
    for (const file of [
      'src/features/moments/MomentsWidget.vue',
      'src/features/moments/MomentsBrowserPanel.vue',
      'src/features/moments/MomentList.vue',
      'src/features/moments/MomentRow.vue',
      'src/features/moments/MomentsStatusBanner.vue',
      'src/features/moments/useMomentCapture.ts',
      'src/features/moments/useMomentsBrowser.ts',
      'src/features/moments/useMomentsArchive.ts',
      'src/features/moments/momentsView.ts',
      'src/features/moments/momentsSearch.ts',
      'src/features/moments/momentFeedback.ts',
      // M11-7C
      'src/features/moments/MomentCapture.vue',
      'src/features/moments/CurrentMomentsList.vue',
      // M12-2 에서 playback 으로 옮겼다 — 카드도 쓴다. 여전히 코디네이터 계약만 쓴다.
      'src/features/playback/usePlaybackPosition.ts',
      'src/stores/momentDraft.ts',
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
      expect({ file, found }).toEqual({ file, found: [] })
    }
  })

  it('라이브러리를 고치는 호출이 없다 — 제목을 읽기만 한다', () => {
    // M11-4 의 "목록: A" 는 목록을 **고르기만** 한다(selectPlaylist — 보관함의 목록 고르기와 같은 동작).
    for (const file of [
      'src/features/moments/useMomentsArchive.ts',
      'src/features/moments/MomentsBrowserPanel.vue',
      'src/features/moments/MomentList.vue',
      'src/features/moments/MomentRow.vue',
      'src/features/moments/useMomentsBrowser.ts',
      'src/features/moments/useMomentCapture.ts',
      'src/features/moments/MomentsWidget.vue',
      'src/features/moments/MomentCapture.vue',
      'src/stores/momentDraft.ts',
    ]) {
      const code = stripComments(readSource(file))
      for (const action of [
        'removeTrack',
        'addTrack',
        'renameTrack',
        'deletePlaylist',
        'replaceAll',
      ]) {
        expect({ file, action, found: code.includes(action) }).toEqual({
          file,
          action,
          found: false,
        })
      }
    }
  })

  it('보관함 줄의 "방금 저장" 은 글 폭만큼만 — grid 칸 폭으로 늘어나지 않는다 (M11-7C 실측 결함)', () => {
    const css = readSource('src/features/moments/MomentRow.vue')
    expect(/\.moment-text \{[^}]*display: grid/.test(css)).toBe(true)
    expect(/\.new-badge \{[^}]*justify-self: start/.test(css)).toBe(true)
  })

  it('저장 버튼의 활성 판정과 캡처 판정이 같은 값을 본다', () => {
    const capture = stripComments(readSource('src/features/moments/useMomentCapture.ts'))
    const coordinator = stripComments(
      readSource('src/features/playback/createPlaybackCoordinator.ts'),
    )

    expect(capture).toContain('playback.isPositionReliable')
    expect(coordinator).toContain('playback.isPositionReliable')
  })

  it('좁은 화면에서는 플레이어 바로 아래 행이다 — 2열(1100px)과 1열(700px) 모두', () => {
    const source = readSource('src/components/layout/WidgetHost.vue')
    const compact = source.slice(source.indexOf('@media (max-width: 1100px)'))
    expect(compact).toMatch(/'player player'\s*'moments moments'/)
    const narrow = source.slice(source.indexOf('@media (max-width: 700px)'))
    expect(narrow).toMatch(/'player'\s*'moments'/)
  })

  /*
   * M9-6 성능 — 스크롤바가 폭을 차지하는 환경에서 `overflow-y: auto` 목록은 한 줄만 바뀌어도 전체를
   * 다시 배치했다(1000개에서 550~700ms). M11-2 부터 Moments 목록의 스크롤은 보관함 본문이다 — 같은
   * 조건을 거기서 지킨다.
   */
  it('보관함 본문(Moments 목록의 스크롤)이 스크롤바 자리를 고정해 둔다', () => {
    const source = readSource('src/features/archive/ArchivePanel.vue')
    const block = /\.archive-body \{[^}]*\}/.exec(source)?.[0] ?? ''
    expect(block).toContain('overflow-y: auto')
    expect(block).toContain('scrollbar-gutter: stable')
  })
})
