/**
 * 받은 목록의 새 이름 — 같은 이름이 있으면 "(2)" · "(3)" … (링크로 받은 공유, ADR 0040). 순수 함수다.
 *
 * 파일(ZIP) 공유가 있던 때(M12-4)부터 쓰던 규칙이다 — 파일 공유는 ADR 0043 에서 없앴다.
 */
export function uniquePlaylistName(existing: Iterable<string>, name: string): string {
  const names = new Set(existing)
  if (!names.has(name)) return name
  for (let n = 2; ; n += 1) {
    const candidate = `${name} (${String(n)})`
    if (!names.has(candidate)) return candidate
  }
}
