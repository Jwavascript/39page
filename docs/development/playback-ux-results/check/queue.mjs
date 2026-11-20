// ADR 0038 — 재생 큐 UX 실제 Chrome 확인 (목록 바꾸기 즉시 재생 · 큐가 목록을 따름 · 셔플 · 반복 · 단추 배치).
// 로컬 프로덕션 빌드(127.0.0.1:4173)와 격리된 임시 Chrome 프로필만 쓴다. 운영 39page 에 닿지 않는다.
// 실행: npm run build && POC_CHROME=<chrome.exe> node docs/development/playback-ux-results/check/queue.mjs
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { launch, BASE, sleep, waitFor } from '../../../../extension/integration/harness.mjs'

const OUT = path.resolve('docs/development/playback-ux-results')
mkdirSync(OUT, { recursive: true })

const V = { bunny: 'aqz-KE-bpKQ', sintel: 'eRsGyueVLvQ', demo: 'M7lc1UVf-VE' }
const seed = {
  version: 1,
  data: {
    playlists: [
      {
        id: 'a',
        name: 'LIST A',
        tracks: [
          { id: 'a1', source: 'youtube', videoId: V.bunny, title: 'A1 Bunny' },
          { id: 'a2', source: 'youtube', videoId: V.sintel, title: 'A2 Sintel' },
          { id: 'a3', source: 'youtube', videoId: V.demo, title: 'A3 Demo' },
        ],
      },
      {
        id: 'b',
        name: 'LIST B',
        tracks: [
          { id: 'b1', source: 'youtube', videoId: V.sintel, title: 'B1 Sintel' },
          { id: 'b2', source: 'youtube', videoId: V.bunny, title: 'B2 Bunny' },
        ],
      },
      { id: 'e', name: 'EMPTY', tracks: [] },
    ],
    selectedPlaylistId: 'a',
  },
}

const results = []
function record(name, pass, details = {}) {
  results.push({ name, pass: Boolean(pass), details })
  console.log(pass ? 'PASS' : 'FAIL', name, JSON.stringify(details).slice(0, 500))
}

/** 화면 · 플레이어 상태를 한 번에 읽는다. 플레이어 값은 YT 공식 API(`YT.get`)가 주는 캐시다. */
const PROBE = `(() => {
  const q = (s) => document.querySelector(s)
  const f = q('.player-mount iframe')
  let p = null
  try { p = f && f.id && window.YT && YT.get ? YT.get(f.id) : null } catch { p = null }
  const t = (s) => q(s)?.textContent.replace(/\\s+/g, ' ').trim() ?? null
  return {
    title: t('.now-playing-card .now-title'),
    position: t('.now-playing-card .now-position'),
    status: t('.now-playing-card .status'),
    chip: t('.now-playlist .state-chip'),
    view: q('.now-playlist')?.dataset.view ?? null,
    listName: t('.now-playlist .list-name'),
    sub: t('.now-playlist .widget-sub'),
    rows: [...document.querySelectorAll('.now-playlist .track-row .track-title')].map((e) => e.textContent.trim()),
    current: t('.now-playlist .track-row.is-current .track-title'),
    notice: !!q('.now-playlist .source-notice'),
    modes: [...document.querySelectorAll('.now-playing-card button.mode')].map((b) => ({ label: b.getAttribute('aria-label'), pressed: b.getAttribute('aria-pressed') })),
    video: p?.getVideoData?.()?.video_id ?? null,
    time: typeof p?.getCurrentTime === 'function' ? p.getCurrentTime() : null,
    duration: typeof p?.getDuration === 'function' ? p.getDuration() : null,
    ytState: typeof p?.getPlayerState === 'function' ? p.getPlayerState() : null,
  }
})()`

/** 다른 탭이 저장소를 고친 것처럼 — 확장 저장 · 다른 탭 편집이 대시보드에 닿는 길과 같다. */
const editLibrary = (body) => `(() => {
  const raw = JSON.parse(localStorage.getItem('39page.library'))
  const lists = raw.data.playlists
  const list = (id) => lists.find((p) => p.id === id)
  ;(${body})(list)
  localStorage.setItem('39page.library', JSON.stringify(raw))
  return true
})()`

