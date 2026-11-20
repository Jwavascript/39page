/**
 * 공유 카드 그리기 — 브라우저 canvas 2D (ADR 0041). `main.ts` 가 처음 쓸 때 이 파일을 내려받는다.
 *
 * 치수 · 색은 시안(`design/mockups/share-card/`)과 리서치의 하한을 따른다 — 곡 이름 40px · 보조 28–32px · 제목 60–84px,
 * 선 2px 이상, 글자 아래에 도트 무늬를 깔지 않는다. 글꼴은 앱의 기본 글꼴(`--font-body` · `--font-mono`)을 쓴다 —
 * 기기마다 모양이 조금 다를 수 있다 (사용자 결정: 기본 글꼴로 시작).
 *
 * 넣지 않는 것: QR · 링크 안내 문구 · YouTube 썸네일 · YouTube 로고.
 */
import { CASSETTE_DOTS, patternSize } from '@/features/artwork/dotPatterns'

import {
  fitLine,
  receiptHeight,
  receiptRowsThatFit,
  wrapLines,
  type Measure,
  type ShareCardImage,
  type ShareCardModel,
  type ShareCardRow,
} from './shareCard'

const KAWAII = {
  bg: '#10202c',
  mint: '#e2fff6',
  dot: '#a8ffe7',
  pink: '#ff9bc5',
  ink: '#2a1730',
  paper: '#fff4f9',
  receipt: '#dbfff4',
  pinkDark: '#b8326f',
  rowLine: '#f6cfe2',
  dash: '#e98ab6',
  meta: '#8a3a66',
  artBox: '#142c3a',
  stamp: '#d83f87',
} as const

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

