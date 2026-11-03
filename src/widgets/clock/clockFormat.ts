/**
 * 시계 표시값 계산 — 순수 함수.
 *
 * `Asia/Seoul` 고정이다 (`MVP_SPEC.md` F6). 사용자 설정으로 노출하지
 * 않는다 — 승인된 디자인의 지역 라벨도 `SEOUL, KOREA` 로 고정이다.
 *
 * 형식은 승인된 디자인 `updateClock()` 과 같다. `Intl.DateTimeFormat` 의
 * `formatToParts` 를 쓰는 것까지 같다 — 직접 시간대를 계산하지 않는다.
 */

/** 하드코딩된 시간대. 사용자 설정 항목이 아니다. */
export const CLOCK_TIME_ZONE = 'Asia/Seoul'

/** 승인된 디자인의 지역 라벨. */
export const CLOCK_REGION_LABEL = 'SEOUL, KOREA'

export interface ClockReading {
  /** `HH:MM` — 12시간제, 시는 2자리로 채운다. 도트로 그릴 글자열이다. */
  time: string
  /** `AM` 또는 `PM`. 도트가 아니라 텍스트로 표시한다. */
  dayPeriod: string
  /** `MON  NOV  02  2026` — 요일·월 대문자, 공백 2칸 구분. */
  date: string
}

const FORMATTER = new Intl.DateTimeFormat('en-US', {
  timeZone: CLOCK_TIME_ZONE,
  weekday: 'short',
  month: 'short',
  day: '2-digit',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
})

type PartName = 'weekday' | 'month' | 'day' | 'year' | 'hour' | 'minute' | 'dayPeriod'

function parts(now: Date): Record<PartName, string> {
  const collected: Record<string, string> = {}
  for (const part of FORMATTER.formatToParts(now)) {
    if (part.type !== 'literal') collected[part.type] = part.value
  }

  return {
    weekday: collected.weekday ?? '',
    month: collected.month ?? '',
    day: collected.day ?? '',
    year: collected.year ?? '',
    hour: collected.hour ?? '',
    minute: collected.minute ?? '',
    dayPeriod: collected.dayPeriod ?? '',
  }
}

export function readClock(now: Date): ClockReading {
  const value = parts(now)

  return {
    time: `${value.hour.padStart(2, '0')}:${value.minute}`,
    dayPeriod: value.dayPeriod.toUpperCase(),
    date: [value.weekday.toUpperCase(), value.month.toUpperCase(), value.day, value.year].join(
      '  ',
    ),
  }
}

/**
 * 보조기기에 읽힐 이름.
 *
 * 레퍼런스는 `aria-label` 에 `01:15` 만 넣는다. 그대로 두면 오전·오후를 알
 * 수 없어 시각이 전달되지 않는다. 작성된 의도("현재 시각을 알린다")를 따라
 * 기간과 맥락을 더한다 (ADR 0004 와 같은 판단, `MVP_SPEC.md` F6).
 */
export function clockAriaLabel(reading: ClockReading): string {
  return `현재 시각 ${reading.dayPeriod} ${reading.time}`
}
