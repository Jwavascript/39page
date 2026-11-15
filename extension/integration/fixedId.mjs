/**
 * M11-6 — 개발용 고정 확장 ID 검증. 압축해제 확장의 ID 가 (a) 다른 경로에서 올려도, (b) 다시 올려도,
 * (c) Chrome 을 껐다 켜도(같은 프로필) 같은지, 그리고 (d) `key` 없는 운영 빌드는 경로마다 ID 가 다른지 잰다.
 *
 *   POC_CHROME=<…> EXT_DIST=<…/dist-dev> EXT_PROD=<…/dist> OUT=<…> node extension/integration/fixedId.mjs
 */
import { spawn } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { connectBrowser, sleep, waitFor } from './cdp.mjs'

const { POC_CHROME, EXT_DIST, EXT_PROD, OUT } = process.env

async function withChrome(profile, run) {
  const chrome = spawn(
    POC_CHROME,
    [
      '--headless=new',
      '--remote-debugging-port=0',
      '--enable-unsafe-extension-debugging',
      `--user-data-dir=${profile}`,
      '--no-first-run',
      'about:blank',
    ],
    { stdio: 'ignore' },
  )
  try {
    rmSync(path.join(profile, 'DevToolsActivePort'), { force: true })
    const port = await waitFor(
      () => {
        try {
          return (
            Number(
              readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').split(/\r?\n/)[0],
            ) || null
          )
        } catch {
          return null
        }
      },
      { timeout: 30_000, label: 'port' },
    )
    const cdp = await connectBrowser(port)
    try {
      return await run(cdp)
    } finally {
      cdp.close()
    }
  } finally {
    spawn('taskkill', ['/PID', String(chrome.pid), '/T', '/F'], { stdio: 'ignore' })
    await sleep(1500)
  }
}

const copyTo = (src, name) => {
  const dir = mkdtempSync(path.join(tmpdir(), `39page-ext-${name}-`))
  cpSync(src, dir, { recursive: true })
  return dir
}

const devA = copyTo(EXT_DIST, 'devA')
const devB = copyTo(EXT_DIST, 'devB')
const prodA = copyTo(EXT_PROD, 'prodA')
const prodB = copyTo(EXT_PROD, 'prodB')
const profile = mkdtempSync(path.join(tmpdir(), '39page-fixedid-'))
const swIds = (cdp) =>
  cdp
    .targets()
    .then((ts) => ts.filter((t) => t.type === 'service_worker').map((t) => t.url.split('/')[2]))

const report = {}
report.firstSession = await withChrome(profile, async (cdp) => {
  const a = (await cdp.send('Extensions.loadUnpacked', { path: devA })).id
  const again = (await cdp.send('Extensions.loadUnpacked', { path: devA })).id
  const prodIdA = (await cdp.send('Extensions.loadUnpacked', { path: prodA })).id
  await sleep(1500)
  return { devPathA: a, devReloadSamePath: again, prodPathA: prodIdA, running: await swIds(cdp) }
})
report.secondSession = await withChrome(profile, async (cdp) => {
  // 같은 프로필로 다시 켰다 — 이전에 올린 압축해제 확장이 같은 ID 로 돌아오는가
  await sleep(2500)
  const restored = await swIds(cdp)
  const b = (await cdp.send('Extensions.loadUnpacked', { path: devB })).id
  const prodIdB = (await cdp.send('Extensions.loadUnpacked', { path: prodB })).id
  return { restoredAfterRestart: restored, devPathB: b, prodPathB: prodIdB }
})
const f = report.firstSession
const s = report.secondSession
report.verdict = {
  devIdStableAcrossPathsReloadRestart:
    f.devPathA === 'pkagnijdhfmkodpdfgdehfdghcgbfpoa' &&
    f.devReloadSamePath === f.devPathA &&
    s.devPathB === f.devPathA,
  prodIdDependsOnPath: f.prodPathA !== s.prodPathB,
}
mkdirSync(OUT, { recursive: true })
writeFileSync(path.join(OUT, 'fixed-id.json'), JSON.stringify(report, null, 2))
console.log(JSON.stringify(report))
