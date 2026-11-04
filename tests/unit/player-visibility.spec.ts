/**
 * M3-4 — 가시성 가드와 드로어 연동.
 *
 * 네 겹으로 나눠 본다.
 *   A. 측정  — 순수 함수. 경계값을 전수로 본다
 *   B. 감시  — 관찰자·리스너 배선과 해제
 *   C. 가드  — 코디네이터가 재생을 거절·중단하는 모든 경로
 *   D. 연동  — 앱을 마운트해 드로어·테마와 함께 본다
 *
 * jsdom 은 레이아웃을 계산하지 않으므로 사각형과 `matchMedia` 를 세워 쓴다
 * (`tests/support/playerLayout.ts`). 실제 브레이크포인트 적용과 실제 재생은
 * 브라우저 검증에서 확인한다.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { nextTick } from 'vue'

import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import App from '@/app/App.vue'
import { createPlaybackCoordinator } from '@/features/playback/createPlaybackCoordinator'
import { FakePlayerAdapter } from '@/features/playback/FakePlayerAdapter'
import { PLAYER_ADAPTER_FACTORY } from '@/features/playback/PlayerAdapter'
import type { PlaybackCoordinator } from '@/features/playback/playbackCoordinator'
import {
  measurePlayerVisibility,
  MIN_PLAYER_SIZE_PX,
  watchPlayerVisibility,
  type PlayerVisibility,
} from '@/features/playback/playerVisibility'
import { useLibraryStore } from '@/stores/library'
import { usePlaybackStore } from '@/stores/playback'
import { useThemeStore } from '@/stores/theme'

import {
  HALF_VISIBLE_RECT,
  HIDDEN_RECT,
  installMatchMedia,
  installPlayerRect,
  setPlayerRect,
  TOO_SMALL_RECT,
  uninstallMatchMedia,
  uninstallPlayerRect,
  VISIBLE_RECT,
} from '../support/playerLayout'

const VIEWPORT = { width: 1024, height: 768 }
const VIDEOS = ['aaaaaaaaaaa', 'bbbbbbbbbbb', 'ccccccccccc'] as const

beforeEach(() => {
  globalThis.localStorage.clear()
  delete document.documentElement.dataset.theme
  setActivePinia(createPinia())
})

afterEach(() => {
  uninstallPlayerRect()
  uninstallMatchMedia()
  globalThis.localStorage.clear()
  delete document.documentElement.dataset.theme
  document.body.innerHTML = ''
})

/** `width`×`height` 를 뷰포트 안에 완전히 넣은 사각형. */
function inside(width: number, height: number) {
  return { width, height, top: 10, left: 10, right: 10 + width, bottom: 10 + height }
}

