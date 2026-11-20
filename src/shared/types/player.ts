/**
 * 도메인 계층의 재생 상태.
 *
 * YouTube IFrame API의 숫자 상태값(-1, 0, 1, 2, 3, 5)을 **그대로 쓰지 않는다.**
 * 숫자 → `PlayerState` 변환은 `src/features/playback`의 어댑터 안에서만
 * 일어나고, store·테마·위젯은 이 유니온만 본다.
 *
 * 근거: `AGENTS.md` 규칙 4 (재생 로직과 테마 UI 분리),
 * `docs/architecture/SYSTEM_DESIGN.md` §4.6.
 */
export type PlayerState = 'idle' | 'loading' | 'playing' | 'paused' | 'ended' | 'error'

/**
 * 반복 재생 모드 (ADR 0038).
 *
 * | 값    | 큐 끝에서                  | 곡이 끝나면           |
 * | ----- | -------------------------- | --------------------- |
 * | `off` | 멈춘다 (M3-0.1 의 기본값)  | 다음 곡               |
 * | `all` | 처음으로 돌아간다          | 다음 곡               |
 * | `one` | 처음으로 돌아간다 (수동 ⏭) | **같은 곡을 다시**    |
 *
 * 저장하지 않는다 — 큐와 함께 메모리에만 있다.
 */
export type RepeatMode = 'off' | 'all' | 'one'

export const REPEAT_MODES: readonly RepeatMode[] = ['off', 'all', 'one']
