<script setup lang="ts">
/**
 * 대시보드 전체 화면 구조.
 *
 * 책임: 셸 여백 · 최대 폭, 헤더 통합, 워크스페이스 영역, **통합 보관함과 데이터 대화상자의 자리**.
 * 위젯을 직접 알지 않는다 — 레이아웃을 받아 `WidgetHost` 에 넘길 뿐이다.
 *
 * 테마를 참조하지 않는다. 외형은 CSS 토큰이 결정하므로 두 테마가 **같은** 셸 인스턴스를 공유한다
 * (`docs/decisions/0001-theme-switching-mechanism.md`).
 *
 * ## M11-2 — 통합 보관함 (ADR 0027 C안)
 *
 * M2 ~ M10 의 오른쪽 드로어(한 플레이리스트 편집)가 **보관함**(음악 · Moments 두 탭)이 됐다. 헤더의
 * 이름 있는 입구는 M11-7B 부터 둘이다 — 보관함 · 데이터 · 백업 (ADR 0030, `AppNav`).
 *
 * **보관함은 플레이어를 가리지 않는다 — 레이아웃이 그것을 보장한다.** 가시성 측정은 다른 요소에
 * 덮인 것을 감지하지 못하므로(`playerVisibility.ts`), 덮을 수 있는 배치를 만들지 않는다.
 *
 * ## M11-7B — 작은 영상 띠 (ADR 0030 · 보관함 배치 C)
 *
 * 보관함이 열리면 워크스페이스 위쪽에 **재생 띠**(영상 · 지금 곡 · 재생 조작 · "이 순간 저장")가 남고
 * 나머지를 보관함이 쓴다. M11-2 의 "나란히"([플레이어 | 보관함] 두 열)는 재생 조작만 남고 Moment 를
 * 잡을 수 없었고, 보관함의 폭이 화면의 절반이었다.
 *
 * | 배치          | 조건                             | 재생 띠와 보관함                                                    |
 * | ------------- | -------------------------------- | ------------------------------------------------------------------- |
 * | 띠 (strip)    | 넓은 화면                        | 위: [영상 \| 지금 곡 · 조작 \| 이 순간 저장], 아래: 보관함 전체 폭. 겹침 없음 |
 * | 쌓기 (stack)  | 세로 화면 · 폭 900px 이하        | 영상 → 한 줄 조작 → 한 줄 저장을 화면 위에 두고, 보관함 시트는 **그 아래**에서 시작 |
 * | 옆 (side)     | 낮은 가로 화면 (높이 560px 이하) | 왼쪽: 영상 → 조작 → 저장, 보관함은 **영상 오른쪽**에서 화면 높이 전체 |
 *
 * 세 배치 모두 **CSS 로만** 다른 위젯을 접는다(`display: none`, 마운트 유지). 플레이어의 DOM 부모 ·
 * 순서 · 인스턴스는 바뀌지 않는다 (ADR 0002) — 영상은 숨기지도 덮지도 않고, 200×200 아래로 줄이지도
 * 않는다 (띠의 영상은 384px 이상 × 16:9). 띠 안의 재생 조작과 "이 순간 저장" 은 **대시보드의 그것과
 * 같은 컴포넌트 인스턴스**다 — 새로 만든 사본이 아니라 같은 위젯이 다른 모양으로 놓인다.
 *
 * 워크스페이스의 `data-archive-layout` 이 지금 배치를 말한다. 플레이어 · Moments 위젯은 그 속성을 보고
 * 자기 안쪽을 작게 배치한다 (각 컴포넌트의 비스코프 스타일) — 셸은 위젯 안쪽 클래스를 모른다.
 *
 * 띠 배치에서는 페이지 스크롤을 잠그지 않는다 (헤더로 돌아갈 수 있어야 한다). 대신 보관함의 높이를
 * **화면 안에서 끝나게** 맞추고(`--archive-height`), 스크롤은 보관함의 칸 안에서만 한다 — 칸들은
 * `overscroll-behavior: contain` 이라 끝까지 내려도 페이지로 넘어가지 않는다.
 *
 * M7 에서 "플레이어를 sticky 로 시트 위에 붙이기" 를 시도했다가 되돌린 적이 있다 (짧은 화면에서 남는
 * 띠가 플레이어보다 얇았다). 쌓기 배치는 sticky 를 쓰지 않는다: 영상을 화면 위로 스크롤한 뒤 재생 띠의
 * **실제 아래 끝**(`getBoundingClientRect`)에 시트를 맞추고, 열려 있는 동안 페이지 스크롤을 잠근다.
 */
import {
  computed,
  defineAsyncComponent,
  inject,
  nextTick,
  onBeforeUnmount,
  onMounted,
  provide,
  readonly,
  ref,
} from 'vue'

