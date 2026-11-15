// Production candidate only, bridge disabled, disposable Chrome profile + synthetic data.
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { unzipSync } from 'fflate'
import { launch, BASE, waitFor } from '../../../../extension/integration/harness.mjs'

const OUT = path.resolve('docs/development/release-gate-results')
const results = []
const record = (name, pass, details = {}) => {
  results.push({ name, pass: Boolean(pass), details })
  console.log(pass ? 'PASS' : 'FAIL', name, JSON.stringify(details).slice(0, 250))
}
const h = await launch({
  chrome: process.env.POC_CHROME,
  webDist: path.resolve('dist'),
  headful: false,
})
try {
  const page = await h.tab(BASE + '/'),
    ev = page.ev
  await h.cdp.send(
    'Emulation.setDeviceMetricsOverride',
    { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false },
    page.session,
  )
  await waitFor(() => ev(`!!document.querySelector('.header-toggle')`))
  const data = {
    version: 1,
    data: {
      playlists: [
        {
          id: 'gate',
          name: 'Release gate',
          tracks: [
            { id: 'one', source: 'youtube', videoId: 'aqz-KE-bpKQ', title: 'Bunny' },
            { id: 'two', source: 'youtube', videoId: 'eRsGyueVLvQ', title: 'Sintel' },
          ],
        },
      ],
      selectedPlaylistId: 'gate',
    },
  }
  await ev(
    `localStorage.setItem('39page.library',${JSON.stringify(JSON.stringify(data))});window.__old=true;true`,
  )
  await h.cdp.send('Page.reload', {}, page.session)
  await waitFor(() => ev(`!window.__old&&!!document.querySelector('.now-playlist .track-row')`))
  const click = (selector) => ev(`document.querySelector(${JSON.stringify(selector)}).click();true`)
  await click('.now-playlist .track-row')
  await waitFor(() => ev(`document.querySelector('.now-sub')?.textContent.includes('재생 중')`), {
    timeout: 30000,
  })
  await ev(`window.__player=document.querySelector('.player-mount iframe');true`)
  record(
    'Production YouTube playback and NOW PLAYLIST',
    await ev(
      `document.querySelectorAll('.now-playlist .track-row').length===2&&document.querySelector('.now-sub').textContent.includes('1 / 2')`,
    ),
  )
  await click('[aria-label="다음 곡"]')
  await waitFor(() => ev(`document.querySelector('.now-sub')?.textContent.includes('2 / 2')`))
  await click('[aria-label="이전 곡"]')
  await waitFor(
    () =>
      ev(
        `document.querySelector('.now-sub')?.textContent.includes('1 / 2')&&document.querySelector('.now-sub')?.textContent.includes('재생 중')`,
      ),
    { timeout: 30000 },
  )
  record(
    'Queue next/previous preserves one iframe',
    await ev(
      `window.__player===document.querySelector('.player-mount iframe')&&document.querySelectorAll('.player-mount iframe').length===1`,
    ),
  )
  await waitFor(() => ev(`!document.querySelector('.capture-button').disabled`))
  await click('.capture-button')
  await ev(
    `const t=document.querySelector('.draft-form textarea');t.value='Release gate Moment';t.dispatchEvent(new Event('input',{bubbles:true}));true`,
  )
  await click('.draft-save')
  await waitFor(() =>
    ev(
      `JSON.parse(localStorage.getItem('39page.moments')??'{"data":[]}').data.some(m=>m.note==='Release gate Moment')`,
    ),
  )
  const moment = await ev(
    `JSON.parse(localStorage.getItem('39page.moments')).data.find(m=>m.note==='Release gate Moment')`,
  )
  record(
    'Moment UI saves note and captured position',
    moment.videoId === 'aqz-KE-bpKQ' && Number.isInteger(moment.atSeconds),
    moment,
  )
  await click('.app-nav button:last-child')
  await ev(
    `window.__download=null;HTMLAnchorElement.prototype.click=function(){if(this.download){const name=this.download;fetch(this.href).then(r=>r.arrayBuffer()).then(b=>{let s='';const u=new Uint8Array(b);for(let i=0;i<u.length;i+=0x8000)s+=String.fromCharCode(...u.subarray(i,i+0x8000));window.__download={name,b64:btoa(s)}})}};true`,
  )
  await ev(
    `[...document.querySelectorAll('.backup button')].find(b=>b.textContent.includes('전체 백업')).click();true`,
  )
  await waitFor(() => ev(`!!window.__download`))
  const dl = await ev('window.__download'),
    zip = unzipSync(Buffer.from(dl.b64, 'base64'))
  const backup = JSON.parse(Buffer.from(zip['backup.json']).toString('utf8'))
  record(
    'Full ZIP download contains newly saved Moment',
    dl.name.endsWith('.zip') &&
      backup.data.moments.data.some((m) => m.note === 'Release gate Moment'),
    { name: dl.name, bytes: Buffer.from(dl.b64, 'base64').length },
  )
  const before = await ev(`JSON.stringify({...localStorage})`)
  await ev(
    `const f=document.createElement('iframe');f.id='gate-bridge';f.src='/bridge.html';f.hidden=true;document.body.append(f);true`,
  )
  await waitFor(() =>
    ev(
      `document.querySelector('#gate-bridge').contentDocument?.documentElement.dataset.bridge==='refused'`,
    ),
  )
  record(
    'Production bridge refuses web ancestry without touching storage',
    before === (await ev(`JSON.stringify({...localStorage})`)),
    { bridge: 'refused', headers: readFileSync('dist/_headers', 'utf8') },
  )
  const collect = await h.tab(
    BASE +
      '/#collect?v=1&kind=track&videoId=M7lc1UVf-VE&title=Release%20gate%20Collect&req=ReleaseGateRequest1234',
  )
  await waitFor(() => collect.ev(`!!document.querySelector('.choose button[type="submit"]')`))
  record(
    'Collect fallback opens without saving',
    await collect.ev(
      `!JSON.parse(localStorage.getItem('39page.library')).data.playlists[0].tracks.some(t=>t.videoId==='M7lc1UVf-VE')`,
    ),
  )
  await collect.ev(`document.querySelector('.choose button[type="submit"]').click();true`)
  await waitFor(() =>
    collect.ev(
      `JSON.parse(localStorage.getItem('39page.library')).data.playlists[0].tracks.some(t=>t.videoId==='M7lc1UVf-VE')`,
    ),
  )
  record('Collect fallback saves only after explicit confirmation', true)
} catch (error) {
  record('Complete production smoke', false, { error: error.stack })
} finally {
  writeFileSync(
    path.join(OUT, 'smoke.json'),
    JSON.stringify({ candidate: 'e371fb5', results }, null, 2) + '\n',
  )
  h.cdp.close()
  h.kill()
}
if (results.some((x) => !x.pass)) process.exitCode = 1
