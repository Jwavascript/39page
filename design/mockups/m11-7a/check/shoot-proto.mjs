// M11-7A 시안을 격리 프로필 Chrome 으로 열어 화면마다 찍고, 콘솔 오류 · 외부 요청 · 저장소 접근을 센다.
//   POC_CHROME=<chrome> WEB_DIST=<design/mockups/m11-7a> OUT=<dir> REPO_INT=<extension/integration> [ONLY=name] node shoot-proto.mjs
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const INT = 'file:///' + process.env.REPO_INT.split(String.fromCharCode(92)).join('/')
const { launch, BASE, sleep, waitFor } = await import(INT + '/harness.mjs')
const OUT = process.env.OUT
mkdirSync(OUT, { recursive: true })

const h = await launch({ chrome: process.env.POC_CHROME, webDist: process.env.WEB_DIST, headful: false })
const problems = []
const requests = []
try {
  const page = await h.tab('about:blank')
  h.cdp.on((msg) => {
    if (msg.sessionId !== page.session) return
    if (msg.method === 'Runtime.exceptionThrown') problems.push(msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text)
    if (msg.method === 'Runtime.consoleAPICalled' && (msg.params.type === 'error' || msg.params.type === 'warning'))
      problems.push(msg.params.args.map((a) => a.value ?? a.description).join(' '))
    if (msg.method === 'Network.requestWillBeSent') requests.push(msg.params.request.url)
  })
  await h.cdp.send('Network.enable', {}, page.session)
  await h.cdp.send('Page.enable', {}, page.session)
  // 시안이 저장소를 건드리는지 — localStorage · sessionStorage 접근을 센다
  await h.cdp.send(
    'Page.addScriptToEvaluateOnNewDocument',
    {
      source: `window.__storageTouches = 0; for (const k of ['localStorage','sessionStorage']) { const real = Object.getOwnPropertyDescriptor(window, k); Object.defineProperty(window, k, { configurable: true, get() { window.__storageTouches += 1; return real.get.call(window) } }) }`,
    },
    page.session,
  )

  const shots = [
    ['01-dashboard-mono-1321', 'dashboard?w=1321&h=761&theme=mono-vinyl&fit=0&arch=off', 1400],
    ['02-dashboard-kawaii-1321', 'dashboard?w=1321&h=761&theme=kawaii-synth-cassette&fit=0', 1400],
    ['03-dashboard-mono-1440', 'dashboard?w=1440&h=900&theme=mono-vinyl&fit=0', 1500],
    ['04-dashboard-mono-1024', 'dashboard?w=1024&h=768&theme=mono-vinyl&fit=0', 1100],
    ['05-arch-B-mono-1321', 'dashboard?w=1321&h=761&arch=music&layout=B&theme=mono-vinyl&fit=0', 1400],
    ['06-arch-A-mono-1321', 'dashboard?w=1321&h=761&arch=music&layout=A&theme=mono-vinyl&fit=0', 1400],
    ['07-arch-C-mono-1321', 'dashboard?w=1321&h=761&arch=music&layout=C&theme=mono-vinyl&fit=0', 1400],
    ['08-arch-B-kawaii-1321', 'dashboard?w=1321&h=761&arch=music&layout=B&theme=kawaii-synth-cassette&fit=0', 1400],
    ['09-dashboard-many-1321', 'dashboard?w=1321&h=761&size=many&theme=mono-vinyl&fit=0&arch=off', 1400],
    ['10-dashboard-empty-1321', 'dashboard?w=1321&h=761&size=empty&theme=mono-vinyl&fit=0&arch=off', 1400],
    ['11-archive-screen-mono', 'archive?theme=mono-vinyl&step=detail', 1400],
    ['12-archive-screen-many-kawaii', 'archive?theme=kawaii-synth-cassette&size=many&step=list', 1400],
    ['13-moments-ab', 'moments?theme=mono-vinyl', 1300],
    ['14-reorder', 'reorder?theme=mono-vinyl', 1400],
    ['15-mobile-mono', 'mobile?theme=mono-vinyl&order=M1&arch=off', 1700],
    ['16-mobile-kawaii', 'mobile?theme=kawaii-synth-cassette&order=M1&arch=off', 1700],
    ['17-mobile-arch-detail', 'mobile?theme=mono-vinyl&arch=music&step=detail', 1700],
    ['18-mobile-M2', 'mobile?theme=kawaii-synth-cassette&order=M2&arch=off', 1700],
    ['19-decisions', 'decisions?theme=mono-vinyl', 1300],
    ['20-current-mono', 'dashboard?variant=current&theme=mono-vinyl', 1400],
  ]
  const only = process.env.ONLY
  const report = []
  for (const [name, hash, vw] of shots) {
    if (only && !name.includes(only)) continue
    await h.cdp.send('Emulation.setDeviceMetricsOverride', { width: vw, height: 900, deviceScaleFactor: 1, mobile: false }, page.session)
    await h.cdp.send('Page.navigate', { url: 'about:blank' }, page.session)
    await sleep(200)
    await h.cdp.send('Page.navigate', { url: `${BASE}/index.html#/${hash}` }, page.session)
    await waitFor(() => page.ev(`!!document.querySelector('.proto-stage')`), { label: name })
    await sleep(900)
    if (name === '13-moments-ab') {
      // A: 저장 → 메모 입력 / B: 잡기 → 메모 입력 (저장 전 상태를 찍는다)
      await page.ev(`document.querySelector('[data-act="capture"][data-ctx="abA"]').click(); true`)
      await sleep(200)
      await page.ev(`(() => { const t = document.querySelector('[data-bind="noteA"]'); t.value = '드랍 직전'; t.dispatchEvent(new Event('input', { bubbles: true })); return true })()`)
      await page.ev(`document.querySelector('[data-act="capture"][data-ctx="abB"]').click(); true`)
      await sleep(200)
      await page.ev(`(() => { const t = document.querySelector('[data-bind="note"]'); t.value = '드랍 직전'; t.dispatchEvent(new Event('input', { bubbles: true })); return true })()`)
      await sleep(300)
    }
    if (name === '14-reorder') {
      // B 를 편집 모드로, C 는 ⋯ 메뉴를 연 상태
      await page.ev(`document.querySelector('[data-act="roEdit"][data-v="B"]').click(); true`)
      await sleep(200)
      await page.ev(`document.querySelector('[data-act="tMenu"][data-list="ro:C"]').click(); true`)
      await sleep(200)
    }
    if (name === '05-arch-B-mono-1321') {
      // B 모델로 시점을 잡은 상태 (보관함이 열려도 캡처 가능)
      await page.ev(`document.querySelector('[data-act="capture"][data-ctx="dash"]').click(); true`)
      await sleep(200)
    }
    const metrics = await h.cdp.send('Page.getLayoutMetrics', {}, page.session)
    const height = Math.ceil(metrics.cssContentSize.height)
    const r = await h.cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width: vw, height: Math.min(height, 6000), scale: 1 } }, page.session)
    writeFileSync(path.join(OUT, `${name}.png`), Buffer.from(r.data, 'base64'))
    const check = await page.ev(`(() => {
      const devs = [...document.querySelectorAll('.device')]
      const overflowX = devs.map((d) => d.scrollWidth - d.clientWidth)
      const small = [...document.querySelectorAll('.device button, .compare button')].filter((b) => b.offsetParent !== null).map((b) => b.getBoundingClientRect()).filter((r) => r.width > 0 && (r.width < 43.5 || r.height < 35.5)).length
      return { devices: devs.length, overflowX, smallButtons: small, storage: window.__storageTouches, pageOverflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth }
    })()`)
    report.push({ name, height, ...check })
  }
  const external = requests.filter((u) => !u.startsWith(BASE) && !u.startsWith('data:') && !u.startsWith('about:'))
  writeFileSync(path.join(OUT, 'report.json'), JSON.stringify({ report, problems, external, requests: requests.length }, null, 2))
  console.log(JSON.stringify({ problems, external, report }, null, 1))
} finally {
  h.cdp.close()
  h.kill()
}
