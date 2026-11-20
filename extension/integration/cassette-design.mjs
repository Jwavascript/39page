/**
 * Cassette design UAT: isolated Chrome, local web + dev extension only.
 * POC_CHROME=<chrome.exe> node extension/integration/cassette-design.mjs [--render-icons]
 * Build setup and exact limitations are in docs/development/EXTENSION_CASSETTE_REPORT.md.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { BASE, DEV_EXTENSION_ID, launch, recorder, sleep, waitFor } from './harness.mjs'

const OUT = path.resolve('docs/development/extension-cassette-results')
const iconsOnly = process.argv.includes('--render-icons')
const h = await launch({
  chrome: process.env.POC_CHROME,
  webDist: path.resolve('node_modules/.tmp/cassette-web'),
  ...(iconsOnly ? {} : { extDist: path.resolve('extension/dist-dev') }),
  headful: !iconsOnly,
})
const { results, step } = recorder()
mkdirSync(OUT, { recursive: true })
const VIDEO = 'aqz-KE-bpKQ'
const LONG = '긴 곡 제목과 메모를 읽는 작은 카세트 — mint pink SYNTH '.repeat(9)
const NOTE = '작은 순간을 기억하는 긴 메모. 민트와 핑크의 저녁 음악 '.repeat(30).slice(0, 500)
const screenshot = async (session, name, clip) => {
  const { data } = await h.cdp.send(
    'Page.captureScreenshot',
    { format: 'png', ...(clip ? { clip } : {}) },
    session,
  )
  writeFileSync(path.join(OUT, `${name}.png`), Buffer.from(data, 'base64'))
}
try {
  if (iconsOnly) {
    const tab = await h.tab('about:blank')
    const svg = readFileSync('extension/src/ui/cassette.svg', 'utf8')
    for (const size of [16, 32, 48, 128]) {
      // Toolbar pixels are scarce: fill the width. Keep store-icon padding at 128px.
      const iconSvg = size < 128
        ? svg.replace('x="16" y="16" width="96" height="96"', 'x="0" y="0" width="128" height="128"')
        : svg
      const data = await tab.ev(`(async()=>{
        const image=new Image();image.src='data:image/svg+xml;base64,${Buffer.from(iconSvg).toString('base64')}';await image.decode();
        const c=document.createElement('canvas');c.width=c.height=${size};c.getContext('2d').drawImage(image,0,0,${size},${size});
        return c.toDataURL('image/png').split(',')[1];})()`)
      writeFileSync(`extension/icons/icon-${size}.png`, Buffer.from(data, 'base64'))
    }
    console.log('Rendered 16/32/48/128 PNG icons from approved cassette inset')
  } else {
    const dash = await h.tab(`${BASE}/`)
    await waitFor(() => dash.ev(`!!document.querySelector('.app-header')`))
    const library = {
      version: 1,
      data: {
        playlists: [
          {
            id: 'mine',
            name: 'MY CASSETTE',
            tracks: [{ id: 'one', source: 'youtube', videoId: VIDEO, title: 'Big Buck Bunny' }],
          },
          {
            id: 'drive',
            name: '아주 긴 플레이리스트 이름을 끝까지 읽는 민트빛 카세트와 분홍빛 노을',
            tracks: [],
          },
        ],
        selectedPlaylistId: 'mine',
      },
    }
    await dash.ev(
      `localStorage.clear();localStorage.setItem('39page.library',${JSON.stringify(JSON.stringify(library))});true`,
    )
    await h.cdp.send('Page.reload', {}, dash.session)
    await waitFor(() => dash.ev(`!!document.querySelector('.now-playlist .track-row')`))
    await dash.ev(`document.querySelector('.now-playlist .track-row').click();true`)
    await waitFor(() => dash.ev(`!!document.querySelector('.player-mount iframe')`))
    await dash.ev(`window.__player=document.querySelector('.player-mount iframe');true`)
    const storage = () =>
      dash.ev(
        `({library:JSON.parse(localStorage.getItem('39page.library')).data,moments:JSON.parse(localStorage.getItem('39page.moments')??'{"data":[]}').data,iframe:window.__player===document.querySelector('.player-mount iframe')})`,
      )
    const targetTab = async (url) =>
      waitFor(async () =>
        (await h.cdp.targets()).find((t) => t.type === 'tab' && t.url.startsWith(url)),
      )
    const action = async (page) => {
      await h.cdp.send('Target.activateTarget', { targetId: page.targetId })
      const tab = await targetTab(await page.ev('location.href'))
      await h.cdp.send('Extensions.triggerAction', { id: DEV_EXTENSION_ID, targetId: tab.targetId })
    }
    await step('D1', 'Actual toolbar popup on unsupported page uses Cassette', async () => {
      await action(dash)
      const t = await waitFor(async () =>
        (await h.cdp.targets()).find((t) => t.url.includes('/src/popup/index.html')),
      )
      const session = await h.cdp.attach(t.targetId)
      await waitFor(() => h.cdp.evaluate(session, `!!document.querySelector('.notice')`))
      await screenshot(session, 'popup-toolbar')
      const details = await h.cdp.evaluate(
        session,
        `({theme:document.documentElement.dataset.theme,brand:document.querySelector('h1').textContent,width:innerWidth,overflow:document.documentElement.scrollWidth-document.documentElement.clientWidth,mark:document.querySelector('.cassette-mark').complete})`,
      )
      return {
        pass:
          details.theme === 'kawaii-synth-cassette' &&
          details.width >= 320 &&
          details.mark &&
          details.overflow === 0,
        ...details,
      }
    })
    const yt = await h.tab(`https://www.youtube.com/watch?v=${VIDEO}`)
    await h.cdp.send('Target.activateTarget', { targetId: yt.targetId })
    await waitFor(() => yt.ev(`document.querySelector('video')?.currentTime>1`), {
      timeout: 45000,
      label: 'YouTube playing',
    })
    await action(yt)
    let panel
    const attachPanel = async () => {
      const t = await waitFor(async () =>
        (await h.cdp.targets()).find(
          (t) => t.type === 'iframe' && t.url.includes('/src/panel/index.html'),
        ),
      )
      const session = await h.cdp.attach(t.targetId)
      await h.cdp.send('Runtime.enable', {}, session)
      panel = { session, ev: (code, options) => h.cdp.evaluate(session, code, options) }
      await waitFor(() => panel.ev(`!!document.querySelector('.panel')`))
    }
    await attachPanel()
    const click = (selector) =>
      panel.ev(`document.querySelector(${JSON.stringify(selector)}).click();true`)
    const input = (selector, value) =>
      panel.ev(
        `(()=>{const i=document.querySelector(${JSON.stringify(selector)});i.value=${JSON.stringify(value)};i.dispatchEvent(new Event('input',{bubbles:true}));return true})()`,
      )
    const panelShot = async (name, fullViewport = false) => {
      if (fullViewport) return screenshot(yt.session, name)
      const clip = await yt.ev(
        `(()=>{const r=document.getElementById('page39-panel-host').getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,scale:1}})()`,
      )
      await screenshot(yt.session, name, clip)
    }
    const metrics = () =>
      panel.ev(`(()=>{
      const root=document.documentElement,content=document.querySelector('.content');
      const title=document.querySelector('h1').getBoundingClientRect(),head=document.querySelector('.brand-header').getBoundingClientRect();
      return {theme:root.dataset.theme,width:innerWidth,height:innerHeight,overflow:root.scrollWidth-root.clientWidth,contentOverflow:content.scrollWidth-content.clientWidth,headingWithinHeader:title.left>=head.left&&title.right<=head.right,background:getComputedStyle(document.body).backgroundImage};})()`)
    const grant = async (names) => {
      await panel.ev(`document.querySelector('.access .btn.primary').click();true`, {
        userGesture: true,
      })
      const pending = await panel.ev(
        `({busy:document.querySelector('.access .btn.primary').getAttribute('aria-busy'),text:document.querySelector('.access .btn.primary').textContent.trim()})`,
      )
      const prompt = await h.clickPrompt(names)
      await waitFor(
        () => panel.ev(`!document.querySelector('.access .btn.primary[aria-busy="true"]')`),
        { timeout: 20000 },
      )
      return { pending, prompt }
    }
    await step(
      'D2',
      'Panel permission denied: genuine prompt, gate retained, no write',
      async () => {
        await waitFor(() => panel.ev(`!!document.querySelector('.access')`))
        await panelShot('panel-permission')
        const denied = await grant('Deny|Cancel|拒否|거부|취소')
        const gate = await panel.ev(`!!document.querySelector('.access')`)
        const saved = await storage()
        await panelShot('panel-permission-denied')
        return {
          pass:
            denied.prompt.startsWith('invoked:') &&
            gate &&
            saved.library.playlists[1].tracks.length === 0,
          ...denied,
          gate,
        }
      },
    )
    await step(
      'D3',
      'Permission accepted: genuine prompt and original bridge reads playlists',
      async () => {
        const allowed = await grant('Allow|허용')
        await waitFor(() => panel.ev(`document.querySelectorAll('.list-row').length===3`))
        await panelShot('panel-music')
        return {
          pass:
            allowed.prompt.startsWith('invoked:') &&
            !(await panel.ev(`!!document.querySelector('.access')`)),
          ...allowed,
        }
      },
    )
    await step(
      'D4',
      'Music save via offscreen bridge keeps dashboard selection and iframe',
      async () => {
        await click('.list-row input[value="drive"]')
        await click('#panel-body-music .btn.primary')
        await waitFor(() => panel.ev(`!!document.querySelector('#panel-body-music .feedback.ok')`))
        const saved = await storage()
        await panel.ev(
          `document.querySelector('#panel-body-music .feedback.ok').scrollIntoView({block:'nearest'});true`,
        )
        await panelShot('panel-music-saved')
        return {
          pass:
            saved.library.playlists[1].tracks.length === 1 &&
            saved.library.selectedPlaylistId === 'mine' &&
            saved.iframe,
          selected: saved.library.selectedPlaylistId,
          iframe: saved.iframe,
        }
      },
    )
    await step('D5', 'Instant playlist creation retains data contract', async () => {
      await click('.list-row.new input')
      await input('#panel-new-name', '민트빛 즉석 믹스')
      await click('#panel-body-music .btn.primary')
      await waitFor(() =>
        panel.ev(
          `document.querySelector('#panel-body-music .feedback.ok')?.textContent.includes('민트빛 즉석 믹스')`,
        ),
      )
      const saved = await storage()
      const list = saved.library.playlists.find((p) => p.name === '민트빛 즉석 믹스')
      return {
        pass: list?.tracks.length === 1 && saved.library.selectedPlaylistId === 'mine',
        list,
      }
    })
    await step(
      'D6',
      'Moment capture: fixed time, long note, confirmed store persistence',
      async () => {
        await click('#panel-tab-moment')
        await click('#panel-body-moment .capture .btn')
        await waitFor(() => panel.ev(`!!document.querySelector('.capture-time strong')`))
        const time = await panel.ev(`document.querySelector('.capture-time strong').textContent`)
        await input('#panel-note', NOTE)
        await panel.ev(`document.querySelector('#panel-note').focus();true`)
        await panelShot('panel-moment-note')
        await sleep(1500)
        const stillTime = await panel.ev(
          `document.querySelector('.capture-time strong').textContent`,
        )
        await click('#panel-body-moment .btn.primary')
        await waitFor(() => panel.ev(`!!document.querySelector('#panel-body-moment .feedback.ok')`))
        const saved = await storage()
        await panel.ev(
          `document.querySelector('#panel-body-moment .feedback.ok').scrollIntoView({block:'nearest'});true`,
        )
        await panelShot('panel-moment-saved')
        return {
          pass: time === stillTime && saved.moments.some((m) => m.note === NOTE) && saved.iframe,
          time,
          stillTime,
          length: NOTE.length,
          count: saved.moments.length,
          iframe: saved.iframe,
        }
      },
    )
    await step(
      'D7',
      'Storage failure injection: explicit error, no false success or data loss',
      async () => {
        const target = await waitFor(async () =>
          (await h.cdp.targets()).find(
            (t) => t.type === 'iframe' && t.url.startsWith(BASE + '/bridge.html'),
          ),
        )
        const s = await h.cdp.attach(target.targetId)
        await h.cdp.evaluate(
          s,
          `window.__setItem=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k==='39page.library')throw new DOMException('UAT quota','QuotaExceededError');return window.__setItem.call(this,k,v)};true`,
        )
        const before = await storage()
        try {
          await click('#panel-tab-music')
          await click('.list-row.new input')
          await input('#panel-new-name', '저장 실패 확인용')
          await click('#panel-body-music .btn.primary')
          await waitFor(() =>
            panel.ev(`!!document.querySelector('#panel-body-music .feedback.error')`),
          )
          await panel.ev(
            `document.querySelector('#panel-body-music .feedback.error').scrollIntoView({block:'nearest'});true`,
          )
          await panelShot('panel-save-error')
          const after = await storage()
          return {
            pass: JSON.stringify(before.library) === JSON.stringify(after.library),
            heading: await panel.ev(
              `document.querySelector('#panel-body-music .feedback-heading').textContent.trim()`,
            ),
            unchanged: JSON.stringify(before.library) === JSON.stringify(after.library),
          }
        } finally {
          await h.cdp.evaluate(s, `Storage.prototype.setItem=window.__setItem;true`)
        }
      },
    )
    await step('D8', 'Long title + long playlist: narrow and 200% browser zoom', async () => {
      await panel.ev(
        `document.querySelector('.video-card .title').textContent=${JSON.stringify(LONG)};true`,
      )
      const samples = []
      for (const [width, height, zoom] of [
        [1440, 900, 1],
        [390, 844, 1],
        [360, 780, 1],
        [844, 390, 1],
        [720, 780, 2],
        [360, 780, 2],
      ]) {
        await h.cdp.send(
          'Emulation.setDeviceMetricsOverride',
          { width, height, deviceScaleFactor: 1, mobile: false },
          yt.session,
        )
        const sw = await h.serviceWorker(),
          ss = await h.cdp.attach(sw.targetId)
        await h.cdp.evaluate(
          ss,
          `(async()=>{const [t]=await chrome.tabs.query({active:true,currentWindow:true});await chrome.tabs.setZoom(t.id,${zoom});return true})()`,
        )
        await sleep(250)
        await panel.ev(`document.querySelector('.content').scrollTop=0;true`)
        samples.push({ viewport: { width, height }, zoom, ...(await metrics()) })
        await panelShot(`panel-${width}x${height}-zoom${zoom}`, true)
      }
      return {
        pass: samples.every(
          (s) => s.overflow === 0 && s.contentOverflow === 0 && s.headingWithinHeader,
        ),
        fixture: 'title text only replaced for layout stress; original video/data unchanged',
        samples,
      }
    })
    await step('D9', 'Keyboard tabs and Escape close; actual panel repeated opening', async () => {
      await h.cdp.send('Emulation.clearDeviceMetricsOverride', {}, yt.session)
      await panel.ev(`document.querySelector('#panel-tab-music').focus();true`)
      await h.cdp.send(
        'Input.dispatchKeyEvent',
        { type: 'keyDown', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 },
        yt.session,
      )
      await h.cdp.send(
        'Input.dispatchKeyEvent',
        { type: 'keyUp', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 },
        yt.session,
      )
      const keyboard = await panel.ev(
        `({selected:document.querySelector('#panel-tab-moment').getAttribute('aria-selected'),focus:document.activeElement.id,outline:getComputedStyle(document.activeElement).outlineWidth})`,
      )
      await h.cdp.send(
        'Input.dispatchKeyEvent',
        { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 },
        yt.session,
      )
      await waitFor(() => yt.ev(`!document.getElementById('page39-panel-host')`))
      for (let i = 0; i < 3; i++) {
        await action(yt)
        await attachPanel()
        await click('.close')
        await waitFor(() => yt.ev(`!document.getElementById('page39-panel-host')`))
      }
      const playing = await yt.ev(
        `({paused:document.querySelector('video').paused,time:document.querySelector('video').currentTime,hosts:document.querySelectorAll('#page39-panel-host').length})`,
      )
      return {
        pass:
          keyboard.selected === 'true' &&
          keyboard.focus === 'panel-tab-moment' &&
          keyboard.outline !== '0px' &&
          !playing.paused &&
          playing.hosts === 0,
        keyboard,
        playing,
      }
    })
    await step(
      'D10',
      'Permission revocation closes offscreen and restores permission UI',
      async () => {
        const sw = await h.serviceWorker(),
          ss = await h.cdp.attach(sw.targetId)
        const removed = await h.cdp.evaluate(
          ss,
          `chrome.permissions.remove({origins:['${BASE}/*']})`,
        )
        await action(yt)
        await attachPanel()
        await waitFor(() => panel.ev(`!!document.querySelector('.access')`))
        const offscreen = await h.cdp.evaluate(
          ss,
          `chrome.runtime.getContexts({contextTypes:['OFFSCREEN_DOCUMENT']}).then(x=>x.length)`,
        )
        return { pass: removed && offscreen === 0, removed, offscreen }
      },
    )
    await step('D11', 'Collect fallback still opens only on explicit request', async () => {
      await click('.foot .link')
      const collect = await waitFor(async () =>
        (await h.cdp.targets()).find(
          (t) => t.type === 'page' && t.url.startsWith(BASE) && t.url.includes('#collect?'),
        ),
      )
      return { pass: !!collect, url: collect.url }
    })
    await step('D12', 'Cassette text colors: measured token pairs meet 4.5:1', async () => {
      const pairs = await panel.ev(`(()=>{
        const css=getComputedStyle(document.documentElement),get=k=>css.getPropertyValue(k).trim();
        const lightest=get('--workspace-background').match(/#[0-9a-f]{6}/i)[0];
        const lum=h=>{const v=[1,3,5].map(i=>parseInt(h.slice(i,i+2),16)/255).map(c=>c<=.04045?c/12.92:((c+.055)/1.055)**2.4);return v[0]*.2126+v[1]*.7152+v[2]*.0722};
        return [
          ['body',get('--text-color'),lightest],['muted',get('--text-muted-color'),lightest],
          ['primary',get('--accent-strong-text-color'),get('--accent-strong-color')],
          ['selected tab',get('--theme-button-active-text-color'),get('--theme-button-active-surface-color')],
          ['success',get('--toast-text-color'),get('--toast-surface-color')],
          ['error',get('--error-text-color'),get('--surface-raised-color')],
          ['warning',get('--status-warning-text-color'),get('--surface-raised-color')],
          ['field',get('--field-text-color'),get('--field-surface-color')],
        ].map(([name,fg,bg])=>{const a=lum(fg),b=lum(bg);return{name,fg,bg,ratio:(Math.max(a,b)+.05)/(Math.min(a,b)+.05)}});
      })()`)
      return { pass: pairs.every((p) => p.ratio >= 4.5), pairs }
    })
  }
} catch (error) {
  results.push({ id: 'setup', pass: false, error: error.stack })
  console.error(error)
} finally {
  if (!iconsOnly)
    writeFileSync(
      path.join(OUT, 'real-chrome.json'),
      JSON.stringify({ browser: h.cdp.version, results }, null, 2) + '\n',
    )
  h.cdp.close()
  h.kill()
}
process.exitCode = results.some((r) => !r.pass) ? 1 : 0