import AppFooter from '@/components/layout/AppFooter.vue'
import AppHeader from '@/components/layout/AppHeader.vue'
import AppNav from '@/components/layout/AppNav.vue'
import WidgetHost from '@/components/layout/WidgetHost.vue'
import { useHeaderCollapse } from '@/components/layout/useHeaderCollapse'
import ArchivePanel from '@/features/archive/ArchivePanel.vue'
import {
  ARCHIVE,
  type ArchiveController,
  type ArchiveOpenOptions,
  type ArchiveTab,
} from '@/features/archive/archiveController'
import DataDialog from '@/features/backup/DataDialog.vue'
import ShareDialog from '@/features/backup/ShareDialog.vue'
import { isShareHash, parseShareLink, type ShareLinkParse } from '@/features/backup/shareLink'

/**
 * 링크로 받은 공유의 미리보기 (ADR 0040) — 공유 링크로 들어왔을 때만 쓰므로 따로 내려받는다. 보통 방문에서는 첫
 * 화면 묶음을 키우지 않는다.
 */
const ShareLinkDialog = defineAsyncComponent(() => import('@/features/backup/ShareLinkDialog.vue'))
import { PLAYBACK_COORDINATOR } from '@/features/playback/playbackCoordinator'
import type { DashboardLayout } from '@/shared/types'
import { SHARE_DIALOG, type ShareRequest, type ShareTarget } from '@/shared/types/share'

defineProps<{
  brand: string
  layout: DashboardLayout
}>()

/* ------------------------------------------------------------------ *
 * 통합 보관함
 * ------------------------------------------------------------------ */

const ARCHIVE_ID = 'archive-panel'
const isArchiveOpen = ref(false)
const archivePanel = ref<InstanceType<typeof ArchivePanel> | null>(null)
const archiveTab = ref<ArchiveTab>('music')

/**
 * 보관함의 배치. 열 때 · 창 크기 · 방향이 바뀔 때 다시 정한다.
 *
 * - `strip` — 넓은 화면: 위에 재생 띠, 아래에 보관함 (M11-7B · 배치 C).
 * - `stack` — 세로 화면: 재생 띠(영상 → 조작 → 저장)를 화면 위로 올리고, 시트가 그 **아래**에서 시작한다.
 * - `side`  — 낮은 가로 화면(폰 가로): 재생 띠를 왼쪽에 두고, 보관함이 영상 **오른쪽**에서 화면 높이
 *   전체를 쓴다. 위아래로 나누면 영상(200px)을 두고 보관함에 남는 높이가 없다 (예: 844×390).
 */
type ArchiveLayout = 'strip' | 'stack' | 'side'
const layoutMode = ref<ArchiveLayout>('strip')
const isStacked = computed<boolean>(() => layoutMode.value === 'stack')
/** 쌓기 배치에서 시트의 위쪽 끝 (뷰포트 기준 px). 재생 띠의 실제 아래 끝 + 여백. */
const sheetTop = ref<number | null>(null)
/** 옆 배치에서 보관함의 왼쪽 끝 (뷰포트 기준 px). 영상의 실제 오른쪽 끝 + 여백. */
const sheetLeft = ref<number | null>(null)
/** 띠 배치에서 보관함의 높이 (px). 화면 안에서 끝나게 맞춘 값. */
const archiveHeight = ref<number | null>(null)

const workspace = ref<HTMLElement | null>(null)
const shell = ref<HTMLElement | null>(null)
const header = useHeaderCollapse(shell, () => {
  if (isArchiveOpen.value) {
    if (layoutMode.value === 'strip') fitStrip(false)
    else measureSheet()
  }
  reportObstruction()
})

/** 닫을 때 포커스를 되돌릴 버튼. */
let archiveTrigger: HTMLElement | null = null

/**
 * 재생 쪽에 가림 높이를 알리는 통로 (M7-1). **계약 파일만** 가져온다. 주입되지 않으면 알리지 않는다
 * — 셸을 단독으로 마운트하는 시험을 위한 기본값이다.
 */
const playback = inject(PLAYBACK_COORDINATOR, null)

/**
 * 쌓기 배치의 조건. 세로 화면이고 폭이 900px 이하 — 폰 세로 · 태블릿 세로. 가로 화면은 높이가 낮아
 * 영상 아래에 시트를 둘 자리가 없으므로(예: 740×360) 나란히 배치를 쓴다.
 */
const STACK_QUERY = '(max-width: 900px) and (orientation: portrait)'
/** 옆 배치의 조건 — 가로이고 높이가 낮다 (폰 가로). 영상 위 제목 줄까지 한 화면에 담을 수 없다. */
const SIDE_QUERY = '(max-height: 560px) and (orientation: landscape)'
/** 영상과 시트 사이 · 화면 위와 영상 사이의 여백. */
const SHEET_GAP_PX = 8
/**
 * 띠 배치에서 보관함의 높이 한계. 아래 값보다 자리가 모자라면 워크스페이스를 화면 위로 올려 자리를
 * 번다(헤더가 화면 위로 나간다 — 페이지를 올리면 돌아온다). 그래도 모자라면 최소 높이를 쓰고 페이지가
 * 조금 스크롤된다.
 */
