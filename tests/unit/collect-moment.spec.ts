/**
 * 수집 화면 — Music Moment 저장 (M10-4, ADR 0023 · 0025).
 *
 * `main.ts` 의 수집 경로와 같은 순서로 세운다 — 테마 · 라이브러리 · Moments 복원 →
 * 다른 탭 듣기 → `CollectView` 마운트. 다른 탭은 같은 `localStorage` 를 쓰는 별도
 * Pinia store 다.
 */
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'

import CollectView from '@/features/collect/CollectView.vue'
import { LOCK_TIMEOUT_MS, STORAGE_KEYS } from '@/shared/storage'
import type { Moment, MomentsData } from '@/shared/types'
import { useLibraryStore } from '@/stores/library'
import { MOMENTS_STORAGE_VERSION, useMomentsStore } from '@/stores/moments'
import { useThemeStore } from '@/stores/theme'

import { FakeLockWorld } from '../support/fakeTabs'

const KEY = STORAGE_KEYS.moments
const REQ = '3f0c6b1e-8d2a-4c7e-9b5f-1a2b3c4d5e6f'
const VIDEO = 'jNQXAC9IVRw'
const realLocalStorage = globalThis.localStorage
const stops: (() => void)[] = []

function momentHash(fields: Record<string, string> = {}): string {
  const params = new URLSearchParams({
    v: '1',
    kind: 'moment',
    videoId: VIDEO,
    atSeconds: '83',
    title: 'Me at the zoo',
    req: REQ,
    ...fields,
  })
  return `#collect?${params.toString()}`
}

function seedMoments(data: Moment[]): void {
  realLocalStorage.setItem(KEY, JSON.stringify({ version: MOMENTS_STORAGE_VERSION, data }))
}

function stored(): MomentsData {
  const raw = realLocalStorage.getItem(KEY)
  return raw === null ? [] : (JSON.parse(raw).data as MomentsData)
}

function moment(overrides: Partial<Moment> = {}): Moment {
  return {
    id: 'm-old',
    source: 'youtube',
    videoId: VIDEO,
    atSeconds: 83,
    note: '예전 메모',
    title: 'Me at the zoo',
    createdAt: '2026-11-07T01:00:00.000Z',
    updatedAt: '2026-11-07T01:00:00.000Z',
    ...overrides,
  }
}

/** `main.ts` 의 수집 경로와 같은 순서. */
function boot(hash = momentHash()) {
  setActivePinia(createPinia())
  useThemeStore().restore()
  const library = useLibraryStore()
  library.restore()
  stops.push(library.watchExternalChanges())
  const moments = useMomentsStore()
  moments.restore()
  stops.push(moments.watchExternalChanges())
  const clearRequest = vi.fn<() => void>()
  const wrapper = mount(CollectView, {
    props: { hash, options: { clearRequest } },
    attachTo: document.body,
  })
  return { wrapper, moments, clearRequest }
}

type Wrapper = ReturnType<typeof boot>['wrapper']

async function save(wrapper: Wrapper): Promise<void> {
  await wrapper.get('form.choose').trigger('submit')
  await flushPromises()
  await nextTick()
}

function otherTab() {
  const store = useMomentsStore(createPinia())
  store.restore()
  return store
}

const saveButton = (wrapper: Wrapper) => wrapper.get('form.choose button[type="submit"]')

beforeEach(() => {
  realLocalStorage.clear()
  delete document.documentElement.dataset.theme
})

afterEach(() => {
  while (stops.length > 0) stops.pop()?.()
  delete (globalThis.navigator as { locks?: unknown }).locks
  vi.useRealTimers()
  vi.restoreAllMocks()
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: realLocalStorage })
  realLocalStorage.clear()
  document.body.innerHTML = ''
})

