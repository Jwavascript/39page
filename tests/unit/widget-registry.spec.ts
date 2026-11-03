import { describe, expect, it } from 'vitest'

import { MVP_DASHBOARD_LAYOUT } from '@/app/layout'
import { WIDGET_TYPES, isWidgetType, type WidgetType } from '@/shared/types'
import {
  REGISTERED_WIDGET_TYPES,
  findWidgetDefinition,
  getWidgetDefinition,
  listWidgetDefinitions,
} from '@/widgets/registry'

describe('3. 등록된 위젯 조회', () => {
  it('초기 위젯 5종이 등록되어 있다', () => {
    expect([...REGISTERED_WIDGET_TYPES]).toEqual(['deck', 'clock', 'weather', 'player', 'mascot'])
  })

  it('모든 종류에 정의가 있다', () => {
    for (const type of WIDGET_TYPES) {
      const definition = getWidgetDefinition(type)
      expect(definition.type).toBe(type)
      expect(definition.title.length).toBeGreaterThan(0)
      expect(definition.component).toBeDefined()
      expect(definition.defaultArea.length).toBeGreaterThan(0)
    }
  })

  it('정의 목록이 선언 순서를 따른다', () => {
    expect(listWidgetDefinitions().map((definition) => definition.type)).toEqual([
      ...REGISTERED_WIDGET_TYPES,
    ])
  })

  it('MVP에서는 편집 메타데이터가 모두 false 다', () => {
    for (const definition of listWidgetDefinitions()) {
      expect(definition.movable).toBe(false)
      expect(definition.resizable).toBe(false)
      expect(definition.removable).toBe(false)
    }
  })

  it('player 만 persistent 다', () => {
    const persistent = listWidgetDefinitions()
      .filter((definition) => definition.persistent === true)
      .map((definition) => definition.type)
    expect(persistent).toEqual(['player'])
  })

  it('레지스트리가 테마를 참조하지 않는다', async () => {
    const { readFileSync } = await import('node:fs')
    // 주석에 테마를 설명하는 문장이 있으므로 코드만 남겨 검사한다.
    const code = readFileSync('src/widgets/registry.ts', 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '')

    // 테마 전환이 레지스트리를 다시 만들거나 컴포넌트를 바꾸지 않아야 한다.
    expect(code).not.toContain('useThemeStore')
    expect(code).not.toContain('ThemeKey')
    expect(code).not.toMatch(/resolve\s*\(/)
  })
})

describe('4. 알 수 없는 위젯 종류', () => {
  it.each([
    ['등록되지 않은 문자열', 'turntable'],
    ['빈 문자열', ''],
    ['숫자', 42],
    ['null', null],
    ['undefined', undefined],
    ['객체', { type: 'clock' }],
    ['프로토타입 속성', 'toString'],
  ])('%s 은 undefined 를 돌려주고 던지지 않는다', (_label, value) => {
    expect(() => findWidgetDefinition(value)).not.toThrow()
    expect(findWidgetDefinition(value)).toBeUndefined()
  })

  it('isWidgetType 이 알려진 종류만 통과시킨다', () => {
    for (const type of WIDGET_TYPES) expect(isWidgetType(type)).toBe(true)
    for (const value of ['turntable', '', 7, null, {}]) expect(isWidgetType(value)).toBe(false)
  })
})

describe('5. 레이아웃 인스턴스', () => {
  it('instanceId 가 모두 유일하다', () => {
    const ids = MVP_DASHBOARD_LAYOUT.items.map((item) => item.instanceId)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('모든 인스턴스가 등록된 종류를 가리킨다', () => {
    for (const item of MVP_DASHBOARD_LAYOUT.items) {
      expect(isWidgetType(item.widgetType)).toBe(true)
      expect(findWidgetDefinition(item.widgetType)).toBeDefined()
    }
  })

  it('5개 위젯이 각각 다른 영역에 배치된다', () => {
    const areas = MVP_DASHBOARD_LAYOUT.items.map((item) => item.area)
    expect(areas).toHaveLength(5)
    expect(new Set(areas).size).toBe(5)
  })

  it('승인된 프로토타입 배치를 따른다', () => {
    const byArea = Object.fromEntries(
      MVP_DASHBOARD_LAYOUT.items.map((item) => [item.area, item.widgetType]),
    )
    // 왼쪽: 데크 위, 마스코트 아래. 오른쪽: 시계 · 날씨 · 플레이어.
    expect(byArea).toEqual({
      deck: 'deck',
      mascot: 'mascot',
      clock: 'clock',
      weather: 'weather',
      player: 'player',
    })
  })

  it('고정 픽셀 좌표나 행·열 번호를 저장하지 않는다', () => {
    for (const item of MVP_DASHBOARD_LAYOUT.items) {
      // area 는 이름 기반이어야 한다. 실제 위치는 CSS 가 정한다.
      expect(Object.keys(item).sort()).toEqual(['area', 'instanceId', 'widgetType'])
      expect(item.area).not.toMatch(/\d/)
    }
  })

  it('레이아웃 버전을 선언한다', () => {
    expect(MVP_DASHBOARD_LAYOUT.version).toBe(1)
  })
})

describe('위젯 종류와 영역의 기본값 정합성', () => {
  it('각 정의의 defaultArea 가 레이아웃의 실제 배치와 같다', () => {
    for (const item of MVP_DASHBOARD_LAYOUT.items) {
      const definition = getWidgetDefinition(item.widgetType as WidgetType)
      expect(definition.defaultArea).toBe(item.area)
    }
  })
})
