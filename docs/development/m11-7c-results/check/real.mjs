// M11-7C — 실제 Chrome · 실제 YouTube 로 Moments 정보 구조 · 저장 모델 B · 트랙 편집 C 를 확인한다.
// 지시서 19절의 필수 시나리오 1–20 과, 실제 브라우저에서 볼 수 있는 안전성 시험(같은 영상의 다른 트랙 ·
// 한 영상의 여러 Moment · 저장 중 중복 클릭 · 다른 탭 충돌 · 저장 후 화면 갱신)을 밟는다.
// 격리 임시 프로필, 로컬 빌드(127.0.0.1:4173). 날씨 요청만 막는다(YouTube 는 실제로 쓴다).
//   POC_CHROME=<chrome> WEB_DIST=<dist> OUT=<dir> REPO_INT=<extension/integration> [HEADFUL=1] node real.mjs
// M11-7B 의 real.mjs 를 이었다 (도우미 · 판정 방식 같음).
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const INT = 'file:///' + process.env.REPO_INT.split(String.fromCharCode(92)).join('/')
const { launch, BASE, sleep, waitFor } = await import(INT + '/harness.mjs')
const OUT = process.env.OUT
mkdirSync(OUT, { recursive: true })

const LIST = 'M11-7C 실측'
const LINKS = [
  ['https://www.youtube.com/watch?v=M7lc1UVf-VE', ''],
  ['https://youtu.be/aqz-KE-bpKQ', ''],
  ['https://www.youtube.com/watch?v=jNQXAC9IVRw', ''],
  // 같은 영상의 다른 트랙 (안전성 — 트랙 id 로 옮기는가)
  ['https://youtu.be/aqz-KE-bpKQ', 'Big Buck Bunny (다시)'],
]
const BUNNY = 'aqz-KE-bpKQ'
const STEP_TIMEOUT_MS = 120_000

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
  const mouseAt = async (p) => {
    for (const type of ['mousePressed', 'mouseReleased'])
      await send('Input.dispatchMouseEvent', {
        type,
        x: p.x,
        y: p.y,
        button: 'left',
        clickCount: 1,
      })
  }
  const click = async (selector) => {
    await mouseAt(await center(selector))
    await sleep(250)
  }
  const clickText = async (selector, text) => {
    const p = await ev(
      `(() => { const el = [...document.querySelectorAll(${JSON.stringify(selector)})].filter((e) => e.offsetParent !== null && e.textContent.replace(/\\s+/g, ' ').includes(${JSON.stringify(text)}))[0]; if (!el) return null; el.scrollIntoView({ block: 'nearest' }); const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })()`,
    )
    if (p === null) throw new Error(`없음: ${selector} "${text}"`)
    await mouseAt(p)
    await sleep(250)
  }
  const typeText = async (text) => {
    await send('Input.insertText', { text })
    await sleep(120)
  }
  const key = async (k, code, vk, text) => {
    await send('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key: k,
      code,
      windowsVirtualKeyCode: vk,
      ...(text ? { text } : {}),
    })
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk })
    await sleep(300)
  }
  const enter = () => key('Enter', 'Enter', 13, '\r')

  /** YouTube iframe 안의 <video> — 실제 재생 시각 · 일시정지 여부. */
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
          expression: `(() => { const v = document.querySelector('video'); return v ? { t: v.currentTime, paused: v.paused, d: v.duration } : null })()`,
          returnByValue: true,
        },
        s,
      )
      return r.result.value
    } finally {
      await h.cdp.send('Target.detachFromTarget', { sessionId: s }).catch(() => {})
    }
  }
  const frame = () =>
    ev(`(() => {
      const f = document.querySelector('.player-mount iframe')
      if (!f) return null
      if (f.__m117c === undefined) f.__m117c = Math.random()
      const r = f.getBoundingClientRect()
      const cx = r.x + r.width / 2, cy = r.y + r.height / 2
      const pts = [[cx, cy], [r.x + 10, r.y + 10], [r.right - 10, r.bottom - 10]]
      const covered = pts.filter(([x, y]) => x >= 0 && y >= 0 && x < innerWidth && y < innerHeight).map(([x, y]) => document.elementFromPoint(x, y)).filter((el) => el !== f).length
      return { marker: f.__m117c, w: Math.round(r.width), h: Math.round(r.height), top: Math.round(r.top), inView: r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth, covered }
    })()`)
  const stored = () =>
    ev(`JSON.parse(localStorage.getItem('39page.moments') ?? '{"data":[]}').data`)
  const libraryTracks = () =>
    ev(
      `JSON.parse(localStorage.getItem('39page.library')).data.playlists.find((p) => p.name === ${JSON.stringify(LIST)})?.tracks.map((t) => ({ id: t.id, v: t.videoId, title: t.title }))`,
    )
  const appState = () =>
    ev(`(() => ({
      theme: document.documentElement.dataset.theme,
      layout: document.querySelector('.workspace').dataset.archiveLayout ?? null,
      archiveOpen: document.getElementById('archive-panel').hidden === false,
      nowView: document.querySelector('.now-playlist')?.dataset.view,
      nowChip: document.querySelector('.now-playlist .state-chip')?.textContent.trim(),
      title: document.querySelector('.player-surface .now-title')?.textContent.trim(),
      overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    }))()`)
  const toSec = (text) => {
    const m = /(\d+):(\d{2})/.exec(text ?? '')
    return m ? Number(m[1]) * 60 + Number(m[2]) : null
  }
  const step = async (name, fn) => {
    try {
      // 한 단계가 멈추면 FAIL 로 남기고 다음으로 간다 (M11-7C 첫 실행에서 모바일 단계가 멈췄다).
      const detail = await Promise.race([
        fn(),
        sleep(STEP_TIMEOUT_MS).then(() => {
          throw new Error(`step timeout ${String(STEP_TIMEOUT_MS)}ms`)
        }),
      ])
      results.push({ name, pass: detail?.pass !== false, detail })
    } catch (error) {
      results.push({ name, pass: false, error: String(error?.message ?? error) })
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
  const openArchive = async () => {
    if (!(await appState()).archiveOpen) {
      await click('.app-nav button')
      await sleep(800)
    }
  }
  const closeArchive = async () => {
    if ((await appState()).archiveOpen) {
      await click('[aria-label="보관함 닫기"]')
      await sleep(500)
    }
  }
  const P = `document.getElementById('archive-panel-moments')`
  const strip = `document.querySelector('[data-widget="moments"]')`

  await size(1440, 900)
  await send('Page.navigate', { url: BASE + '/' })
  await waitFor(() => ev(`!!document.querySelector('[data-widget="player"]')`), { label: 'app' })
  await sleep(1000)

  /* ── 1 · 준비 ───────────────────────────────────────────────────── */
  await step('1 Cassette 기본 테마로 실행 (빈 프로필)', async () => {
    const s = await appState()
    await shot('first-visit')
    return { pass: s.theme === 'kawaii-synth-cassette' && s.nowView === 'standby', s }
  })

  await step('준비 — 목록을 만들고 실제 링크 4개(같은 영상의 다른 트랙 포함) 추가', async () => {
    await openArchive()
    await click('.archive-lists .pill--strong')
    await typeText(LIST)
    await enter()
    await sleep(500)
    for (const [link, title] of LINKS) {
      await click('#track-url')
      await typeText(link)
      await sleep(1500)
      if (title !== '') {
        await ev(`document.getElementById('track-title').select(); true`)
        await click('#track-title')
        await ev(`document.getElementById('track-title').select(); true`)
        await typeText(title)
      }
      await click('#track-url')
      await enter()
      await sleep(900)
    }
    const tracks = await libraryTracks()
    await closeArchive()
    return {
      pass:
        tracks?.length === 4 &&
        tracks.filter((t) => t.v === BUNNY).length === 2 &&
        new Set(tracks.map((t) => t.id)).size === 4,
      tracks,
    }
  })

  await step('2 음악 재생 — NOW PLAYLIST 둘째 줄(Big Buck Bunny)', async () => {
    await click('.now-playlist .track-item:nth-child(2) .track-row')
    await waitFor(async () => (await video())?.paused === false, {
      timeout: 30_000,
      label: 'playing',
    })
    await sleep(4000)
    const s = await appState()
    return { pass: s.nowChip === '재생 중' && s.title?.startsWith('Big Buck Bunny'), s }
  })
  const marker = (await frame())?.marker

  /* ── 15 · 대시보드도 같은 저장 B ─────────────────────────────────── */
  await step('15 대시보드 — 잡기 → 메모 → Moment 저장 (같은 B 흐름) · Enter 저장', async () => {
    const before = (await stored()).length
    await click('.moments-widget .capture-button')
    await sleep(400)
    const draftTime = await ev(
      `document.querySelector('.moments-widget .draft-form .target-time')?.textContent`,
    )
    const focusOnNote = await ev(`document.activeElement?.id === 'dashboard-moment-capture-note'`)
    const afterCapture = (await stored()).length
    await typeText('대시보드에서 잡은 순간')
    await sleep(1500)
    await click('.moments-widget .draft-save')
    await sleep(700)
    const list1 = await stored()
    const saved1 = list1.at(-1)
    // 둘째 — 메모 없이 Enter 로 저장
    await sleep(2500)
    await click('.moments-widget .capture-button')
    await sleep(300)
    await enter()
    await sleep(700)
    const list2 = await stored()
    const feedback = await ev(
      `document.querySelector('.moments-widget .moment-capture .feedback')?.textContent.trim()`,
    )
    const rows = await ev(
      `[...document.querySelectorAll('.moments-widget .moment-row')].map((r) => r.querySelector('.moment-time').textContent.trim())`,
    )
    await shot('dashboard-saved')
    return {
      pass:
        afterCapture === before &&
        focusOnNote &&
        list1.length === before + 1 &&
        saved1.videoId === BUNNY &&
        saved1.atSeconds === toSec(draftTime) &&
        saved1.note === '대시보드에서 잡은 순간' &&
        list2.length === before + 2 &&
        list2.at(-1).note === '' &&
        feedback.includes('Moment 를 저장했어요') &&
        rows.length === 2,
      draftTime,
      saved1,
      count: list2.length,
      feedback,
      rows,
    }
  })

  await step('안전성 — 저장 중 중복 클릭: 한 번만 저장된다', async () => {
    const before = (await stored()).length
    await sleep(1500)
    await click('.moments-widget .capture-button')
    await sleep(300)
    // 같은 틱에 두 번 제출 — 두 번째는 저장 중이라 막힌다.
    await ev(
      `(() => { const f = document.querySelector('.moments-widget .draft-form'); f.requestSubmit(); f.requestSubmit(); document.querySelector('.moments-widget .draft-save')?.click(); return true })()`,
    )
    await sleep(900)
    const after = await stored()
    return {
      pass: after.length === before + 1 && new Set(after.map((m) => m.id)).size === after.length,
      before,
      after: after.length,
    }
  })

  /* ── 3–5 · 영상 띠 ──────────────────────────────────────────────── */
  await step('3 보관함 열기 — 작은 영상 띠, 같은 iframe, 재생 계속', async () => {
    await openArchive()
    const s = await appState()
    const f = await frame()
    const r = await advancing()
    return {
      pass: s.layout === 'strip' && f.marker === marker && f.covered === 0 && r.advancing,
      s,
      f,
      r,
    }
  })

  await step('4 영상 띠 Moments — 저장 · 모두 보기 · 관리 단추가 없다', async () => {
    const info = await ev(`(() => ({
      readonly: ${strip}.classList.contains('is-readonly'),
      title: ${strip}.querySelector('.widget-title').textContent.replace(/\\s+/g, ' ').trim(),
      capture: !!${strip}.querySelector('.capture-button'),
      all: !!${strip}.querySelector('.widget-head .pill'),
      manage: !!${strip}.querySelector('[data-moment-edit], [data-moment-remove], [data-moment-manage]'),
    }))()`)
    await shot('strip-readonly')
    return {
      pass:
        info.readonly &&
        info.title === '이 곡의 Moments 3개' &&
        !info.capture &&
        !info.all &&
        !info.manage,
      info,
    }
  })

  await step('5 영상 띠에서 여러 시점 확인 · 재생 — 시점 순, 누르면 그 시점부터', async () => {
    const rows = await ev(
      `[...${strip}.querySelectorAll('.moment-row')].map((r) => ({ id: r.dataset.momentRow, t: r.querySelector('.moment-time').textContent.trim() }))`,
    )
    const secs = rows.map((r) => toSec(r.t))
    const sorted = secs.every((s, i) => i === 0 || secs[i - 1] <= s)
    const first = rows[0]
    await click(`[data-widget="moments"] [data-moment-play="${first.id}"]`)
    await sleep(2500)
    const v = await video()
    const marker2 = await ev(`${strip}.querySelector('.now-marker')?.textContent.trim() ?? null`)
    return {
      pass:
        rows.length === 3 &&
        sorted &&
        v !== null &&
        !v.paused &&
        Math.abs(v.t - secs[0]) < 6 &&
        marker2 !== null,
      rows,
      v,
      marker2,
    }
  })

  /* ── 6–8 · 보관함 Moments › 이 곡 ──────────────────────────────── */
  await step('6 · 7 Moments 탭 — 이 곡이 맨 앞이고 기본으로 골라져 있다', async () => {
    await click('#archive-tab-moments')
    await sleep(700)
    const chips = await ev(
      `[...${P}.querySelectorAll('.chip')].map((c) => ({ text: c.textContent.trim(), pressed: c.getAttribute('aria-pressed') }))`,
    )
    return {
      pass:
        chips.map((c) => c.text).join('|') === '이 곡 3|전체 3|최근' && chips[0].pressed === 'true',
      chips,
    }
  })

  await step('8 이 곡 화면 — 곡명 · 목록 · 묶음 머리를 되풀이하지 않는다', async () => {
    const info = await ev(`(() => ({
      song: ${P}.querySelectorAll('.moment-song').length,
      lists: ${P}.querySelectorAll('.group-lists, .list-link').length,
      heads: ${P}.querySelectorAll('.group-title, .group-toggle').length,
      rows: ${P}.querySelectorAll('.moment-item').length,
      count: ${P}.querySelector('.current-count')?.textContent.replace(/\\s+/g, ' ').trim(),
      save: !!${P}.querySelector('.current-head .capture-button'),
    }))()`)
    await shot('archive-this-song')
    return {
      pass:
        info.song === 0 &&
        info.lists === 0 &&
        info.heads === 0 &&
        info.rows === 3 &&
        info.count === '이 곡 · Moments 3개' &&
        info.save,
      info,
    }
  })

  /* ── 9–12 · 보관함에서 B 저장 ──────────────────────────────────── */
  let archiveDraftTime = null
  await step(
    '9 · 10 · 11 이 순간 저장 — 시점이 고정되고, 메모를 쓰는 동안 저장되지 않는다',
    async () => {
      const before = (await stored()).length
      await click('#archive-panel-moments .current-head .capture-button')
      await sleep(400)
      archiveDraftTime = await ev(
        `${P}.querySelector('.current-head .target-time')?.textContent.trim()`,
      )
      const focus = await ev(`document.activeElement?.id`)
      await typeText('보관함에서 쓴 메모')
      const v1 = await video()
      await sleep(3000)
      const v2 = await video()
      const later = await ev(`${P}.querySelector('.current-head .target-time')?.textContent.trim()`)
      const stillCount = (await stored()).length
      const state = await ev(`${P}.querySelector('.current-head .draft-state')?.textContent.trim()`)
      await shot('archive-draft')
      return {
        pass:
          focus === 'archive-moment-capture-note' &&
          later === archiveDraftTime &&
          v2.t > v1.t + 2 &&
          !v2.paused &&
          stillCount === before &&
          state === '저장 전',
        archiveDraftTime,
        later,
        v1,
        v2,
        stillCount,
      }
    },
  )

  await step('12 Moment 저장 — 생성 · 강조 · 목록 · 영상 띠 갱신', async () => {
    const before = (await stored()).length
    await click('#archive-panel-moments .current-head .draft-save')
    await sleep(800)
    const list = await stored()
    const saved = list.at(-1)
    const ui = await ev(`(() => ({
      newRow: ${P}.querySelector('.moment-item.is-new')?.dataset.momentId ?? null,
      badge: ${P}.querySelector('.moment-item.is-new .new-badge')?.textContent.trim() ?? null,
      feedback: ${P}.querySelector('.current-head .feedback')?.textContent.trim(),
      stripRows: ${strip}.querySelectorAll('.moment-row').length,
      chip: ${P}.querySelector('.chip').textContent.trim(),
    }))()`)
    await shot('archive-saved')
    return {
      pass:
        list.length === before + 1 &&
        saved.note === '보관함에서 쓴 메모' &&
        saved.atSeconds === toSec(archiveDraftTime) &&
        saved.videoId === BUNNY &&
        ui.newRow === saved.id &&
        ui.badge === '방금 저장' &&
        ui.feedback.includes('Moment 를 저장했어요') &&
        ui.stripRows === 4 &&
        ui.chip === '이 곡 4',
      saved,
      ui,
    }
  })

  await step('13 저장 취소 — 데이터가 남지 않는다', async () => {
    const before = await ev(`localStorage.getItem('39page.moments')`)
    await click('#archive-panel-moments .current-head .capture-button')
    await sleep(300)
    await typeText('버릴 메모')
    await click('#archive-panel-moments .current-head .draft-cancel')
    await sleep(400)
    const after = await ev(`localStorage.getItem('39page.moments')`)
    const form = await ev(`!!${P}.querySelector('.current-head .draft-form')`)
    return { pass: after === before && !form }
  })

  await step(
    '안전성 — 다른 탭이 먼저 저장하면 거절하고 초안 · 메모를 지킨다, 다시 저장하면 둘 다 남는다',
    async () => {
      await click('#archive-panel-moments .current-head .capture-button')
      await sleep(300)
      await typeText('충돌을 견딘 메모')
      // 둘째 탭(같은 프로필 · 같은 출처)이 Moment 하나를 저장한다.
      const { targetId } = await h.cdp.send('Target.createTarget', {
        url: BASE + '/',
        background: true,
      })
      const other = await h.cdp.attach(targetId)
      await h.cdp.send('Runtime.enable', {}, other)
      await waitFor(
        () => h.cdp.evaluate(other, `!!document.querySelector('[data-widget="player"]')`),
        { label: 'tab2' },
      )
      await h.cdp.evaluate(
        other,
        `(() => { const raw = JSON.parse(localStorage.getItem('39page.moments')); const now = new Date().toISOString(); raw.data.push({ id: 'other-tab-1', source: 'youtube', videoId: 'jNQXAC9IVRw', atSeconds: 5, note: '다른 탭', title: 'Me at the zoo', createdAt: now, updatedAt: now }); localStorage.setItem('39page.moments', JSON.stringify(raw)); return true })()`,
      )
      await sleep(500)
      const countOther = (await stored()).length
      // 실제 브라우저에서는 둘째 탭의 쓰기가 storage 이벤트로 먼저 와서 이 탭이 최신을 다시 읽는 경우가 많다 — 그러면
      // 충돌 없이 저장된다. 이벤트보다 저장이 먼저면 conflict 로 거절되고 초안 · 메모가 남는다. 둘 다 받아들이되,
      // 어느 쪽이든 두 Moment 가 정확히 한 번씩 남고 메모를 잃지 않아야 한다.
      await click('#archive-panel-moments .current-head .draft-save')
      await sleep(900)
      const first = await ev(`(() => ({
        feedback: ${P}.querySelector('.current-head .feedback')?.textContent.trim(),
        form: !!${P}.querySelector('.current-head .draft-form'),
        note: document.getElementById('archive-moment-capture-note')?.value ?? null,
      }))()`)
      const afterFirst = (await stored()).length
      let route = 'picked-up'
      if (first.form) {
        route = 'refused-then-retry'
        await click('#archive-panel-moments .current-head .draft-save')
        await sleep(900)
      }
      const final = await stored()
      await h.cdp.send('Target.closeTarget', { targetId })
      const refusedOk =
        route === 'picked-up' ||
        (first.note === '충돌을 견딘 메모' &&
          afterFirst === countOther &&
          !first.feedback.includes('Moment 를 저장했어요'))
      return {
        pass:
          refusedOk &&
          final.filter((m) => m.id === 'other-tab-1').length === 1 &&
          final.filter((m) => m.note === '충돌을 견딘 메모').length === 1 &&
          final.length === countOther + 1 &&
          new Set(final.map((m) => m.id)).size === final.length,
        route,
        first,
        countOther,
        final: final.length,
      }
    },
  )

  await step('14 노래가 바뀌어도 초안은 처음 영상 · 시점으로 저장된다', async () => {
    await click('#archive-panel-moments .current-head .capture-button')
    await sleep(300)
    const draftTime = await ev(
      `${P}.querySelector('.current-head .target-time')?.textContent.trim()`,
    )
    await typeText('곡이 바뀌기 전의 순간')
    await ev(`document.querySelector('.player-surface [aria-label="다음 곡"]').click(); true`)
    await waitFor(async () => (await appState()).title === 'Me at the zoo', {
      timeout: 30_000,
      label: 'next song',
    })
    await sleep(1200)
    const stale = await ev(
      `${P}.querySelector('.current-head .stale-note')?.textContent.trim() ?? null`,
    )
    const target = await ev(
      `${P}.querySelector('.current-head .note-target')?.textContent.replace(/\\s+/g, ' ').trim()`,
    )
    await shot('archive-draft-stale')
    await click('#archive-panel-moments .current-head .draft-save')
    await sleep(800)
    const saved = (await stored()).at(-1)
    return {
      pass:
        stale !== null &&
        target.includes('Big Buck Bunny') &&
        saved.videoId === BUNNY &&
        saved.atSeconds === toSec(draftTime) &&
        saved.note === '곡이 바뀌기 전의 순간',
      stale,
      target,
      saved,
    }
  })

  // Me at the zoo 는 19초 — 끝나면 다음 곡(Big Buck Bunny (다시))으로 넘어간다. 계속 재생 중이면 된다.
  await waitFor(async () => (await video())?.paused === false, { timeout: 40_000, label: 'resume' })

  /* ── 16–17 · 트랙 편집 ─────────────────────────────────────────── */
  const rowsInEditor = () =>
    ev(
      `[...document.querySelectorAll('.playlist-editor .track[data-track-id]')].map((r) => r.dataset.trackId)`,
    )
  let originalOrder = null
  await step('16 데스크톱 끌어 놓기 — 손잡이로 첫 곡을 셋째 아래로, 재생은 그대로', async () => {
    await click('#archive-tab-music')
    await sleep(600)
    originalOrder = await libraryTracks()
    const ids = await rowsInEditor()
    const from = await center(`.playlist-editor .track[data-track-id="${ids[0]}"] .track-handle`)
    const third = await ev(
      `(() => { const r = document.querySelector('.playlist-editor .track[data-track-id="${ids[2]}"]').getBoundingClientRect(); return { y: r.bottom - 4 } })()`,
    )
    await send('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x: from.x,
      y: from.y,
      button: 'left',
      buttons: 1,
      clickCount: 1,
    })
    const steps = 8
    for (let i = 1; i <= steps; i += 1)
      await send('Input.dispatchMouseEvent', {
        type: 'mouseMoved',
        x: from.x,
        y: from.y + ((third.y - from.y) * i) / steps,
        button: 'left',
        buttons: 1,
      })
    await sleep(200)
    const during = await ev(`(() => ({
      dragging: !!document.querySelector('.playlist-editor .track.is-dragging'),
      line: !!document.querySelector('.playlist-editor .track.drop-after, .playlist-editor .track.drop-before'),
    }))()`)
    await shot('drag-in-progress')
    await send('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x: from.x,
      y: third.y,
      button: 'left',
      buttons: 0,
      clickCount: 1,
    })
    await sleep(800)
    const after = await libraryTracks()
    const status = await ev(
      `document.querySelector('.playlist-editor .move-status')?.textContent.trim()`,
    )
    const r = await advancing()
    await shot('drag-done')
    const expected = [originalOrder[1], originalOrder[2], originalOrder[0], originalOrder[3]].map(
      (t) => t.id,
    )
    return {
      pass:
        during.dragging &&
        during.line &&
        JSON.stringify(after.map((t) => t.id)) === JSON.stringify(expected) &&
        status.includes('3번째로 옮겼어요') &&
        r.advancing,
      during,
      after: after.map((t) => t.title),
      status,
      r,
    }
  })

  await step(
    '17 키보드 — 손잡이에서 ↑ · Home, 포커스가 그 곡에 남는다 (같은 영상의 다른 트랙)',
    async () => {
      const tracks = await libraryTracks()
      const dup = tracks.find((t) => t.title === 'Big Buck Bunny (다시)')
      const otherBunny = tracks.find((t) => t.v === BUNNY && t.id !== dup.id)
      await ev(
        `document.querySelector('.playlist-editor .track[data-track-id="${dup.id}"] .track-handle').focus(); true`,
      )
      await key('ArrowUp', 'ArrowUp', 38)
      await sleep(400)
      const afterUp = await libraryTracks()
      const focus1 = await ev(`document.activeElement?.closest('.track')?.dataset.trackId`)
      await key('Home', 'Home', 36)
      await sleep(400)
      const afterHome = await libraryTracks()
      const focus2 = await ev(`document.activeElement?.closest('.track')?.dataset.trackId`)
      const handleFocused = await ev(`document.activeElement?.classList.contains('track-handle')`)
      const status = await ev(
        `document.querySelector('.playlist-editor .move-status')?.textContent.trim()`,
      )
      return {
        pass:
          afterUp.findIndex((t) => t.id === dup.id) === 2 &&
          afterHome[0].id === dup.id &&
          focus1 === dup.id &&
          focus2 === dup.id &&
          handleFocused &&
          // 같은 영상의 다른 트랙은 따라 움직이지 않았다 — 트랙 id 로 옮긴다.
          afterHome.findIndex((t) => t.id === otherBunny.id) ===
            afterUp.findIndex((t) => t.id === otherBunny.id) + 1 &&
          status.includes('1번째로 옮겼어요'),
        afterUp: afterUp.map((t) => t.title),
        afterHome: afterHome.map((t) => t.title),
        status,
      }
    },
  )

  /* ── 19 · NOW PLAYLIST ─────────────────────────────────────────── */
  await step(
    '19 순서를 바꾼 뒤 NOW PLAYLIST — 큐는 그대로 · 안내 · 고를 때만 새 순서, 재생 위치 유지',
    async () => {
      await closeArchive()
      const s = await appState()
      const notice = await ev(
        `document.querySelector('.now-playlist .source-notice')?.textContent.replace(/\\s+/g, ' ').trim() ?? null`,
      )
      const queueRows = await ev(
        `[...document.querySelectorAll('.now-playlist .track-row .track-title')].map((n) => n.textContent.trim())`,
      )
      await shot('now-playlist-changed')
      const v1 = await video()
      await clickText('.now-playlist .source-notice .pill', '새 순서로 이어 재생')
      await sleep(600)
      const v2 = await video()
      const newRows = await ev(
        `[...document.querySelectorAll('.now-playlist .track-row .track-title')].map((n) => n.textContent.trim())`,
      )
      const lib = (await libraryTracks()).map((t) => t.title)
      const current = await ev(
        `document.querySelector('.now-playlist .track-row.is-current .track-title')?.textContent.trim()`,
      )
      return {
        pass:
          s.nowView === 'queue' &&
          notice?.includes('목록이 변경됐어요') &&
          JSON.stringify(queueRows) === JSON.stringify(originalOrder.map((t) => t.title)) &&
          JSON.stringify(newRows) === JSON.stringify(lib) &&
          current === s.title &&
          v2 !== null &&
          !v2.paused &&
          v2.t >= v1.t,
        notice,
        queueRows,
        newRows,
        v1,
        v2,
      }
    },
  )

  /* ── 20 · 보관함 · 테마 ───────────────────────────────────────── */
  await step('20 보관함 열기 · 닫기와 테마 전환 중 재생 유지 (Mono) — 같은 iframe', async () => {
    await openArchive()
    const r1 = await advancing()
    await closeArchive()
    await clickText('.theme-button', 'MONO VINYL')
    await sleep(500)
    const r2 = await advancing()
    await openArchive()
    await click('#archive-tab-moments')
    await sleep(500)
    await shot('mono-archive-this-song')
    const f = await frame()
    const s = await appState()
    const r3 = await advancing()
    await closeArchive()
    await shot('mono-dashboard')
    return {
      pass:
        f.marker === marker &&
        s.theme === 'mono-vinyl' &&
        r1.advancing &&
        r2.advancing &&
        r3.advancing &&
        f.covered === 0,
      f,
      s,
    }
  })

  /* ── 18 · 모바일 편집 모드 ─────────────────────────────────────── */
  await step(
    '18 모바일(390×844 · 터치) 편집 모드 — 평소엔 손잡이가 없고, 편집에서 손잡이 · ↑ ↓ · 손가락 끌기',
    async () => {
      await size(390, 844, true)
      await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 })
      await sleep(700)
      await openArchive()
      await click('#archive-tab-music')
      await sleep(400)
      if (await ev(`getComputedStyle(document.querySelector('.music-lists')).display !== 'none'`))
        await clickText('.archive-lists .list-select', LIST)
      await sleep(500)
      const normal = await ev(`(() => ({
      handle: getComputedStyle(document.querySelector('.playlist-editor .track-handle')).display,
      coarse: matchMedia('(pointer: coarse)').matches,
    }))()`)
      await click('.playlist-editor .edit-toggle')
      await sleep(400)
      const edit = await ev(`(() => {
      const h = document.querySelector('.playlist-editor .track-handle')
      const r = h.getBoundingClientRect()
      const up = document.querySelectorAll('.playlist-editor .edit-up')[1].getBoundingClientRect()
      return { handle: getComputedStyle(h).display, hw: Math.round(r.width), hh: Math.round(r.height), upH: Math.round(up.height), play: document.querySelectorAll('.playlist-editor .track-play').length, pressed: document.querySelector('.playlist-editor .edit-toggle').getAttribute('aria-pressed') }
    })()`)
      await shot('mobile-390-edit-mode')
      // ↑ 단추
      const before = await libraryTracks()
      const idsBefore = await rowsInEditor()
      await click(`.playlist-editor .track[data-track-id="${idsBefore[1]}"] .edit-up`)
      await sleep(700)
      const afterUp = await libraryTracks()
      // 손가락 끌기 — 셋째 곡의 손잡이를 첫 줄 위로. 끄는 동안 목록이 스크롤되지 않는다.
      const ids = await rowsInEditor()
      const from = await center(`.playlist-editor .track[data-track-id="${ids[2]}"] .track-handle`)
      const topY = await ev(
        `document.querySelector('.playlist-editor .track[data-track-id="${ids[0]}"]').getBoundingClientRect().top + 4`,
      )
      const scrollBefore = await ev(
        `document.querySelector('.playlist-editor .editor-body').scrollTop + ':' + scrollY`,
      )
      await send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [{ x: from.x, y: from.y }],
      })
      for (let i = 1; i <= 8; i += 1)
        await send('Input.dispatchTouchEvent', {
          type: 'touchMove',
          touchPoints: [{ x: from.x, y: from.y + ((topY - from.y) * i) / 8 }],
        })
      const scrollDuring = await ev(
        `document.querySelector('.playlist-editor .editor-body').scrollTop + ':' + scrollY`,
      )
      await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
      await sleep(800)
      const afterDrag = await libraryTracks()
      await click('.playlist-editor .edit-toggle')
      await sleep(300)
      const back = await ev(`document.querySelectorAll('.playlist-editor .track-play').length`)
      const r = await advancing()
      const s = await appState()
      await shot('mobile-390-after-edit')
      await closeArchive()
      await send('Emulation.setTouchEmulationEnabled', { enabled: false })
      return {
        pass:
          normal.coarse &&
          normal.handle === 'none' &&
          edit.handle !== 'none' &&
          edit.hw >= 44 &&
          edit.hh >= 44 &&
          edit.upH >= 44 &&
          edit.play === 0 &&
          edit.pressed === 'true' &&
          afterUp[0].id === before[1].id &&
          afterDrag[0].id === ids[2] &&
          // 페이지는 움직이지 않는다(손잡이만 touch-action: none). 편집 칸 scrollTop 은 가장자리 자동 스크롤로 바뀔 수 있다.
          scrollDuring.split(':')[1] === scrollBefore.split(':')[1] &&
          back === 4 &&
          r.advancing &&
          s.overflowX === 0,
        normal,
        edit,
        afterUp: afterUp.map((t) => t.title),
        afterDrag: afterDrag.map((t) => t.title),
        scrollBefore,
        scrollDuring,
        r,
      }
    },
  )

  // 모바일 단계가 중간에 끝나도 터치 흉내를 끈다.
  await send('Emulation.setTouchEmulationEnabled', { enabled: false }).catch(() => {})
  await closeArchive().catch(() => {})

  /* ── 반응형 — 대시보드 Moments · 보관함 이 곡 (두 테마는 위에서) ──────────────── */
  for (const [w, hh, mobile, label] of [
    [320, 640, true, '320'],
    [360, 740, true, '360'],
    [390, 844, true, '390'],
    [768, 1024, true, '768'],
    [1024, 768, false, '1024'],
    [1440, 900, false, '1440'],
    [844, 390, true, '844x390'],
  ]) {
    await step(
      `반응형 ${label} — 가로 넘침 없음 · 저장 단추 닿음 · 보관함 이 곡 · 재생 계속`,
      async () => {
        await size(w, hh, mobile)
        await sleep(700)
        await ev(`window.scrollTo(0, 0); true`)
        const dash = await ev(`(() => {
        const b = document.querySelector('.moments-widget .capture-button')
        const r = b?.getBoundingClientRect()
        const list = document.querySelector('.moments-widget .moment-rows')
        return { capture: !!b && r.width > 0 && r.height >= 44, rows: document.querySelectorAll('.moments-widget .moment-row').length, innerScroll: list ? getComputedStyle(list).overflowY : null, expand: !!document.querySelector('.moments-widget .expand') && getComputedStyle(document.querySelector('.moments-widget .expand')).display !== 'none' }
      })()`)
        // 영상을 화면 밖으로 굴리지 않는다 — 가시성 가드가 재생을 멈춘다(ADR 0011). 첫 실행에서 하네스가 그렇게 멈췄다.
        await shot(`dash-moments-${label}`)
        await openArchive()
        await click('#archive-tab-moments')
        await sleep(500)
        await shot(`archive-moments-${label}`)
        const s = await appState()
        const f = await frame()
        const r = await advancing()
        await closeArchive()
        return {
          pass: s.overflowX === 0 && dash.capture && f.marker === marker && r.advancing,
          dash,
          layout: s.layout,
          overflowX: s.overflowX,
          f,
        }
      },
    )
  }

  writeFileSync(
    path.join(OUT, 'real.json'),
    JSON.stringify({ browser: h.cdp.version, results }, null, 2),
  )
  console.log(`${results.filter((r) => r.pass).length}/${results.length} PASS`)
} finally {
  h.cdp.close()
  h.kill()
}