describe('A. 열기만 해서는 저장하지 않는다', () => {
  it('제목 · 시점 · 그 지점 링크 · 빈 메모를 보이고 저장소는 그대로다', () => {
    const { wrapper } = boot()

    expect(wrapper.get('.video-title').text()).toBe('Me at the zoo')
    expect(wrapper.get('.moment-time').text()).toBe('1:23 지점')
    expect(wrapper.get('.video-meta a').attributes('href')).toBe(
      `https://www.youtube.com/watch?v=${VIDEO}&t=83s`,
    )
    expect((wrapper.get('#collect-moment-note').element as HTMLTextAreaElement).value).toBe('')
    expect(wrapper.text()).toContain('“Moment 저장” 을 누르기 전에는 아무것도 저장하지 않습니다')
    expect(saveButton(wrapper).attributes('disabled')).toBeUndefined()
    // 곡 담기 화면이 아니다 — 플레이리스트를 고르지 않는다.
    expect(wrapper.find('input[type="radio"]').exists()).toBe(false)
    expect(realLocalStorage.getItem(KEY)).toBeNull()
    wrapper.unmount()
  })

  it('주소에 메모가 실려 오면 열지 않는다 — 메모는 이 화면에서만 쓴다', () => {
    const { wrapper } = boot(momentHash({ note: '미리 채운 메모' }))

    expect(wrapper.text()).toContain('이 수집 요청은 열 수 없습니다')
    expect(wrapper.text()).toContain('메모는 주소로 받지 않고')
    expect(wrapper.find('textarea').exists()).toBe(false)
    expect(realLocalStorage.getItem(KEY)).toBeNull()
    wrapper.unmount()
  })

  it.each(['-1', '1.5', 'NaN', 'Infinity', '', '1e3'])(
    '시점이 %j 이면 열지 않는다',
    (atSeconds) => {
      const { wrapper } = boot(momentHash({ atSeconds }))
      expect(wrapper.text()).toContain('저장할 재생 시점이 올바르지 않습니다')
      expect(wrapper.find('form.choose').exists()).toBe(false)
      wrapper.unmount()
    },
  )
})

describe('B. 저장', () => {
  it('누르면 그 영상 · 그 시점 · 메모 · 제목을 Moments 에 저장하고 끝난 뒤에 알린다', async () => {
    const { wrapper, clearRequest } = boot()

    await wrapper.get('#collect-moment-note').setValue('  여기 기타 솔로  ')
    await save(wrapper)

    const list = stored()
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({
      videoId: VIDEO,
      atSeconds: 83,
      note: '여기 기타 솔로',
      title: 'Me at the zoo',
      source: 'youtube',
    })
    expect(wrapper.get('.collect-notice--success').text()).toContain(
      '“Me at the zoo” 1:23 순간을 저장했습니다',
    )
    expect(wrapper.get('.saved-note').text()).toBe('여기 기타 솔로')
    expect(clearRequest).toHaveBeenCalledTimes(1)
    wrapper.unmount()
  })

  it('확인된 0초도 저장한다', async () => {
    const { wrapper } = boot(momentHash({ atSeconds: '0' }))
    expect(wrapper.get('.moment-time').text()).toBe('0:00 지점')

    await save(wrapper)
    expect(stored()[0]?.atSeconds).toBe(0)
    wrapper.unmount()
  })

  it('제목이 없으면 빈 스냅샷으로 저장하고 기본 표기로 보인다', async () => {
    const params = new URLSearchParams({
      v: '1',
      kind: 'moment',
      videoId: VIDEO,
      atSeconds: '5',
      req: REQ,
    })
    const { wrapper } = boot(`#collect?${params.toString()}`)

    expect(wrapper.get('.video-title').text()).toBe('제목 없음')
    await save(wrapper)
    expect(stored()[0]?.title).toBe('')
    expect(wrapper.text()).toContain(`YouTube · ${VIDEO}`)
    wrapper.unmount()
  })

  it('연속으로 눌러도 하나만 저장한다', async () => {
    const { wrapper } = boot()

    void wrapper.get('form.choose').trigger('submit')
    void wrapper.get('form.choose').trigger('submit')
    await flushPromises()
    await nextTick()

    expect(stored()).toHaveLength(1)
    expect(wrapper.find('form.choose').exists()).toBe(false)
    wrapper.unmount()
  })

  it('메모와 제목은 글자로만 그린다', async () => {
    const { wrapper } = boot(momentHash({ title: '<img src=x onerror=alert(1)>' }))
    await wrapper.get('#collect-moment-note').setValue('<b>굵게</b>')
    await save(wrapper)

    expect(wrapper.find('img').exists()).toBe(false)
    expect(wrapper.find('b').exists()).toBe(false)
    expect(wrapper.get('.saved-note').text()).toBe('<b>굵게</b>')
    wrapper.unmount()
  })
})

