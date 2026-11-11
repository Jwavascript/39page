/**
 * M11-1 저장 브리지 PoC — 실제 Chrome 통합 하네스.
 *
 * ⚠ 실험 코드. 운영 사이트(https://39page.com)에 접속하지 않는다.
 *
 * - 39page: PoC 빌드를 `vite preview` 로 http://127.0.0.1:4173 에 띄운다 (대시보드 + 브리지).
 * - 브라우저: Chrome for Testing (브랜드 Chrome 137+ 은 압축해제 확장 로드 플래그를 막는다).
 *   **새 임시 프로필**로만 띄운다 — 사용자의 Chrome 데이터에 닿지 않는다.
 * - 확장: `poc/m11-bridge/extension` 을 CDP `Extensions.loadUnpacked` 로 올린다. 툴바 클릭은
 *   CDP `Extensions.triggerAction` (실제 activeTab 부여).
 * - YouTube: 실제 www.youtube.com 영상.
 *
 *   POC_CHROME=<chrome.exe 경로> node poc/m11-bridge/harness/run.mjs
 *
 * 결과: `poc/m11-bridge/dist/results/run-<시각>.json` + 표준 출력 요약.
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
const EXT_DIR = path.join(POC, 'extension')
const OUT = path.join(POC, 'dist')
const CHROME = process.env.POC_CHROME
const BASE = 'http://127.0.0.1:4173'
const EXT_ID = 'pkagnijdhfmkodpdfgdehfdghcgbfpoa'
const VIDEO = process.env.POC_VIDEO ?? 'dQw4w9WgXcQ'
const ONLY = process.env.POC_ONLY?.split(',') ?? null

if (!CHROME) {
  console.error('POC_CHROME 에 Chrome for Testing 실행 파일 경로를 주세요.')
  process.exit(2)
}

const results = []
const children = []

async function step(id, title, run) {
  if (ONLY !== null && !ONLY.some((prefix) => id.startsWith(prefix))) return
  const started = Date.now()
  process.stdout.write(`▶ ${id} ${title} … `)
  try {
    const details = (await run()) ?? {}
    const pass = details.pass !== false
    results.push({ id, title, pass, ms: Date.now() - started, details })
    console.log(pass ? `PASS (${Date.now() - started}ms)` : 'FAIL')
    if (!pass) console.log('   ', JSON.stringify(details).slice(0, 600))
  } catch (error) {
    results.push({ id, title, pass: false, ms: Date.now() - started, error: error.message })
    console.log(`ERROR ${error.message}`)
  }
}

/* ------------------------------ 서버 ------------------------------ */

async function startServer() {
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
  await waitFor(async () => (await fetch(`${BASE}/`)).ok, {
    timeout: 20_000,
    label: 'preview server',
  })
  return server
}

/* ------------------------------ 브라우저 ------------------------------ */

