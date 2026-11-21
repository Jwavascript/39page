/**
 * 공유 카드 그리기 — 브라우저 canvas 2D (ADR 0041). `main.ts` 가 처음 쓸 때 이 파일을 내려받는다.
 *
 * 치수 · 색은 시안(`design/mockups/share-card/`)과 리서치의 하한을 따른다 — 곡 이름 40px · 보조 28–32px · 제목 60–84px,
 * 선 2px 이상, 글자 아래에 도트 무늬를 깔지 않는다. 글꼴은 앱의 기본 글꼴(`--font-body` · `--font-mono`)을 쓴다 —
 * 기기마다 모양이 조금 다를 수 있다 (사용자 결정: 기본 글꼴로 시작).
 *
 * 넣지 않는 것: QR · 링크 안내 문구 · YouTube 썸네일 · YouTube 로고 · "39page 에서 듣기" 글(재생 표시 ▶ 만, ADR 0043).
 * 사용자가 올린 앨범아트는 넣는다 (ADR 0042).
 */
import type { ArtworkDisplay } from '@/shared/types/artwork'
import { customCardPalette, KAWAII_CARD_PALETTE, type KawaiiCardPalette } from './shareCardPalette'

import {
  artworkPlacement,
  fitLine,
  RECEIPT,
  receiptHeight,
  receiptRowsThatFit,
  SHARE_CARD_MAX_HEIGHT,
  wrapLines,
  type Measure,
  type ShareCardImage,
  type ShareCardModel,
  type ShareCardMoment,
  type ShareCardRow,
} from './shareCard'

/**
 * Kawaii 카드 틀의 색. 보통은 승인된 Kawaii 색이고, 커스텀 테마(ADR 0045)면 사용자 색에서 만든 색이다. 그리기 직전
 * (`renderShareCard` 의 동기 구간)에 정한다 — 그 구간에는 다른 카드가 끼어들 수 없다.
 */
let KAWAII: KawaiiCardPalette = KAWAII_CARD_PALETTE

const MONO = {
  bg: '#171614',
  bg2: '#1f1d1a',
  ink: '#e9e2d7',
  accent: '#d5cab9',
  dim: '#8f887b',
  line: '#504a41',
  paper: '#ded4c6',
  grooveA: '#0f0e0c',
  grooveB: '#24211d',
  ring: '#2a2723',
} as const

const FALLBACK_SANS =
  "system-ui, -apple-system, 'Apple SD Gothic Neo', 'Malgun Gothic', 'Noto Sans KR', sans-serif"
const FALLBACK_MONO = "ui-monospace, 'IBM Plex Mono', Consolas, 'Courier New', monospace"

type Ctx = CanvasRenderingContext2D

interface Fonts {
  readonly sans: string
  readonly mono: string
}

/** 앱의 기본 글꼴 — CSS 변수를 그대로 읽는다. 없으면 같은 목록의 사본. */
function appFonts(): Fonts {
  const style = getComputedStyle(document.documentElement)
  const sans = style.getPropertyValue('--font-body').trim()
  const mono = style.getPropertyValue('--font-mono').trim()
  return { sans: sans === '' ? FALLBACK_SANS : sans, mono: mono === '' ? FALLBACK_MONO : mono }
}

/* ------------------------------------------------------------------ *
 * 그리기 도구
 * ------------------------------------------------------------------ */

function font(ctx: Ctx, weight: number, size: number, family: string): void {
  ctx.font = `${String(weight)} ${String(size)}px ${family}`
}

/** 글자 사이 — 지원하는 브라우저에서만 (Chrome 99 · Safari 18.4 · Firefox 115). 없으면 그냥 붙는다. */
function spacing(ctx: Ctx, px: number): void {
  if ('letterSpacing' in ctx)
    (ctx as Ctx & { letterSpacing: string }).letterSpacing = `${String(px)}px`
}

const measureOf =
  (ctx: Ctx): Measure =>
  (text) =>
    ctx.measureText(text).width

function text(
  ctx: Ctx,
  value: string,
  x: number,
  y: number,
  options: {
    color: string
    align?: CanvasTextAlign
    baseline?: CanvasTextBaseline
    alpha?: number
  },
): void {
  ctx.save()
  ctx.fillStyle = options.color
  ctx.textAlign = options.align ?? 'left'
  ctx.textBaseline = options.baseline ?? 'middle'
  if (options.alpha !== undefined) ctx.globalAlpha = options.alpha
  ctx.fillText(value, x, y)
  ctx.restore()
}

function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

function line(
  ctx: Ctx,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  color: string,
  width: number,
  dash: number[] = [],
): void {
  ctx.save()
  ctx.strokeStyle = color
  ctx.lineWidth = width
  ctx.setLineDash(dash)
  ctx.beginPath()
  ctx.moveTo(x1, y1)
  ctx.lineTo(x2, y2)
  ctx.stroke()
  ctx.restore()
}

