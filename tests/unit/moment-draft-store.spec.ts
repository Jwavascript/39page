/**
 * Moment 초안 store — 저장 모델 B 의 공유 상태 (M11-7C, ADR 0030).
 *
 *   A  잡기 · 다시 잡기 · 버리기 — 저장하지 않는다
 *   B  저장 — 요청 id 로 한 번만, 저장 중 거절, 실패하면 초안을 지킨다
 *   C  저장 키 · 형식 — 초안은 저장소에 쓰지 않는다
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { STORAGE_KEYS } from '@/shared/storage'
import { createDraftRequestId, useMomentDraftStore } from '@/stores/momentDraft'
import { isCallerMomentId, MAX_MOMENT_NOTE_LENGTH, useMomentsStore } from '@/stores/moments'

const VIDEO = 'jNQXAC9IVRw'
const OTHER = 'dQw4w9WgXcQ'

function setup() {
  setActivePinia(createPinia())
  const moments = useMomentsStore()
  moments.restore()
  return { moments, draft: useMomentDraftStore() }
}

beforeEach(() => {
  globalThis.localStorage.clear()
})

afterEach(() => {
  globalThis.localStorage.clear()
  vi.restoreAllMocks()
})

describe('A. 잡기 · 다시 잡기 · 버리기', () => {
  it('요청 id 는 store 의 호출자 id 형식이고 확장의 id 와 앞머리로 갈린다', () => {
    const ids = new Set(Array.from({ length: 20 }, () => createDraftRequestId()))
    expect(ids.size).toBe(20)
    for (const id of ids) {
      expect(isCallerMomentId(id)).toBe(true)
      expect(id.startsWith('ext-web-')).toBe(true)
    }
  })

  it('잡기는 초안만 만든다 — Moments 와 저장소는 그대로다', () => {
    const { moments, draft } = setup()
    expect(draft.capture({ videoId: VIDEO, atSeconds: 12, title: 'T' })).toBe(true)

    expect(draft.draft).toMatchObject({ videoId: VIDEO, atSeconds: 12, title: 'T' })
    expect(moments.count).toBe(0)
    expect(globalThis.localStorage.getItem(STORAGE_KEYS.moments)).toBeNull()
  })

  it('다시 잡으면 시점과 요청 id 가 바뀌고 메모는 남는다', () => {
    const { draft } = setup()
    draft.capture({ videoId: VIDEO, atSeconds: 12, title: 'T' })
    const first = draft.draft?.requestId
    draft.note = '메모'
    draft.capture({ videoId: OTHER, atSeconds: 40, title: 'U' })

    expect(draft.draft).toMatchObject({ videoId: OTHER, atSeconds: 40 })
    expect(draft.draft?.requestId).not.toBe(first)
    expect(draft.note).toBe('메모')
  })

  it('버리면 초안과 메모가 사라지고 아무것도 저장하지 않는다', () => {
    const { moments, draft } = setup()
    draft.capture({ videoId: VIDEO, atSeconds: 12, title: 'T' })
    draft.note = '버림'
    draft.discard()

    expect(draft.draft).toBeNull()
    expect(draft.note).toBe('')
    expect(moments.count).toBe(0)
  })
})

describe('B. 저장', () => {
  it('저장하면 메모와 함께 한 번 더해지고 초안이 비워진다', async () => {
    const { moments, draft } = setup()
    draft.capture({ videoId: VIDEO, atSeconds: 12, title: 'T' })
    const requestId = draft.draft?.requestId
    draft.note = '좋다'

    const result = await draft.save()
    expect(result).toMatchObject({ ok: true, persisted: true, momentId: requestId })
    expect(moments.moments).toHaveLength(1)
    expect(moments.moments[0]).toMatchObject({ id: requestId, note: '좋다', atSeconds: 12 })
    expect(draft.draft).toBeNull()
    expect(draft.note).toBe('')
    expect(draft.lastSaved?.id).toBe(requestId)
  })

  it('저장 중에는 두 번째 저장 · 다시 잡기 · 버리기를 받지 않는다', async () => {
    const { moments, draft } = setup()
    draft.capture({ videoId: VIDEO, atSeconds: 12, title: 'T' })
    const add = vi.spyOn(moments, 'add')

    const first = draft.save()
    expect(draft.saving).toBe(true)
    expect(await draft.save()).toEqual({ ok: false, reason: 'saving' })
    expect(draft.capture({ videoId: VIDEO, atSeconds: 99, title: 'T' })).toBe(false)
    draft.discard()
    expect(draft.draft?.atSeconds).toBe(12)

    expect((await first).ok).toBe(true)
    expect(add).toHaveBeenCalledTimes(1)
    expect(moments.count).toBe(1)
  })

  it('같은 요청 id 를 다시 보내도 Moments 는 하나다 — store 의 호출자 id 계약', async () => {
    const { moments, draft } = setup()
    draft.capture({ videoId: VIDEO, atSeconds: 12, title: 'T' })
    const target = draft.draft
    if (target === null) throw new Error('no draft')
    await draft.save()

    // 같은 초안이 다른 경로로 한 번 더 왔다 (예: 응답을 받기 전에 다시 보냈다).
    const again = await moments.add({
      id: target.requestId,
      videoId: target.videoId,
      atSeconds: target.atSeconds,
    })
    expect(again).toMatchObject({ ok: true, existed: true })
    expect(moments.count).toBe(1)
  })

  it('충돌 · 잠금 대기로 거절되면 초안과 메모를 지키고, 다시 저장하면 같은 요청 id 로 한 번만', async () => {
    const { moments, draft } = setup()
    draft.capture({ videoId: VIDEO, atSeconds: 12, title: 'T' })
    draft.note = '지킬 메모'
    const requestId = draft.draft?.requestId
    const add = vi.spyOn(moments, 'add')
    add.mockResolvedValueOnce({ ok: false, reason: 'busy' })
    add.mockResolvedValueOnce({ ok: false, reason: 'conflict' })

    expect(await draft.save()).toEqual({ ok: false, reason: 'busy' })
    expect(await draft.save()).toEqual({ ok: false, reason: 'conflict' })
    expect(draft.draft?.requestId).toBe(requestId)
    expect(draft.note).toBe('지킬 메모')
    expect(draft.saving).toBe(false)

    expect((await draft.save()).ok).toBe(true)
    expect(add.mock.calls.map(([input]) => input.id)).toEqual([requestId, requestId, requestId])
    expect(moments.count).toBe(1)
  })

  it('메모가 500자를 넘으면 저장하지 않는다', async () => {
    const { moments, draft } = setup()
    draft.capture({ videoId: VIDEO, atSeconds: 12, title: 'T' })
    draft.note = '가'.repeat(MAX_MOMENT_NOTE_LENGTH + 1)

    expect(await draft.save()).toEqual({ ok: false, reason: 'too-long' })
    expect(moments.count).toBe(0)
    expect(draft.draft).not.toBeNull()
  })

  it('초안이 없으면 저장할 것이 없다', async () => {
    const { draft } = setup()
    expect(await draft.save()).toEqual({ ok: false, reason: 'no-draft' })
  })
})

describe('C. 저장 키 · 형식', () => {
  it('초안 store 는 저장소 · 저장 키를 쓰지 않는다 (화면 상태)', () => {
    const code = readFileSync(resolve(process.cwd(), 'src/stores/momentDraft.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '')
    for (const word of ['localStorage', 'STORAGE_KEYS', 'defineStorage', 'sessionStorage']) {
      expect({ word, found: code.includes(word) }).toEqual({ word, found: false })
    }
  })
})