const ARCHIVE_COMFORT_HEIGHT_PX = 420
const ARCHIVE_MIN_HEIGHT_PX = 300
const ARCHIVE_MAX_HEIGHT_PX = 900

function matches(query: string): boolean {
  // jsdom 에는 matchMedia 가 없다. 없으면 나란히 배치로 본다.
  return typeof window.matchMedia === 'function' && window.matchMedia(query).matches
}

/** 영상 상자. 쌓기 배치에서 시트를 이 아래 끝에 맞춘다 (CSS 부모가 아니라 실제 상자를 잰다). */
function videoHolder(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-widget="player"] .video-holder')
}

/** 재생 띠에서 보관함 바로 위에 오는 위젯 — Moments(저장 줄)가 보이면 그것, 아니면 플레이어. */
function stripBottom(): number | null {
  let bottom: number | null = null
  for (const name of ['player', 'moments']) {
    const el = document.querySelector<HTMLElement>(`[data-widget="${name}"]`)
    if (el === null) continue
    const box = el.getBoundingClientRect()
    // `display: none` 인 위젯은 상자가 없다.
    if (box.width === 0 && box.height === 0) continue
    bottom = bottom === null ? box.bottom : Math.max(bottom, box.bottom)
  }
  return bottom
}

function lockPageScroll(locked: boolean): void {
  document.documentElement.style.overflow = locked ? 'hidden' : ''
}

/** 시트가 뷰포트 아래를 덮은 높이를 알린다. 쌓기 배치가 아니면 덮는 것이 없다. */
function reportObstruction(): void {
  if (playback === null) return
  const covered =
    isArchiveOpen.value && isStacked.value && sheetTop.value !== null
      ? Math.max(0, window.innerHeight - sheetTop.value)
      : 0
  playback.setBottomObstruction(covered)
}

/** 띠 배치에서 우리가 페이지를 스크롤하기 전의 위치. 닫을 때 되돌린다. 스크롤하지 않았으면 `null`. */
let scrollBeforeStrip: number | null = null

/**
 * 띠 배치 — 보관함이 **화면 안에서 끝나게** 높이를 맞춘다.
 *
 * `mayScroll` 이면, 자리가 모자랄 때 워크스페이스 위 끝을 화면 위에 맞춰 자리를 번다 (여는 순간 한
 * 번). 재생 띠의 높이가 바뀌어 다시 맞출 때(`mayScroll: false`)는 페이지를 움직이지 않는다 — 메모를
 * 쓰는 중에 화면이 튀지 않게.
 */
function fitStrip(mayScroll: boolean): void {
  const area = workspace.value
  const panel = document.getElementById(ARCHIVE_ID)
  if (area === null || panel === null) return

  const padding = Number.parseFloat(getComputedStyle(area).paddingBottom) || 0
  const room = (): number =>
    window.innerHeight - panel.getBoundingClientRect().top - padding - SHEET_GAP_PX

  // jsdom 에는 스크롤이 없다 — 있을 때만 옮긴다.
  if (
    mayScroll &&
    room() < ARCHIVE_COMFORT_HEIGHT_PX &&
    typeof area.scrollIntoView === 'function'
  ) {
    const top = area.getBoundingClientRect().top
    if (top > SHEET_GAP_PX) {
      if (scrollBeforeStrip === null) scrollBeforeStrip = window.scrollY
      window.scrollBy(0, top - SHEET_GAP_PX)
    }
  }

  archiveHeight.value = Math.round(
    Math.min(ARCHIVE_MAX_HEIGHT_PX, Math.max(ARCHIVE_MIN_HEIGHT_PX, room())),
  )
}

/** 쌓기 · 옆 배치 — 시트를 재생 띠의 실제 끝에 맞춘다. 페이지를 움직이지 않는다. */
function measureSheet(): void {
  if (layoutMode.value === 'stack') {
    const bottom = stripBottom()
    sheetTop.value = bottom === null ? null : Math.ceil(bottom + SHEET_GAP_PX)
  } else if (layoutMode.value === 'side') {
    const holder = videoHolder()
    sheetLeft.value =
      holder === null ? null : Math.ceil(holder.getBoundingClientRect().right + SHEET_GAP_PX)
  }
}

/**
 * 보관함의 배치를 정한다. 그려진 **뒤에** 불러야 한다 — 같은 틱에 재면 아직 이전 배치를 읽는다.
 */