describe('A. 측정 — measurePlayerVisibility', () => {
  it('공식 최소 크기는 200px 이다', () => {
    // 공식 요구사항이다. 값이 내려가면 정책 위반이므로 상수를 고정해 둔다.
    expect(MIN_PLAYER_SIZE_PX).toBe(200)
  })

  it('정확히 200×200 이고 전부 보이면 재생할 수 있다', () => {
    expect(measurePlayerVisibility(inside(200, 200), VIEWPORT)).toEqual({ ok: true })
  })

  it('너비가 1px 모자라면 거절한다', () => {
    expect(measurePlayerVisibility(inside(199, 300), VIEWPORT)).toEqual({
      ok: false,
      reason: 'too-small',
    })
  })

  it('높이가 1px 모자라면 거절한다', () => {
    expect(measurePlayerVisibility(inside(300, 199), VIEWPORT)).toEqual({
      ok: false,
      reason: 'too-small',
    })
  })

  it('display:none 은 "작다" 가 아니라 "가려졌다" 로 본다', () => {
    // 문구가 갈린다. 창을 키우라고 안내하면 사용자가 할 수 있는 일이 없다.
    expect(measurePlayerVisibility(HIDDEN_RECT, VIEWPORT)).toEqual({
      ok: false,
      reason: 'covered',
    })
  })

  /*
   * M6: 노출 비율 임계값(0.5)을 폐지했다.
   *
   * 그 숫자는 공식 기준이 아니라 우리 휴리스틱이었고, 영상이 조금만 가려져도
   * 음악이 끊기는 원인이었다. 부분적으로 가려진 플레이어는 사용자가 여전히
   * 볼 수 있으므로 III.I.9 가 금지하는 상태가 아니다.
   *
   * 아래 네 케이스는 M3-4 에서 `covered` 였고 지금은 재생을 허용한다.
   */
  it('절반만 보여도 재생을 허용한다 (M6: 임계값 폐지)', () => {
    expect(measurePlayerVisibility(HALF_VISIBLE_RECT, VIEWPORT)).toEqual({ ok: true })
  })

  it('절반을 조금 넘게 보이면 허용한다', () => {
    const rect = { width: 400, height: 400, top: 560, left: 100, right: 500, bottom: 960 }
    // 보이는 높이 768-560 = 208 → 52%
    expect(measurePlayerVisibility(rect, VIEWPORT)).toEqual({ ok: true })
  })

  it('위로 스크롤되어 절반 미만만 남아도 허용한다', () => {
    const rect = { width: 400, height: 400, top: -210, left: 100, right: 500, bottom: 190 }
    // 보이는 높이 190 → 47.5%. M3-4 에서는 거절이었다
    expect(measurePlayerVisibility(rect, VIEWPORT)).toEqual({ ok: true })
  })

  it('가로로 절반 밀려나도 허용한다', () => {
    const rect = { width: 400, height: 400, top: 10, left: -210, right: 190, bottom: 410 }
    expect(measurePlayerVisibility(rect, VIEWPORT)).toEqual({ ok: true })
  })

  it('1px 만 보여도 허용한다 — 판정선은 "조금이라도 보이는가" 하나다', () => {
    const rect = { width: 400, height: 400, top: 767, left: 100, right: 500, bottom: 1167 }
    expect(measurePlayerVisibility(rect, VIEWPORT)).toEqual({ ok: true })
  })

  /* 여기부터는 여전히 거절한다. 이 선은 조정 대상이 아니다. */

  it('뷰포트 아래로 완전히 밀려나면 거절한다', () => {
    const rect = { width: 400, height: 400, top: 900, left: 100, right: 500, bottom: 1300 }
    expect(measurePlayerVisibility(rect, VIEWPORT)).toEqual({ ok: false, reason: 'covered' })
  })

  it('뷰포트 위로 완전히 밀려나면 거절한다', () => {
    const rect = { width: 400, height: 400, top: -500, left: 100, right: 500, bottom: -100 }
    expect(measurePlayerVisibility(rect, VIEWPORT)).toEqual({ ok: false, reason: 'covered' })
  })

  it('뷰포트 왼쪽으로 완전히 밀려나면 거절한다', () => {
    const rect = { width: 400, height: 400, top: 10, left: -500, right: -100, bottom: 410 }
    expect(measurePlayerVisibility(rect, VIEWPORT)).toEqual({ ok: false, reason: 'covered' })
  })

  it('경계: 아래쪽이 뷰포트에 정확히 닿기만 하면 거절한다 (겹침 0)', () => {
    const rect = { width: 400, height: 400, top: 768, left: 100, right: 500, bottom: 1168 }
    expect(measurePlayerVisibility(rect, VIEWPORT)).toEqual({ ok: false, reason: 'covered' })
  })
})

describe('A2. 최소 크기의 CSS 보장 (M5)', () => {
  it('영상 영역의 최소 크기가 테두리를 더해 계산된다', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'src/features/playback/PlayerSurface.vue'),
      'utf8',
    )

    /*
     * 공식 요구는 **플레이어 뷰포트**(iframe)가 200×200 이상이라는 것이다.
     * `box-sizing: border-box` 아래에서 테두리를 더하지 않으면 360px 화면에서
     * iframe 이 198px 이 된다 (M5 브라우저 실측).
     */
    expect(source).toContain('--video-border-width: 1px')
    expect(source).toContain(
      'min-width: calc(var(--size-video-min) + 2 * var(--video-border-width))',
    )
    expect(source).toContain(
      'min-height: calc(var(--size-video-min) + 2 * var(--video-border-width))',
    )
    expect(source).toContain('border: var(--video-border-width) solid var(--video-border-color)')
  })

  it('어댑터 영역이 홀더를 꽉 채운다', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'src/features/playback/PlayerSurface.vue'),
      'utf8',
    )

    // 측정 대상이 `.player-mount` 다. 홀더와 같은 사각형이어야 한다.
    expect(source).toMatch(/\.player-mount \{[\s\S]*?position: absolute;[\s\S]*?inset: 0/)
  })
})

