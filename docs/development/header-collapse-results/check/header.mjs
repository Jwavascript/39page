// Local production build and an isolated Chrome profile. POC_CHROME must name chrome.exe.
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { launch, BASE, sleep, waitFor } from '../../../../extension/integration/harness.mjs'

const OUT = path.resolve('docs/development/header-collapse-results')
mkdirSync(OUT, { recursive: true })
const results = []
const record = (name, pass, details) => {
  results.push({ name, pass: Boolean(pass), details })
  console.log(pass ? 'PASS' : 'FAIL', name, JSON.stringify(details ?? {}).slice(0, 250))
}
const h = await launch({
  chrome: process.env.POC_CHROME,
  webDist: path.resolve('dist'),
  headful: false,
})
try {
  const page = await h.tab('about:blank')
  const ev = page.ev
  const send = (name, params = {}) => h.cdp.send(name, params, page.session)
  const size = (width, height) =>
    send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: width < 700,
    })
  await send('Network.enable')
  await send('Network.setBlockedURLs', { urls: ['*open-meteo*'] })
  await size(1440, 900)
  const click = async (selector, scroll = true) => {
    const point = await ev(
      `(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw Error('Missing '+${JSON.stringify(selector)});${scroll ? "e.scrollIntoView({block:'nearest'});" : ''}const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`,
    )
    for (const type of ['mousePressed', 'mouseReleased'])
      await send('Input.dispatchMouseEvent', { type, ...point, button: 'left', clickCount: 1 })
    await sleep(120)
  }
  const key = async (key, code, keyCode) => {
    await send('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key,
      code,
      windowsVirtualKeyCode: keyCode,
      ...(key === 'Enter' ? { text: '\r', unmodifiedText: '\r' } : {}),
    })
    await send('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key,
      code,
      windowsVirtualKeyCode: keyCode,
    })
    await sleep(80)
  }
  const measure = () =>
    ev(`(()=>{
    const box=e=>{const r=e.getBoundingClientRect();return{x:r.x,y:r.y,w:r.width,h:r.height,b:r.bottom}};
    const header=document.querySelector('.app-header'),workspace=document.querySelector('.workspace'),player=document.querySelector('.video-holder');
    return {expanded:document.querySelector('.header-toggle').getAttribute('aria-expanded'),hidden:document.querySelector('#dashboard-header-content').hidden,header:box(header),workspace:box(workspace),player:box(player),card:box(document.querySelector('.now-playing-card')),scrollY:scrollY,overflow:document.documentElement.scrollWidth-document.documentElement.clientWidth,iframe:window.__iframe===document.querySelector('.player-mount iframe'),theme:document.documentElement.dataset.theme,focus:document.activeElement.className,subtitle:document.querySelector('.now-sub').textContent,widgets:[...document.querySelectorAll('.widget-host > [data-widget]')].map(e=>[e.dataset.widget,box(e).x,box(e).w]),fullscreen:!!document.fullscreenElement};
  })()`)
  const video = async () => {
    const target = (await h.cdp.targets()).find(
      (t) => t.type === 'iframe' && t.url.includes('youtube.com/embed'),
    )
    if (!target) return null
    const session = await h.cdp.attach(target.targetId)
    try {
      const value = await h.cdp.send(
        'Runtime.evaluate',
        {
          expression: `(()=>{const v=document.querySelector('video');return v?{seconds:v.currentTime,paused:v.paused}:null})()`,
          returnByValue: true,
        },
        session,
      )
      return value.result.value
    } finally {
      await h.cdp.send('Target.detachFromTarget', { sessionId: session }).catch(() => {})
    }
  }
  await send('Page.navigate', { url: BASE })
  await waitFor(() => ev(`!!document.querySelector('.now-playlist')`), { label: 'app' })
  const library = {
    version: 1,
    data: {
      playlists: [
        {
          id: 'p',
          name: 'Header UAT',
          tracks: [
            { id: 't', source: 'youtube', videoId: 'aqz-KE-bpKQ', title: 'Header playback' },
          ],
        },
      ],
      selectedPlaylistId: 'p',
    },
  }
  await ev(
    `localStorage.setItem('39page.library',${JSON.stringify(JSON.stringify(library))});window.__old=true;true`,
  )
  await send('Page.reload')
  await waitFor(() => ev(`!window.__old&&!!document.querySelector('.now-playlist')`), {
    label: 'seed reload',
  })
  await click('.now-playlist .track-row')
  await waitFor(
    async () => {
      const v = await video()
      return v && !v.paused && v.seconds > 1
    },
    { timeout: 30000, label: 'real YouTube playback' },
  )
  await ev(`window.__iframe=document.querySelector('.player-mount iframe');true`)

  for (const theme of ['cassette', 'mono'])
    for (const [width, height] of [
      [1440, 900],
      [1024, 768],
      [390, 844],
      [360, 780],
      [844, 390],
    ]) {
      const name = `${theme}-${width}x${height}`
      await size(width, height)
      await ev(
        `window.scrollTo(0,0);[...document.querySelectorAll('.theme-button')].find(e=>e.textContent.includes(${JSON.stringify(theme === 'mono' ? 'MONO VINYL' : 'SYNTH CASSETTE')})).click();true`,
      )
      await sleep(200)
      const beforeVideo = await video()
      const cycles = []
      for (let i = 0; i < 3; i++) {
        const expanded = await measure()
        await click('.header-toggle', false)
        const collapsed = await measure()
        const focusable = await ev(
          `[...document.querySelectorAll('#dashboard-header-content button')].filter(e=>e.getClientRects().length>0).length`,
        )
        if (i === 0) {
          const shot = await send('Page.captureScreenshot', { format: 'png' })
          writeFileSync(path.join(OUT, `${name}-collapsed.png`), Buffer.from(shot.data, 'base64'))
        }
        // Enter and Space activate the same native button; no custom keyboard handler.
        if (i === 0) await key('Enter', 'Enter', 13)
        else if (i === 1) await key(' ', 'Space', 32)
        else await click('.header-toggle', false)
        const restored = await measure()
        cycles.push({ expanded, collapsed, restored, focusable })
      }
      const afterVideo = await video()
      record(
        `${name}: repeat collapse/expand, space gained, no scroll jump`,
        cycles.every(
          ({ expanded: a, collapsed: b, restored: c, focusable }) =>
            a.expanded === 'true' &&
            b.expanded === 'false' &&
            b.hidden &&
            c.expanded === 'true' &&
            !c.hidden &&
            b.workspace.y < a.workspace.y - 10 &&
            Math.abs(c.workspace.y - a.workspace.y) < 1 &&
            a.scrollY === b.scrollY &&
            b.scrollY === c.scrollY &&
            focusable === 0 &&
            b.focus.includes('header-toggle') &&
            b.overflow <= 1 &&
            c.overflow <= 1,
        ),
        cycles,
      )
      record(
        `${name}: iframe and playback position retained`,
        cycles.every(
          ({ expanded: a, collapsed: b, restored: c }) =>
            a.iframe &&
            b.iframe &&
            c.iframe &&
            JSON.stringify(a.widgets) === JSON.stringify(b.widgets) &&
            JSON.stringify(a.widgets) === JSON.stringify(c.widgets),
        ) &&
          beforeVideo &&
          !beforeVideo.paused &&
          afterVideo &&
          !afterVideo.paused &&
          afterVideo.seconds >= beforeVideo.seconds,
        { beforeVideo, afterVideo },
      )
      await click('.app-nav button:first-child')
      record(
        `${name}: restored archive menu works`,
        await ev(`!document.querySelector('#archive-panel').hidden`),
      )
      const close = await ev(
        `document.querySelector('.strip-close').hidden?'#archive-panel .close':'.strip-close'`,
      )
      await click(close)
      await click('.app-nav button:last-child')
      record(
        `${name}: restored data menu works`,
        await ev(
          `!document.querySelector('.data-backdrop').hidden && document.querySelector('.app-header').inert`,
        ),
      )
      await click('[aria-label="데이터 닫기"]')
      await ev(`window.scrollTo(0,0);true`)
    }
  await size(1440, 900)
  await ev(
    `window.scrollTo(0,0);document.body.style.paddingBottom='600px';window.scrollTo(0,240);true`,
  )
  await sleep(100)
  const anchored = []
  for (let i = 0; i < 2; i++) {
    const before = await measure()
    await ev(`document.querySelector('.header-toggle').click();true`)
    await sleep(120)
    const after = await measure()
    anchored.push({ before, after })
  }
  record(
    'Offscreen header keeps viewed content anchored',
    anchored.every(
      ({ before: a, after: b }) =>
        a.header.b <= 0 &&
        Math.abs(a.workspace.y - b.workspace.y) < 1 &&
        a.scrollY !== b.scrollY &&
        b.iframe,
    ),
    anchored,
  )
  await ev(`document.body.style.paddingBottom='';window.scrollTo(0,0);true`)

  await click('.header-toggle', false)
  const { windowId } = await h.cdp.send('Browser.getWindowForTarget', { targetId: page.targetId })
  await h.cdp.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'fullscreen' } })
  await sleep(150)
  const full = await measure()
  await h.cdp.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'normal' } })
  record(
    'Header state independent of browser fullscreen',
    full.expanded === 'false' &&
      !full.fullscreen &&
      (await ev(
        `document.querySelector('.header-toggle').getAttribute('aria-expanded')==='false'`,
      )),
    full,
  )
  await ev(`window.__old=true;true`)
  await send('Page.reload')
  await waitFor(() => ev(`!window.__old&&!!document.querySelector('.header-toggle')`), {
    label: 'default reset',
  })
  record(
    'Reload starts expanded without a new storage field',
    await ev(
      `document.querySelector('.header-toggle').getAttribute('aria-expanded')==='true' && !Object.keys(localStorage).some(k=>/header|immersive|fullscreen/i.test(k))`,
    ),
  )
} catch (error) {
  record('Complete run', false, { error: error.stack })
} finally {
  writeFileSync(
    path.join(OUT, 'real-chrome-header.json'),
    JSON.stringify({ results }, null, 2) + '\n',
  )
  h.cdp.close()
  h.kill()
}
if (results.some((r) => !r.pass)) process.exitCode = 1
