/**
 * M11-5B — YouTube 위 패널 화면 (`PanelApp.vue`). 서비스 워커 · 39page 는 가짜 다리로 흉내 낸다.
 *
 * 보는 것: 권한 안내 · 목록 · 담기 · 새 목록(부분 성공 → 같은 요청으로 다시 담기) · 이미 있는 곡 · 결과를
 * 모를 때 확인 · Moment(고정 시점 · 메모 · 거절) · 영상이 바뀔 때 · 닫기 · 수집 화면.
 */
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import PanelApp from '@/panel/PanelApp.vue'
import { PANEL_BRIDGE, type PanelBridge } from '@/panel/panelBridge'
import type { BridgeCallResult, BridgePayload } from '@/shared/bridgeMessages'
import { ok, type PageInspection } from '@/shared/messages'
import type { PanelSync } from '@/shared/panelMessages'

const V1 = 'aaaaaaaaaaa'
const V2 = 'bbbbbbbbbbb'

const page = (videoId: string, title = `Title ${videoId}`): PageInspection => ({
  status: 'video',
  videoId,
  pageKind: 'watch',
  title,
  titleSource: 'player',
})

function fake(options: { granted?: boolean } = {}) {
  let sync: PanelSync = { seq: 1, mode: 'music', capture: null, page: page(V1) }
  let granted = options.granted ?? true
  let ids = 0
  const calls: { payload: BridgePayload; requestId: string }[] = []
  let answer: (payload: BridgePayload, requestId: string) => BridgeCallResult = (payload) => {
    if (payload.op === 'library/list') {
      return {
        outcome: 'ok',
        data: {
          status: 'ready',
          playlists: [
            {
              id: 'mine',
              name: 'MINE',
              trackCount: 3,
              positions: payload.videoId === V1 ? [2] : [],
            },
            { id: 'drive', name: '드라이브', trackCount: 0, positions: [] },
          ],
        },
      }
    }
    if (payload.op === 'moment/list-for-video') return { outcome: 'ok', data: { atSeconds: [] } }
    return {
      outcome: 'ok',
      data: { playlistName: '드라이브', position: 1, atSeconds: 42, noteSaved: true },
    }
  }
  const bridge: PanelBridge = {
    sync: vi.fn<PanelBridge['sync']>(async () => ok(sync)),
    capture: vi.fn<PanelBridge['capture']>(async (videoId) =>
      ok({ status: 'captured', videoId, atSeconds: 99, title: null, at: 2 }),
    ),
    close: vi.fn<PanelBridge['close']>(async () => {}),
    collect: vi.fn<PanelBridge['collect']>(async () => ok({ status: 'opened' as const, tabId: 9 })),
    bridgeState: vi.fn<PanelBridge['bridgeState']>(async () =>
      ok({
        permission: granted ? ('granted' as const) : ('not-granted' as const),
        origins: ['https://39page.com/*'],
        origin: 'https://39page.com',
      }),
    ),
    requestPermission: vi.fn<PanelBridge['requestPermission']>(async () => {
      granted = true
      return true
    }),
    call: vi.fn<PanelBridge['call']>(async (payload, requestId) => {
      calls.push({ payload, requestId })
      return answer(payload, requestId)
    }),
    newRequestId: () => `req-${String((ids += 1)).padStart(16, '0')}`,
  }
  return {
    bridge,
    calls,
    writes: () =>
      calls.filter((c) =>
        ['track/add', 'playlist/create-and-add', 'moment/add'].includes(c.payload.op),
      ),
    setSync: (next: Partial<PanelSync>) => {
      sync = { ...sync, ...next }
    },
    setAnswer: (fn: typeof answer) => {
      answer = fn
    },
  }
}

async function boot(f: ReturnType<typeof fake>) {
  const wrapper = mount(PanelApp, {
    attachTo: document.body,
    global: { provide: { [PANEL_BRIDGE as symbol]: f.bridge } },
  })
  await flushPromises()
  return wrapper
}

beforeEach(() => vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] }))
afterEach(() => {
  vi.useRealTimers()
  document.body.innerHTML = ''
})

