import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import PopupApp from '@/popup/PopupApp.vue'
import { BRIDGE_KEY } from '@/popup/bridge'
import { EVENT_DEBOUNCE_MS, TITLE_RECHECK_LIMIT, TITLE_RECHECK_MS } from '@/popup/useActiveVideo'
import { fail, ok, type PageInspection } from '@/shared/messages'

import { fakeBridge } from './support/fakeBridge'

const ID = 'dQw4w9WgXcQ'
const VIDEO: PageInspection = {
  status: 'video',
  videoId: ID,
  pageKind: 'watch',
  title: 'Song <b>Title</b>',
  titleSource: 'player',
}

function mountPopup(fake = fakeBridge()) {
  const wrapper = mount(PopupApp, { global: { provide: { [BRIDGE_KEY as symbol]: fake.bridge } } })
  return { wrapper, fake }
}

async function settle() {
  await flushPromises()
}

describe('팝업', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('처음에는 확인 중을 보이고, 활성 탭을 묻는다', async () => {
    const { wrapper, fake } = mountPopup()
    await settle()
    expect(wrapper.text()).toContain('현재 탭을 확인하는 중')
    expect(wrapper.find('main').attributes('aria-busy')).toBe('true')
    expect(fake.bridge.inspect).toHaveBeenCalledWith(1)
  })

  it('브랜드와 영상 제목 · 영상 ID · 종류를 보인다', async () => {
    const { wrapper, fake } = mountPopup()
    await settle()
    fake.pending[0]!.resolve(ok(VIDEO))
    await settle()

    expect(wrapper.find('h1').text()).toBe('39page')
    expect(wrapper.find('.title').text()).toBe('Song <b>Title</b>')
    expect(wrapper.find('.title b').exists()).toBe(false) // 텍스트로만 그린다
    expect(wrapper.find('.video-id').text()).toBe(ID)
    expect(wrapper.find('.kind').text()).toBe('영상')
  })

  it('제목이 없으면 그렇다고 말하고 ID 는 보인다', async () => {
    const { wrapper, fake } = mountPopup()
    await settle()
    fake.pending[0]!.resolve(ok({ ...VIDEO, title: null, titleSource: null, pageKind: 'shorts' }))
    await settle()
    expect(wrapper.text()).toContain('제목을 읽지 못했습니다')
    expect(wrapper.find('.kind').text()).toBe('Shorts')
    expect(wrapper.find('.video-id').text()).toBe(ID)
  })

  it('Quick Add — 영상이면 "39page 에 추가" 버튼 하나, 저장하지 않는다고 적는다 (M10-3)', async () => {
    const { wrapper, fake } = mountPopup()
    await settle()
    fake.pending[0]!.resolve(ok(VIDEO))
    await settle()

    const buttons = wrapper.findAll('button')
    expect(buttons.map((button) => button.text())).toEqual(['39page 에 추가'])
    expect(wrapper.find('.quick-add').text()).toContain('이 버튼만으로는 저장되지 않습니다')
    expect(wrapper.findAll('a, input, select, textarea, [role="button"], [tabindex]')).toHaveLength(
      0,
    )
  })

  it.each([
    ['not-youtube', 'YouTube 영상 페이지가 아닙니다'],
    ['not-video-page', '영상 페이지가 아닙니다'],
    ['youtube-music', 'YouTube Music 은 아직 지원하지 않습니다'],
    ['no-access', '이 페이지를 읽을 수 없습니다'],
    ['restricted', '이 페이지에서는 쓸 수 없습니다'],
  ] as const)('지원하지 않는 페이지 — %s', async (reason, text) => {
    const { wrapper, fake } = mountPopup()
    await settle()
    fake.pending[0]!.resolve(ok({ status: 'unsupported', reason }))
    await settle()
    expect(wrapper.text()).toContain(text)
    expect(wrapper.find('.quick-add').exists()).toBe(false)
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
  })

  it('확장 오류는 알리고 다시 시도할 수 있다', async () => {
    const { wrapper, fake } = mountPopup()
    await settle()
    fake.pending[0]!.resolve(fail('timeout', 'slow'))
    await settle()

    expect(wrapper.find('[role="alert"]').text()).toContain('확장이 제때 답하지 않았습니다')
    await wrapper.find('button.retry').trigger('click')
    await settle()
    expect(fake.bridge.inspect).toHaveBeenCalledTimes(2)
    fake.pending[1]!.resolve(ok(VIDEO))
    await settle()
    expect(wrapper.find('.video-id').text()).toBe(ID)
  })

  it('활성 탭이 없으면 no-tab 오류', async () => {
    const { wrapper } = mountPopup(fakeBridge(null))
    await settle()
    expect(wrapper.text()).toContain('탭을 찾을 수 없습니다')
  })

  it('자기 탭이 바뀌면(SPA 이동) 짧게 묶어 한 번만 다시 묻는다', async () => {
    const { wrapper, fake } = mountPopup()
    await settle()
    fake.pending[0]!.resolve(ok(VIDEO))
    await settle()

    fake.emit({ kind: 'updated', tabId: 1 })
    fake.emit({ kind: 'updated', tabId: 1 })
    fake.emit({ kind: 'updated', tabId: 1 })
    await vi.advanceTimersByTimeAsync(EVENT_DEBOUNCE_MS)
    expect(fake.bridge.inspect).toHaveBeenCalledTimes(2)

    fake.pending[1]!.resolve(ok({ status: 'unsupported', reason: 'not-video-page' }))
    await settle()
    expect(wrapper.text()).toContain('영상 페이지가 아닙니다')
  })

  it('다른 탭의 변경은 무시한다', async () => {
    const { fake } = mountPopup()
    await settle()
    fake.emit({ kind: 'updated', tabId: 99 })
    await vi.advanceTimersByTimeAsync(EVENT_DEBOUNCE_MS * 2)
    expect(fake.bridge.inspect).toHaveBeenCalledTimes(1)
  })

  it('활성 탭이 바뀌면 탭을 다시 골라 묻는다', async () => {
    const { fake } = mountPopup()
    await settle()
    fake.setActiveTab(2)
    fake.emit({ kind: 'activated', tabId: 2 })
    await vi.advanceTimersByTimeAsync(EVENT_DEBOUNCE_MS)
    expect(fake.bridge.inspect).toHaveBeenLastCalledWith(2)
  })

  it('늦게 도착한 옛 응답은 새 응답을 덮지 않는다', async () => {
    const { wrapper, fake } = mountPopup()
    await settle()
    fake.emit({ kind: 'updated', tabId: 1 })
    await vi.advanceTimersByTimeAsync(EVENT_DEBOUNCE_MS)

    fake.pending[1]!.resolve(ok({ status: 'unsupported', reason: 'not-video-page' }))
    await settle()
    fake.pending[0]!.resolve(ok(VIDEO))
    await settle()
    expect(wrapper.text()).toContain('영상 페이지가 아닙니다')
    expect(wrapper.find('.video-card').exists()).toBe(false)
  })

  it('제목이 비어 있으면 몇 번만 다시 묻고 멈춘다 (SPA 이동 직후)', async () => {
    const { wrapper, fake } = mountPopup()
    await settle()
    const untitled = { ...VIDEO, title: null, titleSource: null }

    fake.pending[0]!.resolve(ok(untitled))
    await settle()
    for (let round = 1; round <= TITLE_RECHECK_LIMIT; round += 1) {
      await vi.advanceTimersByTimeAsync(TITLE_RECHECK_MS)
      expect(fake.bridge.inspect).toHaveBeenCalledTimes(1 + round)
      fake.pending[round]!.resolve(ok(untitled))
      await settle()
    }
    await vi.advanceTimersByTimeAsync(TITLE_RECHECK_MS * 3)
    expect(fake.bridge.inspect).toHaveBeenCalledTimes(1 + TITLE_RECHECK_LIMIT)
    expect(wrapper.text()).toContain('제목을 읽지 못했습니다')
  })

  it('다시 물어 제목을 얻으면 보이고 더 묻지 않는다', async () => {
    const { wrapper, fake } = mountPopup()
    await settle()
    fake.pending[0]!.resolve(ok({ ...VIDEO, title: null, titleSource: null }))
    await settle()
    await vi.advanceTimersByTimeAsync(TITLE_RECHECK_MS)
    fake.pending[1]!.resolve(ok(VIDEO))
    await settle()
    expect(wrapper.find('.title').text()).toBe('Song <b>Title</b>')
    await vi.advanceTimersByTimeAsync(TITLE_RECHECK_MS * 3)
    expect(fake.bridge.inspect).toHaveBeenCalledTimes(2)
  })

  it('제목이 있으면 다시 묻지 않는다', async () => {
    const { fake } = mountPopup()
    await settle()
    fake.pending[0]!.resolve(ok(VIDEO))
    await settle()
    await vi.advanceTimersByTimeAsync(TITLE_RECHECK_MS * 3)
    expect(fake.bridge.inspect).toHaveBeenCalledTimes(1)
  })

  it('닫히면 구독을 끊는다', async () => {
    const { wrapper, fake } = mountPopup()
    await settle()
    expect(fake.listeners).toHaveLength(1)
    wrapper.unmount()
    expect(fake.listeners).toHaveLength(0)
  })
})