describe('B. 감시 — watchPlayerVisibility', () => {
  it('관찰자가 없으면 resize 와 scroll 을 듣는다', () => {
    const add = vi.spyOn(window, 'addEventListener')
    const element = document.createElement('div')
    document.body.append(element)

    const watcher = watchPlayerVisibility(element, () => {})

    const events = add.mock.calls.map(([type]) => type)
    expect(events).toContain('resize')
    expect(events).toContain('scroll')

    watcher.stop()
    add.mockRestore()
  })

  it('관찰자가 있으면 관찰만 하고 scroll 은 듣지 않는다', () => {
    const observe = vi.fn<(target: Element) => void>()
    const disconnect = vi.fn<() => void>()
    class StubObserver {
      observe = observe
      disconnect = disconnect
      unobserve = vi.fn<(target: Element) => void>()
      takeRecords = vi.fn<() => IntersectionObserverEntry[]>()
      root = null
      rootMargin = ''
      thresholds: number[] = []
    }
    const installed = window as unknown as { IntersectionObserver?: unknown }
    installed.IntersectionObserver = StubObserver

    const add = vi.spyOn(window, 'addEventListener')
    const element = document.createElement('div')
    document.body.append(element)

    const watcher = watchPlayerVisibility(element, () => {})

    expect(observe).toHaveBeenCalledWith(element)
    expect(add.mock.calls.map(([type]) => type)).not.toContain('scroll')

    watcher.stop()
    expect(disconnect).toHaveBeenCalledTimes(1)

    add.mockRestore()
    delete installed.IntersectionObserver
  })

  it('resize 가 오면 알림을 전한다', () => {
    const onChange = vi.fn<() => void>()
    const element = document.createElement('div')
    document.body.append(element)

    const watcher = watchPlayerVisibility(element, onChange)
    window.dispatchEvent(new Event('resize'))

    expect(onChange).toHaveBeenCalledTimes(1)
    watcher.stop()
  })

  it('stop() 뒤에는 알리지 않는다', () => {
    const onChange = vi.fn<() => void>()
    const element = document.createElement('div')
    document.body.append(element)

    const watcher = watchPlayerVisibility(element, onChange)
    watcher.stop()
    window.dispatchEvent(new Event('resize'))

    expect(onChange).not.toHaveBeenCalled()
  })

  it('reveal() 은 scrollIntoView 를 즉시 스크롤로 부른다', () => {
    const element = document.createElement('div')
    document.body.append(element)
    const scrollIntoView = vi.fn<(options?: ScrollIntoViewOptions) => void>()
    element.scrollIntoView = scrollIntoView

    const watcher = watchPlayerVisibility(element, () => {})
    watcher.reveal()

    expect(scrollIntoView).toHaveBeenCalledWith({
      behavior: 'instant',
      block: 'center',
      inline: 'nearest',
    })
    watcher.stop()
  })

  it('scrollIntoView 가 없는 환경에서도 터지지 않는다', () => {
    const element = document.createElement('div')
    document.body.append(element)
    // jsdom 에는 구현이 없다.
    expect(typeof element.scrollIntoView).not.toBe('function')

    const watcher = watchPlayerVisibility(element, () => {})

    expect(() => watcher.reveal()).not.toThrow()
    watcher.stop()
  })

  it('measure() 는 캐시하지 않고 그때의 레이아웃을 읽는다', () => {
    installPlayerRect(VISIBLE_RECT)
    const element = document.createElement('div')
    document.body.append(element)

    const watcher = watchPlayerVisibility(element, () => {})
    expect(watcher.measure()).toEqual({ ok: true })

    setPlayerRect(HIDDEN_RECT)
    expect(watcher.measure()).toEqual({ ok: false, reason: 'covered' })

    watcher.stop()
  })
})

