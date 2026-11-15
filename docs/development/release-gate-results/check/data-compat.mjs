// Actual downloaded M10 bytes -> candidate -> M10 rollback -> candidate, at one LOCAL origin only.
// Never uses a normal browser profile and never writes to 39page.com.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { unzipSync, zipSync } from 'fflate'
import { launch, BASE, waitFor } from '../../../../extension/integration/harness.mjs'

const OUT = path.resolve('docs/development/release-gate-results')
const TMP = path.resolve('node_modules/.tmp/release-gate')
const LEGACY = path.join(TMP, 'live-m10')
mkdirSync(OUT, { recursive: true })
const v2file = path.join(TMP, 'browser/ux/full.zip')
const entries = unzipSync(readFileSync(v2file))
const json = (name) => JSON.parse(Buffer.from(entries[name]).toString('utf8'))
const packaged = {
  manifest: json('manifest.json'),
  artwork: json('artwork.json'),
  backup: json('backup.json'),
}
const v1entries = { ...entries }
const v1art = JSON.parse(JSON.stringify(packaged.artwork))
v1art.version = 1
for (const a of v1art.assignments) delete a.display
v1entries['artwork.json'] = Buffer.from(JSON.stringify(v1art))
const v1manifest = JSON.parse(JSON.stringify(packaged.manifest))
v1manifest.formatVersion = 1
for (const f of v1manifest.files)
  if (f.path === 'artwork.json') {
    f.byteSize = v1entries['artwork.json'].length
    f.sha256 = createHash('sha256').update(v1entries['artwork.json']).digest('hex')
  }
