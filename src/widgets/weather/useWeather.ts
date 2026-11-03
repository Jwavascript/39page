/**
 * 날씨 상태 관리 (M4-2).
 *
 * 로딩 · 성공 · 오류 세 상태를 들고, 주기적으로 다시 가져온다.
 *
 * **Pinia store 를 만들지 않는다.** 위젯 하나만 쓰는 상태이고 다른 기능이
 * 읽지 않는다. 기능 간 공용 상태 경계가 아니므로 store 로 올리지 않는다
 * (`AGENTS.md` 규칙 2, `SYSTEM_DESIGN.md` §6).
 *
 * 요청 제한 두 겹 (`MVP_SPEC.md` F7):
 *   1. **모듈 캐시** — 최근 응답이 충분히 신선하면 요청하지 않는다.
 *      위젯이 다시 마운트되어도 즉시 다시 받지 않는다.
 *   2. **간격** — 성공 뒤 15분, 실패 뒤 2분에 다시 시도한다.
 */
import { onMounted, onUnmounted, readonly, ref, type Ref } from 'vue'

import { fetchWeather, type WeatherFailureReason, type WeatherReading } from './weatherApi'

/** 성공 뒤 다음 갱신까지. */
export const WEATHER_REFRESH_INTERVAL_MS = 15 * 60_000

/** 실패 뒤 다음 시도까지. 사용자가 누를 버튼이 없으므로 스스로 다시 시도한다. */
export const WEATHER_RETRY_INTERVAL_MS = 2 * 60_000

/** 이보다 신선한 캐시는 그대로 쓴다. */
export const WEATHER_CACHE_MAX_AGE_MS = 5 * 60_000

export type WeatherState =
  | { status: 'loading' }
  | { status: 'ready'; reading: WeatherReading }
  | { status: 'error'; reason: WeatherFailureReason }

interface CacheEntry {
  reading: WeatherReading
  fetchedAt: number
}

/**
 * 마지막 성공 응답. **모듈 싱글턴**이다.
 *
 * 위젯 인스턴스보다 수명이 길어야 요청 제한의 뜻이 산다.
 */
let cache: CacheEntry | null = null

/** 테스트가 캐시를 비울 수 있게 열어둔다. 앱 코드에서는 부르지 않는다. */
export function clearWeatherCache(): void {
  cache = null
}

export interface WeatherModel {
  state: Readonly<Ref<WeatherState>>
}

export function useWeather(): WeatherModel {
  const state = ref<WeatherState>({ status: 'loading' })

  /** 진행 중인 요청. 언마운트하면 취소한다. */
  let controller: AbortController | null = null
  let timer: ReturnType<typeof setTimeout> | null = null
  let stopped = false

  function schedule(delay: number): void {
    if (stopped) return
    if (timer !== null) clearTimeout(timer)
    timer = setTimeout(() => void load(), delay)
  }

  function useCache(entry: CacheEntry): void {
    state.value = { status: 'ready', reading: entry.reading }
    // 남은 신선도만큼만 기다린다. 캐시가 오래됐으면 금방 다시 받는다.
    schedule(Math.max(0, WEATHER_REFRESH_INTERVAL_MS - (Date.now() - entry.fetchedAt)))
  }

  async function load(): Promise<void> {
    if (stopped) return

    const fresh = cache !== null && Date.now() - cache.fetchedAt < WEATHER_CACHE_MAX_AGE_MS
    if (fresh && cache !== null) {
      useCache(cache)
      return
    }

    controller?.abort()
    const own = new AbortController()
    controller = own

    const result = await fetchWeather(own.signal)

    // 언마운트했거나 더 새 요청이 자리를 차지했으면 결과를 버린다.
    if (stopped || controller !== own) return
    controller = null

    if (result.ok) {
      cache = { reading: result.reading, fetchedAt: Date.now() }
      state.value = { status: 'ready', reading: result.reading }
      schedule(WEATHER_REFRESH_INTERVAL_MS)
      return
    }

    /*
     * 실패해도 **이전 값을 그대로 보여주지 않는다.** 오래된 기온을 지금
     * 날씨처럼 보여주면 사용자는 그것이 결측인지 알 수 없다.
     */
    state.value = { status: 'error', reason: result.reason }
    schedule(WEATHER_RETRY_INTERVAL_MS)
  }

  onMounted(() => {
    void load()
  })

  onUnmounted(() => {
    stopped = true
    if (timer !== null) clearTimeout(timer)
    timer = null
    controller?.abort()
    controller = null
  })

  return { state: readonly(state) as Readonly<Ref<WeatherState>> }
}
