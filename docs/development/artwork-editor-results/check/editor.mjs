// Fresh measurements of the local build. No production origin or user profile.
// Run make-fixtures.py from m12-6-results/check, then set POC_CHROME and run this file.
import { mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { launch, BASE, sleep, waitFor } from '../../../../extension/integration/harness.mjs'

const OUT = path.resolve('docs/development/artwork-editor-results')
mkdirSync(OUT, { recursive: true })
const results = []
const record = (name, pass, details) => {
  results.push({ name, pass: Boolean(pass), details })
  console.log(pass ? 'PASS' : 'FAIL', name, JSON.stringify(details).slice(0, 300))
}
const h = await launch({
  chrome: process.env.POC_CHROME,
  webDist: path.resolve('dist'),
  headful: false,
})
try {
  const page = await h.tab('about:blank')
  const ev = page.ev
  const send = (name, params = {}) => h.cdp.send(name, params, page.session)
  await send('Network.enable')
  await send('Network.setBlockedURLs', { urls: ['*open-meteo*'] })
  await send('DOM.enable')
  const size = (width, height) =>
    send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      mobile: width < 700,
      deviceScaleFactor: width === 720 ? 2 : 1,
    })
  const click = async (selector, scroll = true) => {
    const point = await ev(
      `(() => { const e=document.querySelector(${JSON.stringify(selector)}); if(!e)throw Error('Missing '+${JSON.stringify(selector)}); ${scroll ? "e.scrollIntoView({block:'nearest'});" : ''} const r=e.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2} })()`,
    )
    for (const type of ['mousePressed', 'mouseReleased'])
      await send('Input.dispatchMouseEvent', { type, ...point, button: 'left', clickCount: 1 })
    await sleep(100)
  }
  const file = async (filename) => {
    const { root } = await send('DOM.getDocument', { depth: -1 })
    const { nodeId } = await send('DOM.querySelector', {
      nodeId: root.nodeId,
      selector: '.artwork-settings input[type="file"]',
    })
    await send('DOM.setFileInputFiles', { nodeId, files: [filename] })
    await waitFor(() => ev(`!!document.querySelector('.display-controls')`), {
      label: 'file checked',
    })
  }
  const db = () =>
    ev(
      `new Promise(resolve=>{ const q=indexedDB.open('39page-artwork',1); q.onsuccess=()=>{const t=q.result.transaction(['assets','assignments','blobs']); const a=t.objectStore('assets').getAll(),s=t.objectStore('assignments').getAll(),b=t.objectStore('blobs').getAll(); t.oncomplete=async()=>{const hashes=await Promise.all(b.result.map(async v=>[v.id,Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await v.blob.arrayBuffer()))).map(n=>n.toString(16).padStart(2,'0')).join('')]));q.result.close();resolve({assets:a.result,links:s.result,hashes})}}})`,
    )
  const reload = async () => {
    await ev(`window.__oldDoc=true; true`)
    await send('Page.reload')
    await waitFor(() => ev(`!window.__oldDoc && !!document.querySelector('.now-playlist')`), {
      label: 'reload',
    })
  }
  const openEditor = async () => {
    await click('.app-nav button')
    await click('#archive-tab-music')
    await click('.list-select[aria-current="true"]')
    await click('[aria-label="Fixture 관리"]')
    await click('[aria-label="Fixture 앨범아트 설정"]')
    await waitFor(() => ev(`!!document.querySelector('.artwork-settings')`), { label: 'settings' })
    await sleep(120)
  }
  const closeArchive = async () => {
    const selector = await ev(
      `document.querySelector('.strip-close').hidden ? '#archive-panel .close' : '.strip-close'`,
    )
    await click(selector)
  }
  const geometry = async (selector) =>
    ev(`(() => {
    const rect=e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height,b:r.bottom,r:r.right}};
    const root=document.querySelector('.artwork-settings'),scroll=root.querySelector('.settings-scroll'),image=root.querySelector('.preview-art'),control=root.querySelector(${JSON.stringify(selector)});
    const ancestors=[];for(let e=control.parentElement;e;e=e.parentElement){if(/auto|scroll/.test(getComputedStyle(e).overflowY)&&e.scrollHeight>e.clientHeight+1)ancestors.push(e.className)}
    const c=control.getBoundingClientRect(), hit=document.elementFromPoint(c.x+c.width/2,c.y+c.height/2);
    return {root:rect(root),scroll:rect(scroll),preview:rect(image),sticky:rect(root.querySelector('.settings-previews')),control:rect(control),columns:getComputedStyle(root.querySelector('.settings-workspace')).gridTemplateColumns,scrollTop:scroll.scrollTop,overflow:Math.max(document.documentElement.scrollWidth-document.documentElement.clientWidth,root.scrollWidth-root.clientWidth),hit:hit===control||control.contains(hit),ancestors,buttons:[...root.querySelectorAll('.settings-actions button')].map(rect),style:root.querySelector('.preview-art img')?.getAttribute('style'),value:control.value,iframe:window.__iframe===document.querySelector('.player-mount iframe')};
  })()`)
  const visible = (m) =>
    m.preview.y >= m.scroll.y - 1 &&
    m.preview.b <= m.scroll.b + 1 &&
    m.control.y >= m.scroll.y - 1 &&
    m.control.b <= m.scroll.b + 1 &&
    m.hit
  await size(1440, 900)
  await send('Page.navigate', { url: BASE })
  await waitFor(() => ev(`!!document.querySelector('.now-playlist')`), { label: 'app' })
  const seed = {
    version: 1,
    data: {
      playlists: [
        {
          id: 'p',
          name: 'Editor UAT',
          tracks: [{ id: 't', source: 'youtube', videoId: 'aqz-KE-bpKQ', title: 'Fixture' }],
        },
      ],
      selectedPlaylistId: 'p',
    },
  }
  await ev(`localStorage.setItem('39page.library',${JSON.stringify(JSON.stringify(seed))});true`)
  await reload()
  await click('.now-playlist .track-row')
  await waitFor(() => ev(`!!document.querySelector('.player-mount iframe')`), { label: 'iframe' })
  await ev(`window.__iframe=document.querySelector('.player-mount iframe');true`)
  await openEditor()
  await file(path.join(tmpdir(), '39page-m126-images', 'wide.gif'))
  await click('.settings-actions .pill--primary', false)
  await waitFor(
    () => ev(`document.querySelector('.settings-status').textContent.includes('저장했습니다')`),
    { label: 'initial save' },
  )
  const initial = await db()
  record(
    'GIF saved with original SHA-256',
    initial.assets[0]?.animated && initial.hashes.every(([id, hash]) => id === hash),
    initial,
  )
  await closeArchive()

  for (const theme of ['cassette', 'mono']) {
    for (const [width, height] of [
      [1440, 900],
      [1024, 768],
      [768, 1024],
      [390, 844],
      [360, 780],
      [320, 640],
      [844, 390],
      [720, 450],
    ]) {
      const name = `${theme}-${width}x${height}`
      try {
        await size(width, height)
        await ev(
          `window.scrollTo(0,0);[...document.querySelectorAll('.theme-button')].find(e=>e.textContent.includes(${JSON.stringify(theme === 'mono' ? 'MONO VINYL' : 'SYNTH CASSETTE')})).click();true`,
        )
        await sleep(150)
        await openEditor()
        if (theme === 'mono')
          await ev(
            `(() => {const e=document.querySelector('[aria-label="이미지 맞춤"]');e.value='contain';e.dispatchEvent(new Event('change',{bubbles:true}));return true})()`,
          )
        await ev(`document.querySelector('.settings-scroll').scrollTop=0;true`)
        const steps = []
        for (const [label, key] of [
          ['가로 위치', 'ArrowLeft'],
          ['세로 위치', 'ArrowLeft'],
          ['확대율', 'ArrowRight'],
        ]) {
          const selector = `[aria-label="${label}"]`
          await ev(
            `document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'nearest'});document.querySelector(${JSON.stringify(selector)}).focus({preventScroll:true});true`,
          )
          const before = await geometry(selector)
          for (const type of ['keyDown', 'keyUp'])
            await send('Input.dispatchKeyEvent', {
              type,
              key,
              code: key,
              windowsVirtualKeyCode: key === 'ArrowLeft' ? 37 : 39,
            })
          const after = await geometry(selector)
          steps.push({ label, before, after })
        }
        record(
          `${name}: preview stays visible while adjusting all sliders`,
          steps.every(
            (s) =>
              visible(s.after) &&
              s.before.value !== s.after.value &&
              s.before.scrollTop === s.after.scrollTop &&
              s.after.ancestors.length === 1,
          ),
          steps,
        )
        const layout = steps[0].after
        const expectedColumns = layout.root.w >= 560 ? 2 : 1
        record(
          `${name}: columns, actions, overflow and iframe`,
          layout.columns.split(' ').length === expectedColumns &&
            layout.overflow <= 1 &&
            layout.iframe &&
            layout.buttons.every(
              (r) =>
                r.y >= layout.root.y &&
                r.b <= layout.root.b + 1 &&
                r.y >= 0 &&
                r.b <= height + 1 &&
                r.h >= 44,
            ),
          layout,
        )
        // Pointer drag uses the same live draft. Choose the top-left clear of the GIF motion button.
        const image = layout.preview
        await ev(
          `window.__editImage=document.querySelector('.preview-art img');window.__editSrc=window.__editImage.src;true`,
        )
        const dragBefore = await geometry('[aria-label="가로 위치"]')
        const start = { x: image.x + 8, y: image.y + 8 }
        await send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...start })
        await send('Input.dispatchMouseEvent', {
          type: 'mousePressed',
          ...start,
          button: 'left',
          clickCount: 1,
        })
        await send('Input.dispatchMouseEvent', {
          type: 'mouseMoved',
          x: start.x + 12,
          y: start.y + 2,
          buttons: 1,
        })
        await send('Input.dispatchMouseEvent', {
          type: 'mouseReleased',
          x: start.x + 12,
          y: start.y + 2,
          button: 'left',
          clickCount: 1,
        })
        const dragAfter = await geometry('[aria-label="가로 위치"]')
        record(
          `${name}: pointer drag updates slider without scrolling`,
          dragBefore.value !== dragAfter.value && dragBefore.scrollTop === dragAfter.scrollTop,
          { before: dragBefore, after: dragAfter },
        )
        await click('.compare-button', false)
        const compared = await ev(
          `({label:document.querySelector('.preview-label').textContent,style:document.querySelector('.preview-art img').style.transform,same:window.__editImage===document.querySelector('.preview-art img')&&window.__editSrc===document.querySelector('.preview-art img').src,zoom:document.querySelector('[aria-label="확대율"]').value})`,
        )
        await click('.compare-button', false)
        record(
          `${name}: comparison preserves draft and GIF node`,
          compared.label === '현재 저장된 이미지' &&
            compared.style === 'scale(1)' &&
            compared.same &&
            compared.zoom !== '1',
          compared,
        )
        await ev(`document.querySelector('.settings-head button').focus({preventScroll:true});true`)
        const focusPath = []
        for (let i = 0; i < 18; i++) {
          for (const type of ['keyDown', 'keyUp'])
            await send('Input.dispatchKeyEvent', {
              type,
              key: 'Tab',
              code: 'Tab',
              windowsVirtualKeyCode: 9,
            })
          const focused = await ev(
            `(() => {const e=document.activeElement,r=e.getBoundingClientRect();return {name:e.getAttribute('aria-label')??e.textContent.trim().slice(0,30),inside:!!e.closest('.artwork-settings'),cancel:e.matches('.settings-actions button:first-child'),y:r.y,b:r.bottom}})()`,
          )
          focusPath.push(focused)
          if (focused.cancel) break
        }
        record(
          `${name}: keyboard reaches actions within editor`,
          focusPath.every((f) => f.inside && f.y >= 0 && f.b <= height + 1) &&
            focusPath.at(-1)?.cancel,
          focusPath,
        )
        await ev(
          `document.querySelector('[aria-label="확대율"]').scrollIntoView({block:'nearest'});document.querySelector('[aria-label="확대율"]').focus({preventScroll:true});true`,
        )
        const screenshot = await send('Page.captureScreenshot', { format: 'png' })
        writeFileSync(path.join(OUT, `${name}.png`), Buffer.from(screenshot.data, 'base64'))
        await click('.settings-actions button:first-child', false)
        await waitFor(() => ev(`!!document.querySelector('.discard-confirm')`), {
          label: 'discard protection',
        })
        await click('.discard-confirm button:last-child')
        await waitFor(() => ev(`!document.querySelector('.artwork-settings')`), {
          label: 'cancelled',
        })
        const afterCancel = await db()
        record(
          `${name}: cancelling keeps saved framing`,
          JSON.stringify(initial.links) === JSON.stringify(afterCancel.links),
          afterCancel.links,
        )
        await closeArchive()
      } catch (error) {
        record(`${name}: scenario completed`, false, { error: error.stack })
        const screenshot = await send('Page.captureScreenshot', { format: 'png' })
        writeFileSync(path.join(OUT, `${name}-error.png`), Buffer.from(screenshot.data, 'base64'))
        throw error
      }
    }
  }
  await size(1440, 900)
  await openEditor()
  await ev(
    `(() => {const e=document.querySelector('[aria-label="확대율"]');e.value='2';e.dispatchEvent(new Event('input',{bubbles:true}));return true})()`,
  )
  await ev(
    `(() => {const e=document.querySelector('[aria-label="이미지 맞춤"]');e.value='contain';e.dispatchEvent(new Event('change',{bubbles:true}));return true})()`,
  )
  await click('.settings-actions .pill--primary', false)
  await waitFor(
    () => ev(`document.querySelector('.settings-status').textContent.includes('저장했습니다')`),
    { label: 'new framing saved' },
  )
  const saved = await db()
  await reload()
  await openEditor()
  record(
    'Saved framing survives reload; GIF original unchanged',
    (await ev(
      `document.querySelector('[aria-label="확대율"]').value==='2' && document.querySelector('[aria-label="이미지 맞춤"]').value==='contain'`,
    )) &&
      saved.hashes.every(([id, hash]) => id === hash) &&
      saved.assets[0]?.id === initial.assets[0]?.id,
    saved,
  )
} catch (error) {
  record('Complete run', false, { error: error.stack })
} finally {
  writeFileSync(
    path.join(OUT, 'real-chrome-editor.json'),
    JSON.stringify({ results }, null, 2) + '\n',
  )
  h.cdp.close()
  h.kill()
}
if (results.some((r) => !r.pass)) process.exitCode = 1
