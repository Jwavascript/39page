// 공유 카드 시안 스크린샷 — 구현 아님. 격리된 임시 Chrome 프로필로 로컬 파일만 연다.
// 실행: npm run build && POC_CHROME=<chrome.exe> node design/mockups/share-card/check/shoot.mjs
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { launch, sleep, waitFor } from '../../../../extension/integration/harness.mjs'

const HERE = path.resolve('design/mockups/share-card')
const OUT = path.join(HERE, 'screenshots')
mkdirSync(OUT, { recursive: true })

const h = await launch({ chrome: process.env.POC_CHROME, webDist: path.resolve('dist'), headful: false })
try {
  const p = await h.tab('about:blank')
  const send = (method, params = {}) => h.cdp.send(method, params, p.session)
  await send('Emulation.setDeviceMetricsOverride', { width: 2400, height: 2200, deviceScaleFactor: 1, mobile: false })
  await send('Page.navigate', { url: pathToFileURL(path.join(HERE, 'index.html')).href })
  await waitFor(() => p.ev(`document.querySelectorAll('#scaled .frame').length === 5`), { label: 'mockup' })
  await sleep(500)

  const shots = [
    ['card-a-playlist', 'a-jcard-playlist'],
    ['card-a-moment', 'a-jcard-moment'],
    ['card-b-playlist', 'b-lp-playlist'],
    ['card-c-playlist', 'c-receipt-playlist'],
    ['card-c-long', 'c-receipt-long'],
    ['scaled', 'scaled-phone-desktop'],
  ]
  for (const [id, name] of shots) {
    const box = await p.ev(
      `(() => { const e = document.getElementById(${JSON.stringify(id)}); e.scrollIntoView({ block: 'start' }); const r = e.getBoundingClientRect(); return { x: r.x + scrollX, y: r.y + scrollY, width: r.width, height: Math.min(r.height, innerHeight) } })()`,
    )
    await sleep(200)
    const image = await send('Page.captureScreenshot', { format: 'png', clip: { ...box, scale: 1 } })
    writeFileSync(path.join(OUT, `${name}.png`), Buffer.from(image.data, 'base64'))
    console.log('saved', name, JSON.stringify(box))
  }
} finally {
  h.cdp.close()
  h.kill()
  await sleep(1000)
}