describe('C. 메모 500자', () => {
  it('입력란이 500자로 막혀 있고, 넘긴 값(붙여넣기·스크립트)은 저장하지 않는다 — 자르지 않는다', async () => {
    const { wrapper } = boot()
    const field = wrapper.get('#collect-moment-note')
    expect(field.attributes('maxlength')).toBe('500')

    await field.setValue('가'.repeat(500))
    expect(wrapper.get('#collect-moment-count').text()).toBe('500 / 500')
    expect(saveButton(wrapper).attributes('disabled')).toBeUndefined()

    await field.setValue('가'.repeat(501))
    expect(wrapper.get('#collect-moment-count').classes()).toContain('is-over')
    expect(saveButton(wrapper).attributes('disabled')).toBeDefined()
    await save(wrapper)

    expect(wrapper.get('.failure').text()).toBe('메모는 500자까지 쓸 수 있습니다.')
    expect(realLocalStorage.getItem(KEY)).toBeNull()
    wrapper.unmount()
  })
})

describe('D. 저장하지 못하면 성공이라 하지 않는다', () => {
  it('쓰기 실패 — 안내하고 메모를 지키며, 다시 누르면 하나만 저장된다', async () => {
    const { wrapper } = boot()
    await wrapper.get('#collect-moment-note').setValue('지켜야 할 메모')
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError')
    })

    await save(wrapper)
    expect(wrapper.get('.failure').text()).toContain('저장하지 못했습니다')
    expect(wrapper.find('.collect-notice--success').exists()).toBe(false)
    expect((wrapper.get('#collect-moment-note').element as HTMLTextAreaElement).value).toBe(
      '지켜야 할 메모',
    )
    expect(realLocalStorage.getItem(KEY)).toBeNull()

    setItem.mockRestore()
    await save(wrapper)
    expect(stored()).toHaveLength(1)
    expect(stored()[0]?.note).toBe('지켜야 할 메모')
    wrapper.unmount()
  })

  it('다른 탭이 먼저 Moments 를 바꿨으면 거절하고 메모를 지킨다 — 다시 누르면 둘 다 남는다', async () => {
    const { wrapper } = boot()
    await wrapper.get('#collect-moment-note').setValue('내 메모')

    await otherTab().add({ videoId: 'M7lc1UVf-VE', atSeconds: 10, note: '다른 탭' })
    await save(wrapper)

    expect(wrapper.get('.failure').text()).toContain('다른 탭에서 Moments 가 바뀌어')
    expect((wrapper.get('#collect-moment-note').element as HTMLTextAreaElement).value).toBe(
      '내 메모',
    )
    expect(stored().map((item) => item.note)).toEqual(['다른 탭'])

    await save(wrapper)
    expect(stored().map((item) => item.note)).toEqual(['다른 탭', '내 메모'])
    wrapper.unmount()
  })

  it('다른 탭이 저장하는 중이면(잠금 5초) busy 를 알리고 저장하지 않는다', async () => {
    const world = new FakeLockWorld()
    Object.defineProperty(globalThis.navigator, 'locks', {
      configurable: true,
      value: world.forTab('page'),
    })
    const release = await new Promise<() => void>((granted) => {
      void world
        .forTab('other')
        .request(
          `${KEY}:write`,
          { mode: 'exclusive' },
          () => new Promise<void>((done) => granted(done)),
        )
    })
    vi.useFakeTimers()
    const { wrapper } = boot()

    void wrapper.get('form.choose').trigger('submit')
    await vi.advanceTimersByTimeAsync(10)
    expect(saveButton(wrapper).text()).toBe('저장 중…')
    expect(saveButton(wrapper).attributes('aria-busy')).toBe('true')
    await vi.advanceTimersByTimeAsync(LOCK_TIMEOUT_MS)
    await nextTick()

    expect(wrapper.get('.failure').text()).toContain('다른 39page 탭이 저장하는 중')
    expect(realLocalStorage.getItem(KEY)).toBeNull()

    release()
    await vi.advanceTimersByTimeAsync(10)
    void wrapper.get('form.choose').trigger('submit')
    await vi.advanceTimersByTimeAsync(10)
    await nextTick()
    expect(stored()).toHaveLength(1)
    wrapper.unmount()
  })

  it.each([
    [
      'protected',
      () => realLocalStorage.setItem(KEY, '{깨진 값'),
      '자동 저장을 멈춘 상태',
      '{깨진 값',
    ],
    [
      'unavailable',
      () =>
        Object.defineProperty(globalThis, 'localStorage', {
          configurable: true,
          get() {
            throw new DOMException('denied', 'SecurityError')
          },
        }),
      '브라우저 저장소를 쓸 수 없어',
      null,
    ],
  ] as const)(
    '%s — 저장할 수 없다고 알리고 원본을 건드리지 않는다',
    (_label, arrange, text, raw) => {
      arrange()
      const { wrapper } = boot()

      expect(wrapper.text()).toContain('지금은 Moment 를 저장할 수 없습니다')
      expect(wrapper.text()).toContain(text)
      expect(wrapper.find('form.choose').exists()).toBe(false)
      expect(realLocalStorage.getItem(KEY)).toBe(raw)
      wrapper.unmount()
    },
  )

  it('저장한 Moment 가 다른 탭에서 지워지면 성공 안내를 내리고 다시 저장하게 한다', async () => {
    const { wrapper } = boot()
    await wrapper.get('#collect-moment-note').setValue('사라질 메모')
    await save(wrapper)
    const id = stored()[0]?.id as string

    await otherTab().remove(id)
    globalThis.dispatchEvent(new StorageEvent('storage', { key: KEY }))
    await nextTick()

    expect(wrapper.find('.collect-notice--success').exists()).toBe(false)
    expect(wrapper.get('.failure').text()).toContain('방금 저장한 Moment 가 목록에서 없어졌습니다')
    expect((wrapper.get('#collect-moment-note').element as HTMLTextAreaElement).value).toBe(
      '사라질 메모',
    )
    wrapper.unmount()
  })
})

