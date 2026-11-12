/**
 * M11-1 저장 브리지 PoC — **선택적 호스트 권한** 실측 (M11 Batch A 지시 4).
 *
 * ⚠ 실험 코드. 운영 사이트에 접속하지 않는다. 격리된 임시 프로필 · Chrome for Testing.
 *
 * 확인하는 것 (모두 실제 Chrome API 호출로)
 * 1. 권한 없이 — `permissions.contains` 와 offscreen 안 39page iframe 의 저장소(분할되는가)
 * 2. 실행 중 부여 — `permissions.request()` 를 사용자 제스처로 부르면 무엇이 일어나는가 (헤드리스 프롬프트)
 * 3. 다른 부여 경로 — chrome://extensions 의 "사이트 액세스" 와 같은 `developerPrivate.addHostPermission`
 * 4. 부여 직후 — 새 iframe · **부여 전에 이미 떠 있던** iframe 이 최상위 저장소 · 잠금을 보는가,
 *    브리지로 Library · Moments 조회가 되는가, `permissions.onAdded` 가 오는가
 * 5. 철회 — `permissions.remove()` 뒤 새 iframe · 이미 떠 있던 iframe, `permissions.onRemoved`
 * 6. 철회 상태에서 기존 수집 화면(새 탭) 폴백
 *
 *   POC_CHROME=<chrome.exe> node poc/m11-bridge/harness/permissions.mjs
 */
import { spawn } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { connectBrowser, sleep, waitFor } from './cdp.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const POC = path.resolve(HERE, '..')
const REPO = path.resolve(POC, '../..')
const OUT = path.join(POC, 'dist')
const CHROME = process.env.POC_CHROME
const BASE = 'http://127.0.0.1:4173'
const ORIGIN_PATTERN = `${BASE}/*`
const EXT_ID = 'pkagnijdhfmkodpdfgdehfdghcgbfpoa'
const PROBE = `${BASE}/poc/m11-bridge/web/probe.html`
/** 헤드리스에서는 권한 프롬프트를 누를 수 없다 — POC_HEADFUL=1 이면 창을 띄우고 UI Automation 으로 실제 단추를 누른다. */
const HEADFUL = process.env.POC_HEADFUL === '1'

if (!CHROME) {
  console.error('POC_CHROME 에 Chrome for Testing 실행 파일 경로를 주세요.')
  process.exit(2)
}

const children = []
const killTree = (child) => {
  if (child.exitCode !== null) return
  if (process.platform === 'win32')
    spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
  else child.kill()
}
const results = []
async function step(id, title, run) {
  process.stdout.write(`▶ ${id} ${title} … `)
  try {
    const details = (await run()) ?? {}
    results.push({ id, title, details })
    console.log(JSON.stringify(details).slice(0, 400))
  } catch (error) {
    results.push({ id, title, error: error.message })
    console.log(`ERROR ${error.message}`)
  }
}

