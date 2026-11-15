// M12-2 — Now Playing 카드 배치. 실제 Chrome · 실제 YouTube, 격리 임시 프로필, 로컬 빌드.
// 영상 바로 아래에 카드가 붙는지, 영상을 덮지 않고 202px 이상인지, 가로 넘침이 없는지, 테마 · 보관함 · 크기를 바꿔도
// 같은 iframe 이 계속 재생하는지 두 테마 · 여러 폭에서 본다. 스크린샷을 OUT 에 남긴다.
//   POC_CHROME=<chrome> WEB_DIST=<dist> OUT=<dir> REPO_INT=<extension/integration> node layout.mjs
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const INT = 'file:///' + process.env.REPO_INT.split(String.fromCharCode(92)).join('/')
const { launch, BASE, sleep, waitFor } = await import(INT + '/harness.mjs')
const OUT = process.env.OUT
mkdirSync(OUT, { recursive: true })

const h = await launch({
  chrome: process.env.POC_CHROME,
  webDist: process.env.WEB_DIST,
  headful: false,
})
const results = []
try {
  const page = await h.tab('about:blank')
  const send = (m, p) => h.cdp.send(m, p, page.session)
  const ev = (e) => page.ev(e)
  await send('Network.enable', {})
  await send('Network.setBlockedURLs', { urls: ['*open-meteo*'] })
  const size = (width, height, mobile, scale = 1) =>
    send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: scale, mobile })
  const video = async () => {
    const t = (await h.cdp.targets()).find(
      (x) => x.type === 'iframe' && x.url.includes('youtube.com/embed'),
    )
    if (!t) return null
    const s = await h.cdp.attach(t.targetId)
    try {
      const r = await h.cdp.send(
        'Runtime.evaluate',
        {
          expression: `(() => { const v = document.querySelector('video'); return v ? { t: v.currentTime, paused: v.paused } : null })()`,
          returnByValue: true,
        },
        s,
      )
      return r.result.value
    } finally {
      await h.cdp.send('Target.detachFromTarget', { sessionId: s }).catch(() => {})
    }
  }
  const click = async (sel) => {
    const p = await ev(
      `(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })()`,
    )
    for (const type of ['mousePressed', 'mouseReleased'])
      await send('Input.dispatchMouseEvent', {
        type,
        x: p.x,
        y: p.y,
        button: 'left',
        clickCount: 1,
      })
    await sleep(500)
  }

  await size(1440, 900, false)
  await send('Page.navigate', { url: BASE + '/' })
  await waitFor(() => ev(`!!document.querySelector('[data-widget="player"]')`), { label: 'app' })
  const now = new Date().toISOString()
  const library = {
    version: 1,
    data: {
      playlists: [
        {
          id: 'p',
          name: 'M12 LAYOUT',
          tracks: [
            {
              id: 't1',
              source: 'youtube',
              videoId: 'aqz-KE-bpKQ',
              title: 'Big Buck Bunny 60fps 4K - Official Blender Foundation Short Film',
            },
            { id: 't2', source: 'youtube', videoId: 'eRsGyueVLvQ', title: 'Sintel' },
            { id: 't3', source: 'youtube', videoId: 'R6MlUcmOul8', title: 'Tears of Steel' },
          ],
        },
      ],
      selectedPlaylistId: 'p',
    },
  }
  const moments = {
    version: 1,
    data: [5, 40, 90, 120, 200, 260].map((at, i) => ({
      id: `m${String(i)}`,
      source: 'youtube',
      videoId: 'aqz-KE-bpKQ',
      atSeconds: at,
      note: `메모 ${String(i)}`,
      title: 'Big Buck Bunny',
      createdAt: now,
      updatedAt: now,
    })),
  }
  await ev(
    `localStorage.setItem('39page.library', ${JSON.stringify(JSON.stringify(library))}); localStorage.setItem('39page.moments', ${JSON.stringify(JSON.stringify(moments))}); true`,
  )
  await send('Page.reload', {})
  await waitFor(() => ev(`!!document.querySelector('.now-playlist .track-row')`), {
    label: 'reload',
  })
  await click('.now-playlist .track-row')
  await waitFor(async () => (await video())?.paused === false, {
    timeout: 30_000,
    label: 'playing',
  })
  // 상태 줄 기록 — 가시성 가드가 멈추고 안내를 지우는 일을 놓치지 않는다.
  await ev(
    `(() => { window.__statusLog = []; const el = document.querySelector('.now-playing-card .status'); new MutationObserver(() => window.__statusLog.push([Math.round(performance.now()), el.textContent.trim(), innerWidth + 'x' + innerHeight, Math.round(scrollY)])).observe(el, { childList: true, characterData: true, subtree: true }); return true })()`,
  )
  const marker = await ev(
    `(() => { const f = document.querySelector('.player-mount iframe'); f.__m12 = Math.random(); return f.__m12 })()`,
  )

  const measure = () =>
    ev(`(() => {
      const box = (sel) => { const el = document.querySelector(sel); if (!el || el.offsetParent === null) return null; const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y + scrollY), r: Math.round(r.right), b: Math.round(r.bottom + scrollY), w: Math.round(r.width), h: Math.round(r.height) } }
      const hit = (a, b) => a && b && a.x < b.r - 1 && b.x < a.r - 1 && a.y < b.b - 1 && b.y < a.b - 1
      const v = box('.video-holder'), card = box('.now-playing-card'), art = box('.now-playing-card .np-art')
      const others = ['deck', 'clock', 'weather', 'moments', 'playlist'].map((n) => [n, box('[data-widget="' + n + '"]')])
      return {
        layout: document.querySelector('.workspace').dataset.archiveLayout ?? 'dashboard',
        video: v, card, art, others: Object.fromEntries(others),
        gapVideoCard: v && card ? card.y - v.b : null,
        cardRightOfVideo: v && card ? card.x >= v.r - 1 : null,
        status: document.querySelector('.now-playing-card .status')?.textContent.trim() ?? null,
        overlaps: [card, ...others.map((o) => o[1])].filter((o) => hit(v, o)).length,
        // 곡 제목 · 재생 조작은 화면에 한 번만, 그리고 영상 **위**에는 없다 (M12-2 — 카드로 옮겼다).
        titleInVideoColumnAbove: (() => {
          const shown = [...document.querySelectorAll('.now-title, .action-row')].filter((el) => el.offsetParent !== null)
          const vr = document.querySelector('.video-holder').getBoundingClientRect()
          const titles = shown.filter((el) => el.classList.contains('now-title')).length
          return titles !== 1 || shown.some((el) => el.getBoundingClientRect().bottom <= vr.top + 1)
        })(),
        statusLog: window.__statusLog ?? [],
        artSource: document.querySelector('.now-playing-card [data-artwork-source]')?.dataset.artworkSource ?? null,
        overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        marker: document.querySelector('.player-mount iframe').__m12,
      }
    })()`)

  const sizes = [
    [1440, 900, false, '1440'],
    [1280, 800, false, '1280'],
    [1024, 768, false, '1024'],
    [768, 1024, true, '768'],
    [844, 390, true, '844x390'],
    [390, 844, true, '390'],
    [360, 740, true, '360'],
    [320, 640, true, '320'],
    [720, 450, false, '200pct'],
  ]
  const only = process.env.ONLY ? process.env.ONLY.split(',') : null
  for (const theme of process.env.THEMES
    ? process.env.THEMES.split(',')
    : ['SYNTH CASSETTE', 'MONO VINYL']) {
    await ev(
      `[...document.querySelectorAll('.theme-button')].find((b) => b.textContent.includes(${JSON.stringify(theme)})).click(); true`,
    )
    await sleep(400)
    const t = theme === 'MONO VINYL' ? 'mono' : 'cassette'
    for (const [w, hh, mobile, label] of sizes.filter(
      (x) => only === null || only.includes(x[3]),
    )) {
      for (const archive of [false, true]) {
        const name = `${t}-${label}${archive ? '-archive' : ''}`
        try {
          await size(w, hh, mobile, label === '200pct' ? 2 : 1)
          await sleep(500)
          await ev(`window.scrollTo(0, 0); true`)
          if (archive) await click('.app-nav button')
          else await sleep(300)
          await sleep(500)
          const m = await measure()
          // 화면(뷰포트)만 찍는다 — captureBeyondViewport 는 뷰포트를 잠깐 4×4 로 바꿔 가시성 가드가 멈춘다 (하네스 결함).
          const shot = await send('Page.captureScreenshot', { format: 'png' })
          writeFileSync(path.join(OUT, `${name}.png`), Buffer.from(shot.data, 'base64'))
          const v1 = await video()
          if (archive) {
            await ev(
              `document.querySelector('.strip-close:not([hidden])')?.click() ?? document.querySelector('#archive-panel .archive-head .close')?.click(); true`,
            )
            await sleep(500)
          }
          await sleep(800)
          const v2 = await video()
          const pass =
            m.marker === marker &&
            m.video !== null &&
            m.video.w >= 202 &&
            m.video.h >= 202 &&
            m.card !== null &&
            (m.layout === 'strip'
              ? m.cardRightOfVideo
              : m.gapVideoCard !== null && m.gapVideoCard >= 0 && m.gapVideoCard <= 24) &&
            m.overlaps === 0 &&
            !m.titleInVideoColumnAbove &&
            m.overflowX === 0 &&
            v2 !== null &&
            !v2.paused &&
            v2.t > v1.t
          results.push({ name, pass, m, v1, v2 })
          console.log(
            pass ? 'PASS' : 'FAIL',
            name,
            JSON.stringify({
              v1,
              v2,
              status: m.status,
              log: m.statusLog.slice(-4),
              gap: m.gapVideoCard,
              video: m.video,
              card: m.card,
              art: m.art,
              layout: m.layout,
              src: m.artSource,
              ov: m.overlaps,
              ox: m.overflowX,
              others: m.others,
            }),
          )
        } catch (error) {
          results.push({ name, pass: false, error: String(error) })
          console.log('FAIL', name, String(error))
        }
      }
    }
  }
  writeFileSync(
    path.join(OUT, 'layout.json'),
    JSON.stringify({ browser: h.cdp.version, results }, null, 2),
  )
  console.log(`${String(results.filter((r) => r.pass).length)}/${String(results.length)} PASS`)
} finally {
  h.cdp.close()
  h.kill()
}
