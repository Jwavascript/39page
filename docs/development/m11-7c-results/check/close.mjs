// M11-7C UAT 후속 — 보관함 닫기 자리. 실제 Chrome · 실제 YouTube, 격리 임시 프로필, 로컬 빌드.
// 가로(띠) 배치에서 "보관함 닫기" 가 영상 띠 오른쪽 위에 있고 영상 · 조작 · 이 곡의 Moments 를 덮지 않는지,
// 눌러 닫아도 같은 iframe 이 계속 재생하는지, 세로 · 낮은 가로 배치는 머리말 × 그대로인지 두 테마로 본다.
//   POC_CHROME=<chrome> WEB_DIST=<dist> OUT=<dir> REPO_INT=<extension/integration> node close.mjs
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
  const size = (width, height, mobile) =>
    send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile })
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
  const clickAt = async (sel) => {
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
    await sleep(600)
  }

  await size(1440, 900, false)
  await send('Page.navigate', { url: BASE + '/' })
  await waitFor(() => ev(`!!document.querySelector('[data-widget="player"]')`), { label: 'app' })
  // 격리 프로필에 시험용 목록 하나 — 이 곡의 Moments 3개.
  const now = new Date().toISOString()
  const library = {
    version: 1,
    data: {
      playlists: [
        {
          id: 'p',
          name: 'CLOSE',
          tracks: [
            { id: 't1', source: 'youtube', videoId: 'aqz-KE-bpKQ', title: 'Big Buck Bunny' },
          ],
        },
      ],
      selectedPlaylistId: 'p',
    },
  }
  const moments = {
    version: 1,
    data: [5, 40, 90].map((at, i) => ({
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
  await clickAt('.now-playlist .track-row')
  await waitFor(async () => (await video())?.paused === false, {
    timeout: 30_000,
    label: 'playing',
  })
  const marker = await ev(
    `(() => { const f = document.querySelector('.player-mount iframe'); f.__close = Math.random(); return f.__close })()`,
  )

  const measure = () =>
    ev(`(() => {
      const rect = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, r: r.right, b: r.bottom, w: Math.round(r.width), h: Math.round(r.height) } }
      const hit = (a, b) => a && b && a.x < b.r && b.x < a.r && a.y < b.b && b.y < a.b
      const btn = document.querySelector('.strip-close')
      const shown = btn && !btn.hidden && getComputedStyle(btn).display !== 'none'
      const b = shown ? rect(btn) : null
      const guarded = [...document.querySelectorAll('[data-widget="moments"] .widget-head, [data-widget="moments"] .moment-row, .player-surface button, .player-mount iframe, .player-surface .now-title, #archive-panel .tab')]
        .filter((el) => el.offsetParent !== null).map(rect)
      const strip = rect(document.querySelector('.widget-host'))
      return {
        layout: document.querySelector('.workspace').dataset.archiveLayout ?? null,
        stripClose: b,
        headClose: !!document.querySelector('#archive-panel .archive-head .close'),
        overlaps: b ? guarded.filter((g) => hit(b, g)).length : 0,
        rightAligned: b && strip ? Math.abs(b.r - strip.r) <= 2 : null,
        aboveStrip: b && strip ? b.b <= strip.y + 1 : null,
        inView: b ? b.y >= 0 && b.b <= innerHeight : null,
        text: btn ? btn.textContent.split(/\\s+/).join(' ').trim() : null,
        overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        marker: document.querySelector('.player-mount iframe').__close,
      }
    })()`)

  for (const theme of ['SYNTH CASSETTE', 'MONO VINYL']) {
    await ev(
      `[...document.querySelectorAll('.theme-button')].find((b) => b.textContent.includes(${JSON.stringify(theme)})).click(); true`,
    )
    await sleep(400)
    for (const [w, hh, mobile, label] of [
      [1440, 900, false, '1440'],
      [1024, 768, false, '1024'],
      [844, 390, true, '844x390'],
      [390, 844, true, '390'],
      [360, 740, true, '360'],
      [320, 640, true, '320'],
    ]) {
      const name = `${theme === 'MONO VINYL' ? 'mono' : 'cassette'}-${label}`
      try {
        await size(w, hh, mobile)
        await sleep(600)
        await ev(`window.scrollTo(0, 0); true`)
        await clickAt('.app-nav button')
        await sleep(600)
        const m = await measure()
        const shot = await send('Page.captureScreenshot', { format: 'png' })
        writeFileSync(path.join(OUT, `${name}.png`), Buffer.from(shot.data, 'base64'))
        const v1 = await video()
        // 닫기 — 띠면 새 단추, 아니면 머리말 ×. 실제 마우스 누름.
        await clickAt(m.layout === 'strip' ? '.strip-close' : '#archive-panel .archive-head .close')
        const closed = await ev(`document.getElementById('archive-panel').hidden`)
        const after = await ev(`document.querySelector('.player-mount iframe').__close`)
        await sleep(1500)
        const v2 = await video()
        const strip = m.layout === 'strip'
        const pass =
          closed &&
          after === marker &&
          m.marker === marker &&
          v2 !== null &&
          !v2.paused &&
          v2.t > v1.t &&
          m.overflowX === 0 &&
          (strip
            ? m.stripClose !== null &&
              m.stripClose.h >= 44 &&
              m.stripClose.w >= 44 &&
              m.overlaps === 0 &&
              m.rightAligned &&
              m.aboveStrip &&
              m.inView &&
              !m.headClose &&
              m.text === '보관함 닫기 ×'
            : m.stripClose === null && m.headClose)
        results.push({ name, pass, m, v1, v2 })
        console.log(pass ? 'PASS' : 'FAIL', name, JSON.stringify(m))
      } catch (error) {
        results.push({ name, pass: false, error: String(error) })
        console.log('FAIL', name, String(error))
      }
    }
  }

  // Esc — 띠 배치
  await size(1440, 900, false)
  await sleep(500)
  await clickAt('.app-nav button')
  for (const type of ['keyDown', 'keyUp'])
    await send('Input.dispatchKeyEvent', {
      type,
      key: 'Escape',
      code: 'Escape',
      windowsVirtualKeyCode: 27,
    })
  await sleep(500)
  const esc = await ev(`document.getElementById('archive-panel').hidden`)
  results.push({ name: 'Esc 닫기 (띠)', pass: esc })
  console.log(esc ? 'PASS' : 'FAIL', 'Esc 닫기 (띠)')

  writeFileSync(
    path.join(OUT, 'close.json'),
    JSON.stringify({ browser: h.cdp.version, results }, null, 2),
  )
  console.log(`${String(results.filter((r) => r.pass).length)}/${String(results.length)} PASS`)
} finally {
  h.cdp.close()
  h.kill()
}