async function launch(extDir) {
  // 새 임시 프로필 + 포트 0 — Chrome 이 고른 포트를 그 프로필의 DevToolsActivePort 에서 읽는다.
  // 고정 포트를 쓰면 앞 실행의 브라우저가 남아 있을 때 그쪽에 붙는다 (실제로 겪었다).
  const profile = mkdtempSync(path.join(tmpdir(), '39page-poc-profile-'))
  const chrome = spawn(
    CHROME,
    [
      '--headless=new',
      '--remote-debugging-port=0',
      '--enable-unsafe-extension-debugging',
      `--user-data-dir=${profile}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--window-size=1280,900',
      '--autoplay-policy=no-user-gesture-required',
      '--mute-audio',
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
    { timeout: 30_000, label: 'DevToolsActivePort' },
  )
  const cdp = await connectBrowser(port)
  const loaded = await cdp.send('Extensions.loadUnpacked', { path: extDir })
  if (loaded.id !== EXT_ID) throw new Error(`unexpected extension id ${loaded.id}`)
  return { cdp, chrome, profile }
}

/** Windows 에서 chrome.exe 에 kill() 만 하면 브라우저가 남았다 (실측) — 프로세스 트리째 끝낸다. */
function killTree(child) {
  if (child.exitCode !== null) return
  if (process.platform === 'win32') {
    spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
  } else {
    child.kill()
  }
}

function helpers(cdp) {
  async function newTab(url) {
    const { targetId } = await cdp.send('Target.createTarget', { url })
    const session = await cdp.attach(targetId)
    await cdp.send('Runtime.enable', {}, session)
    return { targetId, session, url }
  }

  async function closeTab(tab) {
    await cdp.send('Target.closeTarget', { targetId: tab.targetId })
  }

  async function findTarget(predicate, label, timeout = 10_000) {
    return waitFor(async () => (await cdp.targets()).find(predicate), { timeout, label })
  }

  async function sessionFor(predicate, label, timeout) {
    const target = await findTarget(predicate, label, timeout)
    const session = await cdp.attach(target.targetId)
    return { target, session }
  }

  const ev = (session, expression) => cdp.evaluate(session, expression)

  /** 39page 최상위 탭 문맥에서 저장소 원문을 읽는다 (시험 확인용 — 쓰지 않는다). */
  async function readStores(session) {
    return ev(
      session,
      `(() => {
        const parse = (k) => { const raw = localStorage.getItem(k); if (raw === null) return { raw: null };
          try { const env = JSON.parse(raw); return { raw, data: env.data ?? env } } catch { return { raw, data: null } } }
        return { library: parse('39page.library'), moments: parse('39page.moments') }
      })()`,
    )
  }

  return { newTab, closeTab, findTarget, sessionFor, ev, readStores }
}

/* ------------------------------ 시나리오 ------------------------------ */

async function main() {
  mkdirSync(path.join(OUT, 'results'), { recursive: true })
  await startServer()
  const { cdp } = await launch(EXT_DIR)
  const h = helpers(cdp)
  const env = { browser: cdp.version, video: VIDEO, startedAt: new Date().toISOString() }
  console.log(`browser ${cdp.version} · video ${VIDEO}`)

  // 대시보드 첫 실행 — 기본 목록(MY RECORDS)을 store 가 만든다.
  let dash = await h.newTab(`${BASE}/`)
  await waitFor(async () => (await h.readStores(dash.session)).library.raw !== null, {
    label: 'dashboard seed',
  })

  const sw = () =>
    h.findTarget((t) => t.type === 'service_worker' && t.url.includes(EXT_ID), 'service worker')
  /**
   * 워커 문맥에서 실행한다. 워커가 쉬고 있으면(30초 유휴 종료) 확장 페이지가 메시지를 보내 깨운 뒤
   * 다시 붙는다 — 멈춘 워커에 붙은 세션은 답하지 않을 수 있다.
   */
  async function swEval(expression) {
    let lastError = null
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const target = (await cdp.targets()).find(
          (t) => t.type === 'service_worker' && t.url.includes(EXT_ID),
        )
        if (target === undefined) throw new Error('worker not running')
        const session = await cdp.attach(target.targetId)
        return await cdp.evaluate(session, expression, { timeout: 15_000 })
      } catch (error) {
        lastError = error
        const waker = await h.newTab(`chrome-extension://${EXT_ID}/probe-host.html`)
        await h
          .ev(
            waker.session,
            `chrome.runtime.sendMessage({ ns: 'x' }).catch(() => null).then(() => true)`,
          )
          .catch(() => null)
        await h.closeTab(waker)
        await sleep(300)
      }
    }
    throw lastError
  }

  /* ---------- P0 저장소 파티션 ---------- */

  const marker = `first-party-${Date.now()}`
  await h.ev(dash.session, `localStorage.setItem('39page-poc-probe', ${JSON.stringify(marker)})`)
  // 대시보드 탭이 잠금 하나를 잡고 있는다 — 다른 문맥에서 보이면 잠금 관리자를 공유한다.
  await h.ev(
    dash.session,
    `void navigator.locks.request('39page-poc-hold', () => new Promise(r => setTimeout(r, 60000))); true`,
  )

  await step(
    'P0a',
    'offscreen 문서 안 39page iframe — 최상위 저장소·잠금 공유 (호스트 권한 있음)',
    async () => {
      const report = await swEval(
        `(async () => {
        if ((await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] })).length === 0)
          await chrome.offscreen.createDocument({ url: 'offscreen.html', reasons: ['IFRAME_SCRIPTING'], justification: 'poc probe' })
        return chrome.runtime.sendMessage({ target: 'offscreen', type: 'probe', url: '${BASE}/poc/m11-bridge/web/probe.html' })
      })()`,
      )
      const r = report?.report ?? {}
      return {
        pass: r.marker === marker && (r.locks ?? []).includes('39page-poc-hold'),
        marker: r.marker,
        locksIncludeHold: (r.locks ?? []).includes('39page-poc-hold'),
        ancestors: r.ancestors,
        libraryLength: r.libraryLength,
      }
    },
  )

  let probeHost = null
  await step(
    'P0b',
    '확장 탭 페이지 안 39page iframe — 저장소·잠금·storage 이벤트 공유',
    async () => {
      probeHost = await h.newTab(`chrome-extension://${EXT_ID}/probe-host.html`)
      const r = await waitFor(() => h.ev(probeHost.session, 'globalThis.__probeReport'), {
        label: 'probe-host report',
      })
      const eventValue = `event-${Date.now()}`
      await h.ev(
        dash.session,
        `localStorage.setItem('39page-poc-probe', ${JSON.stringify(eventValue)})`,
      )
      const again = await waitFor(
        async () => {
          const rep = await h.ev(probeHost.session, 'globalThis.__askProbe()')
          return rep.storageEvents.some((e) => e.includes(eventValue)) ? rep : null
        },
        { timeout: 5_000, label: 'storage event in framed probe' },
      ).catch(() => null)
      // 반대 방향 — iframe 이 쓴 값을 최상위 탭이 읽는다.
      await h.ev(
        probeHost.session,
        `document.querySelector('#probe').contentWindow.postMessage({ ns: '39page-poc-probe', cmd: 'write', value: 'from-frame' }, '*'); true`,
      )
      const reverse = await waitFor(
        () => h.ev(dash.session, `localStorage.getItem('39page-poc-probe-from-frame')`),
        { timeout: 5_000, label: 'reverse write' },
      ).catch(() => null)
      await h.ev(
        dash.session,
        `localStorage.setItem('39page-poc-probe', ${JSON.stringify(marker)})`,
      )
      return {
        pass: r.marker === marker && again !== null && reverse === 'from-frame',
        marker: r.marker,
        locksIncludeHold: (r.locks ?? []).includes('39page-poc-hold'),
        storageEventDelivered: again !== null,
        reverseWriteSeenByTopLevel: reverse,
      }
    },
  )
  if (probeHost) await h.closeTab(probeHost)

  /* ---------- YouTube + 패널 ---------- */

  const yt = await h.newTab(`https://www.youtube.com/watch?v=${VIDEO}`)
  const player = (expr) =>
    h.ev(
      yt.session,
      `(() => { const p = document.querySelector('#movie_player'); return p ? (${expr}) : null })()`,
    )
  let pausedAt = null
  await step('Y0', '실제 YouTube 재생 → 일시정지', async () => {
    await waitFor(() => player(`typeof p.getPlayerState === 'function'`), {
      timeout: 30_000,
      label: 'player',
    })
    await player('(p.mute(), p.playVideo(), true)')
    // 광고가 끝나고 본 영상이 재생될 때까지 (광고 길이는 제각각이다).
    await waitFor(
      () =>
        player(
          `!p.classList.contains('ad-showing') && p.getPlayerState() === 1 && p.getCurrentTime() > 2`,
        ),
      { timeout: 120_000, interval: 500, label: 'main video playing without ad' },
    )
    await player('(p.seekTo(43, true), true)')
    await waitFor(() => player(`p.getPlayerState() === 1 && p.getCurrentTime() > 44`), {
      timeout: 30_000,
      label: 'playing after seek',
    })
    await player('(p.pauseVideo(), true)')
    await sleep(500)
    pausedAt = await player('p.getCurrentTime()')
    const url = await h.ev(yt.session, 'location.href')
    return { pass: pausedAt > 44, pausedAt, url, title: await player('p.getVideoData().title') }
  })

  async function tabTargetFor(urlPart) {
    const { targetInfos } = await cdp.send('Target.getTargets', { filter: [{ type: 'tab' }] })
    return targetInfos.find((t) => t.url.includes(urlPart))
  }

  async function togglePanel() {
    // 툴바 클릭은 보이는(활성) 탭에서 일어난다 — 다른 탭을 열고 닫은 뒤에는 YouTube 탭을 앞으로.
    await cdp.send('Target.activateTarget', { targetId: yt.targetId })
    await sleep(300)
    const tab = await tabTargetFor(`watch?v=${VIDEO}`)
    if (tab === undefined) throw new Error('youtube tab target not found')
    await cdp.send('Extensions.triggerAction', { id: EXT_ID, targetId: tab.targetId })
  }

  async function openPanel() {
    await togglePanel()
    const { target, session } = await h.sessionFor(
      (t) => t.type === 'iframe' && t.url.startsWith(`chrome-extension://${EXT_ID}/panel.html`),
      'panel iframe',
      10_000,
    )
    await cdp.send('Runtime.enable', {}, session)
    await waitFor(
      () => h.ev(session, `document.readyState === 'complete' && !!globalThis.__panel`),
      {
        label: 'panel ready',
      },
    )
    return { target, session }
  }

  async function closePanel(panel) {
    await h.ev(panel.session, `document.querySelector('#close').click(); true`)
    await waitFor(
      async () => await h.ev(yt.session, `document.getElementById('__39page_poc_float') === null`),
      { label: 'panel closed', timeout: 5_000 },
    )
  }

  /** 실제 마우스 — YouTube 페이지 좌표로 누른다 (패널 iframe 의 자리 + 요소 위치). */
  async function click(panel, selector) {
    const host = await h.ev(
      yt.session,
      `(() => { const r = document.getElementById('__39page_poc_float').getBoundingClientRect(); return { x: r.x, y: r.y } })()`,
    )
    const r = await h.ev(
      panel.session,
      `(() => { const e = document.querySelector(${JSON.stringify(selector)}); e.scrollIntoView({ block: 'center' });
        const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })()`,
    )
    const x = host.x + r.x
    const y = host.y + r.y
    for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) {
      await cdp.send(
        'Input.dispatchMouseEvent',
        { type, x, y, button: 'left', clickCount: 1 },
        yt.session,
      )
    }
  }

  async function type(panel, selector, text) {
    await click(panel, selector)
    await cdp.send('Input.insertText', { text }, yt.session)
  }

  const resultOf = (panel) =>
    h.ev(
      panel.session,
      `({ state: document.querySelector('#result').dataset.state, text: document.querySelector('#result').innerText,
          busy: __panel.busy, connection: document.querySelector('#result').dataset.connection, log: __panel.log.slice(-6) })`,
    )

  async function waitResult(panel, accept, timeout = 30_000) {
    return waitFor(
      async () => {
        const r = await resultOf(panel)
        return !r.busy && accept.includes(r.state) ? r : null
      },
      { timeout, label: `result ${accept.join('|')}` },
    )
  }

  const listNames = (panel) =>
    h.ev(
      panel.session,
      `Array.from(document.querySelectorAll('#lists .row .name')).map(e => e.textContent)`,
    )

  /** 패널의 call 을 직접 — 같은 ID 재전송 · 두 경로 동시 저장을 만든다. */
  const panelCall = (panel, payloadJs, id = null, route = 'offscreen') =>
    h.ev(
      panel.session,
      `__panel.call(${payloadJs}, ${id === null ? 'crypto.randomUUID()' : JSON.stringify(id)}, '${route}')`,
    )

  async function bridgeFrameSession() {
    // offscreen 안의 브리지 iframe (사이트 격리로 별도 대상이다).
    return (
      await h.sessionFor(
        (t) => t.type === 'iframe' && t.url === `${BASE}/poc/m11-bridge/web/bridge.html`,
        'bridge iframe',
      )
    ).session
  }

  let panel = null

  await step('S1', '39page 탭이 열린 상태 — 패널에서 플레이리스트 목록 조회', async () => {
    const started = Date.now()
    panel = await openPanel()
    await waitFor(async () => (await listNames(panel)).length > 0, {
      label: 'lists',
      timeout: 20_000,
    })
    const names = await listNames(panel)
    const stored = await h.readStores(dash.session)
    const expected = stored.library.data.playlists.map((p) => p.name)
    const video = await h.ev(panel.session, '__panel.video')
    return {
      pass: JSON.stringify(names) === JSON.stringify(expected) && video?.videoId === VIDEO,
      names,
      expected,
      video,
      openToListMs: Date.now() - started,
      log: await h.ev(panel.session, '__panel.log'),
    }
  })

  const NEW_NAME = 'PoC 즉석 목록'
  await step(
    'S3',
    '새 플레이리스트 만들고 담기 (실제 마우스 · 키 입력) → 대시보드에 바로 보임',
    async () => {
      const before = await h.readStores(dash.session)
      await click(panel, '#target-new')
      await type(panel, '#new-name', NEW_NAME)
      await click(panel, '#add-track')
      const r = await waitResult(panel, ['saved', 'failed', 'partial', 'blocked', 'retry'])
      const after = await h.readStores(dash.session)
      const created = after.library.data.playlists.filter((p) => p.name === NEW_NAME)
      const dashShows = await waitFor(
        () => h.ev(dash.session, `document.body.innerText.includes(${JSON.stringify(NEW_NAME)})`),
        { timeout: 5_000, label: 'dashboard shows new playlist' },
      ).catch(() => false)
      return {
        pass:
          r.state === 'saved' &&
          created.length === 1 &&
          created[0].tracks.length === 1 &&
          created[0].tracks[0].videoId === VIDEO &&
          dashShows === true,
        result: r.text,
        createdTracks: created[0]?.tracks,
        dashboardShowsWithoutReload: dashShows,
        selectedChangedTo:
          after.library.data.selectedPlaylistId === created[0]?.id ? 'new playlist' : 'unchanged',
        selectedBefore: before.library.data.selectedPlaylistId,
      }
    },
  )

  await step('S3b', '기존 목록에 담기 · 같은 영상 안내 · 한 번 더 추가', async () => {
    const stored = await h.readStores(dash.session)
    const first = stored.library.data.playlists.find((p) => p.name === 'MY RECORDS')
    await click(panel, `#lists input[value="${first.id}"]`)
    await click(panel, '#add-track')
    const r1 = await waitResult(panel, ['saved', 'failed', 'partial', 'blocked', 'retry'])
    const dupHint = await h.ev(
      panel.session,
      `document.querySelector('#lists input[value="${first.id}"]').closest('.row').querySelector('.dup')?.textContent ?? null`,
    )
    await click(panel, '#add-track')
    const r2 = await waitResult(panel, ['saved', 'failed', 'partial', 'blocked', 'retry'])
    const after = await h.readStores(dash.session)
    const tracks = after.library.data.playlists
      .find((p) => p.id === first.id)
      .tracks.filter((t) => t.videoId === VIDEO)
    return {
      pass: r1.state === 'saved' && r2.state === 'saved' && tracks.length === 2 && dupHint !== null,
      dupHint,
      r1: r1.text,
      r2: r2.text,
      copies: tracks.length,
    }
  })

  const NOTE = `후렴 직전 ${Date.now() % 10000}`
  await step(
    'S4',
    'Moment 저장 (실제 마우스 · 키 입력) → 대시보드 Moments 에 바로 보임',
    async () => {
      await click(panel, '#tab-moment')
      await waitFor(() => h.ev(panel.session, `__panel.frozenAt !== null`), { label: 'frozen' })
      const frozenAt = await h.ev(panel.session, '__panel.frozenAt')
      await type(panel, '#note', NOTE)
      await click(panel, '#save-moment')
      const r = await waitResult(panel, ['saved', 'failed', 'blocked', 'retry'])
      const after = await h.readStores(dash.session)
      const saved = after.moments.data.filter((m) => m.note === NOTE)
      const dashShows = await waitFor(
        () => h.ev(dash.session, `document.body.innerText.includes(${JSON.stringify(NOTE)})`),
        { timeout: 5_000, label: 'dashboard shows moment' },
      ).catch(() => false)
      return {
        pass:
          r.state === 'saved' &&
          saved.length === 1 &&
          saved[0].atSeconds === Math.floor(pausedAt) &&
          saved[0].atSeconds === frozenAt &&
          dashShows === true,
        playerPausedAt: pausedAt,
        frozenAt,
        stored: saved[0],
        result: r.text,
        dashboardShowsWithoutReload: dashShows,
      }
    },
  )

  await step(
    'S5-dup',
    '중복 요청 — 같은 ID 동시 2회 + 재전송 1회 → 1건 · 다른 내용의 같은 ID 거절',
    async () => {
      const note = `dup-${Date.now()}`
      const id = `dupcheck${Date.now()}abcdef`
      const payload = `{ op: 'moment/add', videoId: '${VIDEO}', atSeconds: 42, note: '${note}', title: null }`
      const [a, b] = await h.ev(
        panel.session,
        `Promise.all([__panel.call(${payload}, '${id}'), __panel.call(${payload}, '${id}')])`,
      )
      const c = await panelCall(panel, payload, id)
      const reused = await panelCall(
        panel,
        `{ op: 'moment/add', videoId: '${VIDEO}', atSeconds: 43, note: 'other', title: null }`,
        id,
      )
      const after = await h.readStores(dash.session)
      const copies = after.moments.data.filter((m) => m.note === note)
      return {
        pass:
          copies.length === 1 &&
          [a, b, c].every((x) => x.response?.ok && x.response.data.momentId === copies[0].id) &&
          (reused.response?.error?.code ?? reused.code) === 'id-reused',
        copies: copies.length,
        sameMomentIdInAllThree: [a, b, c].map((x) => x.response?.data?.momentId),
        reusedWithOtherPayload: reused.response?.error?.code ?? reused.code,
      }
    },
  )

  await step('S5-dblclick', 'UI 연속 클릭 (실제 마우스 2회) → 1건', async () => {
    const note = `dbl-${Date.now()}`
    await h.ev(panel.session, `document.querySelector('#note').value = ''; true`)
    await type(panel, '#note', note)
    await click(panel, '#save-moment')
    await click(panel, '#save-moment')
    await waitResult(panel, ['saved', 'failed', 'blocked', 'retry'])
    await sleep(500)
    const after = await h.readStores(dash.session)
    return {
      pass: after.moments.data.filter((m) => m.note === note).length === 1,
      copies: after.moments.data.filter((m) => m.note === note).length,
    }
  })

  await step(
    'S5-partial',
    '부분 성공 — 목록 생성 O · 곡 추가 X → 전체 성공으로 보이지 않고 그 목록에 다시 담기',
    async () => {
      const bridge = await bridgeFrameSession()
      await h.ev(bridge, `globalThis.__pocFaults = { failNextAddWith: 'busy' }; true`)
      const name = 'PoC 부분 성공'
      await click(panel, '#tab-track')
      await click(panel, '#target-new')
      await h.ev(panel.session, `document.querySelector('#new-name').value = ''; true`)
      await type(panel, '#new-name', name)
      await click(panel, '#add-track')
      const r1 = await waitResult(panel, ['saved', 'failed', 'partial', 'blocked', 'retry'])
      const mid = await h.readStores(dash.session)
      const midList = mid.library.data.playlists.filter((p) => p.name === name)
      await click(panel, '#result button[data-action="retry-partial"]')
      const r2 = await waitResult(panel, ['saved', 'failed', 'partial', 'blocked', 'retry'])
      const after = await h.readStores(dash.session)
      const lists = after.library.data.playlists.filter((p) => p.name === name)
      return {
        pass:
          r1.state === 'partial' &&
          midList.length === 1 &&
          midList[0].tracks.length === 0 &&
          r2.state === 'saved' &&
          lists.length === 1 &&
          lists[0].tracks.length === 1,
        firstResult: r1.text,
        retryResult: r2.text,
        playlistsWithThatName: lists.length,
        tracks: lists[0]?.tracks.length,
      }
    },
  )

  await step(
    'S5-drop',
    '응답 중단 — 저장 뒤 응답을 버림 → 시간 초과 → 저장 여부 조회로 "저장됨" 확인 · 1건',
    async () => {
      const note = `drop-${Date.now()}`
      await click(panel, '#tab-moment')
      await sleep(1_000) // 탭 전환이 부르는 조회가 끝난 뒤에 결함을 건다 — 저장 응답만 버리게
      await h.ev(panel.session, `document.querySelector('#note').value = ''; true`)
      await type(panel, '#note', note)
      const bridge = await bridgeFrameSession()
      await h.ev(bridge, `globalThis.__pocFaults = { dropResponses: 1 }; true`)
      const started = Date.now()
      await click(panel, '#save-moment')
      // 응답을 잃으면 패널은 "확인 중" 을 잠깐 보이고 곧바로 저장 여부를 조회한다 — 최종 판정 문구로 확인한다.
      const r = await waitResult(panel, ['saved', 'failed', 'retry', 'blocked'], 40_000)
      const after = await h.readStores(dash.session)
      return {
        pass:
          r.text.includes('응답은 끊겼지만') &&
          r.state === 'saved' &&
          after.moments.data.filter((m) => m.note === note).length === 1,
        result: r.text,
        msToVerdict: Date.now() - started,
        copies: after.moments.data.filter((m) => m.note === note).length,
        log: r.log,
      }
    },
  )

  await step('S5-delay', '지연 2.5초 — 시간 초과 없이 저장됨', async () => {
    const bridge = await bridgeFrameSession()
    await h.ev(bridge, `globalThis.__pocFaults = { delayMs: 2500 }; true`)
    const note = `delay-${Date.now()}`
    await h.ev(panel.session, `document.querySelector('#note').value = ''; true`)
    await type(panel, '#note', note)
    const started = Date.now()
    await click(panel, '#save-moment')
    const r = await waitResult(panel, ['saved', 'failed', 'retry', 'blocked', 'unknown'], 30_000)
    await h.ev(bridge, `globalThis.__pocFaults = {}; true`)
    const after = await h.readStores(dash.session)
    return {
      pass: r.state === 'saved' && after.moments.data.filter((m) => m.note === note).length === 1,
      ms: Date.now() - started,
      result: r.text,
    }
  })

  async function stopServiceWorker() {
    const target = await sw()
    try {
      await cdp.send('Target.closeTarget', { targetId: target.targetId })
      return 'Target.closeTarget'
    } catch {
      const s = await cdp.attach(target.targetId)
      await cdp.send('ServiceWorker.enable', {}, panel.session)
      await cdp.send('ServiceWorker.stopAllWorkers', {}, panel.session)
      void s
      return 'ServiceWorker.stopAllWorkers'
    }
  }

  await step(
    'S5-sw',
    '서비스 워커 재시작 (요청 중) → 패널은 "확인 중" → 저장 여부 조회 → 1건',
    async () => {
      const status0 = await h.ev(
        panel.session,
        `chrome.runtime.sendMessage({ ns: '39page-poc', v: 1, type: 'poc/status' })`,
      )
      const bridge = await bridgeFrameSession()
      await h.ev(bridge, `globalThis.__pocFaults = { delayMs: 3000 }; true`)
      const note = `sw-${Date.now()}`
      await h.ev(panel.session, `document.querySelector('#note').value = ''; true`)
      await type(panel, '#note', note)
      await click(panel, '#save-moment')
      await sleep(700)
      const how = await stopServiceWorker()
      const r = await waitResult(panel, ['saved', 'failed', 'retry', 'blocked', 'unknown'], 40_000)
      await h.ev(await bridgeFrameSession(), `globalThis.__pocFaults = {}; true`)
      const status1 = await h.ev(
        panel.session,
        `chrome.runtime.sendMessage({ ns: '39page-poc', v: 1, type: 'poc/status' })`,
      )
      const after = await h.readStores(dash.session)
      return {
        pass:
          status1.startedAt !== status0.startedAt &&
          r.state === 'saved' &&
          after.moments.data.filter((m) => m.note === note).length === 1,
        stoppedWith: how,
        workerRestarted: status1.startedAt !== status0.startedAt,
        offscreenSurvived: status1.offscreen,
        result: r.text,
        log: r.log,
      }
    },
  )

  await step(
    'S5-race',
    '다른 39page 문맥과 동시 저장 — offscreen 브리지 ↔ 39page 탭 브리지가 같은 순간 저장 → 조용한 손실 0 (전파 뒤 확인)',
    async () => {
      const tabBridge = await h.newTab(`${BASE}/poc/m11-bridge/web/bridge.html?mode=connect`)
      await waitFor(
        () => h.ev(tabBridge.session, `document.documentElement.dataset.bridge === 'connected'`),
        { label: 'tab bridge connected' },
      )
      const stamp = Date.now()
      const outcomes = []
      const pairs = Number(process.env.POC_RACE_PAIRS ?? 10)
      for (let i = 0; i < pairs; i += 1) {
        const pair = await h.ev(
          panel.session,
          `Promise.all([
          __panel.call({ op: 'moment/add', videoId: '${VIDEO}', atSeconds: ${100 + i}, note: 'race-a-${stamp}-${i}', title: null }, crypto.randomUUID(), 'offscreen'),
          __panel.call({ op: 'moment/add', videoId: '${VIDEO}', atSeconds: ${100 + i}, note: 'race-b-${stamp}-${i}', title: null }, crypto.randomUUID(), 'tab-port'),
        ]).then(r => r.map(x => x.response?.ok ? 'ok' : (x.response?.error?.code ?? x.code)))`,
        )
        outcomes.push(pair)
      }
      const okCount = outcomes.flat().filter((x) => x === 'ok').length
      const raceNotes = (stores) =>
        stores.moments.data
          .filter((m) => m.note.includes('race-') && m.note.includes(`${stamp}`))
          .map((m) => m.note)
      // 바로 읽은 값과, 다른 렌더러의 쓰기가 이 탭에 도착한 뒤(값이 더 바뀌지 않을 때까지, 최대 3초) 읽은 값을 나눠 적는다.
      // 쓰기 전파는 수 ms 걸린다 (ADR 0025 실측 3–10ms) — 바로 읽은 값이 모자라도 손실이 아닐 수 있다.
      const immediate = raceNotes(await h.readStores(dash.session)).length
      let settled = immediate
      for (let tries = 0; tries < 30; tries += 1) {
        await sleep(100)
        const now = raceNotes(await h.readStores(dash.session)).length
        if (now === settled && now >= okCount) break
        settled = now
      }
      const finalNotes = raceNotes(await h.readStores(dash.session))
      const tabView = await h.ev(
        tabBridge.session,
        `JSON.parse(localStorage.getItem('39page.moments')).data.filter(m => m.note.includes('${stamp}')).length`,
      )
      const expected = []
      for (let i = 0; i < pairs; i += 1)
        expected.push(`race-a-${stamp}-${i}`, `race-b-${stamp}-${i}`)
      const missing = expected.filter((n) => !finalNotes.includes(n))
      await h.closeTab(tabBridge)
      return {
        pass:
          finalNotes.length === okCount &&
          outcomes.flat().every((x) => ['ok', 'conflict', 'busy'].includes(x)) &&
          okCount >= pairs * 2 - 2,
        pairs,
        okResponses: okCount,
        savedImmediately: immediate,
        savedSettled: finalNotes.length,
        seenByTabBridge: tabView,
        missing,
        silentLoss: okCount - finalNotes.length,
        nonOk: outcomes.flat().filter((x) => x !== 'ok'),
      }
    },
  )

  await step(
    'S5-protected',
    '손상된 Moments — 브리지가 저장하지 않고 원본 보존 · 패널은 보호 상태 안내',
    async () => {
      const original = (await h.readStores(dash.session)).moments.raw
      const broken = '{"version":1,"data":[{"broken":'
      await h.ev(dash.session, `localStorage.setItem('39page.moments', ${JSON.stringify(broken)})`)
      await sleep(300)
      const note = `protected-${Date.now()}`
      await h.ev(panel.session, `document.querySelector('#note').value = ''; true`)
      await type(panel, '#note', note)
      await click(panel, '#save-moment')
      const r = await waitResult(panel, ['saved', 'failed', 'retry', 'blocked', 'unknown'])
      const rawAfter = await h.ev(dash.session, `localStorage.getItem('39page.moments')`)
      // 시험 데이터 되돌리기 (격리 프로필)
      await h.ev(
        dash.session,
        `localStorage.setItem('39page.moments', ${JSON.stringify(original)})`,
      )
      await sleep(300)
      const hello = await panelCall(panel, `{ op: 'hello' }`)
      return {
        pass:
          r.state === 'blocked' &&
          rawAfter === broken &&
          hello.response?.data?.moments?.status === 'ready',
        result: r.text,
        rawUnchanged: rawAfter === broken,
        statusAfterRestore: hello.response?.data?.moments?.status,
      }
    },
  )

  await step('S5-lib-protected', '상위 버전 라이브러리 — 곡 담기 거절 · 원본 보존', async () => {
    const original = (await h.readStores(dash.session)).library.raw
    const future = JSON.stringify({
      version: 99,
      data: { playlists: [], selectedPlaylistId: null },
    })
    await h.ev(dash.session, `localStorage.setItem('39page.library', ${JSON.stringify(future)})`)
    await sleep(300)
    const res = await panelCall(
      panel,
      `{ op: 'track/add', playlistId: 'x', videoId: '${VIDEO}', title: null }`,
    )
    const rawAfter = await h.ev(dash.session, `localStorage.getItem('39page.library')`)
    await h.ev(dash.session, `localStorage.setItem('39page.library', ${JSON.stringify(original)})`)
    await sleep(300)
    return {
      pass: res.response?.error?.code === 'blocked' && rawAfter === future,
      code: res.response?.error?.code,
      detail: res.response?.error?.detail,
    }
  })

  await step(
    'S5-forged',
    '위조 — YouTube 페이지가 브리지를 직접 띄우고 쓰기 요청 · 확장 메시징 시도',
    async () => {
      const before = (await h.readStores(dash.session)).moments.raw
      // 공격 사이트 역할 — 127.0.0.1 과 다른 사이트인 localhost 최상위 페이지가 브리지를 액자로 띄운다.
      const evil = await h.newTab('http://localhost:4173/poc/m11-bridge/web/probe.html')
      await h.ev(
        evil.session,
        `(async () => {
        const f = document.createElement('iframe'); f.src = '${BASE}/poc/m11-bridge/web/bridge.html?forged=1'; document.body.append(f)
        await new Promise(r => f.onload = r)
        f.contentWindow.postMessage({ ns: '39page-bridge', v: 1, kind: 'request', id: 'forgedforgedforged01', deadline: Date.now() + 5000,
          payload: { op: 'moment/add', videoId: '${VIDEO}', atSeconds: 1, note: 'forged', title: null } }, '*')
        return true
      })()`,
      )
      // YouTube 페이지(메인 세계)가 이 확장에 메시지를 보낼 수 있는가 — externally_connectable 밖이다.
      const ext = await h.ev(
        yt.session,
        `(async () => { try { if (!globalThis.chrome?.runtime?.sendMessage) return 'no chrome.runtime'
        await chrome.runtime.sendMessage('${EXT_ID}', { ns: '39page-poc', v: 1, type: 'bridge/call' }); return 'sent' }
        catch (e) { return 'rejected: ' + String(e).slice(0, 80) } })()`,
      )
      const pageView = { ext }
      await sleep(1500)
      const framed = await h
        .sessionFor(
          (t) => t.type === 'iframe' && t.url === `${BASE}/poc/m11-bridge/web/bridge.html?forged=1`,
          'forged bridge iframe',
        )
        .catch(() => null)
      const stateOfForged =
        framed === null
          ? 'not-found'
          : await h.ev(framed.session, `document.documentElement.dataset.bridge ?? 'no-dataset'`)
      const after = (await h.readStores(dash.session)).moments.raw
      await h.closeTab(evil)
      // 같은 origin 의 다른 페이지(대시보드)가 externally_connectable 로 연결 → 확장이 끊는다.
      const dashConnect = await h.ev(
        dash.session,
        `(async () => { if (!globalThis.chrome?.runtime?.connect) return 'no runtime'
        const p = chrome.runtime.connect('${EXT_ID}', { name: 'x' }); return await new Promise(r => { p.onDisconnect.addListener(() => r('disconnected by extension')); setTimeout(() => r('still connected'), 2000) }) })()`,
      )
      return {
        pass:
          after === before &&
          stateOfForged === 'refused' &&
          dashConnect === 'disconnected by extension',
        forgedBridgeState: stateOfForged,
        youtubeToExtension: pageView.ext,
        momentsUnchanged: after === before,
        dashboardConnect: dashConnect,
      }
    },
  )

  await step(
    'P0c',
    'YouTube 위 확장 iframe 안의 39page — 분할된 저장소 (브리지가 거절해야 하는 이유)',
    async () => {
      await h.ev(
        panel.session,
        `(() => { const f = document.createElement('iframe'); f.src = '${BASE}/poc/m11-bridge/web/probe.html'; f.id = 'nested';
        document.querySelector('#probe-slot').append(f)
        globalThis.addEventListener('message', (e) => { if (e.source === f.contentWindow && e.data?.kind === 'loaded') __panel.nestedProbe = e.data.report }) ; return true })()`,
      )
      const r = await waitFor(() => h.ev(panel.session, '__panel.nestedProbe'), {
        label: 'nested probe',
      })
      await h.ev(
        panel.session,
        `(() => { const f = document.createElement('iframe'); f.src = '${BASE}/poc/m11-bridge/web/bridge.html?nested=1'; f.id = 'nested-bridge'; document.querySelector('#probe-slot').append(f); return true })()`,
      )
      await sleep(1500)
      const nestedBridge = await h
        .sessionFor(
          (t) => t.type === 'iframe' && t.url === `${BASE}/poc/m11-bridge/web/bridge.html?nested=1`,
          'nested bridge',
        )
        .catch(() => null)
      const nestedState =
        nestedBridge === null
          ? 'not-found'
          : await h.ev(nestedBridge.session, `document.documentElement.dataset.bridge`)
      return {
        pass: r.marker !== marker && nestedState === 'refused',
        partitioned: r.marker !== marker,
        markerSeen: r.marker,
        locksIncludeHold: (r.locks ?? []).includes('39page-poc-hold'),
        ancestors: r.ancestors,
        nestedBridge: nestedState,
      }
    },
  )

  await step(
    'S5-fallback',
    '대체 경로 — "39page 수집 화면으로 열기" → M10 수집 화면 탭',
    async () => {
      await click(panel, '#tab-track')
      await click(panel, '#fallback')
      const tab = await h.findTarget(
        (t) =>
          t.type === 'page' && t.url.startsWith(`${BASE}/#collect?v=1&kind=track&videoId=${VIDEO}`),
        'collect tab',
      )
      const s = await cdp.attach(tab.targetId)
      const text = await waitFor(
        () =>
          h.ev(
            s,
            `document.body.innerText.includes('추가를 누르기 전에는 아무것도 저장하지 않습니다') ? document.body.innerText.slice(0, 160) : null`,
          ),
        { label: 'collect view' },
      )
      await cdp.send('Target.closeTarget', { targetId: tab.targetId })
      return { url: tab.url.replace(/req=[^&]+/, 'req=…'), text }
    },
  )

  /* ---------- 후보 A: 39page 탭 포트 ---------- */

  await step(
    'A1',
    '후보 A — 39page 탭이 연결해 둔 포트로 조회 · 워커 재시작 뒤 재연결 · 탭을 닫으면 실패',
    async () => {
      const tabBridge = await h.newTab(`${BASE}/poc/m11-bridge/web/bridge.html?mode=connect`)
      await waitFor(
        () => h.ev(tabBridge.session, `document.documentElement.dataset.bridge === 'connected'`),
        { label: 'connected' },
      )
      const first = await panelCall(
        panel,
        `{ op: 'library/list', videoId: null }`,
        null,
        'tab-port',
      )
      await stopServiceWorker()
      const disconnected = await waitFor(
        () => h.ev(tabBridge.session, `document.documentElement.dataset.disconnects`),
        { timeout: 10_000, label: 'disconnect seen' },
      ).catch(() => null)
      await waitFor(
        () => h.ev(tabBridge.session, `document.documentElement.dataset.connects === '2'`),
        { timeout: 10_000, label: 'reconnected' },
      ).catch(() => null)
      const second = await panelCall(
        panel,
        `{ op: 'library/list', videoId: null }`,
        null,
        'tab-port',
      )
      await h.closeTab(tabBridge)
      await sleep(500)
      const third = await panelCall(
        panel,
        `{ op: 'library/list', videoId: null }`,
        null,
        'tab-port',
      )
      return {
        pass:
          first.response?.ok === true &&
          second.response?.ok === true &&
          third.code === 'no-bridge-tab',
        first: first.response?.ok ? `ok ${first.ms}ms` : first.code,
        pageSawDisconnect: disconnected,
        afterRestart: second.response?.ok ? `ok ${second.ms}ms` : second.code,
        afterTabClosed: third.code,
      }
    },
  )

  /* ---------- 시나리오 2: 39page 탭이 없을 때 ---------- */

  await step(
    'S2',
    '39page 탭 없음 — offscreen 새로 띄워 조회 · Moment 저장 → 나중에 연 대시보드에 있음',
    async () => {
      await closePanel(panel)
      await h.closeTab(dash)
      await swEval(`chrome.offscreen.closeDocument().catch(() => undefined).then(() => true)`)
      const open39 = (await cdp.targets()).filter(
        (t) => t.type === 'page' && t.url.startsWith(BASE),
      )
      const started = Date.now()
      panel = await openPanel()
      await waitFor(async () => (await listNames(panel)).length > 0, {
        label: 'lists without tab',
        timeout: 20_000,
      })
      const coldMs = Date.now() - started
      const note = `no-tab-${Date.now()}`
      await click(panel, '#tab-moment')
      await waitFor(() => h.ev(panel.session, `__panel.frozenAt !== null`), { label: 'frozen' })
      await type(panel, '#note', note)
      await click(panel, '#save-moment')
      const r = await waitResult(panel, ['saved', 'failed', 'retry', 'blocked', 'unknown'])
      const pagesDuring = (await cdp.targets())
        .filter((t) => t.type === 'page' && t.url.startsWith(BASE))
        .map((t) => t.url)
      dash = await h.newTab(`${BASE}/`)
      await sleep(800)
      const after = await h.readStores(dash.session)
      return {
        pass:
          open39.length === 0 &&
          pagesDuring.length === 0 &&
          r.state === 'saved' &&
          after.moments.data.some((m) => m.note === note),
        open39pageTabsBefore: open39.length,
        open39pageTabsDuring: pagesDuring,
        coldOpenToListMs: coldMs,
        result: r.text,
        foundInDashboardLater: after.moments.data.some((m) => m.note === note),
      }
    },
  )

  await step(
    'S5-down',
    '39page 서버 중단 (offscreen 새로 띄움) → "연결하지 못함" + 대체 경로 안내',
    async () => {
      await closePanel(panel)
      await swEval(`chrome.offscreen.closeDocument().catch(() => undefined).then(() => true)`)
      const server = children.find((c) => c.spawnargs.some((a) => String(a).includes('preview')))
      killTree(server)
      await sleep(800)
      const started = Date.now()
      panel = await openPanel()
      await waitFor(
        async () => {
          const x = await resultOf(panel)
          return x.connection === 'unavailable' ? x : null
        },
        { timeout: 40_000, label: 'unavailable' },
      )
      const listText = await h.ev(panel.session, `document.querySelector('#lists').innerText`)
      await startServer()
      return { pass: true, msToUnavailable: Date.now() - started, listText }
    },
  )

  /* ---------- P0d: 호스트 권한 없는 확장 ---------- */

  await step('P0d', '호스트 권한이 없으면 확장 페이지 안 39page iframe 은 분할된다', async () => {
    const variant = path.join(OUT, 'ext-nohost')
    rmSync(variant, { recursive: true, force: true })
    cpSync(EXT_DIR, variant, { recursive: true })
    const manifest = JSON.parse(readFileSync(path.join(variant, 'manifest.json'), 'utf8'))
    delete manifest.host_permissions
    writeFileSync(path.join(variant, 'manifest.json'), JSON.stringify(manifest, null, 2))
    const second = await launch(variant)
    const h2 = helpers(second.cdp)
    const d2 = await h2.newTab(`${BASE}/`)
    await sleep(800)
    await h2.ev(d2.session, `localStorage.setItem('39page-poc-probe', 'nohost-marker')`)
    const host = await h2.newTab(`chrome-extension://${EXT_ID}/probe-host.html`)
    const r = await waitFor(() => h2.ev(host.session, 'globalThis.__probeReport'), {
      label: 'probe',
    })
    second.cdp.close()
    killTree(second.chrome)
    return {
      pass: r.marker !== 'nohost-marker',
      markerSeen: r.marker,
      partitioned: r.marker !== 'nohost-marker',
    }
  })

  const file = path.join(OUT, 'results', `run-${env.startedAt.replace(/[:.]/g, '-')}.json`)
  writeFileSync(file, JSON.stringify({ env, results }, null, 2))
  console.log(`\n${results.filter((r) => r.pass).length}/${results.length} passed · ${file}`)
}

try {
  await main()
} catch (error) {
  console.error('harness failed:', error)
  process.exitCode = 1
} finally {
  for (const child of children) killTree(child)
}
