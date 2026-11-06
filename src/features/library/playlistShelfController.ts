/**
 * 플레이리스트 위젯의 **접힘/펼침** 상태를 공유하는 통로 (M7).
 *
 * 데크(LP·카세트)를 누르면 플레이리스트 위젯이 펼쳐진다. 누르는 쪽
 * (`DeckWidget`)과 펼쳐지는 쪽(`PlaylistWidget`)은 `WidgetHost` 를 사이에 두고
 * 떨어져 있어 props 로 닿지 않는다. `drawerController.ts` 와 같은 이유로 주입을
 * 쓴다.
 *
 * M6 까지는 데크를 누르면 **트랙 드로어**가 열렸다. 실기기 검증에서 "lp판을
 * 누르면 최소화 되었던 playlist 위젯이 펼쳐지게" 로 바뀌었다. 트랙 드로어는
 * 플레이리스트 타일을 눌러서 연다.
 *
 * 전역 Pinia store 를 만들지 않는다. 펼침 여부는 화면 하나의 UI 상태이고
 * 영속화 대상도 아니다.
 */
import type { InjectionKey, Ref } from 'vue'

export interface PlaylistShelfController {
  /** 펼쳐져 있는지. 기본은 접힘이다. */
  readonly isExpanded: Readonly<Ref<boolean>>
  /** 위젯 루트의 DOM id. 트리거의 `aria-controls` 가 가리킨다. */
  readonly shelfId: string
  /** 접혀 있으면 펼치고, 펼쳐져 있으면 접는다. */
  toggle(): void
}

export const PLAYLIST_SHELF: InjectionKey<PlaylistShelfController> = Symbol('39page.playlistShelf')