async function placeArchive(): Promise<void> {
  if (!isArchiveOpen.value) return
  layoutMode.value = matches(STACK_QUERY) ? 'stack' : matches(SIDE_QUERY) ? 'side' : 'strip'
  sheetTop.value = null
  sheetLeft.value = null
  await nextTick()

  if (layoutMode.value === 'strip') {
    lockPageScroll(false)
    fitStrip(true)
    reportObstruction()
    return
  }

  archiveHeight.value = null
  const holder = videoHolder()
  if (holder !== null) {
    // 영상의 위 끝이 화면 위에서 여백만큼 아래에 오게 한다. 잠그기 전에 옮긴다.
    // (jsdom 에는 스크롤이 없다 — 있을 때만 옮기고, 시트 위치는 어느 쪽이든 실제 상자로 잰다.)
    lockPageScroll(false)
    if (typeof holder.scrollIntoView === 'function') {
      holder.scrollIntoView({ block: 'start' })
      window.scrollBy(0, -SHEET_GAP_PX)
    }
    measureSheet()
  }
  lockPageScroll(true)
  reportObstruction()
}

/**
 * 재생 띠의 높이가 바뀌면(메모 양식이 열림 · 상태 안내가 뜸) 보관함을 다시 맞춘다. 페이지는 움직이지
 * 않는다. jsdom 에는 `ResizeObserver` 가 없다 — 있을 때만 건다.
 */
let stripObserver: ResizeObserver | null = null
function watchStrip(): void {
  if (typeof ResizeObserver !== 'function' || stripObserver !== null) return
  const host = workspace.value?.querySelector<HTMLElement>('.widget-host') ?? null
  if (host === null) return
  stripObserver = new ResizeObserver(() => {
    if (!isArchiveOpen.value) return
    if (layoutMode.value === 'strip') fitStrip(false)
    else measureSheet()
    reportObstruction()
  })
  stripObserver.observe(host)
}

function unwatchStrip(): void {
  stripObserver?.disconnect()
  stripObserver = null
}

/** "링크 추가로 바로" 요청 — 숫자가 바뀔 때마다 보관함이 한 번 링크 입력을 연다. */
const addLinkRequest = ref(0)
/** "이 영상의 Moments 만" · "음악 탭의 그 곡" 요청 (M11-4). `seq` 가 바뀔 때마다 한 번 적용된다. */
const momentsFocusRequest = ref<{ videoId?: string; view?: 'all'; seq: number } | null>(null)
const revealRequest = ref<{ videoId: string; seq: number } | null>(null)
/** "그 곡의 앨범아트 설정" 요청 (M12-3) — `seq` 가 바뀔 때마다 한 번. */
const artworkRequest = ref<{ playlistId: string; trackId: string; seq: number } | null>(null)
/** "고른 목록의 상세로" 요청 (M11-7B) — 숫자가 바뀔 때마다 음악 탭이 상세 단계가 된다. */
const detailRequest = ref(0)
let requestSeq = 0

async function openArchive(tab?: ArchiveTab, options: ArchiveOpenOptions = {}): Promise<void> {
  if (isArchiveOpen.value && (await archivePanel.value?.allowLeave()) === false) return
  archivePanel.value?.resetNavigation()
  if (tab !== undefined) archiveTab.value = tab
  if (options.addLink === true) {
    archiveTab.value = 'music'
    addLinkRequest.value += 1
  }
  if (options.videoId !== undefined) {
    archiveTab.value = 'moments'
    requestSeq += 1
    momentsFocusRequest.value = { videoId: options.videoId, seq: requestSeq }
  }
  if (options.momentsView === 'all') {
    archiveTab.value = 'moments'
    momentsFocusRequest.value = { view: 'all', seq: ++requestSeq }
  }
  if (options.revealVideoId !== undefined) {
    archiveTab.value = 'music'
    requestSeq += 1
    revealRequest.value = { videoId: options.revealVideoId, seq: requestSeq }
  }
  if (options.showDetail === true) {
    archiveTab.value = 'music'
    detailRequest.value += 1
  }
  if (options.artwork !== undefined) {
    archiveTab.value = 'music'
    requestSeq += 1
    artworkRequest.value = { ...options.artwork, seq: requestSeq }
  }
  if (isArchiveOpen.value) return

  const active = document.activeElement
  archiveTrigger = active instanceof HTMLElement ? active : null
  isArchiveOpen.value = true
  void placeArchive().then(watchStrip)
}

async function closeArchive(): Promise<void> {
  if (!isArchiveOpen.value) return
  if ((await archivePanel.value?.allowLeave()) === false) return
  archivePanel.value?.resetNavigation()

  isArchiveOpen.value = false
  unwatchStrip()
  layoutMode.value = 'strip'
  sheetTop.value = null
  sheetLeft.value = null
  archiveHeight.value = null
  lockPageScroll(false)
  await nextTick()
  // 띠 배치에서 자리를 벌려고 페이지를 올렸으면 원래 자리로 되돌린다.
  if (scrollBeforeStrip !== null) {
    window.scrollTo(0, scrollBeforeStrip)
    scrollBeforeStrip = null
  }
  reportObstruction()
  // 연 버튼이 아직 화면에 있으면 포커스를 되돌린다.
  if (archiveTrigger !== null && document.contains(archiveTrigger)) archiveTrigger.focus()
  archiveTrigger = null
}

