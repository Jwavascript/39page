/**
 * 테스트는 네트워크에 나가지 않는다.
 *
 * M4 의 날씨 위젯이 `fetch` 를 쓴다. 앱을 마운트하는 spec 이 여섯 개인데
 * 거기서 실제 요청이 나가면 테스트가 느려지고 외부 서비스 상태에 따라
 * 흔들린다. 그래서 전역 `fetch` 를 **막아둔다.**
 *
 * 막는 쪽이 각 spec 에서 개별로 스텁하는 것보다 강하다. 앞으로 어떤 코드가
 * 실수로 네트워크를 쓰더라도 여기서 걸린다.
 *
 * 날씨 spec 은 이 자리를 `vi.spyOn(globalThis, 'fetch')` 로 덮어 쓴다.
 * 그 밖의 spec 에서는 거절이 날씨 위젯의 **오류 상태**로 나타나며, 그것도
 * 실제로 검증하고 싶은 경로다.
 */
import { beforeEach, vi } from 'vitest'

const blocked = (): Promise<Response> =>
  Promise.reject(new Error('테스트에서 네트워크 요청을 막았습니다 (tests/setup/noNetwork.ts)'))

beforeEach(() => {
  vi.stubGlobal('fetch', blocked)
})
