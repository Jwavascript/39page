import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import SaveFeedback from '@/panel/components/SaveFeedback.vue'
import type { SaveState } from '@/panel/useSaveRequest'
import BrandHeader from '@/popup/components/BrandHeader.vue'

describe('Cassette 확장 표현', () => {
  it('카세트 에셋은 스크립트나 foreignObject가 없는 유효한 SVG다', () => {
    const source = readFileSync(resolve('src/ui/cassette.svg'), 'utf8')
    const doc = new DOMParser().parseFromString(source, 'image/svg+xml')
    expect(doc.querySelector('parsererror, script, foreignObject')).toBeNull()
    expect(doc.documentElement.localName).toBe('svg')
    expect(doc.querySelector('rect, path, circle')).not.toBeNull()
  })
  it('팝업과 패널은 첫 페인트부터 웹앱 Cassette 토큰을 사용한다', () => {
    for (const entry of ['popup', 'panel']) {
      const read = (file: string) => readFileSync(resolve('src', entry, file), 'utf8')
      expect(read('index.html')).toContain('data-theme="kawaii-synth-cassette"')
      expect(read('main.ts')).toContain("import '@web/themes/kawaii-synth-cassette/tokens.css'")
      expect(read('main.ts')).not.toContain('mono-vinyl')
    }
  })

  it('공통 브랜드는 이름을 유지하고 카세트 장식을 별도로 읽지 않는다', () => {
    const wrapper = mount(BrandHeader)
    expect(wrapper.get('h1').text()).toBe('39page')
    expect(wrapper.get('.cassette-mark').attributes('alt')).toBe('')
    expect(wrapper.findAll('button, [tabindex]')).toHaveLength(0)
    expect(wrapper.find('.disc').exists()).toBe(false)
  })

  it.each<[SaveState, string, string]>([
    [{ phase: 'saving' }, 'status', '저장 확인 중'],
    [{ phase: 'checking' }, 'status', '저장 확인 중'],
    [{ phase: 'done', data: {} }, 'status', '저장 완료'],
    [{ phase: 'uncertain', reason: 'timeout' }, 'alert', '저장 여부를 확인해 주세요'],
    [
      { phase: 'partial', playlistId: 'new', playlistName: '새 목록' },
      'alert',
      '일부만 저장됐어요',
    ],
    [{ phase: 'unavailable', reason: 'permission' }, 'alert', '바로 저장을 사용할 수 없어요'],
    [
      { phase: 'error', error: { code: 'not-persisted', retryable: true } },
      'alert',
      '저장하지 못했어요',
    ],
    [{ phase: 'not-saved' }, 'alert', '저장하지 못했어요'],
  ])('%j는 색 이외에도 상태 제목과 알림 역할로 구별한다', (state, role, label) => {
    const wrapper = mount(SaveFeedback, { props: { state, success: '실제로 저장한 결과' } })
    expect(wrapper.get('.feedback').attributes('role')).toBe(role)
    expect(wrapper.get('.feedback-heading').text()).toContain(label)
    expect(wrapper.find('.feedback.ok').exists()).toBe(state.phase === 'done')
    expect(wrapper.text().includes('실제로 저장한 결과')).toBe(state.phase === 'done')
    const buttons = wrapper.findAll('button').map((button) => button.text())
    expect(buttons.includes('저장됐는지 확인')).toBe(state.phase === 'uncertain')
    expect(buttons.includes('다시 시도')).toBe(state.phase === 'uncertain')
  })
})