/** 알약 단추 모양(글자 포함). 너비를 돌려준다. */
function pill(
  ctx: Ctx,
  value: string,
  x: number,
  centerY: number,
  options: {
    fill: string | null
    stroke?: string
    color: string
    height: number
    pad: number
    align?: 'left' | 'center'
  },
): number {
  const width = ctx.measureText(value).width + options.pad * 2
  const left = options.align === 'center' ? x - width / 2 : x
  roundRect(ctx, left, centerY - options.height / 2, width, options.height, options.height / 2)
  if (options.fill !== null) {
    ctx.fillStyle = options.fill
    ctx.fill()
  }
  if (options.stroke !== undefined) {
    ctx.strokeStyle = options.stroke
    ctx.lineWidth = 4
    ctx.stroke()
  }
  text(ctx, value, left + width / 2, centerY + 1, { color: options.color, align: 'center' })
  return width
}

/** 위 띠 — 브랜드 · 꼬리표 · 날짜 칩 (Kawaii). */
function kawaiiStrip(ctx: Ctx, fonts: Fonts, tag: string, date: string): void {
  font(ctx, 700, 30, fonts.mono)
  spacing(ctx, 4.8)
  text(ctx, '39PAGE', 56, 58, { color: KAWAII.mint })
  spacing(ctx, 4.2)
  text(ctx, tag, 540, 58, { color: KAWAII.pink, align: 'center' })
  spacing(ctx, 0)
  font(ctx, 700, 28, fonts.mono)
  const width = ctx.measureText(date).width + 36
  pill(ctx, date, 1024 - width, 58, { fill: KAWAII.pink, color: KAWAII.ink, height: 46, pad: 18 })
}

/**
 * 재생 표시 — 원 안의 ▶ (ADR 0043: "39page 에서 듣기" 글 대신). 원은 칠하거나(`fill`) 테두리만(`stroke`). 삼각형은 원
 * 가운데에서 조금 오른쪽으로 — 눈으로 보기에 가운데.
 */
function playMark(
  ctx: Ctx,
  cx: number,
  cy: number,
  r: number,
  options: { fill?: string; stroke?: string; color: string },
): void {
  ctx.save()
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  if (options.fill !== undefined) {
    ctx.fillStyle = options.fill
    ctx.fill()
  }
  if (options.stroke !== undefined) {
    ctx.strokeStyle = options.stroke
    ctx.lineWidth = Math.max(3, r * 0.1)
    ctx.stroke()
  }
  const size = r * 0.42
  const shift = r * 0.08
  ctx.beginPath()
  ctx.moveTo(cx - size * 0.75 + shift, cy - size)
  ctx.lineTo(cx - size * 0.75 + shift, cy + size)
  ctx.lineTo(cx + size * 1.05 + shift, cy)
  ctx.closePath()
  ctx.fillStyle = options.color
  ctx.fill()
  ctx.restore()
}

/** 곡 한 줄 — 번호 · 이름(한 줄 + "…") · Moment 시점. */
function trackRow(
  ctx: Ctx,
  fonts: Fonts,
  row: ShareCardRow,
  centerY: number,
  layout: {
    left: number
    titleLeft: number
    right: number
    noFont: [number, number, string]
    titleFont: [number, number, string]
    momentFont: [number, number, string]
    noColor: string
    titleColor: string
    momentColor: string
  },
): void {
  font(ctx, layout.noFont[0], layout.noFont[1], layout.noFont[2])
  text(ctx, row.no, layout.left, centerY, { color: layout.noColor })
  let titleRight = layout.right
  if (row.moment !== null) {
    font(ctx, layout.momentFont[0], layout.momentFont[1], layout.momentFont[2])
    const label = `◆${row.moment}`
    text(ctx, label, layout.right, centerY, { color: layout.momentColor, align: 'right' })
    titleRight = layout.right - ctx.measureText(label).width - 18
  }
  font(ctx, layout.titleFont[0], layout.titleFont[1], layout.titleFont[2])
  const fitted = fitLine(row.title, titleRight - layout.titleLeft, measureOf(ctx))
  text(ctx, fitted, layout.titleLeft, centerY + 2, { color: layout.titleColor })
}

/* ------------------------------------------------------------------ *
 * 사용자 앨범아트
 * ------------------------------------------------------------------ */

/** 그릴 수 있게 읽은 사용자 그림. 다 그린 뒤 `release()` 로 놓는다. */
interface ArtImage {
  readonly source: CanvasImageSource
  readonly width: number
  readonly height: number
  release(): void
}

interface CardArt {
  readonly image: ArtImage
  readonly display: ArtworkDisplay
}

/**
 * 그림 바이트를 읽는다. 못 읽으면 `null` — 카드는 기본 그림으로 그린다. 움직이는 GIF 는 첫 장면이다.
 * `blob:` 주소는 같은 출처라 캔버스가 더럽혀지지 않는다(그린 뒤에도 PNG 로 꺼낼 수 있다).
 */
