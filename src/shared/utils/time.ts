/**
 * 재생 시점 표기 — YouTube 플레이어와 같은 모양 (`0:42` · `12:05` · `1:02:03`).
 *
 * M9-4 의 `formatMomentTime` 을 공용으로 옮겼다 (M10-4). 대시보드의 Moments 위젯과
 * 수집 화면이 같은 표기를 쓴다 — 기능끼리 직접 import 하지 않는다 (`AGENTS.md` 규칙 2).
 */
export function formatTimestamp(seconds: number): string {
  // store 를 지난 값은 이미 0 이상 정수다. 그래도 표시가 거짓말을 하지 않게 막는다.
  if (!Number.isFinite(seconds) || seconds < 0) return '--:--'

  const total = Math.floor(seconds)
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const secs = String(total % 60).padStart(2, '0')

  return hours > 0
    ? `${String(hours)}:${String(minutes).padStart(2, '0')}:${secs}`
    : `${String(minutes)}:${secs}`
}