/**
 * 헤더의 "보관함" (M11-7B): 열려 있으면 닫고, 닫혀 있으면 **마지막으로 쓰던 탭**으로 연다.
 * 마지막 탭은 이 셸의 메모리에만 있다 — 저장하지 않는다 (새로고침하면 음악 탭).
 */
function toggleArchive(): void {
  if (isArchiveOpen.value) {
    void closeArchive()
    return
  }
  openArchive()
}

/**
 * 재생 전에 비켜준다 (M7-2 계약). M11 의 배치는 플레이어를 덮지 않으므로 대개 할 일이 없다 —
 * 그래도 **덮고 있다고 측정되면** 닫는다. 숫자로 판단하지 않고 사실(가림 높이)로 판단한다.
 */
async function stepAside(): Promise<void> {
  // 띠 배치의 보관함은 영상 아래의 일반 흐름이다 — 덮을 수 없다.
  if (!isArchiveOpen.value || layoutMode.value === 'strip') return
  const holder = videoHolder()
  if (holder === null) return
  const box = holder.getBoundingClientRect()
  const coveredBelow = sheetTop.value !== null && box.bottom > sheetTop.value
  const coveredRight = sheetLeft.value !== null && box.right > sheetLeft.value
  if (coveredBelow || coveredRight) await closeArchive()
}

const archive: ArchiveController = {
  isOpen: readonly(isArchiveOpen),
  tab: readonly(archiveTab),
  panelId: ARCHIVE_ID,
  open: openArchive,
  close: () => void closeArchive(),
  stepAside,
}
provide(ARCHIVE, archive)

/* ------------------------------------------------------------------ *
 * 데이터 대화상자
 * ------------------------------------------------------------------ */

const DATA_DIALOG_ID = 'data-dialog'
const isDataOpen = ref(false)
let dataTrigger: HTMLElement | null = null

/** 데이터 · 백업 — 다른 기기로 옮기기 전용 (ADR 0043). */
function openData(): void {
  const active = document.activeElement
  dataTrigger = active instanceof HTMLElement ? active : null
  isDataOpen.value = true
}

/* ------------------------------------------------------------------ *
 * 공유 대화상자 (ADR 0043 — 데이터 대화상자에서 떼어 냈다)
 * ------------------------------------------------------------------ */

/** 열린 공유의 대상. `null` 이면 닫혀 있다. 연 곳(공유 단추)이 정한다. */
const shareRequest = ref<ShareRequest | null>(null)
let shareTrigger: HTMLElement | null = null

function openShare(target: ShareTarget): void {
  const active = document.activeElement
  shareTrigger = active instanceof HTMLElement ? active : null
  shareRequest.value = { ...target, seq: ++requestSeq }
}

async function closeShare(): Promise<void> {
  if (shareRequest.value === null) return
  shareRequest.value = null
  await nextTick()
  if (shareTrigger !== null && document.contains(shareTrigger)) shareTrigger.focus()
  shareTrigger = null
}

provide(SHARE_DIALOG, {
  open(target) {
    openShare(target)
  },
})

/* ------------------------------------------------------------------ *
 * 링크로 받은 공유 (ADR 0040)
 * ------------------------------------------------------------------ */

/**
 * 주소 조각이 공유 링크(`#share?…`)면 읽어서 미리보기를 띄운다. 처음 열 때와, 이미 열린 39page 탭에 링크를 붙여 넣었을
 * 때(`hashchange`) 모두. 읽기는 검증만 한다 — 저장 · 재생은 받는 사람이 미리보기에서 누를 때만.
 */
const incomingShare = ref<ShareLinkParse | null>(null)

function readShareLink(): void {
  const hash = globalThis.location.hash
  if (!isShareHash(hash)) return
  incomingShare.value = parseShareLink(hash)
}

/**
 * 미리보기를 닫는다. 주소의 조각도 지운다 — 새로고침해서 같은 미리보기가 다시 뜨지 않게. 할 일(`after`, 재생 등)은
 * 대화상자가 **내려간 뒤**에 한다 — 덮인 플레이어로 소리를 내지 않는다 (ADR 0011).
 */
async function closeShareLink(after?: () => void): Promise<void> {
  if (incomingShare.value === null) return
  incomingShare.value = null
  if (isShareHash(globalThis.location.hash)) {
    const { pathname, search } = globalThis.location
    globalThis.history.replaceState(globalThis.history.state, '', `${pathname}${search}`)
  }
  await nextTick()
  after?.()
}