try {
  // 1. 선택 권한 변형 확장 — host_permissions 를 optional_host_permissions 로 옮긴다.
  mkdirSync(OUT, { recursive: true })
  const variant = path.join(OUT, 'ext-optional')
  rmSync(variant, { recursive: true, force: true })
  cpSync(path.join(POC, 'extension'), variant, { recursive: true })
  const manifest = JSON.parse(readFileSync(path.join(variant, 'manifest.json'), 'utf8'))
  delete manifest.host_permissions
  manifest.optional_host_permissions = [ORIGIN_PATTERN]
  writeFileSync(path.join(variant, 'manifest.json'), JSON.stringify(manifest, null, 2))

  const server = spawn(
    process.execPath,
    [
      path.join(REPO, 'node_modules/vite/bin/vite.js'),
      'preview',
      '--config',
      'poc/m11-bridge/vite.config.ts',
    ],
    { cwd: REPO, stdio: 'ignore' },
  )
  children.push(server)
  await waitFor(async () => (await fetch(`${BASE}/`)).ok, { timeout: 20_000, label: 'server' })

  const profile = mkdtempSync(path.join(tmpdir(), '39page-poc-perm-'))
  const chrome = spawn(
    CHROME,
    [
      ...(HEADFUL ? ['--window-size=1000,760'] : ['--headless=new']),
      '--lang=en-US',
      '--remote-debugging-port=0',
      '--enable-unsafe-extension-debugging',
      `--user-data-dir=${profile}`,
      '--no-first-run',
      'about:blank',
    ],
    { stdio: 'ignore' },
  )
  children.push(chrome)
  const port = await waitFor(
    () => {
      try {
        const [first] = readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').split(
          /\r?\n/,
        )
        return Number(first) || null
      } catch {
        return null
      }
    },
    { timeout: 30_000, label: 'port' },
  )
  const cdp = await connectBrowser(port)
  const loaded = await cdp.send('Extensions.loadUnpacked', { path: variant })
  if (loaded.id !== EXT_ID) throw new Error(`unexpected id ${loaded.id}`)
  const env = {
    browser: cdp.version,
    manifest: {
      permissions: manifest.permissions,
      optional_host_permissions: manifest.optional_host_permissions,
    },
  }

  const newTab = async (url) => {
    const { targetId } = await cdp.send('Target.createTarget', { url })
    const session = await cdp.attach(targetId)
    await cdp.send('Runtime.enable', {}, session)
    return { targetId, session }
  }
  const ev = (session, expr, opts) => cdp.evaluate(session, expr, opts)
  const evGesture = async (session, expression, timeout = 15_000) => {
    const result = await Promise.race([
      cdp.send(
        'Runtime.evaluate',
        { expression, awaitPromise: true, returnByValue: true, userGesture: true },
        session,
      ),
      sleep(timeout).then(() => ({ timedOut: true })),
    ])
    if (result.timedOut) return { timedOut: true }
    if (result.exceptionDetails)
      return { error: result.exceptionDetails.exception?.description?.slice(0, 160) }
    return { value: result.result.value }
  }

  // 대시보드(최상위 39page 탭) — 표지 값 · 잠금
  const dash = await newTab(`${BASE}/`)
  await waitFor(
    async () => (await ev(dash.session, `localStorage.getItem('39page.library')`)) !== null,
    { label: 'seed' },
  )
  await ev(
    dash.session,
    `localStorage.setItem('39page-poc-probe', 'first-party'); void navigator.locks.request('39page-poc-hold', () => new Promise(r => setTimeout(r, 120000))); true`,
  )

  // 확장 페이지 (권한 API 를 부를 곳) — 이벤트 기록기를 단다
  const page = await newTab(`chrome-extension://${EXT_ID}/probe-host.html`)
  await ev(
    page.session,
    `globalThis.__permEvents = []; chrome.permissions.onAdded.addListener((p) => __permEvents.push({ added: p.origins })); chrome.permissions.onRemoved.addListener((p) => __permEvents.push({ removed: p.origins })); true`,
  )
  const contains = () =>
    ev(page.session, `chrome.permissions.contains({ origins: ['${ORIGIN_PATTERN}'] })`)

  /** 확장 페이지 안에 39page 탐침 iframe 을 새로 띄워 보고를 받는다. */
  const freshProbe = (tag) =>
    ev(
      page.session,
      `new Promise((resolve) => { const f = document.createElement('iframe'); f.src = '${PROBE}?${tag}'; f.dataset.tag = '${tag}';
        const on = (e) => { if (e.source === f.contentWindow && e.data?.kind === 'loaded') { removeEventListener('message', on); resolve(e.data.report) } };
        addEventListener('message', on); document.body.append(f); setTimeout(() => resolve({ timeout: true }), 8000) })`,
    )
  /** 이미 떠 있는 iframe 에 다시 묻는다 (storage 키는 탐색 때 정해진다 — 그대로인지 본다). */
  const askExisting = (tag) =>
    ev(
      page.session,
      `new Promise((resolve) => { const f = document.querySelector('iframe[data-tag="${tag}"]'); if (!f) return resolve({ missing: true });
        const on = (e) => { if (e.source === f.contentWindow && e.data?.kind === 'report') { removeEventListener('message', on); resolve(e.data.report) } };
        addEventListener('message', on); f.contentWindow.postMessage({ ns: '39page-poc-probe', cmd: 'report' }, '*'); setTimeout(() => resolve({ timeout: true }), 5000) })`,
    )
  const summarize = (r) =>
    r?.timeout
      ? 'timeout'
      : {
          marker: r?.marker ?? null,
          storageAccess: r?.storageAccess ?? null,
          sharedLocks: (r?.locks ?? []).includes('39page-poc-hold'),
          libraryLength: r?.libraryLength ?? null,
        }

  await step('Q1', '권한 없이 — contains · 확장 페이지 안 39page iframe', async () => {
    const r = await freshProbe('before')
    return {
      contains: await contains(),
      probe: summarize(r),
      partitioned: r.marker !== 'first-party',
    }
  })

  /** 실제 프롬프트의 단추를 누른다 (헤드풀 · Windows UI Automation). */
  const clickPrompt = (names) =>
    new Promise((resolve) => {
      const ps = spawn(
        'powershell',
        [
          '-NoProfile',
          '-ExecutionPolicy',
          'Bypass',
          '-File',
          path.join(HERE, 'permissions-prompt.ps1'),
          '-ProcessId',
          String(chrome.pid),
          '-Names',
          names,
        ],
        { stdio: ['ignore', 'pipe', 'ignore'] },
      )
      let out = ''
      ps.stdout.on('data', (d) => (out += d))
      ps.on('exit', () => resolve(out.trim()))
    })
  const requestWith = async (names) => {
    await cdp.send('Target.activateTarget', { targetId: page.targetId })
    const asked = evGesture(
      page.session,
      `chrome.permissions.request({ origins: ['${ORIGIN_PATTERN}'] })`,
      20_000,
    )
    const clicked = HEADFUL ? await clickPrompt(names) : 'headless — 누를 수 없음'
    return {
      clicked,
      request: await asked,
      containsAfter: await contains(),
      events: await ev(page.session, '__permEvents'),
    }
  }

  await step('Q2a', 'permissions.request() → 실제 프롬프트에서 "거부"', () =>
    requestWith('Deny|거부'),
  )
  await step('Q2b', 'permissions.request() → 실제 프롬프트에서 "허용"', () =>
    requestWith('Allow|허용'),
  )

  await step(
    'Q3',
    '다른 실제 부여 경로 — chrome://extensions 사이트 액세스 (developerPrivate)',
    async () => {
      const ext = await newTab(`chrome://extensions/?id=${EXT_ID}`)
      await sleep(1500)
      const info = await ev(
        ext.session,
        `chrome.developerPrivate.getExtensionInfo('${EXT_ID}').then(i => ({ hostAccess: i.permissions?.runtimeHostPermissions?.hostAccess ?? null, hasAllHosts: i.permissions?.runtimeHostPermissions?.hasAllHosts ?? null, hosts: (i.permissions?.runtimeHostPermissions?.hosts ?? []).map(h => h.host + ':' + h.granted) }))`,
      ).catch((e) => ({ error: e.message }))
      const add = await ev(
        ext.session,
        `chrome.developerPrivate.addHostPermission('${EXT_ID}', '${ORIGIN_PATTERN}').then(() => 'ok', (e) => 'rejected: ' + e.message)`,
      ).catch((e) => `error: ${e.message}`)
      await sleep(500)
      const infoAfter = await ev(
        ext.session,
        `chrome.developerPrivate.getExtensionInfo('${EXT_ID}').then(i => (i.permissions?.runtimeHostPermissions?.hosts ?? []).map(h => h.host + ':' + h.granted))`,
      ).catch((e) => ({ error: e.message }))
      await cdp.send('Target.closeTarget', { targetId: ext.targetId })
      return {
        before: info,
        addHostPermission: add,
        hostsAfter: infoAfter,
        contains: await contains(),
        events: await ev(page.session, '__permEvents'),
      }
    },
  )

  await step('Q4', '부여 직후 — 새 iframe · 부여 전부터 떠 있던 iframe', async () => {
    const fresh = await freshProbe('after-grant')
    const existing = await askExisting('before')
    return {
      contains: await contains(),
      newIframe: summarize(fresh),
      preexistingIframe: summarize(existing),
    }
  })

  await step('Q5', '부여 뒤 offscreen 브리지로 Library · Moments 조회 (실제 store)', async () => {
    const sw = (await cdp.targets()).find(
      (t) => t.type === 'service_worker' && t.url.includes(EXT_ID),
    )
    const s = await cdp.attach(sw.targetId)
    const call = (payload) =>
      ev(
        s,
        `(async () => {
          if ((await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] })).length === 0)
            await chrome.offscreen.createDocument({ url: 'offscreen.html', reasons: ['IFRAME_SCRIPTING'], justification: 'poc' })
          return chrome.runtime.sendMessage({ target: 'offscreen', type: 'bridge/forward', request: { id: crypto.randomUUID(), deadline: Date.now() + 8000, payload: ${payload} } })
        })()`,
      )
    const hello = await call(`{ op: 'hello' }`)
    const list = await call(`{ op: 'library/list', videoId: null }`)
    const moments = await call(`{ op: 'moment/list-for-video', videoId: 'dQw4w9WgXcQ' }`)
    const dashLibrary = await ev(
      dash.session,
      `JSON.parse(localStorage.getItem('39page.library')).data.playlists.map(p => p.name)`,
    )
    return {
      hello: hello?.response?.data,
      playlists: list?.response?.data?.playlists?.map((p) => p.name),
      sameAsDashboard:
        JSON.stringify(list?.response?.data?.playlists?.map((p) => p.name)) ===
        JSON.stringify(dashLibrary),
      momentsStatus: moments?.response?.data?.status,
    }
  })

  await step(
    'Q6',
    '철회 — permissions.remove() 뒤 새 iframe · 이미 떠 있던 iframe · offscreen 브리지',
    async () => {
      const removed = await evGesture(
        page.session,
        `chrome.permissions.remove({ origins: ['${ORIGIN_PATTERN}'] })`,
      )
      await sleep(500)
      const fresh = await freshProbe('after-revoke')
      const existingGranted = await askExisting('after-grant')
      const sw = (await cdp.targets()).find(
        (t) => t.type === 'service_worker' && t.url.includes(EXT_ID),
      )
      const s = await cdp.attach(sw.targetId)
      // 이미 떠 있던 offscreen 브리지에 다시 조회 — 철회를 모르고 계속 쓰는가
      const staleBridge = await ev(
        s,
        `chrome.runtime.sendMessage({ target: 'offscreen', type: 'bridge/forward', request: { id: crypto.randomUUID(), deadline: Date.now() + 8000, payload: { op: 'library/list', videoId: null } } })`,
      )
      // 새로 띄운 브리지
      await ev(s, `chrome.offscreen.closeDocument().then(() => true)`)
      const freshBridge = await ev(
        s,
        `(async () => { await chrome.offscreen.createDocument({ url: 'offscreen.html', reasons: ['IFRAME_SCRIPTING'], justification: 'poc' });
        return chrome.runtime.sendMessage({ target: 'offscreen', type: 'bridge/forward', request: { id: crypto.randomUUID(), deadline: Date.now() + 8000, payload: { op: 'library/list', videoId: null } } }) })()`,
      )
      return {
        remove: removed,
        contains: await contains(),
        events: await ev(page.session, '__permEvents'),
        newIframe: summarize(fresh),
        iframeOpenedWhileGranted: summarize(existingGranted),
        staleOffscreenBridge:
          staleBridge?.response?.data?.playlists?.map((p) => p.name) ?? staleBridge,
        freshOffscreenBridge:
          freshBridge?.response?.data?.playlists?.map((p) => p.name) ?? freshBridge,
      }
    },
  )

  await step('Q8', '철회 뒤 다시 request() — 프롬프트가 다시 뜨는가', async () => {
    const started = Date.now()
    const r = await requestWith('Allow|허용')
    return { ...r, ms: Date.now() - started }
  })

  await step(
    'Q9',
    '사용자 경로의 철회 — chrome://extensions 사이트 액세스 (developerPrivate.removeHostPermission)',
    async () => {
      const ext = await newTab(`chrome://extensions/?id=${EXT_ID}`)
      await sleep(1500)
      const removed = await ev(
        ext.session,
        `chrome.developerPrivate.removeHostPermission('${EXT_ID}', '${ORIGIN_PATTERN}').then(() => 'ok', (e) => 'rejected: ' + e.message)`,
      ).catch((e) => `error: ${e.message}`)
      await sleep(500)
      const hosts = await ev(
        ext.session,
        `chrome.developerPrivate.getExtensionInfo('${EXT_ID}').then(i => (i.permissions?.runtimeHostPermissions?.hosts ?? []).map(h => h.host + ':' + h.granted))`,
      ).catch((e) => ({ error: e.message }))
      await cdp.send('Target.closeTarget', { targetId: ext.targetId })
      const fresh = await freshProbe('after-ui-revoke')
      return {
        removeHostPermission: removed,
        hostsAfter: hosts,
        contains: await contains(),
        events: await ev(page.session, '__permEvents'),
        newIframe: summarize(fresh),
      }
    },
  )

  await step('Q7', '철회 상태의 폴백 — 기존 수집 화면(새 탭)은 권한 없이 동작', async () => {
    const collect = await newTab(
      `${BASE}/#collect?v=1&kind=track&videoId=dQw4w9WgXcQ&req=permfallback000001`,
    )
    const text = await waitFor(
      () =>
        ev(
          collect.session,
          `document.body.innerText.includes('추가를 누르기 전에는') ? document.body.innerText.slice(0, 80) : null`,
        ),
      { label: 'collect' },
    )
    const lists = await ev(
      collect.session,
      `[...document.querySelectorAll('input[type=radio]')].length + document.querySelectorAll('[role=radio], .choice').length`,
    )
    return { collectView: text.replace(/\s+/g, ' '), firstPartyStorage: true, choices: lists }
  })

  const file = path.join(
    OUT,
    'results',
    `permissions-${new Date().toISOString().replace(/[:.]/g, '-')}.json`,
  )
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify({ env, results }, null, 2))
  console.log(`\n${file}`)
  cdp.close()
} catch (error) {
  console.error('harness failed:', error)
  process.exitCode = 1
} finally {
  for (const child of children) killTree(child)
}