async function decodeArt(blob: Blob | null): Promise<ArtImage | null> {
  if (blob === null) return null
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(blob)
      return {
        source: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        release: () => bitmap.close(),
      }
    } catch {
      // 아래 <img> 로 한 번 더 읽어 본다.
    }
  }
  if (typeof URL.createObjectURL !== 'function') return null
  const url = URL.createObjectURL(blob)
  try {
    const image = new Image()
    image.src = url
    await image.decode()
    if (image.naturalWidth === 0 || image.naturalHeight === 0) throw new Error('empty image')
    return {
      source: image,
      width: image.naturalWidth,
      height: image.naturalHeight,
      release: () => URL.revokeObjectURL(url),
    }
  } catch {
    URL.revokeObjectURL(url)
    return null
  }
}

/** 정사각형 칸에 사용자 그림 — 둥근 모서리로 자르고, 맞춤(contain)이 남긴 자리는 `background`. */
function drawArt(
  ctx: Ctx,
  art: CardArt,
  x: number,
  y: number,
  size: number,
  radius: number,
  background: string,
): void {
  ctx.save()
  roundRect(ctx, x, y, size, size, radius)
  ctx.clip()
  ctx.fillStyle = background
  ctx.fillRect(x, y, size, size)
  const place = artworkPlacement(size, art.image.width, art.image.height, art.display)
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(art.image.source, x + place.x, y + place.y, place.width, place.height)
  ctx.restore()
}

/** 그림 테두리. */
function frame(
  ctx: Ctx,
  x: number,
  y: number,
  size: number,
  radius: number,
  color: string,
  width: number,
): void {
  roundRect(ctx, x, y, size, size, radius)
  ctx.strokeStyle = color
  ctx.lineWidth = width
  ctx.stroke()
}

/* ------------------------------------------------------------------ *
 * A. 카세트 J카드 — Kawaii, 1080 × 1350
 * ------------------------------------------------------------------ */

function drawJcard(ctx: Ctx, fonts: Fonts, model: ShareCardModel, art: CardArt | null): void {
  ctx.fillStyle = KAWAII.bg
  ctx.fillRect(0, 0, 1080, 1350)
  kawaiiStrip(ctx, fonts, 'MIXTAPE', model.date)

  // 펼친 J카드
  roundRect(ctx, 56, 116, 968, 1030, 26)
  ctx.fillStyle = KAWAII.paper
  ctx.fill()
  ctx.save()
  ctx.clip()

  // 앞면 — 제목 두 줄 · 곡 수 · 테이프 릴(앨범아트가 있으면 그 그림). 두 줄 제목이 테두리에 붙지 않게 위아래로 30px
  // 넘게 띄운다.
  const frontTop = 116
  const frontHeight = 292
  const artSize = 232
  font(ctx, 800, 80, fonts.sans)
  const titleLines = wrapLines(model.heading, art === null ? 658 : 616, 2, measureOf(ctx))
  const block = titleLines.length * 90 + 10 + 38
  let y = frontTop + (frontHeight - block) / 2
  for (const value of titleLines) {
    text(ctx, value, 96, y, { color: KAWAII.ink, baseline: 'top' })
    y += 90
  }
  font(ctx, 700, 32, fonts.mono)
  const meta = `${String(model.totalTracks)} TRACKS${model.momentCount > 0 ? ` · MOMENT ${String(model.momentCount)}` : ''}`
  text(ctx, meta, 96, y + 10, { color: KAWAII.meta, baseline: 'top' })

  if (art === null) {
    const reelY = frontTop + frontHeight / 2
    roundRect(ctx, 784, reelY - 68, 200, 136, 68)
    ctx.strokeStyle = KAWAII.ink
    ctx.lineWidth = 6
    ctx.stroke()
    for (const cx of [844, 924]) {
      ctx.beginPath()
      ctx.arc(cx, reelY, 38, 0, Math.PI * 2)
      ctx.stroke()
      ctx.beginPath()
      ctx.arc(cx, reelY, 16, 0, Math.PI * 2)
      ctx.fillStyle = KAWAII.pink
      ctx.fill()
    }
  } else {
    const artX = 984 - artSize
    const artY = frontTop + (frontHeight - artSize) / 2
    drawArt(ctx, art, artX, artY, artSize, 16, KAWAII.artBox)
    frame(ctx, artX, artY, artSize, 16, KAWAII.ink, 5)
  }

  // 등 — 목록 이름 한 줄 · 곡 수
  const spineTop = frontTop + frontHeight
  ctx.fillStyle = KAWAII.pink
  ctx.fillRect(56, spineTop, 968, 70)
  font(ctx, 700, 28, fonts.mono)
  const code = `39P · ${String(model.totalTracks)}`
  const codeWidth = ctx.measureText(code).width
  text(ctx, code, 984, spineTop + 35, { color: KAWAII.ink, align: 'right' })
  font(ctx, 800, 36, fonts.sans)
  text(ctx, fitLine(model.heading, 888 - codeWidth - 24, measureOf(ctx)), 96, spineTop + 36, {
    color: KAWAII.ink,
  })

  // 속지 — SIDE A / SIDE B (10곡이면 카드 아래 테두리까지 30px 넘게 남는다)
  y = spineTop + 70 + 16
  model.sides.forEach((rows, index) => {
    font(ctx, 800, 28, fonts.mono)
    spacing(ctx, 3.4)
    text(ctx, index === 0 ? 'SIDE A' : 'SIDE B', 96, y, { color: KAWAII.pinkDark, baseline: 'top' })
    spacing(ctx, 0)
    line(ctx, 96, y + 39, 984, y + 39, KAWAII.dash, 3, [9, 7])
    y += 44
    for (const row of rows) {
      trackRow(ctx, fonts, row, y + 26, {
        left: 96,
        titleLeft: 168,
        right: 984,
        noFont: [700, 30, fonts.mono],
        titleFont: [700, 40, fonts.sans],
        momentFont: [700, 28, fonts.mono],
        noColor: KAWAII.pinkDark,
        titleColor: KAWAII.ink,
        momentColor: KAWAII.pinkDark,
      })
      line(ctx, 96, y + 51, 984, y + 51, KAWAII.rowLine, 2)
      y += 52
    }
    y += 10
  })
  ctx.restore()

  roundRect(ctx, 58.5, 118.5, 963, 1025, 24)
  ctx.strokeStyle = KAWAII.pink
  ctx.lineWidth = 5
  ctx.stroke()

  // 아래 — 재생 표시 · 곡 수 · 주소
  playMark(ctx, 56 + 44, 1248, 44, { fill: KAWAII.pink, color: KAWAII.ink })
  font(ctx, 700, 30, fonts.mono)
  const count = `${String(model.totalTracks)}곡${model.momentCount > 0 ? ` · ◆ ${String(model.momentCount)}` : ''}`
  text(ctx, count, 1024, 1228, { color: KAWAII.mint, align: 'right' })
  text(ctx, '39page.com', 1024, 1270, { color: KAWAII.mint, align: 'right' })
}