async function closeData(): Promise<void> {
  if (!isDataOpen.value) return
  isDataOpen.value = false
  await nextTick()
  if (dataTrigger !== null && document.contains(dataTrigger)) dataTrigger.focus()
  dataTrigger = null
}

/**
 * Escape 는 **가장 바깥 것부터** 닫는다 — 받은 공유 → 공유 → 데이터 대화상자 → 보관함. 한 번에 둘을 닫으면 사용자가
 * 무엇을 닫았는지 알 수 없다. (M7 의 플레이리스트 선반은 M11-3 에서 없어졌다 — 데크가 보관함을 연다.)
 */
function onKeydown(event: KeyboardEvent): void {
  // 안쪽이 Esc 를 이미 썼으면(검색어 지우기 등) 닫지 않는다.
  if (event.key !== 'Escape' || event.defaultPrevented) return

  if (incomingShare.value !== null) {
    void closeShareLink()
    return
  }
  if (shareRequest.value !== null) {
    void closeShare()
    return
  }
  if (isDataOpen.value) {
    void closeData()
    return
  }
  if (isArchiveOpen.value) void closeArchive()
}

/** 창 크기 · 방향이 바뀌면 배치를 다시 정한다 (세로 ↔ 가로). */
function onResize(): void {
  if (isArchiveOpen.value) void placeArchive()
  else reportObstruction()
}

onMounted(() => {
  document.addEventListener('keydown', onKeydown)
  window.addEventListener('resize', onResize, { passive: true })
  // 링크로 받은 공유 (ADR 0040) — 처음 열 때, 그리고 열린 탭에 공유 링크를 붙여 넣었을 때.
  readShareLink()
  window.addEventListener('hashchange', readShareLink)
})

onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKeydown)
  window.removeEventListener('resize', onResize)
  window.removeEventListener('hashchange', readShareLink)
  unwatchStrip()
  lockPageScroll(false)
  // 셸이 사라지면 가리는 것도 없다. 멈춘 이유를 남겨두지 않는다.
  playback?.setBottomObstruction(0)
})

const workspaceClass = computed(() => ({
  'is-archive-open': isArchiveOpen.value,
  'is-stacked': isArchiveOpen.value && layoutMode.value === 'stack',
  'is-side': isArchiveOpen.value && layoutMode.value === 'side',
}))

/**
 * 지금 배치 — 위젯들이 보고 자기 안쪽을 작게 놓는다 (M11-7B). 닫혀 있으면 속성이 없다.
 * 플레이어 · Moments 위젯의 비스코프 스타일이 이 속성을 쓴다.
 */
const archiveLayout = computed<ArchiveLayout | undefined>(() =>
  isArchiveOpen.value ? layoutMode.value : undefined,
)

const workspaceStyle = computed(() => {
  const style: Record<string, string> = {}
  if (sheetTop.value !== null) style['--archive-sheet-top'] = `${String(sheetTop.value)}px`
  if (sheetLeft.value !== null) style['--archive-sheet-left'] = `${String(sheetLeft.value)}px`
  if (archiveHeight.value !== null) style['--archive-height'] = `${String(archiveHeight.value)}px`
  return Object.keys(style).length === 0 ? undefined : style
})

/** 대화상자가 열려 있는 동안 뒤쪽을 조작할 수 없게 한다 (보조기기 포함). */
const behindDialog = computed(() =>
  isDataOpen.value || shareRequest.value !== null || incomingShare.value !== null
    ? true
    : undefined,
)
</script>