/** 코디네이터 + 가짜 어댑터 + 바꿔 끼울 수 있는 가시성 측정. */
function setupCoordinator(trackCount = 3) {
  const library = useLibraryStore()
  const playback = usePlaybackStore()

  const created = library.createPlaylist('PLAYLIST A')
  const playlistId = created.ok ? created.playlistId : ''
  for (let index = 0; index < trackCount; index += 1) {
    library.addTrack(playlistId, {
      videoId: VIDEOS[index % VIDEOS.length] ?? VIDEOS[0],
      title: `Track ${index + 1}`,
    })
  }

  let verdict: PlayerVisibility = { ok: true }
  /** `reveal()` 이 성공하면 끌어온 뒤 보이게 될지. */
  let revealWorks = false
  const presence = {
    measure: () => verdict,
    reveal: vi.fn<() => void>(() => {
      if (revealWorks) verdict = { ok: true }
    }),
  }

  const coordinator: PlaybackCoordinator = createPlaybackCoordinator()
  const fake = new FakePlayerAdapter()
  const attachment = coordinator.attachAdapter(fake, presence)
  fake.mount(document.createElement('div'), attachment.events)

  return {
    library,
    playback,
    coordinator,
    fake,
    attachment,
    presence,
    playlistId,
    hide: (reason: 'covered' | 'too-small' = 'covered') => {
      verdict = { ok: false, reason }
      revealWorks = false
    },
    /** 화면 밖이지만 끌어오면 보이는 상태. 좁은 화면의 단일 열 배치가 이렇다. */
    hideBelowFold: () => {
      verdict = { ok: false, reason: 'covered' }
      revealWorks = true
    },
    show: () => {
      verdict = { ok: true }
      revealWorks = false
    },
  }
}

/** 실제로 재생 중인 상태까지 끌고 간다. */
function playing(context: ReturnType<typeof setupCoordinator>) {
  context.coordinator.playPlaylist(context.playlistId)
  context.fake.emitReady()
  context.fake.emitStateChange('playing')
  return context
}

describe('C. 가드 — 재생을 시작하지 않는다', () => {
  it('가려져 있으면 목록 전체 재생을 거절하고 큐를 바꾸지 않는다', () => {
    const { coordinator, playback, fake, playlistId, hide } = setupCoordinator()
    hide()

    const result = coordinator.playPlaylist(playlistId)

    expect(result).toEqual({ ok: false, reason: 'player-hidden' })
    expect(playback.queue).toEqual([])
    expect(playback.currentTrack).toBeNull()
    expect(fake.calls.load).toEqual([])
  })

  it('가려져 있으면 트랙 재생도 거절한다', () => {
    const { coordinator, playback, fake, library, playlistId, hide } = setupCoordinator()
    const second = library.getPlaylist(playlistId)?.tracks[1]?.id ?? ''
    hide()

    expect(coordinator.playTrack(playlistId, second)).toEqual({
      ok: false,
      reason: 'player-hidden',
    })
    expect(playback.queue).toEqual([])
    expect(fake.calls.load).toEqual([])
  })

  it('200×200 미달도 같은 사유로 거절하되 다른 문구를 쓴다', () => {
    const { coordinator, playback, playlistId, hide } = setupCoordinator()
    hide('too-small')

    expect(coordinator.playPlaylist(playlistId)).toEqual({
      ok: false,
      reason: 'player-hidden',
    })
    expect(playback.statusMessage).toContain('200×200')
    expect(playback.statusTone).toBe('warning')
  })

  it('가려진 상태의 거절은 경고 어조로 안내한다', () => {
    const { coordinator, playback, playlistId, hide } = setupCoordinator()
    hide()

    coordinator.playPlaylist(playlistId)

    expect(playback.statusMessage).toContain('보이지 않아')
    expect(playback.statusTone).toBe('warning')
  })

  it('가려져 있으면 토글이 재생 명령을 보내지 않는다', () => {
    const context = setupCoordinator()
    context.coordinator.playPlaylist(context.playlistId)
    context.fake.emitStateChange('paused')
    context.hide()

    context.coordinator.togglePlay()

    expect(context.fake.calls.play).toBe(0)
  })

  it('가려져 있어도 일시정지는 막지 않는다', () => {
    const context = playing(setupCoordinator())
    context.hide()

    context.coordinator.togglePlay()

    expect(context.fake.calls.pause).toBe(1)
  })

  it('가려져 있으면 다음 버튼이 큐를 움직이지 않는다', () => {
    const context = playing(setupCoordinator())
    const loadsBefore = context.fake.calls.load.length
    context.hide()

    expect(context.coordinator.next()).toBe(false)
    expect(context.playback.queueIndex).toBe(0)
    expect(context.fake.calls.load.length).toBe(loadsBefore)
  })

  it('가려져 있으면 이전 버튼도 큐를 움직이지 않는다', () => {
    const context = setupCoordinator()
    const second = context.library.getPlaylist(context.playlistId)?.tracks[1]?.id ?? ''
    context.coordinator.playTrack(context.playlistId, second)
    context.hide()

    expect(context.coordinator.previous()).toBe(false)
    expect(context.playback.queueIndex).toBe(1)
  })

  it('가려진 동안 영상이 끝나도 다음 곡으로 넘기지 않는다', () => {
    const context = playing(setupCoordinator())
    context.hide()

    context.fake.emitStateChange('ended')

    expect(context.playback.queueIndex).toBe(0)
    expect(context.fake.calls.load.map((call) => call.videoId)).toEqual([VIDEOS[0]])
  })

  it('측정 함수가 없으면 가드하지 않는다', () => {
    // 플레이어 영역 없이 코디네이터만 세우는 기존 테스트와의 호환이다.
    const library = useLibraryStore()
    const playback = usePlaybackStore()
    const created = library.createPlaylist('P')
    const playlistId = created.ok ? created.playlistId : ''
    library.addTrack(playlistId, { videoId: VIDEOS[0], title: 'T' })

    const coordinator = createPlaybackCoordinator()
    const fake = new FakePlayerAdapter()
    coordinator.attachAdapter(fake)

    expect(coordinator.playPlaylist(playlistId)).toEqual({ ok: true })
    expect(playback.queueIndex).toBe(0)
  })

  it('화면 밖이면 끌어온 뒤 다시 재서 재생한다', () => {
    // 좁은 화면의 단일 열 배치에서는 플레이어가 화면 한참 아래에 있다.
    // 끌어오지 않으면 사용자가 손으로 스크롤하기 전까지 아무것도 재생할 수 없다.
    const context = setupCoordinator()
    context.hideBelowFold()

    expect(context.coordinator.playPlaylist(context.playlistId)).toEqual({ ok: true })
    expect(context.presence.reveal).toHaveBeenCalledTimes(1)
    expect(context.fake.calls.load).toHaveLength(1)
  })

  it('이미 보이면 끌어오지 않는다 — 화면이 멋대로 움직이지 않는다', () => {
    const context = setupCoordinator()

    context.coordinator.playPlaylist(context.playlistId)

    expect(context.presence.reveal).not.toHaveBeenCalled()
  })

  it('끌어와도 보이지 않으면(display:none) 거절한다', () => {
    const context = setupCoordinator()
    context.hide()

    expect(context.coordinator.playPlaylist(context.playlistId)).toEqual({
      ok: false,
      reason: 'player-hidden',
    })
    expect(context.presence.reveal).toHaveBeenCalledTimes(1)
  })

  it('너무 작으면 끌어오지 않는다 — 스크롤로 해결되지 않는다', () => {
    const context = setupCoordinator()
    context.hide('too-small')

    context.coordinator.playPlaylist(context.playlistId)

    expect(context.presence.reveal).not.toHaveBeenCalled()
  })

  it('detach 하면 측정 함수도 함께 떨어진다', () => {
    const context = setupCoordinator()
    context.hide()
    context.attachment.detach()

    // 어댑터도 측정도 없으니 명령은 아무 데도 가지 않지만 큐는 만들어진다.
    expect(context.coordinator.playPlaylist(context.playlistId)).toEqual({ ok: true })
  })
})

