// M11-7B — 실제 Chrome · 실제 YouTube 로 대시보드 · 보관함 · 테마 · 화면 폭을 오가며 재생이 이어지는지 잰다.
// 격리 임시 프로필, 로컬 빌드(127.0.0.1:4173). 날씨 요청만 막는다(YouTube 는 실제로 쓴다).
//   POC_CHROME=<chrome> WEB_DIST=<dist> OUT=<dir> REPO_INT=<extension/integration> [HEADFUL=1] node real.mjs
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const INT = 'file:///' + process.env.REPO_INT.split(String.fromCharCode(92)).join('/')
const { launch, BASE, sleep, waitFor } = await import(INT + '/harness.mjs')
const OUT = process.env.OUT
mkdirSync(OUT, { recursive: true })

const LINKS = [
  'https://www.youtube.com/watch?v=M7lc1UVf-VE',
  'https://youtu.be/aqz-KE-bpKQ',
  'https://www.youtube.com/watch?v=jNQXAC9IVRw',
]

const h = await launch({
  chrome: process.env.POC_CHROME,
  webDist: process.env.WEB_DIST,
  headful: process.env.HEADFUL === '1',
})
const results = []
let shotNo = 0
try {
  const page = await h.tab('about:blank')
  const send = (m, p) => h.cdp.send(m, p, page.session)
  const ev = (e, o) => page.ev(e, o)
  await send('Network.enable', {})
  await send('Network.setBlockedURLs', { urls: ['*open-meteo*'] })
  await send('Page.enable', {})
  const size = (width, height, mobile = false) =>
    send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile })
  const shot = async (name) => {
    shotNo += 1
    const r = await send('Page.captureScreenshot', { format: 'png' })
    writeFileSync(
      path.join(OUT, `${String(shotNo).padStart(2, '0')}-${name}.png`),
      Buffer.from(r.data, 'base64'),
    )
  }
  const center = async (selector) => {
    const p = await ev(
      `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return null; el.scrollIntoView({ block: 'nearest' }); const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })()`,
    )
    if (p === null) throw new Error(`없음: ${selector}`)
    return p
  }
  const click = async (selector) => {
    const p = await center(selector)
    for (const type of ['mousePressed', 'mouseReleased'])
      await send('Input.dispatchMouseEvent', {
        type,
        x: p.x,
        y: p.y,
        button: 'left',
        clickCount: 1,
      })
    await sleep(250)
  }
  const clickText = async (selector, text) => {
    const idx = await ev(
      `[...document.querySelectorAll(${JSON.stringify(selector)})].findIndex((el) => el.offsetParent !== null && el.textContent.replace(/\\s+/g, ' ').includes(${JSON.stringify(text)}))`,
    )
    if (idx < 0) throw new Error(`없음: ${selector} "${text}"`)
    const p = await ev(
      `(() => { const el = [...document.querySelectorAll(${JSON.stringify(selector)})].filter((e) => e.offsetParent !== null && e.textContent.replace(/\\s+/g, ' ').includes(${JSON.stringify(text)}))[0]; el.scrollIntoView({ block: 'nearest' }); const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })()`,
    )
    for (const type of ['mousePressed', 'mouseReleased'])
      await send('Input.dispatchMouseEvent', {
        type,
        x: p.x,
        y: p.y,
        button: 'left',
        clickCount: 1,
      })
    await sleep(250)
  }
  const typeText = async (text) => {
    await send('Input.insertText', { text })
    await sleep(120)
  }
  const enter = async () => {
    await send('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key: 'Enter',
      code: 'Enter',
      windowsVirtualKeyCode: 13,
      text: '\r',
    })
    await send('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key: 'Enter',
      code: 'Enter',
      windowsVirtualKeyCode: 13,
    })
    await sleep(300)
  }

  /** YouTube iframe 안의 <video> — 실제 재생 시각 · 일시정지 여부 · 영상 id. */
  const video = async () => {
    const target = (await h.cdp.targets()).find(
      (t) => t.type === 'iframe' && t.url.includes('youtube.com/embed'),
    )
    if (!target) return null
    const s = await h.cdp.attach(target.targetId)
    try {
      const r = await h.cdp.send(
        'Runtime.evaluate',
        {
          expression: `(() => { const v = document.querySelector('video'); return v ? { t: v.currentTime, paused: v.paused, src: location.pathname.split('/').pop() } : null })()`,
          returnByValue: true,
        },
        s,
      )
      return r.result.value
    } finally {
      await h.cdp.send('Target.detachFromTarget', { sessionId: s }).catch(() => {})
    }
  }
  /** iframe 노드 표시 · 크기 · 가림 */
  const frame = () =>
    ev(`(() => {
      const f = document.querySelector('.player-mount iframe')
      if (!f) return null
      if (f.__m117 === undefined) f.__m117 = Math.random()
      const r = f.getBoundingClientRect()
      const cx = r.x + r.width / 2, cy = r.y + r.height / 2
      const pts = [[cx, cy], [r.x + 10, r.y + 10], [r.right - 10, r.bottom - 10]]
      const covered = pts.filter(([x, y]) => x >= 0 && y >= 0 && x < innerWidth && y < innerHeight).map(([x, y]) => document.elementFromPoint(x, y)).filter((el) => el !== f).length
      return { marker: f.__m117, w: Math.round(r.width), h: Math.round(r.height), top: Math.round(r.top), left: Math.round(r.left), inView: r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth, covered }
    })()`)
  const appState = () =>
    ev(`(() => ({
      theme: document.documentElement.dataset.theme,
      layout: document.querySelector('.workspace').dataset.archiveLayout ?? null,
      archiveOpen: document.getElementById('archive-panel').hidden === false,
      nowView: document.querySelector('.now-playlist')?.dataset.view,
      nowName: document.querySelector('.now-playlist .list-name')?.textContent.trim(),
      nowChip: document.querySelector('.now-playlist .state-chip')?.textContent.trim(),
      nowCurrent: document.querySelector('.now-playlist .track-row.is-current .track-title')?.textContent.trim() ?? null,
      title: document.querySelector('.player-surface .now-title')?.textContent.trim(),
      status: document.querySelector('.player-surface .status')?.textContent.trim(),
      overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      moments: JSON.parse(localStorage.getItem('39page.moments') ?? '{"data":[]}').data.length,
      nav: [...document.querySelectorAll('.app-nav button')].map((b) => b.textContent.trim()),
      themeButtons: [...document.querySelectorAll('.theme-button')].map((b) => b.textContent.trim()),
    }))()`)
  const step = async (name, fn) => {
    try {
      const detail = await fn()
      results.push({ name, pass: detail?.pass !== false, detail })
    } catch (error) {
      results.push({ name, pass: false, error: String(error?.message ?? error) })
    }
    if (await ev(`document.getElementById('archive-panel').hidden === false`).catch(() => false)) {
      await ev(`document.querySelector('[aria-label="보관함 닫기"]').click(); true`)
      await sleep(400)
    }
    const last = results.at(-1)
    console.log(
      last.pass ? 'PASS' : 'FAIL',
      name,
      JSON.stringify(last.detail ?? last.error).slice(0, 400),
    )
  }
  const advancing = async () => {
    const a = await video()
    await sleep(2500)
    const b = await video()
    return { a, b, advancing: a !== null && b !== null && !b.paused && b.t > a.t + 1 }
  }

  await size(1321, 761)
  await send('Page.navigate', { url: BASE + '/' })
  await waitFor(() => ev(`!!document.querySelector('[data-widget="player"]')`), { label: 'app' })
  await sleep(1000)

  await step(
    'R1 빈 프로필 — Kawaii Synth Cassette 기본 · 헤더 H1 · NOW PLAYLIST 재생 대기',
    async () => {
      const s = await appState()
      const stored = await ev(`localStorage.getItem('39page.theme')`)
      await shot('first-visit')
      return {
        pass:
          s.theme === 'kawaii-synth-cassette' &&
          stored === null &&
          s.nav.join('|') === '▤ 보관함|⇩ 데이터 · 백업' &&
          s.themeButtons.join('|') === '01 / SYNTH CASSETTE|02 / MONO VINYL' &&
          s.nowView === 'standby',
        s,
        stored,
      }
    },
  )

  await step('R2 보관함에서 목록을 만들고 실제 링크 3개 추가 (연속 추가)', async () => {
    await click('.app-nav button')
    await sleep(700)
    await click('.archive-lists .pill--strong')
    await typeText('M11-7B 실측')
    await enter()
    await sleep(500)
    const focused = await ev(`document.activeElement?.id`)
    for (const link of LINKS) {
      await click('#track-url')
      await typeText(link)
      await sleep(1500) // 제목 미리 채우기(oEmbed)
      await enter()
      await sleep(800)
    }
    const tracks = await ev(
      `[...document.querySelectorAll('.playlist-editor .track-row, .playlist-editor li')].length`,
    )
    const titles = await ev(
      `JSON.parse(localStorage.getItem('39page.library')).data.playlists.find((p) => p.name === 'M11-7B 실측')?.tracks.map((t) => t.title)`,
    )
    await shot('archive-added')
    return { pass: focused === 'track-url' && titles?.length === 3, focused, titles, tracks }
  })

  await step('R3 보관함을 닫고 NOW PLAYLIST 둘째 줄 → 실제 재생', async () => {
    await click('[aria-label="보관함 닫기"]')
    await sleep(500)
    // 새 목록이 골라져 있다 — "재생 대기" 로 그 목록이 보인다.
    const before = await appState()
    await click('.now-playlist .track-item:nth-child(2) .track-row')
    await waitFor(async () => (await video())?.paused === false, {
      timeout: 30_000,
      label: 'playing',
    })
    await sleep(1500)
    const s = await appState()
    const v = await video()
    const f = await frame()
    await shot('now-playlist-playing')
    return {
      pass:
        before.nowView === 'standby' &&
        s.nowView === 'queue' &&
        s.nowChip === '재생 중' &&
        v?.src === 'aqz-KE-bpKQ' &&
        f.w >= 200 &&
        f.h >= 200,
      before: before.nowView,
      s,
      v,
      f,
    }
  })

  const marker = (await frame())?.marker

  await step('R4 NOW PLAYLIST 셋째 줄 → 그 곡, 같은 iframe 노드', async () => {
    const before = await video()
    await click('.now-playlist .track-item:nth-child(3) .track-row')
    // iframe 주소의 영상 id 는 처음 것 그대로다(loadVideoById) — 재생 시각이 처음부터 다시 흐르는지 본다.
    await waitFor(
      async () => {
        const v = await video()
        return v !== null && !v.paused && v.t < (before?.t ?? 0) && v.t > 0.5
      },
      { timeout: 30_000, label: 'third' },
    )
    const s = await appState()
    const f = await frame()
    const r = await advancing()
    const idx = await ev(
      `[...document.querySelectorAll('.now-playlist .track-row')].findIndex((r) => r.classList.contains('is-current'))`,
    )
    return {
      pass: f.marker === marker && s.title === 'Me at the zoo' && idx === 2 && r.advancing,
      s,
      f,
      idx,
      r,
    }
  })

  await step('R5 이전 곡 버튼 → 큐의 둘째, 위젯 강조가 따라온다', async () => {
    await click('.player-surface [aria-label="이전 곡"]')
    await waitFor(async () => (await appState()).title?.startsWith('Big Buck Bunny'), {
      timeout: 30_000,
      label: 'prev',
    })
    await sleep(1500)
    const s = await appState()
    const idx = await ev(
      `[...document.querySelectorAll('.now-playlist .track-row')].findIndex((r) => r.classList.contains('is-current'))`,
    )
    return { pass: idx === 1, idx, s }
  })

  await step('R6 목록 바꾸기 → 다른 목록(MY RECORDS)을 보기만 — 재생은 그대로', async () => {
    await click('.now-playlist .switch-list')
    await sleep(300)
    await clickText('.now-playlist .picker-row', 'MY RECORDS')
    await sleep(500)
    const s = await appState()
    const r = await advancing()
    await shot('picker-standby')
    return {
      pass:
        s.nowView === 'standby' &&
        s.nowName === 'MY RECORDS' &&
        r.advancing &&
        s.title.startsWith('Big Buck Bunny'),
      s,
      r,
    }
  })

  await step('R7 "재생 중인 큐 보기" 로 돌아온다', async () => {
    await clickText('.now-playlist .source-notice .pill', '재생 중인 큐 보기')
    await sleep(300)
    const s = await appState()
    return { pass: s.nowView === 'queue' && s.nowName === 'M11-7B 실측', s }
  })

  await step(
    'R8 보관함 열기(작은 영상 띠) — 같은 iframe · 재생 계속 · 200×200 이상 · 가림 없음',
    async () => {
      await click('.app-nav button')
      await sleep(900)
      const s = await appState()
      const f = await frame()
      const r = await advancing()
      await shot('archive-strip-1321')
      return {
        pass:
          s.layout === 'strip' &&
          f.marker === marker &&
          f.w >= 200 &&
          f.h >= 200 &&
          f.covered === 0 &&
          f.inView &&
          r.advancing &&
          s.overflowX === 0,
        s,
        f,
        r,
      }
    },
  )

  await step('R9 보관함 안에서 목록 만들기 · 고르기 · 이름 수정 — 재생 계속', async () => {
    await click('.app-nav button')
    await sleep(800)
    if (await ev(`getComputedStyle(document.querySelector('.music-lists')).display === 'none'`))
      await clickText('.playlist-editor .back-to-lists', '목록으로')
    await click('.archive-lists .pill--strong')
    await typeText('두번째')
    await enter()
    await sleep(500)
    await clickText('.archive-lists .list-select', 'MY RECORDS')
    await sleep(400)
    const rows = await ev(
      `[...document.querySelectorAll('.archive-lists .list-row')].map((r) => r.textContent.replace(/\\s+/g, ' ').trim())`,
    )
    await clickText('.archive-lists .list-row', '두번째')
    await ev(
      `[...document.querySelectorAll('.archive-lists .list-row')].find((r) => r.textContent.includes('두번째')).querySelector('.list-manage').click(); true`,
    )
    await sleep(200)
    await clickText('.archive-lists .manage-panel .pill', '이름 수정')
    await sleep(200)
    await ev(`document.getElementById('playlist-name').select(); true`)
    await typeText('두번째 (수정)')
    await enter()
    await sleep(500)
    const names = await ev(
      `JSON.parse(localStorage.getItem('39page.library')).data.playlists.map((p) => p.name)`,
    )
    const playing = await ev(
      `[...document.querySelectorAll('.archive-lists .list-row.is-playing .list-name')].map((n) => n.textContent.trim())`,
    )
    const r = await advancing()
    const f = await frame()
    return {
      pass:
        names.includes('두번째 (수정)') &&
        playing.join() === 'M11-7B 실측' &&
        r.advancing &&
        f.marker === marker,
      names,
      playing,
      rows,
      r,
    }
  })

  await step('R10 띠의 "이 순간 저장" — 보관함이 열린 채로 Moment 저장', async () => {
    await click('.app-nav button')
    await sleep(800)
    const before = (await appState()).moments
    await click('[data-widget="moments"] .capture-button')
    await sleep(800)
    const after = (await appState()).moments
    const saved = await ev(`JSON.parse(localStorage.getItem('39page.moments')).data.at(-1)`)
    return {
      pass: after === before + 1 && saved.videoId === 'aqz-KE-bpKQ' && saved.atSeconds > 0,
      before,
      after,
      saved,
    }
  })

  await step('R11 Moments 탭 → 방금 저장한 Moment 가 보인다', async () => {
    await click('.app-nav button')
    await sleep(800)
    await click('#archive-tab-moments')
    await sleep(700)
    const text = await ev(`document.getElementById('archive-panel-moments').textContent`)
    await shot('archive-moments')
    await click('#archive-tab-music')
    return { pass: text.includes('Big Buck Bunny'), len: text.length }
  })

  await step('R12 보관함 닫기 → 대시보드 복귀, 같은 iframe · 재생 계속', async () => {
    await click('.app-nav button')
    await sleep(800)
    await click('[aria-label="보관함 닫기"]')
    await sleep(600)
    const s = await appState()
    const f = await frame()
    const r = await advancing()
    return {
      pass: !s.archiveOpen && s.layout === null && f.marker === marker && r.advancing,
      s,
      f,
      r,
    }
  })

  await step('R13 재생 중 테마 전환(Mono) — 같은 iframe · 재생 계속 · 저장됨', async () => {
    await clickText('.theme-button', 'MONO VINYL')
    await sleep(500)
    const s = await appState()
    const f = await frame()
    const r = await advancing()
    const stored = await ev(`localStorage.getItem('39page.theme')`)
    await shot('mono-dashboard')
    return {
      pass:
        s.theme === 'mono-vinyl' &&
        f.marker === marker &&
        r.advancing &&
        stored.includes('mono-vinyl'),
      s,
      f,
      r,
    }
  })

  await step('R14 Mono 에서 보관함 열기 — 1440×900', async () => {
    await size(1440, 900)
    await sleep(400)
    await click('.app-nav button')
    await sleep(800)
    const f = await frame()
    const s = await appState()
    const r = await advancing()
    await shot('mono-archive-1440')
    await click('[aria-label="보관함 닫기"]')
    await sleep(400)
    return {
      pass: s.layout === 'strip' && f.marker === marker && f.covered === 0 && r.advancing,
      s,
      f,
    }
  })

  await step('R15 1024×768 — 보관함 띠 (저장 줄이 영상 아래로)', async () => {
    await size(1024, 768)
    await sleep(500)
    await click('.app-nav button')
    await sleep(800)
    const f = await frame()
    const s = await appState()
    const r = await advancing()
    await shot('archive-1024')
    await click('[aria-label="보관함 닫기"]')
    await sleep(400)
    return {
      pass:
        s.layout === 'strip' &&
        f.marker === marker &&
        f.covered === 0 &&
        f.inView &&
        r.advancing &&
        s.overflowX === 0,
      s,
      f,
    }
  })

  for (const [w, hh, label] of [
    [390, 844, '390'],
    [360, 740, '360'],
    [320, 640, '320'],
  ]) {
    await step(`R16 모바일 ${label} — 데크 띠 · 영상이 첫 화면 · 재생 계속`, async () => {
      await size(w, hh, true)
      await sleep(700)
      await ev(`window.scrollTo(0, 0); true`)
      await sleep(300)
      const f = await frame()
      const deck = await ev(
        `(() => { const r = document.querySelector('[data-widget="deck"]').getBoundingClientRect(); return { h: Math.round(r.height), top: Math.round(r.top) } })()`,
      )
      const s = await appState()
      const r = await advancing()
      await shot(`mobile-${label}`)
      return {
        pass:
          f.marker === marker &&
          f.w >= 200 &&
          f.h >= 200 &&
          f.top + f.h <= hh &&
          deck.h < 140 &&
          s.overflowX === 0 &&
          r.advancing,
        f,
        deck,
        s,
      }
    })
    await step(
      `R17 모바일 ${label} — 보관함(쌓기): 영상 위 · 시트 아래 · 목록 → 상세`,
      async () => {
        await click('.app-nav button')
        await sleep(900)
        const f = await frame()
        const s = await appState()
        // 보관함은 마지막 단계를 기억한다 — 상세 단계면 "목록으로" 로 먼저 돌아간다.
        const atDetail = await ev(
          `getComputedStyle(document.querySelector('.music-lists')).display === 'none'`,
        )
        if (atDetail) await clickText('.playlist-editor .back-to-lists', '목록으로')
        await sleep(300)
        await shot(`mobile-${label}-archive-list`)
        await clickText('.archive-lists .list-select', 'M11-7B 실측')
        await sleep(500)
        const detail = await ev(
          `(() => { const d = document.querySelector('.music-detail'); const l = document.querySelector('.music-lists'); return { detail: getComputedStyle(d).display, lists: getComputedStyle(l).display, title: document.getElementById('playlist-editor-title').textContent.trim() } })()`,
        )
        await shot(`mobile-${label}-archive-detail`)
        const r = await advancing()
        await clickText('.playlist-editor .back-to-lists', '목록으로')
        await sleep(300)
        const back = await ev(`getComputedStyle(document.querySelector('.music-lists')).display`)
        return {
          pass:
            s.layout === 'stack' &&
            f.marker === marker &&
            f.covered === 0 &&
            f.inView &&
            detail.lists === 'none' &&
            detail.detail !== 'none' &&
            back !== 'none' &&
            r.advancing &&
            s.overflowX === 0,
          s,
          f,
          detail,
          back,
        }
      },
    )
  }

  await step('R18 768×1024 세로 태블릿 — 보관함 쌓기', async () => {
    await size(768, 1024, true)
    await sleep(600)
    await click('.app-nav button')
    await sleep(800)
    const f = await frame()
    const s = await appState()
    const r = await advancing()
    await shot('tablet-768-archive')
    await click('[aria-label="보관함 닫기"]')
    await sleep(400)
    return {
      pass: s.layout === 'stack' && f.marker === marker && f.covered === 0 && r.advancing,
      s,
      f,
    }
  })

  await step('R19a 낮은 가로 844×390 대시보드 — 돌려도 영상이 첫 화면 · 재생 계속', async () => {
    await size(844, 390, true)
    await sleep(900)
    const f = await frame()
    const s = await appState()
    const r = await advancing()
    await shot('landscape-844-dashboard')
    return {
      pass:
        f.marker === marker &&
        f.top < 390 &&
        f.covered === 0 &&
        s.nowChip === '재생 중' &&
        r.advancing,
      f,
      s,
      r,
    }
  })

  await step('R19 낮은 가로 844×390 — 보관함 옆 배치', async () => {
    await click('.app-nav button')
    await sleep(800)
    const f = await frame()
    const s = await appState()
    const r = await advancing()
    await shot('landscape-844-archive')
    await click('[aria-label="보관함 닫기"]')
    await sleep(400)
    return {
      pass:
        s.layout === 'side' &&
        f.marker === marker &&
        f.covered === 0 &&
        f.w >= 200 &&
        f.h >= 200 &&
        r.advancing,
      s,
      f,
    }
  })

  await step('R20 데이터 · 백업 대화상자 — 백업 입구 회귀', async () => {
    await size(1321, 761)
    await sleep(400)
    await clickText('.app-nav button', '데이터')
    await sleep(500)
    const text = await ev(
      `document.querySelector('.data-backdrop')?.hidden === false ? document.querySelector('.data-backdrop').textContent.replace(/\\s+/g, ' ') : ''`,
    )
    await shot('data-dialog')
    await send('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key: 'Escape',
      code: 'Escape',
      windowsVirtualKeyCode: 27,
    })
    await send('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key: 'Escape',
      code: 'Escape',
      windowsVirtualKeyCode: 27,
    })
    await sleep(300)
    const r = await advancing()
    return { pass: text.includes('내보내기') && r.advancing, text: text.slice(0, 120) }
  })

  await step(
    'R21 새로고침 — 테마(Mono) · 목록 유지, 큐는 비고 NOW PLAYLIST 는 재생 대기',
    async () => {
      await send('Page.reload', {})
      await waitFor(() => ev(`!!document.querySelector('[data-widget="player"]')`), {
        label: 'reload',
      })
      await sleep(1200)
      const s = await appState()
      const html = await ev(`document.documentElement.dataset.theme`)
      return {
        pass: s.theme === 'mono-vinyl' && html === 'mono-vinyl' && s.nowView === 'standby',
        s,
      }
    },
  )

  writeFileSync(
    path.join(OUT, 'real.json'),
    JSON.stringify({ browser: h.cdp.version, results }, null, 2),
  )
  console.log(`${results.filter((r) => r.pass).length}/${results.length} PASS`)
} finally {
  h.cdp.close()
  h.kill()
}
