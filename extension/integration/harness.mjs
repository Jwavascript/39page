/**
 * 실제 Chrome 통합 하네스 — 공용 준비 (M11-5).
 *
 * 격리된 임시 프로필 · Chrome for Testing · 로컬 39page 빌드(127.0.0.1:4173)만 쓴다. 운영 39page 에 닿지 않는다.
 * 권한 프롬프트는 브라우저 UI 라 CDP 로 누를 수 없다 — 헤드풀로 띄우고 Windows UI Automation 으로 그 Chrome
 * 프로세스의 창에서만 실제 단추를 누른다 (`permissions-prompt.ps1`).
 */
import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { connectBrowser, sleep, waitFor } from './cdp.mjs'

export { sleep, waitFor }

const HERE = path.dirname(fileURLToPath(import.meta.url))
export const REPO = path.resolve(HERE, '../..')
export const BASE = 'http://127.0.0.1:4173'
export const DEV_EXTENSION_ID = 'pkagnijdhfmkodpdfgdehfdghcgbfpoa'
export const ORIGIN_PATTERN = `${BASE}/*`

export async function launch({ chrome, webDist, extDist, headful = true, loadViaFlag = false }) {
  const children = []
  const server = spawn(
    process.execPath,
    [
      path.join(REPO, 'node_modules/vite/bin/vite.js'),
      'preview',
      '--outDir',
      webDist,
      '--host',
      '127.0.0.1',
      '--port',
      '4173',
      '--strictPort',
    ],
    { cwd: REPO, stdio: 'ignore' },
  )
  children.push(server)
  await waitFor(async () => (await fetch(`${BASE}/`)).ok, {
    timeout: 20_000,
    label: 'preview server',
  })

  const profile = mkdtempSync(path.join(tmpdir(), '39page-m115-'))
  const browser = spawn(
    chrome,
    [
      ...(headful ? ['--window-size=1280,860'] : ['--headless=new']),
      '--lang=en-US',
      '--remote-debugging-port=0',
      '--enable-unsafe-extension-debugging',
      // 오래된 Chrome(116)에는 CDP Extensions.loadUnpacked 가 없다 — 명령줄로 올린다 (Chrome for Testing 만 허용).
      ...(loadViaFlag && extDist !== undefined
        ? [`--load-extension=${extDist}`, `--disable-extensions-except=${extDist}`]
        : []),
      '--autoplay-policy=no-user-gesture-required',
      '--mute-audio',
      `--user-data-dir=${profile}`,
      '--no-first-run',
      'about:blank',
    ],
    { stdio: 'ignore' },
  )
  children.push(browser)
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
    { timeout: 30_000, label: 'DevToolsActivePort' },
  )
  const cdp = await connectBrowser(port)
  // 웹앱만 보는 시험은 확장을 올리지 않는다 (`extDist` 없음).
  if (extDist !== undefined && loadViaFlag) {
    const sw = await waitFor(
      async () => (await cdp.targets()).find((t) => t.type === 'service_worker'),
      { timeout: 20_000, label: 'extension worker (flag)' },
    )
    if (!sw.url.includes(DEV_EXTENSION_ID)) throw new Error(`확장 ID 가 다르다: ${sw.url}`)
  } else if (extDist !== undefined) {
    const loaded = await cdp.send('Extensions.loadUnpacked', { path: extDist })
    if (loaded.id !== DEV_EXTENSION_ID) throw new Error(`확장 ID 가 다르다: ${loaded.id}`)
  }

  const kill = () => {
    for (const child of children) {
      if (child.exitCode !== null) continue
      if (process.platform === 'win32')
        spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
      else child.kill()
    }
  }

  /** `newWindow` — 확장 팝업 페이지를 제어용으로 열 때: 같은 창의 활성 탭이 YouTube 면 팝업 로직이 패널을 열고 스스로 닫는다. */
  async function tab(url, { newWindow = false } = {}) {
    const { targetId } = await cdp.send('Target.createTarget', { url, newWindow })
    const session = await cdp.attach(targetId)
    await cdp.send('Runtime.enable', {}, session)
    return {
      targetId,
      session,
      ev: (expression, options) => cdp.evaluate(session, expression, options),
    }
  }

  /** 실제 권한 프롬프트의 단추(Allow · Deny)를 누른다 — 헤드풀에서만. */
  function clickPrompt(names, timeoutMs = 15_000) {
    return new Promise((resolve) => {
      const ps = spawn(
        'powershell',
        [
          '-NoProfile',
          '-ExecutionPolicy',
          'Bypass',
          '-File',
          path.join(HERE, 'permissions-prompt.ps1'),
          '-ProcessId',
          String(browser.pid),
          '-Names',
          names,
          '-TimeoutMs',
          String(timeoutMs),
        ],
        { stdio: ['ignore', 'pipe', 'ignore'] },
      )
      let out = ''
      ps.stdout.on('data', (d) => (out += d))
      ps.on('exit', () => resolve(out.trim()))
    })
  }

  async function serviceWorker() {
    return waitFor(
      async () =>
        (await cdp.targets()).find(
          (t) => t.type === 'service_worker' && t.url.includes(DEV_EXTENSION_ID),
        ),
      { timeout: 10_000, label: 'service worker' },
    )
  }

  async function workerRunning() {
    return (await cdp.targets()).some(
      (t) => t.type === 'service_worker' && t.url.includes(DEV_EXTENSION_ID),
    )
  }

  /** 서비스 워커를 멈춘다 (Chrome 이 유휴 워커를 끄는 것과 같다). */
  async function stopWorker(anySession) {
    await cdp.send('ServiceWorker.enable', {}, anySession)
    await cdp.send('ServiceWorker.stopAllWorkers', {}, anySession)
    await waitFor(async () => !(await workerRunning()), {
      timeout: 10_000,
      label: 'worker stopped',
    })
  }

  return {
    cdp,
    tab,
    clickPrompt,
    serviceWorker,
    workerRunning,
    stopWorker,
    kill,
    browserPid: browser.pid,
  }
}

/** 결과 기록기. */
export function recorder() {
  const results = []
  async function step(id, title, run) {
    process.stdout.write(`▶ ${id} ${title} … `)
    const started = Date.now()
    try {
      const details = (await run()) ?? {}
      const pass = details.pass !== false
      results.push({ id, title, pass, ms: Date.now() - started, details })
      console.log(`${pass ? 'PASS' : 'FAIL'} ${JSON.stringify(details).slice(0, 300)}`)
    } catch (error) {
      results.push({ id, title, pass: false, error: error.message })
      console.log(`ERROR ${error.message}`)
    }
  }
  return { results, step }
}
