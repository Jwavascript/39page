/**
 * 패널 문구 (M11-5B). 상태마다 무엇이 일어났고 무엇을 하면 되는지 — 저장 여부를 사실대로 말한다.
 */
import { formatTimestamp } from '@web/shared/utils/time'

import type { BridgeErrorCode, UnavailableReason, UncertainReason } from '@/shared/bridgeMessages'
import type { CaptureRefusal } from '@/shared/messages'

export const formatTime = formatTimestamp

export const ACCESS_COPY = {
  title: '39page 에 바로 저장하려면 접근 권한이 필요해요',
  body: '39page 에 저장된 플레이리스트와 Moments 를 불러와 YouTube 에서 바로 저장하려면 39page 사이트 접근 권한이 필요합니다. 다른 사이트에는 접근하지 않아요.',
  grant: '39page 접근 허용',
  denied: '허용하지 않으면 39page 수집 화면(새 탭)으로 저장할 수 있어요.',
} as const

export const UNAVAILABLE_COPY: Readonly<Record<UnavailableReason, string>> = {
  permission:
    '39page 접근 권한이 없어 저장하지 않았어요. 위에서 허용하거나 수집 화면으로 열어 주세요.',
  'bridge-failed':
    '39page 에 연결하지 못해 저장하지 않았어요 (오프라인 · 39page 장애). 다시 연결하거나 수집 화면으로 열어 주세요.',
  'not-allowed':
    '이 39page 는 아직 확장의 바로 저장을 받지 않아요. 수집 화면으로 열어 저장할 수 있어요.',
  unsupported: '이 브라우저에서는 바로 저장을 쓸 수 없어요. 수집 화면으로 열어 주세요.',
}

export const UNCERTAIN_COPY: Readonly<Record<UncertainReason, string>> = {
  timeout: '39page 의 답이 늦어 저장됐는지 확인하지 못했어요.',
  disconnected: '연결이 끊겨 저장됐는지 확인하지 못했어요.',
  'permission-changed': '저장하는 동안 39page 접근 권한이 바뀌어 저장됐는지 확인하지 못했어요.',
}

export const UNCERTAIN_HINT =
  '같은 것을 두 번 저장하지 않도록 먼저 확인해 주세요. "다시 시도" 도 같은 요청이라 중복되지 않아요.'

const ERROR_COPY: Partial<Record<BridgeErrorCode, string>> = {
  blocked:
    '39page 에 저장된 데이터를 보호하는 중이라 저장하지 않았어요. 39page 대시보드에서 상태를 확인해 주세요.',
  conflict:
    '다른 39page 탭이 방금 저장해 최신 상태를 다시 불러왔어요. 저장하지 않았으니 다시 저장해 주세요.',
  busy: '다른 39page 탭이 저장하는 중이라 저장하지 않았어요. 잠시 뒤 다시 저장해 주세요.',
  'not-persisted': '브라우저 저장소에 쓰지 못해(공간 부족 등) 저장하지 않았어요.',
  'not-found': '그 플레이리스트를 찾을 수 없어요. 목록을 다시 불러와 주세요.',
  expired: '시간이 지나 저장을 시작하지 않았어요. 다시 저장해 주세요.',
  'invalid-time': '재생 시점이 올바르지 않아 저장하지 않았어요.',
  'invalid-video-id': '이 영상은 저장할 수 없어요.',
  'empty-name': '플레이리스트 이름을 입력해 주세요.',
}

export function errorCopy(code: BridgeErrorCode): string {
  return ERROR_COPY[code] ?? '저장하지 않았어요. 입력을 확인하고 다시 시도해 주세요.'
}

export const CAPTURE_REFUSED: Readonly<Record<CaptureRefusal, string>> = {
  shorts: 'Shorts 는 아직 Moment 를 저장할 수 없어요.',
  live: '라이브 방송은 Moment 를 저장할 수 없어요.',
  ad: '광고가 재생 중이라 시점을 잡지 않았어요. 광고가 끝난 뒤 다시 잡아 주세요.',
  'not-started': '재생이 시작되지 않아 시점을 잡지 않았어요. 재생한 뒤 다시 잡아 주세요.',
  unreadable: '재생 시점을 읽지 못했어요. 다시 잡아 주세요.',
  'not-watch': '시청 페이지에서만 시점을 잡을 수 있어요.',
}