describe('C2. 가드 — 재생 중에 가려지면 멈춘다', () => {
  it('가려졌다는 알림을 받으면 일시정지하고 안내한다', () => {
    const context = playing(setupCoordinator())
    context.hide()

    context.coordinator.revalidatePlayerVisibility()

    expect(context.fake.calls.pause).toBe(1)
    expect(context.playback.statusMessage).toBe(
      '영상이 화면에서 가려져 일시정지됐어요. 돌아와서 ▶ 를 눌러주세요.',
    )
  })

  it('보이는 상태라면 알림을 받아도 멈추지 않는다', () => {
    const context = playing(setupCoordinator())

    context.coordinator.revalidatePlayerVisibility()

    expect(context.fake.calls.pause).toBe(0)
  })

  it('이미 멈춰 있으면 다시 멈추지 않는다', () => {
    const context = playing(setupCoordinator())
    context.fake.emitStateChange('paused')
    context.hide()

    context.coordinator.revalidatePlayerVisibility()

    expect(context.fake.calls.pause).toBe(0)
  })

  it('불러오는 중에 가려지면 보류한 재생까지 취소한다', () => {
    const context = setupCoordinator()
    context.coordinator.playPlaylist(context.playlistId)
    expect(context.playback.playerState).toBe('loading')
    context.hide()

    context.coordinator.revalidatePlayerVisibility()

    expect(context.fake.calls.pause).toBe(1)
  })

  it('다시 보이게 되어도 자동으로 재생하지 않는다', () => {
    const context = playing(setupCoordinator())
    context.hide()
    context.coordinator.revalidatePlayerVisibility()
    context.fake.emitStateChange('paused')

    context.show()
    context.coordinator.revalidatePlayerVisibility()

    expect(context.fake.calls.play).toBe(0)
    expect(context.playback.playerState).toBe('paused')
  })

  it('멈춘 뒤 늦게 도착한 ENDED 로 다음 곡이 흐르지 않는다', () => {
    const context = playing(setupCoordinator())
    context.hide()
    context.coordinator.revalidatePlayerVisibility()

    context.show()
    context.fake.emitStateChange('ended')

    expect(context.playback.queueIndex).toBe(0)
  })

  it('다시 보이면 가시성 안내를 지운다 (M5)', () => {
    const context = playing(setupCoordinator())
    context.hide()
    context.coordinator.revalidatePlayerVisibility()
    context.fake.emitStateChange('paused')
    expect(context.playback.statusMessage).not.toBe('')

    context.show()
    context.coordinator.revalidatePlayerVisibility()

    /*
     * "영상이 가려져 일시정지됐어요" 가 영상이 다시 보이는 동안 남아 있으면
     * 사실과 어긋난다.
     */
    expect(context.playback.statusMessage).toBe('')
  })

  it('안내를 지워도 재생을 되살리지는 않는다 (M5)', () => {
    const context = playing(setupCoordinator())
    context.hide()
    context.coordinator.revalidatePlayerVisibility()
    context.fake.emitStateChange('paused')

    context.show()
    context.coordinator.revalidatePlayerVisibility()

    expect(context.fake.calls.play).toBe(0)
    expect(context.playback.playerState).toBe('paused')
  })

  it('거절 안내도 다시 보이면 지워진다 (M5)', () => {
    const context = setupCoordinator()
    context.hide()
    context.coordinator.playPlaylist(context.playlistId)
    expect(context.playback.statusMessage).toContain('보이지 않아')

    context.show()
    context.coordinator.revalidatePlayerVisibility()

    expect(context.playback.statusMessage).toBe('')
  })

  it('오류 안내는 다시 보여도 남는다 (M5)', () => {
    const context = playing(setupCoordinator())
    context.fake.emitError({ kind: 'embed-not-allowed', code: 150 })
    const message = context.playback.statusMessage

    context.coordinator.revalidatePlayerVisibility()

    // 영상이 보이는 것과 그 영상이 재생되는 것은 다른 문제다.
    expect(context.playback.statusMessage).toBe(message)
  })

  it('큐 끝 안내도 다시 보여도 남는다 (M5)', () => {
    const context = playing(setupCoordinator(1))
    context.fake.emitStateChange('ended')
    expect(context.playback.statusMessage).toContain('마지막 곡')

    context.coordinator.revalidatePlayerVisibility()

    expect(context.playback.statusMessage).toContain('마지막 곡')
  })

  it('가려진 뒤 사용자가 다시 누르면 재생된다', () => {
    const context = playing(setupCoordinator())
    context.hide()
    context.coordinator.revalidatePlayerVisibility()
    context.fake.emitStateChange('paused')
    context.show()

    context.coordinator.togglePlay()

    expect(context.fake.calls.play).toBe(1)
    expect(context.playback.statusMessage).toBe('')
  })
})

