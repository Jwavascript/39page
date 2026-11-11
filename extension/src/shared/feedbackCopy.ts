/**
 * 팝업과 단축키(M10-5)가 함께 쓰는 안내 문구. 같은 상황에 같은 말을 한다.
 * `chrome.*` 를 부르지 않는다.
 */
import type { CaptureRefusal } from './messages'

export const CAPTURE_REFUSAL_COPY: Readonly<Record<CaptureRefusal, string>> = {
  shorts: 'Shorts 는 아직 Moment 를 저장할 수 없습니다.',
  live: '라이브 방송은 아직 Moment 를 저장할 수 없습니다.',
  ad: '광고가 재생 중입니다. 광고가 끝난 뒤 다시 눌러 주세요.',
  'not-started': '재생 위치가 아직 정해지지 않았습니다. 영상을 재생한 뒤 다시 눌러 주세요.',
  unreadable:
    '재생 위치를 읽지 못했습니다. 영상을 재생하거나 페이지를 새로 고친 뒤 다시 눌러 주세요.',
  'not-watch': 'YouTube 영상 페이지(youtube.com/watch)에서만 Moment 를 저장할 수 있습니다.',
}
