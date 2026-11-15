/**
 * 바이트 수를 사람이 읽는 크기로 (M12-3) — `1.2 MB` · `340 KB` · `12 B`.
 *
 * 1 KB = 1,024 B 로 센다 (브라우저 · 운영체제의 파일 크기 표시와 같다). 음수 · 숫자가 아니면 `0 B`.
 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB'] as const
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  const digits = unit === 0 || value >= 100 ? 0 : 1
  return `${value.toFixed(digits).replace(/\.0$/, '')} ${units[unit]}`
}