describe('패널 — 접근 · 목록', () => {
  it('권한 요청 중에는 상태를 알리고, 거부 후에는 안내와 폴백을 유지하며 쓰지 않는다', async () => {
    const f = fake({ granted: false })
    let resolvePermission!: (granted: boolean) => void
    vi.mocked(f.bridge.requestPermission).mockImplementation(
      () => new Promise<boolean>((resolve) => (resolvePermission = resolve)),
    )
    const w = await boot(f)
    const grant = w.get('.access .btn.primary')
    await grant.trigger('click')
    expect(grant.attributes('aria-busy')).toBe('true')
    expect(grant.text()).toBe('권한 요청 중…')
    expect(grant.attributes('disabled')).toBeDefined()
    resolvePermission(false)
    await flushPromises()
    expect(grant.attributes('aria-busy')).toBe('false')
    expect(grant.text()).toBe('39page 접근 허용')
    expect(w.get('.access').text()).toContain('수집 화면(새 탭)')
    expect(f.writes()).toHaveLength(0)
    w.unmount()
  })

  it('권한이 없으면 목적을 설명하고, 허용을 누르면 묻고 목록을 불러온다 · 그 전에는 저장 단추가 꺼져 있다', async () => {
    const f = fake({ granted: false })
    const w = await boot(f)
    expect(w.text()).toContain('39page 사이트 접근 권한이 필요합니다')
    expect(
      w
        .findAll('.btn.primary')
        .some(
          (b) => b.text() === '이 플레이리스트에 담기' && b.attributes('disabled') !== undefined,
        ),
    ).toBe(true)
    expect(f.calls).toHaveLength(0)
    await w
      .findAll('button')
      .find((b) => b.text() === '39page 접근 허용')
      ?.trigger('click')
    await flushPromises()
    expect(f.bridge.requestPermission).toHaveBeenCalledWith(['https://39page.com/*'])
    expect(w.findAll('.list-row')).toHaveLength(3)
  })

  it('목록 — 이름 · 곡 수 · 이 영상이 이미 있는 자리', async () => {
    const w = await boot(fake())
    expect(w.text()).toContain('Title aaaaaaaaaaa')
    const rows = w.findAll('.list-row').map((r) => r.text())
    expect(rows[0]).toContain('MINE')
    expect(rows[0]).toContain('3곡 · 이미 2번째')
    expect(rows[2]).toContain('새 플레이리스트 만들기')
  })
})

