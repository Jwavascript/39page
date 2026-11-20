/**
 * 공유 카드 그리기 — 처음 쓸 때 내려받는 입구 (ADR 0041).
 *
 * 캔버스 그리기 코드(`shareCardCanvas.ts`)는 공유 화면에서 카드를 처음 그릴 때 받는다 — 공유를 열지 않는 보통 방문의 첫 화면
 * 묶음을 키우지 않는다. `main.ts` 는 이 함수를 주입만 한다 (`main.ts` 에는 동적 import 를 두지 않는다 — 테마 CSS 정적 로드 규칙).
 */
import type { ShareCardRenderer } from './shareCard'

export const lazyShareCardRenderer: ShareCardRenderer = async (model) => {
  const { renderShareCard } = await import('./shareCardCanvas')
  return renderShareCard(model)
}
