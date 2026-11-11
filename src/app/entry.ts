/**
 * 어느 화면을 띄울지 — 주소 조각으로 정한다 (M10-3B).
 *
 * 앱은 라우터를 쓰지 않는다. 로드할 때 **한 번만** 본다 — 대시보드가 열린 뒤 조각이
 * 바뀌어도 화면을 바꾸지 않는다 (재생 중인 플레이어를 내리지 않는다).
 */
import { isCollectHash } from '@/features/collect/collectRequest'

export type AppEntry = 'dashboard' | 'collect'

export function resolveEntry(hash: string): AppEntry {
  return isCollectHash(hash) ? 'collect' : 'dashboard'
}