<template>
  <div
    ref="shell"
    class="dashboard-shell"
    :class="{ 'is-header-collapsed': !header.expanded.value }"
  >
    <AppHeader
      :brand="brand"
      :expanded="header.expanded.value"
      :inert="behindDialog"
      @toggle="header.toggle"
    >
      <template #actions>
        <AppNav
          :archive-id="ARCHIVE_ID"
          :archive-open="isArchiveOpen"
          :data-dialog-id="DATA_DIALOG_ID"
          :data-open="isDataOpen"
          @archive="toggleArchive"
          @data="openData"
        />
        <slot name="header-actions" />
      </template>
    </AppHeader>

    <!--
      보관함은 WidgetHost 의 **형제**다. 열고 닫아도 WidgetHost 와 그 안의 PlayerSurface 는 같은
      부모에 그대로 있다. v-if 를 쓰지 않는다 (ADR 0002).
    -->
    <div
      ref="workspace"
      class="workspace"
      :class="workspaceClass"
      :style="workspaceStyle"
      :data-archive-layout="archiveLayout"
      :inert="behindDialog"
    >
      <!--
        가로 화면(띠 배치)의 "보관함 닫기" — 영상 띠 오른쪽 위 (M11-7C UAT). 늘 DOM 에 있고 띠 배치에서만
        보인다 — 열고 닫을 때 WidgetHost 앞에 노드를 넣고 빼지 않는다(플레이어 노드는 그대로, ADR 0002).
        쌓기 · 옆 배치는 보관함 머리말의 × 를 그대로 쓴다. Esc 는 셸이 그대로 받는다.
      -->
      <button
        type="button"
        class="strip-close"
        aria-label="보관함 닫기"
        title="보관함 닫기 (Esc)"
        :aria-controls="ARCHIVE_ID"
        :hidden="archiveLayout !== 'strip'"
        @click="closeArchive"
      >
        보관함 닫기 <span class="strip-close-mark" aria-hidden="true">×</span>
      </button>
      <WidgetHost :layout="layout" />
      <ArchivePanel
        ref="archivePanel"
        :open="isArchiveOpen"
        :tab="archiveTab"
        :panel-id="ARCHIVE_ID"
        :add-link-request="addLinkRequest"
        :moments-focus-request="momentsFocusRequest"
        :reveal-request="revealRequest"
        :detail-request="detailRequest"
        :artwork-request="artworkRequest"
        :show-close="archiveLayout !== 'strip'"
        @close="closeArchive"
        @select-tab="(tab) => (archiveTab = tab)"
      />
    </div>

    <!--
      승인된 디자인의 `.footer`. 테마 문구를 쓰므로 별도 컴포넌트다 — 이 셸은 테마를 모르는 상태로
      남아야 한다 (ADR 0001).
    -->
    <AppFooter :inert="behindDialog" />

    <DataDialog :open="isDataOpen" :dialog-id="DATA_DIALOG_ID" @close="closeData" />

    <!-- 공유 (ADR 0043) — 공유 단추가 연다. 연 동안만 있다. -->
    <ShareDialog
      v-if="shareRequest !== null"
      :key="shareRequest.seq"
      :request="shareRequest"
      @close="closeShare"
    />

    <!-- 링크로 받은 공유 (ADR 0040). 데이터 대화상자보다 위 — 그 위에서 링크를 열 수도 있다. -->
    <ShareLinkDialog
      v-if="incomingShare !== null"
      :link="incomingShare"
      @close="(after) => void closeShareLink(after)"
    />
  </div>
</template>

<style scoped>
/* 승인된 디자인의 .shell 값을 따른다. */
.dashboard-shell {
  max-width: var(--size-shell-max-width);
  margin: auto;
  padding: 22px clamp(12px, 3vw, 46px) 44px;
}

.dashboard-shell.is-header-collapsed {
  padding-top: 8px;
}
.is-header-collapsed .workspace {
  margin-top: 8px;
}

/* 승인된 디자인의 .workspace 값을 따른다. 복합 배경을 그대로 쓴다. */
.workspace {
  display: grid;
  min-height: var(--size-workspace-min-height);
  margin-top: clamp(23px, 2.6vw, 39px);
  padding: clamp(18px, 2.6vw, 36px);
  border: 1px solid var(--workspace-border-color);
  background: var(--workspace-background);
  grid-template-columns: minmax(0, 1fr);
  /* 내부 요소가 워크스페이스 밖으로 넘치지 않게 한다. */
  overflow: hidden;
  isolation: isolate;
}

/*
 * 보관함이 열리면 — **띠** 배치 (기본, M11-7B · 배치 C).
 *
 * 워크스페이스가 한 열 두 행이 된다: 위에 재생 띠(위젯 호스트), 아래에 보관함. 보관함은 일반 흐름이라
 * 영상을 덮을 수 없다.
 */
.workspace.is-archive-open {
  align-items: start;
  row-gap: clamp(12px, 1.6vw, 20px);
  grid-template-columns: minmax(0, 1fr);
}

/*
 * 보관함이 열린 동안 위젯 호스트는 **재생 띠**다 — 플레이어와 Moments(저장 줄)만 보인다. 나머지 위젯은
 * `display: none` 이지만 마운트된 채다 — 닫으면 그대로 돌아온다. 플레이어 노드는 움직이지 않는다
 * (ADR 0002). 두 위젯의 안쪽 배치는 각 컴포넌트가 `data-archive-layout` 을 보고 정한다.
 */
.workspace.is-archive-open > :deep(.widget-host) {
  align-items: start;
  grid-template-areas: 'player moments';
  grid-template-columns: minmax(0, 1fr) minmax(240px, 0.4fr);
  grid-template-rows: auto;
}

.workspace.is-archive-open
  > :deep(.widget-host > :not([data-widget='player'], [data-widget='moments'])),
.workspace.is-archive-open > :deep(.widget-host::before) {
  display: none;
}

/* 좁은 배치(`WidgetHost` 의 1100px 이하)가 플레이어에 건 폭 상한 · 가운데 정렬을 띠에서는 푼다. */
.workspace.is-archive-open > :deep(.widget-host > [data-widget='player']) {
  width: auto;
  max-width: none;
  justify-self: stretch;
}