describe('패널 — 음악 담기', () => {
  it('목록을 골라 담는다 — 39page 가 확인한 결과를 보인다', async () => {
    const f = fake()
    const w = await boot(f)
    await w.findAll('.list-row input')[1]?.setValue(true)
    await w
      .findAll('.btn.primary')
      .find((b) => b.text() === '이 플레이리스트에 담기')
      ?.trigger('click')
    await flushPromises()
    expect(f.writes()[0]?.payload).toEqual({
      op: 'track/add',
      playlistId: 'drive',
      videoId: V1,
      title: 'Title aaaaaaaaaaa',
      allowDuplicate: false,
    })
    expect(w.get('.feedback.ok .feedback-heading').text()).toContain('저장 완료')
    expect(w.get('.feedback.ok').text()).toContain('‘드라이브’ 에 담았어요 · 1번째.')
    expect(w.text()).toContain('이 순간도 Moment 로 저장')
  })

  it('이미 있는 곡 — "한 번 더 담기" 를 골라야 담긴다', async () => {
    const f = fake()
    const w = await boot(f)
    await w.findAll('.list-row input')[0]?.setValue(true)
    const save = () => w.findAll('.btn.primary').find((b) => b.text() === '이 플레이리스트에 담기')
    expect(save()?.attributes('disabled')).toBeDefined()
    expect(w.text()).toContain('이미 있어요 (2번째)')
    await w.get('.check input').setValue(true)
    await save()?.trigger('click')
    await flushPromises()
    expect(f.writes()[0]?.payload).toMatchObject({ playlistId: 'mine', allowDuplicate: true })
  })

  it('새 목록 — 부분 성공이면 사실대로 말하고, "다시 담기" 는 같은 요청 ID 라 목록이 또 생기지 않는다', async () => {
    const f = fake()
    let first = true
    f.setAnswer((payload) => {
      if (payload.op === 'library/list')
        return { outcome: 'ok', data: { status: 'ready', playlists: [] } }
      if (payload.op === 'playlist/create-and-add' && first) {
        first = false
        return {
          outcome: 'error',
          error: {
            code: 'partial',
            retryable: true,
            detail: { playlistId: 'ext-x-list', playlistName: '새벽' },
          },
        }
      }
      return { outcome: 'ok', data: { playlistName: '새벽', position: 1, created: false } }
    })
    const w = await boot(f)
    await w.findAll('.list-row input').at(-1)?.setValue(true)
    await w.get('#panel-new-name').setValue('새벽')
    await w
      .findAll('.btn.primary')
      .find((b) => b.text() === '만들고 담기')
      ?.trigger('click')
    await flushPromises()
    expect(w.get('.feedback.warn').text()).toContain('‘새벽’ 는 만들었지만 곡은 아직 담지 못했어요')
    await w
      .findAll('button')
      .find((b) => b.text() === '이 플레이리스트에 다시 담기')
      ?.trigger('click')
    await flushPromises()
    const writes = f.writes()
    expect(writes).toHaveLength(2)
    expect(writes[1]?.requestId).toBe(writes[0]?.requestId)
    expect(w.get('.feedback.ok').text()).toContain('‘새벽’ 에 담았어요')
  })

  it('결과를 모르면 성공이라 하지 않는다 — "저장됐는지 확인" 은 같은 요청을 저장소에서 찾는다', async () => {
    const f = fake()
    f.setAnswer((payload) => {
      if (payload.op === 'library/list')
        return {
          outcome: 'ok',
          data: {
            status: 'ready',
            playlists: [{ id: 'drive', name: '드라이브', trackCount: 0, positions: [] }],
          },
        }
      if (payload.op === 'request/status')
        return { outcome: 'ok', data: { state: 'saved', playlistName: '드라이브', position: 1 } }
      if (payload.op === 'moment/list-for-video') return { outcome: 'ok', data: { atSeconds: [] } }
      return { outcome: 'uncertain', reason: 'timeout' }
    })
    const w = await boot(f)
    await w.findAll('.list-row input')[0]?.setValue(true)
    await w
      .findAll('.btn.primary')
      .find((b) => b.text() === '이 플레이리스트에 담기')
      ?.trigger('click')
    await flushPromises()
    expect(w.find('.feedback.ok').exists()).toBe(false)
    expect(w.get('.feedback.warn').text()).toContain('저장됐는지 확인하지 못했어요')
    await w
      .findAll('button')
      .find((b) => b.text() === '저장됐는지 확인')
      ?.trigger('click')
    await flushPromises()
    const status = f.calls.find((c) => c.payload.op === 'request/status')
    expect(status?.payload).toEqual({
      op: 'request/status',
      kind: 'track',
      target: f.writes()[0]?.requestId,
      playlistId: 'drive',
    })
    expect(w.get('.feedback.ok').text()).toContain('‘드라이브’ 에 담았어요')
  })
})

describe('패널 — Moment', () => {
  it('단축키로 잡은 시점을 보이고, 메모와 함께 그 시점으로 저장한다 — 동기화로 페이지가 흘러도 시점은 그대로', async () => {
    const f = fake()
    f.setSync({
      seq: 2,
      mode: 'moment',
      capture: { status: 'captured', videoId: V1, atSeconds: 42, title: null, at: 1 },
    })
    const w = await boot(f)
    expect(w.get('#panel-tab-moment').attributes('aria-selected')).toBe('true')
    expect(w.get('.capture-time strong').text()).toBe('0:42')
    await w.get('#panel-note').setValue('후렴 직전')
    vi.advanceTimersByTime(3_000) // 재생은 계속 — 동기화 두 번
    await flushPromises()
    await w
      .findAll('.btn.primary')
      .find((b) => b.text() === 'Moment 저장')
      ?.trigger('click')
    await flushPromises()
    expect(f.writes()[0]?.payload).toEqual({
      op: 'moment/add',
      videoId: V1,
      atSeconds: 42,
      note: '후렴 직전',
      title: 'Title aaaaaaaaaaa',
    })
    expect(w.get('.feedback.ok').text()).toContain('0:42 을 메모와 함께 저장했어요')
    expect(w.text()).toContain('이 음악을 플레이리스트에 담기')
  })

  it('시점을 잡지 못했으면(광고) 이유를 보이고 저장하지 않는다 · 다시 잡기', async () => {
    const f = fake()
    f.setSync({ seq: 2, mode: 'moment', capture: { status: 'refused', reason: 'ad' } })
    const w = await boot(f)
    expect(w.text()).toContain('광고가 재생 중이라 시점을 잡지 않았어요')
    expect(
      w
        .findAll('.btn.primary')
        .find((b) => b.text() === 'Moment 저장')
        ?.attributes('disabled'),
    ).toBeDefined()
    await w
      .findAll('button')
      .find((b) => b.text() === '지금 시점 잡기')
      ?.trigger('click')
    await flushPromises()
    expect(w.get('.capture-time strong').text()).toBe('1:39')
  })
})

