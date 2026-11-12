/**
 * M11-5B — YouTube 위 플로팅 패널 실제 Chrome 통합 검증 (실제 YouTube 시청 페이지 · 실제 권한 프롬프트).
 *
 * 준비 · 실행은 `bridge.mjs` 와 같다:
 *   POC_CHROME=<…> WEB_DIST=<…> EXT_DIST=<…/extension/dist-dev> OUT=<…> node extension/integration/panel.mjs
 *
 * 툴바 클릭은 CDP `Extensions.triggerAction` (실제 activeTab 부여 · 실제 팝업이 패널을 연다). 패널 안의 조작은
 * 패널 iframe 문맥에서 DOM 클릭으로 한다 — 권한 요청만 사용자 제스처로 부르고 실제 프롬프트 단추를 누른다.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { BASE, DEV_EXTENSION_ID, launch, recorder, sleep, waitFor } from './harness.mjs'

const { POC_CHROME, WEB_DIST, EXT_DIST, OUT } = process.env
const VIDEO = 'M7lc1UVf-VE'
const YT = `https://www.youtube.com/watch?v=${VIDEO}`

const h = await launch({ chrome: POC_CHROME, webDist: WEB_DIST, extDist: EXT_DIST })
const { results, step } = recorder()

const LIBRARY = {
  version: 1,
  data: {
    playlists: [
      {
        id: 'mine',
        name: 'MINE',
        tracks: [{ id: 't1', source: 'youtube', videoId: 'aqz-KE-bpKQ', title: 'Big Buck Bunny' }],
      },
      { id: 'drive', name: '드라이브', tracks: [] },
    ],
    selectedPlaylistId: 'mine',
  },
}

try {
  const dash = await h.tab(`${BASE}/`)
  await sleep(1200)
  await dash.ev(
    `localStorage.clear(); localStorage.setItem('39page.library', ${JSON.stringify(JSON.stringify(LIBRARY))}); true`,
  )
  await h.cdp.send('Page.reload', {}, dash.session)
  await waitFor(() => dash.ev(`!!document.querySelector('.playlist-play')`), { label: 'dashboard' })
  await dash.ev(`document.querySelector('.playlist-play').click(); true`)
  await waitFor(() => dash.ev(`!!document.querySelector('.player-mount iframe')`), {
    timeout: 30_000,
    label: 'dashboard player',
  })
  await dash.ev(`document.querySelector('.player-mount iframe').dataset.m115 = 'original'; true`)
  const dashStorage = () =>
    dash.ev(`(() => { const l = JSON.parse(localStorage.getItem('39page.library')).data; const m = JSON.parse(localStorage.getItem('39page.moments') ?? '{"data":[]}').data;
      return { selected: l.selectedPlaylistId, lists: l.playlists.map((p) => p.name + ':' + p.tracks.map((t) => t.videoId).join(',')), moments: m.map((x) => x.videoId + '@' + x.atSeconds + ':' + x.note) } })()`)
  const before = await dashStorage()

  // 실제 YouTube 시청 페이지
  const yt = await h.tab(YT)
  await h.cdp.send('Target.activateTarget', { targetId: yt.targetId })
  await waitFor(
    () =>
      yt.ev(`!!document.querySelector('video') && document.querySelector('video').currentTime > 1`),
    { timeout: 45_000, label: 'youtube playing' },
  )
  const video = () =>
    yt.ev(
      `(() => { const v = document.querySelector('video'); return { t: Math.round(v.currentTime), paused: v.paused, url: location.href } })()`,
    )
  /** CDP `Extensions.triggerAction` 은 tab 종류 대상만 받는다 (page 대상의 부모). */
  const trigger = async () => {
    const tab = await waitFor(
      async () =>
        (await h.cdp.targets()).find(
          (t) => t.type === 'tab' && t.url.includes('youtube.com/watch'),
        ),
      { label: 'tab target' },
    )
    await h.cdp.send('Target.activateTarget', { targetId: yt.targetId })
    await h.cdp.send('Extensions.triggerAction', { id: DEV_EXTENSION_ID, targetId: tab.targetId })
  }
  const pageTargets = async () => (await h.cdp.targets()).filter((t) => t.type === 'page').length

  async function panelTarget() {
    return waitFor(
      async () =>
        (await h.cdp.targets()).find(
          (t) => t.type === 'iframe' && t.url.includes('/src/panel/index.html'),
        ),
      { timeout: 15_000, label: 'panel iframe' },
    )
  }
  async function attachPanel() {
    const target = await panelTarget()
    const session = await h.cdp.attach(target.targetId)
    await h.cdp.send('Runtime.enable', {}, session)
    const ev = (e, o) => h.cdp.evaluate(session, e, o)
    await waitFor(() => ev(`!!document.querySelector('.panel')`), { label: 'panel app' })
    return { target, session, ev }
  }
  const clickText = (ev, text, scope = 'document') =>
    ev(
      `(() => { const b = [...${scope}.querySelectorAll('button')].find((x) => x.textContent.trim() === ${JSON.stringify(text)}); if (!b) return 'missing'; if (b.disabled) return 'disabled'; b.click(); return 'clicked' })()`,
    )
  const feedback = (ev) =>
    ev(
      `[...document.querySelectorAll('.feedback')].map((f) => f.textContent.replace(/\\s+/g, ' ').trim()).join(' | ')`,
    )

  let panel
  await step(
    'P1',
    '툴바 아이콘 → (팝업이 패널을 열고 닫힘) → YouTube 오른쪽 아래 패널 · 새 탭 없음 · 재생 계속',
    async () => {
      const pagesBefore = await pageTargets()
      const t0 = await video()
      await trigger()
      panel = await attachPanel()
      await sleep(800)
      const host = await yt.ev(
        `(() => { const e = document.getElementById('page39-panel-host'); if (!e) return null; const r = e.getBoundingClientRect(); return { right: Math.round(document.documentElement.clientWidth - r.right), bottom: Math.round(innerHeight - r.bottom), w: Math.round(r.width), h: Math.round(r.height), shadowHidden: e.shadowRoot === null } })()`,
      )
      const title = await panel.ev(
        `document.querySelector('.video-card')?.textContent.replace(/\\s+/g, ' ').trim()`,
      )
      const diag = await panel.ev(
        `chrome.runtime.sendMessage({ v: 1, type: 'panel/sync' }).then((r) => ({ href: location.href.replace(/[a-p]{32}/, '<id>'), sameId: location.host === chrome.runtime.id, sync: r.ok ? 'ok' : r.error, text: document.body.innerText.slice(0, 160) }))`,
      )
      if (process.env.DIAG === '1') {
        const sw = await h.serviceWorker()
        const swSession = await h.cdp.attach(sw.targetId)
        await h.cdp.evaluate(
          swSession,
          `chrome.runtime.onMessage.addListener((m, s) => { if (m?.type === 'panel/sync') globalThis.__lastSender = { url: s.url, origin: s.origin, documentId: s.documentId, frameId: s.frameId, tab: s.tab?.id, id: s.id } }); true`,
        )
        await panel.ev(`chrome.runtime.sendMessage({ v: 1, type: 'panel/sync' }).then(() => true)`)
        const sender = await h.cdp.evaluate(
          swSession,
          `JSON.stringify(globalThis.__lastSender ?? null).replace(/[a-p]{32}/g, '<id>')`,
        )
        console.log('\nDIAG', JSON.stringify(diag), '\nSENDER', sender)
      }
      const t1 = await video()
      const pagesAfter = await pageTargets()
      return {
        pass:
          host !== null &&
          host.right === 16 &&
          host.shadowHidden &&
          title.includes(VIDEO) &&
          t1.t > t0.t &&
          !t1.paused &&
          pagesAfter === pagesBefore &&
          t1.url === YT,
        host,
        title,
        video: [t0, t1],
        pages: [pagesBefore, pagesAfter],
        panelUrl: panel.target.url.replace(/[a-p]{32}/, '<id>'),
      }
    },
  )

  if (process.env.DIAG === '1') throw new Error('diag only')
  await step(
    'P2',
    '권한 — 패널에서 목적 설명 → 실제 프롬프트 거부 → 수집 화면 폴백 (사용자가 고를 때만 새 탭)',
    async () => {
      const gate = await panel.ev(
        `document.querySelector('.access')?.textContent.includes('39page 사이트 접근 권한이 필요합니다') ?? false`,
      )
      const pagesBefore = await pageTargets()
      const asked = panel.ev(
        `(() => { [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '39page 접근 허용').click(); return new Promise((r) => setTimeout(() => r(true), 4000)) })()`,
        { userGesture: true },
      )
      const denied = await h.clickPrompt('Deny|거부')
      await asked
      const stillGate = await panel.ev(`!!document.querySelector('.access')`)
      const pagesAfterDeny = await pageTargets()
      await clickText(panel.ev, '39page 수집 화면으로 열기')
      await sleep(1500)
      const collectTab = (await h.cdp.targets()).find(
        (t) => t.type === 'page' && t.url.includes('#collect?'),
      )
      const notice = await panel.ev(
        `document.querySelector('.foot [role=status]')?.textContent.trim() ?? ''`,
      )
      if (collectTab) await h.cdp.send('Target.closeTarget', { targetId: collectTab.targetId })
      await h.cdp.send('Target.activateTarget', { targetId: yt.targetId })
      return {
        pass:
          gate &&
          denied.startsWith('invoked') &&
          stillGate &&
          pagesAfterDeny === pagesBefore &&
          collectTab !== undefined &&
          collectTab.url.includes(`videoId=${VIDEO}`),
        denied,
        collectUrl: collectTab?.url.replace(/req=[^&]+/, 'req=…'),
        notice,
      }
    },
  )

  await step(
    'P3',
    '권한 허용 → 기존 39page 플레이리스트 목록 → 골라 담기 → 실제 store 에 저장 · 대시보드 선택 · 재생 그대로',
    async () => {
      const asked = panel.ev(
        `(() => { [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '39page 접근 허용').click(); return new Promise((r) => setTimeout(() => r(true), 4000)) })()`,
        { userGesture: true },
      )
      const allowed = await h.clickPrompt('Allow|허용')
      await asked
      await waitFor(() => panel.ev(`document.querySelectorAll('.list-row').length >= 3`), {
        label: 'lists',
      })
      const rows = await panel.ev(
        `[...document.querySelectorAll('.list-row')].map((r) => r.textContent.replace(/\\s+/g, ' ').trim())`,
      )
      await panel.ev(
        `(() => { const i = [...document.querySelectorAll('.list-row')].find((r) => r.textContent.includes('드라이브')).querySelector('input'); i.click(); return true })()`,
      )
      await clickText(panel.ev, '이 플레이리스트에 담기')
      await waitFor(() => panel.ev(`!!document.querySelector('.feedback.ok')`), { label: 'saved' })
      const fb = await feedback(panel.ev)
      await sleep(300)
      const after = await dashStorage()
      const v = await video()
      return {
        pass:
          allowed.startsWith('invoked') &&
          after.lists.includes(`드라이브:${VIDEO}`) &&
          after.selected === before.selected &&
          fb.includes('‘드라이브’ 에 담았어요') &&
          !v.paused,
        rows,
        feedback: fb,
        lists: after.lists,
        video: v,
      }
    },
  )

  await step(
    'P4',
    '새 플레이리스트 즉석 생성 + 담기 → 저장 확인 · 대시보드 선택 목록 · 큐 · iframe 그대로',
    async () => {
      await panel.ev(
        `(() => { [...document.querySelectorAll('.list-row')].find((r) => r.textContent.includes('새 플레이리스트')).querySelector('input').click(); return true })()`,
      )
      await panel.ev(
        `(() => { const i = document.getElementById('panel-new-name'); i.value = '즉석 목록'; i.dispatchEvent(new Event('input', { bubbles: true })); return true })()`,
      )
      await clickText(panel.ev, '만들고 담기')
      await waitFor(
        () =>
          panel.ev(
            `(document.querySelector('.feedback.ok')?.textContent ?? '').includes('즉석 목록')`,
          ),
        { label: 'created' },
      )
      await sleep(500)
      const after = await dashStorage()
      const dashView = await dash.ev(
        `({ tiles: [...document.querySelectorAll('.playlist-tile')].map((t) => t.textContent.replace(/\\s+/g, ' ').trim().slice(0, 30)), iframe: document.querySelectorAll('.player-mount iframe').length === 1 && document.querySelector('.player-mount iframe').dataset.m115 === 'original' })`,
      )
      return {
        pass:
          after.lists.includes(`즉석 목록:${VIDEO}`) &&
          after.selected === 'mine' &&
          dashView.iframe &&
          dashView.tiles.some((t) => t.includes('즉석 목록')),
        lists: after.lists,
        selected: after.selected,
        dashView,
        feedback: await feedback(panel.ev),
      }
    },
  )

  await step('P5', '같은 곡 다시 — 이미 있다고 보이고 "한 번 더" 를 골라야 담긴다', async () => {
    await panel.ev(
      `(() => { [...document.querySelectorAll('.list-row')].find((r) => r.textContent.includes('드라이브')).querySelector('input').click(); return true })()`,
    )
    await sleep(200)
    const dup = await panel.ev(
      `document.querySelector('.dup')?.textContent.replace(/\\s+/g, ' ').trim() ?? ''`,
    )
    const disabled = await clickText(panel.ev, '이 플레이리스트에 담기')
    await panel.ev(`document.querySelector('.dup input').click(); true`)
    await clickText(panel.ev, '이 플레이리스트에 담기')
    await waitFor(
      () =>
        panel.ev(`(document.querySelector('.feedback.ok')?.textContent ?? '').includes('2번째')`),
      { label: 'dup saved' },
    )
    const after = await dashStorage()
    return {
      pass:
        dup.includes('이미 있어요') &&
        disabled === 'disabled' &&
        after.lists.includes(`드라이브:${VIDEO},${VIDEO}`),
      dup,
      firstClick: disabled,
    }
  })

  await step(
    'P6',
    'Moment — 지금 시점 잡기 → 메모 → 저장 (메모 쓰는 동안 재생돼도 시점 고정) → 대시보드 Moments 보관함 → 그 시점부터 재생',
    async () => {
      await clickText(panel.ev, 'Moment 저장').catch(() => null)
      await panel.ev(`document.getElementById('panel-tab-moment').click(); true`)
      await clickText(panel.ev, '지금 시점 잡기')
      await waitFor(() => panel.ev(`!!document.querySelector('.capture-time strong')`), {
        label: 'captured',
      })
      const shown = await panel.ev(`document.querySelector('.capture-time strong').textContent`)
      await panel.ev(
        `(() => { const t = document.getElementById('panel-note'); t.value = '패널에서 저장한 순간'; t.dispatchEvent(new Event('input', { bubbles: true })); return true })()`,
      )
      await sleep(3000) // 재생은 계속된다
      const stillShown = await panel.ev(
        `document.querySelector('.capture-time strong').textContent`,
      )
      await panel.ev(
        `[...document.querySelectorAll('.btn.primary')].find((b) => b.textContent.trim() === 'Moment 저장').click(); true`,
      )
      await waitFor(() => panel.ev(`!!document.querySelector('#panel-body-moment .feedback.ok')`), {
        label: 'moment saved',
      })
      const fb = await panel.ev(
        `document.querySelector('#panel-body-moment .feedback.ok').textContent.trim()`,
      )
      const after = await dashStorage()
      const saved = after.moments.find((m) => m.endsWith(':패널에서 저장한 순간'))
      const at = Number(saved?.split('@')[1]?.split(':')[0])
      // 대시보드 — 사용자처럼 39page 탭으로 가서 Moments 보관함에서 그 순간을 눌러 재생 (뒤쪽 탭은 미디어를 미룬다)
      await h.cdp.send('Target.activateTarget', { targetId: dash.targetId })
      await sleep(500)
      await dash.ev(`(async () => { const nav = [...document.querySelectorAll('.app-nav button')].find((b) => b.textContent.includes('Moments')); nav.click(); await new Promise((r) => setTimeout(r, 600));
      const row = [...document.querySelectorAll('#archive-panel-moments .moment-item')].find((r) => r.textContent.includes('패널에서 저장한 순간')); row.querySelector('[data-moment-play]').click(); return true })()`)
      await sleep(5000)
      // 대시보드 플레이어 — 그 순간의 영상을 띄운 39page 의 YouTube iframe (YouTube 시청 페이지의 것이 아니다).
      const dashYt = await waitFor(
        // 플레이어는 API 로 영상을 바꾼다 — iframe 주소는 처음 영상 그대로다. 39page origin 의 임베드를 찾는다.
        async () =>
          (await h.cdp.targets()).find(
            (t) => t.type === 'iframe' && t.url.includes('/embed/') && t.url.includes('127.0.0.1'),
          ),
        { timeout: 15_000, label: 'dashboard player iframe' },
      ).catch(() => null)
      let played = null
      if (dashYt) {
        const s = await h.cdp.attach(dashYt.targetId)
        played = await h.cdp.evaluate(
          s,
          `(() => { const v = document.querySelector('video'); const p = document.getElementById('movie_player'); return v ? { t: Math.round(v.currentTime), paused: v.paused, id: p?.getVideoData?.().video_id ?? null } : null })()`,
        )
      }
      await h.cdp.send('Target.activateTarget', { targetId: yt.targetId })
      return {
        pass:
          saved !== undefined &&
          shown === stillShown &&
          fb.includes('메모와 함께') &&
          played !== null &&
          played.id === VIDEO &&
          played.t >= at &&
          played.t <= at + 15,
        shown,
        stillShown,
        saved,
        feedback: fb,
        dashboardPlayedFrom: played,
      }
    },
  )

  await step(
    'P7',
    'YouTube SPA 이동 — 패널이 알리고 카드는 그대로, 바꾸기를 누르면 새 영상 · 잘못된 영상에 저장하지 않음',
    async () => {
      const otherId = await yt.ev(
        `(() => { const a = [...document.querySelectorAll('a[href*="/watch?v="]')].map((x) => new URL(x.href).searchParams.get('v')).find((v) => v && v !== '${VIDEO}'); return a ?? null })()`,
      )
      if (otherId === null) return { pass: false, reason: '이동할 다른 영상 링크를 찾지 못했다' }
      // 실제 클릭 — YouTube 의 SPA 이동(전체 새로고침 아님)
      await yt.ev(
        `(() => { const a = [...document.querySelectorAll('a[href*="/watch?v="]')].find((x) => new URL(x.href).searchParams.get('v') === ${JSON.stringify(otherId)}); a.click(); return true })()`,
      )
      await waitFor(() => yt.ev(`location.href.includes(${JSON.stringify(otherId)})`), {
        timeout: 15_000,
        label: 'spa navigation',
      })
      await waitFor(() => panel.ev(`!!document.querySelector('.banner')`), {
        timeout: 10_000,
        label: 'banner',
      })
      const cardBefore = await panel.ev(`document.querySelector('.video-card').textContent`)
      await clickText(panel.ev, '새 영상으로 바꾸기')
      await sleep(300)
      const cardAfter = await panel.ev(`document.querySelector('.video-card').textContent`)
      const sameFrame = (await panelTarget()).targetId === panel.target.targetId
      return {
        pass: cardBefore.includes(VIDEO) && cardAfter.includes(otherId) && sameFrame,
        otherId,
        sameFrame,
      }
    },
  )

  await step(
    'P8',
    '닫기(Esc) → 패널만 사라지고 재생 계속 · 열고 닫기 10번 → iframe 누적 없음',
    async () => {
      await panel.ev(
        `document.querySelector('.panel').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); true`,
      )
      await sleep(800)
      const goneAfterEsc = await yt.ev(`document.getElementById('page39-panel-host') === null`)
      const v1 = await video()
      for (let i = 0; i < 10; i += 1) {
        await trigger()
        await panelTarget()
        const p = await attachPanel()
        await p.ev(`document.querySelector('.close').click(); true`)
        await waitFor(() => yt.ev(`document.getElementById('page39-panel-host') === null`), {
          label: 'closed',
        })
      }
      await sleep(500)
      const hosts = await yt.ev(`document.querySelectorAll('#page39-panel-host').length`)
      const frames = (await h.cdp.targets()).filter(
        (t) => t.type === 'iframe' && t.url.includes('/src/panel/index.html'),
      ).length
      const v2 = await video()
      return {
        pass: goneAfterEsc && hosts === 0 && frames === 0 && !v2.paused && v2.t > v1.t,
        goneAfterEsc,
        hosts,
        frames,
        video: [v1, v2],
      }
    },
  )

  await step('P9', '좁은 창(400px) — 패널이 화면 안에 들어온다', async () => {
    await h.cdp.send(
      'Emulation.setDeviceMetricsOverride',
      { width: 400, height: 700, deviceScaleFactor: 1, mobile: false },
      yt.session,
    )
    await trigger()
    await attachPanel()
    await sleep(500)
    const box = await yt.ev(
      `(() => { const r = document.getElementById('page39-panel-host').getBoundingClientRect(); return { left: Math.round(r.left), right: Math.round(r.right), top: Math.round(r.top), bottom: Math.round(r.bottom), vw: document.documentElement.clientWidth, vh: innerHeight } })()`,
    )
    await h.cdp.send('Emulation.clearDeviceMetricsOverride', {}, yt.session)
    return {
      pass: box.left >= 0 && box.right <= box.vw && box.top >= 0 && box.bottom <= box.vh,
      box,
    }
  })

  await step(
    'P11',
    '단축키 Alt+Shift+M — CDP 키 입력으로 브라우저 단축키가 실행되는지 (자동화 가능 여부 기록)',
    async () => {
      // 앞 단계(P9)가 연 패널을 먼저 닫는다 — 키 입력이 새로 연 것인지 보려고.
      const isOpen = async () =>
        (await h.cdp.targets()).some(
          (t) => t.type === 'iframe' && t.url.includes('/src/panel/index.html'),
        )
      if (await isOpen()) {
        const p = await attachPanel()
        await p.ev(`document.querySelector('.close').click(); true`)
        await waitFor(() => yt.ev(`document.getElementById('page39-panel-host') === null`), {
          label: 'closed before key',
        })
      }
      const closedBefore = !(await isOpen())
      await h.cdp.send('Target.activateTarget', { targetId: yt.targetId })
      for (const type of ['rawKeyDown', 'keyUp']) {
        await h.cdp.send(
          'Input.dispatchKeyEvent',
          { type, modifiers: 1 | 8, key: 'M', code: 'KeyM', windowsVirtualKeyCode: 77 },
          yt.session,
        )
      }
      await sleep(2500)
      const opened = await isOpen()
      let momentTab = false
      if (opened) {
        const p = await attachPanel()
        momentTab = await waitFor(
          () =>
            p.ev(
              `document.getElementById('panel-tab-moment')?.getAttribute('aria-selected') === 'true'`,
            ),
          { timeout: 5_000, label: 'moment tab' },
        ).catch(() => false)
      }
      // CDP 키 입력은 페이지로 가고 브라우저 단축키(명령)로는 가지 않을 수 있다 — 결과를 그대로 적는다.
      return {
        pass: true,
        closedBefore,
        momentTabSelected: momentTab,
        panelOpenedByKey: opened,
        note: opened
          ? 'CDP 키 입력으로 명령이 실행됐다'
          : 'CDP 키 입력은 브라우저 단축키를 실행하지 않았다 — 실제 키보드 확인은 M11-6 (사람)',
      }
    },
  )

  await step(
    'P12',
    '오래 쓰기 — 20번 (열기 → 시점 잡기 → 메모 → 저장 → 닫기): 저장 정확히 20건 · iframe · offscreen 누적 없음 · 워커 메모리',
    async () => {
      const sw = await h.serviceWorker()
      const swSession = await h.cdp.attach(sw.targetId)
      await h.cdp.send('Runtime.enable', {}, swSession)
      const heap = async () =>
        Math.round((await h.cdp.send('Runtime.getHeapUsage', {}, swSession)).usedSize / 1024)
      const heapBefore = await heap()
      const stamp = Date.now()
      const outcomes = []
      for (let i = 0; i < 20; i += 1) {
        await trigger()
        const p = await attachPanel()
        await p.ev(`document.getElementById('panel-tab-moment').click(); true`)
        await waitFor(
          () =>
            p.ev(`!!document.querySelector('.list-row') || !!document.querySelector('.access')`),
          { label: 'panel ready' },
        )
        await p.ev(
          `(() => { const b = [...document.querySelectorAll('#panel-body-moment button')].find((x) => x.textContent.includes('시점') && x.textContent.includes('잡기')); b.click(); return true })()`,
        )
        await waitFor(() => p.ev(`!!document.querySelector('.capture-time strong')`), {
          label: 'captured',
        })
        const note = `soak-${stamp}-${i}`
        await p.ev(
          `(() => { const t = document.getElementById('panel-note'); t.value = ${JSON.stringify(note)}; t.dispatchEvent(new Event('input', { bubbles: true })); return true })()`,
        )
        await p.ev(
          `[...document.querySelectorAll('.btn.primary')].find((b) => b.textContent.trim() === 'Moment 저장').click(); true`,
        )
        const r = await waitFor(
          () =>
            p.ev(
              `(() => { const f = document.querySelector('#panel-body-moment .feedback'); return f && !f.textContent.includes('저장하는 중') ? f.className + '|' + f.textContent.trim().slice(0, 40) : null })()`,
            ),
          { timeout: 20_000, label: 'saved' },
        )
        outcomes.push(r.startsWith('feedback ok') ? 'ok' : r)
        await p.ev(`document.querySelector('.close').click(); true`)
        await waitFor(() => yt.ev(`document.getElementById('page39-panel-host') === null`), {
          label: 'closed',
        })
      }
      await sleep(800)
      const saved = await dash.ev(
        `JSON.parse(localStorage.getItem('39page.moments')).data.filter((m) => m.note.startsWith(${JSON.stringify(`soak-${stamp}-`)})).length`,
      )
      const offscreen = await h.cdp.evaluate(
        swSession,
        `chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] }).then((c) => c.length)`,
      )
      const frames = (await h.cdp.targets()).filter(
        (t) => t.type === 'iframe' && t.url.includes('/src/panel/index.html'),
      ).length
      const hosts = await yt.ev(`document.querySelectorAll('#page39-panel-host').length`)
      await h.cdp.send('HeapProfiler.collectGarbage', {}, swSession).catch(() => null)
      const heapAfter = await heap()
      const v = await video()
      return {
        pass:
          outcomes.every((o) => o === 'ok') &&
          saved === 20 &&
          offscreen <= 1 &&
          frames === 0 &&
          hosts === 0 &&
          !v.paused,
        outcomes: outcomes.filter((o) => o !== 'ok'),
        saved,
        offscreen,
        frames,
        hosts,
        workerHeapKB: [heapBefore, heapAfter],
        video: v,
      }
    },
  )

  await step('P10', '대시보드 — 선택 목록 · 재생 중인 곡 · iframe 그대로', async () => {
    const after = await dashStorage()
    const iframe = await dash.ev(
      `document.querySelectorAll('.player-mount iframe').length === 1 && document.querySelector('.player-mount iframe').dataset.m115 === 'original'`,
    )
    return { pass: after.selected === 'mine' && iframe, selected: after.selected, iframe }
  })

  mkdirSync(OUT, { recursive: true })
  const file = path.join(OUT, `panel-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
  writeFileSync(file, JSON.stringify({ browser: h.cdp.version, results }, null, 2))
  console.log(`\n${results.filter((r) => r.pass).length}/${results.length} PASS → ${file}`)
  h.cdp.close()
} catch (error) {
  console.error('harness failed:', error)
  process.exitCode = 1
} finally {
  h.kill()
}
