/**
 * M4-1 — 도트 매트릭스 시계.
 *
 *   A. 글리프와 배치 — 승인된 디자인과 **문자 단위로** 비교한다
 *   B. 표시값 — `Asia/Seoul` 기준 형식
 *   C. 컴포넌트 — 타이머, 정리, 접근성
 *
 * 글리프와 기하 상수가 레퍼런스에서 한 글자라도 달라지면 A 가 실패한다
 * (데크 아트에 쓴 것과 같은 방식, `THEME_SYSTEM.md` §8.1).
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { nextTick } from 'vue'

import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  clockAriaLabel,
  CLOCK_REGION_LABEL,
  CLOCK_TIME_ZONE,
  readClock,
} from '@/widgets/clock/clockFormat'
import ClockWidget from '@/widgets/clock/ClockWidget.vue'
import DotClock from '@/widgets/clock/DotClock.vue'
import {
  DOT_GLYPHS,
  DOT_RADIUS,
  DOT_SPACING,
  GLYPH_GAP,
  layoutDotText,
  START_X,
  START_Y,
  VIEWBOX_HEIGHT,
} from '@/widgets/clock/dotGlyphs'

function readSource(relative: string): string {
  return readFileSync(resolve(process.cwd(), relative), 'utf8')
}

/** 레퍼런스 HTML 의 `glyphs` 객체를 꺼낸다. */
function referenceGlyphs(): Record<string, string[]> {
  const html = readSource('design/references/two-themes-v09.html')
  const match = /const glyphs=(\{.*?\});/s.exec(html)
  if (match === null) throw new Error('레퍼런스에서 glyphs 를 찾지 못했다')

  // 작은따옴표만 큰따옴표로 바꾸면 JSON 이다.
  // (`String.prototype.replaceAll` 은 이 tsconfig 의 lib 에 없다.)
  return JSON.parse(match[1]?.replace(/'/g, '"') ?? '{}') as Record<string, string[]>
}

describe('A. 글리프와 배치', () => {
  it('글리프가 승인된 디자인과 일치한다', () => {
    const reference = referenceGlyphs()

    expect(Object.keys(DOT_GLYPHS).sort()).toEqual(Object.keys(reference).sort())
    for (const [character, rows] of Object.entries(reference)) {
      expect(DOT_GLYPHS[character]).toEqual(rows)
    }
  })

  it('기하 상수가 승인된 디자인과 일치한다', () => {
    // drawClock(): r=3.1, 간격 9.3, 글자 간 13, x 시작 5, cy = 6 + row*9.3
    expect(DOT_RADIUS).toBe(3.1)
    expect(DOT_SPACING).toBe(9.3)
    expect(GLYPH_GAP).toBe(13)
    expect(START_X).toBe(5)
    expect(START_Y).toBe(6)
    expect(VIEWBOX_HEIGHT).toBe(68)
  })

  it('숫자는 5열 7행, 콜론은 1열 7행이다', () => {
    expect(layoutDotText('0').circles).toHaveLength(35)
    expect(layoutDotText(':').circles).toHaveLength(7)
  })

  it('꺼진 도트도 함께 그린다', () => {
    // 전광판 질감이다. 켜진 것만 그리면 빈 자리가 생긴다.
    const circles = layoutDotText('1').circles
    expect(circles).toHaveLength(35)
    expect(circles.filter((circle) => circle.on).length).toBeGreaterThan(0)
    expect(circles.filter((circle) => !circle.on).length).toBeGreaterThan(0)
  })

  it('첫 도트의 좌표가 승인된 값이다', () => {
    const first = layoutDotText('0').circles[0]

    expect(first?.cx).toBe('5.00')
    expect(first?.cy).toBe('6.00')
  })

  it('열과 행 간격이 9.3 이다', () => {
    const circles = layoutDotText('0').circles

    expect(circles[1]?.cx).toBe('14.30')
    expect(circles[0]?.cy).toBe('6.00')
    expect(circles[5]?.cy).toBe('15.30')
  })

  it('글자가 넘어가면 5열 + 13 만큼 전진한다', () => {
    const circles = layoutDotText('00').circles
    // 두 번째 글자의 첫 도트: 5 + 5*9.3 + 13 = 64.5
    expect(circles[35]?.cx).toBe('64.50')
  })

  it('viewBox 너비가 승인된 계산과 같다', () => {
    // HH:MM — 5+5+1+5+5 열. drawClock() 의 `x - 2`.
    expect(layoutDotText('01:15').width).toBeCloseTo(263.3, 5)
  })

  it('알 수 없는 글자는 도트 없이 자리만 차지한다', () => {
    const blank = layoutDotText('X')

    // 추측해서 그리면 엉뚱한 숫자가 보인다.
    expect(blank.circles).toEqual([])
    expect(blank.width).toBeCloseTo(START_X + 5 * DOT_SPACING + GLYPH_GAP - 2, 5)
  })

  it('빈 글자열은 도트가 없다', () => {
    expect(layoutDotText('').circles).toEqual([])
  })
})

describe('B. 표시값', () => {
  it('시간대가 Asia/Seoul 고정이다', () => {
    expect(CLOCK_TIME_ZONE).toBe('Asia/Seoul')
    expect(CLOCK_REGION_LABEL).toBe('SEOUL, KOREA')
  })

  it('UTC 를 서울 시각으로 옮긴다', () => {
    // 2026-11-04T01:15Z = 서울 10:15 AM
    const reading = readClock(new Date('2026-11-04T01:15:00Z'))

    expect(reading.time).toBe('10:15')
    expect(reading.dayPeriod).toBe('AM')
  })

  it('12시간제를 쓰고 시를 두 자리로 채운다', () => {
    // 서울 오전 1시 5분
    expect(readClock(new Date('2026-11-03T16:05:00Z')).time).toBe('01:05')
  })

  it('정오와 자정을 12 로 표시한다', () => {
    const noon = readClock(new Date('2026-11-04T03:00:00Z'))
    const midnight = readClock(new Date('2026-11-03T15:00:00Z'))

    expect(noon.time).toBe('12:00')
    expect(noon.dayPeriod).toBe('PM')
    expect(midnight.time).toBe('12:00')
    expect(midnight.dayPeriod).toBe('AM')
  })

  it('날짜가 대문자이고 공백 2칸으로 구분된다', () => {
    const reading = readClock(new Date('2026-11-04T01:15:00Z'))

    expect(reading.date).toBe('WED  NOV  04  2026')
  })

  it('날짜 경계를 서울 기준으로 넘긴다', () => {
    // 15:30Z = 서울 자정 30분 → 다음 날
    expect(readClock(new Date('2026-11-03T15:30:00Z')).date).toBe('WED  NOV  04  2026')
    expect(readClock(new Date('2026-11-03T14:30:00Z')).date).toBe('TUE  NOV  03  2026')
  })

  it('보조기기 이름에 기간과 시각이 모두 들어간다', () => {
    // 레퍼런스는 `01:15` 만 넣는다. 그대로면 오전·오후를 알 수 없다.
    const reading = readClock(new Date('2026-11-04T01:15:00Z'))

    expect(clockAriaLabel(reading)).toBe('현재 시각 AM 10:15')
  })
})

describe('C. 컴포넌트', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('지역 라벨과 기간을 보여준다', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-04T01:15:00Z'))

    const wrapper = mount(ClockWidget)

    expect(wrapper.get('.clock-line').text()).toContain('SEOUL, KOREA')
    expect(wrapper.get('.clock-period').text()).toBe('AM')
    expect(wrapper.get('.clock-date').text()).toBe('WED  NOV  04  2026')
  })

  it('SVG 가 role 과 이름을 갖고 도트는 읽히지 않는다', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-04T01:15:00Z'))

    const svg = mount(ClockWidget).get('svg')

    expect(svg.attributes('role')).toBe('img')
    expect(svg.attributes('aria-label')).toBe('현재 시각 AM 10:15')
    // role="img" 이므로 자식 원은 보조기기에 노출되지 않는다.
    expect(svg.findAll('circle').length).toBeGreaterThan(0)
  })

  it('15초마다 다시 읽는다', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-04T01:15:00Z'))
    const wrapper = mount(ClockWidget)

    vi.setSystemTime(new Date('2026-11-04T01:16:00Z'))
    vi.advanceTimersByTime(15_000)
    await nextTick()

    expect(wrapper.get('svg').attributes('aria-label')).toBe('현재 시각 AM 10:16')
  })

  it('15초가 되기 전에는 바뀌지 않는다', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-04T01:15:00Z'))
    const wrapper = mount(ClockWidget)

    vi.setSystemTime(new Date('2026-11-04T01:16:00Z'))
    vi.advanceTimersByTime(14_000)
    await nextTick()

    expect(wrapper.get('svg').attributes('aria-label')).toBe('현재 시각 AM 10:15')
  })

  it('언마운트하면 타이머를 정리한다', () => {
    vi.useFakeTimers()
    const wrapper = mount(ClockWidget)
    expect(vi.getTimerCount()).toBeGreaterThan(0)

    wrapper.unmount()

    expect(vi.getTimerCount()).toBe(0)
  })

  it('다시 마운트하면 타이머가 하나만 걸린다', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-04T01:15:00Z'))

    mount(ClockWidget).unmount()
    const second = mount(ClockWidget)

    expect(vi.getTimerCount()).toBe(1)

    vi.setSystemTime(new Date('2026-11-04T01:17:00Z'))
    vi.advanceTimersByTime(15_000)
    await nextTick()

    expect(second.get('svg').attributes('aria-label')).toBe('현재 시각 AM 10:17')
  })

  it('언마운트 뒤에는 visibilitychange 에 반응하지 않는다', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-04T01:15:00Z'))
    const wrapper = mount(ClockWidget)

    wrapper.unmount()

    // 리스너가 남아 있으면 사라진 컴포넌트의 ref 를 건드린다.
    expect(() => document.dispatchEvent(new Event('visibilitychange'))).not.toThrow()
  })

  it('탭이 돌아오면 즉시 다시 읽는다', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-04T01:15:00Z'))
    const wrapper = mount(ClockWidget)

    // 백그라운드 탭의 타이머는 분 단위까지 늦는다. 돌아오면 바로 맞춰야 한다.
    vi.setSystemTime(new Date('2026-11-04T02:40:00Z'))
    document.dispatchEvent(new Event('visibilitychange'))
    await nextTick()

    expect(wrapper.get('svg').attributes('aria-label')).toBe('현재 시각 AM 11:40')
  })

  it('색을 하드코딩하지 않는다', () => {
    for (const file of ['src/widgets/clock/ClockWidget.vue', 'src/widgets/clock/DotClock.vue']) {
      expect(readSource(file)).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
    }
  })

  it('store 를 읽지 않는다 — 재생·테마·라이브러리를 모른다', () => {
    const source = readSource('src/widgets/clock/ClockWidget.vue')

    expect(source).not.toContain('usePlaybackStore')
    expect(source).not.toContain('useThemeStore')
    expect(source).not.toContain('useLibraryStore')
  })

  it('도트 렌더러는 시간을 모른다', () => {
    const wrapper = mount(DotClock, { props: { text: '88', label: '테스트' } })

    expect(wrapper.findAll('circle')).toHaveLength(70)
    expect(readSource('src/widgets/clock/DotClock.vue')).not.toContain('Date')
  })
})