describe('패널 — 영상 이동 · 닫기 · 대체 경로', () => {
  it('페이지의 영상이 바뀌면 알리고 카드는 그대로 — 바꾸기를 누르면 새 영상, 메모는 남고 시점은 지운다', async () => {
    const f = fake()
    f.setSync({
      seq: 2,
      mode: 'moment',
      capture: { status: 'captured', videoId: V1, atSeconds: 42, title: null, at: 1 },
    })
    const w = await boot(f)
    await w.get('#panel-note').setValue('쓰던 메모')
    f.setSync({ page: page(V2) })
    vi.advanceTimersByTime(1_500)
    await flushPromises()
    expect(w.get('.banner').text()).toContain('페이지의 영상이 바뀌었어요')
    expect(w.text()).toContain('Title aaaaaaaaaaa')
    await w.get('.banner button').trigger('click')
    await flushPromises()
    expect(w.text()).toContain('Title bbbbbbbbbbb')
    expect((w.get('#panel-note').element as HTMLTextAreaElement).value).toBe('쓰던 메모')
    expect(w.text()).toContain('아직 시점을 잡지 않았어요')
  })

  it('단축키를 다시 누르면(지시 번호가 오르면) 그 순간의 영상 · 탭 · 시점으로', async () => {
    const f = fake()
    const w = await boot(f)
    f.setSync({
      seq: 5,
      mode: 'moment',
      page: page(V2),
      capture: { status: 'captured', videoId: V2, atSeconds: 7, title: null, at: 3 },
    })
    vi.advanceTimersByTime(1_500)
    await flushPromises()
    expect(w.get('#panel-tab-moment').attributes('aria-selected')).toBe('true')
    expect(w.text()).toContain('Title bbbbbbbbbbb')
    expect(w.get('.capture-time strong').text()).toBe('0:07')
  })

  it('Esc · × 로 닫는다 · 수집 화면은 고를 때만 연다', async () => {
    const f = fake()
    const w = await boot(f)
    expect(f.bridge.collect).not.toHaveBeenCalled()
    await w
      .findAll('button')
      .find((b) => b.text() === '39page 수집 화면으로 열기')
      ?.trigger('click')
    await flushPromises()
    expect(f.bridge.collect).toHaveBeenCalledWith({
      kind: 'track',
      videoId: V1,
      atSeconds: null,
      title: 'Title aaaaaaaaaaa',
    })
    expect(w.text()).toContain('39page 수집 화면을 새 탭으로 열었어요')
    await w.get('.panel').trigger('keydown', { key: 'Escape' })
    expect(f.bridge.close).toHaveBeenCalledTimes(1)
  })

  it('연결이 끊기면(묶이지 않은 패널) 동기화를 멈추고 다시 열라고 한다', async () => {
    const f = fake()
    vi.mocked(f.bridge.sync).mockResolvedValue({
      v: 1,
      ok: false,
      error: { code: 'forbidden-sender', message: 'x' },
    })
    const w = await boot(f)
    expect(w.text()).toContain('이 패널의 연결이 끊겼어요')
    vi.advanceTimersByTime(6_000)
    expect(f.bridge.sync).toHaveBeenCalledTimes(1)
  })
})
