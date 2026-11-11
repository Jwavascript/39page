// M11-1 PoC — 탐침 보고를 하네스가 읽을 수 있게 전역에 둔다 (실험 코드).
const frame = document.querySelector('#probe')
let waiters = []
globalThis.addEventListener('message', (event) => {
  if (event.source !== frame.contentWindow) return
  if (event.data?.kind === 'loaded') globalThis.__probeReport = event.data.report
  if (event.data?.kind === 'report') {
    for (const resolve of waiters) resolve(event.data.report)
    waiters = []
  }
})
/** 지금 다시 보고를 받는다 — storage 이벤트를 받았는지 볼 때. */
globalThis.__askProbe = () =>
  new Promise((resolve) => {
    waiters.push(resolve)
    frame.contentWindow.postMessage({ ns: '39page-poc-probe', cmd: 'report' }, '*')
  })
