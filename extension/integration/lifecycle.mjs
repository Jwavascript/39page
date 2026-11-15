/**
 * M11-6 — offscreen 생명주기 · 자원 · 속도 측정 (실제 Chrome · 실제 YouTube · 격리 프로필 · 로컬 빌드).
 *
 *   POC_CHROME=<…> WEB_DIST=<…> EXT_DIST=<…/dist-dev> OUT=<…> [IDLE_MS=360000] node extension/integration/lifecycle.mjs
 *
 * 메모리: 그 Chrome 의 프로세스 묶음 전체 작업 집합(Windows) + offscreen · 브리지 문서의 JS 힙. 시간은 여러 번 재
 * 중앙값과 사분위 범위(IQR)를 남긴다.
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { DEV_EXTENSION_ID, ORIGIN_PATTERN, launch, sleep, waitFor } from './harness.mjs'

const { POC_CHROME, WEB_DIST, EXT_DIST, OUT } = process.env
const IDLE_MS = Number(process.env.IDLE_MS ?? 360_000)
const h = await launch({ chrome: POC_CHROME, webDist: WEB_DIST, extDist: EXT_DIST })
const report = { browser: h.cdp.version }

const stats = (xs) => {
  const s = [...xs].sort((a, b) => a - b)
  const q = (p) => s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))]
  return { n: s.length, median: q(0.5), p25: q(0.25), p75: q(0.75), min: s[0], max: s.at(-1) }
}

/** 이 Chrome 프로세스 묶음의 작업 집합 합 (MB) · 프로세스 수. */
function chromeMemory() {
  const ps = `$root=${h.browserPid}; $all=Get-CimInstance Win32_Process -Filter "Name='chrome.exe'"; $ids=@($root); do { $n=$ids.Count; $ids += @($all | Where-Object { $ids -contains $_.ParentProcessId -and -not ($ids -contains $_.ProcessId) } | ForEach-Object { $_.ProcessId }) } while ($ids.Count -gt $n); $sum=($all | Where-Object { $ids -contains $_.ProcessId } | Measure-Object -Property WorkingSetSize -Sum).Sum; "{0} {1}" -f [math]::Round($sum/1MB,1), $ids.Count`
  const [mb, count] = execFileSync('powershell', ['-NoProfile', '-Command', ps], {
    encoding: 'utf8',
  })
    .trim()
    .split(' ')
  return { mb: Number(mb), processes: Number(count) }
}