/** 아래 "▶ 39page 에서 듣기" (Kawaii 알약). */
function kawaiiListen(
  ctx: Ctx,
  fonts: Fonts,
  x: number,
  centerY: number,
  align: 'left' | 'center',
): void {
  font(ctx, 800, 34, fonts.sans)
  pill(ctx, '▶ 39page 에서 듣기', x, centerY, {
    fill: KAWAII.pink,
    color: KAWAII.ink,
    height: 68,
    pad: 28,
    align,
  })
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
 * A. 카세트 J카드 — Kawaii, 1080 × 1350
 * ------------------------------------------------------------------ */

function drawJcard(ctx: Ctx, fonts: Fonts, model: ShareCardModel): void {
  ctx.fillStyle = KAWAII.bg
  ctx.fillRect(0, 0, 1080, 1350)
  kawaiiStrip(ctx, fonts, 'MIXTAPE', model.date)

  // 펼친 J카드
  roundRect(ctx, 56, 116, 968, 1030, 26)
  ctx.fillStyle = KAWAII.paper
  ctx.fill()
  ctx.save()
  ctx.clip()

  // 앞면 — 제목 두 줄 · 곡 수 · 테이프 릴. 두 줄 제목이 테두리에 붙지 않게 위아래로 30px 넘게 띄운다.
  const frontTop = 116
  const frontHeight = 292
  font(ctx, 800, 80, fonts.sans)
  const titleLines = wrapLines(model.heading, 658, 2, measureOf(ctx))
  const block = titleLines.length * 90 + 10 + 38
  let y = frontTop + (frontHeight - block) / 2
  for (const value of titleLines) {
    text(ctx, value, 96, y, { color: KAWAII.ink, baseline: 'top' })
    y += 90
  }
  font(ctx, 700, 32, fonts.mono)
  const meta = `${String(model.totalTracks)} TRACKS${model.momentCount > 0 ? ` · MOMENT ${String(model.momentCount)}` : ''}`
  text(ctx, meta, 96, y + 10, { color: KAWAII.meta, baseline: 'top' })

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

  // 아래 — 듣기 · 곡 수 · 주소
  kawaiiListen(ctx, fonts, 56, 1248, 'left')
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
  font(ctx, 700, 30, fonts.sans)
  text(ctx, '▶ 39page 에서 듣기', 1008, top + 46, { color: MONO.accent, align: 'right' })
}

function drawLp(ctx: Ctx, fonts: Fonts, model: ShareCardModel): void {
  monoBackground(ctx, 1080)
  disc(ctx, 1015, 65, 235)

  font(ctx, 600, 28, fonts.mono)
  spacing(ctx, 3.9)
  text(ctx, `39PAGE RECORDS · ${model.catalog}`, 72, 64, { color: MONO.dim, baseline: 'top' })
  spacing(ctx, 0)

  // 제목 — 72px 한 줄에 들어가면 그대로, 아니면 60px 두 줄
  let y = 112
  font(ctx, 800, 72, fonts.sans)
  let lines = [model.heading]
  let lineHeight = 82
  if (ctx.measureText(model.heading).width > 700) {
    font(ctx, 800, 60, fonts.sans)
    lines = wrapLines(model.heading, 700, 2, measureOf(ctx))
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
 * 싱글 — 곡 하나 · Moment
 * ------------------------------------------------------------------ */

function drawKawaiiSingle(ctx: Ctx, fonts: Fonts, model: ShareCardModel): void {
  ctx.fillStyle = KAWAII.bg
  ctx.fillRect(0, 0, 1080, 1350)
  kawaiiStrip(ctx, fonts, model.moment === null ? 'TRACK' : 'MOMENT', model.date)

  // 줄을 먼저 재고 그림 · 제목 · 시점 · 메모 · 듣기를 한 덩어리로 세로 가운데에 둔다 — 시점 · 메모가 없는 곡 카드도
  // 제목과 단추 사이가 비어 보이지 않게.
  const art = 560
  font(ctx, 800, 64, fonts.sans)
  const titleLines = wrapLines(model.heading, 940, 2, measureOf(ctx))
  const note = model.moment?.note.replace(/\s+/g, ' ').trim() ?? ''
  font(ctx, 600, 36, fonts.sans)
  const noteLines = note === '' ? [] : wrapLines(`“${note}”`, 900, 2, measureOf(ctx))
  const momentHeight =
    model.moment === null ? 0 : 24 + 62 + (noteLines.length === 0 ? 0 : 24 + noteLines.length * 50)
  const groupHeight = art + 40 + titleLines.length * 77 + momentHeight + 56 + 68
  const areaTop = 116
  const areaBottom = 1350 - 56
  let y = areaTop + Math.max(0, (areaBottom - areaTop - groupHeight) / 2)

  // 앨범아트 자리 — 39page 기본 그림(도트 카세트). 썸네일을 쓰지 않는다.
  roundRect(ctx, 260, y, art, art, 26)
  ctx.fillStyle = KAWAII.artBox
  ctx.fill()
  ctx.strokeStyle = KAWAII.pink
  ctx.lineWidth = 5
  ctx.stroke()
  const { columns, rows } = patternSize(CASSETTE_DOTS)
  const cell = 30
  const left = 540 - (columns * cell) / 2
  const top = y + art / 2 - (rows * cell) / 2
  CASSETTE_DOTS.forEach((pattern, row) => {
    for (let column = 0; column < columns; column += 1) {
      const on = pattern[column] === '1'
      ctx.beginPath()
      ctx.arc(left + column * cell + cell / 2, top + row * cell + cell / 2, 11, 0, Math.PI * 2)
      ctx.fillStyle = on ? KAWAII.dot : 'rgba(168, 255, 231, 0.16)'
      ctx.fill()
    }
  })

  y += art + 40
  font(ctx, 800, 64, fonts.sans)
  for (const value of titleLines) {
    text(ctx, value, 540, y, { color: KAWAII.mint, align: 'center', baseline: 'top' })
    y += 77
  }
  if (model.moment !== null) {
    y += 24
    font(ctx, 800, 36, fonts.mono)
    pill(ctx, `▶ ${model.moment.at} 부터`, 540, y + 31, {
      fill: null,
      stroke: KAWAII.pink,
      color: KAWAII.pink,
      height: 62,
      pad: 26,
      align: 'center',
    })
    y += 62
    if (noteLines.length > 0) {
      y += 24
      font(ctx, 600, 36, fonts.sans)
      for (const value of noteLines) {
        text(ctx, value, 540, y, { color: KAWAII.mint, align: 'center', baseline: 'top' })
        y += 50
      }
    }
  }
  kawaiiListen(ctx, fonts, 540, y + 56 + 34, 'center')
}

function drawMonoSingle(ctx: Ctx, fonts: Fonts, model: ShareCardModel): void {
  monoBackground(ctx, 1080)
  font(ctx, 600, 28, fonts.mono)
  spacing(ctx, 3.9)
  text(ctx, `39PAGE SINGLE · ${model.catalog}`, 72, 64, { color: MONO.dim, baseline: 'top' })
  spacing(ctx, 0)

  let y = 112
  font(ctx, 800, 68, fonts.sans)
  for (const value of wrapLines(model.heading, 936, 2, measureOf(ctx))) {
    text(ctx, value, 72, y, { color: MONO.ink, baseline: 'top' })
    y += 78
  }
  if (model.moment !== null) {
    y += 10
    font(ctx, 700, 34, fonts.mono)
    text(ctx, `◆ ${model.moment.at} 부터`, 72, y, { color: MONO.accent, baseline: 'top' })
    y += 48
    const note = model.moment.note.replace(/\s+/g, ' ').trim()
    if (note !== '') {
      font(ctx, 600, 34, fonts.sans)
      for (const value of wrapLines(`“${note}”`, 936, 2, measureOf(ctx))) {
        text(ctx, value, 72, y, { color: MONO.ink, baseline: 'top' })
        y += 46
      }
    }
  }

  // 레코드 — 남은 자리 가운데 (39page 의 Mono 기본 그림과 같은 LP)
  const areaTop = y + 30
  const areaBottom = 1080 - 112 - 30
  const radius = Math.max(120, Math.min(260, (areaBottom - areaTop) / 2))
  disc(ctx, 540, (areaTop + areaBottom) / 2, radius, 0.33)

  monoFooter(ctx, fonts, 1080)
}

/* ------------------------------------------------------------------ *
 * C. 영수증 — 두 테마, 높이는 곡 수만큼 (최대 3240)
 * ------------------------------------------------------------------ */

function drawReceipt(ctx: Ctx, fonts: Fonts, model: ShareCardModel, measureCtx: Ctx): number {
  const kawaii = model.theme === 'kawaii'
  const outer = kawaii ? KAWAII.bg : MONO.bg
  const paper = kawaii ? KAWAII.receipt : MONO.paper
  const ink = kawaii ? KAWAII.bg : MONO.bg
  const moments = model.rows.some((row) => row.moment !== null)

  font(measureCtx, 800, 60, fonts.sans)
  const nameLines = wrapLines(model.heading, 768, 2, measureOf(measureCtx))
  const shown = receiptRowsThatFit(model.rows.length, moments, nameLines.length)
  const more = model.rows.length - shown
  const height = receiptHeight({
    rows: shown,
    more: more > 0,
    moments,
    nameLines: nameLines.length,
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

  let y = 56 + 50
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

  font(ctx, 800, 36, fonts.sans)
  text(ctx, '▶ 39page 에서 듣기', 540, y + 26, { color: ink, align: 'center' })
  y += 52
  font(ctx, 600, 28, fonts.mono)
  text(ctx, 'THANK YOU FOR LISTENING ♪', 540, y + 35, { color: ink, align: 'center', alpha: 0.7 })
  return height
}

/* ------------------------------------------------------------------ *
 * 입구
 * ------------------------------------------------------------------ */

/** 모델을 PNG 로 그린다. 캔버스를 쓸 수 없으면 `null`. */
export async function renderShareCard(model: ShareCardModel): Promise<ShareCardImage | null> {
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

  let height = canvas.height
  if (model.template === 'receipt') {
    const measureCanvas = document.createElement('canvas')
    const measureCtx = measureCanvas.getContext('2d')
    if (measureCtx === null) return null
    height = drawReceipt(ctx, fonts, model, measureCtx)
  } else if (model.template === 'jcard') drawJcard(ctx, fonts, model)
  else if (model.template === 'lp') drawLp(ctx, fonts, model)
  else if (model.theme === 'kawaii') drawKawaiiSingle(ctx, fonts, model)
  else drawMonoSingle(ctx, fonts, model)

  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob((value) => resolve(value), 'image/png')
  })
  return blob === null ? null : { blob, width: canvas.width, height }
}