async function main() {
  const h = await launch({
    chrome: process.env.POC_CHROME,
    webDist: path.resolve('dist'),
    headful: false,
  })
  try {
    const p = await h.tab('about:blank')
    const ev = p.ev
    const send = (method, params = {}) => h.cdp.send(method, params, p.session)
    await send('Network.enable')
    await send('Network.setBlockedURLs', { urls: ['*open-meteo*'] })
    const size = (width, height) =>
      send('Emulation.setDeviceMetricsOverride', {
        width,
        height,
        deviceScaleFactor: 1,
        mobile: width <= 768,
      })
    await size(1440, 900)
    await send('Page.navigate', { url: BASE })
    await waitFor(() => ev(`!!document.querySelector('.now-playlist')`), { label: 'app' })
    await ev(
      `localStorage.setItem('39page.library', ${JSON.stringify(JSON.stringify(seed))}); true`,
    )
    await ev(`window.__old = true; true`)
    await send('Page.reload')
    await waitFor(
      () => ev(`!window.__old && !!document.querySelector('.now-playlist .track-row')`),
      {
        label: 'seeded app',
      },
    )

    const probe = () => ev(PROBE)
    const click = async (selector, index = 0) => {
      const point = await ev(
        `(() => { const e = document.querySelectorAll(${JSON.stringify(selector)})[${index}]; if (!e) throw Error('no element ' + ${JSON.stringify(selector)}); e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })()`,
      )
      for (const type of ['mousePressed', 'mouseReleased'])
        await send('Input.dispatchMouseEvent', { type, ...point, button: 'left', clickCount: 1 })
      await sleep(250)
    }
    const until = (check, label, timeout = 25_000) =>
      waitFor(
        async () => {
          const state = await probe()
          return check(state) ? state : null
        },
        { timeout, label },
      )
    const playing = (title) => (s) => s.title === title && s.ytState === 1 && s.chip === '재생 중'
    /** 카드만 찍는다. clip 은 문서 좌표다 — 스크롤한 만큼 더한다. 마우스는 카드 밖으로 치워 hover 를 지운다. */
    const shotCard = async (name) => {
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 1, y: 1 })
      const box = await ev(
        `(() => { const e = document.querySelector('.now-playing-card'); e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return { x: r.x + scrollX, y: r.y + scrollY, width: r.width, height: r.height } })()`,
      )
      await sleep(300)
      const shot = await send('Page.captureScreenshot', {
        format: 'png',
        clip: { ...box, scale: 1 },
      })
      writeFileSync(path.join(OUT, `${name}.png`), Buffer.from(shot.data, 'base64'))
    }

    /* 1. 재생 시작 */
    await click('.now-playlist .track-row', 0)
    let s = await until(playing('A1 Bunny'), 'A1 playing')
    record('재생 시작 — 목록 A 첫 곡', true, { video: s.video, rows: s.rows })
    await sleep(3500)
    const before = await probe()

    /* 2. 다른 탭에서 곡 추가 → 큐 끝에 바로, 안내 없음, 소리 끊김 없음 */
    const other = await h.tab(BASE)
    await waitFor(() => other.ev(`!!document.querySelector('.now-playlist')`), { label: 'tab 2' })
    await other.ev(
      editLibrary(
        `(list) => list('a').tracks.push({ id: 'a4', source: 'youtube', videoId: '${V.sintel}', title: 'A4 Added' })`,
      ),
    )
    s = await until((x) => x.rows.length === 4, 'added row')
    await sleep(1500)
    const afterAdd = await probe()
    record(
      '곡 추가 — 큐 끝에 바로 붙고 안내 없이 같은 영상이 이어진다',
      s.rows[3] === 'A4 Added' &&
        !afterAdd.notice &&
        afterAdd.video === before.video &&
        afterAdd.ytState === 1 &&
        afterAdd.time > before.time &&
        afterAdd.sub.includes('1 / 4곡'),
      { rows: afterAdd.rows, sub: afterAdd.sub, timeBefore: before.time, timeAfter: afterAdd.time },
    )

    /* 3. 순서 변경 — 지금 곡을 맨 뒤로. 줄 · 위치가 바뀌고, 영상 · 시점은 그대로 */
    await other.ev(
      editLibrary(`(list) => { const a = list('a'); a.tracks.push(a.tracks.shift()) }`),
    )
    s = await until((x) => x.rows[3] === 'A1 Bunny', 'reordered')
    await sleep(1500)
    const afterMove = await probe()
    record(
      '순서 변경 — 지금 곡 표시만 옮기고 재생 위치는 그대로',
      afterMove.current === 'A1 Bunny' &&
        afterMove.sub.includes('4 / 4곡') &&
        !afterMove.notice &&
        afterMove.video === before.video &&
        afterMove.ytState === 1 &&
        afterMove.time > afterAdd.time,
      { rows: afterMove.rows, sub: afterMove.sub, time: afterMove.time },
    )

    /* 4. 지금 곡 삭제 — 안내 없이 다음 곡(마지막이었으니 반복 끔 → 앞 곡에 서서 멈춤) */
    await other.ev(
      editLibrary(
        `(list) => { const a = list('a'); a.tracks = a.tracks.filter((t) => t.id !== 'a1') }`,
      ),
    )
    s = await until((x) => x.title === 'A4 Added' && x.rows.length === 3, 'deleted current')
    await sleep(2000)
    const afterDelete = await probe()
    record(
      '지금 곡(마지막 자리) 삭제, 반복 끔 — 앞 곡에 서서 멈추고 안내가 없다',
      afterDelete.video === V.sintel &&
        afterDelete.ytState !== 1 &&
        !afterDelete.notice &&
        (afterDelete.status ?? '') === '',
      {
        title: afterDelete.title,
        ytState: afterDelete.ytState,
        rows: afterDelete.rows,
        status: afterDelete.status,
      },
    )

    /* 5. 재생 중 지금 곡 삭제 — 다음 곡을 바로 재생 */
    await click('.now-playlist .track-row', 0) // A2 Sintel
    await until(playing('A2 Sintel'), 'A2 playing')
    await other.ev(
      editLibrary(
        `(list) => { const a = list('a'); a.tracks = a.tracks.filter((t) => t.id !== 'a2') }`,
      ),
    )
    s = await until(playing('A3 Demo'), 'next after delete')
    record('재생 중 지금 곡 삭제 — 안내 없이 다음 곡을 재생', !s.notice && s.video === V.demo, {
      rows: s.rows,
      video: s.video,
    })

    /* 6. 목록 바꾸기 — 재생 중 다른 목록을 고르면 바로 처음부터 */
    await click('.now-playlist .switch-list')
    const hint = await ev(
      `document.querySelector('.now-playlist .picker-hint')?.textContent.trim()`,
    )
    await click('.now-playlist .picker-row', 1)
    s = await until(playing('B1 Sintel'), 'switched to B')
    record(
      '목록 바꾸기 — 고른 목록을 처음부터 바로 재생, 안내 상자 없음',
      s.listName === 'LIST B' && !s.notice && s.view === 'queue',
      {
        hint,
        listName: s.listName,
        rows: s.rows,
      },
    )

    /* 7. 빈 목록 고르기 — 재생은 그대로, 대기 보기 + 부제의 지금 재생 */
    await click('.now-playlist .switch-list')
    await click('.now-playlist .picker-row', 2)
    await sleep(1200)
    s = await probe()
    record(
      '빈 목록 고르기 — 재생은 그대로, 부제에 지금 재생',
      s.view === 'standby' &&
        s.sub.includes('지금 재생: LIST B') &&
        s.ytState === 1 &&
        s.title === 'B1 Sintel' &&
        !s.notice,
      {
        view: s.view,
        sub: s.sub,
      },
    )
    await click('.now-playlist .switch-list')
    await click('.now-playlist .picker-row', 1) // 재생 중인 목록 → 큐 보기 (다시 틀지 않는다)
    await sleep(800)
    const back = await probe()
    record(
      '재생 중인 목록을 다시 고르면 큐 보기 — 처음부터 다시 틀지 않는다',
      back.view === 'queue' && back.time > 2,
      {
        time: back.time,
      },
    )

    /* 8. 셔플 · 반복 단추 */
    await click('.now-playing-card button.mode', 0)
    await click('.now-playing-card button.mode', 1)
    s = await probe()
    await shotCard('card-shuffle-repeat-all-1440')
    record(
      '셔플 · 전체 반복 켜기 — aria-pressed · 부제 표시 · 지금 곡이 01',
      s.modes[0]?.pressed === 'true' &&
        s.modes[1]?.pressed === 'true' &&
        s.sub.includes('셔플 · 전체 반복') &&
        s.ytState === 1,
      {
        modes: s.modes,
        sub: s.sub,
        currentRow: await ev(
          `document.querySelector('.now-playlist .track-row.is-current .track-no')?.textContent.trim()`,
        ),
      },
    )

    /* 9. 전체 반복 — 마지막 곡이 끝나면 처음 곡. 끝 근처로 옮겨 실제 ended 를 받는다 */
    await click('.now-playing-card button.mode', 0) // 셔플 끄기 — 순서를 정해 두고 본다
    await click('.now-playlist .track-row', 1) // B2 Bunny (마지막)
    s = await until(playing('B2 Bunny'), 'B2 playing')
    await ev(
      `(() => { const f = document.querySelector('.player-mount iframe'); YT.get(f.id).seekTo(YT.get(f.id).getDuration() - 3, true); return true })()`,
    )
    s = await until(playing('B1 Sintel'), 'repeat all wrap', 40_000)
    record(
      '전체 반복 — 마지막 곡이 끝나면 처음 곡을 재생 (실제 ended)',
      s.current === 'B1 Sintel',
      { title: s.title },
    )

    /* 10. 한 곡 반복 — 끝나면 같은 곡을 처음부터 */
    await click('.now-playing-card button.mode', 1) // 전체 → 한 곡
    await shotCard('card-repeat-one-1440')
    await sleep(2500)
    await ev(
      `(() => { const f = document.querySelector('.player-mount iframe'); YT.get(f.id).seekTo(YT.get(f.id).getDuration() - 3, true); return true })()`,
    )
    await waitFor(async () => ((await probe()).time ?? 0) > 20, {
      label: 'near end',
      timeout: 10_000,
    })
    s = await until(
      (x) => x.title === 'B1 Sintel' && x.ytState === 1 && x.time !== null && x.time < 10,
      'repeat one restart',
      40_000,
    )
    record('한 곡 반복 — 끝나면 같은 곡을 처음부터 (실제 ended)', s.current === 'B1 Sintel', {
      time: s.time,
      label: s.modes[1]?.label,
    })
    // Mono Vinyl 테마에서도 같은 상태(한 곡 반복)를 본다 — 테마를 바꿔도 재생 · 모드는 그대로다 (규칙 5).
    await ev(
      `[...document.querySelectorAll('.theme-button')].find((b) => !b.classList.contains('is-active'))?.click(); true`,
    )
    await sleep(600)
    const mono = await probe()
    await shotCard('card-repeat-one-mono-1440')
    record(
      '테마 전환 — 재생 · 셔플 · 반복이 그대로다',
      mono.ytState === 1 &&
        mono.title === 'B1 Sintel' &&
        mono.modes[1]?.label === '반복: 한 곡 반복 (누르면 반복 끔)',
      { theme: await ev(`document.documentElement.dataset.theme`), label: mono.modes[1]?.label },
    )
    await ev(
      `[...document.querySelectorAll('.theme-button')].find((b) => !b.classList.contains('is-active'))?.click(); true`,
    )
    await sleep(400)
    await click('.now-playing-card button.mode', 1) // 한 곡 → 끔

    /* 11. 단추 배치 — 폭별로 한 줄 · 넘침 · 겹침 · 터치 크기 (보관함 닫힘 · 열림) */
    const MEASURE = `(() => {
      const card = document.querySelector('.now-playing-card .np-body').getBoundingClientRect()
      const visible = (e) => e.offsetParent !== null
      const all = [...document.querySelectorAll('.now-playing-card .action-row button')].filter(visible)
      const btns = all.map((b) => b.getBoundingClientRect())
      const row = [...document.querySelectorAll('.now-playing-card .transport button')].filter(visible).map((b) => b.getBoundingClientRect())
      const centers = row.map((r) => r.top + r.height / 2)
      const art = document.querySelector('.now-playing-card .np-art')
      const artRect = art && visible(art) ? art.getBoundingClientRect() : null
      return {
        oneLine: Math.max(...centers) - Math.min(...centers) < 2,
        rowCount: row.length,
        underArt: artRect !== null && row.length > 0 ? row[0].top >= artRect.bottom - 0.5 : null,
        inside: btns.every((r) => r.left >= card.left - 0.5 && r.right <= card.right + 0.5),
        overlap: btns.some((a, i) => btns.some((b, j) => j > i && a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5)),
        minSide: Math.min(...btns.map((r) => Math.min(r.width, r.height))),
        pageOverflow: document.scrollingElement.scrollWidth > innerWidth,
        cardWidth: Math.round(card.width),
      }
    })()`
    const layout = []
    for (const [w, hgt] of [
      [1440, 900],
      [1024, 768],
      [768, 1024],
      [390, 844],
      [360, 740],
      [320, 640],
    ]) {
      await size(w, hgt)
      await sleep(700)
      layout.push({ width: w, archive: 'closed', ...(await ev(MEASURE)) })
      await shotCard(`card-${w}`)
    }
    record(
      '단추 배치 (보관함 닫힘) — 6개 폭에서 🔀 ⏮ ▶ ⏭ 🔁 한 줄 · 카드 안 · 겹침 없음 · 44px · 가로 넘침 없음',
      layout.every(
        (x) =>
          x.oneLine &&
          x.rowCount === 5 &&
          x.inside &&
          !x.overlap &&
          x.minSide >= 43.5 &&
          !x.pageOverflow,
      ),
      { layout },
    )

    // 보관함을 연 배치 — 넓으면 재생 띠(셔플 · 반복 포함 한 줄), 좁으면 한 줄 카드(재생 단추 셋만).
    const opened = []
    for (const [w, hgt] of [
      [1440, 900],
      [390, 844],
    ]) {
      await size(w, hgt)
      await sleep(500)
      await click('.now-playlist .open-archive')
      await waitFor(
        () =>
          ev(`!!document.querySelector('[data-archive-layout]:not([data-archive-layout="none"])')`),
        { label: 'archive open', timeout: 8000 },
      )
      await sleep(600)
      opened.push({
        width: w,
        layout: await ev(`document.querySelector('[data-archive-layout]')?.dataset.archiveLayout`),
        ...(await ev(MEASURE)),
      })
      await shotCard(`card-archive-${w}`)
      await ev(`document.querySelector('[aria-label="보관함 닫기"]')?.click(); true`)
      await sleep(600)
    }
    record(
      '단추 배치 (보관함 열림) — 넓은 띠는 다섯 단추 한 줄, 좁은 한 줄 카드는 재생 단추 셋 · 넘침 없음',
      opened.every((x) => x.oneLine && x.inside && !x.overlap && !x.pageOverflow) &&
        opened[0]?.rowCount === 5 &&
        opened[1]?.rowCount === 3,
      { opened },
    )

    /* 12. 저장 — 셔플 · 반복은 저장하지 않는다 */
    const keys = await ev(`Object.keys(localStorage).filter((k) => k.startsWith('39page')).sort()`)
    record(
      '셔플 · 반복은 저장소 키를 만들지 않는다',
      !keys.some((k) => /shuffle|repeat|mode/i.test(k)),
      { keys },
    )
  } finally {
    h.cdp.close()
    h.kill()
    await sleep(1500)
  }
}

try {
  await main()
} catch (error) {
  record('실행 오류', false, { error: error.message })
}
const passed = results.filter((r) => r.pass).length
writeFileSync(
  path.join(OUT, 'real-chrome-queue.json'),
  `${JSON.stringify({ when: new Date().toISOString(), passed, total: results.length, results }, null, 2)}\n`,
)
console.log(`${passed}/${results.length}`)
process.exit(passed === results.length ? 0 : 1)