/* ------------------------------------------------------------------ *
 * B. LP 뒷면 — Mono, 1080 × 1080
 * ------------------------------------------------------------------ */

function monoBackground(ctx: Ctx, height: number): void {
  const gradient = ctx.createLinearGradient(0, 0, 1080, height)
  gradient.addColorStop(0, MONO.bg2)
  gradient.addColorStop(0.7, MONO.bg)
  gradient.addColorStop(1, MONO.bg)
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, 1080, height)
}

/** 레코드 — 홈(6px)을 번갈아 칠하고 라벨 · 구멍. 글자를 얹지 않는다. */
function disc(ctx: Ctx, cx: number, cy: number, r: number, labelRatio = 0.3): void {
  for (let radius = r, index = 0; radius > r * labelRatio; radius -= 6, index += 1) {
    ctx.beginPath()
    ctx.arc(cx, cy, radius, 0, Math.PI * 2)
    ctx.fillStyle = index % 2 === 0 ? MONO.grooveA : MONO.grooveB
    ctx.fill()
  }
  ctx.beginPath()
  ctx.arc(cx, cy, r * labelRatio, 0, Math.PI * 2)
  ctx.fillStyle = MONO.ring
  ctx.fill()
  ctx.beginPath()
  ctx.arc(cx, cy, r * labelRatio - 8, 0, Math.PI * 2)
  ctx.fillStyle = MONO.accent
  ctx.fill()
  ctx.beginPath()
  ctx.arc(cx, cy, Math.max(4, r * 0.025), 0, Math.PI * 2)
  ctx.fillStyle = MONO.bg
  ctx.fill()
}

function monoFooter(ctx: Ctx, fonts: Fonts, height: number): void {
  const top = height - 112
  line(ctx, 72, top, 1008, top, MONO.line, 3)
  font(ctx, 700, 28, fonts.mono)
  spacing(ctx, 4.5)
  text(ctx, '39PAGE', 72, top + 46, { color: MONO.ink })
  spacing(ctx, 0)
  playMark(ctx, 1008 - 26, top + 46, 26, { stroke: MONO.accent, color: MONO.accent })
}

