/**
 * M4-2 — 날씨 위젯 (Open-Meteo, ADR 0013).
 *
 *   A. 요청   — 주소와 고정 위치, 위치 권한을 쓰지 않음
 *   B. 파싱   — 응답을 믿지 않는다
 *   C. 표시   — WMO 코드 → 아이콘·설명
 *   D. 상태   — 로딩·성공·오류, 타이머와 캐시, 가짜 데이터 금지
 *
 * 네트워크에 나가지 않는다. 전역 `fetch` 는 `tests/setup/noNetwork.ts` 가
 * 막아두고, 여기서 필요한 응답만 세운다.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  parseWeatherPayload,
  WEATHER_ENDPOINT,
  WEATHER_LOCATION,
  WEATHER_PROVIDER_LABEL,
  weatherRequestUrl,
} from '@/widgets/weather/weatherApi'
import { UNKNOWN_WEATHER_LOOK, weatherLook } from '@/widgets/weather/weatherCodes'
import {
  clearWeatherCache,
  WEATHER_CACHE_MAX_AGE_MS,
  WEATHER_REFRESH_INTERVAL_MS,
  WEATHER_RETRY_INTERVAL_MS,
} from '@/widgets/weather/useWeather'
import WeatherWidget from '@/widgets/weather/WeatherWidget.vue'

function readSource(relative: string): string {
  return readFileSync(resolve(process.cwd(), relative), 'utf8')
}

/** Open-Meteo 의 실제 응답 모양. 2026-11-04 서울 응답을 줄인 것이다. */
function payload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    timezone: 'Asia/Seoul',
    current: { time: '2026-11-04T01:15', temperature_2m: 8.3, weather_code: 2 },
    daily: {
      time: ['2026-11-04'],
      temperature_2m_max: [17.2],
      temperature_2m_min: [7.5],
    },
    ...overrides,
  }
}

function okResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
  } as unknown as Response
}

beforeEach(() => {
  clearWeatherCache()
})

afterEach(() => {
  vi.useRealTimers()
  clearWeatherCache()
})

describe('A. 요청', () => {
  it('위치가 서울로 고정돼 있다', () => {
    expect(WEATHER_LOCATION.label).toBe('SEOUL')
    expect(WEATHER_LOCATION.latitude).toBeCloseTo(37.5665, 4)
    expect(WEATHER_LOCATION.longitude).toBeCloseTo(126.978, 3)
    expect(WEATHER_LOCATION.timeZone).toBe('Asia/Seoul')
  })

  it('주소에 좌표·필드·시간대가 들어간다', () => {
    const url = new URL(weatherRequestUrl())

    expect(`${url.origin}${url.pathname}`).toBe(WEATHER_ENDPOINT)
    expect(url.searchParams.get('latitude')).toBe('37.5665')
    expect(url.searchParams.get('current')).toBe('temperature_2m,weather_code')
    expect(url.searchParams.get('daily')).toBe('temperature_2m_max,temperature_2m_min')
    expect(url.searchParams.get('timezone')).toBe('Asia/Seoul')
  })

  it('API 키를 보내지 않는다', () => {
    // 키가 필요 없는 제공자를 고른 이유다 (ADR 0013). 키를 만들지 않는다.
    const url = weatherRequestUrl()

    expect(url).not.toMatch(/key|token|appid|apikey/i)
  })

  it('브라우저 위치 권한을 요청하지 않는다', () => {
    // 사용자의 현재 위치를 추정해 확정된 위치처럼 보여주지 않는다.
    for (const file of [
      'src/widgets/weather/weatherApi.ts',
      'src/widgets/weather/useWeather.ts',
      'src/widgets/weather/WeatherWidget.vue',
    ]) {
      expect(readSource(file)).not.toContain('geolocation')
    }
  })

  it('자격 증명을 보내지 않는다', () => {
    const fetchStub = vi.fn<typeof fetch>(() => Promise.resolve(okResponse(payload())))
    vi.stubGlobal('fetch', fetchStub)

    mount(WeatherWidget)

    expect(fetchStub).toHaveBeenCalledTimes(1)
    const init = fetchStub.mock.calls[0]?.[1]
    expect(init?.credentials).toBe('omit')
  })
})

describe('B. 파싱 — 응답을 믿지 않는다', () => {
  it('정상 응답을 읽고 반올림한다', () => {
    expect(parseWeatherPayload(payload())).toEqual({
      ok: true,
      reading: { temperature: 8, code: 2, high: 17, low: 8 },
    })
  })

  it.each([
    ['null', null],
    ['빈 객체', {}],
    ['current 없음', payload({ current: undefined })],
    ['daily 없음', payload({ daily: undefined })],
    ['기온이 문자열', payload({ current: { temperature_2m: '8.3', weather_code: 2 } })],
    ['코드 없음', payload({ current: { temperature_2m: 8.3 } })],
    ['최고가 빈 배열', payload({ daily: { temperature_2m_max: [], temperature_2m_min: [7.5] } })],
    ['최저가 null', payload({ daily: { temperature_2m_max: [17.2], temperature_2m_min: [null] } })],
    [
      '최고가 배열이 아님',
      payload({ daily: { temperature_2m_max: 17.2, temperature_2m_min: [7.5] } }),
    ],
    ['NaN', payload({ current: { temperature_2m: Number.NaN, weather_code: 2 } })],
    [
      'Infinity',
      payload({ current: { temperature_2m: Number.POSITIVE_INFINITY, weather_code: 2 } }),
    ],
  ])('%s 는 malformed 로 돌려준다', (_label, value) => {
    expect(parseWeatherPayload(value)).toEqual({ ok: false, reason: 'malformed' })
  })

  it('하나라도 모자라면 부분적으로 채우지 않는다', () => {
    // 최고·최저가 없는데 기온만 보여주면 결측인지 알 수 없다.
    const result = parseWeatherPayload(payload({ daily: { time: ['2026-11-04'] } }))

    expect(result.ok).toBe(false)
  })
})

