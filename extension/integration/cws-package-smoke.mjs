/** Production 패키지 UI smoke. 새 headless Chrome 프로필, 권한 부여·사용자 데이터 접근 없음. */
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { launch, waitFor, recorder } from './harness.mjs'

const out = path.resolve('docs/development/cws-private-results')
mkdirSync(out, { recursive: true })
const h = await launch({
  chrome: process.env.POC_CHROME,
  webDist: path.resolve('dist'),
  headful: false,
})
const { step, results } = recorder()
let id
try {
  // 경로 기반 압축해제 ID다. Store ID로 사용하거나 운영 allowlist에 넣지 않는다.
  const loaded = await h.cdp.send('Extensions.loadUnpacked', {
    path: path.resolve(process.env.EXT_DIST ?? 'extension/dist'),
  })
  id = loaded.id
  await step('manifest', '실제 production 확장 로드', async () => {
    const worker = await waitFor(async () =>
      (await h.cdp.targets()).find((t) => t.type === 'service_worker' && t.url.includes(id)),
    )
    const session = await h.cdp.attach(worker.targetId)
    const manifest = await h.cdp.evaluate(session, 'chrome.runtime.getManifest()')
    return {
      pass: !manifest.key && manifest.minimum_chrome_version === '116',
      version: manifest.version,
    }
  })
  const yt = await h.tab('https://www.youtube.com/watch?v=aqz-KE-bpKQ')
  await h.cdp.send(
    'Emulation.setDeviceMetricsOverride',
    {
      width: 1280,
      height: 800,
      deviceScaleFactor: 1,
      mobile: false,
    },
    yt.session,
  )
  await waitFor(() => yt.ev('!!document.querySelector("video")'), {
    timeout: 45000,
    label: 'YouTube video',
  })
  await h.cdp.send('Target.activateTarget', { targetId: yt.targetId })
  const target = await waitFor(async () =>
    (await h.cdp.targets()).find((t) => t.type === 'tab' && t.url.includes('youtube.com/watch')),
  )
  await h.cdp.send('Extensions.triggerAction', { id, targetId: target.targetId })
  const panelTarget = await waitFor(async () =>
    (await h.cdp.targets()).find(
      (t) => t.url.includes(id) && t.url.includes('/src/panel/index.html'),
    ),
  )
  const panel = await h.cdp.attach(panelTarget.targetId)
  await waitFor(() => h.cdp.evaluate(panel, 'document.body.innerText.includes("접근 권한 필요")'))
  await step('panel', '실제 YouTube 패널·권한 안내·Collect 폴백', async () => {
    const text = await h.cdp.evaluate(panel, 'document.body.innerText')
    const { data } = await h.cdp.send('Page.captureScreenshot', { format: 'png' }, yt.session)
    writeFileSync(path.join(out, 'youtube-permission-1280x800.png'), Buffer.from(data, 'base64'))
    return { pass: text.includes('39page 수집 화면으로 열기') && text.includes('접근 권한 필요') }
  })
  await step('collect', '수집 화면은 명시적 클릭 뒤 HTTPS fragment로 열린다', async () => {
    await h.cdp.evaluate(
      panel,
      'Array.from(document.querySelectorAll("button")).find(b=>b.textContent.trim()==="39page 수집 화면으로 열기").click(); true',
    )
    const tab = await waitFor(async () =>
      (await h.cdp.targets()).find((t) => t.url.startsWith('https://39page.com/#collect?')),
    )
    return {
      pass: tab.url.includes('videoId=aqz-KE-bpKQ') && !tab.url.includes('note='),
      url: tab.url,
    }
  })
} catch (error) {
  results.push({ id: 'runtime', pass: false, error: error.message })
} finally {
  writeFileSync(
    path.join(out, 'package-smoke.json'),
    JSON.stringify(
      {
        browser: h.cdp.version,
        localUnpackedId: id,
        storeInstall: false,
        results,
      },
      null,
      2,
    ) + '\n',
  )
  h.cdp.close()
  h.kill()
}
if (results.some((result) => !result.pass)) process.exitCode = 1
