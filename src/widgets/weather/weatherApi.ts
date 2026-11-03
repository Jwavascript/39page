/**
 * 날씨 데이터 가져오기 (M4-2).
 *
 * 제공자는 **Open-Meteo** 다. API 키가 없고 CORS 가 열려 있다. 선택 근거는
 * `docs/decisions/0013-weather-provider.md`.
 *
 * 위치는 **서울 고정**이다. 브라우저 위치 권한을 요청하지 않고, 사용자의
 * 현재 위치를 추정하지도 않는다 (`MVP_SPEC.md` F7). 승인된 디자인의 시계도
 * `SEOUL, KOREA` 고정이다.
 *
 * **응답을 믿지 않는다.** 숫자가 아니거나 빠진 값이 있으면 실패로 돌려주고,
 * 화면은 오류 상태를 보여준다. 가짜 날씨를 정상 결과처럼 보여주지 않는다.
 */

export const WEATHER_ENDPOINT = 'https://api.open-meteo.com/v1/forecast'

/** 고정 위치. 사용자 설정 항목이 아니다. */
export const WEATHER_LOCATION = {
  label: 'SEOUL',
  latitude: 37.5665,
  longitude: 126.978,
  timeZone: 'Asia/Seoul',
} as const

/** 화면에 적는 제공자 이름. 출처를 밝히기 위한 것이다. */
export const WEATHER_PROVIDER_LABEL = 'OPEN-METEO'

export interface WeatherReading {
  /** 현재 기온 (°C). 표시용으로 반올림한 정수다. */
  temperature: number
  /** WMO 날씨 코드. */
  code: number
  /** 오늘 최고 기온 (°C, 정수). */
  high: number
  /** 오늘 최저 기온 (°C, 정수). */
  low: number
}

export type WeatherFailureReason =
  /** 요청 자체가 실패했다 (오프라인, DNS, CORS 등) */
  | 'network'
  /** 응답이 왔지만 2xx 가 아니다 */
  | 'http'
  /** 2xx 인데 기대한 숫자가 없다 */
  | 'malformed'

export type WeatherResult =
  { ok: true; reading: WeatherReading } | { ok: false; reason: WeatherFailureReason }

/** 요청 주소. 테스트가 그대로 비교할 수 있게 함수로 둔다. */
export function weatherRequestUrl(): string {
  const query = new URLSearchParams({
    latitude: String(WEATHER_LOCATION.latitude),
    longitude: String(WEATHER_LOCATION.longitude),
    current: 'temperature_2m,weather_code',
    daily: 'temperature_2m_max,temperature_2m_min',
    timezone: WEATHER_LOCATION.timeZone,
    forecast_days: '1',
  })

  return `${WEATHER_ENDPOINT}?${query.toString()}`
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/** 배열의 첫 값이 유한한 숫자인지. */
function firstFinite(value: unknown): number | null {
  return Array.isArray(value) ? finiteNumber(value[0]) : null
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null
}

/**
 * 응답 본문을 읽기.
 *
 * 하나라도 모자라면 `malformed` 다. 부분적으로 채워 보여주지 않는다 —
 * 최고·최저가 없는데 기온만 보여주면 사용자는 그것이 결측인지 알 수 없다.
 */
export function parseWeatherPayload(payload: unknown): WeatherResult {
  const root = record(payload)
  const current = record(root?.current)
  const daily = record(root?.daily)

  const temperature = finiteNumber(current?.temperature_2m)
  const code = finiteNumber(current?.weather_code)
  const high = firstFinite(daily?.temperature_2m_max)
  const low = firstFinite(daily?.temperature_2m_min)

  if (temperature === null || code === null || high === null || low === null) {
    return { ok: false, reason: 'malformed' }
  }

  return {
    ok: true,
    reading: {
      temperature: Math.round(temperature),
      code,
      high: Math.round(high),
      low: Math.round(low),
    },
  }
}

/**
 * 한 번 가져온다. **던지지 않는다.**
 *
 * 취소(`AbortError`)도 `network` 로 돌려주지만, 호출부가 취소한 경우에는
 * 결과를 쓰지 않으므로 화면에 오류가 뜨지 않는다.
 */
export async function fetchWeather(signal?: AbortSignal): Promise<WeatherResult> {
  try {
    const response = await fetch(weatherRequestUrl(), {
      signal,
      // 권한·쿠키가 필요 없는 공개 API 다. 자격 증명을 보내지 않는다.
      credentials: 'omit',
      headers: { accept: 'application/json' },
    })

    if (!response.ok) return { ok: false, reason: 'http' }

    return parseWeatherPayload(await response.json())
  } catch {
    return { ok: false, reason: 'network' }
  }
}
