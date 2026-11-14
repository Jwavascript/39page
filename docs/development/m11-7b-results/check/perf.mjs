// M11-4 Moments 보관함 — 실제 Chromium 성능 측정 (기준 빌드 vs 새 빌드 같은 시나리오).
// 격리 프로필 · 로컬 빌드(vite preview) · 운영 사이트 접속 없음. 시험 데이터는 격리 프로필의 localStorage 에만.
//
//   REPO=… POC_CHROME=… DIST=<빌드 폴더> LABEL=baseline|m11-4 PORT=4180 OUT=… [WIDTH=1440 HEIGHT=900 MOBILE=0]
//
// 시간 = 조작 직전 performance.now() → (필요하면 결과가 DOM 에 나타날 때까지) → 다음 프레임이 그려진 뒤.
// "다음 프레임이 그려진 뒤" = requestAnimationFrame 콜백 안의 setTimeout(0) — 레이아웃 · 그리기가 끝난 시점.
import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const REPO = process.env.REPO
const CHROME = process.env.POC_CHROME
const DIST = process.env.DIST
const LABEL = process.env.LABEL
const PORT = Number(process.env.PORT ?? 4180)
const OUT = process.env.OUT
const WIDTH = Number(process.env.WIDTH ?? 1440)
const HEIGHT = Number(process.env.HEIGHT ?? 900)
const MOBILE = process.env.MOBILE === '1'
const SIZES = (process.env.SIZES ?? '10,100,1000,5000').split(',').map(Number)
const REPS = Number(process.env.REPS ?? 3)
const CPU = Number(process.env.CPU ?? 1)
const BASE = `http://127.0.0.1:${PORT}`

const { connectBrowser, sleep, waitFor } = await import(
  'file:///' + path.join(REPO, 'extension/integration/cdp.mjs').replaceAll('\\', '/')
)
mkdirSync(OUT, { recursive: true })

const children = []
function killTree(child) {
  if (child.exitCode !== null) return
  spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
}

/* ── 시험 데이터 ──────────────────────────────────────────────────── */
const REAL = ['M7lc1UVf-VE', 'aqz-KE-bpKQ']
const SONGS = { 10: 3, 100: 25, 1000: 200, 5000: 1000 }
const WORDS = [
  '후렴',
  '베이스',
  '드럼',
  '인트로',
  '브리지',
  '기타 솔로',
  '목소리',
  '여기서 소름',
  '가사',
  '박자',
  '조용한 부분',
  '하이햇',
  '코러스',
  '전주',
]
function rng(seed) {
  let x = seed >>> 0
  return () => (x = (x * 1664525 + 1013904223) >>> 0) / 2 ** 32
}
const vid = (s) => REAL[s] ?? `p${String(s).padStart(10, '0')}`
function dataset(n) {
  const songs = SONGS[n]
  const r = rng(n)
  const moments = []
  const base = Date.UTC(2026, 0, 1)
  for (let i = 0; i < n; i += 1) {
    const s = Math.floor(r() * songs)
    const words = Array.from(
      { length: 1 + Math.floor(r() * 5) },
      () => WORDS[Math.floor(r() * WORDS.length)],
    )
    let note = words.join(' ')
    if (i % 50 === 0) note += `\n둘째 줄 — 메모 ${i}`
    if (i % 11 === 0) note = ''
    const at = new Date(base + i * 97_000).toISOString()
    moments.push({
      id: `m${i}`,
      source: 'youtube',
      videoId: vid(s),
      atSeconds: Math.floor(r() * 300),
      note,
      title: `곡 ${s} — Artist ${s % 37}`,
      createdAt: at,
      updatedAt: at,
    })
  }
  const inLibrary = Math.max(2, Math.floor(songs * 0.4))
  const tracks = Array.from({ length: inLibrary }, (_, s) => ({
    id: `t${s}`,
    source: 'youtube',
    videoId: vid(s),
    title: `곡 ${s} — Artist ${s % 37}`,
  }))
  const library = {
    version: 1,
    data: {
      playlists: [
        { id: 'perf', name: 'PERF 목록', tracks },
        {
          id: 'perf-2',
          name: '드라이브',
          tracks: tracks.filter((_, i) => i % 3 === 0).map((t) => ({ ...t, id: `x${t.id}` })),
        },
      ],
      selectedPlaylistId: 'perf',
    },
  }
  return { library, moments: { version: 1, data: moments } }
}