function drawLp(ctx: Ctx, fonts: Fonts, model: ShareCardModel, art: CardArt | null): void {
  monoBackground(ctx, 1080)
  disc(ctx, 1015, 65, 235)
  // 앨범아트가 있으면 모서리의 레코드를 덮는 재킷 — 레코드가 재킷 뒤로 비죽 나온 모양. 제목은 그만큼 좁게.
  if (art !== null) {
    drawArt(ctx, art, 784, 64, 224, 6, MONO.ring)
    frame(ctx, 784, 64, 224, 6, MONO.line, 3)
  }
  const titleWidth = art === null ? 700 : 640

  font(ctx, 600, 28, fonts.mono)
  spacing(ctx, 3.9)
  text(ctx, `39PAGE RECORDS · ${model.catalog}`, 72, 64, { color: MONO.dim, baseline: 'top' })
  spacing(ctx, 0)

  // 제목 — 72px 한 줄에 들어가면 그대로, 아니면 60px 두 줄
  let y = 112
  font(ctx, 800, 72, fonts.sans)
  let lines = [model.heading]
  let lineHeight = 82
  if (ctx.measureText(model.heading).width > titleWidth) {
    font(ctx, 800, 60, fonts.sans)
    lines = wrapLines(model.heading, titleWidth, 2, measureOf(ctx))
    lineHeight = 68
  }
  for (const value of lines) {
    text(ctx, value, 72, y, { color: MONO.ink, baseline: 'top' })
    y += lineHeight
  }
  font(ctx, 600, 30, fonts.mono)
  const meta = [
    `${String(model.totalTracks)} TRACKS`,
    ...(model.momentCount > 0 ? [`${String(model.momentCount)} MOMENTS`] : []),
    model.date,
  ].join(' · ')
  text(ctx, meta, 72, y + 12, { color: MONO.accent, baseline: 'top' })
  y += 12 + 36 + 30

  model.sides.forEach((rows, index) => {
    font(ctx, 800, 28, fonts.mono)
    spacing(ctx, 3.4)
    text(ctx, index === 0 ? 'SIDE A' : 'SIDE B', 72, y, { color: MONO.accent, baseline: 'top' })
    spacing(ctx, 0)
    line(ctx, 72, y + 40, 1008, y + 40, MONO.line, 2)
    y += 44
    for (const row of rows) {
      trackRow(ctx, fonts, row, y + 26, {
        left: 72,
        titleLeft: 152,
        right: 1008,
        noFont: [600, 28, fonts.mono],
        titleFont: [600, 40, fonts.sans],
        momentFont: [600, 28, fonts.mono],
        noColor: MONO.dim,
        titleColor: MONO.ink,
        momentColor: MONO.accent,
      })
      y += 52
    }
    y += 14
  })

  monoFooter(ctx, fonts, 1080)
}

/* ------------------------------------------------------------------ *
 * 싱글 — 곡 하나 · Moment (ADR 0043)
 *
 * 곡 이름과 그 곡의 Moment 시점 · 메모 목록만 — 39page 기본 그림을 넣지 않는다. 사용자가 올린 앨범아트가 있으면 그것만
 * 넣는다(ADR 0042). 높이는 내용만큼이다(최소 640, 최대 3,240 — 넘치면 "+N개 더").
 * ------------------------------------------------------------------ */

/** 싱글의 최소 높이 — 곡 이름만 있어도 납작한 띠가 되지 않게. */
const SINGLE_MIN_HEIGHT = 640

interface MomentRow {
  readonly at: string
  readonly lines: readonly string[]
  readonly height: number
}

interface MomentList {
  readonly rows: readonly MomentRow[]
  /** 넣지 못한 Moment 수 ("+N개 더"). */
  readonly more: number
  /** 시점 칸의 폭 — 메모가 같은 자리에서 시작하게. */
  readonly timeWidth: number
  /** 줄들의 높이 합 ("+N개 더" 포함). */
  readonly height: number
}

interface MomentListStyle {
  readonly timeFont: readonly [number, number, string]
  readonly noteFont: readonly [number, number, string]
  readonly label: (at: string) => string
  /** 시점 글자 폭에 더할 여백 (알약이면 좌우 안쪽 여백). */
  readonly timePad: number
  /** 목록 전체 폭. */
  readonly width: number
  /** 메모 한 줄의 높이 · 첫 줄(시점과 같은 줄)의 높이 · 줄 사이. */
  readonly lineHeight: number
  readonly firstRow: number
  readonly gap: number
  readonly more: number
}

/** Moment 줄을 잰다 — 앞에서 `limit` 개, 메모는 네 줄까지. */
function measureMoments(
  ctx: Ctx,
  moments: readonly ShareCardMoment[],
  style: MomentListStyle,
  limit: number,
): MomentList {
  const shown = moments.slice(0, limit)
  font(ctx, ...style.timeFont)
  const timeWidth =
    shown.reduce(
      (widest, moment) => Math.max(widest, ctx.measureText(style.label(moment.at)).width),
      0,
    ) + style.timePad
  font(ctx, ...style.noteFont)
  const noteWidth = style.width - timeWidth - 24
  const rows = shown.map((moment) => {
    const note = moment.note.replace(/\s+/g, ' ').trim()
    const lines = note === '' ? [] : wrapLines(note, noteWidth, 4, measureOf(ctx))
    return {
      at: moment.at,
      lines,
      height: style.firstRow + Math.max(0, lines.length - 1) * style.lineHeight,
    }
  })
  const more = moments.length - shown.length
  const height =
    rows.reduce((sum, row) => sum + row.height, 0) +
    Math.max(0, rows.length - 1) * style.gap +
    (more > 0 ? style.more : 0)
  return { rows, more, timeWidth, height }
}