describe('C. 코드 → 표시', () => {
  it('코드 2 는 승인된 디자인의 예시와 같다', () => {
    // 프로토타입 값: ☁ · 조금 흐림
    expect(weatherLook(2)).toEqual({ icon: '☁', description: '조금 흐림' })
  })

  it.each([
    [0, '맑음'],
    [1, '대체로 맑음'],
    [3, '흐림'],
    [45, '안개'],
    [48, '안개'],
    [51, '가랑비'],
    [61, '비'],
    [65, '비'],
    [71, '눈'],
    [80, '소나기'],
    [95, '뇌우'],
    [99, '우박 뇌우'],
  ])('코드 %i → %s', (code, description) => {
    expect(weatherLook(code).description).toBe(description)
  })

  it('알 수 없는 코드는 추측하지 않는다', () => {
    // 모르는 코드에 `맑음` 을 붙이면 가짜 정보가 된다.
    expect(weatherLook(7777)).toEqual(UNKNOWN_WEATHER_LOOK)
    expect(UNKNOWN_WEATHER_LOOK.description).toContain('미확인')
  })

  it('아이콘이 한 글자다', () => {
    for (const code of [0, 1, 2, 3, 45, 51, 61, 71, 80, 95, 7777]) {
      expect([...weatherLook(code).icon]).toHaveLength(1)
    }
  })
})