.workspace.is-archive-open > :deep(.widget-host > [data-widget='moments']) {
  align-self: start;
}

/*
 * 띠 배치의 "보관함 닫기" (M11-7C UAT) — 재생 띠 위 오른쪽 끝. 자기 줄을 갖는다: 영상 · 조작 · 이 곡의
 * Moments 를 덮지 않는다. 워크스페이스 위 여백과 줄 간격을 반쯤 빌려 띠가 많이 내려가지 않게 한다.
 * 터치 목표 44px. 색은 다른 글자 단추(`.pill`)와 같은 토큰.
 */
.strip-close {
  display: inline-flex;
  min-width: 44px;
  min-height: 44px;
  align-items: center;
  justify-self: end;
  gap: 8px;
  margin: calc(clamp(18px, 2.6vw, 36px) * -0.5) 0 calc(clamp(12px, 1.6vw, 20px) * -0.5);
  padding: 6px 14px;
  border: 1px solid var(--pill-border-color);
  border-radius: var(--radius-control);
  background: var(--pill-surface-color);
  color: var(--pill-text-color);
  font: 12px var(--font-mono);
}

.strip-close[hidden] {
  display: none;
}

.strip-close-mark {
  font-size: 18px;
  line-height: 1;
}

@media (hover: hover) {
  .strip-close:hover {
    background: var(--pill-surface-hover-color);
  }
}

/*
 * 보관함은 화면 높이 안에서 끝나고, 스크롤은 그 안의 칸에서만 한다. 높이는 셸이 실제 자리를 재서
 * 준다(`fitStrip`). 재기 전 · 잴 수 없는 환경의 기본값은 화면 높이의 절반쯤이다.
 */
.workspace.is-archive-open > .archive {
  height: var(--archive-height, min(calc(100dvh - 32px), 520px));
}

/* 띠가 좁으면 저장 줄이 영상 옆에 설 자리가 없다 — 재생 띠 아래 한 줄로 내린다. */
@media (max-width: 1000px) {
  .workspace.is-archive-open > :deep(.widget-host) {
    row-gap: 10px;
    grid-template-areas:
      'player'
      'moments';
    grid-template-columns: minmax(0, 1fr);
  }
}

/*
 * **쌓기** 배치 — 세로 화면.
 *
 * 영상을 화면 위로 스크롤한 뒤(셸의 `placeArchive`) 시트를 재생 띠의 실제 아래 끝에 맞춘다
 * (`--archive-sheet-top`). 아래 여백을 화면 높이만큼 주는 것은, 페이지가 짧아도 영상을 화면 위까지
 * 올릴 수 있게 하기 위해서다. 열린 동안 페이지 스크롤은 잠기고 스크롤은 보관함 안에서만 한다.
 */
.workspace.is-archive-open.is-stacked {
  position: relative;
  /* 시트가 푸터보다 위에 그려지도록 워크스페이스를 올린다. */
  z-index: 2;
  padding-bottom: 100dvh;
}

.workspace.is-archive-open.is-stacked > :deep(.widget-host),
.workspace.is-archive-open.is-side > :deep(.widget-host) {
  row-gap: 8px;
  grid-template-areas:
    'player'
    'moments';
  grid-template-columns: minmax(0, 1fr);
}

.workspace.is-archive-open.is-stacked > .archive {
  position: fixed;
  z-index: 3;
  inset: var(--archive-sheet-top, 50dvh) 0 0;
  height: auto;
  border-right: 0;
  border-bottom: 0;
  border-left: 0;
}

/*
 * **옆** 배치 — 낮은 가로 화면 (폰 가로).
 *
 * 왼쪽 열에 재생 띠(영상 → 조작 → 저장)가 서고, 보관함은 영상의 실제 오른쪽 끝
 * (`--archive-sheet-left`)부터 화면 높이 전체를 쓰는 고정 패널이 된다. 영상은 화면 위에 오고 페이지
 * 스크롤은 잠긴다. 왼쪽 열의 최소 폭 360px 은 `WidgetHost` 와 같은 근거다 (16:9 × 202px).
 */
.workspace.is-archive-open.is-side {
  position: relative;
  z-index: 2;
  padding-bottom: 100dvh;
  column-gap: clamp(16px, 2vw, 32px);
  grid-template-columns: minmax(360px, 0.9fr) minmax(0, 1.1fr);
}

.workspace.is-archive-open.is-side > .archive {
  position: fixed;
  z-index: 3;
  inset: 0 0 0 var(--archive-sheet-left, 50vw);
  height: auto;
  border-top: 0;
  border-right: 0;
  border-bottom: 0;
}

@media (max-width: 650px) {
  .dashboard-shell {
    padding: 10px 8px 35px;
  }

  .workspace {
    padding: 17px;
  }
}
</style>