describe('Quick Add (M10-3)', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  async function readyPopup() {
    const mounted = mountPopup()
    await settle()
    mounted.fake.pending[0]!.resolve(ok(VIDEO))
    await settle()
    return mounted
  }

  it('누르면 지금 탭과 보여 준 영상 ID 로 수집 화면을 연다', async () => {
    const { wrapper, fake } = await readyPopup()
    await wrapper.get('button.add').trigger('click')
    await settle()

    expect(fake.bridge.collect).toHaveBeenCalledWith(1, ID)
    fake.collects[0]!.resolve(ok({ status: 'opened', tabId: 77 }))
    await settle()
    expect(wrapper.get('.quick-add-message').text()).toContain('수집 화면을 열었습니다')
  })

  it('기다리는 동안 다시 눌러도 요청은 하나다', async () => {
    const { wrapper, fake } = await readyPopup()
    const button = wrapper.get('button.add')
    await button.trigger('click')
    await button.trigger('click')
    await button.trigger('click')
    await settle()

    expect(fake.bridge.collect).toHaveBeenCalledTimes(1)
    expect(button.attributes('disabled')).toBeDefined()
    expect(button.text()).toBe('여는 중…')
  })

  it('이미 열어 둔 수집 탭이면 그리로 옮겼다고 말한다', async () => {
    const { wrapper, fake } = await readyPopup()
    await wrapper.get('button.add').trigger('click')
    fake.collects[0]!.resolve(ok({ status: 'focused', tabId: 77 }))
    await settle()
    expect(wrapper.get('.quick-add-message').text()).toContain('이미 열어 둔')
  })

  it('그 사이 영상이 바뀌었으면 거절을 알리고 지금 영상을 다시 보여 준다', async () => {
    const { wrapper, fake } = await readyPopup()
    await wrapper.get('button.add').trigger('click')
    fake.collects[0]!.resolve(fail('page-changed', 'x'))
    await settle()

    expect(fake.bridge.inspect).toHaveBeenCalledTimes(2)
    fake.pending[1]!.resolve(ok({ ...VIDEO, videoId: 'aaaaaaaaaaa', title: '다음 영상' }))
    await settle()
    expect(wrapper.find('.video-id').text()).toBe('aaaaaaaaaaa')
    expect(wrapper.get('[role="alert"]').text()).toContain('그 사이 영상이 바뀌었습니다')
    expect(wrapper.get('button.add').attributes('disabled')).toBeUndefined()
  })

  it('지원하지 않는 페이지에는 버튼이 없다', async () => {
    const { wrapper, fake } = mountPopup()
    await settle()
    fake.pending[0]!.resolve(ok({ status: 'unsupported', reason: 'not-youtube' }))
    await settle()
    expect(wrapper.find('button.add').exists()).toBe(false)
    expect(fake.bridge.collect).not.toHaveBeenCalled()
  })
})