describe('E. 같은 시점', () => {
  it('같은 영상 · 같은 시점의 Moment 가 있으면 알리되 막지 않는다', async () => {
    seedMoments([moment()])
    const { wrapper } = boot()

    expect(wrapper.get('.duplicate').text()).toContain('1:23 에 저장한 Moment 가 이미 1개 있습니다')
    await save(wrapper)
    expect(stored()).toHaveLength(2)
    wrapper.unmount()
  })
})

describe('F. 쓰던 메모를 조용히 잃지 않는다 (M10-5)', () => {
  function leave(): boolean {
    const event = new Event('beforeunload', { cancelable: true })
    globalThis.dispatchEvent(event)
    return event.defaultPrevented
  }

  it('메모를 쓰는 중에 떠나려 하면 브라우저가 묻는다 — 비었거나 저장했으면 묻지 않는다', async () => {
    const { wrapper } = boot()
    expect(leave()).toBe(false)

    await wrapper.get('#collect-moment-note').setValue('쓰는 중')
    expect(leave()).toBe(true)

    await save(wrapper)
    expect(wrapper.find('.collect-notice--success').exists()).toBe(true)
    expect(leave()).toBe(false)
    wrapper.unmount()
  })

  it('저장이 거절돼 메모가 남아 있으면 계속 묻는다', async () => {
    const { wrapper } = boot()
    await wrapper.get('#collect-moment-note').setValue('남은 메모')
    await otherTab().add({ videoId: 'M7lc1UVf-VE', atSeconds: 1 })
    await save(wrapper)

    expect(wrapper.get('.failure').text()).toContain('다른 탭에서 Moments 가 바뀌어')
    expect(leave()).toBe(true)
    wrapper.unmount()
  })

  it('화면을 닫으면(마운트 해제) 더는 묻지 않는다', async () => {
    const { wrapper } = boot()
    await wrapper.get('#collect-moment-note').setValue('쓰는 중')
    wrapper.unmount()
    expect(leave()).toBe(false)
  })

  it('같은 탭의 주소 조각이 다른 요청으로 바뀌어도 화면과 쓰던 메모를 바꾸지 않는다', async () => {
    const { wrapper } = boot()
    await wrapper.get('#collect-moment-note').setValue('지킬 메모')

    globalThis.location.hash = momentHash({ atSeconds: '5', req: 'another_request_1234' }).slice(1)
    globalThis.dispatchEvent(new HashChangeEvent('hashchange'))
    await nextTick()

    expect(wrapper.get('.moment-time').text()).toBe('1:23 지점')
    expect((wrapper.get('#collect-moment-note').element as HTMLTextAreaElement).value).toBe(
      '지킬 메모',
    )
    expect(realLocalStorage.getItem(KEY)).toBeNull()
    globalThis.location.hash = ''
    wrapper.unmount()
  })
})
