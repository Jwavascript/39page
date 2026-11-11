import { afterEach, describe, expect, it, vi } from 'vitest'

import { createChromeBridge } from '@/popup/bridge'
import { fail, ok } from '@/shared/messages'

import { fakeEvent } from './support/fakeEvent'

const ID = 'dQw4w9WgXcQ'

function stubChrome(sendMessage: (message: unknown) => Promise<unknown>) {
  const onUpdated = fakeEvent<(tabId: number, change: Record<string, unknown>) => void>()
  const onActivated = fakeEvent<(info: { tabId: number }) => void>()
  const query = vi.fn<(info: object) => Promise<{ id: number }[]>>().mockResolvedValue([{ id: 7 }])
  vi.stubGlobal('chrome', {
    runtime: { sendMessage: vi.fn<(message: unknown) => Promise<unknown>>(sendMessage) },
    tabs: { query, onUpdated, onActivated },
  })
  return { onUpdated, onActivated, query }
}

describe('createChromeBridge', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('이 창의 활성 탭을 묻는다', async () => {
    const { query } = stubChrome(async () => undefined)
    expect(await createChromeBridge().activeTabId()).toBe(7)
    expect(query).toHaveBeenCalledWith({ active: true, currentWindow: true })
  })

  it('계약 v1 요청을 보내고 응답을 검증한다', async () => {
    const video = {
      status: 'video',
      videoId: ID,
      pageKind: 'watch',
      title: null,
      titleSource: null,
    }
    stubChrome(async (message) => {
      expect(message).toEqual({ v: 1, type: 'tab/inspect', tabId: 7 })
      return ok(video)
    })
    expect(await createChromeBridge().inspect(7)).toEqual(ok(video))
  })

  it('모양이 틀린 응답은 쓰지 않는다', async () => {
    stubChrome(async () => ok({ status: 'video', videoId: 'bad' }))
    const result = await createChromeBridge().inspect(7)
    expect(!result.ok && result.error.code).toBe('internal')
  })

  it('Background 의 실패 응답을 그대로 전한다', async () => {
    stubChrome(async () => fail('no-tab', '탭을 찾을 수 없다'))
    expect(await createChromeBridge().inspect(7)).toEqual(fail('no-tab', '탭을 찾을 수 없다'))
  })

  it('연결 실패(수신자 없음)는 internal', async () => {
    stubChrome(async () => {
      throw new Error('Could not establish connection. Receiving end does not exist.')
    })
    const result = await createChromeBridge().inspect(7)
    expect(!result.ok && result.error.code).toBe('internal')
  })

  it('답이 없으면 시간 초과', async () => {
    vi.useFakeTimers()
    stubChrome(() => new Promise(() => {}))
    const pending = createChromeBridge(1000).inspect(7)
    await vi.advanceTimersByTimeAsync(1000)
    const result = await pending
    expect(!result.ok && result.error.code).toBe('timeout')
  })

  it('주소 · 제목 · 로드 완료만 알리고, 구독을 끊으면 리스너를 뗀다', () => {
    const { onUpdated, onActivated } = stubChrome(async () => undefined)
    const events: unknown[] = []
    const unsubscribe = createChromeBridge().subscribe((event) => events.push(event))

    onUpdated.emit(3, { url: 'https://www.youtube.com/watch?v=x' })
    onUpdated.emit(3, { title: 'x' })
    onUpdated.emit(3, { status: 'complete' })
    onUpdated.emit(3, { status: 'loading' })
    onUpdated.emit(3, { audible: true })
    onActivated.emit({ tabId: 4 })

    expect(events).toEqual([
      { kind: 'updated', tabId: 3 },
      { kind: 'updated', tabId: 3 },
      { kind: 'updated', tabId: 3 },
      { kind: 'activated', tabId: 4 },
    ])

    unsubscribe()
    expect(onUpdated.listeners).toHaveLength(0)
    expect(onActivated.listeners).toHaveLength(0)
  })
})