/* ── 브라우저 ─────────────────────────────────────────────────────── */
const server = spawn(
  process.execPath,
  [
    path.join(REPO, 'node_modules/vite/bin/vite.js'),
    'preview',
    '--outDir',
    DIST,
    '--host',
    '127.0.0.1',
    '--port',
    String(PORT),
    '--strictPort',
  ],
  { cwd: REPO, stdio: 'ignore' },
)
children.push(server)
await waitFor(async () => (await fetch(`${BASE}/`)).ok, { timeout: 20000, label: 'server' })

const profile = mkdtempSync(path.join(tmpdir(), '39page-m114-perf-'))
const chrome = spawn(
  CHROME,
  [
    '--headless=new',
    '--remote-debugging-port=0',
    `--user-data-dir=${profile}`,
    '--no-first-run',
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
      return (
        Number(readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').split(/\r?\n/)[0]) ||
        null
      )
    } catch {
      return null
    }
  },
  { timeout: 30000, label: 'port' },
)
const cdp = await connectBrowser(port)
const results = {
  browser: cdp.version,
  label: LABEL,
  viewport: `${WIDTH}x${HEIGHT}${MOBILE ? ' mobile' : ''}`,
  cpuThrottle: CPU,
  at: new Date().toISOString(),
  sizes: {},
}

const HELPERS = `(() => {
  const frame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)))
  const until = (check, ms = 20000) => new Promise((resolve, reject) => {
    if (check()) return resolve()
    const mo = new MutationObserver(() => { if (check()) { mo.disconnect(); resolve() } })
    mo.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true })
    setTimeout(() => { mo.disconnect(); reject(new Error('until timeout')) }, ms)
  })
  const P = () => document.querySelector('#archive-panel-moments')
  const chip = (prefix) => [...P().querySelectorAll('.chip')].find((b) => b.textContent.trim().startsWith(prefix))
  const nodes = () => ({ panel: P() ? P().querySelectorAll('*').length : 0, page: document.querySelectorAll('*').length, rows: P() ? P().querySelectorAll('.moment-item').length : 0, heads: P() ? P().querySelectorAll('.moment-group').length : 0 })
  async function time(act, check) {
    const t0 = performance.now()
    await act()
    if (check) await until(check)
    await frame()
    return Math.round((performance.now() - t0) * 10) / 10
  }
  window.__m = { frame, until, P, chip, nodes, time }
})(); true`

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)]
}