/** 높이 상한 안에 드는 만큼만 — `fixed` 는 목록 밖의 높이. */
function fitMoments(
  ctx: Ctx,
  moments: readonly ShareCardMoment[],
  style: MomentListStyle,
  fixed: number,
): MomentList {
  let list = measureMoments(ctx, moments, style, moments.length)
  while (list.rows.length > 1 && fixed + list.height > SHARE_CARD_MAX_HEIGHT) {
    list = measureMoments(ctx, moments, style, list.rows.length - 1)
  }
  return list
}

function drawKawaiiSingle(
  ctx: Ctx,
  measureCtx: Ctx,
  fonts: Fonts,
  model: ShareCardModel,
  cover: CardArt | null,
): number {
  const artSize = 400
  const top = 116
  font(measureCtx, 800, 64, fonts.sans)
  const titleLines = wrapLines(model.heading, 940, 3, measureOf(measureCtx))
  const style: MomentListStyle = {
    timeFont: [800, 34, fonts.mono],
    noteFont: [600, 36, fonts.sans],
    label: (at) => `▶ ${at}`,
    timePad: 52,
    width: 888,
    lineHeight: 48,
    firstRow: 62,
    gap: 22,
    more: 52,
  }
  // 그림 · 제목 · (목록) · 재생 표시 · 아래 여백
  const fixed =
    top + 24 + (cover === null ? 0 : artSize + 44) + titleLines.length * 77 + 56 + 88 + 56
  const list = fitMoments(measureCtx, model.moments, style, fixed + 40)
  const content = fixed - top + (list.rows.length === 0 ? 0 : 40 + list.height)
  const height = Math.max(SINGLE_MIN_HEIGHT, top + content)
  ctx.canvas.height = height

  ctx.fillStyle = KAWAII.bg
  ctx.fillRect(0, 0, 1080, height)
  kawaiiStrip(ctx, fonts, model.kind === 'moment' ? 'MOMENT' : 'TRACK', model.date)

  // 내용이 짧으면 남는 자리를 위아래로 나눈다.
  let y = top + 24 + Math.max(0, (height - top - content) / 2)
  if (cover !== null) {
    drawArt(ctx, cover, 540 - artSize / 2, y, artSize, 26, KAWAII.artBox)
    frame(ctx, 540 - artSize / 2, y, artSize, 26, KAWAII.pink, 5)
    y += artSize + 44
  }
  font(ctx, 800, 64, fonts.sans)
  for (const value of titleLines) {
    text(ctx, value, 540, y, { color: KAWAII.mint, align: 'center', baseline: 'top' })
    y += 77
  }
  if (list.rows.length > 0) {
    y += 40
    const noteLeft = 96 + list.timeWidth + 24
    list.rows.forEach((row, index) => {
      if (index > 0) y += style.gap
      font(ctx, ...style.timeFont)
      pill(ctx, style.label(row.at), 96, y + 31, {
        fill: null,
        stroke: KAWAII.pink,
        color: KAWAII.pink,
        height: 62,
        pad: 26,
      })
      font(ctx, ...style.noteFont)
      row.lines.forEach((value, line) => {
        text(ctx, value, noteLeft, y + 31 + line * style.lineHeight, { color: KAWAII.mint })
      })
      y += row.height
    })
    if (list.more > 0) {
      font(ctx, 700, 30, fonts.mono)
      text(ctx, `+${String(list.more)}개 더`, 96, y + 30, { color: KAWAII.pink })
      y += style.more
    }
  }
  playMark(ctx, 540, y + 56 + 44, 44, { fill: KAWAII.pink, color: KAWAII.ink })
  return height
}