v1entries['manifest.json'] = Buffer.from(JSON.stringify(v1manifest))
const v1file = path.join(TMP, 'legacy-v1.zip')
writeFileSync(v1file, zipSync(v1entries))
const results = []
function record(name, pass, details = {}) {
  results.push({ name, pass: Boolean(pass), details })
  console.log(pass ? 'PASS' : 'FAIL', name, JSON.stringify(details).slice(0, 250))
}
const h = await launch({
  chrome: process.env.POC_CHROME,
  webDist: path.resolve('dist'),
  headful: false,
})
try {
  const page = await h.tab('about:blank')
  const ev = page.ev,
    send = (m, p = {}) => h.cdp.send(m, p, page.session)
  await send('Network.enable')
  await send('Network.setCacheDisabled', { cacheDisabled: true })
  await send('Network.setBlockedURLs', { urls: ['*open-meteo*'] })
  let legacy = true
  const interceptionErrors = []
  h.cdp.on((message) => {
    if (message.sessionId !== page.session || message.method !== 'Fetch.requestPaused') return
    void (async () => {
      const { requestId, request } = message.params
      if (!legacy) return send('Fetch.continueRequest', { requestId })
      const pathname = new URL(request.url).pathname
      const file = path.join(LEGACY, pathname === '/' ? 'index.html' : pathname.slice(1))
      const type = pathname.endsWith('.js')
        ? 'text/javascript'
        : pathname.endsWith('.css')
          ? 'text/css'
          : pathname.endsWith('.ico')
            ? 'image/x-icon'
            : 'text/html'
      await send('Fetch.fulfillRequest', {
        requestId,
        responseCode: 200,
        responseHeaders: [
          { name: 'Content-Type', value: type },
          { name: 'Cache-Control', value: 'no-store' },
        ],
        body: readFileSync(file).toString('base64'),
      })
    })().catch((error) => interceptionErrors.push(error.message))
  })
  await send('Fetch.enable', { patterns: [{ urlPattern: BASE + '/*', requestStage: 'Request' }] })
  await send('Page.navigate', { url: BASE + '/' })
  await waitFor(() => ev(`!!document.querySelector('.app-header')`), {
    label: 'actual M10 bytes at local origin',
  })
  const now = new Date().toISOString()
  const seed = {
    '39page.library': {
      version: 1,
      data: {
        playlists: [
          {
            id: 'legacy',
            name: 'Legacy M10 data',
            tracks: [
              { id: 'track', source: 'youtube', videoId: 'aqz-KE-bpKQ', title: 'Legacy title' },
            ],
          },
        ],
        selectedPlaylistId: 'legacy',
      },
    },
    '39page.theme': { version: 1, data: 'mono-vinyl' },
    '39page.moments': {
      version: 1,
      data: [
        {
          id: 'legacy-moment',
          source: 'youtube',
          videoId: 'aqz-KE-bpKQ',
          title: 'Legacy title',
          note: 'Existing M10 note',
          atSeconds: 42,
          createdAt: now,
          updatedAt: now,
        },
      ],
    },
  }
  await ev(
    `for(const[k,v]of Object.entries(${JSON.stringify(seed)}))localStorage.setItem(k,JSON.stringify(v));true`,
  )
  const reload = async (isLegacy) => {
    legacy = isLegacy
    await ev(`window.__beforeReload=true;true`)
    await send('Page.reload')
    await waitFor(
      () =>
        ev(
          `!window.__beforeReload&&!!document.querySelector('.app-header')&&${isLegacy ? '!' : '!!'}document.querySelector('.header-toggle')`,
        ),
      { label: isLegacy ? 'M10 load' : 'candidate load' },
    )
  }
  const raw = () =>
    ev(
      `Object.fromEntries(['39page.library','39page.theme','39page.moments'].map(k=>[k,localStorage.getItem(k)]))`,
    )
  const db = (evaluate = ev) =>
    evaluate(
      `new Promise((resolve,reject)=>{const q=indexedDB.open('39page-artwork',1);q.onerror=()=>reject(q.error);q.onsuccess=()=>{const d=q.result,t=d.transaction(['assets','assignments','blobs']),a=t.objectStore('assets').getAll(),s=t.objectStore('assignments').getAll(),b=t.objectStore('blobs').getAll();t.oncomplete=async()=>{const hashes=await Promise.all(b.result.map(async x=>({id:x.id,sha256:Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await x.blob.arrayBuffer()))).map(v=>v.toString(16).padStart(2,'0')).join('')})));d.close();resolve({version:d.version,assets:a.result,assignments:s.result,hashes})}}})`,
    )
  await reload(true)
  const old = await raw()
  record(
    'Downloaded live M10 reads seeded legacy data without rewriting',
    Object.entries(seed).every(([k, v]) => old[k] === JSON.stringify(v)),
  )
  await reload(false)
  const upgraded = await raw()
  record(
    'M10 -> candidate preserves all three localStorage envelopes byte-for-byte',
    JSON.stringify(old) === JSON.stringify(upgraded),
    { theme: await ev('document.documentElement.dataset.theme') },
  )
  await ev(`document.querySelector('.app-nav button:last-child').click();true`)
  const restore = async (target, file) => {
    await h.cdp.send('DOM.enable', {}, target.session)
    const { root } = await h.cdp.send('DOM.getDocument', { depth: -1 }, target.session)
    const { nodeId } = await h.cdp.send(
      'DOM.querySelector',
      { nodeId: root.nodeId, selector: '.backup input[type="file"]' },
      target.session,
    )
    await h.cdp.send('DOM.setFileInputFiles', { nodeId, files: [file] }, target.session)
    await waitFor(() => target.ev(`!!document.querySelector('.backup .preview')`), {
      label: 'ZIP preview',
    })
    await target.ev(
      `[...document.querySelectorAll('.backup .preview button')].find(b=>b.textContent.includes('교체하고 가져오기')).click();true`,
    )
    await waitFor(() => target.ev(`!!document.querySelector('.backup .artwork-result')`), {
      label: 'ZIP apply',
    })
  }
  await restore(page, v2file)
  const expected = await raw(),
    before = await db()
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
  record(
    'ZIP v2 restores custom artwork bytes, non-default framing and stored theme',
    packaged.manifest.formatVersion === 2 &&
      before.hashes.every((x) => x.id === x.sha256) &&
      before.assignments.some((x) => x.display?.zoom > 1) &&
      same(JSON.parse(expected['39page.library']), packaged.backup.data.library) &&
      same(JSON.parse(expected['39page.theme']), packaged.backup.data.preferences.theme),
    {
      formatVersion: packaged.manifest.formatVersion,
      assets: before.assets.length,
      assignments: before.assignments.length,
      display: before.assignments.map((x) => x.display),
    },
  )
  await reload(true)
  const rolled = await raw(),
    afterRollback = await db()
  record(
    'Code rollback to actual M10 leaves localStorage and IndexedDB artwork unchanged',
    same(expected, rolled) && same(before, afterRollback),
    { assets: afterRollback.assets.length, assignments: afterRollback.assignments.length },
  )
  await reload(false)
  const afterReupgrade = await db()
  record(
    'Re-upgrade preserves original artwork SHA-256 and framing',
    same(expected, await raw()) && same(before, afterReupgrade),
  )
  const { browserContextId } = await h.cdp.send('Target.createBrowserContext', {})
  const { targetId } = await h.cdp.send('Target.createTarget', {
    url: BASE + '/',
    browserContextId,
  })
  const session = await h.cdp.attach(targetId)
  const fresh = { session, ev: (code) => h.cdp.evaluate(session, code) }
  await waitFor(() => fresh.ev(`!!document.querySelector('.header-toggle')`))
  await fresh.ev(`document.querySelector('.app-nav button:last-child').click();true`)
  await restore(fresh, v1file)
  const oldFormat = await db(fresh.ev)
  await fresh.ev(
    `document.querySelector('[aria-label="데이터 닫기"]').click();document.querySelector('.now-playlist .track-row').click();true`,
  )
  await waitFor(() => fresh.ev(`!!document.querySelector('.np-art-edit')`))
  await fresh.ev(`document.querySelector('.np-art-edit').click();true`)
  await waitFor(() => fresh.ev(`!!document.querySelector('.display-controls')`))
  const displayed = await fresh.ev(
    `({fit:document.querySelector('.display-controls select').value,positionX:Number(document.querySelector('[aria-label="가로 위치"]').value),positionY:Number(document.querySelector('[aria-label="세로 위치"]').value),zoom:Number(document.querySelector('[aria-label="확대율"]').value)})`,
  )
  record(
    'ZIP v1 restores in fresh isolated context with default framing',
    oldFormat.assets.length === before.assets.length &&
      oldFormat.assignments.length === before.assignments.length &&
      oldFormat.hashes.every((x) => x.id === x.sha256) &&
      same(displayed, { fit: 'cover', positionX: 50, positionY: 50, zoom: 1 }),
    { assets: oldFormat.assets.length, displayed },
  )
  record(
    'Legacy interception is local-only and completed without errors',
    interceptionErrors.length === 0,
    { origin: BASE, interceptionErrors },
  )
} catch (error) {
  record('Complete data compatibility run', false, { error: error.stack })
} finally {
  writeFileSync(
    path.join(OUT, 'data-compat.json'),
    JSON.stringify({ candidate: 'e371fb5', liveAssetReplayOrigin: BASE, results }, null, 2) + '\n',
  )
  h.cdp.close()
  h.kill()
}
if (results.some((x) => !x.pass)) process.exitCode = 1
