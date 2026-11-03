/**
 * WMO 날씨 코드 → 아이콘·설명.
 *
 * Open-Meteo 가 `weather_code` 로 WMO 4677 코드를 준다
 * (`docs/decisions/0013-weather-provider.md`).
 *
 * 아이콘은 **글리프 하나**다. 승인된 디자인의 `.wxicon` 이 27px·weight 300
 * 으로 글자를 그리는 자리이고, 예시 값도 `☁` 였다. 이미지 세트를 들이지
 * 않는다 (`AGENTS.md` 규칙 8).
 *
 * 코드 2(`조금 흐림`)의 아이콘·문구는 승인된 디자인의 예시와 **같다.**
 */

export interface WeatherLook {
  /** 한 글자 글리프. 장식이므로 `aria-hidden` 으로 감싼다. */
  icon: string
  /** 사람이 읽는 설명. */
  description: string
}

/** 코드 묶음 → 표시. 위에서부터 찾는다. */
const LOOKS: readonly { codes: readonly number[]; look: WeatherLook }[] = [
  { codes: [0], look: { icon: '☀', description: '맑음' } },
  { codes: [1], look: { icon: '☀', description: '대체로 맑음' } },
  // 승인된 디자인의 예시값과 같다.
  { codes: [2], look: { icon: '☁', description: '조금 흐림' } },
  { codes: [3], look: { icon: '☁', description: '흐림' } },
  { codes: [45, 48], look: { icon: '≡', description: '안개' } },
  { codes: [51, 53, 55], look: { icon: '☂', description: '가랑비' } },
  { codes: [56, 57], look: { icon: '☂', description: '얼어붙는 가랑비' } },
  { codes: [61, 63, 65], look: { icon: '☂', description: '비' } },
  { codes: [66, 67], look: { icon: '☂', description: '얼어붙는 비' } },
  { codes: [71, 73, 75], look: { icon: '❄', description: '눈' } },
  { codes: [77], look: { icon: '❄', description: '눈날림' } },
  { codes: [80, 81, 82], look: { icon: '☂', description: '소나기' } },
  { codes: [85, 86], look: { icon: '❄', description: '소낙눈' } },
  { codes: [95], look: { icon: '⚡', description: '뇌우' } },
  { codes: [96, 99], look: { icon: '⚡', description: '우박 뇌우' } },
]

/**
 * 표에 없는 코드에 쓸 표시.
 *
 * 추측해서 `맑음` 같은 값을 보여주지 않는다. 기온은 **실제 값**이므로
 * 그대로 보여주고, 상태만 모른다고 말한다.
 */
export const UNKNOWN_WEATHER_LOOK: WeatherLook = { icon: '·', description: '날씨 상태 미확인' }

export function weatherLook(code: number): WeatherLook {
  for (const entry of LOOKS) {
    if (entry.codes.includes(code)) return entry.look
  }

  return UNKNOWN_WEATHER_LOOK
}
