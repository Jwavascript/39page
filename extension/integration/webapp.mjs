/**
 * M11-6 — 웹앱 통합 시나리오 (실제 Chrome · 실제 YouTube · 실제 마우스 · 키 입력 · 격리된 빈 프로필).
 *
 *   POC_CHROME=<chrome.exe> WEB_DIST=<빌드> OUT=<…> node extension/integration/webapp.mjs
 *
 * 하네스는 기능 위치를 **알고** 누른다 — 처음 방문자 사용성의 객관적 증거가 아니다. 대신 각 일을 끝내는 데
 * 든 조작 수(클릭 · 키 · 입력)를 세고, 첫 화면에 보이는 글을 남겨 사람이 판단하게 한다.
 * 파괴적인 가져오기 · 삭제는 이 격리 프로필의 시험 데이터에만 한다.
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { BASE, REPO, launch, recorder, sleep, waitFor } from './harness.mjs'

const { POC_CHROME, WEB_DIST, OUT } = process.env
const URL_A = 'https://youtu.be/M7lc1UVf-VE'
const URL_B = 'https://www.youtube.com/watch?v=aqz-KE-bpKQ'
const h = await launch({ chrome: POC_CHROME, webDist: WEB_DIST })
const { results, step } = recorder()
const downloads = path.join(OUT, `downloads-${Date.now()}`)
mkdirSync(downloads, { recursive: true })

try {
  const page = await h.tab(`${BASE}/`)
  const { session, ev } = page
  await h.cdp.send('Page.enable', {}, session)
  await h.cdp.send(
    'Emulation.setDeviceMetricsOverride',
    { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false },
    session,
  )
  await h.cdp.send('Browser.setDownloadBehavior', {
    behavior: 'allow',
    downloadPath: downloads,
    eventsEnabled: true,
  })
  await waitFor(() => ev(`!!document.querySelector('.app-nav')`), { label: 'app' })

  let actions = 0
  const center = (sel) =>
    ev(
      `(() => { const e = ${sel}; if (!e) return null; e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })()`,
    )
  async function click(sel) {
    const p = await center(sel)
    if (p === null) throw new Error(`없음: ${sel.slice(0, 90)}`)
    for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) {
      await h.cdp.send(
        'Input.dispatchMouseEvent',
        { type, x: p.x, y: p.y, button: 'left', clickCount: 1 },
        session,
      )
    }
    actions += 1
    await sleep(300)
  }
  async function type(text) {
    await h.cdp.send('Input.insertText', { text }, session)
    actions += 1
    await sleep(250)
  }
  async function key(k) {
    const code = { Enter: 13, Escape: 27 }[k]
    // Enter 는 text 가 있어야 폼이 제출된다 (실제 키보드와 같게).
    for (const t of ['keyDown', 'keyUp'])
      await h.cdp.send(
        'Input.dispatchKeyEvent',
        {
          type: t,
          key: k,
          code: k,
          windowsVirtualKeyCode: code,
          ...(t === 'keyDown' && k === 'Enter' ? { text: '\r' } : {}),
        },
        session,
      )
    actions += 1
    await sleep(300)
  }
  const byText = (scope, tag, text) =>
    `[...${scope}.querySelectorAll('${tag}')].find((e) => e.textContent.replace(/\\s+/g, ' ').trim().includes(${JSON.stringify(text)}))`
  const doc = 'document'
  const storage = () =>
    ev(
      `(() => { const l = JSON.parse(localStorage.getItem('39page.library') ?? 'null')?.data; const m = JSON.parse(localStorage.getItem('39page.moments') ?? 'null')?.data ?? []; return { lists: l?.playlists.map((p) => p.name + ':' + p.tracks.map((t) => t.title).join('|')) ?? [], selected: l?.selectedPlaylistId ?? null, moments: m.map((x) => x.atSeconds + ':' + x.note) } })()`,
    )
  /** 이름으로 목록 — 빈 프로필에도 기본 목록(MY RECORDS)이 있다. */
  const listOf = (st, name) => st.lists.find((l) => l.startsWith(`${name}:`)) ?? ''
  const iframe = () =>
    ev(
      `(() => { const f = document.querySelectorAll('.player-mount iframe'); return { count: f.length, marker: f[0]?.dataset.m116 ?? null } })()`,
    )
  async function playerState() {
    const yt = (await h.cdp.targets()).find(
      (t) => t.type === 'iframe' && t.url.includes('/embed/') && t.url.includes('127.0.0.1'),
    )
    if (!yt) return null
    const s = await h.cdp.attach(yt.targetId)
    return h.cdp.evaluate(
      s,
      `(() => { const v = document.querySelector('video'); const p = document.getElementById('movie_player'); return v ? { t: Math.round(v.currentTime), paused: v.paused, id: p?.getVideoData?.().video_id ?? null } : null })()`,
    )
  }

  await step('W1', '처음 방문 — 빈 저장소의 첫 화면 (사람이 판단할 글 · 입구)', async () => {
    const view = await ev(
      `({ title: document.title, nav: [...document.querySelectorAll('.app-nav button')].map((b) => b.textContent.trim()), headings: [...document.querySelectorAll('h1,h2,h3')].map((x) => x.textContent.trim()).filter(Boolean).slice(0, 12), emptyHints: [...document.querySelectorAll('.empty, .now-sub, .deck-hint, .muted')].map((x) => x.textContent.replace(/\\s+/g, ' ').trim()).filter(Boolean).slice(0, 8) })`,
    )
    const { data } = await h.cdp.send('Page.captureScreenshot', { format: 'png' }, session)
    writeFileSync(path.join(OUT, 'w1-first-visit.png'), Buffer.from(data, 'base64'))
    return { pass: view.nav.length === 3, ...view }
  })

  await step(
    'W2',
    '새 플레이리스트 → 링크 추가(제목 자동 채움, 실제 oEmbed) → 담김 — 조작 수',
    async () => {
      actions = 0
      await click(byText(doc, '.app-nav button', '음악'))
      await click(byText(doc, '#archive-panel-music button', '새 목록'))
      await type('첫 목록')
      await key('Enter')
      await waitFor(() => ev(`document.activeElement?.id === 'track-url'`), {
        label: 'link form focused',
      })
      await type(URL_A)
      const filled = await waitFor(
        () =>
          ev(
            `(() => { const t = document.getElementById('track-title').value; return t !== '' ? t : null })()`,
          ),
        { timeout: 8_000, label: 'title prefill' },
      ).catch(() => null)
      await key('Enter')
      await waitFor(
        async () => (await storage()).lists.some((l) => l.startsWith('첫 목록:') && l.length > 6),
        { label: 'track saved' },
      )
      const count = actions
      const after = await storage()
      return {
        pass: filled !== null && after.lists.some((l) => l.includes(filled)),
        actionsToFirstTrack: count,
        filledTitle: filled,
        lists: after.lists,
      }
    },
  )

  await step('W3', '재생 — 곡 ▶ → 실제 YouTube 재생 · 지금 곡 표시', async () => {
    actions = 0
    await click(`document.querySelector('#archive-panel-music .track-play')`)
    await waitFor(() => ev(`!!document.querySelector('.player-mount iframe')`), {
      timeout: 30_000,
      label: 'player',
    })
    await ev(`document.querySelector('.player-mount iframe').dataset.m116 = 'original'; true`)
    const played = await waitFor(
      async () => {
        const p = await playerState()
        return p && p.t >= 2 ? p : null
      },
      { timeout: 40_000, label: 'playing' },
    ).catch(() => null)
    const marker = await ev(
      `document.querySelector('#archive-panel-music .track.is-current .track-badge')?.textContent.trim() ?? null`,
    )
    return { pass: played !== null && !played.paused && marker !== null, actions, played, marker }
  })

  await step(
    'W4',
    '두 번째 곡 · 다음/이전 · LP 로 보관함 · 닫기 — 재생 유지, iframe 같은 노드',
    async () => {
      await click(byText(doc, '#archive-panel-music button', 'YouTube 링크 추가'))
      await type(URL_B)
      await sleep(1500)
      await key('Enter')
      await waitFor(async () => listOf(await storage(), '첫 목록').split('|').length === 2, {
        label: 'second track',
      })
      await click(byText(doc, '#archive-panel-music button', '닫기'))
      await click(`document.querySelector('#archive-panel .close')`)
      // 큐는 재생 시작 때의 스냅샷이다 (MVP_SPEC) — 두 번째 곡을 넣은 뒤 그 목록을 다시 재생한다.
      await click(
        `[...document.querySelectorAll('.playlist-tile')].find((t) => t.textContent.includes('첫 목록')).querySelector('.playlist-play')`,
      )
      await sleep(3000)
      await click(`document.querySelector('button[aria-label="다음 곡"]')`)
      await sleep(4000)
      const next = await playerState()
      await click(`document.querySelector('button[aria-label="이전 곡"]')`)
      await sleep(4000)
      const prev = await playerState()
      await click(
        `[...document.querySelectorAll('.deck-open')].find((e) => getComputedStyle(e).display !== 'none')`,
      )
      const opened = await ev(
        `!document.getElementById('archive-panel').hidden && document.getElementById('archive-tab-music').getAttribute('aria-selected') === 'true'`,
      )
      await key('Escape')
      const closed = await ev(`document.getElementById('archive-panel').hidden`)
      const f = await iframe()
      return {
        pass:
          next?.id === 'aqz-KE-bpKQ' &&
          prev?.id === 'M7lc1UVf-VE' &&
          opened &&
          closed &&
          f.count === 1 &&
          f.marker === 'original',
        next,
        prev,
        deckOpensMusic: opened,
        escCloses: closed,
        iframe: f,
      }
    },
  )

  await step('W5', '테마 전환 · 보관함 열고 닫기 중 재생 유지 · iframe 같은 노드', async () => {
    const t0 = await playerState()
    await click(`document.querySelectorAll('.theme-button')[1]`)
    await click(byText(doc, '.app-nav button', 'Moments'))
    await click(byText(doc, '.app-nav button', '음악'))
    await click(`document.querySelector('#archive-panel .close')`)
    await click(`document.querySelectorAll('.theme-button')[0]`)
    await sleep(2000)
    const t1 = await playerState()
    const f = await iframe()
    return {
      pass:
        t1 !== null &&
        !t1.paused &&
        t1.t > (t0?.t ?? 0) &&
        f.marker === 'original' &&
        f.count === 1,
      t0,
      t1,
      iframe: f,
    }
  })

  await step(
    'W6',
    'Moment 빠른 저장 → 메모 추가 → 보관함 검색 → 그 시점부터 재생 — 조작 수',
    async () => {
      actions = 0
      await click(`document.querySelector('.capture-button')`)
      await waitFor(async () => (await storage()).moments.length === 1, { label: 'quick saved' })
      const saveActions = actions
      await click(byText(doc, '.moments-widget .pill', '메모 추가'))
      await type('후렴 직전 — 베이스')
      await key('Enter').catch(() => null)
      const noteSubmit = await ev(`!!document.getElementById('moment-capture-note')`)
      if (noteSubmit) await click(`document.querySelector('.note-form button[type=submit]')`)
      await waitFor(async () => (await storage()).moments[0]?.includes('베이스'), {
        label: 'note saved',
      })
      actions = 0
      await click(byText(doc, '.app-nav button', 'Moments'))
      await click(`document.getElementById('archive-moments-search')`)
      await type('베이스')
      await sleep(400)
      const hits = await ev(
        `document.querySelectorAll('#archive-panel-moments .moment-item').length`,
      )
      const at = Number((await storage()).moments[0].split(':')[0])
      await click(`document.querySelector('#archive-panel-moments [data-moment-play]')`)
      await sleep(4000)
      const p = await playerState()
      return {
        pass: hits === 1 && p !== null && p.t >= at && p.t <= at + 10,
        quickSaveActions: saveActions,
        findAndPlayActions: actions,
        hits,
        playedAt: p,
        savedAt: at,
      }
    },
  )

  await step(
    'W7',
    '목록 · 곡 편집 — 이름 바꾸기 · 같은 영상 다시 담기(허용) · 긴 · 특수 제목 · 곡 삭제(확인) · 목록 삭제',
    async () => {
      await key('Escape')
      await click(byText(doc, '.app-nav button', '음악'))
      // 같은 영상 한 번 더 + 긴 제목
      const long = '아주 긴 제목 '.repeat(8) + '🎵 <b>태그</b> & "따옴표" العربية'
      await click(byText(doc, '#archive-panel-music button', 'YouTube 링크 추가'))
      await type(URL_A)
      await click(`document.getElementById('track-title')`)
      await ev(`document.getElementById('track-title').select(); true`) // 미리 채워진 제목을 바꿔 쓴다
      await type(long.slice(0, 100))
      await key('Enter')
      await waitFor(async () => listOf(await storage(), '첫 목록').split('|').length === 3, {
        label: 'dup added',
      })
      await click(byText(doc, '#archive-panel-music button', '닫기'))
      const rendered = await ev(
        `[...document.querySelectorAll('#archive-panel-music .track-name')].map((n) => ({ text: n.textContent, html: n.innerHTML.includes('<b>'), overflow: n.scrollWidth > n.clientWidth + 1 }))`,
      )
      // 곡 삭제 (관리 → 삭제 → 확인)
      await click(`document.querySelectorAll('#archive-panel-music .track-manage')[2]`)
      await click(
        `[...document.querySelectorAll('#archive-panel-music .track-controls button')].find((b) => b.textContent.trim() === '삭제')`,
      )
      await click(
        `[...document.querySelectorAll('#archive-panel-music [aria-label="트랙 삭제 확인"] button')].find((b) => b.textContent.trim() === '삭제')`,
      )
      await waitFor(async () => listOf(await storage(), '첫 목록').split('|').length === 2, {
        label: 'track removed',
      })
      const pageOverflow = await ev(`document.documentElement.scrollWidth - innerWidth`)
      return {
        pass:
          rendered.length === 3 &&
          rendered.every((r) => !r.html && !r.overflow) &&
          pageOverflow <= 0,
        rendered: rendered.map((r) => r.text.slice(0, 40)),
        pageOverflow,
      }
    },
  )

  await step(
    'W8',
    '제목 조회 실패(오프라인) — 이유를 말하고 곡은 영상 ID 표기로 추가된다',
    async () => {
      await h.cdp.send('Network.enable', {}, session)
      await h.cdp.send(
        'Network.emulateNetworkConditions',
        { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 },
        session,
      )
      await click(byText(doc, '#archive-panel-music button', 'YouTube 링크 추가'))
      await type('https://youtu.be/dQw4w9WgXcQ')
      const status = await waitFor(
        () =>
          ev(
            `(() => { const s = document.getElementById('track-title-status')?.textContent.trim(); return s && !s.includes('찾는 중') ? s : null })()`,
          ),
        { timeout: 8_000, label: 'status' },
      ).catch(() => null)
      await key('Enter')
      await waitFor(
        async () => listOf(await storage(), '첫 목록').includes('YouTube · dQw4w9WgXcQ'),
        {
          label: 'fallback title',
        },
      )
      await h.cdp.send(
        'Network.emulateNetworkConditions',
        { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 },
        session,
      )
      await click(byText(doc, '#archive-panel-music button', '닫기'))
      return { pass: status !== null && status.includes('제목을 가져오지 못했어요'), status }
    },
  )

  await step('W9', '데이터 — 헤더 ⇩ 데이터 → JSON 내보내기(파일 확인) — 조작 수', async () => {
    await key('Escape')
    actions = 0
    await click(byText(doc, '.app-nav button', '데이터'))
    await click(byText(doc, '#data-dialog button', 'JSON 백업 내보내기'))
    const file = await waitFor(
      () => readdirSync(downloads).find((f) => f.endsWith('.json')) ?? null,
      { timeout: 10_000, label: 'download' },
    )
    const backup = JSON.parse(readFileSync(path.join(downloads, file), 'utf8'))
    return {
      pass:
        backup.format === '39page-backup' &&
        backup.data.library.data.playlists.some((p) => p.name === '첫 목록') &&
        Array.isArray(backup.data.moments?.data) &&
        backup.data.moments.data.length === 1,
      actionsToExport: actions,
      file,
      keys: Object.keys(backup.data),
      schemaVersion: backup.schemaVersion,
    }
  })

  await step(
    'W10',
    '가져오기 — 손상 파일은 거절 · 저장소 그대로, 이전 스키마 백업은 미리보기 → 취소면 그대로 → 교체 확인',
    async () => {
      const before = await ev(`localStorage.getItem('39page.library')`)
      const corrupt = path.join(downloads, 'corrupt.json')
      writeFileSync(corrupt, '{"format":"39page-backup","schemaVersion":1,"data":{')
      const doc2 = await h.cdp.send('DOM.getDocument', { depth: -1, pierce: true }, session)
      const input = await h.cdp.send(
        'DOM.querySelector',
        { nodeId: doc2.root.nodeId, selector: '#data-dialog input[type=file]' },
        session,
      )
      await h.cdp.send('DOM.setFileInputFiles', { files: [corrupt], nodeId: input.nodeId }, session)
      await sleep(800)
      const corruptMsg = await ev(
        `[...document.querySelectorAll('#data-dialog .backup-result')].map((r) => r.textContent.trim()).join(' | ')`,
      )
      const unchanged1 = (await ev(`localStorage.getItem('39page.library')`)) === before
      const old = path.join(REPO, 'tests/fixtures/backup-v1.json')
      await h.cdp.send('DOM.setFileInputFiles', { files: [old], nodeId: input.nodeId }, session)
      await waitFor(() => ev(`!!document.querySelector('#data-dialog .preview')`), {
        label: 'preview',
      })
      await click(
        `[...document.querySelectorAll('#data-dialog .preview button')].find((b) => b.textContent.trim() === '취소')`,
      )
      const unchanged2 = (await ev(`localStorage.getItem('39page.library')`)) === before
      await h.cdp.send('DOM.setFileInputFiles', { files: [old], nodeId: input.nodeId }, session)
      await waitFor(() => ev(`!!document.querySelector('#data-dialog .preview')`), {
        label: 'preview 2',
      })
      await click(
        `[...document.querySelectorAll('#data-dialog .preview button')].find((b) => b.textContent.trim() === '교체하고 가져오기')`,
      )
      await sleep(1000)
      const after = await storage()
      const f = await iframe()
      return {
        pass:
          unchanged1 &&
          unchanged2 &&
          corruptMsg !== '' &&
          after.lists.some((l) => l.startsWith('NIGHT DRIVE')) &&
          f.marker === 'original',
        corruptMsg: corruptMsg.slice(0, 120),
        afterImport: after.lists,
        iframeKept: f.marker === 'original',
      }
    },
  )

  await step(
    'W11',
    '보호 상태 — 손상된 라이브러리 원문은 새로고침 뒤에도 덮어쓰지 않고, 화면이 알린다',
    async () => {
      await key('Escape')
      await ev(`localStorage.setItem('39page.library', '{broken'); true`)
      await h.cdp.send('Page.reload', {}, session)
      await sleep(3000)
      await waitFor(() => ev(`!!document.querySelector('.app-nav')`, { timeout: 3_000 }), {
        label: 'reloaded',
      })
      await sleep(800)
      await click(byText(doc, '.app-nav button', '음악'))
      const banner = await ev(
        `[...document.querySelectorAll('[role=status], [role=alert], .banner, .status-banner')].map((x) => x.textContent.replace(/\\s+/g, ' ').trim()).filter((t) => t.includes('보호') || t.includes('읽지 못')).slice(0, 2)`,
      )
      await click(byText(doc, '#archive-panel-music button', '새 목록')).catch(() => null)
      await type('보호 중 시도').catch(() => null)
      await key('Enter').catch(() => null)
      await sleep(500)
      const raw = await ev(`localStorage.getItem('39page.library')`)
      return { pass: raw === '{broken' && banner.length > 0, raw, banner }
    },
  )

  mkdirSync(OUT, { recursive: true })
  const file = path.join(OUT, `webapp-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
  writeFileSync(file, JSON.stringify({ browser: h.cdp.version, results }, null, 2))
  console.log(`\n${results.filter((r) => r.pass).length}/${results.length} PASS → ${file}`)
  h.cdp.close()
} catch (error) {
  console.error('harness failed:', error)
  process.exitCode = 1
} finally {
  h.kill()
}
