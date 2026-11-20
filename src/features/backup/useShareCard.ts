/**
 * 공유 카드 이미지 — 미리보기 · 복사 · 저장 (ADR 0041).
 *
 * 링크와 같은 내용(곡 이름은 늘 넣은 판)으로 카드를 **미리** 그려 둔다 — 누르는 순간 그리면 사용자 조작이 만료돼 복사가
 * 막힐 수 있다. 대상 · 선택 · 테마가 바뀌면 다시 그린다. 서버로 보내지 않고 저장하지 않는다 — 이 브라우저에서 그려
 * 복사하거나 내려받을 뿐이다.
 *
 * 공유 대화상자는 닫아도 남아 있어서 대상이 바뀌면 지난 카드가 잠깐 보인다. 그동안은 복사 · 저장을 끈다 — 다른 대상의
 * 카드를 붙여 넣지 않게. 보이는 정보(틀 · 크기 · 파일 이름)는 늘 **그려진** 카드의 것이다.
 *
 * 사용자가 올린 앨범아트를 넣는다 (ADR 0042) — 대상의 트랙들 가운데 앞에서부터 처음 만나는 사용자 그림. "앨범아트 넣기" 를
 * 끄면 39page 기본 그림이다. 그림 바이트는 이 브라우저의 IndexedDB 에서 읽어 캔버스에 그릴 뿐 어디에도 보내지 않는다.
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

import type { TrackKey } from '@/shared/types/artwork'
import { useArtworkStore } from '@/stores/artwork'
import { useThemeStore } from '@/stores/theme'

import { downloadBytes } from './downloadBackup'
import {
  buildShareCard,
  SHARE_CARD_RENDERER,
  shareCardFileName,
  type ShareCardArt,
  type ShareCardImage,
  type ShareCardModel,
} from './shareCard'
import type { ShareLinkContent } from './shareLink'
import type { ShareLinkTarget } from './useShareLink'

export type ShareCardState = 'idle' | 'rendering' | 'ready' | 'unsupported' | 'failed'

/** 그려진 카드 — 무엇을(model) 그렸는지와 그 결과(image). */
export interface RenderedShareCard {
  readonly model: ShareCardModel
  readonly image: ShareCardImage
}

export interface ShareCardView {
  /** 지금 대상 · 선택 · 테마로 그릴 카드. */
  readonly model: ComputedRef<ShareCardModel | null>
  /** 대상에 사용자 앨범아트가 있는가 — "앨범아트 넣기" 를 보일지. */
  readonly hasArt: ComputedRef<boolean>
  /** "앨범아트 넣기" — 처음에는 켜져 있다. */
  readonly includeArt: Ref<boolean>
  /** 마지막으로 그려진 카드. 다시 그리는 동안(`rendering`)은 지난 카드다. */
  readonly rendered: Readonly<Ref<RenderedShareCard | null>>
  readonly previewUrl: Readonly<Ref<string | null>>
  readonly state: Readonly<Ref<ShareCardState>>
  readonly notice: Readonly<Ref<string>>
  readonly failed: Readonly<Ref<boolean>>
  copyImage(): Promise<void>
  saveImage(): Promise<void>
}

/** 앨범아트를 찾을 때 보는 목록의 모양 — store 의 읽기 전용 목록도 받는다. */
interface ArtSearchList {
  readonly id: string
  readonly tracks: readonly { readonly id: string; readonly videoId: string }[]
}

/** 다시 그리기를 잠깐 미룬다 — 선택을 연달아 바꿀 때 한 번만 그리게. */
const RENDER_DELAY_MS = 120

/**
 * 카드의 앨범아트를 찾아볼 트랙들 — 앞에서부터 처음 만나는 사용자 그림을 쓴다.
 *
 * - 목록: 그 목록의 곡 순서
 * - 곡: 그 곡
 * - Moment: 같은 영상의 트랙들 — `lists` 순서(공유 화면이 곡 이름을 찾는 순서: 고른 목록 먼저)
 */
export function shareCardArtKeys(
  target: ShareLinkTarget | null,
  lists: readonly (ArtSearchList | null | undefined)[],
): TrackKey[] {
  if (target === null) return []
  if (target.kind === 'track') return [{ playlistId: target.playlist.id, trackId: target.track.id }]
  if (target.kind === 'playlist') {
    return target.playlist.tracks.map((track) => ({
      playlistId: target.playlist.id,
      trackId: track.id,
    }))
  }
  const keys: TrackKey[] = []
  for (const list of lists) {
    if (list == null) continue
    for (const track of list.tracks) {
      if (track.videoId === target.moment.videoId) {
        keys.push({ playlistId: list.id, trackId: track.id })
      }
    }
  }
  return keys
}

export function useShareCard(
  content: Readonly<Ref<ShareLinkContent | null>>,
  artKeys: Readonly<Ref<readonly TrackKey[]>> = ref([]),
): ShareCardView {
  const renderer = inject(SHARE_CARD_RENDERER, null)
  const theme = useThemeStore()
  const artwork = useArtworkStore()

  const includeArt = ref(true)

  /** 넣을 수 있는 사용자 그림 — 앞에서부터 처음 만나는 것. 자산을 찾지 못하는 연결(사라진 그림)은 건너뛴다. */
  const availableArt = computed<ShareCardArt | null>(() => {
    for (const key of artKeys.value) {
      const preference = artwork.preferenceFor(key)
      if (preference.mode !== 'custom' || artwork.assetFor(preference.assetId) === null) continue
      return { assetId: preference.assetId, display: artwork.displayFor(key) }
    }
    return null
  })
  const hasArt = computed(() => availableArt.value !== null)

  const model = computed<ShareCardModel | null>(() =>
    content.value === null
      ? null
      : buildShareCard(
          content.value,
          theme.current === 'kawaii-synth-cassette' ? 'kawaii' : 'mono',
          new Date(),
          includeArt.value ? availableArt.value : null,
        ),
  )

  /** 그림 바이트 — 움직이는 GIF 는 첫 장면(포스터). 읽지 못하면 `null`(기본 그림으로 그린다). */
  async function artBlob(current: ShareCardModel): Promise<Blob | null> {
    if (current.art === null) return null
    const record = await artwork.loadBlob(current.art.assetId)
    return record === null ? null : (record.poster ?? record.blob)
  }

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
      const art = await artBlob(current)
      if (run !== generation) return
      const image = await renderer(current, art)
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

  return {
    model,
    hasArt,
    includeArt,
    rendered,
    previewUrl,
    state,
    notice,
    failed,
    copyImage,
    saveImage,
  }
}
