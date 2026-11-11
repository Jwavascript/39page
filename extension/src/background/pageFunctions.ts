/**
 * 페이지의 **메인 세계**에서 실행하는 함수 (`scripting.executeScript({ world: 'MAIN', func })`).
 *
 * 왜 메인 세계인가 — M10-2 실측(Chromium 155, 실제 YouTube): SPA 이동 중 주소 ·
 * `document.title` · 제목 줄 · 플레이어 제목 링크는 **서로 다른 시각에** 바뀐다
 * (`document.title` 은 주소보다 약 1초 늦다). 영상 ID 와 제목을 **한 객체**에서 함께
 * 주는 것은 플레이어의 `getVideoData()` 뿐이었고, 이것은 페이지 스크립트가 붙인
 * 메서드라 격리된 세계에서는 보이지 않는다 (EXTENSION_DESIGN.md §3-2).
 *
 * 규칙:
 * - **자기 완결.** 직렬화되어 페이지로 가므로 바깥 식별자를 참조하지 않는다
 *   (테스트가 문자열에서 다시 만들어 실행해 본다).
 * - 읽기만 한다. 반환값은 문자열·null 뿐이고, Background 가 다시 검증한다 —
 *   페이지가 `getVideoData` 를 바꿔치기할 수 있으므로 **신뢰하지 않는 입력**이다.
 * - 확장 API 는 메인 세계에 노출되지 않는다.
 */
export function readPlayersInPage(): { videoId: string; title: string | null }[] {
  const found: { videoId: string; title: string | null }[] = []
  const elements = document.querySelectorAll('#movie_player, #shorts-player')
  for (const element of Array.from(elements).slice(0, 4)) {
    try {
      const reader = (element as unknown as { getVideoData?: () => unknown }).getVideoData
      const data = typeof reader === 'function' ? reader.call(element) : null
      if (typeof data !== 'object' || data === null) continue
      const { video_id: videoId, title } = data as { video_id?: unknown; title?: unknown }
      if (typeof videoId !== 'string' || videoId === '' || videoId.length > 64) continue
      found.push({
        videoId,
        title: typeof title === 'string' ? title.slice(0, 2000) : null,
      })
    } catch {
      /* 이 플레이어는 건너뛴다 */
    }
  }
  return found
}
