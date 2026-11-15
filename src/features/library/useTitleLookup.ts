/**
 * 링크 추가 양식의 "제목 미리 채우기" (M11-4 후속, D5 · ADR 0029).
 *
 * 지키는 것
 * 1. **사용자가 쓴 제목을 덮지 않는다.** 제목 칸에 한 글자라도 쓰거나 지웠으면 조회하지 않고, 조회 중이었으면
 *    결과를 버린다.
 * 2. **저장된 제목은 건드리지 않는다.** 양식의 칸만 채운다 — 저장은 사용자가 "추가" 를 눌러야 한다.
 * 3. **곡 추가를 막지 않는다.** 제출은 같은 조회를 최대 4초까지 마치고 실패해도 추가한다. 양식이 바뀐 응답은 버린다.
 * 4. **사용자가 링크를 넣었을 때만** 요청한다 — 화면을 열기만 해서는 나가지 않는다 (ADR 0008 의 정신).
 *    입력이 멈추고 400ms 뒤 한 번. 같은 영상은 이 탭에서 한 번만 묻는다.
 */
import { computed, onScopeDispose, ref, watch, type ComputedRef, type Ref } from 'vue'

import { parseYouTubeVideoId } from '@/shared/utils/youtube'

import { fetchYouTubeTitle, type TitleLookupFailure } from './youtubeTitle'

export const TITLE_LOOKUP_DEBOUNCE_MS = 400

export type TitleLookupStatus = 'idle' | 'loading' | 'filled' | 'failed'

const FAILED: Readonly<Record<TitleLookupFailure, string>> = {
  'not-found': 'YouTube 에서 이 영상의 제목을 찾지 못했어요.',
  unavailable: '비공개이거나 제한된 영상이라 제목을 받을 수 없어요.',
  network: '제목을 가져오지 못했어요 (연결 문제).',
  timeout: '제목을 가져오는 데 너무 오래 걸려 그만두었어요.',
  invalid: '제목을 가져오지 못했어요.',
}

/** 이 탭에서 이미 받은 제목 — 같은 링크를 다시 넣어도 다시 묻지 않는다. 저장하지 않는다. */
const cache = new Map<string, string>()

export interface TitleLookup {
  status: Readonly<Ref<TitleLookupStatus>>
  /** 제목 칸 아래 한 줄. 비어 있으면 그리지 않는다. */
  message: ComputedRef<string>
  /** 제목 칸에 사용자가 입력했다 — 이후로 이 양식에서는 채우지 않는다. */
  markEdited(): void
  /** 양식을 비우거나 닫았다 — 처음 상태로. 진행 중인 조회는 버린다. */
  reset(): void
  /** 빠른 제출은 debounce를 건너뛰고 진행 중 조회를 최대 4초까지 마친다. 실패해도 제출할 수 있다. */
  prepareSubmit(): Promise<void>
}

export function useTitleLookup(url: Ref<string>, title: Ref<string>): TitleLookup {
  const status = ref<TitleLookupStatus>('idle')
  const failure = ref<TitleLookupFailure | null>(null)
  const edited = ref(false)
  /** 이 양식에서 우리가 채운 제목. 사용자가 고치지 않았으면 링크가 바뀔 때 거둔다 — 앞 영상의 제목이 남지 않게. */
  let autoFilled: string | null = null
  let timer: ReturnType<typeof setTimeout> | null = null
  let controller: AbortController | null = null
  /** 조회마다 올린다. 돌아온 결과의 번호가 지금과 다르면 버린다. */
  let generation = 0
  let inFlight: Promise<void> | null = null

  function cancel(): void {
    if (timer !== null) clearTimeout(timer)
    timer = null
    controller?.abort()
    controller = null
    generation += 1
    inFlight = null
  }

  function canFill(): boolean {
    return !edited.value && title.value.trim() === ''
  }

  async function lookup(videoId: string, mine: number): Promise<void> {
    const cached = cache.get(videoId)
    if (cached !== undefined) {
      if (mine !== generation || !canFill()) return
      fill(cached)
      return
    }
    status.value = 'loading'
    controller = new AbortController()
    const result = await fetchYouTubeTitle(videoId, { signal: controller.signal })
    // 그새 링크가 바뀌었거나, 사용자가 제목을 썼거나, 양식이 비워졌다 — 버린다.
    if (mine !== generation) return
    controller = null
    if (!canFill()) {
      status.value = 'idle'
      return
    }
    if (result.ok) {
      cache.set(videoId, result.title)
      fill(result.title)
    } else {
      failure.value = result.reason
      status.value = 'failed'
    }
  }

  function fill(text: string): void {
    title.value = text
    autoFilled = text
    status.value = 'filled'
  }

  watch(url, (now) => {
    cancel()
    status.value = 'idle'
    failure.value = null
    if (!edited.value && autoFilled !== null && title.value === autoFilled) title.value = ''
    autoFilled = null
    if (!canFill()) return
    const parsed = parseYouTubeVideoId(now)
    if (!parsed.ok) return
    const mine = generation
    timer = setTimeout(() => {
      timer = null
      inFlight = lookup(parsed.videoId, mine)
    }, TITLE_LOOKUP_DEBOUNCE_MS)
  })

  function markEdited(): void {
    edited.value = true
    cancel()
    status.value = 'idle'
  }

  async function prepareSubmit(): Promise<void> {
    if (!canFill() || status.value === 'failed') return
    const parsed = parseYouTubeVideoId(url.value)
    if (!parsed.ok) return
    if (timer !== null) clearTimeout(timer)
    timer = null
    inFlight ??= lookup(parsed.videoId, generation)
    await inFlight
  }

  function reset(): void {
    cancel()
    edited.value = false
    autoFilled = null
    status.value = 'idle'
    failure.value = null
  }

  onScopeDispose(cancel)

  const message = computed<string>(() => {
    if (status.value === 'loading') return 'YouTube 에서 제목을 찾는 중…'
    if (status.value === 'filled') return 'YouTube 에서 가져온 제목이에요. 고쳐도 돼요.'
    if (status.value === 'failed' && failure.value !== null) {
      return `${FAILED[failure.value]} 직접 쓰거나, 비워 두면 영상 ID 로 저장돼요.`
    }
    return ''
  })

  return { status, message, markEdited, reset, prepareSubmit }
}
