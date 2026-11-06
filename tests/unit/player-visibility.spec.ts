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

import { flushPromises, mount } from '@vue/test-utils'
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
  type PlayerRect,
  type PlayerVisibility,
} from '@/features/playback/playerVisibility'
import { useLibraryStore } from '@/stores/library'
import { usePlaybackStore } from '@/stores/playback'
import { useThemeStore } from '@/stores/theme'

import {
  HALF_VISIBLE_RECT,
  HIDDEN_RECT,
  setRectOverride,
  sheetRect,
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

describe('A3. 우리 UI 가 덮은 경우 (M7-1)', () => {
  /*
   * 세로 화면의 레코드 시트가 플레이어를 덮을 수 있게 됐다 (사용자 지시:
   * "만약 유튜브 화면을 규정 이상으로 가리면 그냥 일시정지").
   *
   * **규정은 200×200 이다.** 새 비율 임계값을 만들지 않는다 — M6 에서 폐지한
   * 휴리스틱이 되살아나기 때문이다. 공식 요구사항이 "임베드 플레이어는
   * 200×200 이상의 뷰포트를 가져야 한다" 이므로, 우리가 그 아래로 덮어 버리면
   * 요구사항을 우리 손으로 깬 것이다.
   */
  const viewport = { width: 1024, height: 768 }

  /** 뷰포트 안에 완전히 들어오는 300×300 플레이어. top 100 ~ bottom 400. */
  const rect: PlayerRect = {
    width: 300,
    height: 300,
    top: 100,
    left: 100,
    right: 400,
    bottom: 400,
  }

  it('가림이 없으면 그대로 허용한다', () => {
    expect(measurePlayerVisibility(rect, { ...viewport, obstructedBottom: 0 })).toEqual({
      ok: true,
    })
  })

  it('가림 값을 주지 않아도 허용한다 — 기본은 0 이다', () => {
    expect(measurePlayerVisibility(rect, viewport)).toEqual({ ok: true })
  })

  it('덮고 남은 높이가 200px 이면 허용한다 (경계)', () => {
    // 시트 위쪽을 300 에 둔다 → 남는 높이는 100‥300 = 200px.
    const obstructedBottom = viewport.height - 300

    expect(measurePlayerVisibility(rect, { ...viewport, obstructedBottom })).toEqual({ ok: true })
  })

  it('덮고 남은 높이가 1px 모자라면 거절한다', () => {
    const obstructedBottom = viewport.height - 299

    expect(measurePlayerVisibility(rect, { ...viewport, obstructedBottom })).toEqual({
      ok: false,
      reason: 'covered',
    })
  })

  it('절반쯤 덮으면 거절한다 — 비율이 아니라 남은 높이로 본다', () => {
    // 150px 만 남는다. 비율로는 절반이지만 규정 미달이다.
    const obstructedBottom = viewport.height - 250

    expect(measurePlayerVisibility(rect, { ...viewport, obstructedBottom })).toEqual({
      ok: false,
      reason: 'covered',
    })
  })

  it('완전히 덮으면 거절한다', () => {
    expect(
      measurePlayerVisibility(rect, { ...viewport, obstructedBottom: viewport.height }),
    ).toEqual({ ok: false, reason: 'covered' })
  })

  it('`too-small` 이 아니라 `covered` 다 — 사용자가 할 일이 다르다', () => {
    const verdict = measurePlayerVisibility(rect, {
      ...viewport,
      obstructedBottom: viewport.height - 100,
    })

    // 창을 키우는 것이 아니라 시트를 닫거나 스크롤해야 한다.
    expect(verdict).toEqual({ ok: false, reason: 'covered' })
  })

  it('영역 자체가 200×200 미만이면 가림과 무관하게 `too-small` 이다', () => {
    const small: PlayerRect = {
      width: 180,
      height: 180,
      top: 10,
      left: 10,
      right: 190,
      bottom: 190,
    }

    expect(measurePlayerVisibility(small, { ...viewport, obstructedBottom: 0 })).toEqual({
      ok: false,
      reason: 'too-small',
    })
  })

  it('음수 가림은 0 으로 본다', () => {
    expect(measurePlayerVisibility(rect, { ...viewport, obstructedBottom: -100 })).toEqual({
      ok: true,
    })
  })

  it('뷰포트 클리핑은 여전히 비율을 보지 않는다 (M6 유지)', () => {
    // 아래쪽이 뷰포트 밖으로 나가 100px 만 남았다. 가림은 없다.
    const hanging: PlayerRect = {
      width: 300,
      height: 300,
      top: 668,
      left: 100,
      right: 400,
      bottom: 968,
    }

    expect(measurePlayerVisibility(hanging, viewport)).toEqual({ ok: true })
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

  /*
   * M7-1 에서 `block` 이 `'center'` → `'start'` 로 바뀌었다.
   *
   * 하단 시트가 열려 있으면 화면 가운데는 **시트 아래**다 — 끌어온 결과가
   * 다시 덮인 자리가 된다. 위쪽에 붙이면 덮이지 않은 띠를 최대로 쓴다.
   */
  it('reveal() 은 scrollIntoView 를 즉시 스크롤로 위쪽에 붙여 부른다', () => {
    const element = document.createElement('div')
    document.body.append(element)
    const scrollIntoView = vi.fn<(options?: ScrollIntoViewOptions) => void>()
    element.scrollIntoView = scrollIntoView

    const watcher = watchPlayerVisibility(element, () => {})
    watcher.reveal()

    expect(scrollIntoView).toHaveBeenCalledWith({
      behavior: 'instant',
      block: 'start',
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
  /** 측정에 넘어온 하단 가림 높이 (M7-1). */
  const measuredObstruction: (number | undefined)[] = []
  const presence = {
    measure: (obstructedBottom?: number) => {
      measuredObstruction.push(obstructedBottom)
      return verdict
    },
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
    measuredObstruction,
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

describe('C4. 가드 — 우리 UI 가 하단을 덮는다 (M7-1)', () => {
  /*
   * 세로 화면의 레코드 시트가 플레이어를 덮을 수 있게 됐다. 가리는 쪽만
   * **얼마나** 가리는지 알 수 있으므로 숫자를 알린다. 판단은 재생 쪽이 한다.
   */
  it('알린 가림 높이를 측정에 그대로 넘긴다', () => {
    const context = setupCoordinator()
    context.coordinator.setBottomObstruction(420)
    context.measuredObstruction.length = 0

    context.coordinator.playPlaylist(context.playlistId)

    expect(context.measuredObstruction).toContain(420)
  })

  it('알리지 않으면 0 으로 잰다', () => {
    const context = setupCoordinator()
    context.measuredObstruction.length = 0

    context.coordinator.playPlaylist(context.playlistId)

    expect(context.measuredObstruction.every((value) => value === 0)).toBe(true)
  })

  it('음수는 0 으로 본다', () => {
    const context = setupCoordinator()
    context.coordinator.setBottomObstruction(-50)
    context.measuredObstruction.length = 0

    context.coordinator.playPlaylist(context.playlistId)

    expect(context.measuredObstruction).toContain(0)
  })

  it('같은 값을 다시 알리면 재측정하지 않는다', () => {
    const context = playing(setupCoordinator())
    context.coordinator.setBottomObstruction(300)
    context.measuredObstruction.length = 0

    context.coordinator.setBottomObstruction(300)

    // 매 resize 마다 재측정하면 멈춘 이유를 덮어쓴다.
    expect(context.measuredObstruction).toEqual([])
  })

  it('값이 바뀌면 즉시 다시 재고, 덮였으면 멈춘다', () => {
    const context = playing(setupCoordinator())
    // 시트가 올라와 영상을 덮었다.
    context.hide('covered')

    context.coordinator.setBottomObstruction(560)

    expect(context.fake.calls.pause).toBe(1)
    expect(context.playback.statusMessage).toContain('가려져 일시정지')
  })

  it('덮이지 않았으면 멈추지 않는다', () => {
    const context = playing(setupCoordinator())

    context.coordinator.setBottomObstruction(120)

    expect(context.fake.calls.pause).toBe(0)
    expect(context.playback.playerState).toBe('playing')
  })

  it('덮인 동안에는 재생을 시작하지 않는다', () => {
    const context = setupCoordinator()
    context.hide('covered')
    context.coordinator.setBottomObstruction(560)

    const result = context.coordinator.playPlaylist(context.playlistId)

    expect(result).toEqual({ ok: false, reason: 'player-hidden' })
    expect(context.playback.queue).toEqual([])
  })

  it('시트가 닫혀 가림이 걷히면 가시성 안내가 지워진다', () => {
    const context = setupCoordinator()
    context.hide('covered')
    context.coordinator.setBottomObstruction(560)
    context.coordinator.playPlaylist(context.playlistId)
    expect(context.playback.statusMessage).not.toBe('')

    // 시트를 닫았다. 다시 보인다.
    context.show()
    context.coordinator.setBottomObstruction(0)

    expect(context.playback.statusMessage).toBe('')
  })

  it('가림이 걷혀도 자동으로 재생하지 않는다', () => {
    const context = playing(setupCoordinator())
    context.hide('covered')
    context.coordinator.setBottomObstruction(560)
    expect(context.fake.calls.pause).toBe(1)

    context.show()
    context.coordinator.setBottomObstruction(0)

    // 보이게 됐다는 것만으로 소리를 내면 사용자가 의도하지 않은 재생이다.
    expect(context.fake.calls.play).toBe(0)
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

/**
 * 트랙 드로어를 여는 트리거 (M7).
 *
 * 데크는 이제 플레이리스트 위젯을 펼친다. 드로어는 **타일 본문**으로 연다.
 */
function editorTrigger(wrapper: Wrapper) {
  return wrapper.get('.playlist-tile .playlist-open')
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
  /*
   * M6-2: 좁은 화면에서도 드로어를 열면 **멈추지 않는다.**
   *
   * M3-4 에서는 드로어가 스테이지를 `display: none` 으로 대체했기 때문에
   * 가려지기 전에 멈춰야 했다. 그 결과 세로 화면에서는 재생 경로가 사라졌고,
   * 실기기에서 "세로에서는 음악 재생이 불가능하다" 로 보고됐다.
   *
   * 지금은 플레이어를 숨기지 않고 시트가 그 아래에서 올라온다. **덮지 않으면**
   * 멈출 이유가 없다. 이 테스트가 그 수정을 고정한다.
   *
   * M7-1: 시트가 화면을 가릴 수 있게 됐다. 그래서 "드로어를 열면 멈추지
   * 않는다" 가 아니라 **"덮지 않으면 멈추지 않는다"** 가 보장이다. 아래
   * 두 테스트가 양쪽을 고정한다.
   *
   * M7: 드로어를 여는 트리거가 데크에서 **플레이리스트 타일 본문**으로 바뀌었다.
   */
  it('좁은 화면에서 시트가 영상을 덮지 않으면 재생이 끊기지 않는다', async () => {
    installPlayerRect(VISIBLE_RECT)
    installMatchMedia(true)
    const context = await seedPlaying()

    // 플레이어는 top 120 ~ bottom 425 다. 시트를 그 아래에서만 올린다.
    setRectOverride('#record-library-drawer', sheetRect(300))

    context.wrapper.get('.playlist-play').trigger('click')
    await nextTick()
    context.fake.emitReady()
    context.fake.emitStateChange('playing')
    await nextTick()

    await context.wrapper.get('.playlist-tile .playlist-open').trigger('click')
    await nextTick()
    await nextTick()

    expect(context.fake.calls.pause).toBe(0)
    expect(context.playback.playerState).toBe('playing')
    expect(context.wrapper.get('.drawer').attributes('hidden')).toBeUndefined()
  })

  /*
   * 사용자 지시 그대로다: "만약 유튜브 화면을 규정 이상으로 가리면 그냥
   * 일시정지". 규정은 200×200 이고, 남은 높이가 그 아래면 멈춘다.
   */
  it('시트가 규정 이상으로 덮으면 일시정지한다 (M7-1)', async () => {
    installPlayerRect(VISIBLE_RECT)
    installMatchMedia(true)
    const context = await seedPlaying()

    context.wrapper.get('.playlist-play').trigger('click')
    await nextTick()
    context.fake.emitReady()
    context.fake.emitStateChange('playing')
    await nextTick()

    // 플레이어 위쪽 120px 만 남긴다 → 200px 미달이다.
    setRectOverride('#record-library-drawer', sheetRect(528))

    await context.wrapper.get('.playlist-tile .playlist-open').trigger('click')
    await nextTick()
    await nextTick()

    expect(context.fake.calls.pause).toBe(1)
    expect(context.playback.statusMessage).toContain('가려져 일시정지')
    // 큐는 그대로다. 돌아와서 ▶ 를 누르면 이어서 재생된다.
    expect(context.playback.queue).toHaveLength(3)
  })

  it('넓은 화면에서는 드로어가 측면 열이므로 가림을 알리지 않는다', async () => {
    installPlayerRect(VISIBLE_RECT)
    installMatchMedia(false)
    const context = await seedPlaying()

    // 측면 열이어도 스텁 사각형은 화면 하단까지 내려와 있다.
    setRectOverride('#record-library-drawer', sheetRect(700))

    context.wrapper.get('.playlist-play').trigger('click')
    await nextTick()
    context.fake.emitReady()
    context.fake.emitStateChange('playing')
    await nextTick()

    await context.wrapper.get('.playlist-tile .playlist-open').trigger('click')
    await nextTick()
    await nextTick()

    // 브레이크포인트가 넓으면 시트가 아니다. 덮는 것이 없다.
    expect(context.fake.calls.pause).toBe(0)
    expect(context.playback.playerState).toBe('playing')
  })

  /*
   * M7-2 — 실기기 보고: "트랙 중에 두 번째 곡으로 변경하고 싶어서 재생을
   * 눌러도 저 오류가 나서 영상이 바뀌지 않아."
   *
   * 안내가 맞는 말이어도 사용자가 할 일이 남으면 막힌 것이다. 재생을 누르면
   * 시트가 **먼저 비켜주고** 재생한다.
   */
  it('시트 안에서 트랙 ▶ 를 누르면 시트가 닫히고 재생된다 (M7-2)', async () => {
    installPlayerRect(VISIBLE_RECT)
    installMatchMedia(true)
    const context = await seedPlaying()
    // 시트가 플레이어를 규정 이상으로 덮는다.
    setRectOverride('#record-library-drawer', sheetRect(528))

    await editorTrigger(context.wrapper).trigger('click')
    await nextTick()
    await nextTick()

    await context.wrapper.get('.track-play').trigger('click')
    await flushPromises()

    expect(context.wrapper.get('.drawer').attributes('hidden')).toBeDefined()
    expect(context.fake.calls.load).toEqual([{ videoId: VIDEOS[0], autoplay: true }])
  })

  it('재생 중에 다른 트랙으로 바꿀 수 있다 (M7-2, 보고된 시나리오)', async () => {
    installPlayerRect(VISIBLE_RECT)
    installMatchMedia(true)
    const context = await seedPlaying()

    // 1곡을 재생 중이다.
    await context.wrapper.get('.playlist-play').trigger('click')
    await flushPromises()
    context.fake.emitReady()
    context.fake.emitStateChange('playing')
    await nextTick()
    expect(context.fake.calls.load).toHaveLength(1)

    // 시트를 열어 트랙 목록을 본다. 영상이 덮여 일시정지된다.
    setRectOverride('#record-library-drawer', sheetRect(528))
    await editorTrigger(context.wrapper).trigger('click')
    await nextTick()
    await nextTick()
    expect(context.fake.calls.pause).toBe(1)

    // 두 번째 곡의 ▶ 를 누른다.
    await context.wrapper.findAll('.track-play')[1]?.trigger('click')
    await flushPromises()

    expect(context.wrapper.get('.drawer').attributes('hidden')).toBeDefined()
    expect(context.playback.queueIndex).toBe(1)
    expect(context.fake.calls.load[1]).toEqual({ videoId: VIDEOS[1], autoplay: true })
  })

  it('시트 안에서 목록 전체 재생도 시트를 닫고 재생한다 (M7-2)', async () => {
    installPlayerRect(VISIBLE_RECT)
    installMatchMedia(true)
    const context = await seedPlaying()
    setRectOverride('#record-library-drawer', sheetRect(528))

    await editorTrigger(context.wrapper).trigger('click')
    await nextTick()
    await nextTick()

    const playAll = context.wrapper
      .findAll('.drawer-actions button')
      .find((button) => button.text().includes('목록 전체 재생'))
    await playAll?.trigger('click')
    await flushPromises()

    expect(context.wrapper.get('.drawer').attributes('hidden')).toBeDefined()
    expect(context.playback.queue).toHaveLength(3)
    expect(context.fake.calls.load).toHaveLength(1)
  })

  it('타일의 ▶ 도 시트를 닫고 재생한다 (M7-2)', async () => {
    installPlayerRect(VISIBLE_RECT)
    installMatchMedia(true)
    const context = await seedPlaying()
    setRectOverride('#record-library-drawer', sheetRect(528))

    await editorTrigger(context.wrapper).trigger('click')
    await nextTick()
    await nextTick()

    await context.wrapper.get('.playlist-play').trigger('click')
    await flushPromises()

    expect(context.wrapper.get('.drawer').attributes('hidden')).toBeDefined()
    expect(context.fake.calls.load).toHaveLength(1)
  })

  it('데크의 ▶ 도 같은 길을 쓴다 (M7-2)', async () => {
    installPlayerRect(VISIBLE_RECT)
    installMatchMedia(true)
    const context = await seedPlaying()
    setRectOverride('#record-library-drawer', sheetRect(528))

    await editorTrigger(context.wrapper).trigger('click')
    await nextTick()
    await nextTick()

    await context.wrapper.get('.deck-key--mono-vinyl').trigger('click')
    await flushPromises()

    expect(context.wrapper.get('.drawer').attributes('hidden')).toBeDefined()
    expect(context.fake.calls.load).toHaveLength(1)
  })

  /*
   * 넓은 화면에서는 드로어가 플레이어를 가리지 않는다. 닫으면 편집 중인
   * 맥락을 괜히 잃는다.
   */
  it('넓은 화면에서는 재생해도 드로어가 닫히지 않는다 (M7-2)', async () => {
    installPlayerRect(VISIBLE_RECT)
    installMatchMedia(false)
    const context = await seedPlaying()

    await editorTrigger(context.wrapper).trigger('click')
    await nextTick()

    await context.wrapper.get('.track-play').trigger('click')
    await flushPromises()

    expect(context.wrapper.get('.drawer').attributes('hidden')).toBeUndefined()
    expect(context.fake.calls.load).toHaveLength(1)
  })

  it('시트를 닫으면 가림이 걷히고 안내가 지워진다 (M7-1)', async () => {
    installPlayerRect(VISIBLE_RECT)
    installMatchMedia(true)
    const context = await seedPlaying()

    context.wrapper.get('.playlist-play').trigger('click')
    await nextTick()
    context.fake.emitReady()
    context.fake.emitStateChange('playing')
    await nextTick()

    setRectOverride('#record-library-drawer', sheetRect(528))
    await context.wrapper.get('.playlist-tile .playlist-open').trigger('click')
    await nextTick()
    await nextTick()
    expect(context.playback.statusMessage).not.toBe('')

    await context.wrapper.get('.drawer .close').trigger('click')
    await nextTick()
    await nextTick()

    expect(context.playback.statusMessage).toBe('')
    // 걷혔다고 자동으로 재생하지는 않는다.
    expect(context.fake.calls.play).toBe(0)
  })

  it('데크를 눌러도 재생이 끊기지 않는다 — 선반만 펼친다 (M7)', async () => {
    installPlayerRect(VISIBLE_RECT)
    installMatchMedia(true)
    const context = await seedPlaying()

    context.wrapper.get('.playlist-play').trigger('click')
    await nextTick()
    context.fake.emitReady()
    context.fake.emitStateChange('playing')
    await nextTick()

    await deckTrigger(context.wrapper).trigger('click')
    await nextTick()

    expect(context.fake.calls.pause).toBe(0)
    expect(context.playback.playerState).toBe('playing')
    // 드로어는 열리지 않는다.
    expect(context.wrapper.get('.drawer').attributes('hidden')).toBeDefined()
  })

  /*
   * M7 에서 다시 쓴 테스트다.
   *
   * 좁은 화면의 드로어가 **아래 행**(별도 공간)에서 **하단 고정 시트**(겹침)로
   * 바뀌었다. 겹치게 되었으므로 "같은 셀에 없다" 로는 더 이상 보장할 수 없다.
   * 대신 **플레이어를 시트 위에 붙여** 보장한다.
   */
  /*
   * M7-1 에서 다시 쓴 테스트다.
   *
   * 한동안 `position: sticky` 로 플레이어를 시트 위에 붙여 겹침을 막았는데
   * 되돌렸다. 짧은 화면에서는 남는 띠가 플레이어보다 얇아 보장이 성립하지
   * 않는다. 사용자 지시도 "덮으면 그냥 일시정지" 다.
   *
   * 이제 보장은 **측정**이 진다. 레이아웃은 시트를 하단에 고정하기만 한다.
   */
  it('좁은 화면에서 시트가 화면을 가리고, 위젯을 숨기지 않는다', () => {
    const shell = readFileSync(
      resolve(process.cwd(), 'src/components/layout/DashboardShell.vue'),
      'utf8',
    )
    const compact = shell.slice(shell.indexOf('@media (max-width: 1100px)'))

    // 시트는 뷰포트 하단에 고정되고 높이에 상한이 있다.
    expect(compact).toContain('position: fixed')
    expect(compact).toContain('max-height: var(--size-sheet-height)')

    // 위젯을 숨기지 않는다. 보던 화면 위로 시트가 올라온다.
    expect(compact).not.toContain(":deep(.widget-host > *:not([data-widget='player']))")
    expect(compact).not.toMatch(/> :first-child \{\s*display: none/)

    // 플레이어를 피하게 하는 우회를 두지 않는다. 측정이 사실을 본다.
    expect(compact).not.toContain('position: sticky')

    // 시트에 영구히 묻히는 콘텐츠가 없어야 한다.
    expect(compact).toContain('padding-bottom: calc(var(--size-sheet-height) + 18px)')
  })

  /*
   * M7 에서 고친 **실기기 버그**다.
   *
   * 드로어만 `grid-area: 1 / 1` 을 가지면 자동 배치되는 스테이지가 찬 셀을
   * 피해 2 행으로 밀린다 — "드로어가 위쪽에 별도 공간으로 생긴다" 로 보고된
   * 증상이다. jsdom 은 그리드를 계산하지 않으므로 이 보장은 소스로 고정한다.
   */
  it('넓은 화면에서 스테이지와 드로어가 같은 셀을 쓴다', () => {
    const shell = readFileSync(
      resolve(process.cwd(), 'src/components/layout/DashboardShell.vue'),
      'utf8',
    )
    const wide = shell.slice(0, shell.indexOf('@media (max-width: 1100px)'))

    expect(wide).toMatch(
      /\.workspace\.is-drawer-open > :first-child,\s*\.workspace\.is-drawer-open > :last-child \{\s*grid-area: 1 \/ 1;/,
    )
  })

  it('넓은 화면에서는 드로어를 열어도 멈추지 않는다', async () => {
    installPlayerRect(VISIBLE_RECT)
    installMatchMedia(false)
    const context = await seedPlaying()

    context.wrapper.get('.playlist-play').trigger('click')
    await nextTick()
    context.fake.emitReady()
    context.fake.emitStateChange('playing')

    await editorTrigger(context.wrapper).trigger('click')

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

    await editorTrigger(context.wrapper).trigger('click')

    expect(context.fake.calls.pause).toBe(0)
  })

  /*
   * 두 번 뒤집힌 테스트다.
   *
   * M3-4 에는 드로어가 "닫고 ▶ 를 눌러주세요" 를 띄웠다. 좁은 화면에서 드로어가
   * 플레이어를 **대체**했기 때문이고, 그때는 플레이어의 `.status` 가 함께
   * 숨었으므로 누른 자리에 띄워야 했다.
   *
   * M6-5 에는 그 안내를 지웠다. 드로어가 플레이어를 가리지 않게 되어 조언이
   * 틀렸고, 플레이어의 `.status` 하나로 충분했다.
   *
   * M7-1 에는 **되살렸다.** 세로 시트가 플레이어를 덮을 수 있게 되면서
   * `.status` 도 함께 덮일 수 있다. 사용자가 보고 있는 곳에 있어야 읽힌다.
   * 문구는 세 표면이 공유한다 (`PLAY_REFUSED_HIDDEN_MESSAGE`).
   */
  it('가려진 상태에서 트랙 ▶ 를 누르면 누른 자리와 플레이어가 함께 알린다', async () => {
    installPlayerRect(HIDDEN_RECT)
    const context = await seedPlaying()

    await editorTrigger(context.wrapper).trigger('click')
    await context.wrapper.get('.track-play').trigger('click')

    // 플레이어 쪽 안내 — 시트에 덮이면 읽히지 않을 수 있다.
    expect(context.playback.statusMessage).toContain('화면에 보이지 않아')
    // 누른 자리의 안내 — 시트 안이므로 항상 읽힌다.
    expect(context.wrapper.get('.play-notice').text()).toContain('영상이 가려져')
    /*
     * "창을 닫으세요" 라고 말하지 않는다 (M7-2). 재생을 누르면 시트가 스스로
     * 비켜주므로 닫는 것은 사용자가 할 일이 아니고, 위젯·데크에서 눌렀을 때는
     * 닫을 창이 없을 수도 있다.
     */
    expect(context.wrapper.get('.play-notice').text()).not.toContain('창을 닫')
    expect(context.wrapper.get('.play-notice').text()).toContain('보이는 곳으로')
    expect(context.playback.queue).toEqual([])
    expect(context.fake.calls.load).toEqual([])
  })

  it('가려진 상태에서 타일 ▶ 는 위젯에서 알린다', async () => {
    installPlayerRect(HIDDEN_RECT)
    const context = await seedPlaying()

    await context.wrapper.get('.playlist-play').trigger('click')

    expect(context.wrapper.get('.widget-notice').text()).toContain('영상이 가려져')
    expect(context.playback.currentTrack).toBeNull()
  })

  it('세 표면이 같은 문구를 쓴다', async () => {
    installPlayerRect(HIDDEN_RECT)
    const context = await seedPlaying()

    await context.wrapper.get('.playlist-play').trigger('click')
    const widgetNotice = context.wrapper.get('.widget-notice').text()

    await editorTrigger(context.wrapper).trigger('click')
    await context.wrapper.get('.track-play').trigger('click')
    const drawerNotice = context.wrapper.get('.play-notice').text()

    await context.wrapper.get('.deck-key--kawaii-play').trigger('click')
    const deckNotice = context.wrapper.get('.deck-notice').text()

    // 같은 사정을 서로 다른 세 문제로 읽지 않게 한다.
    expect(drawerNotice).toBe(widgetNotice)
    expect(deckNotice).toBe(widgetNotice)
  })

  it('영역이 보이면 안내가 뜨지 않고 재생이 시작된다', async () => {
    installPlayerRect(VISIBLE_RECT)
    const context = await seedPlaying()

    await editorTrigger(context.wrapper).trigger('click')
    await context.wrapper.get('.track-play').trigger('click')

    expect(context.wrapper.find('.play-notice').exists()).toBe(false)
    expect(context.fake.calls.load).toHaveLength(1)
  })

  it('안내가 떴다가 영역이 돌아오면 사라진다', async () => {
    installPlayerRect(HIDDEN_RECT)
    const context = await seedPlaying()

    await editorTrigger(context.wrapper).trigger('click')
    await context.wrapper.get('.track-play').trigger('click')
    expect(context.wrapper.get('.status').text()).toContain('화면에 보이지 않아')
    expect(context.wrapper.find('.play-notice').exists()).toBe(true)

    setPlayerRect(VISIBLE_RECT)
    await context.wrapper.get('.track-play').trigger('click')

    expect(context.wrapper.get('.status').text()).toBe('')
    // 누른 자리의 안내도 성공과 함께 지워진다.
    expect(context.wrapper.find('.play-notice').exists()).toBe(false)
  })

  it('드로어를 빠르게 여닫아도 어댑터와 iframe 호스트가 그대로다', async () => {
    installPlayerRect(VISIBLE_RECT)
    installMatchMedia(true)
    const context = await seedPlaying()

    const host = context.fake.hostNode
    const mount0 = context.wrapper.get('.player-mount').element

    for (let round = 0; round < 3; round += 1) {
      await editorTrigger(context.wrapper).trigger('click')
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
      await editorTrigger(context.wrapper).trigger('click')
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
