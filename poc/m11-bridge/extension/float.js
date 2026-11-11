/**
 * M11-1 저장 브리지 PoC — YouTube 위 플로팅 패널 자리 (content script, 격리된 세계).
 *
 * ⚠ 실험 코드.
 *
 * 패널 자체는 **확장 페이지(`panel.html`)를 iframe 으로** 띄운다. YouTube 페이지는 다른 origin 인
 * 그 iframe 의 DOM 을 읽거나 누를 수 없다 — 사용자의 목록 · 메모가 YouTube 에 노출되지 않고,
 * 페이지가 버튼을 대신 누를 수 없다. 이 스크립트는 자리(닫힌 shadow root)만 만든다.
 *
 * 아이콘을 다시 누르면 닫는다 (같은 id 의 자리가 있으면 지운다).
 */
;(() => {
  const HOST_ID = '__39page_poc_float'
  const existing = document.getElementById(HOST_ID)
  if (existing !== null) {
    existing.remove()
    return
  }

  const extensionOrigin = new URL(chrome.runtime.getURL('')).origin
  const host = document.createElement('div')
  host.id = HOST_ID
  host.style.cssText = [
    'position:fixed',
    'right:16px',
    'bottom:16px',
    'z-index:2147483647',
    'width:min(360px, calc(100vw - 32px))',
    'height:min(540px, calc(100vh - 32px))',
  ].join(';')

  const shadow = host.attachShadow({ mode: 'closed' })
  const frame = document.createElement('iframe')
  frame.src = chrome.runtime.getURL('panel.html')
  frame.title = '39page'
  frame.style.cssText =
    'width:100%;height:100%;border:0;border-radius:10px;box-shadow:0 10px 36px rgba(0,0,0,.5);background:#171614'
  shadow.append(frame)
  document.documentElement.append(host)

  const onMessage = (event) => {
    if (event.source !== frame.contentWindow || event.origin !== extensionOrigin) return
    if (event.data?.ns === '39page-poc-float' && event.data.type === 'close') {
      host.remove()
      globalThis.removeEventListener('message', onMessage)
    }
  }
  globalThis.addEventListener('message', onMessage)
})()
