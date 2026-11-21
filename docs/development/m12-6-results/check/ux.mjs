// Local production build only; each launch creates an isolated temporary Chrome profile.
// POC_CHROME=<chrome.exe> node docs/development/m12-6-results/check/ux.mjs
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { launch, BASE, sleep, waitFor } from '../../../../extension/integration/harness.mjs'

const OUT = path.resolve('docs/development/m12-6-results')
const IMG = path.join(tmpdir(), '39page-m126-images')
mkdirSync(OUT, { recursive: true })
const results = []
function record(name, pass, details = {}) {
  results.push({ name, pass: Boolean(pass), details })
  console.log(pass ? 'PASS' : 'FAIL', name, JSON.stringify(details).slice(0, 400))
}
const crop = { fit: 'contain', positionX: 25, positionY: 75, zoom: 1.5 }
const seed = {
  version: 1,
  data: {
    playlists: [
      {
        id: 'a',
        name: '긴 한글 日本語 English 재생 목록',
        tracks: [
          { id: 'a1', source: 'youtube', videoId: 'aqz-KE-bpKQ', title: 'Bunny A' },
          { id: 'a2', source: 'youtube', videoId: 'eRsGyueVLvQ', title: 'Sintel' },
        ],
      },
      {
        id: 'b',
        name: '다른 목록',
        tracks: [{ id: 'b1', source: 'youtube', videoId: 'aqz-KE-bpKQ', title: 'Bunny B' }],
      },
    ],
    selectedPlaylistId: 'a',
  },
}

async function session(run) {
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
    await send('DOM.enable')
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
    const click = async (selector) => {
      const point = await ev(
        `(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) throw Error('no element ' + ${JSON.stringify(selector)}); e.scrollIntoView({block:'nearest'}); const r=e.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2} })()`,
      )
      for (const type of ['mousePressed', 'mouseReleased'])
        await send('Input.dispatchMouseEvent', { type, ...point, button: 'left', clickCount: 1 })
      await sleep(180)
    }
    const text = async (selector, label) => {
      await ev(
        `(() => { const e=[...document.querySelectorAll(${JSON.stringify(selector)})].find(x=>x.textContent.trim()===${JSON.stringify(label)}); if(!e) throw Error('no text '+${JSON.stringify(label)}); e.dataset.hit='yes'; return true })()`,
      )
      await click('[data-hit="yes"]')
      await ev(`document.querySelector('[data-hit="yes"]')?.removeAttribute('data-hit'); true`)
    }
    const value = async (selector, value, event = 'input') =>
      ev(
        `(() => { const e=document.querySelector(${JSON.stringify(selector)}); e.value=${JSON.stringify(value)}; e.dispatchEvent(new Event(${JSON.stringify(event)},{bubbles:true})); return true })()`,
      )
    const file = async (selector, filename) => {
      const { root } = await send('DOM.getDocument', { depth: -1 })
      const { nodeId } = await send('DOM.querySelector', { nodeId: root.nodeId, selector })
      await send('DOM.setFileInputFiles', { nodeId, files: [filename] })
      await sleep(250)
    }
    const reload = async () => {
      await ev(`window.__oldDocument=true; true`)
      await send('Page.reload')
      await waitFor(
        () => ev(`!window.__oldDocument && !!document.querySelector('.now-playlist')`),
        { label: 'reload' },
      )
    }
    const db = () =>
      ev(
        `new Promise((resolve,reject)=>{const q=indexedDB.open('39page-artwork',1); q.onerror=()=>reject(q.error); q.onsuccess=()=>{ const t=q.result.transaction(['assets','assignments','blobs']); const a=t.objectStore('assets').getAll(),s=t.objectStore('assignments').getAll(),b=t.objectStore('blobs').getAll(); t.oncomplete=async()=>{ const hashes=await Promise.all(b.result.map(async x=>[x.id,Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await x.blob.arrayBuffer()))).map(v=>v.toString(16).padStart(2,'0')).join('')])); q.result.close(); resolve({assets:a.result,links:s.result,hashes}) } }})`,
      )
    const download = async (action, artifactName) => {
      await ev(
        `(() => { window.__download=null; if(!window.__captureDownload){window.__captureDownload=true; const original=HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click=function(){if(!this.download)return original.call(this); const name=this.download; fetch(this.href).then(r=>r.arrayBuffer()).then(b=>{let s='';for(const v of new Uint8Array(b))s+=String.fromCharCode(v);window.__download={name,b64:btoa(s)}})}} return true })()`,
      )
      await action()
      await waitFor(() => ev(`!!window.__download`), { label: 'download' })
      const data = await ev(`window.__download`)
      const name = path.join(
        OUT,
        artifactName ?? (data.name.endsWith('39page-share.zip') ? 'share.zip' : 'full.zip'),
      )
      writeFileSync(name, Buffer.from(data.b64, 'base64'))
      return name
    }
    await run({ h, p, ev, send, click, text, value, file, reload, db, download, size })
  } finally {
    h.cdp.close()
    h.kill()
    await sleep(1500)
  }
}

