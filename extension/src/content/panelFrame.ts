/**
 * YouTube 위 패널 iframe 을 띄우고 거둔다 (M11-5B) — content script(격리된 세계)에서 실행된다.
 *
 * - 패널은 **확장 origin 의 iframe** 이다. YouTube 페이지는 iframe 안의 입력 · 목록을 읽거나 누를 수 없다.
 * - 호스트는 **닫힌 shadow root** 안에 iframe 을 둔다 — 페이지 스크립트가 `.shadowRoot` 로 들어가지 못하고,
 *   페이지 CSS 가 패널 틀을 흐트러뜨리지 못한다.
 * - 한 탭에 하나다. 다시 열면 새로 만들지 않고 포커스만 옮긴다 (리스너 · iframe 누적 없음).
 * - 닫으면 열기 전 포커스로 되돌린다. YouTube 재생에는 손대지 않는다.
 * - 오른쪽 아래, 화면이 좁으면 폭 · 높이를 줄인다. 위치 · 크기는 CSS 만으로 정한다.
 *
 * 페이지의 `postMessage` 를 듣지 않는다 — 패널과의 대화는 모두 서비스 워커를 거친다.
 */

export const PANEL_HOST_ID = 'page39-panel-host'
export const PANEL_TITLE = '39page — YouTube 에서 담기'

export interface PanelFrameDeps {
  readonly document: Document
  /** `chrome.runtime.getURL(PANEL_PATH)`. */
  readonly panelUrl: string
}

const HOST_STYLE = [
  'position: fixed',
  'right: 16px',
  'bottom: 16px',
  'z-index: 2147483646',
  // 100vw 는 스크롤 막대를 포함한다 — 고정 요소의 % 는 막대를 뺀 화면 기준이라 좁은 창에서도 안에 들어온다 (실측).
  'width: min(380px, calc(100% - 32px))',
  'height: min(620px, calc(100% - 32px))',
  'margin: 0',
  'padding: 0',
  'border: 0',
  'background: transparent',
  'display: block',
].join('; ')

const FRAME_STYLE = [
  'width: 100%',
  'height: 100%',
  'border: 0',
  'border-radius: 12px',
  'box-shadow: 0 12px 40px rgba(0, 0, 0, 0.45)',
  'color-scheme: normal',
  'background: transparent',
].join('; ')

export interface PanelFrame {
  open(): 'opened' | 'focused'
  close(): void
  isOpen(): boolean
}

export function createPanelFrame(deps: PanelFrameDeps): PanelFrame {
  const doc = deps.document
  let host: HTMLElement | null = null
  let frame: HTMLIFrameElement | null = null
  let returnFocus: Element | null = null

  function open(): 'opened' | 'focused' {
    if (host !== null && host.isConnected && frame !== null) {
      frame.focus()
      return 'focused'
    }
    // 앞서 다른 content script 인스턴스가 남긴 호스트가 있으면 거둔다 (재주입 뒤).
    doc.getElementById(PANEL_HOST_ID)?.remove()

    returnFocus = doc.activeElement
    host = doc.createElement('div')
    host.id = PANEL_HOST_ID
    host.setAttribute('style', HOST_STYLE)
    const root = host.attachShadow({ mode: 'closed' })
    frame = doc.createElement('iframe')
    frame.src = deps.panelUrl
    frame.title = PANEL_TITLE
    frame.setAttribute('style', FRAME_STYLE)
    // 패널은 카메라 · 전체 화면 같은 권한이 필요 없다.
    frame.setAttribute('allow', '')
    root.append(frame)
    doc.documentElement.append(host)
    const target = frame
    target.addEventListener('load', () => target.focus(), { once: true })
    return 'opened'
  }

  function close(): void {
    host?.remove()
    host = null
    frame = null
    const back = returnFocus
    returnFocus = null
    if (back instanceof HTMLElement && back.isConnected) back.focus({ preventScroll: true })
  }

  return { open, close, isOpen: () => host !== null && host.isConnected }
}
