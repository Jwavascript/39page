/**
 * 공유 카드 이미지 — 미리보기 · 복사 · 저장 (ADR 0041).
 *
 * 링크와 같은 내용(곡 이름은 늘 넣은 판)으로 카드를 **미리** 그려 둔다 — 누르는 순간 그리면 사용자 조작이 만료돼 복사가
 * 막힐 수 있다. 대상 · 선택 · 테마가 바뀌면 다시 그린다. 서버로 보내지 않고 저장하지 않는다 — 이 브라우저에서 그려
 * 복사하거나 내려받을 뿐이다.
 *
 * 공유 대화상자는 닫아도 남아 있어서 대상이 바뀌면 지난 카드가 잠깐 보인다. 그동안은 복사 · 저장을 끈다 — 다른 대상의
 * 카드를 붙여 넣지 않게. 보이는 정보(틀 · 크기 · 파일 이름)는 늘 **그려진** 카드의 것이다.
 */
import {
  computed,
  inject,
  onScopeDispose,
  ref,
  shallowRef,
  watch,
  type ComputedRef,
  type Ref,
} from 'vue'

import { useThemeStore } from '@/stores/theme'

import { downloadBytes } from './downloadBackup'
import {
  buildShareCard,
  SHARE_CARD_RENDERER,
  shareCardFileName,
  type ShareCardImage,
  type ShareCardModel,
} from './shareCard'
import type { ShareLinkContent } from './shareLink'

export type ShareCardState = 'idle' | 'rendering' | 'ready' | 'unsupported' | 'failed'

/** 그려진 카드 — 무엇을(model) 그렸는지와 그 결과(image). */
export interface RenderedShareCard {
  readonly model: ShareCardModel
  readonly image: ShareCardImage
}

export interface ShareCardView {
  /** 지금 대상 · 선택 · 테마로 그릴 카드. */
  readonly model: ComputedRef<ShareCardModel | null>
  /** 마지막으로 그려진 카드. 다시 그리는 동안(`rendering`)은 지난 카드다. */
  readonly rendered: Readonly<Ref<RenderedShareCard | null>>
  readonly previewUrl: Readonly<Ref<string | null>>
  readonly state: Readonly<Ref<ShareCardState>>
  readonly notice: Readonly<Ref<string>>
  readonly failed: Readonly<Ref<boolean>>
  copyImage(): Promise<void>
  saveImage(): Promise<void>
}

/** 다시 그리기를 잠깐 미룬다 — 선택을 연달아 바꿀 때 한 번만 그리게. */
const RENDER_DELAY_MS = 120

export function useShareCard(content: Readonly<Ref<ShareLinkContent | null>>): ShareCardView {
  const renderer = inject(SHARE_CARD_RENDERER, null)
  const theme = useThemeStore()

  const model = computed<ShareCardModel | null>(() =>
    content.value === null
      ? null
      : buildShareCard(
          content.value,
          theme.current === 'kawaii-synth-cassette' ? 'kawaii' : 'mono',
          new Date(),
        ),
  )

  const rendered = shallowRef<RenderedShareCard | null>(null)
  const previewUrl = ref<string | null>(null)
  const state = ref<ShareCardState>(renderer === null ? 'unsupported' : 'idle')
  const notice = ref('')
  const failed = ref(false)

  let generation = 0
  let timer: ReturnType<typeof setTimeout> | null = null

  function setRendered(next: RenderedShareCard | null): void {
    if (previewUrl.value !== null) URL.revokeObjectURL(previewUrl.value)
    rendered.value = next
    previewUrl.value =
      next !== null && typeof URL.createObjectURL === 'function'
        ? URL.createObjectURL(next.image.blob)
        : null
  }

  async function render(): Promise<void> {
    const current = model.value
    const run = (generation += 1)
    if (renderer === null) return
    if (current === null) {
      setRendered(null)
      state.value = 'idle'
      return
    }
    state.value = 'rendering'
    try {
      const image = await renderer(current)
      if (run !== generation) return
      setRendered(image === null ? null : { model: current, image })
      state.value = image === null ? 'unsupported' : 'ready'
    } catch {
      if (run !== generation) return
      setRendered(null)
      state.value = 'failed'
    }
  }

  watch(
    model,
    (next) => {
      notice.value = ''
      failed.value = false
      if (renderer === null) return
      // 미루는 동안에도 지난 카드로 복사 · 저장하지 않게 바로 "그리는 중" 이다.
      state.value = next === null ? 'idle' : 'rendering'
      if (timer !== null) clearTimeout(timer)
      timer = setTimeout(() => {
        timer = null
        void render()
      }, RENDER_DELAY_MS)
    },
    { immediate: true },
  )

  onScopeDispose(() => {
    generation += 1
    if (timer !== null) clearTimeout(timer)
    if (previewUrl.value !== null) URL.revokeObjectURL(previewUrl.value)
  })

  /** 지금 대상의 카드가 다 그려졌을 때만 그 카드를 준다. */
  function readyCard(): RenderedShareCard | null {
    return state.value === 'ready' ? rendered.value : null
  }

  /** 클립보드에 이미지로 — 게시판 글쓰기 칸에 바로 붙여 넣는다. */
  async function copyImage(): Promise<void> {
    const current = readyCard()
    if (current === null) return
    try {
      if (typeof ClipboardItem !== 'function' || typeof navigator.clipboard?.write !== 'function') {
        throw new Error('no image clipboard')
      }
      // Safari 는 Blob 을 담은 Promise 를 받아야 사용자 조작 안에서 쓴다 — Chrome 도 받는다.
      await navigator.clipboard.write([
        new ClipboardItem({ 'image/png': Promise.resolve(current.image.blob) }),
      ])
      failed.value = false
      notice.value = '이미지를 복사했어요. 게시판 글쓰기 칸에 붙여 넣으세요.'
    } catch {
      failed.value = true
      notice.value = '이미지를 복사하지 못했어요 — "이미지 저장" 으로 받아 주세요.'
    }
  }

  /** PNG 파일로 내려받는다. 이름은 그려진 카드의 제목. */
  async function saveImage(): Promise<void> {
    const current = readyCard()
    if (current === null) return
    const bytes = new Uint8Array(await current.image.blob.arrayBuffer())
    const result = downloadBytes(bytes, shareCardFileName(current.model.heading), 'image/png')
    failed.value = !result.ok
    notice.value = result.ok ? `“${result.fileName}” 을 저장했어요.` : '이미지를 저장하지 못했어요.'
  }

  return { model, rendered, previewUrl, state, notice, failed, copyImage, saveImage }
}
