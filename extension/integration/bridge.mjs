/**
 * M11-5A — 저장 브리지 실제 Chrome 통합 검증.
 *
 * 준비 (로컬 빌드만):
 *   VITE_BRIDGE_EXTENSION_IDS=pkagnijdhfmkodpdfgdehfdghcgbfpoa VITE_BRIDGE_DEV_BUILD=1 npx vite build --outDir <WEB_DIST>
 *   (extension) VITE_COLLECT_ORIGIN=http://127.0.0.1:4173 npm run build:dev      # dist-dev, 고정 ID
 * 실행:
 *   POC_CHROME=<Chrome for Testing chrome.exe> WEB_DIST=<…> EXT_DIST=<…/extension/dist-dev> OUT=<…> node extension/integration/bridge.mjs
 *
 * 확장 페이지(팝업 페이지를 탭으로 연 것)에서 서비스 워커에 `bridge/*` 를 보낸다 — 패널과 같은 길이다.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import {
  BASE,
  DEV_EXTENSION_ID,
  ORIGIN_PATTERN,
  launch,
  recorder,
  sleep,
  waitFor,
} from './harness.mjs'

const { POC_CHROME, WEB_DIST, EXT_DIST, OUT } = process.env
const REAL_VIDEO = 'M7lc1UVf-VE'
const A = 'aaaaaaaaaaa'
const B = 'bbbbbbbbbbb'

const h = await launch({
  chrome: POC_CHROME,
  webDist: WEB_DIST,
  extDist: EXT_DIST,
  loadViaFlag: process.env.LOAD_VIA_FLAG === '1',
})
const { results, step } = recorder()

const LIBRARY = {
  version: 1,
  data: {
    playlists: [
      {
        id: 'mine',
        name: 'MINE',
        tracks: [
          { id: 't1', source: 'youtube', videoId: REAL_VIDEO, title: 'YouTube Developers Live' },
        ],
      },
      { id: 'drive', name: '드라이브', tracks: [] },
    ],
    selectedPlaylistId: 'mine',
  },
}

try {
  // 대시보드 탭 — 시험 데이터 · 재생 시작(큐 · 지금 곡 · 선택 목록이 바뀌지 않는지 보려고)
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
    label: 'player',
  })
  await dash.ev(`document.querySelector('.player-mount iframe').dataset.m115 = 'original'; true`)
  await sleep(3000)
  const dashState = () =>
    dash.ev(`(() => { const lib = JSON.parse(localStorage.getItem('39page.library')); const m = JSON.parse(localStorage.getItem('39page.moments') ?? '{"data":[]}'); return {
      selected: lib.data.selectedPlaylistId, lists: lib.data.playlists.map((p) => p.name + ':' + p.tracks.length), moments: m.data.length,
      nowPlaying: document.querySelector('.now-title, .now-playing-title, h2')?.textContent?.trim() ?? null,
      iframe: document.querySelectorAll('.player-mount iframe').length === 1 && document.querySelector('.player-mount iframe').dataset.m115 === 'original',
      tiles: [...document.querySelectorAll('.playlist-tile .pname, .playlist-tile')].length } })()`)
  const before = await dashState()

  // 확장 페이지 — 서비스 워커에 보낸다 (패널과 같은 길)
  const page = await h.tab(`chrome-extension://${DEV_EXTENSION_ID}/src/popup/index.html`)
  await page.ev(`window.__b = {
    state: () => chrome.runtime.sendMessage({ v: 1, type: 'bridge/state' }).then((r) => r.data),
    call: (payload, requestId = crypto.randomUUID()) => chrome.runtime.sendMessage({ v: 1, type: 'bridge/call', requestId, payload })
      .then((r) => ({ requestId, ...(r.ok ? r.data : { routerError: r.error.code }) }), (e) => ({ requestId, sendError: String(e.message) })),
    contexts: () => chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] }).then((c) => c.map((x) => x.documentUrl.replace(/^chrome-extension:\\/\\/[a-p]+/, ''))),
    contains: () => chrome.permissions.contains({ origins: ['${ORIGIN_PATTERN}'] }),
  }; true`)
  const call = (payload, requestId) =>
    page.ev(
      `__b.call(${JSON.stringify(payload)}${requestId ? `, ${JSON.stringify(requestId)}` : ''})`,
    )
  /** 권한 요청 — 프롬프트가 뜨면 그 단추를 누른다. 뜨지 않으면(재요청) 기다림만 끝난다. */
  const request = async (button = 'Allow|허용') => {
    await h.cdp.send('Target.activateTarget', { targetId: page.targetId })
    const asked = page.ev(`chrome.permissions.request({ origins: ['${ORIGIN_PATTERN}'] })`, {
      userGesture: true,
      timeout: 25_000,
    })
    const clicked = await h.clickPrompt(button, 6_000)
    return { prompt: clicked.startsWith('invoked') ? clicked : 'no-prompt', granted: await asked }
  }

  await step('B1', '권한 없음 — 상태 · 쓰기 거절 · offscreen 을 만들지 않는다', async () => {
    const state = await page.ev(`__b.state()`)
    const r = await call({
      op: 'moment/add',
      videoId: A,
      atSeconds: 1,
      note: '권한 없음',
      title: null,
    })
    const contexts = await page.ev(`__b.contexts()`)
    return {
      pass:
        state.permission === 'not-granted' &&
        r.outcome === 'unavailable' &&
        r.reason === 'permission' &&
        contexts.length === 0,
      state,
      r,
      contexts,
    }
  })

  await step('B2', '실제 권한 프롬프트 — 거부하면 그대로, 허용하면 granted', async () => {
    const denied = await request('Deny|거부')
    const afterDeny = await page.ev(`__b.state()`)
    const allowed = await request('Allow|허용')
    const afterAllow = await page.ev(`__b.state()`)
    return {
      pass:
        denied.granted === false &&
        afterDeny.permission === 'not-granted' &&
        allowed.granted === true &&
        afterAllow.permission === 'granted',
      denied,
      allowed,
    }
  })

  await step(
    'B3',
    '부여 직후 — 목록이 대시보드 저장소와 같다 (분할되지 않음) · offscreen 하나',
    async () => {
      const r = await call({ op: 'library/list', videoId: REAL_VIDEO })
      const contexts = await page.ev(`__b.contexts()`)
      const names = r.data?.playlists?.map((p) => p.name)
      return {
        pass:
          r.outcome === 'ok' &&
          JSON.stringify(names) === JSON.stringify(['MINE', '드라이브']) &&
          r.data.playlists[0].positions[0] === 1 &&
          contexts.length === 1,
        names,
        contexts,
      }
    },
  )

  await step(
    'B4',
    '담기 · 새 목록 + 담기 · Moment — 확인된 저장, 대시보드 선택 · 큐 · iframe 그대로',
    async () => {
      const add = await call({
        op: 'track/add',
        playlistId: 'drive',
        videoId: B,
        title: 'Bravo',
        allowDuplicate: false,
      })
      const created = await call({
        op: 'playlist/create-and-add',
        name: '즉석 목록',
        videoId: A,
        title: 'Alpha',
      })
      const moment = await call({
        op: 'moment/add',
        videoId: REAL_VIDEO,
        atSeconds: 43,
        note: '확장에서 저장',
        title: null,
      })
      await sleep(600)
      const after = await dashState()
      const reflected = await dash.ev(
        `[...document.querySelectorAll('.playlist-tile')].some((t) => t.textContent.includes('즉석 목록'))`,
      )
      return {
        pass:
          add.outcome === 'ok' &&
          created.outcome === 'ok' &&
          moment.outcome === 'ok' &&
          after.selected === before.selected &&
          after.nowPlaying === before.nowPlaying &&
          after.iframe &&
          after.lists.includes('즉석 목록:1') &&
          after.lists.includes('드라이브:1') &&
          after.moments === 1 &&
          reflected,
        add: add.data,
        created: created.data,
        moment: moment.data,
        before,
        after,
        dashboardSawNewList: reflected,
      }
    },
  )

  await step('B5', '같은 요청 ID 를 다시 보내면 — 저장하지 않고 existed', async () => {
    const id = crypto.randomUUID()
    const payload = {
      op: 'moment/add',
      videoId: REAL_VIDEO,
      atSeconds: 90,
      note: '한 번만',
      title: null,
    }
    const first = await call(payload, id)
    const second = await call(payload, id)
    const count = await dash.ev(
      `JSON.parse(localStorage.getItem('39page.moments')).data.filter((m) => m.note === '한 번만').length`,
    )
    // 두 번째 답은 메모리 기록의 첫 답(existed: false) 이거나 store 의 "이미 있음"(existed: true) — 어느 쪽이든 1건.
    return {
      pass:
        first.outcome === 'ok' &&
        second.outcome === 'ok' &&
        second.data.momentId === first.data.momentId &&
        count === 1,
      first: first.data,
      second: second.data,
      count,
    }
  })

  await step('B6', '같은 영상이 이미 있으면 묻는다 — allowDuplicate 일 때만 한 번 더', async () => {
    const refused = await call({
      op: 'track/add',
      playlistId: 'mine',
      videoId: REAL_VIDEO,
      title: null,
      allowDuplicate: false,
    })
    const again = await call({
      op: 'track/add',
      playlistId: 'mine',
      videoId: REAL_VIDEO,
      title: null,
      allowDuplicate: true,
    })
    return {
      pass:
        refused.outcome === 'error' &&
        refused.error.code === 'already-in-playlist' &&
        again.outcome === 'ok' &&
        again.data.position === 2,
      refused: refused.error,
      again: again.data,
    }
  })

  /** 잠금을 쥔 채 쓰기를 보내고, 처리 중에 `kill` 한다 → 결과 · 확인 · 같은 ID 재시도 · 저장 수. */
  async function lostResponse(note, kill) {
    const id = crypto.randomUUID()
    const payload = { op: 'moment/add', videoId: REAL_VIDEO, atSeconds: 120, note, title: null }
    // 대시보드 탭이 Moments 잠금을 1.5초 쥔다 — 브리지의 쓰기가 그동안 기다린다 (ADR 0025 잠금).
    await dash.ev(
      `void navigator.locks.request('39page.moments:write', () => new Promise((r) => setTimeout(r, 1500))); true`,
    )
    await sleep(50)
    const pending = call(payload, id)
    await sleep(300)
    const killed = await kill()
    const first = await pending
    await sleep(2000)
    const status = await call({
      op: 'request/status',
      kind: 'moment',
      target: id,
      playlistId: null,
    })
    const retry = await call(payload, id)
    await sleep(300)
    const count = await dash.ev(
      `JSON.parse(localStorage.getItem('39page.moments')).data.filter((m) => m.note === ${JSON.stringify(note)}).length`,
    )
    return {
      killed,
      first,
      status: status.data,
      retry: retry.outcome === 'ok' ? retry.data : retry,
      count,
    }
  }

  await step(
    'B7a',
    '응답 유실 — 처리 중 서비스 워커 강제 종료(Target.closeTarget) → 확인 · 같은 ID 재시도 → 1건',
    async () => {
      const r = await lostResponse('워커 종료', async () => {
        const sw = await h.serviceWorker()
        await h.cdp.send('Target.closeTarget', { targetId: sw.targetId }).catch((e) => e.message)
        return 'Target.closeTarget(service_worker)'
      })
      return { pass: r.count === 1 && r.retry.momentId !== undefined, ...r }
    },
  )

  await step(
    'B7b',
    '응답 유실 — 처리 중 offscreen 문서 종료 → uncertain → 확인 · 같은 ID 재시도 → 1건',
    async () => {
      const r = await lostResponse('문서 종료', async () => {
        const target = (await h.cdp.targets()).find((t) =>
          t.url.includes('/src/offscreen/index.html'),
        )
        if (target)
          await h.cdp
            .send('Target.closeTarget', { targetId: target.targetId })
            .catch((e) => e.message)
        return target ? `Target.closeTarget(${target.type})` : 'no offscreen target'
      })
      return {
        pass: r.first.outcome === 'uncertain' && r.count === 1 && r.retry.momentId !== undefined,
        ...r,
      }
    },
  )

  await step(
    'B8',
    '철회(API) — onRemoved 가 offscreen 을 닫고, 쓰기는 거절 · 저장소 그대로',
    async () => {
      const raw = await dash.ev(`localStorage.getItem('39page.moments')`)
      const removed = await page.ev(
        `chrome.permissions.remove({ origins: ['${ORIGIN_PATTERN}'] })`,
        { userGesture: true },
      )
      const closed = await waitFor(async () => (await page.ev(`__b.contexts()`)).length === 0, {
        timeout: 5_000,
        label: 'offscreen closed',
      }).catch(() => false)
      const r = await call({
        op: 'moment/add',
        videoId: A,
        atSeconds: 2,
        note: '철회 뒤',
        title: null,
      })
      const same = (await dash.ev(`localStorage.getItem('39page.moments')`)) === raw
      return {
        pass:
          removed === true &&
          closed === true &&
          r.outcome === 'unavailable' &&
          r.reason === 'permission' &&
          same,
        r,
        closed,
        unchanged: same,
      }
    },
  )

  await step('B9', '다시 허용 — 프롬프트 없이 부여되고 새 브리지로 저장', async () => {
    const regrant = await request()
    const r = await call({
      op: 'moment/add',
      videoId: REAL_VIDEO,
      atSeconds: 150,
      note: '다시 허용',
      title: null,
    })
    const contexts = await page.ev(`__b.contexts()`)
    return {
      pass: regrant.granted === true && r.outcome === 'ok' && contexts.length === 1,
      regrant,
      r: r.data,
      contexts,
    }
  })

  await step(
    'B10',
    '서비스 워커가 멈춘 동안 사이트 액세스에서 철회 — 깨어나 닫는가 · 다음 쓰기 거절',
    async () => {
      await call({ op: 'hello' }) // offscreen 준비
      const contextsBefore = await page.ev(`__b.contexts()`)
      await h.stopWorker(page.session)
      const ext = await h.tab(`chrome://extensions/?id=${DEV_EXTENSION_ID}`)
      await sleep(1200)
      const removed = await ext.ev(
        `chrome.developerPrivate.removeHostPermission('${DEV_EXTENSION_ID}', '${ORIGIN_PATTERN}').then(() => 'ok', (e) => 'rejected: ' + e.message)`,
      )
      await sleep(1500)
      const wokeUp = await h.workerRunning()
      const contextsAfter = await page.ev(`__b.contexts()`)
      const r = await call({
        op: 'moment/add',
        videoId: A,
        atSeconds: 3,
        note: '워커 멈춘 동안 철회',
        title: null,
      })
      const contextsAfterCall = await page.ev(`__b.contexts()`)
      await h.cdp.send('Target.closeTarget', { targetId: ext.targetId })
      const stored = await dash.ev(
        `JSON.parse(localStorage.getItem('39page.moments')).data.filter((m) => m.note === '워커 멈춘 동안 철회').length`,
      )
      return {
        pass:
          removed === 'ok' &&
          r.outcome === 'unavailable' &&
          r.reason === 'permission' &&
          stored === 0 &&
          contextsAfterCall.length === 0,
        removed,
        contextsBefore,
        workerWokeOnRemoved: wokeUp,
        offscreenAfterRevoke: contextsAfter,
        r,
        offscreenAfterNextCall: contextsAfterCall,
      }
    },
  )

  await step(
    'B11',
    '다른 39page 탭과 같은 순간 저장 — 대시보드가 목록을 만들 때 브리지가 담기, 조용한 손실 0',
    async () => {
      const regrant = await request()
      const rounds = 15
      const stamp = Date.now()
      const outcomes = []
      for (let i = 0; i < rounds; i += 1) {
        const [bridge] = await Promise.all([
          call({
            op: 'track/add',
            playlistId: 'drive',
            videoId: B,
            title: `race-${stamp}-${i}`,
            allowDuplicate: true,
          }),
          dash.ev(`(async () => {
          const nav = [...document.querySelectorAll('.app-nav button')][0]
          if (document.getElementById('archive-panel').hidden) nav.click()
          await new Promise((r) => setTimeout(r, 50))
          if (!document.getElementById('archive-new-playlist-name')) {
            [...document.querySelectorAll('#archive-panel-music .pill')].find((b) => b.textContent.includes('새 목록')).click()
            await new Promise((r) => setTimeout(r, 30))
          }
          const input = document.getElementById('archive-new-playlist-name')
          input.value = 'dash-${stamp}-${i}'; input.dispatchEvent(new Event('input', { bubbles: true }))
          input.form.requestSubmit(); return true })()`),
        ])
        outcomes.push(
          bridge.outcome === 'ok' ? 'ok' : (bridge.error?.code ?? bridge.reason ?? bridge.outcome),
        )
      }
      await sleep(800)
      const saved =
        await dash.ev(`(() => { const lib = JSON.parse(localStorage.getItem('39page.library')).data; return {
      bridge: lib.playlists.find((p) => p.id === 'drive').tracks.filter((t) => t.title.startsWith('race-${stamp}')).length,
      dash: lib.playlists.filter((p) => p.name.startsWith('dash-${stamp}')).length } })()`)
      const okCount = outcomes.filter((o) => o === 'ok').length
      // 대시보드의 "＋ 새 목록" 은 만든 목록을 고른다(웹앱 동작). 브리지는 선택을 바꾸지 않는다 — 마지막 선택은 대시보드의 마지막 목록.
      const selectedName = await dash.ev(
        `(() => { const d = JSON.parse(localStorage.getItem('39page.library')).data; return d.playlists.find((p) => p.id === d.selectedPlaylistId)?.name })()`,
      )
      return {
        pass:
          regrant.granted &&
          saved.bridge === okCount &&
          saved.dash === rounds &&
          selectedName === `dash-${stamp}-${rounds - 1}` &&
          outcomes.every((o) => ['ok', 'conflict', 'busy'].includes(o)) &&
          okCount >= rounds - 2,
        regrant,
        rounds,
        okCount,
        saved,
        selectedName,
        nonOk: outcomes.filter((o) => o !== 'ok'),
      }
    },
  )

  await step('B12', '보호 상태 — 손상된 Moments 에는 쓰지 않고 원본 그대로', async () => {
    const original = await dash.ev(`localStorage.getItem('39page.moments')`)
    await dash.ev(`localStorage.setItem('39page.moments', '{broken'); true`)
    const r = await call({ op: 'moment/add', videoId: A, atSeconds: 4, note: '보호', title: null })
    const raw = await dash.ev(`localStorage.getItem('39page.moments')`)
    await dash.ev(`localStorage.setItem('39page.moments', ${JSON.stringify(original)}); true`)
    return {
      pass: r.outcome === 'error' && r.error.code === 'blocked' && raw === '{broken',
      r: r.error,
    }
  })

  await step(
    'B13',
    '쓰기와 철회가 겹침 — 성공이라 했으면 저장돼 있고, 모르면 uncertain · 재허용 뒤 확인하면 일치',
    async () => {
      const id = crypto.randomUUID()
      const payload = {
        op: 'moment/add',
        videoId: REAL_VIDEO,
        atSeconds: 200,
        note: '철회 경합',
        title: null,
      }
      const pending = call(payload, id)
      await page.ev(`chrome.permissions.remove({ origins: ['${ORIGIN_PATTERN}'] })`, {
        userGesture: true,
      })
      const first = await pending
      const regrant = await request()
      const status = await call({
        op: 'request/status',
        kind: 'moment',
        target: id,
        playlistId: null,
      })
      const count = await dash.ev(
        `JSON.parse(localStorage.getItem('39page.moments')).data.filter((m) => m.note === '철회 경합').length`,
      )
      const consistent =
        (first.outcome === 'ok' && count === 1 && status.data.state === 'saved') ||
        (first.outcome !== 'ok' &&
          ((status.data.state === 'saved' && count === 1) ||
            (status.data.state === 'not-found' && count === 0)))
      return {
        pass: regrant.granted && consistent && count <= 1,
        first,
        regrant,
        status: status.data,
        count,
      }
    },
  )

  await step(
    'B14',
    '대시보드 — 재생 중인 곡 · 플레이어 iframe 이 처음 그대로 (선택 목록은 B4 · B11 에서 확인)',
    async () => {
      const after = await dashState()
      return {
        pass: after.iframe && after.nowPlaying === before.nowPlaying,
        nowPlaying: after.nowPlaying,
        iframe: after.iframe,
      }
    },
  )

  mkdirSync(OUT, { recursive: true })
  const file = path.join(OUT, `bridge-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
  writeFileSync(file, JSON.stringify({ browser: h.cdp.version, results }, null, 2))
  console.log(`\n${results.filter((r) => r.pass).length}/${results.length} PASS → ${file}`)
  h.cdp.close()
} catch (error) {
  console.error('harness failed:', error)
  process.exitCode = 1
} finally {
  h.kill()
}