try {
  // 제어용 확장 페이지는 따로 창에 — YouTube 탭과 같은 창이면 팝업 로직이 패널을 열고 이 탭을 닫는다(M11-6 실측).
  const page = await h.tab(`chrome-extension://${DEV_EXTENSION_ID}/src/popup/index.html`, {
    newWindow: true,
  })
  await page.ev(`window.__b = {
    call: (payload) => chrome.runtime.sendMessage({ v: 1, type: 'bridge/call', requestId: crypto.randomUUID(), payload }).then((r) => r.ok ? r.data : { routerError: r.error.code }),
    contexts: () => chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] }).then((c) => c.length),
  }; true`)
  const offscreenCount = () => page.ev(`__b.contexts()`)
  const timed = async (payload) => {
    const t0 = Date.now()
    const r = await page.ev(`__b.call(${JSON.stringify(payload)})`)
    return { ms: Date.now() - t0, outcome: r.outcome ?? r.routerError }
  }
  const heaps = async () => {
    const out = {}
    for (const t of await h.cdp.targets()) {
      const kind = t.url.includes('/src/offscreen/index.html')
        ? 'offscreen'
        : t.url.includes('/bridge.html')
          ? 'bridge'
          : null
      if (kind === null) continue
      try {
        const s = await h.cdp.attach(t.targetId)
        const heap = await h.cdp.send('Runtime.getHeapUsage', {}, s)
        out[kind] = { heapKB: Math.round(heap.usedSize / 1024) }
      } catch (error) {
        out[kind] = { error: error.message.slice(0, 60) }
      }
    }
    return out
  }

  await sleep(2000)
  report.afterInstall = { offscreen: await offscreenCount(), memory: chromeMemory() }

  // 권한 (실제 프롬프트)
  await h.cdp.send('Target.activateTarget', { targetId: page.targetId })
  const asked = page.ev(`chrome.permissions.request({ origins: ['${ORIGIN_PATTERN}'] })`, {
    userGesture: true,
    timeout: 25_000,
  })
  await h.clickPrompt('Allow|허용', 8_000)
  report.granted = await asked
  report.beforeBridge = { offscreen: await offscreenCount(), memory: chromeMemory() }

  // 첫 연결 (offscreen + 39page 브리지 기동 + 첫 조회)
  const first = await timed({ op: 'library/list', videoId: null })
  report.firstConnect = {
    ...first,
    offscreen: await offscreenCount(),
    memory: chromeMemory(),
    heaps: await heaps(),
  }

  // 반복 (연결된 상태) — 조회 · 곡 담기 · Moment 저장 각 15회
  const created = await page.ev(
    `__b.call({ op: 'playlist/create-and-add', name: '측정', videoId: 'aqz-KE-bpKQ', title: null })`,
  )
  const listId = created.data?.playlistId
  const runs = { list: [], trackAdd: [], momentSave: [] }
  for (let i = 0; i < 15; i += 1) {
    runs.list.push((await timed({ op: 'library/list', videoId: 'aqz-KE-bpKQ' })).ms)
    runs.trackAdd.push(
      (
        await timed({
          op: 'track/add',
          playlistId: listId,
          videoId: 'M7lc1UVf-VE',
          title: `t${i}`,
          allowDuplicate: true,
        })
      ).ms,
    )
    runs.momentSave.push(
      (
        await timed({
          op: 'moment/add',
          videoId: 'M7lc1UVf-VE',
          atSeconds: i,
          note: `m${i}`,
          title: null,
        })
      ).ms,
    )
  }
  report.warm = Object.fromEntries(Object.entries(runs).map(([k, v]) => [k, stats(v)]))
  report.after45Writes = {
    offscreen: await offscreenCount(),
    memory: chromeMemory(),
    heaps: await heaps(),
  }

  // 다시 연결 — 문서를 닫고 첫 요청 (5회)
  const reconnect = []
  for (let i = 0; i < 5; i += 1) {
    const sw = await h.serviceWorker()
    const s = await h.cdp.attach(sw.targetId)
    await h.cdp.evaluate(s, `chrome.offscreen.closeDocument().then(() => true, () => false)`)
    await sleep(300)
    reconnect.push((await timed({ op: 'library/list', videoId: null })).ms)
  }
  report.reconnectAfterClose = stats(reconnect)

  // 워커 멈춤 → 다음 요청 (워커 시작이 내력 모르는 문서를 닫고 다시 띄운다) (5회)
  const afterSw = []
  for (let i = 0; i < 5; i += 1) {
    await h.stopWorker(page.session)
    afterSw.push((await timed({ op: 'library/list', videoId: null })).ms)
  }
  report.firstCallAfterWorkerStop = stats(afterSw)

  // 패널 최초 표시 (실제 YouTube, 툴바 → 팝업 → 패널 앱 준비) — 탭마다 첫 번 · 같은 탭 다음 번
  const yt = await h.tab('https://www.youtube.com/watch?v=M7lc1UVf-VE')
  await waitFor(
    () =>
      yt.ev(`!!document.querySelector('video') && document.querySelector('video').currentTime > 1`),
    { timeout: 45_000, label: 'yt' },
  )
  const panelOpen = []
  for (let i = 0; i < 6; i += 1) {
    const tab = await waitFor(
      async () =>
        (await h.cdp.targets()).find(
          (t) => t.type === 'tab' && t.url.includes('youtube.com/watch'),
        ),
      { label: 'tab' },
    )
    await h.cdp.send('Target.activateTarget', { targetId: yt.targetId })
    // 이전 클릭의 팝업 대상이 늦게 사라질 수 있다 — 누르기 전에 있던 것은 세지 않는다.
    const seenBefore = new Set(
      (await h.cdp.targets())
        .filter((t) => t.url.includes('/src/popup/index.html'))
        .map((t) => t.targetId),
    )
    const t0 = Date.now()
    await h.cdp.send('Extensions.triggerAction', { id: DEV_EXTENSION_ID, targetId: tab.targetId })
    // 팝업이 떴는지(깜빡임) — 패널 iframe 이 나타날 때까지 대상 목록을 본다.
    let popupAppeared = false
    const target = await waitFor(
      async () => {
        const all = await h.cdp.targets()
        if (all.some((t) => t.url.includes('/src/popup/index.html') && !seenBefore.has(t.targetId)))
          popupAppeared = true
        return all.find((t) => t.type === 'iframe' && t.url.includes('/src/panel/index.html'))
      },
      { timeout: 15_000, interval: 30, label: 'panel' },
    )
    const s = await h.cdp.attach(target.targetId)
    await h.cdp.send('Runtime.enable', {}, s)
    await waitFor(() => h.cdp.evaluate(s, `document.querySelectorAll('.list-row').length > 0`), {
      timeout: 15_000,
      label: 'lists',
    })
    const ms = Date.now() - t0
    panelOpen.push({ ms, popupAppeared })
    await h.cdp.evaluate(s, `document.querySelector('.close').click(); true`)
    await waitFor(() => yt.ev(`document.getElementById('page39-panel-host') === null`), {
      label: 'closed',
    })
  }
  report.panelToLists = {
    runs: panelOpen,
    first: panelOpen[0],
    rest: stats(panelOpen.slice(1).map((p) => p.ms)),
  }

  // 유휴 — 패널을 닫고 IDLE_MS 동안 아무것도 하지 않는다 (워커는 30초 뒤 멈춘다)
  report.idleStart = {
    offscreen: await offscreenCount(),
    memory: chromeMemory(),
    worker: await h.workerRunning(),
  }
  await sleep(IDLE_MS)
  report.idleEnd = {
    afterMs: IDLE_MS,
    offscreen: await offscreenCount(),
    memory: chromeMemory(),
    worker: await h.workerRunning(),
    heaps: await heaps(),
  }

  // 유휴 뒤 첫 요청 — 유휴로 닫혔으면 다시 띄운다 (M11-6 유휴 정리)
  const afterIdle = await timed({ op: 'library/list', videoId: null })
  report.firstCallAfterIdle = {
    ms: afterIdle.ms,
    outcome: afterIdle.outcome,
    offscreen: await offscreenCount(),
  }

  // 권한 철회 · 재허용
  await page.ev(`chrome.permissions.remove({ origins: ['${ORIGIN_PATTERN}'] })`, {
    userGesture: true,
  })
  await sleep(1000)
  report.afterRevoke = { offscreen: await offscreenCount(), memory: chromeMemory() }
  const again = page.ev(`chrome.permissions.request({ origins: ['${ORIGIN_PATTERN}'] })`, {
    userGesture: true,
    timeout: 25_000,
  })
  await h.clickPrompt('Allow|허용', 6_000)
  await again
  const regrant = await timed({ op: 'library/list', videoId: null })
  report.afterRegrant = {
    firstCallMs: regrant.ms,
    outcome: regrant.outcome,
    offscreen: await offscreenCount(),
  }

  mkdirSync(OUT, { recursive: true })
  const file = path.join(OUT, `lifecycle-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
  writeFileSync(file, JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report))
  console.log(file)
  h.cdp.close()
} catch (error) {
  console.error('harness failed:', error)
  writeFileSync(path.join(OUT, 'lifecycle-partial.json'), JSON.stringify(report, null, 2))
  process.exitCode = 1
} finally {
  h.kill()
}