try {
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' })
  const s = await cdp.attach(targetId)
  await cdp.send('Page.enable', {}, s)
  await cdp.send('Runtime.enable', {}, s)
  await cdp.send('Performance.enable', {}, s)
  const ev = (expr) => cdp.evaluate(s, expr)
  await cdp.send(
    'Emulation.setDeviceMetricsOverride',
    { width: WIDTH, height: HEIGHT, deviceScaleFactor: 1, mobile: MOBILE },
    s,
  )
  if (CPU > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU }, s)
  if (MOBILE)
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 }, s)
  const metrics = async () =>
    Object.fromEntries(
      (await cdp.send('Performance.getMetrics', {}, s)).metrics.map((m) => [m.name, m.value]),
    )
  /** 조작 하나 — 시간과 함께 레이아웃 · 스타일 · 스크립트 시간(CDP 누적값의 차)을 남긴다. */
  async function op(expr) {
    const before = await metrics()
    const ms = await ev(expr)
    const after = await metrics()
    const d = (k) => Math.round((after[k] - before[k]) * 10000) / 10
    return {
      ms,
      layout: d('LayoutDuration'),
      style: d('RecalcStyleDuration'),
      script: d('ScriptDuration'),
    }
  }

  for (const n of SIZES) {
    const { library, moments } = dataset(n)
    await cdp.send('Page.navigate', { url: `${BASE}/` }, s)
    await sleep(1200)
    await ev(
      `localStorage.clear(); localStorage.setItem('39page.library', ${JSON.stringify(JSON.stringify(library))}); localStorage.setItem('39page.moments', ${JSON.stringify(JSON.stringify(moments))}); true`,
    )
    await cdp.send('Page.reload', {}, s)
    await waitFor(() => ev(`!!document.querySelector('.moments-widget .widget-head .pill')`), {
      timeout: 20000,
      label: 'app',
    })
    await ev(HELPERS)

    // 지금 곡 = 실제 YouTube 영상 하나 (이 곡 보기용). 재생이 시작되면 멈춘다 — 영상 디코딩이 측정을 흔들지 않게.
    await ev(
      `(document.querySelector('.playlist-play') ?? document.querySelector('.now-playlist .track-row')).click(); true`,
    )
    await waitFor(() => ev(`!!document.querySelector('.player-mount iframe')`), {
      timeout: 30000,
      label: 'iframe',
    })
    await ev(`document.querySelector('.player-mount iframe').dataset.m114 = 'original'; true`)
    await sleep(4000)
    await ev(
      `(() => { const b = [...document.querySelectorAll('button')].find((x) => /일시정지|멈춤/.test(x.getAttribute('aria-label') ?? '')); b?.click(); return !!b })()`,
    )
    await sleep(800)
    const isNew = (await ev(`true`)) && LABEL !== 'baseline'
    const run = { songs: SONGS[n] }

    // 1. 보관함 Moments 탭 처음 열기 (마운트 + 첫 그리기)
    run.open = await op(
      `__m.time(() => document.querySelector('.moments-widget .widget-head .pill').click(), () => !!__m.P() && !__m.P().hidden && __m.P().querySelector('.moment-item, .moment-group, .empty'))`,
    )
    run.nodesOpen = await ev(`__m.nodes()`)
    await sleep(300)

    // 2. 보기 바꾸기 — 이 곡 → 전체 (M9-6 의 2–3 초 경우는 "전체로 되돌리기")
    const toCurrent = []
    const toAll = []
    for (let i = 0; i < REPS; i += 1) {
      toCurrent.push(await op(`__m.time(() => __m.chip('이 곡').click())`))
      run.nodesCurrent = await ev(`__m.nodes()`)
      await sleep(200)
      toAll.push(await op(`__m.time(() => __m.chip('전체').click())`))
      await sleep(200)
    }
    run.filterToCurrent = toCurrent
    run.filterToAll = toAll
    run.nodesAll = await ev(`__m.nodes()`)

    if (isNew) {
      // 3. 최근 보기 → 전체
      const recent = []
      for (let i = 0; i < REPS; i += 1) {
        recent.push(await op(`__m.time(() => __m.chip('최근').click())`))
        run.nodesRecent = await ev(`__m.nodes()`)
        await sleep(200)
        await op(`__m.time(() => __m.chip('전체').click())`)
        await sleep(200)
      }
      run.filterToRecent = recent

      // 4. 묶음 열기 · 닫기 — 접힌 묶음 하나 (없으면 첫 묶음)
      const groupOpen = []
      const groupClose = []
      for (let i = 0; i < REPS; i += 1) {
        const sel = `(__m.P().querySelector('.group-toggle[aria-expanded="false"]') ?? __m.P().querySelector('.group-toggle'))`
        await ev(`window.__g = ${sel}.dataset.groupToggle; true`)
        groupOpen.push(
          await op(
            `__m.time(() => __m.P().querySelector('[data-group-toggle="' + __g + '"]').click())`,
          ),
        )
        await sleep(150)
        groupClose.push(
          await op(
            `__m.time(() => __m.P().querySelector('[data-group-toggle="' + __g + '"]').click())`,
          ),
        )
        await sleep(150)
      }
      run.groupToggle = { open: groupOpen, close: groupClose }

      // 5. 검색 — 입력 → Enter(바로 적용) → 결과 그리기 / Esc 로 지우기
      const searchApply = []
      const searchClear = []
      for (const q of ['후렴', '곡 1', '소름 박자']) {
        searchApply.push({
          q,
          ...(await op(
            `__m.time(() => { const i = document.querySelector('#archive-moments-search'); i.value = ${JSON.stringify(q)}; i.dispatchEvent(new Event('input', { bubbles: true })); i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })) }, () => document.querySelector('#archive-moments-summary').textContent.trim() !== '')`,
          )),
        })
        searchApply[searchApply.length - 1].nodes = await ev(`__m.nodes()`)
        searchApply[searchApply.length - 1].summary = await ev(
          `document.querySelector('#archive-moments-summary').textContent.trim()`,
        )
        await sleep(200)
        searchClear.push(
          await op(
            `__m.time(() => document.querySelector('#archive-moments-search').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })), () => document.querySelector('#archive-moments-summary').textContent.trim() === '')`,
          ),
        )
        await sleep(200)
      }
      run.search = searchApply
      run.searchClear = searchClear

      // 6. 더 보기 (묶음 30개)
      run.showMore = (await ev(`!!__m.P().querySelector('.more button')`))
        ? await op(`__m.time(() => __m.P().querySelector('.more button').click())`)
        : null
      run.nodesAfterMore = await ev(`__m.nodes()`)
      // 처음 상태로 (다시 30묶음)
      await op(`__m.time(() => __m.chip('최근').click())`)
      await op(`__m.time(() => __m.chip('전체').click())`)
      await sleep(200)
    }

    // 6b. (FULL=1) 끝까지 그린 뒤 — 더 보기를 끝까지 누르고, 그 상태에서 검색 · 지우기 · 묶음 열기 · 메모 저장
    if (isNew && process.env.FULL === '1') {
      const clicks = []
      while (await ev(`!!__m.P().querySelector('.more button')`))
        clicks.push((await op(`__m.time(() => __m.P().querySelector('.more button').click())`)).ms)
      run.full = {
        clicks: clicks.length,
        clickMedian: clicks.length ? median(clicks) : null,
        clickMax: clicks.length ? Math.max(...clicks) : null,
        nodes: await ev(`__m.nodes()`),
      }
      run.full.search = await op(
        `__m.time(() => { const i = document.querySelector('#archive-moments-search'); i.value = '소름 박자'; i.dispatchEvent(new Event('input', { bubbles: true })); i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })) }, () => document.querySelector('#archive-moments-summary').textContent.trim() !== '')`,
      )
      run.full.searchNodes = await ev(`__m.nodes()`)
      run.full.searchClear = await op(
        `__m.time(() => document.querySelector('#archive-moments-search').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })), () => document.querySelector('#archive-moments-summary').textContent.trim() === '')`,
      )
      run.full.afterClearNodes = await ev(`__m.nodes()`)
      run.full.groupOpen = await op(
        `__m.time(() => [...__m.P().querySelectorAll('.group-toggle[aria-expanded="false"]')].at(-1).click())`,
      )
      console.log('full', JSON.stringify(run.full))
    }

    // 7. 메모 수정 → 저장 → 반영 (탭 간 잠금 · 저장소 쓰기 포함). 화면에 보이는 첫 줄들.
    const edit = []
    const editOpen = []
    for (let i = 0; i < REPS; i += 1) {
      const id = await ev(
        `__m.P().querySelectorAll('[data-moment-manage]')[${i}].dataset.momentManage`,
      )
      await ev(`__m.P().querySelector('[data-moment-manage="${id}"]').click(); true`)
      await ev(`__m.frame().then(() => true)`)
      editOpen.push(
        await op(
          `__m.time(() => __m.P().querySelector('[data-moment-edit="${id}"]').click(), () => !!document.getElementById('archive-moment-note-${id}'))`,
        ),
      )
      await ev(
        `(() => { const t = document.getElementById('archive-moment-note-${id}'); t.value = '측정 메모 ${i} — 고친 뒤 반영까지'; t.dispatchEvent(new Event('input', { bubbles: true })); return true })()`,
      )
      edit.push(
        await op(
          `__m.time(() => document.getElementById('archive-moment-note-${id}').form.requestSubmit(), () => !document.getElementById('archive-moment-note-${id}') && [...__m.P().querySelectorAll('.feedback')].some((f) => f.textContent.includes('메모를 고쳤어요')))`,
        ),
      )
      await sleep(250)
    }
    run.editOpen = editOpen
    run.editSave = edit
    run.persisted = await ev(
      `JSON.parse(localStorage.getItem('39page.moments')).data.filter((m) => m.note.startsWith('측정 메모')).length`,
    )
    run.iframeSame = await ev(
      `document.querySelectorAll('.player-mount iframe').length === 1 && document.querySelector('.player-mount iframe').dataset.m114 === 'original'`,
    )

    // 요약 (중앙값)
    const med = (list) => (list && list.length ? median(list.map((x) => x.ms)) : null)
    run.summary = {
      open: run.open.ms,
      filterToCurrent: med(run.filterToCurrent),
      filterToAll: med(run.filterToAll),
      filterToRecent: med(run.filterToRecent),
      groupOpen: med(run.groupToggle?.open),
      groupClose: med(run.groupToggle?.close),
      search: run.search ? median(run.search.map((x) => x.ms)) : null,
      searchClear: med(run.searchClear),
      showMore: run.showMore?.ms ?? null,
      editOpen: med(run.editOpen),
      editSave: med(run.editSave),
      nodesOpen: run.nodesOpen,
      nodesAll: run.nodesAll,
    }
    console.log(`${LABEL} n=${n}`, JSON.stringify(run.summary))
    results.sizes[n] = run
  }
  const file = path.join(
    OUT,
    `perf-${LABEL}-${WIDTH}x${HEIGHT}${MOBILE ? '-mobile' : ''}${CPU > 1 ? `-cpu${CPU}` : ''}.json`,
  )
  writeFileSync(file, JSON.stringify(results, null, 2))
  console.log(file)
  cdp.close()
} catch (error) {
  console.error('perf failed:', error)
  process.exitCode = 1
} finally {
  for (const child of children) killTree(child)
}