describe('D. 상태', () => {
  it('불러오는 중에는 기온 자리에 숫자를 쓰지 않는다', () => {
    // 응답을 주지 않는 fetch
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(() => new Promise<Response>(() => {})),
    )

    const wrapper = mount(WeatherWidget)

    expect(wrapper.get('.weather').attributes('data-status')).toBe('loading')
    expect(wrapper.get('.temp').text()).toBe('--°')
    expect(wrapper.get('.desc').text()).toContain('불러오는 중')
    expect(wrapper.get('.highlow').text()).toBe('')
  })

  it('성공하면 실제 값을 보여준다', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(() => Promise.resolve(okResponse(payload()))),
    )

    const wrapper = mount(WeatherWidget)
    await flushPromises()

    expect(wrapper.get('.weather').attributes('data-status')).toBe('ready')
    expect(wrapper.get('.wxicon').text()).toBe('☁')
    expect(wrapper.get('.temp').text()).toBe('8°')
    expect(wrapper.get('.desc').text()).toBe('조금 흐림')
    expect(wrapper.get('.highlow').text()).toBe('H 17° / L 8°')
  })

  it('아이콘은 보조기기에 읽히지 않는다', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(() => Promise.resolve(okResponse(payload()))),
    )

    const wrapper = mount(WeatherWidget)
    await flushPromises()

    expect(wrapper.get('.wxicon').attributes('aria-hidden')).toBe('true')
  })

  it('위치와 출처를 적는다', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(() => Promise.resolve(okResponse(payload()))),
    )

    const wrapper = mount(WeatherWidget)
    await flushPromises()

    const note = wrapper.get('.weather-note').text()
    expect(note).toContain(WEATHER_LOCATION.label)
    expect(note).toContain(WEATHER_PROVIDER_LABEL)
    // 프로토타입의 "실제 API 연결 전" 문구가 남아 있으면 안 된다.
    expect(note).not.toContain('디자인 예시')
  })

  it('네트워크 실패를 가짜 숫자로 덮지 않는다', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(() => Promise.reject(new Error('offline'))),
    )

    const wrapper = mount(WeatherWidget)
    await flushPromises()

    expect(wrapper.get('.weather').attributes('data-status')).toBe('error')
    expect(wrapper.get('.temp').text()).toBe('--°')
    expect(wrapper.get('.desc').text()).toContain('불러오지 못했어요')
    expect(wrapper.get('.highlow').text()).toBe('')
    expect(wrapper.get('.weather-note').text()).toContain('다시 시도')
  })

  it('2xx 가 아닌 응답을 구분해 알린다', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(() =>
        Promise.resolve({ ok: false, status: 503, json: () => Promise.resolve({}) } as Response),
      ),
    )

    const wrapper = mount(WeatherWidget)
    await flushPromises()

    expect(wrapper.get('.desc').text()).toContain('응답하지 않아요')
  })

  it('형식이 깨진 응답을 데이터 없음으로 알린다', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(() => Promise.resolve(okResponse({ current: {} }))),
    )

    const wrapper = mount(WeatherWidget)
    await flushPromises()

    expect(wrapper.get('.desc').text()).toContain('날씨 정보가 없어요')
  })

  it('성공하면 이전 값을 유지하지 않고 실패 시 비운다', async () => {
    vi.useFakeTimers()
    let fail = false
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(() =>
        fail ? Promise.reject(new Error('offline')) : Promise.resolve(okResponse(payload())),
      ),
    )

    const wrapper = mount(WeatherWidget)
    await flushPromises()
    expect(wrapper.get('.temp').text()).toBe('8°')

    // 캐시가 만료된 뒤 실패한다.
    fail = true
    vi.advanceTimersByTime(WEATHER_REFRESH_INTERVAL_MS)
    await flushPromises()

    // 오래된 기온을 지금 날씨처럼 보여주지 않는다.
    expect(wrapper.get('.weather').attributes('data-status')).toBe('error')
    expect(wrapper.get('.temp').text()).toBe('--°')
  })

  it('성공 뒤 15분에 다시 받는다', async () => {
    vi.useFakeTimers()
    const fetchStub = vi.fn<typeof fetch>(() => Promise.resolve(okResponse(payload())))
    vi.stubGlobal('fetch', fetchStub)

    mount(WeatherWidget)
    await flushPromises()
    expect(fetchStub).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(WEATHER_REFRESH_INTERVAL_MS - 1)
    await flushPromises()
    expect(fetchStub).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(1)
    await flushPromises()
    expect(fetchStub).toHaveBeenCalledTimes(2)
  })

  it('실패 뒤에는 2분에 다시 시도한다', async () => {
    vi.useFakeTimers()
    const fetchStub = vi.fn<typeof fetch>(() => Promise.reject(new Error('offline')))
    vi.stubGlobal('fetch', fetchStub)

    mount(WeatherWidget)
    await flushPromises()
    expect(fetchStub).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(WEATHER_RETRY_INTERVAL_MS)
    await flushPromises()

    // 사용자가 누를 버튼이 없으므로 스스로 다시 시도해야 한다.
    expect(fetchStub).toHaveBeenCalledTimes(2)
  })

  it('실패 재시도 간격이 성공 갱신보다 짧다', () => {
    expect(WEATHER_RETRY_INTERVAL_MS).toBeLessThan(WEATHER_REFRESH_INTERVAL_MS)
  })

  it('캐시가 신선하면 다시 마운트해도 요청하지 않는다', async () => {
    vi.useFakeTimers()
    const fetchStub = vi.fn<typeof fetch>(() => Promise.resolve(okResponse(payload())))
    vi.stubGlobal('fetch', fetchStub)

    const first = mount(WeatherWidget)
    await flushPromises()
    first.unmount()

    const second = mount(WeatherWidget)
    await flushPromises()

    expect(fetchStub).toHaveBeenCalledTimes(1)
    expect(second.get('.temp').text()).toBe('8°')
  })

  it('캐시가 오래되면 다시 받는다', async () => {
    vi.useFakeTimers()
    const fetchStub = vi.fn<typeof fetch>(() => Promise.resolve(okResponse(payload())))
    vi.stubGlobal('fetch', fetchStub)

    mount(WeatherWidget).unmount()
    await flushPromises()

    vi.advanceTimersByTime(WEATHER_CACHE_MAX_AGE_MS + 1)
    mount(WeatherWidget)
    await flushPromises()

    expect(fetchStub).toHaveBeenCalledTimes(2)
  })

  it('언마운트하면 타이머를 정리하고 요청을 취소한다', async () => {
    vi.useFakeTimers()
    const abort = vi.fn<() => void>()
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>((_input, init) => {
        init?.signal?.addEventListener('abort', abort)
        return new Promise<Response>(() => {})
      }),
    )

    const wrapper = mount(WeatherWidget)
    wrapper.unmount()

    expect(abort).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('언마운트 뒤에는 상태를 더 바꾸지 않는다', async () => {
    vi.useFakeTimers()
    const fetchStub = vi.fn<typeof fetch>(() => Promise.resolve(okResponse(payload())))
    vi.stubGlobal('fetch', fetchStub)

    const wrapper = mount(WeatherWidget)
    wrapper.unmount()
    await flushPromises()

    vi.advanceTimersByTime(WEATHER_REFRESH_INTERVAL_MS * 3)
    await flushPromises()

    // 언마운트 뒤에 타이머가 살아 있으면 요청이 계속 나간다.
    expect(fetchStub).toHaveBeenCalledTimes(1)
  })

  it('색을 하드코딩하지 않는다', () => {
    expect(readSource('src/widgets/weather/WeatherWidget.vue')).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
  })

  it('store 를 읽지 않는다', () => {
    const source = readSource('src/widgets/weather/WeatherWidget.vue')

    expect(source).not.toContain('usePlaybackStore')
    expect(source).not.toContain('useLibraryStore')
    expect(source).not.toContain('useThemeStore')
  })
})