function drawMonoSingle(
  ctx: Ctx,
  measureCtx: Ctx,
  fonts: Fonts,
  model: ShareCardModel,
  art: CardArt | null,
): number {
  const artSize = 360
  font(measureCtx, 800, 68, fonts.sans)
  const titleLines = wrapLines(model.heading, 936, 3, measureOf(measureCtx))
  const style: MomentListStyle = {
    timeFont: [700, 34, fonts.mono],
    noteFont: [600, 34, fonts.sans],
    label: (at) => `◆ ${at}`,
    timePad: 0,
    width: 936,
    lineHeight: 46,
    firstRow: 46,
    gap: 18,
    more: 50,
  }
  // 위 글줄 · 제목 · (그림) · (목록) · 아래 여백 · 바닥 줄
  const fixed = 112 + titleLines.length * 78 + (art === null ? 0 : 30 + artSize) + 48 + 112
  const list = fitMoments(measureCtx, model.moments, style, fixed + 36)
  const height = Math.max(
    SINGLE_MIN_HEIGHT,
    fixed + (list.rows.length === 0 ? 0 : 36 + list.height),
  )
  ctx.canvas.height = height

  monoBackground(ctx, height)
  font(ctx, 600, 28, fonts.mono)
  spacing(ctx, 3.9)
  text(ctx, `39PAGE ${model.kind === 'moment' ? 'MOMENT' : 'SINGLE'} · ${model.catalog}`, 72, 64, {
    color: MONO.dim,
    baseline: 'top',
  })
  spacing(ctx, 0)

  let y = 112
  font(ctx, 800, 68, fonts.sans)
  for (const value of titleLines) {
    text(ctx, value, 72, y, { color: MONO.ink, baseline: 'top' })
    y += 78
  }
  // 사용자 그림 — 재킷에서 레코드가 오른쪽으로 비죽 나온 모양.
  if (art !== null) {
    y += 30
    disc(ctx, 72 + artSize * 0.86, y + artSize / 2, artSize * 0.46, 0.33)
    ctx.save()
    ctx.shadowColor = 'rgba(0, 0, 0, 0.45)'
    ctx.shadowBlur = 28
    ctx.shadowOffsetX = 10
    ctx.fillStyle = MONO.ring
    ctx.fillRect(72, y, artSize, artSize)
    ctx.restore()
    drawArt(ctx, art, 72, y, artSize, 4, MONO.ring)
    frame(ctx, 72, y, artSize, 4, MONO.line, 3)
    y += artSize
  }
  if (list.rows.length > 0) {
    y += 36
    const noteLeft = 72 + list.timeWidth + 24
    list.rows.forEach((row, index) => {
      if (index > 0) y += style.gap
      font(ctx, ...style.timeFont)
      text(ctx, style.label(row.at), 72, y + 23, { color: MONO.accent })
      font(ctx, ...style.noteFont)
      row.lines.forEach((value, line) => {
        text(ctx, value, noteLeft, y + 23 + line * style.lineHeight, { color: MONO.ink })
      })
      y += row.height
    })
    if (list.more > 0) {
      font(ctx, 700, 28, fonts.mono)
      text(ctx, `+${String(list.more)}개 더`, 72, y + 28, { color: MONO.dim })
    }
  }

  monoFooter(ctx, fonts, height)
  return height
}

/* ------------------------------------------------------------------ *
 * C. 영수증 — 두 테마, 높이는 곡 수만큼 (최대 3240)
 * ------------------------------------------------------------------ */

function drawReceipt(
  ctx: Ctx,
  fonts: Fonts,
  model: ShareCardModel,
  measureCtx: Ctx,
  art: CardArt | null,
): number {
  const kawaii = model.theme !== 'mono'
  const outer = kawaii ? KAWAII.bg : MONO.bg
  const paper = kawaii ? KAWAII.receipt : MONO.paper
  const ink = kawaii ? KAWAII.bg : MONO.bg
  const moments = model.rows.some((row) => row.moment !== null)

  font(measureCtx, 800, 60, fonts.sans)
  const nameLines = wrapLines(model.heading, 768, 2, measureOf(measureCtx))
  const shown = receiptRowsThatFit(model.rows.length, moments, nameLines.length, art !== null)
  const more = model.rows.length - shown
  const height = receiptHeight({
    rows: shown,
    more: more > 0,
    moments,
    nameLines: nameLines.length,
    art: art !== null,
  })
  ctx.canvas.height = height

  ctx.fillStyle = outer
  ctx.fillRect(0, 0, 1080, height)
  const paperBottom = height - 74
  ctx.fillStyle = paper
  ctx.fillRect(100, 56, 880, paperBottom - 56)
  // 톱니 끝 (18px) — 종이 너비를 톱니 수로 똑같이 나눠 오른쪽 끝을 넘지 않게.
  const teeth = Math.round(880 / 36)
  const tooth = 880 / teeth
  ctx.beginPath()
  for (let index = 0; index < teeth; index += 1) {
    const x = 100 + index * tooth
    ctx.moveTo(x, paperBottom)
    ctx.lineTo(x + tooth / 2, paperBottom + 18)
    ctx.lineTo(x + tooth, paperBottom)
  }
  ctx.fill()

  if (kawaii) {
    ctx.save()
    ctx.translate(862, 122)
    ctx.rotate((8 * Math.PI) / 180)
    font(ctx, 800, 28, fonts.mono)
    pill(ctx, 'MIXTAPE ♥', 0, 0, {
      fill: null,
      stroke: KAWAII.pink,
      color: KAWAII.stamp,
      height: 54,
      pad: 18,
      align: 'center',
    })
    ctx.restore()
  }

  let y = 56 + RECEIPT.paperPadTop
  // 앨범아트 — 영수증 맨 위에 찍힌 사진처럼 가운데 정사각형.
  if (art !== null) {
    drawArt(ctx, art, 540 - RECEIPT.art / 2, y, RECEIPT.art, 8, outer)
    frame(ctx, 540 - RECEIPT.art / 2, y, RECEIPT.art, 8, ink, 3)
    y += RECEIPT.art + RECEIPT.artGap
  }
  font(ctx, 700, 34, fonts.mono)
  spacing(ctx, 5.4)
  text(ctx, '39PAGE', 540, y, { color: ink, align: 'center', baseline: 'top' })
  spacing(ctx, 0)
  y += 34 + 12
  font(ctx, 600, 28, fonts.mono)
  text(ctx, `MIX RECEIPT · ${model.date} ${model.time}`, 540, y, {
    color: ink,
    align: 'center',
    baseline: 'top',
  })
  y += 28 + 14
  font(ctx, 800, 60, fonts.sans)
  for (const value of nameLines) {
    text(ctx, value, 540, y, { color: ink, align: 'center', baseline: 'top' })
    y += 72
  }
  y += 14
  font(ctx, 600, 28, fonts.mono)
  text(ctx, `${String(model.totalTracks)} TRACKS`, 540, y, {
    color: ink,
    align: 'center',
    baseline: 'top',
  })
  y += 28

  const dash = (): void => {
    ctx.save()
    ctx.globalAlpha = 0.55
    line(ctx, 156, y + 24, 924, y + 24, ink, 4, [12, 9])
    ctx.restore()
    y += 48
  }
  dash()

  if (moments) {
    font(ctx, 600, 26, fonts.mono)
    text(ctx, '#', 156, y + 20, { color: ink, alpha: 0.7 })
    text(ctx, 'TITLE', 226, y + 20, { color: ink, alpha: 0.7 })
    text(ctx, '◆', 924, y + 20, { color: ink, alpha: 0.7, align: 'right' })
    y += 40
  }
  for (const row of model.rows.slice(0, shown)) {
    trackRow(ctx, fonts, row, y + 28, {
      left: 156,
      titleLeft: 226,
      right: 924,
      noFont: [600, 30, fonts.mono],
      titleFont: [700, 40, fonts.sans],
      momentFont: [600, 28, fonts.mono],
      noColor: ink,
      titleColor: ink,
      momentColor: ink,
    })
    y += 56
  }
  if (more > 0) {
    font(ctx, 800, 34, fonts.sans)
    text(ctx, `+${String(more)}곡 더 · 총 ${String(model.totalTracks)}곡`, 156, y + 26, {
      color: ink,
    })
    y += 52
  }
  dash()

  font(ctx, 800, 30, fonts.mono)
  text(ctx, 'TOTAL', 156, y + 22, { color: ink })
  text(ctx, `${String(model.totalTracks)} TRACKS`, 924, y + 22, { color: ink, align: 'right' })
  y += 44
  if (moments) {
    text(ctx, 'MOMENTS', 156, y + 22, { color: ink })
    text(ctx, String(model.momentCount), 924, y + 22, { color: ink, align: 'right' })
    y += 44
  }
  dash()

  playMark(ctx, 540, y + 26, 24, { fill: ink, color: paper })
  y += 52
  font(ctx, 600, 28, fonts.mono)
  text(ctx, 'THANK YOU FOR LISTENING ♪', 540, y + 35, { color: ink, align: 'center', alpha: 0.7 })
  return height
}