describe('C3. 가드 — 가려지기 직전 통지', () => {
  it('재생 중이면 통지만으로 멈춘다 — 측정하지 않는다', () => {
    // 아직 보이는 상태다. 측정에 맡기면 "보인다" 가 나와 멈추지 않는다.
    const context = playing(setupCoordinator())

    context.coordinator.playerWillHide()

    expect(context.fake.calls.pause).toBe(1)
    expect(context.playback.statusMessage).toBe('작은 화면에서는 영상이 가려져 일시정지됩니다.')
  })

  it('불러오는 중이어도 멈춘다', () => {
    const context = setupCoordinator()
    context.coordinator.playPlaylist(context.playlistId)

    context.coordinator.playerWillHide()

    expect(context.fake.calls.pause).toBe(1)
  })

  it('멈춰 있으면 아무 일도 하지 않는다', () => {
    const context = playing(setupCoordinator())
    context.fake.emitStateChange('paused')
    const message = context.playback.statusMessage

    context.coordinator.playerWillHide()

    expect(context.fake.calls.pause).toBe(0)
    expect(context.playback.statusMessage).toBe(message)
  })

  it('통지로 멈춘 뒤에는 ENDED 가 와도 넘기지 않는다', () => {
    const context = playing(setupCoordinator())
    context.coordinator.playerWillHide()

    context.fake.emitStateChange('ended')

    expect(context.playback.queueIndex).toBe(0)
  })
})