try {
  await session(async (t) => {
    const version = await t.h.cdp.send('Browser.getVersion')
    record(
      'Chrome production build in isolated profile',
      await t.ev(`document.documentElement.dataset.theme==='kawaii-synth-cassette'`),
      version,
    )
    await t.ev(
      `localStorage.setItem('39page.library',${JSON.stringify(JSON.stringify(seed))}); true`,
    )
    await t.reload()
    await t.click('.now-playlist .track-row')
    await waitFor(() => t.ev(`!!document.querySelector('.player-mount iframe')`), {
      timeout: 25000,
      label: 'YouTube iframe',
    })
    await t.ev(`window.__iframe=document.querySelector('.player-mount iframe'); true`)
    await sleep(5000)
    const playing = await t.ev(`document.querySelector('.now-playing-card .now-sub').textContent`)
    record('Actual YouTube playback', playing.includes('재생 중'), { subtitle: playing })
    await t.click('.np-art-edit')
    await t.click('input[value="default"]')
    record(
      'Radio preview before save',
      await t.ev(
        `document.querySelector('.preview--draft [data-artwork-source]').dataset.artworkSource==='default' && document.querySelector('.now-playing-card [data-artwork-source]').dataset.artworkSource!=='default'`,
      ),
    )
    await t.click('.strip-close')
    await t.click('.deck-open--kawaii-synth-cassette')
    // ADR 0044 — 데크가 "보관함에서 편집" 을 대신해 고른 목록의 곡(상세 단계)으로 연다. 중첩 편집(앨범아트)은 닫힌다.
    record(
      'Deck entry closes nested editor and opens selected list detail',
      await t.ev(
        `!document.querySelector('.artwork-settings') && document.querySelector('.music-layout').dataset.step==='detail'`,
      ),
    )
    await t.click('.strip-close')
    await t.click('.np-art-edit')
    record(
      'Direct card entry targets playing track, draft discarded',
      await t.ev(
        `document.querySelector('.artwork-settings').textContent.includes('Bunny A') && document.querySelector('input[value="auto"]').checked`,
      ),
    )
    await t.file('.artwork-settings input[type="file"]', path.join(IMG, 'wide.gif'))
    await t.click('.strip-close')
    record(
      'Unsaved upload asks before closing',
      await t.ev(`!!document.querySelector('.discard-confirm')`),
    )
    await t.click('#archive-keep-editing')
    await t.value('[aria-label="이미지 맞춤"]', crop.fit, 'change')
    await t.value('[aria-label="가로 위치"]', String(crop.positionX))
    await t.value('[aria-label="세로 위치"]', String(crop.positionY))
    await t.value('[aria-label="확대율"]', String(crop.zoom))
    await t.click('.settings-actions .pill--primary')
    await waitFor(
      () => t.ev(`document.querySelector('.settings-status').textContent.includes('저장했습니다')`),
      { label: 'save GIF' },
    )
    const before = await t.db()
    record(
      'GIF crop saved without changing original bytes',
      before.assets[0]?.animated &&
        before.assets[0]?.width === 160 &&
        before.hashes.every(([id, hash]) => id === hash) &&
        JSON.stringify(before.links[0]?.display) === JSON.stringify(crop),
      before,
    )
    await t.click('.strip-close')
    await t.reload()
    await t.click('.now-playlist .track-row')
    await waitFor(
      () => t.ev(`!!document.querySelector('.now-playing-card .artwork-image__custom')`),
      { label: 'restored card' },
    )
    record(
      'Crop survives reload and renders on card',
      await t.ev(
        `document.querySelector('.now-playing-card .artwork-image__custom').style.transform==='scale(1.5)' && document.querySelector('.now-playing-card .artwork-image__custom').style.objectFit==='contain'`,
      ),
    )
    // A second track gets the same original file with a different frame.
    await t.click('.app-nav button')
    // ADR 0044 — 목록 행의 공유 아이콘을 바로 누른다 ("관리" 메뉴 없음).
    await t.click('[aria-label="다른 목록 목록 공유"]')
    // ADR 0043 — 공유는 따로 된 공유 대화상자다. 목록 · 범위 고르기와 Moments 칸이 없어졌다 — 대상 한 줄과 고르는 칸이
    // 없는 것을 본다 (목록 공유에는 Moments 가 들어가지 않는다).
    record(
      'Playlist management shares unselected target; no options (ADR 0043)',
      await t.ev(
        `document.querySelector('.share-dialog .target-kind')?.textContent==='플레이리스트' && document.querySelector('.share-dialog .target-name')?.textContent==='다른 목록' && document.querySelectorAll('.share-dialog input[type="checkbox"], .share-dialog select').length===0`,
      ),
    )
    await t.click('[aria-label="공유 닫기"]')
    await t.ev(
      `[...document.querySelectorAll('.list-select')].find(e=>e.textContent.includes('다른 목록')).click(); true`,
    )
    await sleep(250)
    await t.click('[aria-label="Bunny B 앨범아트 설정"]')
    // ADR 0044 — 행 아이콘을 바로 누른다. 설정 칸이 설 때까지 기다린다 (전에는 "관리" 를 누르는 사이에 섰다).
    await waitFor(() => t.ev(`!!document.querySelector('.artwork-settings input[type="file"]')`), {
      label: 'artwork settings',
      timeout: 8000,
    })
    await t.file('.artwork-settings input[type="file"]', path.join(IMG, 'wide.gif'))
    await t.value('[aria-label="확대율"]', '2')
    await t.click('.settings-actions .pill--primary')
    await waitFor(
      () => t.ev(`document.querySelector('.settings-status').textContent.includes('저장했습니다')`),
      { label: 'second crop' },
    )
    const two = await t.db()
    record(
      'One GIF asset, independent crops on two tracks',
      two.assets.length === 1 &&
        two.links.length === 2 &&
        two.links[0].assetId === two.links[1].assetId &&
        two.links[0].display.zoom !== two.links[1].display.zoom,
      two.links,
    )
    record(
      'Cassette keeps playing source while selecting another list',
      await t.ev(
        `document.querySelector('.cassette-label div').textContent===${JSON.stringify(seed.data.playlists[0].name)}`,
      ),
    )
    await t.click('.strip-close')
    await t.click('.moments-widget .widget-head .pill')
    record(
      'See all explicitly opens all filter',
      await t.ev(
        `document.querySelector('#archive-panel-moments .view-item[data-view="all"]')?.getAttribute('aria-current')==='true'`,
      ),
    )
    await t.click('.strip-close')
    await t.click('.moment-capture .capture-button')
    const y = await t.ev(`document.querySelector('.draft-save').getBoundingClientRect().y`)
    await t.click('[aria-label="다음 곡"]')
    await sleep(250)
    const after = await t.ev(
      `({y:document.querySelector('.draft-save').getBoundingClientRect().y, warning:!!document.querySelector('.stale-note'),target:document.querySelector('.note-target').textContent})`,
    )
    record(
      'Moment warning keeps save button position and capture target',
      after.warning && Math.abs(after.y - y) < 1 && after.target.includes('Bunny A'),
      { beforeY: y, ...after },
    )
    await t.click('.draft-cancel')
    await t.click('.app-nav button')
    await t.click('#archive-tab-music')
    await t.text('.playlist-editor button', '＋ YouTube 링크 추가')
    await t.value('#track-url', 'https://youtu.be/aqz-KE-bpKQ')
    await t.click('.link-form button[type="submit"]')
    await waitFor(() => t.ev(`document.querySelector('#track-url').value===''`), {
      timeout: 10000,
      label: 'title submit',
    })
    const title = await t.ev(
      `JSON.parse(localStorage.getItem('39page.library')).data.playlists.find(p=>p.id==='b').tracks.at(-1).title`,
    )
    record('Real oEmbed fast submit obtains title', !title.startsWith('YouTube ·'), { title })
    await t.send('Network.setBlockedURLs', { urls: ['*open-meteo*', '*youtube.com/oembed*'] })
    await t.value('#track-url', 'https://youtu.be/M7lc1UVf-VE')
    await t.click('.link-form button[type="submit"]')
    await waitFor(() => t.ev(`document.querySelector('#track-url').value===''`), {
      timeout: 10000,
      label: 'fallback submit',
    })
    record(
      'Blocked oEmbed still adds fallback title',
      await t.ev(
        `JSON.parse(localStorage.getItem('39page.library')).data.playlists.find(p=>p.id==='b').tracks.at(-1).title==='YouTube · M7lc1UVf-VE'`,
      ),
    )
    await t.text('.link-form button', '닫기')
    await t.click('[aria-label="Bunny B 공유"]')
    // ADR 0043 — 공유 대화상자가 그 곡을 대상으로 연다. 파일(ZIP) 공유는 없어졌다 — 전체 백업만 내려받는다.
    record(
      'Track management selects exact playlist and track',
      await t.ev(
        `document.querySelector('.share-dialog .target-kind')?.textContent==='곡' && document.querySelector('.share-dialog .target-name')?.textContent==='Bunny B'`,
      ),
    )
    await t.click('[aria-label="공유 닫기"]')
    await t.click('.app-nav button:nth-child(2)')
    await t.download(() => t.text('.backup button', '전체 백업 내보내기'))
    await t.click('[aria-label="데이터 닫기"]')
    await t.click('.strip-close')
    await t.ev(`window.__iframe=document.querySelector('.player-mount iframe'); true`)
    for (const theme of ['kawaii-synth-cassette', 'mono-vinyl']) {
      await t.ev(
        `[...document.querySelectorAll('.theme-button')].find(e=>e.textContent.includes(${JSON.stringify(theme === 'mono-vinyl' ? 'MONO VINYL' : 'SYNTH CASSETTE')})).click(); true`,
      )
      for (const [width, height] of [
        [1440, 900],
        [1024, 768],
        [768, 1024],
        [390, 844],
        [360, 740],
        [320, 640],
        [844, 390],
      ]) {
        await t.size(width, height)
        await t.ev(`window.scrollTo(0,0); true`)
        await sleep(160)
        for (const open of [false, true]) {
          if (open) await t.click('.app-nav button')
          const m = await t.ev(
            `(() => { const e=document.querySelector('.video-holder'), r=e.getBoundingClientRect(); return {w:r.width,h:r.height,iframe:window.__iframe===document.querySelector('.player-mount iframe'),overflow:document.documentElement.scrollWidth-document.documentElement.clientWidth} })()`,
          )
          record(
            `Layout ${theme} ${width}x${height} ${open ? 'archive' : 'dashboard'}`,
            m.w >= 200 && m.h >= 200 && m.iframe && m.overflow <= 1,
            m,
          )
          if (open) {
            const close = await t.ev(
              `document.querySelector('.strip-close').hidden ? '#archive-panel .close' : '.strip-close'`,
            )
            await t.click(close)
          }
        }
      }
    }
    await t.size(1440, 900)
    const shot = await t.send('Page.captureScreenshot', { format: 'png' })
    writeFileSync(path.join(OUT, 'dashboard.png'), Buffer.from(shot.data, 'base64'))
    await t.ev(
      `[...document.querySelectorAll('.theme-button')].find(e=>e.textContent.includes('SYNTH CASSETTE')).click(); true`,
    )
    await sleep(200)
    const cassetteShot = await t.send('Page.captureScreenshot', { format: 'png' })
    writeFileSync(path.join(OUT, 'cassette.png'), Buffer.from(cassetteShot.data, 'base64'))
    await t.click('[aria-label="이전 곡"]')
    for (const [width, height] of [
      [320, 640],
      [844, 390],
    ]) {
      await t.size(width, height)
      await t.ev(`window.scrollTo(0,0); true`)
      await sleep(200)
      await t.click('.app-nav button')
      await t.click('#archive-tab-music')
      await t.click('.list-select[aria-current="true"]')
      await t.click('[aria-label="Bunny B 앨범아트 설정"]')
      await t.ev(
        `document.querySelector('.settings-actions').scrollIntoView({block:'nearest'}); true`,
      )
      const rects = await t.ev(
        `[...document.querySelectorAll('.settings-actions button')].map(e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom}})`,
      )
      record(
        `Artwork actions accessible ${width}x${height}`,
        rects.every(
          (r) =>
            r.x >= 0 &&
            r.y >= 0 &&
            r.right <= width + 1 &&
            r.bottom <= height + 1 &&
            r.height >= 44,
        ),
        rects,
      )
      const frame = await t.send('Page.captureScreenshot', { format: 'png' })
      writeFileSync(path.join(OUT, `editor-${width}.png`), Buffer.from(frame.data, 'base64'))
      const close = await t.ev(
        `document.querySelector('.strip-close').hidden ? '#archive-panel .close' : '.strip-close'`,
      )
      await t.click(close)
      await waitFor(() => t.ev(`document.querySelector('#archive-panel').hidden`), {
        label: 'editor closed',
      })
    }
  })
  await session(async (t) => {
    await t.click('.app-nav button:nth-child(2)')
    await t.file('.backup input[type="file"]', path.join(OUT, 'full.zip'))
    await waitFor(() => t.ev(`!!document.querySelector('.backup .preview')`), {
      label: 'ZIP preview',
    })
    await t.text('.backup .preview button', '교체하고 가져오기')
    await waitFor(() => t.ev(`!!document.querySelector('.backup .artwork-result')`), {
      label: 'ZIP restore',
    })
    const restored = await t.db()
    record(
      'New Chrome profile restores ZIP crops and original GIF',
      restored.assets.length === 1 &&
        restored.links.length === 2 &&
        restored.links.some((l) => l.display.zoom === 1.5) &&
        restored.links.some((l) => l.display.zoom === 2) &&
        restored.hashes.every(([id, hash]) => id === hash),
      restored,
    )
    // 파일(ZIP) 공유 가져오기는 ADR 0043 에서 없어졌다 — 그 두 확인을 뺐다.
  })
} catch (error) {
  record('Harness completed all scenarios', false, { error: error.stack })
} finally {
  writeFileSync(
    path.join(OUT, 'real-chrome-ux.json'),
    JSON.stringify({ date: '2026-11-15', results }, null, 2) + '\n',
  )
}
if (results.some((r) => !r.pass)) process.exitCode = 1
