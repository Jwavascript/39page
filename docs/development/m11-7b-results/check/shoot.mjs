// M11-7B — 로컬 빌드를 격리 프로필 Chrome 으로 열어 화면을 찍고 배치 수치를 잰다. 외부 요청(YouTube · 날씨)은 막는다.
//   POC_CHROME=<chrome> WEB_DIST=<dist> OUT=<dir> REPO_INT=<extension/integration> [ONLY=substr] node shoot.mjs
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const INT = 'file:///' + process.env.REPO_INT.split(String.fromCharCode(92)).join('/')
const { launch, BASE, sleep, waitFor } = await import(INT + '/harness.mjs')
const OUT = process.env.OUT
mkdirSync(OUT, { recursive: true })

const now = '2026-11-14T03:00:00.000Z'
const vids = [
  'dQw4w9WgXcQ',
  'M7lc1UVf-VE',
  'aqz-KE-bpKQ',
  'jNQXAC9IVRw',
  'kJQP7kiw5Fk',
  '9bZkp7q19f0',
  'OPf0YbXqDm0',
  'fJ9rUzIMcZQ',
  'hTWKbfoikeg',
  'YQHsXMglC9A',
  'L_jWHffIx5E',
]
const titles = [
  'Never Gonna Give You Up',
  'YouTube Developers Live: Embedded Web Player Customization',
  'Big Buck Bunny 60fps 4K — Official Blender Foundation Short Film (아주 긴 제목)',
  'Me at the zoo',
  'Despacito',
  'GANGNAM STYLE',
  'Uptown Funk',
  'Bohemian Rhapsody',
  'Smells Like Teen Spirit',
  'Hello',
  'Numb',
]
const NAMES = [
  'MY RECORDS',
  '새벽 드라이브',
  '작업할 때',
  '비 오는 날 — 창가에서 듣는 아주 긴 이름의 플레이리스트',
  'City Pop',
  '운동',
  'Lo-fi',
  '재즈 피아노',
  '2000s',
  '여행',
  '잠들기 전',
]
function library(listCount, firstTracks) {
  let n = 0
  const playlists = Array.from({ length: listCount }, (_, i) => ({
    id: `p${i}`,
    name: NAMES[i] ?? `믹스 ${i}`,
    tracks: Array.from({ length: i === 0 ? firstTracks : 1 + (i % 3) }, (_, k) => {
      n += 1
      const v = (i + k) % vids.length
      return { id: `t${n}`, source: 'youtube', videoId: vids[v], title: titles[v] }
    }),
  }))
  return { version: 1, data: { playlists, selectedPlaylistId: 'p0' } }
}
const moments = [
  [0, 43, '후렴 직전'],
  [0, 112, '브릿지'],
  [0, 151, ''],
  [0, 30, '인트로 끝'],
  [1, 12, ''],
].map(([v, at, note], i) => ({
  id: `m${i}`,
  source: 'youtube',
  videoId: vids[v],
  atSeconds: at,
  note,
  title: titles[v],
  createdAt: now,
  updatedAt: now,
}))

