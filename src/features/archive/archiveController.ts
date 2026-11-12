/**
 * 통합 보관함의 열림 · 탭 상태를 공유하는 통로 (M11-2, ADR 0027).
 *
 * 보관함은 라이브러리(음악)와 Music Moments 를 **한 서랍의 두 탭**으로 다룬다. 여는 쪽(헤더 입구 ·
 * 플레이리스트 타일 · 데크 · Moments 위젯)과 보관함 자신은 `WidgetHost` 를 사이에 두고 떨어져 있어
 * props 로 닿지 않는다. M2 의 `LIBRARY_DRAWER` 와 같은 이유로 주입을 쓴다 — 이 통로가 그것을 대신한다.
 *
 * 전역 Pinia store 를 만들지 않는다. 열림 여부와 탭은 화면 하나의 UI 상태이고 저장하지 않는다.
 */
import type { InjectionKey, Ref } from 'vue'

/** 보관함의 탭. 데이터 · 백업은 탭이 아니라 별도 대화상자다 (ADR 0027 결정 1). */
export type ArchiveTab = 'music' | 'moments'

export interface ArchiveController {
  /** 열려 있는지. */
  readonly isOpen: Readonly<Ref<boolean>>
  /** 지금 보이는 탭. 닫혀 있어도 마지막 탭을 기억한다. */
  readonly tab: Readonly<Ref<ArchiveTab>>
  /** 보관함 루트의 DOM id. 입구 버튼의 `aria-controls` 가 가리킨다. */
  readonly panelId: string
  /** 그 탭으로 연다 (이미 열려 있으면 탭만 바꾼다). 탭을 주지 않으면 마지막 탭. */
  open(tab?: ArchiveTab): void
  /** 닫고, 연 버튼으로 포커스를 되돌린다. */
  close(): void

  /**
   * 재생을 요청하기 **전에** 플레이어를 가리지 않도록 비켜준다 (M7-2 의 계약을 잇는다).
   *
   * M11 의 보관함은 레이아웃이 플레이어를 피해 가므로(넓은 화면은 옆 열, 세로 화면은 플레이어
   * **아래**에서 시작하는 시트) 평소에는 아무것도 하지 않는다. 그래도 계약을 남긴다 — 재생 요청은
   * 동기라 코디네이터 안에서 기다릴 수 없고, 가리는지 아는 쪽은 셸뿐이다.
   */
  stepAside(): Promise<void>
}

export const ARCHIVE: InjectionKey<ArchiveController> = Symbol('39page.archive')