/* ---------- D. 앱 통합 ---------- */

function mountApp() {
  const fake = new FakePlayerAdapter()
  const wrapper = mount(App, {
    attachTo: document.body,
    global: { provide: { [PLAYER_ADAPTER_FACTORY as symbol]: () => fake } },
  })
  return { wrapper, fake }
}

type Wrapper = ReturnType<typeof mountApp>['wrapper']

function deckTrigger(wrapper: Wrapper) {
  return wrapper.get(`.deck-open--${useThemeStore().current}`)
}

async function seedPlaying(trackCount = 3) {
  const { wrapper, fake } = mountApp()
  const library = useLibraryStore()
  const playback = usePlaybackStore()

  const created = library.createPlaylist('LIST')
  const playlistId = created.ok ? created.playlistId : ''
  for (let index = 0; index < trackCount; index += 1) {
    library.addTrack(playlistId, {
      videoId: VIDEOS[index % VIDEOS.length] ?? VIDEOS[0],
      title: `Track ${index + 1}`,
    })
  }
  library.selectPlaylist(playlistId)
  await nextTick()

  return { wrapper, fake, library, playback, playlistId }
}

describe('D. 드로어 연동', () => {
  it('좁은 화면에서 드로어를 열면 DOM 이 바뀌기 전에 멈춘다', async () => {
    installPlayerRect(VISIBLE_RECT)
    installMatchMedia(true)
    const context = await seedPlaying()

    context.wrapper.get('.playlist-play').trigger('click')
    await nextTick()
    context.fake.emitReady()
    context.fake.emitStateChange('playing')
    await nextTick()

    // 기다리지 않는다. 핸들러가 동기적으로 멈춰야 한다.
    void deckTrigger(context.wrapper).trigger('click')

    expect(context.fake.calls.pause).toBe(1)
    await nextTick()
    expect(context.wrapper.get('.drawer').attributes('hidden')).toBeUndefined()
  })

  it('넓은 화면에서는 드로어를 열어도 멈추지 않는다', async () => {
    installPlayerRect(VISIBLE_RECT)
    installMatchMedia(false)
    const context = await seedPlaying()

    context.wrapper.get('.playlist-play').trigger('click')
    await nextTick()
    context.fake.emitReady()
    context.fake.emitStateChange('playing')

    await deckTrigger(context.wrapper).trigger('click')

    expect(context.fake.calls.pause).toBe(0)
    expect(context.playback.playerState).toBe('playing')
  })

  it('matchMedia 가 없는 환경에서는 통지하지 않는다', async () => {
    installPlayerRect(VISIBLE_RECT)
    const context = await seedPlaying()

    context.wrapper.get('.playlist-play').trigger('click')
    await nextTick()
    context.fake.emitReady()
    context.fake.emitStateChange('playing')

    await deckTrigger(context.wrapper).trigger('click')

    expect(context.fake.calls.pause).toBe(0)
  })

  it('가려진 상태에서 드로어의 트랙 ▶ 를 누르면 드로어가 이유를 알린다', async () => {
    installPlayerRect(HIDDEN_RECT)
    const context = await seedPlaying()

    await deckTrigger(context.wrapper).trigger('click')
    await context.wrapper.get('.track-play').trigger('click')

    expect(context.wrapper.get('.play-notice').text()).toContain('닫고')
    expect(context.playback.queue).toEqual([])
    expect(context.fake.calls.load).toEqual([])
  })

  it('가려진 상태에서 목록 전체 재생도 같은 안내를 띄운다', async () => {
    installPlayerRect(HIDDEN_RECT)
    const context = await seedPlaying()

    await deckTrigger(context.wrapper).trigger('click')
    await context.wrapper.get('.playlist-play').trigger('click')

    expect(context.wrapper.find('.play-notice').exists()).toBe(true)
    expect(context.playback.currentTrack).toBeNull()
  })

  it('영역이 보이면 안내가 뜨지 않고 재생이 시작된다', async () => {
    installPlayerRect(VISIBLE_RECT)
    const context = await seedPlaying()

    await deckTrigger(context.wrapper).trigger('click')
    await context.wrapper.get('.track-play').trigger('click')

    expect(context.wrapper.find('.play-notice').exists()).toBe(false)
    expect(context.fake.calls.load).toHaveLength(1)
  })

  it('안내가 떴다가 영역이 돌아오면 사라진다', async () => {
    installPlayerRect(HIDDEN_RECT)
    const context = await seedPlaying()

    await deckTrigger(context.wrapper).trigger('click')
    await context.wrapper.get('.track-play').trigger('click')
    expect(context.wrapper.find('.play-notice').exists()).toBe(true)

    setPlayerRect(VISIBLE_RECT)
    await context.wrapper.get('.track-play').trigger('click')

    expect(context.wrapper.find('.play-notice').exists()).toBe(false)
  })

  it('드로어를 빠르게 여닫아도 어댑터와 iframe 호스트가 그대로다', async () => {
    installPlayerRect(VISIBLE_RECT)
    installMatchMedia(true)
    const context = await seedPlaying()

    const host = context.fake.hostNode
    const mount0 = context.wrapper.get('.player-mount').element

    for (let round = 0; round < 3; round += 1) {
      await deckTrigger(context.wrapper).trigger('click')
      await context.wrapper.get('.drawer .close').trigger('click')
    }

    expect(context.fake.calls.mount).toBe(1)
    expect(context.fake.calls.destroy).toBe(0)
    expect(context.fake.hostNode).toBe(host)
    expect(context.wrapper.get('.player-mount').element).toBe(mount0)
  })

  it('가려진 상태로 여닫기를 반복해도 잘못된 재생 명령이 나가지 않는다', async () => {
    installPlayerRect(HIDDEN_RECT)
    installMatchMedia(true)
    const context = await seedPlaying()

    for (let round = 0; round < 3; round += 1) {
      await deckTrigger(context.wrapper).trigger('click')
      await context.wrapper.get('.drawer .close').trigger('click')
    }

    expect(context.fake.calls.load).toEqual([])
    expect(context.fake.calls.play).toBe(0)
  })

  it('창 크기가 바뀌어 가려지면 재생이 멈춘다', async () => {
    installPlayerRect(VISIBLE_RECT)
    const context = await seedPlaying()

    await context.wrapper.get('.playlist-play').trigger('click')
    context.fake.emitReady()
    context.fake.emitStateChange('playing')

    setPlayerRect(HIDDEN_RECT)
    window.dispatchEvent(new Event('resize'))

    expect(context.fake.calls.pause).toBe(1)
    expect(context.playback.statusMessage).toContain('가려져 일시정지')
  })

  it('테마를 바꿔도 감시가 살아 있고 어댑터는 그대로다', async () => {
    installPlayerRect(VISIBLE_RECT)
    const context = await seedPlaying()
    const theme = useThemeStore()

    await context.wrapper.get('.playlist-play').trigger('click')
    context.fake.emitReady()
    context.fake.emitStateChange('playing')

    theme.setTheme('kawaii-synth-cassette')
    await nextTick()

    expect(context.fake.calls.mount).toBe(1)
    expect(context.fake.calls.destroy).toBe(0)

    setPlayerRect(HIDDEN_RECT)
    window.dispatchEvent(new Event('resize'))

    expect(context.fake.calls.pause).toBe(1)
  })

  it('언마운트하면 감시를 거둔다', async () => {
    installPlayerRect(VISIBLE_RECT)
    const context = await seedPlaying()

    await context.wrapper.get('.playlist-play').trigger('click')
    context.fake.emitReady()
    context.fake.emitStateChange('playing')

    context.wrapper.unmount()
    setPlayerRect(HIDDEN_RECT)
    window.dispatchEvent(new Event('resize'))

    // 어댑터는 이미 destroy 됐다. 멈춤 명령이 더 가지 않아야 한다.
    expect(context.fake.calls.pause).toBe(0)
  })

  it('너무 작은 영역이면 재생을 시작하지 않는다', async () => {
    installPlayerRect(TOO_SMALL_RECT)
    const context = await seedPlaying()

    await context.wrapper.get('.playlist-play').trigger('click')

    expect(context.fake.calls.load).toEqual([])
    expect(context.wrapper.get('.status').text()).toContain('200×200')
  })
})