const h = await launch({
  chrome: process.env.POC_CHROME,
  webDist: process.env.WEB_DIST,
  headful: false,
})
const report = []
try {
  const page = await h.tab('about:blank')
  const send = (m, p) => h.cdp.send(m, p, page.session)
  await send('Network.enable', {})
  await send('Network.setBlockedURLs', {
    urls: ['*youtube*', '*ytimg*', '*googlevideo*', '*open-meteo*', '*doubleclick*', '*google*'],
  })
  const ev = (e) => page.ev(e)
  const go = async ({ w, h: hh, theme, lists = 11, tracks = 6, mobile = false }) => {
    await send('Emulation.setDeviceMetricsOverride', {
      width: w,
      height: hh,
      deviceScaleFactor: 1,
      mobile,
    })
    await send('Page.navigate', { url: BASE + '/' })
    await sleep(600)
    const seed = {
      '39page.library': JSON.stringify(library(lists, tracks)),
      '39page.moments': JSON.stringify({ version: 1, data: moments }),
    }
    if (theme) seed['39page.theme'] = JSON.stringify({ version: 1, data: theme })
    await ev(
      `(() => { localStorage.clear(); const s = ${JSON.stringify(seed)}; for (const k in s) localStorage.setItem(k, s[k]); return true })()`,
    )
    await send('Page.reload', {})
    await waitFor(() => ev(`!!document.querySelector('[data-widget="player"]')`), { label: 'app' })
    await sleep(900)
  }
  const shot = async (name, full = false) => {
    const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: full })
    writeFileSync(path.join(OUT, `${name}.png`), Buffer.from(r.data, 'base64'))
  }
  const clickText = (text, scope = 'document') =>
    ev(
      `(() => { const el = [...${scope}.querySelectorAll('button')].find((b) => b.offsetParent !== null && b.textContent.replace(/\\s+/g, ' ').includes(${JSON.stringify(text)})); if (!el) return false; el.click(); return true })()`,
    )
  const measure = () =>
    ev(`(() => {
    const rect = (sel) => { const el = document.querySelector(sel); if (!el) return null; const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } }
    const small = [...document.querySelectorAll('button, a')].filter((b) => b.offsetParent !== null && !b.classList.contains('deck-key') && !b.classList.contains('deck-open')).map((b) => ({ r: b.getBoundingClientRect(), t: (b.getAttribute('aria-label') || b.textContent).trim().slice(0, 24) })).filter((x) => x.r.width > 0 && (x.r.width < 43.5 || x.r.height < 43.5)).map((x) => x.t + ' ' + Math.round(x.r.width) + 'x' + Math.round(x.r.height))
    const holder = document.querySelector('.video-holder')
    const hr = holder.getBoundingClientRect()
    const cx = hr.x + hr.width / 2, cy = hr.y + hr.height / 2
    const top = document.elementFromPoint(cx, cy)
    return {
      theme: document.documentElement.dataset.theme,
      overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      header: rect('.app-header') ?? rect('header'),
      navTexts: [...document.querySelectorAll('.app-nav button, .theme-button')].map((b) => b.textContent.trim() + ' ' + Math.round(b.getBoundingClientRect().width) + 'x' + Math.round(b.getBoundingClientRect().height)),
      video: rect('.video-holder'), videoTopElement: top ? (holder.contains(top) ? 'video' : top.className) : null,
      deck: rect('[data-widget="deck"]'), queue: rect('[data-widget="playlist"]'), moments: rect('[data-widget="moments"]'), archive: rect('#archive-panel'),
      small,
      scrollY: Math.round(window.scrollY), docH: document.documentElement.scrollHeight,
    }
  })()`)
  const only = process.env.ONLY
  const run = async (name, opts, steps) => {
    if (only && !name.includes(only)) return
    await go(opts)
    if (steps) await steps()
    await shot(name)
    if (opts.full) await shot(name + '-full', true)
    report.push({ name, ...(await measure()) })
  }

  await run('dash-kawaii-1321', { w: 1321, h: 761, theme: null, full: true })
  await run('dash-mono-1321', { w: 1321, h: 761, theme: 'mono-vinyl' })
  await run('dash-kawaii-1440', { w: 1440, h: 900, theme: null, full: true })
  await run('dash-kawaii-1024', { w: 1024, h: 768, theme: null, full: true })
  await run('dash-kawaii-768', { w: 768, h: 1024, theme: null, full: true })
  await run('dash-kawaii-390', { w: 390, h: 844, theme: null, mobile: true, full: true })
  await run('dash-mono-360', { w: 360, h: 740, theme: 'mono-vinyl', mobile: true, full: true })
  await run('dash-kawaii-320', { w: 320, h: 640, theme: null, mobile: true, full: true })
  await run('dash-kawaii-844x390', { w: 844, h: 390, theme: null, mobile: true, full: true })
  await run('dash-30tracks-1321', { w: 1321, h: 761, theme: null, tracks: 30 })
  await run('dash-picker-1321', { w: 1321, h: 761, theme: null, lists: 50 }, async () => {
    await clickText('목록 바꾸기')
    await sleep(300)
  })
  await run('arch-music-kawaii-1321', { w: 1321, h: 761, theme: null }, async () => {
    await clickText('보관함')
    await sleep(700)
  })
  await run('arch-music-mono-1440', { w: 1440, h: 900, theme: 'mono-vinyl' }, async () => {
    await clickText('보관함')
    await sleep(700)
  })
  await run(
    'arch-music-50-1321',
    { w: 1321, h: 761, theme: null, lists: 50, tracks: 30 },
    async () => {
      await clickText('보관함')
      await sleep(700)
    },
  )
  await run('arch-music-1024', { w: 1024, h: 768, theme: null }, async () => {
    await clickText('보관함')
    await sleep(700)
  })
  await run('arch-music-1280x620', { w: 1280, h: 620, theme: null }, async () => {
    await clickText('보관함')
    await sleep(700)
  })
  await run('arch-moments-1321', { w: 1321, h: 761, theme: null }, async () => {
    await clickText('보관함')
    await sleep(500)
    await ev(`document.getElementById('archive-tab-moments').click(); true`)
    await sleep(600)
  })
  await run('arch-music-390-list', { w: 390, h: 844, theme: null, mobile: true }, async () => {
    await clickText('보관함')
    await sleep(800)
  })
  await run('arch-music-390-detail', { w: 390, h: 844, theme: null, mobile: true }, async () => {
    await clickText('보관함')
    await sleep(700)
    await ev(`document.querySelectorAll('.archive-lists .list-select')[1]?.click(); true`)
    await sleep(600)
  })
  await run(
    'arch-music-360-mono',
    { w: 360, h: 740, theme: 'mono-vinyl', mobile: true },
    async () => {
      await clickText('보관함')
      await sleep(800)
    },
  )
  await run('arch-music-320', { w: 320, h: 640, theme: null, mobile: true }, async () => {
    await clickText('보관함')
    await sleep(800)
  })
  await run('arch-music-768', { w: 768, h: 1024, theme: null, mobile: true }, async () => {
    await clickText('보관함')
    await sleep(800)
  })
  await run('arch-music-844x390', { w: 844, h: 390, theme: null, mobile: true }, async () => {
    await clickText('보관함')
    await sleep(800)
  })

  writeFileSync(path.join(OUT, 'layout.json'), JSON.stringify(report, null, 2))
  for (const r of report)
    console.log(
      r.name,
      'ovf',
      r.overflowX,
      'video',
      JSON.stringify(r.video),
      r.videoTopElement,
      'arch',
      JSON.stringify(r.archive),
      'small',
      r.small.length ? r.small.join(' | ') : 0,
    )
} finally {
  h.cdp.close()
  h.kill()
}