/* ------------------------------------------------------------------ *
 * 입구
 * ------------------------------------------------------------------ */

/**
 * 모델을 PNG 로 그린다. 캔버스를 쓸 수 없으면 `null`. `artBlob` 은 `model.art` 의 바이트 — 없거나 읽지 못하면 기본 그림으로
 * 그리고 결과의 `art` 가 `false` 다.
 */
export async function renderShareCard(
  model: ShareCardModel,
  artBlob: Blob | null = null,
): Promise<ShareCardImage | null> {
  const canvas = document.createElement('canvas')
  canvas.width = model.width
  canvas.height = model.height ?? 1350
  const ctx = canvas.getContext('2d')
  if (ctx === null) return null

  // 글꼴이 준비되기 전에 그리면 캔버스가 조용히 다른 글꼴로 그린다 (HTML 명세).
  try {
    await document.fonts.ready
  } catch {
    // 글꼴 상태를 알 수 없어도 그린다 — 기본 글꼴은 기기에 있다.
  }
  const fonts = appFonts()
  const image = model.art === null ? null : await decodeArt(artBlob)
  const art = image === null || model.art === null ? null : { image, display: model.art.display }

  let height = canvas.height
  KAWAII =
    model.theme === 'custom' && model.colors !== null
      ? customCardPalette(model.colors)
      : KAWAII_CARD_PALETTE
  try {
    // 영수증 · 싱글은 줄을 먼저 재고 높이를 정한다 — 캔버스 높이를 바꾸면 그리기 상태가 지워지므로 따로 잰다.
    const measureCtx =
      model.template === 'receipt' || model.template === 'single'
        ? document.createElement('canvas').getContext('2d')
        : null
    if (model.template === 'receipt') {
      if (measureCtx === null) return null
      height = drawReceipt(ctx, fonts, model, measureCtx, art)
    } else if (model.template === 'jcard') drawJcard(ctx, fonts, model, art)
    else if (model.template === 'lp') drawLp(ctx, fonts, model, art)
    else {
      if (measureCtx === null) return null
      height =
        model.theme !== 'mono'
          ? drawKawaiiSingle(ctx, measureCtx, fonts, model, art)
          : drawMonoSingle(ctx, measureCtx, fonts, model, art)
    }
  } finally {
    image?.release()
  }

  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob((value) => resolve(value), 'image/png')
  })
  return blob === null ? null : { blob, width: canvas.width, height, art: art !== null }
}
